#!/usr/bin/env node
/**
 * Contadores em tempo real do cartão, sem navegador e sem Firebase:
 *   node e2e/live-counters-check.mjs        (ou: npm run e2e:contadores-vivos)
 *
 * O que a suíte prova:
 *   - curtir/descurtir NÃO "pisca": o snapshot com o número velho não desfaz a mudança que a pessoa acabou de fazer, e ela
 *     some quando o servidor alcança (ou passado o prazo), sem número preso;
 *   - o snapshot só mexe nos campos de contador e só com número válido (lixo, negativo, texto, `views` ficam de fora);
 *   - UM ouvinte por post, compartilhado por vários cartões; o último valor é entregue na hora a quem chega depois; fecha
 *     só depois da folga; erro encerra aquele ouvinte sem laço; há um teto de ouvintes simultâneos;
 *   - o cache de interação não ressuscita contagem velha (a contagem guardada vale 60 s; os marcadores da pessoa, sempre).
 * Sai com código 1 se algo falhar.
 */
import { COUNTER_FIELDS, countersOf, createOptimisticTracker, mergeServerCounters, pickCounterFields } from '../src/lib/feed/liveCounters.ts';
import { createPostListenerRegistry } from '../src/lib/feed/postListenerRegistry.ts';
import { CACHED_COUNT_TTL_MS, dispatchPostInteraction, getCachedPostInteraction } from '../src/lib/events/postInteractionState.ts';

let falhas = 0;
let total = 0;
const confere = (nome, condicao, motivo, detalhe) => {
  total++;
  if (condicao) console.log(`OK    ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo}`); }
};
const base = { likes: 5, reposts: 2, commentsCount: 1, quotesCount: 0 };

// ═════════════ 1. Curtida otimista x snapshot ═════════════
{
  const t = createOptimisticTracker(6000);
  t.noteServer('likes', 5);
  let tela = { ...base };
  // a pessoa curte: a tela mostra 6 na hora
  t.track('likes', 5, 6, 1000);
  tela = { ...tela, likes: 6 };
  // chega um snapshot de OUTRA mudança, ainda com 5 curtidas (a Function ainda não somou a minha)
  const velho = mergeServerCounters(tela, { likes: 5, reposts: 2, commentsCount: 1, quotesCount: 0 }, t, 1500);
  confere('OTIMISTA · snapshot com o número VELHO não desfaz a curtida na tela (antes: 6 → 5 → 6, uma piscada)', velho === null || velho.likes === 6, JSON.stringify(velho));
  const alcancou = mergeServerCounters(tela, { likes: 6 }, t, 2500);
  confere('OTIMISTA · quando o servidor alcança (6), o valor vira o do servidor e a pendência some', alcancou === null && !t.hasPending('likes'), JSON.stringify(alcancou));
  const depois = mergeServerCounters({ ...tela }, { likes: 8 }, t, 3000);
  confere('OTIMISTA · sem pendência, o número do servidor manda (curtidas de outras pessoas aparecem)', depois && depois.likes === 8, JSON.stringify(depois));
}
{
  const t = createOptimisticTracker(6000);
  t.noteServer('likes', 6);
  t.track('likes', 6, 5, 1000); // descurtiu
  const velho = mergeServerCounters({ ...base, likes: 5 }, { likes: 6 }, t, 1200);
  confere('OTIMISTA · descurtir: o snapshot ainda com 6 não traz o número de volta (continua 5)', velho === null || velho.likes === 5, JSON.stringify(velho));
  const alcancou = mergeServerCounters({ ...base, likes: 5 }, { likes: 5 }, t, 2000);
  confere('OTIMISTA · ...e o servidor alcançando (5) encerra a pendência', alcancou === null && !t.hasPending('likes'), JSON.stringify(alcancou));
}
{
  const t = createOptimisticTracker(6000);
  t.noteServer('likes', 5);
  t.track('likes', 5, 6, 1000);
  t.track('likes', 6, 5, 1500);
  confere('OTIMISTA · curtir e descurtir em seguida se anulam (nada fica pendente)', !t.hasPending('likes'), 'ficou pendência');
  const r = mergeServerCounters({ ...base }, { likes: 5 }, t, 1600);
  confere('OTIMISTA · ...e o snapshot seguinte não muda nada', r === null, JSON.stringify(r));
}
{
  const t = createOptimisticTracker(6000);
  t.noteServer('likes', 5);
  t.track('likes', 5, 6, 1000);
  const r = mergeServerCounters({ ...base, likes: 6 }, { likes: 5 }, t, 1000 + 6001);
  confere('OTIMISTA · passado o prazo (a escrita falhou ou a Function atrasou), vale o servidor: não fica número preso', r && r.likes === 5 && !t.hasPending('likes'), JSON.stringify(r));
}
{
  const t = createOptimisticTracker(6000);
  t.noteServer('likes', 5);
  t.noteServer('reposts', 2);
  t.track('likes', 5, 6, 1000);
  const r = mergeServerCounters({ ...base, likes: 6 }, { likes: 5, reposts: 3 }, t, 1100);
  confere('OTIMISTA · a pendência de um campo não segura os outros (reposts de outra pessoa aparecem; curtida segue otimista)', r && r.reposts === 3 && r.likes === 6, JSON.stringify(r));
}

