#!/usr/bin/env node
/**
 * As regras da confirmação de leitura (src/lib/messages/recibos.ts):
 *   node e2e/recibos-check.mjs        (ou: npm run e2e:recibos)
 *
 * O que está em jogo: "fulano leu às 15:40" é prova de leitura, e numa rede política isso é material. O acordo é a
 * RECIPROCIDADE — quem desliga não envia a sua confirmação e não vê a dos outros. Uma falha aqui não aparece na tela:
 * a pessoa acha que desligou e continua entregando a própria leitura. Por isso cada lado desse acordo é provado.
 *
 * E a armadilha concreta: o botão "marcar todas como lidas" da lista zera N conversas de uma vez. Se o recibo pegasse
 * carona ali, você avisaria N pessoas que leu sem ter aberto nada. `conversaAberta` existe por causa disso.
 *
 * Sai com código 1 se algo falhar.
 */
import {
  INTERVALO_MINIMO_MS,
  chaveDaMarcaLocal,
  deveEnviarRecibo,
  foiLida,
  instanteDe,
  lerMarcaLocal,
  lidaAteDe,
  podeVerRecibos,
  precisaConfirmar,
  salvarMarcaLocal,
} from '../src/lib/messages/recibos.ts';
import { parseWireData, validateWireReceipt } from '../src/lib/p2p/p2pProtocol.ts';

let falhas = 0;
let total = 0;
const confere = (nome, condicao, motivo) => {
  total++;
  if (condicao) console.log(`OK    ${nome}`);
  else {
    falhas++;
    console.log(`FALHA ${nome} — ${motivo}`);
  }
};

/** Um localStorage de mentira. `quebrado` imita janela privada: tudo que toca nele lança. */
const criarArmazenamento = (inicial = {}, quebrado = false) => {
  const mapa = new Map(Object.entries(inicial));
  return {
    getItem(c) {
      if (quebrado) throw new Error('armazenamento bloqueado');
      return mapa.has(c) ? mapa.get(c) : null;
    },
    setItem(c, v) {
      if (quebrado) throw new Error('armazenamento bloqueado');
      mapa.set(c, v);
    },
    removeItem(c) {
      if (quebrado) throw new Error('armazenamento bloqueado');
      mapa.delete(c);
    },
  };
};

const UID = 'uid_breno';
const CONV = 'uid_breno_uid_rafa';
const T = (iso) => Date.parse(iso);
const AGORA = T('2026-11-18T20:00:00.000Z');

// ───────────────────────── Reciprocidade: o acordo ─────────────────────────
confere('ACORDO · ligado vê', podeVerRecibos(true) === true, 'não vê com o botão ligado');
confere('ACORDO · desligado NÃO vê', podeVerRecibos(false) === false, 'vê mesmo desligado');
confere(
  'ACORDO · só `true` liga (undefined/null/1/"sim" não ligam sozinhos)',
  [undefined, null, 1, 'sim', 0, ''].every((v) => podeVerRecibos(v) === false),
  'valor frouxo ligou o recibo',
);

const base = { ligado: true, conversaAberta: true, ehGrupo: false, ehComigo: false };
confere('ACORDO · conversa 1:1 aberta com o botão ligado: envia', deveEnviarRecibo(base) === true, 'não enviou');
confere(
  'ACORDO · desligou: NÃO envia (o outro lado deixa de saber que você leu)',
  deveEnviarRecibo({ ...base, ligado: false }) === false,
  'continuou entregando a leitura depois de desligar',
);
confere(
  'ACORDO · quem não envia também não vê (os dois lados pela mesma chave)',
  deveEnviarRecibo({ ...base, ligado: false }) === false && podeVerRecibos(false) === false,
  'o acordo quebrou de um lado só',
);

