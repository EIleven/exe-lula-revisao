#!/usr/bin/env node
/**
 * Revalidação, em segundo plano, dos contadores de posts remotos (ap_*):
 *   node e2e/count-sync-check.mjs        (ou: npm run e2e:contadores-sync)
 *
 * A rota /api/ap/sync-counts nasceu aberta e sem freio: qualquer pessoa da internet podia mandar ids e fazer o nosso servidor
 * buscar, em paralelo (15 por chamada), no servidor Mastodon de terceiros. Aqui se prova cada freio com relógio, rede e
 * Firestore de mentira:
 *   - ids estritos e limitados (parseSyncIds); validade (isFresh) e Retry-After (retryAfterMs);
 *   - memória de validade (createSyncMemo) e vaga POR SERVIDOR (createDomainGate, inclusive contra um modelo aleatório);
 *   - o orquestrador (createCountSyncer): ordem das decisões, 429 que cala o servidor, vaga devolvida SEMPRE, uma busca só
 *     para chamadas simultâneas;
 *   - a fila do navegador (createRemoteCountSyncQueue): lote, cooldown, aba escondida, 429 e falha de rede.
 * Sai com código 1 se algo falhar.
 */
import {
  SYNC_BATCH_MAX,
  SYNC_NEGATIVE_MS,
  SYNC_RETRY_MS,
  SYNC_TTL_MS,
  createDomainGate,
  createSyncMemo,
  isFresh,
  mapWithLimit,
  parseSyncIds,
  retryAfterMs,
} from '../src/lib/federation/countSyncPolicy.ts';
import { createCountSyncer } from '../src/lib/federation/countSyncer.ts';
import { createRemoteCountSyncQueue } from '../src/lib/feed/remoteCountSyncQueue.ts';

let falhas = 0;
let total = 0;
const confere = (nome, condicao, motivo) => {
  total++;
  if (condicao) console.log(`OK    ${nome}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo ?? 'condição falsa'}`); }
};
const igual = (nome, obtido, esperado) => {
  const a = JSON.stringify(obtido);
  const b = JSON.stringify(esperado);
  confere(nome, a === b, `esperava ${b}, veio ${a}`);
};

const T0 = 1_000_000_000_000;
const id = (n) => `ap_${String(n).padStart(24, '0')}`;
const solta = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

// ───────────────────────── 1. ids ─────────────────────────
igual('IDS · válidos passam na ordem de chegada', parseSyncIds([id(3), id(1), id(2)]), [id(3), id(1), id(2)]);
igual('IDS · repetido sai', parseSyncIds([id(1), id(1), id(2), id(1)]), [id(1), id(2)]);
igual(
  'IDS · o que não parece id de post remoto sai (curto, longo, maiúsculo, com barra, com espaço, não-texto)',
  parseSyncIds([id(1), 'abc', 'ap_', 'ap_abc', 'post_123456', '', 42, null, undefined, {}, [], 'ap_../../x', 'ap_ab cdef', `AP_${'0'.repeat(24)}`, `ap_${'a'.repeat(65)}`, 'ap_ééééééé']),
  [id(1)],
);
igual('IDS · teto padrão de 15 por requisição', parseSyncIds(Array.from({ length: 40 }, (_, i) => id(i))).length, SYNC_BATCH_MAX);
igual('IDS · teto escolhido', parseSyncIds(Array.from({ length: 40 }, (_, i) => id(i)), 5).length, 5);
for (const ruim of [undefined, null, 'ap_xxxxxx', 7, {}, { length: 3 }, true]) igual(`IDS · ${JSON.stringify(ruim)} não é lista`, parseSyncIds(ruim), []);
igual('IDS · varre só o começo (custo limitado): 100 inválidos antes do primeiro válido ⇒ nada', parseSyncIds([...Array(100).fill('x'), id(1)]), []);
igual('IDS · mas 30 inválidos antes de um válido ainda passam (a varredura cobre 4× o teto)', parseSyncIds([...Array(30).fill('x'), id(1)]), [id(1)]);