// ═════════════ 2. O que o snapshot pode mudar ═════════════
{
  const t = createOptimisticTracker();
  const r = mergeServerCounters({ ...base }, { likes: 9, views: 99999, text: 'x', isDeleted: true, reposts: 'muitos', commentsCount: -3, quotesCount: Number.NaN }, t, 1);
  confere('SNAPSHOT · só campo de contador com número válido entra: `views`, texto, `isDeleted`, texto no lugar de número, negativo e NaN ficam de fora', r && r.likes === 9 && r.reposts === 2 && r.commentsCount === 1 && r.quotesCount === 0 && !('views' in r), JSON.stringify(r));
  confere('SNAPSHOT · nada mudou → devolve nulo (o cartão não é redesenhado à toa)', mergeServerCounters({ ...base }, { ...base }, createOptimisticTracker(), 1) === null && mergeServerCounters({ ...base }, null, createOptimisticTracker(), 1) === null && mergeServerCounters({ ...base }, {}, createOptimisticTracker(), 1) === null, 'redesenhou sem mudança');
  confere('SNAPSHOT · `views` não é um campo acompanhado em tempo real', !COUNTER_FIELDS.includes('views'), COUNTER_FIELDS.join());
  confere('SNAPSHOT · pickCounterFields devolve só números inteiros válidos', JSON.stringify(pickCounterFields({ likes: 4.9, reposts: 1e13, commentsCount: '3', quotesCount: 2, views: 1 })) === JSON.stringify({ likes: 4, quotesCount: 2 }), JSON.stringify(pickCounterFields({ likes: 4.9, reposts: 1e13, commentsCount: '3', quotesCount: 2, views: 1 })));
  confere('SNAPSHOT · contagem ausente no post vale 0', JSON.stringify(countersOf({ likes: 3 })) === JSON.stringify({ likes: 3, reposts: 0, commentsCount: 0, quotesCount: 0 }) && countersOf(null).likes === 0, 'valor padrão errado');
}

// ═════════════ 3. Um ouvinte por post ═════════════
const criarRelogio = () => {
  const r = { t: 0, timers: [], seq: 0 };
  r.setTimeout = (fn, ms) => { const h = ++r.seq; r.timers.push({ h, at: r.t + ms, fn }); return h; };
  r.clearTimeout = (h) => { r.timers = r.timers.filter((x) => x.h !== h); };
  r.avanca = (ms) => { r.t += ms; for (const x of r.timers.filter((x) => x.at <= r.t).sort((a, b) => a.at - b.at)) { r.timers = r.timers.filter((y) => y !== x); x.fn(); } };
  return r;
};
const fabrica = (opts = {}) => {
  const relogio = criarRelogio();
  const log = { assinou: [], fechou: [], ativos: new Map() };
  const subscribe = (id, onData, onError) => {
    log.assinou.push(id);
    log.ativos.set(id, { onData, onError });
    return () => { log.fechou.push(id); log.ativos.delete(id); };
  };
  const registro = createPostListenerRegistry(subscribe, { setTimeout: relogio.setTimeout, clearTimeout: relogio.clearTimeout, ...opts });
  return { relogio, log, registro };
};
{
  const { relogio, log, registro } = fabrica();
  const a = [], b = [];
  const cancelaA = registro.watch('v|P1', (d) => a.push(d));
  const cancelaB = registro.watch('v|P1', (d) => b.push(d));
  confere('OUVINTE · dois cartões do MESMO post abrem UM ouvinte só', log.assinou.length === 1, `abriu ${log.assinou.length}`);
  log.ativos.get('v|P1').onData({ likes: 7 });
  confere('OUVINTE · os dois recebem cada atualização', a.length === 1 && b.length === 1 && a[0].likes === 7, JSON.stringify({ a, b }));
  const c = [];
  const cancelaC = registro.watch('v|P1', (d) => c.push(d));
  confere('OUVINTE · quem chega depois recebe o último valor NA HORA, sem nova leitura', c.length === 1 && c[0].likes === 7 && log.assinou.length === 1, JSON.stringify(c));
  cancelaA(); cancelaB(); cancelaC();
  cancelaA();
  confere('OUVINTE · cancelar duas vezes é inofensivo, e sem observadores o ouvinte AINDA não fecha (folga)', log.fechou.length === 0 && registro.size() === 1 && registro.activeCount() === 0, `fechou=${log.fechou.length}`);
  relogio.avanca(14_000);
  confere('OUVINTE · antes de acabar a folga (15 s) continua aberto', log.fechou.length === 0, `fechou=${log.fechou.length}`);
  const volta = registro.watch('v|P1', () => {});
  relogio.avanca(60_000);
  confere('OUVINTE · um cartão que volta dentro da folga cancela o fechamento (a rolagem de ida e volta não reabre nada)', log.fechou.length === 0 && log.assinou.length === 1, `fechou=${log.fechou.length}, abriu=${log.assinou.length}`);
  volta();
  relogio.avanca(15_001);
  confere('OUVINTE · acabada a folga sem observadores, o ouvinte fecha e libera a vaga', log.fechou.length === 1 && registro.size() === 0, `fechou=${log.fechou.length}`);
}
{
  const { log, registro } = fabrica();
  const ouvido = [];
  registro.watch('v|P2', (d) => ouvido.push(d));
  log.ativos.get('v|P2').onError(new Error('permission-denied'));
  registro.watch('v|P2', () => {});
  confere('OUVINTE · erro (post removido, sem permissão) encerra aquele ouvinte e NÃO tenta de novo em laço', log.assinou.length === 1, `abriu ${log.assinou.length}`);
  registro.watch('outro|P2', () => {});
  confere('OUVINTE · a falha de uma conta não gruda na outra (a chave leva quem está vendo)', log.assinou.length === 2, `abriu ${log.assinou.length}`);
}
{
  const { relogio, log, registro } = fabrica({ maxListeners: 3 });
  const cancela = ['A', 'B', 'C'].map((id) => registro.watch(`v|${id}`, () => {}));
  const extra = registro.watch('v|D', () => {});
  confere('OUVINTE · acima do teto de ouvintes, o cartão novo não abre mais um (fica com o que já tem)', log.assinou.length === 3 && registro.size() === 3, `abriu ${log.assinou.length}`);
  cancela[0]();
  registro.watch('v|E', () => {});
  confere('OUVINTE · mas um ouvinte só esperando a folga é fechado na hora para dar a vaga', log.fechou.includes('v|A') && log.assinou.includes('v|E') && registro.size() === 3, JSON.stringify(log));
  extra();
  registro.closeAll();
  confere('OUVINTE · closeAll fecha tudo (troca de conta)', registro.size() === 0 && log.ativos.size === 0 && relogio.timers.length === 0, `restam ${registro.size()}`);
}

