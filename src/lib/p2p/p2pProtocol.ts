// src/lib/p2p/p2pProtocol.ts
// O que é VÁLIDO no canal P2P: sinais de WebRTC (SDP/ICE) e mensagens do DataChannel. Módulo PURO (sem Firebase, sem DOM,
// sem imports), para a suíte exercitar cada recusa em Node.
//
// Por que existe: tudo o que chega do outro lado, pela sinalização ou pelo túnel, vem de OUTRA pessoa (ou de alguém que
// tomou o navegador dela). O código antigo fazia `JSON.parse` e gravava no localStorage sem limite de tamanho: um contato
// podia encher a cota do navegador (derrubando as preferências do app), mandar SDP gigante ou inundar o chat. Aqui cada
// campo tem formato e teto, e o que sai daqui é uma cópia limpa (campos desconhecidos nunca atravessam).

export const P2P_WIRE_VERSION = 1 as const;

/** Teto de uma mensagem inteira no túnel (bytes aproximados por caracteres). Acima disso nem se faz JSON.parse. */
export const MAX_WIRE_CHARS = 64_000;
export const MAX_TEXT_CHARS = 8_000;
export const MAX_PARENT_CHARS = 500;
export const MAX_E2EE_CIPHERTEXT_CHARS = 40_000;
export const MAX_KEY_CHARS = 640;
export const MAX_SDP_CHARS = 16_000;
export const MAX_CANDIDATE_CHARS = 1_024;

/** Um sinal mais velho que isto já não serve a uma negociação em curso. */
export const SIGNAL_MAX_AGE_MS = 45_000;
/** Folga para relógio adiantado quando o carimbo não veio do servidor. */
export const SIGNAL_FUTURE_SKEW_MS = 10_000;

export type SignalType = 'hello' | 'offer' | 'answer' | 'ice';

export type SessionDescription = { type: 'offer' | 'answer'; sdp: string };
export type IceCandidate = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

export type P2pSignal = {
  from: string;
  /** Identifica a NEGOCIAÇÃO: a oferta cria, a resposta e os candidatos ICE repetem. */
  sessionId: string;
  type: SignalType;
  ts: number;
  sdp?: SessionDescription;
  candidate?: IceCandidate;
};

export type SignalRejection = 'shape' | 'from' | 'session' | 'type' | 'stale' | 'future' | 'sdp' | 'candidate';

const SESSION_ID = /^[A-Za-z0-9._-]{6,64}$/;
const SIGNAL_TYPES: readonly SignalType[] = ['hello', 'offer', 'answer', 'ice'];

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/** Texto sem NUL e sem caracteres de controle fora de \t \n \r (nada disso é SDP/ICE válido). */
const semControle = (s: string): boolean => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(s);

function parseSdp(raw: unknown, type: 'offer' | 'answer'): SessionDescription | null {
  if (!isPlainObject(raw)) return null;
  if (raw.type !== type) return null;
  if (typeof raw.sdp !== 'string' || raw.sdp.length === 0 || raw.sdp.length > MAX_SDP_CHARS || !semControle(raw.sdp)) return null;
  return { type, sdp: raw.sdp };
}

function parseCandidate(raw: unknown): IceCandidate | null {
  if (!isPlainObject(raw)) return null;
  const c = raw.candidate;
  if (typeof c !== 'string' || c.length > MAX_CANDIDATE_CHARS || !semControle(c)) return null;
  const saida: IceCandidate = { candidate: c };
  if (raw.sdpMid !== undefined && raw.sdpMid !== null) {
    if (typeof raw.sdpMid !== 'string' || raw.sdpMid.length > 64) return null;
    saida.sdpMid = raw.sdpMid;
  }
  if (raw.sdpMLineIndex !== undefined && raw.sdpMLineIndex !== null) {
    if (typeof raw.sdpMLineIndex !== 'number' || !Number.isInteger(raw.sdpMLineIndex) || raw.sdpMLineIndex < 0 || raw.sdpMLineIndex > 64) return null;
    saida.sdpMLineIndex = raw.sdpMLineIndex;
  }
  if (raw.usernameFragment !== undefined && raw.usernameFragment !== null) {
    if (typeof raw.usernameFragment !== 'string' || raw.usernameFragment.length > 64) return null;
    saida.usernameFragment = raw.usernameFragment;
  }
  return saida;
}