// ───────────────────────── 2. validade ─────────────────────────
confere('VALIDADE · conferido há 1 min: vale', isFresh(T0 - 60_000, T0));
confere('VALIDADE · exatamente no prazo: já NÃO vale (limite aberto)', !isFresh(T0 - SYNC_TTL_MS, T0));
confere('VALIDADE · 1 ms antes do prazo: vale', isFresh(T0 - SYNC_TTL_MS + 1, T0));
for (const ruim of [null, undefined, '123', Number.NaN, Infinity, -Infinity, {}, true]) confere(`VALIDADE · ${String(ruim)} não é carimbo`, !isFresh(ruim, T0));
confere('VALIDADE · carimbo adiantado dentro de 1 min (relógio um pouco errado): vale', isFresh(T0 + 30_000, T0));
confere('VALIDADE · carimbo no futuro distante NÃO vale (senão congelaria a revalidação do post para sempre)', !isFresh(T0 + 3_600_000, T0));
confere('VALIDADE · prazo escolhido', isFresh(T0 - 5000, T0, 10_000) && !isFresh(T0 - 15_000, T0, 10_000));

// ───────────────────────── 3. Retry-After ─────────────────────────
igual('RETRY-AFTER · segundos', retryAfterMs('30', T0), 30_000);
igual('RETRY-AFTER · 0 vira o mínimo de 5 s', retryAfterMs('0', T0), 5_000);
igual('RETRY-AFTER · valor enorme é limitado a 15 min (não deixa um servidor nos calar por horas)', retryAfterMs('999999', T0), 900_000);
igual('RETRY-AFTER · data HTTP daqui a 90 s', retryAfterMs(new Date(T0 + 90_000).toUTCString(), T0), 90_000);
igual('RETRY-AFTER · data no passado vira o mínimo', retryAfterMs(new Date(T0 - 5_000).toUTCString(), T0), 5_000);
igual('RETRY-AFTER · data daqui a um dia é limitada', retryAfterMs(new Date(T0 + 86_400_000).toUTCString(), T0), 900_000);
for (const x of [undefined, null, '', '   ', 'logo', {}, 30]) igual(`RETRY-AFTER · ${JSON.stringify(x) ?? 'undefined'} ⇒ 60 s`, retryAfterMs(x, T0), 60_000);
igual('RETRY-AFTER · lista de cabeçalhos: vale o primeiro', retryAfterMs(['45', '10'], T0), 45_000);

// ───────────────────────── 4. memória de validade ─────────────────────────
{
  const m = createSyncMemo(3);
  confere('MEMÓRIA · desconhecido não está de molho', !m.seen('a', T0));
  m.mark('a', T0, 1000);
  confere('MEMÓRIA · marcado: de molho até o prazo', m.seen('a', T0 + 999));
  confere('MEMÓRIA · vencido: sai e libera a memória', !m.seen('a', T0 + 1000) && m.size === 0);
  m.mark('b', T0, 5000);
  m.forget('b');
  confere('MEMÓRIA · forget tira do molho', !m.seen('b', T0));
  m.mark('c', T0, 100_000);
  m.mark('c', T0, 1000);
  confere('MEMÓRIA · marcar de novo TROCA o prazo (falha curta depois de sucesso, e vice-versa)', m.seen('c', T0 + 500) && !m.seen('c', T0 + 2000));

  const teto = createSyncMemo(3);
  for (let i = 0; i < 5; i++) teto.mark(id(i), T0 + i, 100_000);
  confere('MEMÓRIA · teto de 3: saem as mais antigas', teto.size === 3 && !teto.seen(id(0), T0 + 10) && !teto.seen(id(1), T0 + 10) && teto.seen(id(4), T0 + 10));

  const venc = createSyncMemo(3);
  venc.mark('a', T0, 1000);
  venc.mark('b', T0, 100_000);
  venc.mark('c', T0, 100_000);
  venc.mark('d', T0 + 2000, 100_000);
  confere('MEMÓRIA · ao estourar o teto, o VENCIDO sai antes dos vivos', venc.size === 3 && venc.seen('b', T0 + 2000) && venc.seen('c', T0 + 2000) && venc.seen('d', T0 + 2000));

  const ordem = createSyncMemo(3);
  ordem.mark('a', T0, 100_000);
  ordem.mark('b', T0, 100_000);
  ordem.mark('c', T0, 100_000);
  ordem.mark('a', T0 + 1, 100_000); // "a" foi tocado de novo: agora é o MAIS NOVO
  ordem.mark('d', T0 + 2, 100_000);
  confere(
    'MEMÓRIA · ao estourar o teto sai o MENOS recente (um id marcado de novo passa a ser o mais novo)',
    ordem.size === 3 && ordem.seen('a', T0 + 3) && !ordem.seen('b', T0 + 3) && ordem.seen('c', T0 + 3) && ordem.seen('d', T0 + 3),
  );
}