// ═════════════ 4. O cache de interação não ressuscita contagem velha ═════════════
{
  globalThis.window = undefined; // ambiente Node: o despacho do evento é pulado, o cache funciona
  dispatchPostInteraction('u1', 'P9', { isLiked: true, likes: 6 });
  const agora = Date.now();
  const fresco = getCachedPostInteraction('u1', 'P9', agora + 1000);
  const velho = getCachedPostInteraction('u1', 'P9', agora + CACHED_COUNT_TTL_MS + 5000);
  confere('CACHE · logo depois de interagir, o cache devolve o marcador E o número que a pessoa viu', fresco.isLiked === true && fresco.likes === 6, JSON.stringify(fresco));
  confere('CACHE · passado 1 minuto, o NÚMERO sai (o servidor já o atualizou) e o marcador da pessoa fica', velho.isLiked === true && !('likes' in velho), JSON.stringify(velho));
  confere('CACHE · outra pessoa ou outro post não enxergam o cache', getCachedPostInteraction('u2', 'P9') === undefined && getCachedPostInteraction('u1', 'P8') === undefined && getCachedPostInteraction(null, 'P9') === undefined, 'vazou entre chaves');
  dispatchPostInteraction('u1', 'P9', { isReposted: true, reposts: 3 });
  const acumulado = getCachedPostInteraction('u1', 'P9', Date.now());
  confere('CACHE · interações seguidas se acumulam no cache (marcadores e números recentes)', acumulado.isLiked === true && acumulado.isReposted === true && acumulado.reposts === 3, JSON.stringify(acumulado));
}
{
  // O EVENTO leva só o que mudou agora: antes levava o acumulado, e uma curtida antiga (6) sobrescrevia a atual.
  const recebidos = [];
  globalThis.window = { dispatchEvent: (e) => recebidos.push(e.detail), };
  globalThis.CustomEvent = class { constructor(tipo, init) { this.type = tipo; this.detail = init.detail; } };
  dispatchPostInteraction('u1', 'P7', { isLiked: true, likes: 6 });
  dispatchPostInteraction('u1', 'P7', { isReposted: true, reposts: 3 });
  confere('EVENTO · o segundo despacho leva SÓ o repost (não repete a curtida velha, que sobrescreveria as curtidas atuais do cartão)', recebidos.length === 2 && JSON.stringify(recebidos[1].patch) === JSON.stringify({ isReposted: true, reposts: 3 }), JSON.stringify(recebidos.map((r) => r.patch)));
  delete globalThis.window;
}

console.log('');
console.log(`${total} verificações.`);
if (falhas) { console.log(`${falhas} falha(s).`); process.exit(1); }
console.log('Contadores vivos OK: sem piscada ao curtir, um ouvinte por post, e contagem velha não volta do cache.');
