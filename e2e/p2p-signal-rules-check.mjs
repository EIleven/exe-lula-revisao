#!/usr/bin/env node
/**
 * Regras do Realtime Database para a SINALIZAÇÃO do canal P2P (`p2pSignals`), contra os emuladores de Auth e Database:
 *   npm run emulators            (em outro terminal; ou: firebase emulators:start --only auth,database)
 *   node e2e/p2p-signal-rules-check.mjs        (ou: npm run e2e:p2p-regras)
 *
 * O que as regras antigas deixavam: qualquer pessoa logada gravava, na própria posição, QUALQUER coisa (até 16 MB por
 * escrita, em quantas conversas quisesse) e ninguém validava nem o remetente declarado, nem o tipo, nem o carimbo de tempo.
 * O que se prova aqui:
 *   - só os dois participantes leem a conversa, e cada um só escreve na PRÓPRIA posição;
 *   - o id da conversa tem o formato `<uid>_<uid>` (nada de caminho solto);
 *   - cada sinal tem formato, tipo, tamanho e carimbo válidos, e o `from` declarado é o dono da posição;
 *   - apagar o que é seu continua permitido (é como a sinalização é limpa);
 *   - o que o app ANTIGO escreve (carimbo do relógio do aparelho) continua passando durante a transição;
 *   - a presença (`status`) não mudou.
 * Só toca os emuladores (127.0.0.1). Sai com código 1 se algo falhar, 2 se os emuladores não estiverem no ar.
 */
const NS = 'demo-soberan-default-rtdb';
const DB = `http://127.0.0.1:9000`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key';

let falhas = 0;
let total = 0;
const confere = (nome, condicao, motivo, detalhe) => {
  total++;
  if (condicao) console.log(`OK    ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo}`); }
};