// ───────────────────────── A armadilha do "marcar todas como lidas" ─────────────────────────
confere(
  'LISTA · marcar todas como lidas NÃO dispara recibo',
  deveEnviarRecibo({ ...base, conversaAberta: false }) === false,
  'avisaria N pessoas que você leu sem ter aberto nada',
);
confere(
  'LISTA · nem com o botão ligado (abrir de verdade é o que confirma)',
  deveEnviarRecibo({ ligado: true, conversaAberta: false, ehGrupo: false, ehComigo: false }) === false,
  'o botão ligado passou por cima da conversa fechada',
);

// ───────────────────────── Fora de escopo nesta rodada ─────────────────────────
confere('ESCOPO · grupo não envia recibo', deveEnviarRecibo({ ...base, ehGrupo: true }) === false, 'enviou em grupo');
confere('ESCOPO · conversa comigo não envia', deveEnviarRecibo({ ...base, ehComigo: true }) === false, 'enviou para si');

// ───────────────────────── Ler o que o banco devolve ─────────────────────────
confere('INSTANTE · Timestamp do Firestore (toMillis)', instanteDe({ toMillis: () => AGORA }) === AGORA, 'não leu');
confere('INSTANTE · formato de cache ({seconds})', instanteDe({ seconds: AGORA / 1000 }) === AGORA, 'não leu');
confere('INSTANTE · formato do Admin SDK ({_seconds})', instanteDe({ _seconds: AGORA / 1000 }) === AGORA, 'não leu');
confere('INSTANTE · texto ISO', instanteDe('2026-11-18T20:00:00.000Z') === AGORA, 'não leu');
confere('INSTANTE · número em ms', instanteDe(AGORA) === AGORA, 'não leu');
confere(
  'INSTANTE · lixo vira null em vez de derrubar a tela',
  [null, undefined, '', 'ontem', {}, [], NaN, true, { toMillis: 'não é função' }].every((v) => instanteDe(v) === null),
  'aceitou lixo',
);
confere(
  'INSTANTE · toMillis que lança não derruba',
  instanteDe({ toMillis: () => { throw new Error('x'); } }) === null,
  'deixou o erro subir',
);
confere(
  'INSTANTE · data implausível (antes de 2020) não vira marca',
  instanteDe('1970-01-01T00:00:00.000Z') === null && instanteDe(0) === null,
  'relógio zerado virou "leu tudo"',
);

confere('MAPA · lê a marca da pessoa certa', lidaAteDe({ [UID]: AGORA }, UID) === AGORA, 'não leu');
confere('MAPA · pessoa sem marca é null', lidaAteDe({ outro: AGORA }, UID) === null, 'inventou marca');
confere(
  'MAPA · mapa ausente ou torto é null',
  [null, undefined, 'x', 42, []].every((m) => lidaAteDe(m, UID) === null),
  'aceitou mapa torto',
);
confere('MAPA · sem uid é null', lidaAteDe({ [UID]: AGORA }, null) === null, 'aceitou uid nulo');

// ───────────────────────── A marca cobre a mensagem? ─────────────────────────
const lidaAte = T('2026-11-18T20:00:00.000Z');
confere(
  'MARCA · mensagem anterior à marca está lida',
  foiLida({ criadaEm: '2026-11-18T19:59:59.000Z', lidaAte }) === true,
  'não marcou',
);
confere('MARCA · mensagem no instante exato está lida', foiLida({ criadaEm: lidaAte, lidaAte }) === true, 'não marcou');
confere(
  'MARCA · mensagem POSTERIOR à marca NÃO está lida',
  foiLida({ criadaEm: '2026-11-18T20:00:01.000Z', lidaAte }) === false,
  'disse que leu algo que a pessoa não viu',
);
confere(
  'MARCA · sem marca nenhuma, nada está lido',
  foiLida({ criadaEm: '2026-11-18T19:00:00.000Z', lidaAte: null }) === false,
  'marcou sem marca',
);
confere(
  'MARCA · data da mensagem ilegível não vira lida',
  foiLida({ criadaEm: 'qualquer coisa', lidaAte }) === false && foiLida({ criadaEm: null, lidaAte }) === false,
  'errou para o lado perigoso',
);
confere(
  'MARCA · sem folga de relógio (errar para menos atrasa; errar para mais mente)',
  foiLida({ criadaEm: lidaAte + 1, lidaAte }) === false,
  'deu folga e marcou mensagem não lida',
);

