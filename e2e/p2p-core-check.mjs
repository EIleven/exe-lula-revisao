#!/usr/bin/env node
/**
 * O motor da sessão P2P e o protocolo do canal, sem navegador, sem Firebase e sem rede:
 *   node e2e/p2p-core-check.mjs        (ou: npm run e2e:p2p-core)
 *
 * Dois motores (src/lib/p2p/p2pSession.ts) conversam por um barramento de sinalização falso que se comporta como o Realtime
 * Database (cada lado escreve no próprio nó; quem escuta recebe o que já estava lá e o que chega depois) e por conexões
 * WebRTC falsas com relógio controlado. O que se prova aqui é o que o código antigo (um arquivo só, preso ao navegador)
 * não permitia testar:
 *   - a oferta sai ANTES dos candidatos ICE (os candidatos nascem durante setLocalDescription);
 *   - quem chega depois avisa (`hello`) e é atendido, em vez de ficar "conectando" para sempre;
 *   - só a aba visível atende; abrir outra aba do contato não derruba nada;
 *   - falha → tentativas com espera crescente → estado final com o MOTIVO (NAT restritivo ≠ contato sem resposta);
 *   - sinal forjado, velho, gigante ou de outra negociação não entra; mensagem do túnel passa por validação e limite de taxa;
 *   - destruir a sessão não deixa relógio, ouvinte nem sinal para trás.
 * Sai com código 1 se algo falhar.
 */
import {
  createRateLimiter, describeP2pState, parseSignal, parseWireData, plausibleCreatedAt, reconnectDelayMs, shouldAutoConnect,
  toIceServers, validateWireMessage, DEFAULT_STUN, MAX_SDP_CHARS, MAX_TEXT_CHARS, MAX_WIRE_CHARS, SIGNAL_MAX_AGE_MS,
} from '../src/lib/p2p/p2pProtocol.ts';
import { createP2pCore, DEFAULT_P2P_CONFIG } from '../src/lib/p2p/p2pSession.ts';

let falhas = 0;
let total = 0;
const confere = (nome, condicao, motivo, detalhe) => {
  total++;
  if (condicao) console.log(`OK    ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo}`); }
};

// ───────────── infraestrutura falsa ─────────────
const settle = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
  await new Promise((r) => setImmediate(r));
  for (let i = 0; i < 40; i++) await Promise.resolve();
};

class Clock {
  constructor() { this.t = 1_800_000_000_000; this.timers = []; this.seq = 0; }
  now() { return this.t; }
  setTimeout(fn, ms) { const h = ++this.seq; this.timers.push({ h, at: this.t + ms, fn }); return h; }
  clearTimeout(h) { this.timers = this.timers.filter((x) => x.h !== h); }
  pending() { return this.timers.length; }
  async advance(ms) {
    const alvo = this.t + ms;
    for (;;) {
      await settle();
      const devido = this.timers.filter((x) => x.at <= alvo).sort((a, b) => a.at - b.at || a.h - b.h)[0];
      if (!devido) break;
      this.timers = this.timers.filter((x) => x !== devido);
      this.t = Math.max(this.t, devido.at);
      devido.fn();
    }
    this.t = alvo;
    await settle();
  }
}

/** Como o RTDB: cada lado escreve no próprio nó; quem escuta recebe o que já estava lá e o que chegar depois. */
function criarBarramento(clock) {
  const nos = {};
  const ouvintes = {};
  const log = [];
  const limpezas = {};
  const garante = (id) => { nos[id] ??= []; ouvintes[id] ??= new Set(); limpezas[id] ??= 0; };
  return {
    log, nos, ouvintes, limpezas,
    transporte(eu, par) {
      garante(eu); garante(par);
      return {
        async send(sinal) {
          const env = { ...sinal, from: eu, ts: clock.now() };
          nos[eu].push(env);
          log.push({ de: eu, tipo: sinal.type, sessao: sinal.sessionId });
          for (const cb of [...ouvintes[eu]]) queueMicrotask(() => cb(structuredClone(env)));
        },
        listen(cb) {
          ouvintes[par].add(cb);
          for (const env of nos[par]) queueMicrotask(() => cb(structuredClone(env)));
          return () => ouvintes[par].delete(cb);
        },
        async clear() { nos[eu].length = 0; limpezas[eu]++; },
        serverNow: () => clock.now(),
      };
    },
    /** Entrega um valor cru ao que o lado `eu` escuta (como se o contato tivesse escrito aquilo). */
    injeta(eu, par, cru) { for (const cb of [...ouvintes[par]]) cb(cru); },
  };
}

let contadorPeer = 0;
class FakeChannel {
  constructor() { this.readyState = 'connecting'; this.onopen = this.onclose = this.onerror = this.onmessage = null; this.outro = null; this.enviadas = []; }
  send(data) {
    if (this.readyState !== 'open') throw new Error('canal fechado');
    this.enviadas.push(data);
    const outro = this.outro;
    queueMicrotask(() => outro?.onmessage?.({ data }));
  }
  close() { const ja = this.readyState === 'closed'; this.readyState = 'closed'; if (!ja) this.onclose?.(); }
}