// ───────────────────────── 5. vaga por servidor ─────────────────────────
{
  const g = createDomainGate({ maxConcurrent: 2, perWindow: 100, windowMs: 1000 });
  const r1 = g.enter('mastodon.social', T0);
  const r2 = g.enter('mastodon.social', T0);
  confere('SERVIDOR · duas buscas ao mesmo tempo: cabem', typeof r1 === 'function' && typeof r2 === 'function');
  confere('SERVIDOR · a terceira não cabe (2 ao mesmo tempo por servidor)', g.enter('mastodon.social', T0) === null);
  confere('SERVIDOR · outro servidor tem as suas vagas', typeof g.enter('outra.casa', T0) === 'function');
  r1();
  confere('SERVIDOR · liberada uma vaga, entra a próxima', typeof g.enter('mastodon.social', T0) === 'function');
  r1(); r1();
  const solta1 = g.inspect('mastodon.social', T0).inflight;
  confere('SERVIDOR · liberar duas vezes a mesma vaga NÃO libera a vaga do vizinho (idempotente)', solta1 === 2, `em andamento: ${solta1}, esperava 2`);
  confere('SERVIDOR · maiúsculas e espaços são o mesmo servidor', g.enter('  Mastodon.Social ', T0) === null);
  confere('SERVIDOR · servidor vazio não ganha vaga', g.enter('', T0) === null && g.enter('   ', T0) === null);

  const ritmo = createDomainGate({ maxConcurrent: 10, perWindow: 3, windowMs: 1000 });
  for (let i = 0; i < 3; i++) ritmo.enter('x.example', T0 + i)();
  confere('SERVIDOR · ritmo: 3 por janela e a quarta espera', ritmo.enter('x.example', T0 + 500) === null);
  confere('SERVIDOR · ...passada a janela, volta', typeof ritmo.enter('x.example', T0 + 1003) === 'function');

  const calma = createDomainGate();
  calma.cooldown('lento.example', T0 + 20_000);
  confere('SERVIDOR · pediu calma: nenhuma vaga até o prazo', calma.enter('lento.example', T0 + 19_999) === null);
  confere('SERVIDOR · ...passado o prazo, volta', typeof calma.enter('lento.example', T0 + 20_000) === 'function');
  confere('SERVIDOR · a calma de um não atinge o outro', typeof calma.enter('outro.example', T0) === 'function');
  calma.cooldown('lento.example', T0 + 90_000);
  calma.cooldown('lento.example', T0 + 30_000);
  confere('SERVIDOR · um segundo pedido de calma MENOR não encurta o primeiro', calma.enter('lento.example', T0 + 60_000) === null);

  const memoria = createDomainGate({ maxConcurrent: 2, maxDomains: 5, perWindow: 20 });
  const seguro = memoria.enter('segura.example', T0);
  for (let i = 0; i < 40; i++) memoria.enter(`d${i}.example`, T0 + i)?.();
  confere('SERVIDOR · memória limitada: 40 servidores diferentes não deixam mais de 5 rastreados', memoria.tracked <= 5, `rastreados: ${memoria.tracked}`);
  confere('SERVIDOR · ...e a busca em andamento não perde a vaga na poda', memoria.inspect('segura.example', T0 + 50).inflight === 1);
  seguro();
}