/**
 * Valida um sinal lido da sinalização. `expectedFrom` é quem DEVERIA ter escrito naquela posição (as regras do banco só
 * deixam cada pessoa escrever na própria; aqui se confere de novo, em profundidade). `serverNow` é a hora do SERVIDOR.
 */
export function parseSignal(
  raw: unknown,
  ctx: { expectedFrom: string; serverNow: number; maxAgeMs?: number },
): { ok: true; signal: P2pSignal } | { ok: false; reason: SignalRejection } {
  if (!isPlainObject(raw)) return { ok: false, reason: 'shape' };
  if (raw.from !== ctx.expectedFrom) return { ok: false, reason: 'from' };
  if (typeof raw.sessionId !== 'string' || !SESSION_ID.test(raw.sessionId)) return { ok: false, reason: 'session' };
  if (typeof raw.type !== 'string' || !(SIGNAL_TYPES as readonly string[]).includes(raw.type)) return { ok: false, reason: 'type' };
  if (typeof raw.ts !== 'number' || !Number.isFinite(raw.ts)) return { ok: false, reason: 'shape' };

  const idade = ctx.serverNow - raw.ts;
  if (idade > (ctx.maxAgeMs ?? SIGNAL_MAX_AGE_MS)) return { ok: false, reason: 'stale' };
  if (idade < -SIGNAL_FUTURE_SKEW_MS) return { ok: false, reason: 'future' };

  const base = { from: raw.from, sessionId: raw.sessionId, type: raw.type as SignalType, ts: raw.ts };
  if (raw.type === 'hello') return { ok: true, signal: base };
  if (raw.type === 'offer' || raw.type === 'answer') {
    const sdp = parseSdp(raw.sdp, raw.type);
    return sdp ? { ok: true, signal: { ...base, sdp } } : { ok: false, reason: 'sdp' };
  }
  const candidate = parseCandidate(raw.candidate);
  return candidate ? { ok: true, signal: { ...base, candidate } } : { ok: false, reason: 'candidate' };
}

// ───────────────────────── Mensagens no túnel ─────────────────────────

export type WireE2ee = {
  v: 1;
  alg: 'ECDH-P256-AES-GCM';
  senderPublicKey: string;
  recipientPublicKey?: string;
  iv: string;
  ciphertext: string;
};

export type WireMessage = {
  v: 1;
  kind: 'dm';
  id: string;
  senderId: string;
  createdAt: string;
  text?: string;
  e2ee?: WireE2ee | null;
  parentMessageId?: string | null;
  parentMessageText?: string | null;
  parentMessageSenderName?: string | null;
};

/**
 * Confirmacao de leitura pelo tunel: no modo Zero DB nao existe documento no servidor para guardar a marca d'agua.
 * Carrega SO "li ate este instante" -- sem conteudo, sem id de mensagem, sem lista do que foi aberto.
 *
 * Cliente antigo ignora com seguranca: o validador dele recusa tudo que nao e `kind: 'dm'` (motivo `versao`) em vez
 * de quebrar. Era exatamente para isto que o campo `kind` existia desde a primeira versao.
 */
export type WireReadReceipt = {
  v: 1;
  kind: 'read';
  senderId: string;
  /** Instante ISO ate o qual quem manda ja leu. */
  upTo: string;
};

/** Tudo o que pode trafegar no DataChannel. */
export type WirePacket = WireMessage | WireReadReceipt;

export type WireRejection = 'tamanho' | 'json' | 'shape' | 'versao' | 'remetente' | 'id' | 'conteudo' | 'e2ee' | 'resposta' | 'recibo';