// ───────────────────────── Quando vale escrever ─────────────────────────
const conf = (extra) =>
  precisaConfirmar({ maiorRecebidaEm: AGORA, confirmadoAte: null, ultimaEscritaEm: null, agora: AGORA, ...extra });

confere('ESCRITA · primeira mensagem recebida: confirma', conf({}) === true, 'não confirmou');
confere(
  'ESCRITA · nada novo desde a última confirmação: não escreve',
  conf({ confirmadoAte: AGORA }) === false,
  'escreveu à toa',
);
confere(
  'ESCRITA · mensagem mais nova que a confirmação: confirma',
  conf({ confirmadoAte: AGORA - 1 }) === true,
  'não confirmou o que chegou depois',
);
confere('ESCRITA · sem nada recebido: não escreve', conf({ maiorRecebidaEm: null }) === false, 'escreveu sem motivo');
confere(
  'ESCRITA · rajada dentro do intervalo mínimo: segura',
  precisaConfirmar({
    maiorRecebidaEm: AGORA,
    confirmadoAte: AGORA - 10_000,
    ultimaEscritaEm: AGORA - 1_000,
    agora: AGORA,
  }) === false,
  '20 mensagens em rajada virariam 20 escritas no mesmo documento',
);
confere(
  'ESCRITA · passado o intervalo mínimo: escreve',
  precisaConfirmar({
    maiorRecebidaEm: AGORA,
    confirmadoAte: AGORA - 10_000,
    ultimaEscritaEm: AGORA - INTERVALO_MINIMO_MS,
    agora: AGORA,
  }) === true,
  'ficou preso',
);
confere(
  'ESCRITA · o intervalo mínimo é curto (segundos, não minutos)',
  INTERVALO_MINIMO_MS > 0 && INTERVALO_MINIMO_MS <= 15_000,
  `${INTERVALO_MINIMO_MS} ms`,
);
confere(
  'ESCRITA · relógio maluco (NaN) não vira escrita',
  precisaConfirmar({ maiorRecebidaEm: AGORA, confirmadoAte: null, ultimaEscritaEm: null, agora: Number.NaN }) === false,
  'decidiu com NaN',
);

// ───────────────────────── A marca do Zero DB (só neste aparelho) ─────────────────────────
confere('ZERO DB · a chave carrega conta e conversa', chaveDaMarcaLocal(UID, CONV).includes(UID) && chaveDaMarcaLocal(UID, CONV).includes(CONV), chaveDaMarcaLocal(UID, CONV));
{
  const arm = criarArmazenamento();
  confere('ZERO DB · sem marca guardada é null', lerMarcaLocal(arm, UID, CONV) === null, 'inventou marca');
  salvarMarcaLocal(arm, UID, CONV, AGORA);
  confere('ZERO DB · guarda e relê', lerMarcaLocal(arm, UID, CONV) === AGORA, String(lerMarcaLocal(arm, UID, CONV)));
  salvarMarcaLocal(arm, UID, CONV, AGORA - 60_000);
  confere(
    'ZERO DB · marca atrasada NÃO desmarca o que já estava lido',
    lerMarcaLocal(arm, UID, CONV) === AGORA,
    'retrocedeu e as mensagens voltaram a aparecer como não lidas',
  );
  salvarMarcaLocal(arm, UID, CONV, AGORA + 60_000);
  confere('ZERO DB · marca mais nova avança', lerMarcaLocal(arm, UID, CONV) === AGORA + 60_000, 'não avançou');
  confere('ZERO DB · a marca é por conversa', lerMarcaLocal(arm, UID, 'outra_conversa') === null, 'vazou entre conversas');
}
confere(
  'ZERO DB · janela privada (armazenamento que lança) não quebra',
  lerMarcaLocal(criarArmazenamento({}, true), UID, CONV) === null &&
    salvarMarcaLocal(criarArmazenamento({}, true), UID, CONV, AGORA) === null,
  'deixou o erro subir',
);
confere(
  'ZERO DB · lixo enviado pelo contato não vira marca',
  salvarMarcaLocal(criarArmazenamento(), UID, CONV, 'amanhã de manhã') === null,
  'aceitou lixo do outro lado',
);