// Modelo aleatório: o freio nunca passa dos limites e nunca recusa sem motivo.
{
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  let violou = '';
  let recusasSemMotivo = 0;
  let aceitas = 0;
  for (let rodada = 0; rodada < 400 && !violou; rodada++) {
    const MAXC = 2, POR = 5, JAN = 1000;
    const g = createDomainGate({ maxConcurrent: MAXC, perWindow: POR, windowMs: JAN });
    let agora = T0;
    const seguras = [];
    const carimbos = [];
    for (let passo = 0; passo < 60; passo++) {
      agora += Math.floor(rnd() * 400);
      const acao = rnd();
      if (acao < 0.55) {
        const antes = { emAndamento: seguras.length, naJanela: carimbos.filter((t) => agora - t < JAN).length };
        const lib = g.enter('a.example', agora);
        if (lib) {
          seguras.push(lib);
          carimbos.push(agora);
          aceitas++;
          if (seguras.length > MAXC) violou = `rodada ${rodada}: ${seguras.length} em andamento (teto ${MAXC})`;
          if (carimbos.filter((t) => agora - t < JAN).length > POR) violou = `rodada ${rodada}: mais de ${POR} na janela`;
        } else if (antes.emAndamento < MAXC && antes.naJanela < POR) {
          recusasSemMotivo++;
        }
      } else if (seguras.length > 0) {
        const i = Math.floor(rnd() * seguras.length);
        const [lib] = seguras.splice(i, 1);
        lib();
        if (rnd() < 0.3) lib(); // liberar de novo não pode abrir vaga extra
      }
    }
  }
  confere(`SERVIDOR · modelo aleatório (400 rodadas, ${aceitas} aceitas): nunca passa do teto nem da janela`, violou === '', violou);
  confere('SERVIDOR · modelo aleatório: nunca recusa havendo vaga', recusasSemMotivo === 0, `${recusasSemMotivo} recusas sem motivo`);
}

// ───────────────────────── 6. concorrência limitada ─────────────────────────
{
  let emAndamento = 0;
  let pico = 0;
  const feitos = [];
  const trabalho = async (item, indice) => {
    emAndamento++;
    pico = Math.max(pico, emAndamento);
    for (let i = 0; i < (item % 3) + 1; i++) await new Promise((r) => setImmediate(r));
    emAndamento--;
    feitos.push(indice);
    return item * 2;
  };
  const itens = Array.from({ length: 20 }, (_, i) => i);
  const res = await mapWithLimit(itens, 4, trabalho);
  igual('CONCORRÊNCIA · resultados NA ORDEM dos itens', res, itens.map((n) => n * 2));
  confere('CONCORRÊNCIA · no máximo 4 ao mesmo tempo', pico <= 4 && pico >= 2, `pico ${pico}`);
  igual('CONCORRÊNCIA · cada item roda uma vez só', [...feitos].sort((a, b) => a - b), itens);
  igual('CONCORRÊNCIA · lista vazia', await mapWithLimit([], 4, trabalho), []);
  for (const limite of [0, -3, Number.NaN]) {
    pico = 0;
    await mapWithLimit([1, 2, 3, 4], limite, trabalho);
    confere(`CONCORRÊNCIA · limite ${limite} vira 1 (nunca trava nem vira ilimitado)`, pico === 1, `pico ${pico}`);
  }
  pico = 0;
  await mapWithLimit([1, 2], 50, trabalho);
  confere('CONCORRÊNCIA · limite maior que a lista: só o necessário', pico === 2, `pico ${pico}`);
}

// ───────────────────────── 7. orquestrador ─────────────────────────
function cenario(sobre = {}) {
  const log = { read: [], locate: [], fetch: [], apply: [], warn: [] };
  let t = T0;
  const posts = new Map([
    [id(1), { host: 'mastodon.social' }],
    [id(2), { host: 'mastodon.social' }],
    [id(3), { host: 'mastodon.social' }],
    [id(4), { host: 'mastodon.social' }],
    [id(5), { host: 'outra.casa' }],
    [id(6), { host: null }],
    [id(7), { host: 'mastodon.social', checkedAt: T0 - 60_000 }],
    [id(8), { host: 'mastodon.social', checkedAt: T0 - 10 * 60_000 }],
  ]);
  const gate = createDomainGate(sobre.gate);
  const memo = createSyncMemo();
  const deps = {
    now: () => t,
    readPost: async (pid) => { log.read.push(pid); if (sobre.leitura) return sobre.leitura(pid); return posts.get(pid) ?? null; },
    hostOf: (p) => p.host,
    checkedAtMsOf: (p) => p.checkedAt,
    locate: async (p) => { log.locate.push(p.host); return sobre.locate ? sobre.locate(p) : { domain: p.host, statusId: '1234' }; },
    fetchStatus: async (loc) => { log.fetch.push(loc.domain); return sobre.busca ? sobre.busca(loc) : { kind: 'ok', origin: { likes: 5, reposts: 1, commentsCount: 2 } }; },
    apply: async (pid, origem, lidoEm) => { log.apply.push({ pid, origem, lidoEm }); return sobre.grava ? sobre.grava(pid) : 'updated'; },
    gate,
    memo,
    warn: (m) => log.warn.push(m),
  };
  return { sync: createCountSyncer(deps), log, gate, memo, avanca: (ms) => { t += ms; }, posts };
}
const MIN = 60_000;