const WIRE_ID = /^p2p_\d{10,15}_[a-z0-9]{1,16}$/;
const PARENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const BASE64 = /^[A-Za-z0-9+/_-]*={0,2}$/;

export const isP2pMessageId = (id: unknown): id is string => typeof id === 'string' && WIRE_ID.test(id);
export const isParentMessageId = (id: unknown): id is string => typeof id === 'string' && PARENT_ID.test(id);

export function parseE2ee(raw: unknown): WireE2ee | null {
  if (!isPlainObject(raw)) return null;
  if (raw.v !== 1 || raw.alg !== 'ECDH-P256-AES-GCM') return null;
  const { senderPublicKey, recipientPublicKey, iv, ciphertext } = raw;
  if (typeof senderPublicKey !== 'string' || senderPublicKey.length === 0 || senderPublicKey.length > MAX_KEY_CHARS) return null;
  if (recipientPublicKey !== undefined && (typeof recipientPublicKey !== 'string' || recipientPublicKey.length > MAX_KEY_CHARS)) return null;
  if (typeof iv !== 'string' || iv.length < 8 || iv.length > 64 || !BASE64.test(iv)) return null;
  if (typeof ciphertext !== 'string' || ciphertext.length < 8 || ciphertext.length > MAX_E2EE_CIPHERTEXT_CHARS || !BASE64.test(ciphertext)) return null;
  return {
    v: 1,
    alg: 'ECDH-P256-AES-GCM',
    senderPublicKey,
    ...(recipientPublicKey ? { recipientPublicKey } : {}),
    iv,
    ciphertext,
  };
}

/** Data da mensagem: a do remetente se for plausível, senão a da chegada (o relógio de quem manda não é de confiança). */
export function plausibleCreatedAt(raw: unknown, now: number): string {
  if (typeof raw === 'string' && raw.length <= 40) {
    const t = Date.parse(raw);
    if (Number.isFinite(t) && t >= now - 30 * 86_400_000 && t <= now + 5 * 60_000) return new Date(t).toISOString();
  }
  return new Date(now).toISOString();
}

/** Valida UMA mensagem já decodificada. Devolve uma cópia limpa: campo desconhecido nunca passa. */
export function validateWireMessage(
  raw: unknown,
  ctx: { expectedSender: string; now: number },
): { ok: true; message: WireMessage } | { ok: false; reason: WireRejection } {
  if (!isPlainObject(raw)) return { ok: false, reason: 'shape' };
  if (raw.v !== P2P_WIRE_VERSION || raw.kind !== 'dm') return { ok: false, reason: 'versao' };
  if (raw.senderId !== ctx.expectedSender) return { ok: false, reason: 'remetente' };
  if (typeof raw.id !== 'string' || !WIRE_ID.test(raw.id)) return { ok: false, reason: 'id' };

  let text: string | undefined;
  if (raw.text !== undefined && raw.text !== null) {
    if (typeof raw.text !== 'string' || raw.text.length > MAX_TEXT_CHARS) return { ok: false, reason: 'conteudo' };
    text = raw.text;
  }
  let e2ee: WireE2ee | null = null;
  if (raw.e2ee !== undefined && raw.e2ee !== null) {
    e2ee = parseE2ee(raw.e2ee);
    if (!e2ee) return { ok: false, reason: 'e2ee' };
  }
  // Com E2EE o texto claro não viaja junto: seria o texto cifrado entregue em duplicidade e em claro.
  if (e2ee) text = undefined;
  if (!e2ee && (!text || text.trim().length === 0)) return { ok: false, reason: 'conteudo' };

  const parent: Pick<WireMessage, 'parentMessageId' | 'parentMessageText' | 'parentMessageSenderName'> = {};
  if (raw.parentMessageId !== undefined && raw.parentMessageId !== null) {
    if (typeof raw.parentMessageId !== 'string' || !PARENT_ID.test(raw.parentMessageId)) return { ok: false, reason: 'resposta' };
    parent.parentMessageId = raw.parentMessageId;
    for (const campo of ['parentMessageText', 'parentMessageSenderName'] as const) {
      const v = raw[campo];
      if (v === undefined || v === null) continue;
      if (typeof v !== 'string' || v.length > MAX_PARENT_CHARS) return { ok: false, reason: 'resposta' };
      parent[campo] = v;
    }
  }

  return {
    ok: true,
    message: {
      v: 1,
      kind: 'dm',
      id: raw.id,
      senderId: ctx.expectedSender,
      createdAt: plausibleCreatedAt(raw.createdAt, ctx.now),
      ...(text !== undefined ? { text } : {}),
      ...(e2ee ? { e2ee } : {}),
      ...parent,
    },
  };
}