class Rede {
  constructor(clock) { this.clock = clock; this.modo = 'direto'; this.porToken = new Map(); this.criados = []; this.atrasoConexao = 300; this.agendados = new WeakSet(); }
  criar(dono) { const p = new FakePeer(this, dono); this.criados.push(p); return p; }
  talvezConectar(p) {
    const q = p.remoto;
    if (!q || p.closed || q.closed) return;
    if (!p.remoteDescription || !q.remoteDescription || p.recebidos < 1 || q.recebidos < 1) return;
    const chave = p.isOfferer ? p : q;
    if (this.agendados.has(chave)) return;
    this.agendados.add(chave);
    if (this.modo === 'bloqueado') {
      this.clock.setTimeout(() => { for (const x of [p, q]) if (!x.closed) { x.connectionState = 'failed'; x.onconnectionstatechange?.(); } }, 2_000);
      return;
    }
    this.clock.setTimeout(() => this.conectar(p, q), this.atrasoConexao);
  }
  conectar(a, b) {
    const oferta = a.isOfferer ? a : b;
    const resposta = a.isOfferer ? b : a;
    if (oferta.closed || resposta.closed) return;
    for (const x of [a, b]) { x.connectionState = 'connected'; x.onconnectionstatechange?.(); }
    const canalResposta = new FakeChannel();
    resposta.canal = canalResposta;
    resposta.ondatachannel?.({ channel: canalResposta });
    oferta.canal.outro = canalResposta;
    canalResposta.outro = oferta.canal;
    for (const c of [oferta.canal, canalResposta]) { c.readyState = 'open'; c.onopen?.(); }
  }
  /** Cai a conexão (os dois lados vêem `disconnected`). */
  cair(p) { for (const x of [p, p.remoto]) if (x && !x.closed) { x.connectionState = 'disconnected'; x.onconnectionstatechange?.(); } }
  recuperar(p) { for (const x of [p, p.remoto]) if (x && !x.closed) { x.connectionState = 'connected'; x.onconnectionstatechange?.(); } }
}

class FakePeer {
  constructor(rede, dono) {
    this.rede = rede; this.dono = dono; this.token = `${dono}-${++contadorPeer}`;
    this.connectionState = 'new'; this.signalingState = 'stable'; this.remoteDescription = null;
    this.recebidos = 0; this.remoto = null; this.isOfferer = false; this.closed = false; this.canal = null;
    this.onicecandidate = this.onconnectionstatechange = this.ondatachannel = null;
  }
  createDataChannel() { this.isOfferer = true; this.canal = new FakeChannel(); return this.canal; }
  async createOffer() { this.rede.porToken.set(this.token, this); return { type: 'offer', sdp: `v=0 fake ${this.token}` }; }
  async createAnswer() { return { type: 'answer', sdp: `v=0 fake-answer ${this.remoto?.token}` }; }
  async setLocalDescription(d) {
    this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable';
    // Os candidatos nascem AQUI, antes de a promessa resolver: é o que o navegador faz e o que o código antigo não previa.
    for (const n of [1, 2]) this.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: `candidate:${n} 1 udp 2122 10.0.0.${n} 5000 typ host`, sdpMid: '0', sdpMLineIndex: 0 }) } });
  }
  async setRemoteDescription(d) {
    if (this.closed) throw new Error('fechada');
    this.remoteDescription = d;
    if (d.type === 'offer') {
      const oferta = this.rede.porToken.get(/fake (\S+)/.exec(d.sdp)[1]);
      this.remoto = oferta; if (oferta) oferta.remoto = this;
      this.signalingState = 'have-remote-offer';
    } else {
      this.signalingState = 'stable';
    }
    this.rede.talvezConectar(this);
  }
  async addIceCandidate() { this.recebidos++; this.rede.talvezConectar(this); }
  close() { this.closed = true; this.connectionState = 'closed'; }
}

const SESSOES = ['ses-aaaaaa', 'ses-bbbbbb', 'ses-cccccc', 'ses-dddddd', 'ses-eeeeee', 'ses-ffffff', 'ses-gggggg', 'ses-hhhhhh', 'ses-iiiiii', 'ses-jjjjjj', 'ses-kkkkkk', 'ses-llllll', 'ses-mmmmmm', 'ses-nnnnnn', 'ses-oooooo', 'ses-pppppp', 'ses-qqqqqq', 'ses-rrrrrr', 'ses-ssssss', 'ses-tttttt'];

/** Monta o par A1 (iniciador, id menor) e B1. `b` pode ser adiado para testar quem chega depois. */
function montarPar({ visivelB = () => true, config, criarB = true } = {}) {
  const clock = new Clock();
  const rede = new Rede(clock);
  const bus = criarBarramento(clock);
  const presenca = { A1: new Set(), B1: new Set() }; // quem observa a presença de X
  const online = { A1: false, B1: false };
  const defineOnline = (id, v) => { online[id] = v; for (const cb of [...presenca[id]]) cb(v); };
  const estados = { A1: [], B1: [] };
  const recebidas = { A1: [], B1: [] };
  const logs = { A1: [], B1: [] };
  let sid = 0;
  const criar = (eu, par, extra = {}) => createP2pCore({
    me: eu, peer: par,
    signaling: bus.transporte(eu, par),
    presence: { watch(cb) { presenca[par].add(cb); cb(online[par]); return () => presenca[par].delete(cb); } },
    createPeer: () => rede.criar(eu),
    timers: { setTimeout: (fn, ms) => clock.setTimeout(fn, ms), clearTimeout: (h) => clock.clearTimeout(h), now: () => clock.now() },
    newSessionId: () => SESSOES[sid++ % SESSOES.length] + sid,
    onState: (s, r) => estados[eu].push(r ? `${s}:${r}` : s),
    onMessage: (m) => recebidas[eu].push(m),
    random: () => 0.5,
    log: (ev, d) => logs[eu].push({ ev, ...d }),
    config,
    ...extra,
  });
  const a = criar('A1', 'B1');
  const b = criarB ? criar('B1', 'A1', { isVisible: visivelB }) : null;
  return { clock, rede, bus, a, b, criarB: () => criar('B1', 'A1', { isVisible: visivelB }), defineOnline, estados, recebidas, logs, online };
}