{
  const c = cenario();
  igual('SYNC · caminho feliz: grava e diz que atualizou', await c.sync(id(1)), 'updated');
  igual('SYNC · gravou com o que a origem informou e a hora da leitura', c.log.apply, [{ pid: id(1), origem: { likes: 5, reposts: 1, commentsCount: 2 }, lidoEm: T0 }]);
  igual('SYNC · de novo logo depois: de molho, SEM nova busca', [await c.sync(id(1)), c.log.fetch.length], ['fresh', 1]);
  c.avanca(SYNC_TTL_MS - 1);
  igual('SYNC · 1 ms antes dos 3 min: ainda de molho', await c.sync(id(1)), 'fresh');
  c.avanca(2);
  igual('SYNC · passados os 3 min: busca de novo', [await c.sync(id(1)), c.log.fetch.length], ['updated', 2]);
  igual('SYNC · a vaga do servidor foi devolvida', c.gate.inspect('mastodon.social', T0).inflight, 0);
}
{
  const c = cenario();
  for (const ruim of ['', 'abc', 'post_123456', 'ap_x', '../ap_123456', null, undefined, 42]) igual(`SYNC · id inválido ${JSON.stringify(ruim) ?? 'undefined'}: recusado sem tocar em nada`, await c.sync(ruim), 'invalid');
  igual('SYNC · nenhum id inválido chegou ao banco nem à rede', [c.log.read.length, c.log.fetch.length], [0, 0]);
}
{
  const c = cenario();
  igual('SYNC · post que não existe', await c.sync(id(99)), 'missing');
  igual('SYNC · ...e não se pergunta de novo por 30 min (nem ao banco)', [await c.sync(id(99)), c.log.read.length], ['fresh', 1]);
  c.avanca(SYNC_NEGATIVE_MS + 1);
  igual('SYNC · ...passados os 30 min, pergunta de novo', [await c.sync(id(99)), c.log.read.length], ['missing', 2]);
}
{
  const c = cenario();
  igual('SYNC · conferido há 1 min (gravado no documento, vale entre instâncias): não busca', [await c.sync(id(7)), c.log.fetch.length, c.log.locate.length], ['fresh', 0, 0]);
  igual('SYNC · conferido há 10 min: busca', [await c.sync(id(8)), c.log.fetch.length], ['updated', 1]);
  const buscasAntes = c.log.locate.length;
  igual('SYNC · sem servidor de origem no documento: indisponível, sem rede', [await c.sync(id(6)), c.log.locate.length - buscasAntes], ['unavailable', 0]);
  igual('SYNC · ...e 30 min de molho (nem o banco é consultado de novo)', [await c.sync(id(6)), c.log.read.length], ['fresh', 3]);
}
{
  const c = cenario({ locate: () => null });
  igual('SYNC · endereço do status não resolvido: indisponível, SEM busca', [await c.sync(id(1)), c.log.fetch.length], ['unavailable', 0]);
  igual('SYNC · ...e a vaga volta', c.gate.inspect('mastodon.social', T0).inflight, 0);
}
{
  const c = cenario({ busca: () => ({ kind: 'rate-limited', status: 429, retryAfter: '30' }) });
  igual('429 · o servidor pediu calma: throttled', await c.sync(id(1)), 'throttled');
  igual('429 · avisa no registro, com o servidor', [c.log.warn.length, c.log.warn[0]?.includes('mastodon.social')], [1, true]);
  const buscasAntes = c.log.fetch.length;
  igual('429 · outro post do MESMO servidor: nem tenta (sem endereço, sem busca)', [await c.sync(id(2)), c.log.fetch.length - buscasAntes, c.log.locate.length], ['throttled', 0, 1]);
  igual('429 · servidor DIFERENTE segue normal', await c.sync(id(5)), 'throttled'); // a busca é a mesma de mentira (429); o que importa é que TENTOU
  confere('429 · ...tentou mesmo (outro servidor, outra vaga)', c.log.fetch.at(-1) === 'outra.casa');
  c.avanca(31_000);
  const antes = c.log.fetch.length;
  await c.sync(id(3));
  confere('429 · passado o Retry-After, o servidor volta a ser consultado', c.log.fetch.length === antes + 1);
}
{
  const c = cenario({ busca: () => ({ kind: 'gone', status: 404 }) });
  igual('404/410 · saiu de lá: indisponível', await c.sync(id(1)), 'unavailable');
  c.avanca(29 * MIN);
  igual('404/410 · 29 min depois: ainda de molho (não insiste)', [await c.sync(id(1)), c.log.fetch.length], ['fresh', 1]);
  c.avanca(2 * MIN);
  igual('404/410 · 31 min depois: tenta de novo', [await c.sync(id(1)), c.log.fetch.length], ['unavailable', 2]);
}
{
  const c = cenario({ busca: () => ({ kind: 'error', status: 502 }) });
  igual('ERRO · falha passageira: indisponível', await c.sync(id(1)), 'unavailable');
  c.avanca(SYNC_RETRY_MS - 1000);
  igual('ERRO · 59 s depois: ainda de molho', [await c.sync(id(1)), c.log.fetch.length], ['fresh', 1]);
  c.avanca(2000);
  igual('ERRO · 61 s depois: tenta de novo', [await c.sync(id(1)), c.log.fetch.length], ['unavailable', 2]);
}
{
  const c = cenario({ grava: () => 'unchanged' });
  igual('GRAVAÇÃO · a origem concorda com o que temos: unchanged', await c.sync(id(1)), 'unchanged');
  igual('GRAVAÇÃO · ...e fica de molho do mesmo jeito (não busca de novo por 3 min)', [await c.sync(id(1)), c.log.fetch.length], ['fresh', 1]);
  const m = cenario({ grava: () => 'missing' });
  igual('GRAVAÇÃO · o post sumiu no meio do caminho: missing', await m.sync(id(1)), 'missing');
}
{
  const c = cenario({ leitura: () => { throw new Error('banco fora do ar'); } });
  igual('FALHA · o banco lançou: indisponível, não lança para fora', await c.sync(id(1)), 'unavailable');
  igual('FALHA · ...e registra', [c.log.warn.length, c.log.warn[0]?.includes('banco fora do ar')], [1, true]);
  c.avanca(SYNC_RETRY_MS + 1);
  const lei = { n: 0 };
  const d = cenario({ grava: () => { lei.n++; throw new Error('transação abortada'); } });
  igual('FALHA · a gravação lançou DEPOIS de pegar a vaga: indisponível', await d.sync(id(1)), 'unavailable');
  igual('FALHA · ...e a vaga do servidor foi devolvida mesmo assim (finally)', d.gate.inspect('mastodon.social', T0).inflight, 0);
  const e = cenario({ locate: () => { throw new Error('rede'); } });
  await e.sync(id(1));
  igual('FALHA · lançar ao resolver o endereço também devolve a vaga', e.gate.inspect('mastodon.social', T0).inflight, 0);
}
{
  // Duas chamadas ao mesmo tempo para o mesmo post (duas abas, dois cartões): uma busca só.
  let liberar;
  const trava = new Promise((r) => { liberar = r; });
  const c = cenario({ busca: async () => { await trava; return { kind: 'ok', origin: { likes: 1 } }; } });
  const a = c.sync(id(1));
  const b = c.sync(id(1));
  await solta();
  liberar();
  igual('SIMULTÂNEAS · duas chamadas ao mesmo post: uma atualiza, a outra vê "de molho"', [await a, await b].sort(), ['fresh', 'updated']);
  igual('SIMULTÂNEAS · ...e foi UMA busca só', c.log.fetch.length, 1);
}
{
  // Vaga por servidor: com 2 vagas, o terceiro post do mesmo servidor espera; e pode tentar de novo quando houver vaga.
  const travas = [];
  const c = cenario({
    gate: { maxConcurrent: 2, perWindow: 100 },
    busca: () => new Promise((resolve) => travas.push(() => resolve({ kind: 'ok', origin: { likes: 1 } }))),
  });
  const p1 = c.sync(id(1));
  const p2 = c.sync(id(2));
  await solta();
  igual('VAGAS · duas buscas em andamento ao mesmo servidor', c.log.fetch.length, 2);
  igual('VAGAS · o terceiro post do MESMO servidor é segurado, sem busca', [await c.sync(id(3)), c.log.fetch.length], ['throttled', 2]);
  const p5 = c.sync(id(5));
  await solta();
  confere('VAGAS · um servidor diferente não é afetado', c.log.fetch.length === 3 && c.log.fetch[2] === 'outra.casa');
  travas.forEach((liberar) => liberar());
  await Promise.all([p1, p2, p5]);
  const p3 = c.sync(id(3));
  await solta();
  travas.at(-1)();
  igual('VAGAS · liberadas as vagas, o terceiro post (que não ficou marcado) busca', [await p3, c.log.fetch.length], ['updated', 4]);
}
{
  const c = cenario({ gate: { maxConcurrent: 5, perWindow: 3 } });
  const r = [];
  for (const n of [1, 2, 3, 4]) r.push(await c.sync(id(n)));
  igual('RITMO · 3 buscas por minuto por servidor; a quarta é segurada', r, ['updated', 'updated', 'updated', 'throttled']);
  c.avanca(61_000);
  igual('RITMO · um minuto depois, a quarta passa', await c.sync(id(4)), 'updated');
}