/**
 * Valida UMA confirmacao de leitura. Nada de folga: um instante implausivel nao vira marca (seria o contato dizendo
 * "li tudo ate o ano que vem" e apagando a distincao entre lida e nao lida para sempre).
 */
export function validateWireReceipt(
  raw: unknown,
  ctx: { expectedSender: string; now: number },
): { ok: true; receipt: WireReadReceipt } | { ok: false; reason: WireRejection } {
  if (!isPlainObject(raw)) return { ok: false, reason: 'shape' };
  if (raw.v !== P2P_WIRE_VERSION || raw.kind !== 'read') return { ok: false, reason: 'versao' };
  if (raw.senderId !== ctx.expectedSender) return { ok: false, reason: 'remetente' };
  if (typeof raw.upTo !== 'string' || raw.upTo.length > 40) return { ok: false, reason: 'recibo' };
  const t = Date.parse(raw.upTo);
  if (!Number.isFinite(t)) return { ok: false, reason: 'recibo' };
  if (t < ctx.now - 30 * 86_400_000 || t > ctx.now + 5 * 60_000) return { ok: false, reason: 'recibo' };
  return { ok: true, receipt: { v: 1, kind: 'read', senderId: ctx.expectedSender, upTo: new Date(t).toISOString() } };
}

/** O que chega pelo DataChannel: texto → limite de tamanho → JSON → validação. */
export function parseWireData(
  data: unknown,
  ctx: { expectedSender: string; now: number },
): { ok: true; message: WirePacket } | { ok: false; reason: WireRejection } {
  if (typeof data !== 'string') return { ok: false, reason: 'shape' };
  if (data.length > MAX_WIRE_CHARS) return { ok: false, reason: 'tamanho' };
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return { ok: false, reason: 'json' };
  }
  // O despacho olha so o `kind`; cada forma tem o proprio validador, e o que nao e nenhuma das duas continua recusado.
  if (isPlainObject(json) && json.kind === 'read') {
    const r = validateWireReceipt(json, ctx);
    return r.ok ? { ok: true, message: r.receipt } : r;
  }
  return validateWireMessage(json, ctx);
}

// ───────────────────────── Limite de taxa ─────────────────────────

/** Janela deslizante: no máximo `max` eventos a cada `windowMs`. `allow()` registra o evento quando o aceita. */
export function createRateLimiter(opts: { max: number; windowMs: number }, now: () => number) {
  const marcas: number[] = [];
  return {
    allow(): boolean {
      const agora = now();
      while (marcas.length > 0 && agora - marcas[0] >= opts.windowMs) marcas.shift();
      if (marcas.length >= opts.max) return false;
      marcas.push(agora);
      return true;
    },
  };
}

// ───────────────────────── Servidores ICE, espera e política ─────────────────────────

export type IceServer = { urls: string | string[]; username?: string; credential?: string };
export type IceConfig = {
  stun: string[];
  turn?: { urls: string[]; username: string; credential: string } | null;
};

export const DEFAULT_STUN = ['stun:stun.cloudflare.com:3478'];

const ICE_URL = /^(stun|stuns|turn|turns):[A-Za-z0-9.\-[\]:]+(\?transport=(udp|tcp))?$/;