const msg = (id, texto, senderId = 'A1') => ({ v: 1, kind: 'dm', id, senderId, createdAt: new Date().toISOString(), text: texto });
const ultimo = (arr) => arr[arr.length - 1];

// ═════════════ 1. Protocolo (puro) ═════════════
{
  const agora = 1_800_000_000_000;
  const base = { from: 'A1', sessionId: 'ses-abcdef', ts: agora };
  const ok = (cru) => parseSignal(cru, { expectedFrom: 'A1', serverNow: agora });
  confere('PROTO · hello válido passa', ok({ ...base, type: 'hello' }).ok === true, 'recusou');
  confere('PROTO · oferta válida passa e a cópia é limpa (campo desconhecido não atravessa)',
    (() => { const r = ok({ ...base, type: 'offer', sdp: { type: 'offer', sdp: 'v=0\r\n', extra: 'x' }, intruso: 1 }); return r.ok && r.signal.sdp.extra === undefined && r.signal.intruso === undefined; })(), 'deixou passar campo extra');
  confere('PROTO · `from` diferente do dono da posição é recusado', ok({ ...base, from: 'B1', type: 'hello' }).reason === 'from', 'aceitou');
  confere('PROTO · sessionId fora do formato é recusado', ok({ ...base, sessionId: 'a b', type: 'hello' }).reason === 'session', 'aceitou');
  confere('PROTO · tipo desconhecido é recusado', ok({ ...base, type: 'bye' }).reason === 'type', 'aceitou');
  confere('PROTO · sinal velho (> 45 s) é recusado', ok({ ...base, ts: agora - SIGNAL_MAX_AGE_MS - 1, type: 'hello' }).reason === 'stale', 'aceitou');
  confere('PROTO · sinal do futuro (> 10 s) é recusado', ok({ ...base, ts: agora + 11_000, type: 'hello' }).reason === 'future', 'aceitou');
  confere('PROTO · SDP gigante é recusado', ok({ ...base, type: 'offer', sdp: { type: 'offer', sdp: 'x'.repeat(MAX_SDP_CHARS + 1) } }).reason === 'sdp', 'aceitou');
  confere('PROTO · SDP de outro tipo (answer numa oferta) é recusado', ok({ ...base, type: 'offer', sdp: { type: 'answer', sdp: 'v=0' } }).reason === 'sdp', 'aceitou');
  confere('PROTO · caractere de controle no SDP é recusado', ok({ ...base, type: 'offer', sdp: { type: 'offer', sdp: 'v=0\u0000' } }).reason === 'sdp', 'aceitou');
  confere('PROTO · candidato válido passa; candidato sem texto ou com índice absurdo é recusado',
    ok({ ...base, type: 'ice', candidate: { candidate: 'candidate:1 1 udp 1 1.1.1.1 1 typ host', sdpMid: '0', sdpMLineIndex: 0 } }).ok === true
      && ok({ ...base, type: 'ice', candidate: { sdpMid: '0' } }).reason === 'candidate'
      && ok({ ...base, type: 'ice', candidate: { candidate: 'x', sdpMLineIndex: 9999 } }).reason === 'candidate', 'aceitou lixo');
  confere('PROTO · objeto não-literal (array, null, protótipo estranho) é recusado',
    ['x', 1, null, [], Object.create({ from: 'A1' })].every((c) => !ok(c).ok), 'aceitou');

  const now = 1_800_000_000_000;
  const w = (extra) => validateWireMessage({ v: 1, kind: 'dm', id: 'p2p_1800000000000_abc123', senderId: 'A1', createdAt: new Date(now).toISOString(), text: 'oi', ...extra }, { expectedSender: 'A1', now });
  confere('PROTO · mensagem válida passa', w({}).ok === true, 'recusou');
  confere('PROTO · remetente diferente é recusado (ninguém fala em nome do outro)', w({ senderId: 'B1' }).reason === 'remetente', 'aceitou');
  confere('PROTO · id fora do formato é recusado', w({ id: 'x'.repeat(30) }).reason === 'id', 'aceitou');
  confere('PROTO · texto acima do teto é recusado; no teto passa', w({ text: 'a'.repeat(MAX_TEXT_CHARS + 1) }).reason === 'conteudo' && w({ text: 'a'.repeat(MAX_TEXT_CHARS) }).ok === true, 'limite errado');
  confere('PROTO · texto vazio sem E2EE é recusado', w({ text: '   ' }).reason === 'conteudo', 'aceitou');
  confere('PROTO · com E2EE, o texto claro NÃO viaja junto (é descartado)',
    (() => { const r = w({ text: 'segredo', e2ee: { v: 1, alg: 'ECDH-P256-AES-GCM', senderPublicKey: '{"a":1}', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAA' } }); return r.ok && r.message.text === undefined && r.message.e2ee; })(), 'vazou o texto claro');
  confere('PROTO · E2EE com algoritmo trocado ou texto cifrado gigante é recusado',
    w({ e2ee: { v: 1, alg: 'RSA', senderPublicKey: 'k', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAA' } }).reason === 'e2ee'
      && w({ e2ee: { v: 1, alg: 'ECDH-P256-AES-GCM', senderPublicKey: 'k', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'A'.repeat(40_001) } }).reason === 'e2ee', 'aceitou');
  confere('PROTO · data de outro século ou do futuro vira a hora da chegada',
    plausibleCreatedAt('1999-01-01T00:00:00Z', now) === new Date(now).toISOString() && plausibleCreatedAt('2999-01-01T00:00:00Z', now) === new Date(now).toISOString()
      && plausibleCreatedAt(new Date(now - 1000).toISOString(), now) === new Date(now - 1000).toISOString(), 'confiou no relógio de quem manda');
  confere('PROTO · resposta a mensagem: id e textos com formato e teto', w({ parentMessageId: 'ok_1-2', parentMessageText: 'x'.repeat(501) }).reason === 'resposta' && w({ parentMessageId: 'a b' }).reason === 'resposta' && w({ parentMessageId: 'abc', parentMessageText: 'oi' }).ok === true, 'limite errado');
  confere('PROTO · JSON inválido, gigante ou não-texto nunca chega à validação',
    parseWireData('{', { expectedSender: 'A1', now }).reason === 'json' && parseWireData('x'.repeat(MAX_WIRE_CHARS + 1), { expectedSender: 'A1', now }).reason === 'tamanho' && parseWireData(new ArrayBuffer(4), { expectedSender: 'A1', now }).reason === 'shape', 'passou');

  const t = { v: 0 };
  const lim = createRateLimiter({ max: 3, windowMs: 1000 }, () => t.v);
  const r1 = [lim.allow(), lim.allow(), lim.allow(), lim.allow()];
  t.v = 1000;
  confere('PROTO · limite de taxa: 3 por janela, o 4º é barrado, e a janela volta a abrir', r1.join() === 'true,true,true,false' && lim.allow() === true, r1.join());
  const delays = [0, 1, 2, 3, 4, 5, 6, 9].map((n) => reconnectDelayMs(n, () => 0.5));
  confere('PROTO · espera cresce 1,5 s → 3 s → 6 s… e para em 30 s', delays[0] === 1500 && delays[1] === 3000 && delays[2] === 6000 && delays.slice(-1)[0] === 30_000 && delays.every((d, i) => i === 0 || d >= delays[i - 1]), delays.join());
  confere('PROTO · a variação da espera fica em ±20%', reconnectDelayMs(2, () => 0) === 4800 && reconnectDelayMs(2, () => 0.999999) === 7200, 'fora da faixa');
  const ice = toIceServers({ stun: ['stun:a.example.com:3478', 'javascript:alert(1)', 'http://x'], turn: { urls: ['turn:t.example.com:3478?transport=udp', 'stun:fake'], username: 'u', credential: 'c' } });
  confere('PROTO · servidores ICE: só stun/turn válidos entram; TURN leva credencial; endereço estranho é descartado',
    ice.length === 2 && ice[0].urls.join() === 'stun:a.example.com:3478' && ice[1].username === 'u' && ice[1].urls.join() === 'turn:t.example.com:3478?transport=udp', JSON.stringify(ice));
  confere('PROTO · sem configuração, usa os STUN padrão', JSON.stringify(toIceServers(null)) === JSON.stringify([{ urls: DEFAULT_STUN }]), 'padrão errado');
  const auto = (o) => shouldAutoConnect({ autoConnectP2p: true, zeroDbOnly: false, scope: 'mutual', isMutual: false, ...o });
  confere('PROTO · conectar sozinho só com contato mútuo (o IP não vai a quem apenas consegue abrir uma conversa)',
    auto({ isMutual: false }) === false && auto({ isMutual: true }) === true && auto({ scope: 'any' }) === true && auto({ autoConnectP2p: false, isMutual: true }) === false, 'política errada');
  confere('PROTO · "somente P2P" (Zero DB) liga o túnel mesmo sem ser mútuo: sem ele nada seria entregue', auto({ zeroDbOnly: true, autoConnectP2p: false }) === true, 'bloqueou');
  confere('PROTO · cada estado tem texto próprio; falha de NAT e falta de resposta dizem coisas diferentes',
    describeP2pState('failed', 'nat').label !== describeP2pState('failed', 'timeout').label && describeP2pState('peer-offline').tone === 'off' && describeP2pState('connected').tone === 'ok', 'textos iguais');
}

// ═════════════ 2. Aperto de mão ═════════════
{
  const t = montarPar();
  t.defineOnline('A1', true); t.defineOnline('B1', true);
  await t.clock.advance(2_000);
  confere('MOTOR · os dois lados chegam a "connected"', ultimo(t.estados.A1) === 'connected' && ultimo(t.estados.B1) === 'connected', `A=${ultimo(t.estados.A1)} B=${ultimo(t.estados.B1)}`);
  const sinaisA = t.bus.log.filter((x) => x.de === 'A1').map((x) => x.tipo);
  const sinaisB = t.bus.log.filter((x) => x.de === 'B1').map((x) => x.tipo);
  confere('MOTOR · a OFERTA sai antes de qualquer candidato ICE (quem oferece)', sinaisA[0] === 'offer' && sinaisA.indexOf('ice') > sinaisA.indexOf('offer'), sinaisA.join());
  confere('MOTOR · a RESPOSTA sai antes dos candidatos de quem responde', sinaisB.includes('answer') && sinaisB.indexOf('answer') < sinaisB.indexOf('ice'), sinaisB.join());
  confere('MOTOR · quem tem o id MAIOR nunca oferece (sem choque de ofertas)', !sinaisB.includes('offer'), sinaisB.join());
  confere('MOTOR · conectado, a sinalização é apagada (nada fica no banco)', t.bus.limpezas.A1 >= 1 && t.bus.limpezas.B1 >= 1 && t.bus.nos.A1.length === 0 && t.bus.nos.B1.length === 0, `limpezas A=${t.bus.limpezas.A1} B=${t.bus.limpezas.B1}`);

  const entregueAB = t.a.sendWire(msg('p2p_1800000000001_aaa111', 'oi do A'));
  const entregueBA = t.b.sendWire(msg('p2p_1800000000002_bbb222', 'oi do B', 'B1'));
  await t.clock.advance(10);
  confere('MOTOR · mensagens vão e voltam, uma vez cada', entregueAB && entregueBA && t.recebidas.B1.length === 1 && t.recebidas.A1.length === 1 && t.recebidas.B1[0].text === 'oi do A' && t.recebidas.A1[0].text === 'oi do B', JSON.stringify(t.recebidas));
  confere('MOTOR · o estado "connected" foi anunciado uma vez só (sem piscar)', t.estados.A1.filter((s) => s === 'connected').length === 1, t.estados.A1.join());

  const criadosAntes = t.rede.criados.length;
  t.defineOnline('B1', true); // outra aba do contato muda o nó de presença, não a presença
  await t.clock.advance(100);
  confere('MOTOR · presença repetida (outra aba do contato) não refaz a conexão', t.rede.criados.length === criadosAntes && ultimo(t.estados.A1) === 'connected', `${t.rede.criados.length} x ${criadosAntes}`);
  t.defineOnline('B1', false);
  await t.clock.advance(100);
  confere('MOTOR · presença offline com túnel aberto NÃO derruba o túnel (ele não depende do WebSocket de presença)', ultimo(t.estados.A1) === 'connected' && t.a.sendWire(msg('p2p_1800000000003_ccc333', 'ainda aqui')) === true, ultimo(t.estados.A1));
  t.a.destroy(); t.b.destroy();
  await t.clock.advance(100);
  confere('MOTOR · destruir limpa tudo: nenhum relógio pendente e sinais apagados', t.clock.pending() === 0 && t.bus.nos.A1.length === 0 && t.bus.ouvintes.B1.size === 0 && t.bus.ouvintes.A1.size === 0, `pendentes=${t.clock.pending()}`);
  const depois = t.estados.A1.length;
  t.defineOnline('B1', true);
  await t.clock.advance(1000);
  confere('MOTOR · depois de destruir, nada mais acontece (nem estado, nem conexão nova)', t.estados.A1.length === depois, 'reagiu depois de destruir');
}

// ═════════════ 3. Quem chega depois ═════════════
{
  const t = montarPar({ criarB: false });
  t.defineOnline('A1', true); t.defineOnline('B1', true); // o contato está online, mas a conversa dele ainda não abriu
  await t.clock.advance(1_000);
  confere('TARDIO · a oferta foi publicada e ninguém atendeu: A fica "connecting"', ultimo(t.estados.A1) === 'connecting' && t.bus.nos.A1.some((s) => s.type === 'offer'), ultimo(t.estados.A1));
  await t.clock.advance(60_000); // a oferta já tem mais de 45 s
  const b = t.criarB();
  await t.clock.advance(3_000);
  confere('TARDIO · o aparelho que entrou depois recusou a oferta velha e AVISOU (hello)', t.logs.B1.some((l) => l.ev === 'signal-rejected' && l.reason === 'stale') && t.bus.log.some((x) => x.de === 'B1' && x.tipo === 'hello'), JSON.stringify(t.logs.B1.slice(0, 3)));
  confere('TARDIO · o iniciador ofereceu de novo e os dois conectaram (antes ficava "conectando" para sempre)', ultimo(t.estados.A1) === 'connected' && ultimo(t.estados.B1) === 'connected', `A=${ultimo(t.estados.A1)} B=${ultimo(t.estados.B1)}`);
  t.a.destroy(); b.destroy();
}

// ═════════════ 4. Só a aba visível atende ═════════════
{
  let visivel = false;
  const t = montarPar({ visivelB: () => visivel });
  t.defineOnline('A1', true); t.defineOnline('B1', true);
  await t.clock.advance(3_000);
  confere('ABA · aba escondida do contato não atende a oferta (não entrega o IP de quem está com a tela apagada)', t.logs.B1.some((l) => l.ev === 'offer-ignored-hidden') && !t.bus.log.some((x) => x.de === 'B1' && x.tipo === 'answer'), 'respondeu escondida');
  visivel = true;
  t.b.notifyVisible();
  await t.clock.advance(3_000);
  confere('ABA · ao ficar visível, pede outra oferta e conecta', ultimo(t.estados.A1) === 'connected' && ultimo(t.estados.B1) === 'connected', `A=${ultimo(t.estados.A1)} B=${ultimo(t.estados.B1)}`);
  t.a.destroy(); t.b.destroy();
}

// ═════════════ 5. Contato sem resposta ═════════════
{
  const t = montarPar({ criarB: false });
  t.defineOnline('A1', true); t.defineOnline('B1', true);
  await t.clock.advance(DEFAULT_P2P_CONFIG.connectTimeoutMs + 3_000); // limite de 20 s + espera de 1,5 s antes da nova tentativa
  confere('SEM RESPOSTA · passado o limite, tenta de novo e continua "connecting" (a pessoa não vê falha à toa)', ultimo(t.estados.A1) === 'connecting' && t.rede.criados.length >= 2, `${ultimo(t.estados.A1)}; conexões criadas=${t.rede.criados.length}`);
  await t.clock.advance(5 * 60_000);
  confere('SEM RESPOSTA · esgotadas as tentativas, estado final "failed" com o motivo (contato sem resposta, não NAT)', ultimo(t.estados.A1) === 'failed:signaling', ultimo(t.estados.A1));
  confere('SEM RESPOSTA · o número de tentativas é limitado (nada de laço infinito)', t.rede.criados.length === DEFAULT_P2P_CONFIG.maxAttempts + 1, `criadas=${t.rede.criados.length}`);
  confere('SEM RESPOSTA · a espera cresce entre tentativas', (() => {
    const ofertas = t.bus.log.filter((x) => x.de === 'A1' && x.tipo === 'offer').length;
    return ofertas === DEFAULT_P2P_CONFIG.maxAttempts + 1;
  })(), 'quantidade de ofertas inesperada');
  t.b = t.criarB();
  t.a.reconnect();
  await t.clock.advance(3_000);
  confere('SEM RESPOSTA · "Reconectar" recomeça do zero e, com o contato presente, conecta', ultimo(t.estados.A1) === 'connected', ultimo(t.estados.A1));
  t.a.destroy(); t.b.destroy();
}

// ═════════════ 6. NAT restritivo ═════════════
{
  const t = montarPar();
  t.rede.modo = 'bloqueado';
  t.defineOnline('A1', true); t.defineOnline('B1', true);
  await t.clock.advance(10 * 60_000);
  confere('NAT · a negociação funciona mas a rede não deixa: quem oferece termina em "failed" com motivo NAT (não "sem resposta")', ultimo(t.estados.A1) === 'failed:nat', `A=${ultimo(t.estados.A1)}`);
  confere('NAT · o outro lado também termina em falha (não fica "conectando" para sempre)', ultimo(t.estados.B1).startsWith('failed'), `B=${ultimo(t.estados.B1)}`);
  confere('NAT · o texto para a pessoa explica a rede e aponta o envio normal', /NAT/.test(describeP2pState('failed', 'nat').detail) && /normal/.test(describeP2pState('failed', 'nat').detail), describeP2pState('failed', 'nat').detail);
  confere('NAT · sendWire não finge entregar sem túnel', t.a.sendWire(msg('p2p_1800000000004_ddd444', 'x')) === false, 'devolveu true');
  t.rede.modo = 'direto';
  t.a.reconnect();
  await t.clock.advance(3_000);
  confere('NAT · mudou a rede (modo direto) → "Reconectar" conecta', ultimo(t.estados.A1) === 'connected', ultimo(t.estados.A1));
  t.a.destroy(); t.b.destroy();
}

// ═════════════ 7. Recupera sozinho ═════════════
{
  const t = montarPar();
  t.rede.modo = 'bloqueado';
  t.defineOnline('A1', true); t.defineOnline('B1', true);
  await t.clock.advance(3_000); // 1ª tentativa falha
  t.rede.modo = 'direto';
  await t.clock.advance(60_000);
  confere('RECUPERA · a rede melhorou entre as tentativas: conecta sozinho e zera as tentativas', ultimo(t.estados.A1) === 'connected' && t.a.getStats().attempts === 0, `${ultimo(t.estados.A1)} / tentativas=${t.a.getStats().attempts}`);
  const criadosAntesDaQueda = t.rede.criados.filter((p) => p.dono === 'A1').length;
  t.rede.cair(t.rede.criados.find((p) => p.dono === 'A1' && p.connectionState === 'connected'));
  await t.clock.advance(2_000);
  const pA = t.rede.criados.filter((p) => p.dono === 'A1').pop();
  t.rede.recuperar(pA);
  await t.clock.advance(10_000);
  confere('RECUPERA · "disconnected" que volta em menos de 4 s não derruba o túnel (nenhuma conexão nova)', ultimo(t.estados.A1) === 'connected' && t.rede.criados.filter((p) => p.dono === 'A1').length === criadosAntesDaQueda, `${ultimo(t.estados.A1)}; conexões=${t.rede.criados.filter((p) => p.dono === 'A1').length} (antes: ${criadosAntesDaQueda})`);
  t.rede.cair(t.rede.criados.filter((p) => p.dono === 'A1').pop());
  await t.clock.advance(5_000); // passa a carência de 4 s
  await t.clock.advance(5_000);
  confere('RECUPERA · "disconnected" que persiste (> 4 s) renegocia e volta a conectar', ultimo(t.estados.A1) === 'connected' && t.rede.criados.filter((p) => p.dono === 'A1').length >= 3, `${ultimo(t.estados.A1)}; conexões=${t.rede.criados.filter((p) => p.dono === 'A1').length}`);
  t.a.destroy(); t.b.destroy();
}

// ═════════════ 7b. Presença que oscila durante a negociação ═════════════
{
  const t = montarPar({ criarB: false });
  t.defineOnline('A1', true); t.defineOnline('B1', true);
  await t.clock.advance(500);
  const ofertas0 = t.bus.log.filter((x) => x.de === 'A1' && x.tipo === 'offer').length;
  const conexoes0 = t.rede.criados.length;
  for (let i = 0; i < 5; i++) t.defineOnline('B1', true); // o contato abre outras abas: o nó muda, a presença não
  await t.clock.advance(500);
  confere('PRESENÇA · o contato abre outras abas no meio da negociação: não vira oferta nova a cada mudança do nó',
    t.bus.log.filter((x) => x.de === 'A1' && x.tipo === 'offer').length === ofertas0 && t.rede.criados.length === conexoes0, `ofertas ${t.bus.log.filter((x) => x.de === 'A1' && x.tipo === 'offer').length} (antes ${ofertas0}); conexões ${t.rede.criados.length} (antes ${conexoes0})`);
  t.a.destroy();
}

// ═════════════ 8. Contato some durante a negociação ═════════════
{
  const t = montarPar({ criarB: false });
  t.defineOnline('A1', true); t.defineOnline('B1', true);
  await t.clock.advance(500);
  t.defineOnline('B1', false);
  await t.clock.advance(500);
  confere('OFFLINE · contato sai no meio da negociação: "peer-offline" e nenhuma tentativa pendente', ultimo(t.estados.A1) === 'peer-offline' && t.clock.pending() === 0, `${ultimo(t.estados.A1)}; pendentes=${t.clock.pending()}`);
  confere('OFFLINE · o texto diz que o envio normal segue disponível', /normal/.test(describeP2pState('peer-offline').detail), describeP2pState('peer-offline').detail);
  t.a.destroy();
}

// ═════════════ 9. Entrada hostil ═════════════
{
  const t = montarPar();
  t.defineOnline('A1', true); t.defineOnline('B1', true);
  await t.clock.advance(2_000);
  const antes = t.a.getStats().rejectedSignals;
  const agora = t.clock.now();
  const ses = 'ses-intruso';
  const lixos = [
    { from: 'C9', sessionId: ses, type: 'offer', sdp: { type: 'offer', sdp: 'v=0' }, ts: agora },
    { from: 'B1', sessionId: ses, type: 'offer', sdp: { type: 'offer', sdp: 'x'.repeat(MAX_SDP_CHARS + 5) }, ts: agora },
    { from: 'B1', sessionId: ses, type: 'offer', sdp: { type: 'offer', sdp: 'v=0' }, ts: agora - 120_000 },
    { from: 'B1', sessionId: 'x', type: 'offer', sdp: { type: 'offer', sdp: 'v=0' }, ts: agora },
    'texto', null, [],
  ];
  for (const l of lixos) t.bus.injeta('A1', 'B1', l);
  await t.clock.advance(100);
  confere('HOSTIL · sinais forjados, velhos, gigantes ou malformados são rejeitados e contados', t.a.getStats().rejectedSignals - antes === lixos.length, `${t.a.getStats().rejectedSignals - antes} de ${lixos.length}`);
  confere('HOSTIL · e o túnel que estava aberto continua intacto', ultimo(t.estados.A1) === 'connected', ultimo(t.estados.A1));
  const criados = t.rede.criados.length;
  t.bus.injeta('A1', 'B1', { from: 'B1', sessionId: 'ses-outraxx', type: 'offer', sdp: { type: 'offer', sdp: 'v=0 fake zzz' }, ts: t.clock.now() });
  await t.clock.advance(100);
  confere('HOSTIL · uma "oferta" dirigida ao iniciador é ignorada (só quem tem o id maior atende)', t.rede.criados.length === criados, `criou ${t.rede.criados.length - criados} conexão(ões)`);

  const pAtual = t.rede.criados.filter((p) => p.dono === 'A1').pop();
  const antesIce = pAtual.recebidos;
  t.bus.injeta('A1', 'B1', { from: 'B1', sessionId: 'ses-estranha', type: 'ice', candidate: { candidate: 'candidate:9 1 udp 1 9.9.9.9 9 typ host', sdpMid: '0', sdpMLineIndex: 0 }, ts: t.clock.now() });
  await t.clock.advance(50);
  confere('HOSTIL · candidato ICE de OUTRA negociação não entra na conexão corrente (antes um candidato de sessão velha entrava)', pAtual.recebidos === antesIce, `a conexão recebeu ${pAtual.recebidos - antesIce} candidato(s) de fora`);

  // mensagens do túnel
  const canalB = t.rede.criados.filter((p) => p.dono === 'B1').pop().canal;
  const entra = (data) => canalB.send(data);
  const r0 = t.recebidas.A1.length;
  entra('{"v":1');
  entra('x'.repeat(MAX_WIRE_CHARS + 10));
  entra(JSON.stringify({ ...msg('p2p_1800000000010_zzz999', 'forjada', 'A1') })); // diz ser do A1, mas quem fala é o B1
  entra(JSON.stringify({ ...msg('p2p_1800000000011_yyy888', 'ok', 'B1'), extra: 'x' }));
  await t.clock.advance(50);
  confere('HOSTIL · do túnel só a mensagem válida entra (JSON quebrado, gigante e de remetente forjado ficam de fora)', t.recebidas.A1.length - r0 === 1 && ultimo(t.recebidas.A1).text === 'ok' && ultimo(t.recebidas.A1).extra === undefined, JSON.stringify(t.recebidas.A1.slice(r0)));
  confere('HOSTIL · as recusas do túnel foram contadas', t.a.getStats().rejectedWire === 3, `rejectedWire=${t.a.getStats().rejectedWire}`);

  const r1 = t.recebidas.A1.length;
  for (let i = 0; i < 100; i++) entra(JSON.stringify(msg(`p2p_18000000001${String(i).padStart(2, '0')}_f${i}`, `spam ${i}`, 'B1')));
  await t.clock.advance(50);
  const entregues = t.recebidas.A1.length - r1;
  confere('HOSTIL · inundação: no máximo 30 por 10 s chegam à conversa, o resto é descartado e contado', entregues <= DEFAULT_P2P_CONFIG.rateMax && t.a.getStats().rateLimited >= 100 - DEFAULT_P2P_CONFIG.rateMax - 1, `entregues=${entregues}, barradas=${t.a.getStats().rateLimited}`);
  await t.clock.advance(11_000);
  const r2 = t.recebidas.A1.length;
  entra(JSON.stringify(msg('p2p_1800000000999_okok1', 'depois da janela', 'B1')));
  await t.clock.advance(50);
  confere('HOSTIL · passada a janela, o fluxo normal volta', t.recebidas.A1.length === r2 + 1, 'continuou barrando');
  t.a.destroy(); t.b.destroy();
}

// ═════════════ 10. Relay (TURN): credenciais temporárias ═════════════
{
  const { hmacSha1Base64, parseTurnConfig, turnRestCredentials } = await import('../src/lib/p2p/turnCredentials.ts');
  confere('TURN · HMAC-SHA1 confere com o vetor de teste da RFC 2202 (chave "Jefe")', hmacSha1Base64('Jefe', 'what do ya want for nothing?') === Buffer.from('effcdf6ae5eb2fa2d27416d5f184df9c259a7c79', 'hex').toString('base64'), hmacSha1Base64('Jefe', 'what do ya want for nothing?'));
  const segredo = 'segredo-compartilhado-com-o-coturn';
  const c = turnRestCredentials(segredo, 'uidDaAlice123', 1_800_000_000, 3600);
  confere('TURN · usuário = "<expira>:<resumo>" e senha = HMAC do usuário (o esquema `use-auth-secret` do coturn)', c.expiresAt === 1_800_003_600 && /^1800003600:[0-9a-f]{16}$/.test(c.username) && c.credential === hmacSha1Base64(segredo, c.username), JSON.stringify(c));
  confere('TURN · o UID não aparece na credencial (o provedor do relay não precisa saber quem é)', !c.username.includes('uidDaAlice123'), c.username);
  confere('TURN · pessoas diferentes e instantes diferentes dão credenciais diferentes', turnRestCredentials(segredo, 'outraPessoa', 1_800_000_000).credential !== c.credential && turnRestCredentials(segredo, 'uidDaAlice123', 1_800_000_100).credential !== c.credential, 'credenciais iguais');
  const ligado = parseTurnConfig({ P2P_TURN_URLS: 'turn:t.exemplo.com:3478?transport=udp, turns:t.exemplo.com:5349?transport=tcp, javascript:alert(1), stun:nao-e-turn.com', P2P_TURN_SECRET: segredo, P2P_STUN_URLS: 'stun:s.exemplo.com:3478' });
  confere('TURN · configuração: só endereços turn/turns válidos entram; o segredo é guardado', ligado.turnUrls.length === 2 && ligado.stun.length === 1 && ligado.secret === segredo, JSON.stringify(ligado));
  confere('TURN · sem endereços, ou com segredo curto demais, não há TURN (a rota devolve só STUN)', parseTurnConfig({ P2P_TURN_SECRET: segredo }).secret === null && parseTurnConfig({ P2P_TURN_URLS: 'turn:t.exemplo.com:3478', P2P_TURN_SECRET: 'curto' }).secret === null && parseTurnConfig({}).turnUrls.length === 0, 'ligou sem configuração');
}

console.log('');
console.log(`${total} verificações.`);
if (falhas) { console.log(`${falhas} falha(s).`); process.exit(1); }
console.log('Motor P2P OK: oferta antes dos candidatos, quem chega depois é atendido, falhas dizem o motivo e a entrada hostil não entra.');