// ───────────────────────── A confirmação pelo túnel (Zero DB) ─────────────────────────
// No Zero DB não existe documento no servidor: a marca atravessa o DataChannel. Tudo o que chega ali vem de OUTRA
// pessoa (ou de quem tomou o navegador dela), então a confirmação passa pelo mesmo rigor do resto do protocolo.
{
  const agora = T('2026-11-18T20:00:00.000Z');
  const ctx = { expectedSender: 'A1', now: agora };
  const recibo = (extra) => validateWireReceipt({ v: 1, kind: 'read', senderId: 'A1', upTo: new Date(agora).toISOString(), ...extra }, ctx);

  confere('TÚNEL · confirmação bem formada passa', recibo({}).ok === true, JSON.stringify(recibo({})));
  confere(
    'TÚNEL · devolve cópia limpa (campo desconhecido não atravessa)',
    (() => {
      const r = recibo({ text: 'oi', fileUrl: 'http://x', extra: 1 });
      return r.ok && Object.keys(r.receipt).sort().join(',') === 'kind,senderId,upTo,v';
    })(),
    'campo estranho passou junto',
  );
  confere(
    'TÚNEL · ninguém confirma no lugar de outra pessoa',
    recibo({ senderId: 'B2' }).reason === 'remetente',
    'aceitou confirmação assinada por terceiro',
  );
  confere(
    'TÚNEL · "li até o ano que vem" é recusado',
    recibo({ upTo: new Date(agora + 86_400_000).toISOString() }).reason === 'recibo',
    'um instante no futuro apagaria a diferença entre lida e não lida para sempre',
  );
  confere(
    'TÚNEL · data velha demais é recusada',
    recibo({ upTo: new Date(agora - 60 * 86_400_000).toISOString() }).reason === 'recibo',
    'aceitou marca de 60 dias atrás',
  );
  confere(
    'TÚNEL · upTo que não é data é recusado',
    [undefined, null, 42, {}, 'ontem', 'x'.repeat(50)].every((v) => recibo({ upTo: v }).ok === false),
    'aceitou lixo no lugar da data',
  );
  confere('TÚNEL · versão errada é recusada', recibo({ v: 2 }).reason === 'versao', 'aceitou outra versão');

  // Compatibilidade: é por isto que dá para acrescentar um tipo novo sem quebrar quem está com o app velho.
  const bruto = (o) => parseWireData(JSON.stringify(o), ctx);
  confere(
    'TÚNEL · o despacho entrega a confirmação',
    (() => { const r = bruto({ v: 1, kind: 'read', senderId: 'A1', upTo: new Date(agora).toISOString() }); return r.ok && r.message.kind === 'read'; })(),
    'não chegou como recibo',
  );
  confere(
    'TÚNEL · mensagem normal continua passando (sem regressão)',
    (() => { const r = bruto({ v: 1, kind: 'dm', id: 'p2p_1800000000000_abc123', senderId: 'A1', createdAt: new Date(agora).toISOString(), text: 'oi' }); return r.ok && r.message.kind === 'dm'; })(),
    'quebrou a mensagem comum',
  );
  confere(
    'TÚNEL · tipo desconhecido continua recusado (app velho ignora, não quebra)',
    bruto({ v: 1, kind: 'apagar-tudo', senderId: 'A1' }).reason === 'versao',
    'um tipo novo qualquer passaria',
  );
}

console.log('');
console.log(`${total} verificações.`);
if (falhas) {
  console.log(`${falhas} falha(s).`);
  process.exit(1);
}
console.log('Recibos OK: reciprocidade dos dois lados, a lista nunca confirma por você, e nada implausível vira "lida".');