/** Lista pronta para o RTCPeerConnection. Endereço fora do formato é descartado (a resposta do servidor não é de confiança cega). */
export function toIceServers(cfg: IceConfig | null | undefined): IceServer[] {
  const stun = (cfg?.stun ?? []).filter((u) => typeof u === 'string' && ICE_URL.test(u)).slice(0, 4);
  const servidores: IceServer[] = [{ urls: stun.length > 0 ? stun : DEFAULT_STUN }];
  const turn = cfg?.turn;
  if (turn && typeof turn.username === 'string' && typeof turn.credential === 'string') {
    const urls = (turn.urls ?? []).filter((u) => typeof u === 'string' && ICE_URL.test(u) && /^turns?:/.test(u)).slice(0, 4);
    if (urls.length > 0) servidores.push({ urls, username: turn.username, credential: turn.credential });
  }
  return servidores;
}

/** Espera antes da tentativa `attempt` (0, 1, 2...): 1,5 s, 3 s, 6 s... até 30 s, com ±20% de variação. */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1_500 * 2 ** Math.max(0, attempt));
  return Math.round(base * (1 + (random() * 2 - 1) * 0.2));
}

export type AutoConnectScope = 'mutual' | 'any';

/**
 * Conectar sozinho expõe o IP de quem abre a conversa ao outro lado (é o que o WebRTC faz). Por isso o padrão só conecta
 * com contatos MÚTUOS (um segue o outro): qualquer pessoa que consiga iniciar uma conversa com você não ganha, só por
 * isso, o seu endereço de rede. `any` é uma escolha explícita da pessoa.
 */
export function shouldAutoConnect(entrada: {
  autoConnectP2p: boolean;
  zeroDbOnly: boolean;
  scope: AutoConnectScope;
  isMutual: boolean;
}): boolean {
  if (!entrada.autoConnectP2p && !entrada.zeroDbOnly) return false;
  // Quem ligou "somente P2P" pediu o túnel para esta conversa: sem ele nada seria entregue.
  if (entrada.zeroDbOnly) return true;
  return entrada.scope === 'any' || entrada.isMutual;
}

export type P2pStateInfo = { label: string; detail: string; tone: 'ok' | 'wait' | 'warn' | 'off' };

/** Texto honesto para cada estado, em português. A interface mostra isto em vez de um "offline" genérico. */
export function describeP2pState(state: string, reason?: string | null): P2pStateInfo {
  switch (state) {
    case 'connected':
      return { label: 'P2P ativo', detail: 'Conexão direta entre os dois aparelhos. Nada é gravado no servidor.', tone: 'ok' };
    case 'connecting':
      return { label: 'Conectando…', detail: 'Negociando a conexão direta com o contato.', tone: 'wait' };
    case 'peer-offline':
      return { label: 'Contato offline', detail: 'O P2P só funciona com os dois online ao mesmo tempo. O envio normal (com E2EE) segue disponível.', tone: 'off' };
    case 'failed':
      if (reason === 'timeout' || reason === 'signaling') {
        return { label: 'Contato não respondeu', detail: 'O aparelho do contato não atendeu a conexão direta (aba fechada ou em segundo plano).', tone: 'warn' };
      }
      if (reason === 'closed') {
        return { label: 'Conexão encerrada', detail: 'O túnel direto foi encerrado e não voltou. Toque em Reconectar ou use o envio normal, que continua criptografado.', tone: 'warn' };
      }
      return { label: 'Rede bloqueia o P2P', detail: 'Sua rede ou a do contato impede a conexão direta (NAT restritivo). Use o envio normal, que continua criptografado.', tone: 'warn' };
    case 'unsupported':
      return { label: 'P2P indisponível', detail: 'Este navegador não oferece WebRTC.', tone: 'off' };
    default:
      return { label: 'P2P desligado', detail: 'Sem conexão direta nesta conversa.', tone: 'off' };
  }
}