async function criarConta(rotulo) {
  const r = await fetch(AUTH, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${rotulo}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@teste.invalid`, password: 'senha-de-teste-123', returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.localId) throw new Error(`signUp falhou: ${JSON.stringify(j)}`);
  return { uid: j.localId, token: j.idToken };
}

const url = (caminho, token) => `${DB}${caminho}.json?ns=${NS}${token ? `&auth=${encodeURIComponent(token)}` : ''}`;
const ADMIN = { Authorization: 'Bearer owner' }; // aceito SOMENTE pelos emuladores
const pedir = async (metodo, caminho, token, corpo) => {
  const r = await fetch(url(caminho, token), { method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  return { status: r.status, ok: r.ok };
};
const permitido = (r) => r.ok;
const negado = (r) => r.status === 401 || r.status === 403;

try {
  await fetch(`${DB}/.json?ns=${NS}`, { headers: ADMIN });
} catch {
  console.error('Os emuladores não estão no ar (Database em 127.0.0.1:9000, Auth em 9099). Suba com `npm run emulators` e rode de novo.');
  process.exit(2);
}

const a = await criarConta('alice');
const b = await criarConta('bob');
const c = await criarConta('carol');
const conv = [a.uid, b.uid].sort().join('_');
const minha = (conta) => `/p2pSignals/${conv}/${conta.uid}`;
const sv = { '.sv': 'timestamp' };
const oferta = (de, extra = {}) => ({ from: de.uid, sessionId: 'sessao-abc123', type: 'offer', ts: sv, sdp: { type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' }, ...extra });
const ice = (de, extra = {}) => ({ from: de.uid, sessionId: 'sessao-abc123', type: 'ice', ts: sv, candidate: { candidate: 'candidate:1 1 udp 2122 10.0.0.1 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 }, ...extra });

// ───────────── leitura e escrita por participante ─────────────
confere('REGRAS · a pessoa escreve um sinal válido (oferta) na PRÓPRIA posição', permitido(await pedir('PUT', `${minha(a)}/s1`, a.token, oferta(a))), 'recusou sinal válido');
confere('REGRAS · ...e um candidato ICE e um hello', permitido(await pedir('PUT', `${minha(a)}/s2`, a.token, ice(a))) && permitido(await pedir('PUT', `${minha(a)}/s3`, a.token, { from: a.uid, sessionId: 'sessao-xyz987', type: 'hello', ts: sv })), 'recusou');
confere('REGRAS · o outro participante lê a posição do contato, e o autor lê a sua', permitido(await pedir('GET', minha(a), b.token)) && permitido(await pedir('GET', minha(a), a.token)), 'leitura negada');
confere('REGRAS · um TERCEIRO não lê a conversa dos dois (os sinais trazem endereços de rede)', negado(await pedir('GET', `/p2pSignals/${conv}`, c.token)) && negado(await pedir('GET', minha(a), c.token)), 'terceiro leu');
confere('REGRAS · sem login, nada se lê nem se escreve', negado(await pedir('GET', minha(a))) && negado(await pedir('PUT', `${minha(a)}/x`, undefined, oferta(a))), 'anônimo passou');
confere('REGRAS · ninguém escreve na posição do outro (nem o contato, nem um terceiro)', negado(await pedir('PUT', `${minha(a)}/forjado`, b.token, oferta(b))) && negado(await pedir('PUT', `${minha(a)}/forjado`, c.token, oferta(a))), 'escreveu na posição alheia');
confere('REGRAS · o terceiro não cria posição numa conversa que não é dele', negado(await pedir('PUT', `/p2pSignals/${conv}/${c.uid}/s1`, c.token, oferta(c))), 'terceiro escreveu na conversa dos outros');

// ───────────── formato do id da conversa ─────────────
const solta = `${a.uid}_x`;
confere('REGRAS · id de conversa fora do formato `<uid>_<uid>` é recusado, mesmo começando pelo próprio uid', negado(await pedir('PUT', `/p2pSignals/${solta}/${a.uid}/s1`, a.token, oferta(a))) && negado(await pedir('PUT', `/p2pSignals/${a.uid}/${a.uid}/s1`, a.token, oferta(a))), 'aceitou conversa mal formada');
const comOutro = [a.uid, c.uid].sort().join('_');
confere('REGRAS · a pessoa abre sinalização com qualquer UID bem formado (o app decide o contato; o teto de tamanho limita o abuso)', permitido(await pedir('PUT', `/p2pSignals/${comOutro}/${a.uid}/s1`, a.token, oferta(a))), 'recusou conversa bem formada');
await fetch(url(`/p2pSignals/${comOutro}`), { method: 'DELETE', headers: ADMIN });

// ───────────── o conteúdo do sinal ─────────────
let tentativa = 0;
const tenta = async (nome, valor, esperado = 'negado') => {
  // O texto do teste não pode virar chave do banco (ponto, colchete, cifrão e barra são proibidos em chaves): usa um número.
  const chave = `t${String(++tentativa).padStart(2, '0')}`;
  const r = await pedir('PUT', `${minha(a)}/${chave}`, a.token, valor);
  confere(`REGRAS · ${nome}`, esperado === 'negado' ? negado(r) : permitido(r), `status ${r.status}`);
  await fetch(url(`${minha(a)}/${chave}`), { method: 'DELETE', headers: ADMIN });
};
await tenta('`from` declarado de OUTRA pessoa é recusado (ninguém assina como o outro)', oferta(a, { from: b.uid }));
await tenta('tipo desconhecido é recusado', oferta(a, { type: 'bye' }));
await tenta('campo extra no sinal é recusado', oferta(a, { html: '<img src=x onerror=alert(1)>' }));
await tenta('SDP acima de 16.000 caracteres é recusado', oferta(a, { sdp: { type: 'offer', sdp: 'x'.repeat(16_001) } }));
await tenta('SDP no limite (16.000) é aceito', oferta(a, { sdp: { type: 'offer', sdp: 'x'.repeat(16_000) } }), 'permitido');
await tenta('oferta cujo SDP diz ser "answer" é recusada (tipo e SDP precisam concordar)', oferta(a, { sdp: { type: 'answer', sdp: 'v=0' } }));
await tenta('oferta sem SDP é recusada', { from: a.uid, sessionId: 'sessao-abc123', type: 'offer', ts: sv });
await tenta('candidato ICE sem candidato é recusado', { from: a.uid, sessionId: 'sessao-abc123', type: 'ice', ts: sv });
await tenta('hello carregando SDP é recusado', { from: a.uid, sessionId: 'sessao-abc123', type: 'hello', ts: sv, sdp: { type: 'offer', sdp: 'v=0' } });
await tenta('candidato com texto acima de 1.024 caracteres é recusado', ice(a, { candidate: { candidate: 'c'.repeat(1_025), sdpMid: '0', sdpMLineIndex: 0 } }));
await tenta('candidato com índice de mídia absurdo é recusado', ice(a, { candidate: { candidate: 'candidate:1 1 udp 1 1.1.1.1 1 typ host', sdpMid: '0', sdpMLineIndex: 9_999 } }));
await tenta('sessionId fora do formato é recusado', oferta(a, { sessionId: 'tem espaço!' }));
await tenta('carimbo velho (10 min) é recusado', oferta(a, { ts: Date.now() - 10 * 60_000 }));
await tenta('carimbo do futuro (5 min) é recusado', oferta(a, { ts: Date.now() + 5 * 60_000 }));
await tenta('sinal escrito pelo app ANTIGO (carimbo do relógio do aparelho, sessionId com data) ainda passa durante a transição', {
  from: a.uid, sessionId: `${Date.now()}-ab12cd`, type: 'ice', ts: Date.now(),
  candidate: { candidate: 'candidate:1 1 udp 2122 10.0.0.1 5000 typ host', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'abcd' },
}, 'permitido');

// ───────────── limpeza ─────────────
// O RTDB não tem como contar filhos numa regra (não existe `numChildren`), então não há teto de QUANTIDADE por posição: cada
// sinal é limitado em formato e tamanho (acima), o cliente varre os próprios sinais velhos e usa onDisconnect, e a limpeza
// agendada é item do plano. O que as regras GARANTEM é que apagar o que é seu continua livre.
confere('REGRAS · apagar um sinal próprio é permitido (é como a sinalização é limpa)', permitido(await pedir('PUT', `${minha(a)}/n00`, a.token, ice(a))) && permitido(await pedir('DELETE', `${minha(a)}/n00`, a.token)), 'não deixou apagar');
confere('REGRAS · apagar tudo da própria posição é permitido; apagar a do contato não é', permitido(await pedir('DELETE', minha(a), a.token)) && negado(await pedir('DELETE', minha(b), a.token)), 'regra de remoção errada');

// ───────────── a presença continua igual ─────────────
confere('PRESENÇA · cada pessoa grava só o próprio `status`; qualquer logado lê', permitido(await pedir('PUT', `/status/${a.uid}/lastSeen`, a.token, sv)) && negado(await pedir('PUT', `/status/${b.uid}/lastSeen`, a.token, sv)) && permitido(await pedir('GET', `/status/${a.uid}`, c.token)), 'regra de presença mudou');

await fetch(url('/p2pSignals'), { method: 'DELETE', headers: ADMIN });
console.log('');
console.log(`${total} verificações.`);
if (falhas) { console.log(`${falhas} falha(s).`); process.exit(1); }
console.log('Regras do P2P OK: só os dois participantes, só na própria posição, sinais válidos e limitados, e apagar o que é seu segue livre.');