// ───────────────────────── 8. fila do navegador ─────────────────────────
function relogioFalso() {
  let t = T0;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => { const h = ++seq; timers.set(h, { at: t + ms, fn }); return h; },
    clearTimer: (h) => { timers.delete(h); },
    async avanca(ms) {
      const fim = t + ms;
      for (;;) {
        const devido = [...timers.entries()].filter(([, v]) => v.at <= fim).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!devido) break;
        timers.delete(devido[0]);
        t = Math.max(t, devido[1].at);
        devido[1].fn();
        await solta();
      }
      t = fim;
      await solta();
    },
    get ativos() { return timers.size; },
  };
}
function fila(opcoes = {}, resposta = () => Promise.resolve({ ok: true, status: 200 })) {
  const r = relogioFalso();
  const envios = [];
  const estado = { escondida: false, resposta };
  const q = createRemoteCountSyncQueue(
    { send: (ids) => { envios.push(ids); return estado.resposta(ids); }, now: r.now, setTimer: r.setTimer, clearTimer: r.clearTimer, isHidden: () => estado.escondida },
    opcoes,
  );
  return { q, r, envios, estado };
}

{
  const f = fila();
  for (let i = 1; i <= 5; i++) f.q.schedule(id(i));
  igual('FILA · nada sai antes da espera curta de junção', f.envios.length, 0);
  await f.r.avanca(199);
  igual('FILA · 199 ms: ainda juntando', f.envios.length, 0);
  await f.r.avanca(2);
  igual('FILA · cinco cartões viram UMA requisição, na ordem', f.envios, [[id(1), id(2), id(3), id(4), id(5)]]);
  igual('FILA · não sobra nada pendente nem temporizador armado', [f.q.pending, f.r.ativos], [0, 0]);
}
{
  const f = fila();
  for (const ruim of [null, undefined, '', 'abc', 'post_123456', 'ap_x']) confere(`FILA · ${JSON.stringify(ruim) ?? 'undefined'} não entra`, f.q.schedule(ruim) === false);
  igual('FILA · nada pendente', f.q.pending, 0);
}
{
  const f = fila();
  confere('FILA · primeira vez entra', f.q.schedule(id(1)) === true);
  await f.r.avanca(300);
  await f.r.avanca(30_000);
  confere('FILA · 30 s depois: ainda em cooldown (60 s por post, por aba)', f.q.schedule(id(1)) === false);
  await f.r.avanca(30_001);
  confere('FILA · 60 s depois: pode de novo', f.q.schedule(id(1)) === true);
  confere('FILA · o mesmo post duas vezes antes de enviar: entra uma só', f.q.schedule(id(1)) === false && f.q.pending === 1);
}
{
  const f = fila();
  for (let i = 1; i <= 40; i++) f.q.schedule(id(i));
  await f.r.avanca(5000);
  igual('FILA · 40 cartões: 3 requisições de 15, 15 e 10', f.envios.map((e) => e.length), [15, 15, 10]);
  igual('FILA · todos enviados, sem repetir', f.envios.flat().length === 40 && new Set(f.envios.flat()).size === 40, true);
}
{
  const f = fila();
  f.estado.escondida = true;
  confere('ABA ESCONDIDA · não entra na fila', f.q.schedule(id(1)) === false && f.q.pending === 0);
  f.estado.escondida = false;
  f.q.schedule(id(1));
  f.q.schedule(id(2));
  f.estado.escondida = true;
  await f.r.avanca(300);
  igual('ABA ESCONDIDA · ficou escondida antes de enviar: descarta, nada sai', [f.envios.length, f.q.pending], [0, 0]);
  f.estado.escondida = false;
  confere('ABA ESCONDIDA · ao voltar, os posts podem ser pedidos SEM esperar o cooldown (nunca foram enviados)', f.q.schedule(id(1)) === true && f.q.schedule(id(2)) === true);
}
{
  const f = fila({}, () => Promise.resolve({ ok: false, status: 429, retryAfterSeconds: 20 }));
  f.q.schedule(id(1));
  await f.r.avanca(300);
  igual('429 · foi enviado uma vez', f.envios.length, 1);
  confere('429 · fila CALADA pelo prazo do servidor (20 s): ninguém entra', f.q.schedule(id(2)) === false);
  await f.r.avanca(20_001);
  confere('429 · passado o prazo, volta a aceitar', f.q.schedule(id(2)) === true);
  confere('429 · e o post do lote recusado pode ser pedido de novo (não ficou "feito" sem ter sido), mesmo dentro dos 60 s', f.q.schedule(id(1)) === true);
}
{
  const f = fila({}, () => Promise.resolve({ ok: false, status: 429 }));
  f.q.schedule(id(1));
  await f.r.avanca(300);
  confere('429 · sem Retry-After: cala por 30 s', f.q.schedule(id(2)) === false);
  await f.r.avanca(30_001);
  confere('429 · ...e volta depois de 30 s', f.q.schedule(id(2)) === true);
}
{
  const f = fila({}, () => Promise.reject(new Error('sem rede')));
  f.q.schedule(id(1));
  await f.r.avanca(300);
  confere('REDE FORA · fila calada por 15 s, sem estourar erro', f.q.schedule(id(2)) === false);
  await f.r.avanca(15_001);
  confere('REDE FORA · passados 15 s volta, e o post pode ser pedido de novo', f.q.schedule(id(1)) === true);
}
{
  const f = fila({}, () => Promise.resolve({ ok: false, status: 500 }));
  f.q.schedule(id(1));
  await f.r.avanca(300);
  confere('500 · também cala por 15 s', f.q.schedule(id(2)) === false);
  const g = fila({}, () => Promise.resolve({ ok: false, status: 400 }));
  g.q.schedule(id(1));
  await g.r.avanca(300);
  confere('400 · erro NOSSO no pedido não cala a fila (repetir não ajuda, mas calar também não)', g.q.schedule(id(2)) === true);
}
{
  // Posts na fila quando o 429 chega: esperam o prazo e saem depois.
  let primeira = true;
  const f = fila({ batchSize: 2 }, () => {
    if (primeira) { primeira = false; return Promise.resolve({ ok: false, status: 429, retryAfterSeconds: 10 }); }
    return Promise.resolve({ ok: true, status: 200 });
  });
  for (let i = 1; i <= 6; i++) f.q.schedule(id(i));
  await f.r.avanca(5000);
  igual('429 NO MEIO · só o primeiro lote saiu; o resto espera o prazo', f.envios.length, 1);
  await f.r.avanca(11_000);
  igual('429 NO MEIO · passado o prazo, o que estava na fila sai (lotes de 2)', f.envios.slice(1).map((e) => e.length), [2, 2]);
}
{
  const f = fila({ maxTracked: 3 });
  for (let i = 1; i <= 5; i++) f.q.schedule(id(i));
  igual('FILA · memória de cooldown com teto (3)', f.q.tracked, 3);
  confere('FILA · o mais antigo foi esquecido (pode de novo)', f.q.schedule(id(1)) === true);
  const g = fila();
  g.q.schedule(id(1)); g.q.schedule(id(2));
  g.q.dispose();
  igual('FILA · dispose: limpa tudo e desarma o temporizador', [g.q.pending, g.q.tracked, g.r.ativos], [0, 0, 0]);
  confere('FILA · depois do dispose nada entra', g.q.schedule(id(3)) === false);
  await g.r.avanca(1000);
  igual('FILA · ...e nada sai', g.envios.length, 0);
}

console.log(`\n${total - falhas}/${total} verificações passaram.`);
if (falhas > 0) {
  console.log(`${falhas} FALHA(S).`);
  process.exit(1);
}
