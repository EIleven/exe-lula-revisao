// src/lib/p2p/p2pSession.ts
// O MOTOR da sessão P2P (WebRTC DataChannel): negociação, tentativas, esperas e estados. Não importa Firebase nem toca o
// navegador: o canal de sinalização, o `RTCPeerConnection`, o relógio e a presença entram por parâmetro. Assim a suíte
// (e2e/p2p-core-check.mjs) liga dois motores por uma rede falsa e exercita cada caminho em Node, o que o código antigo (um
// arquivo só, preso ao navegador) não permitia.
//
// O que o motor garante, e o código antigo não:
//  - a OFERTA sai antes de qualquer candidato ICE (os candidatos nascem durante `setLocalDescription`: antes, chegavam ao
//    outro lado antes da oferta e eram jogados fora ao montar a conexão);
//  - cada negociação tem um id e só sinais desse id valem (antes um candidato de uma sessão velha entrava na nova);
//  - sinais são processados um de cada vez, na ordem em que chegam;
//  - quem chega depois avisa (`hello`) e o iniciador oferece de novo (antes a oferta de 45 s atrás era ignorada e a
//    conversa ficava em "conectando" para sempre);
//  - mudança de presença do contato (abrir outra aba) não derruba negociação nem túnel abertos;
//  - falha → espera crescente com variação → número fixo de tentativas → estado final `failed` com o motivo;
//  - só a aba VISÍVEL do contato atende uma oferta (antes o celular no bolso atendia e a aba aberta ficava de fora);
//  - tudo o que chega do túnel passa por `parseWireData` e por um limite de taxa.
import {
  createRateLimiter,
  parseSignal,
  parseWireData,
  reconnectDelayMs,
  type IceCandidate,
  type P2pSignal,
  type SessionDescription,
  type SignalRejection,
  type WirePacket,
  type WireRejection,
} from './p2pProtocol.ts';

export type P2pConnectionState = 'idle' | 'connecting' | 'connected' | 'offline' | 'peer-offline' | 'failed' | 'unsupported';
export type P2pFailureReason = 'timeout' | 'nat' | 'signaling' | 'closed';

export interface RtcChannelLike {
  readyState: string;
  send(data: string): void;
  close(): void;
  onopen: null | (() => void);
  onclose: null | (() => void);
  onerror: null | (() => void);
  onmessage: null | ((event: { data: unknown }) => void);
}

export interface RtcPeerLike {
  connectionState: string;
  signalingState: string;
  remoteDescription: unknown;
  onicecandidate: null | ((event: { candidate: { toJSON(): IceCandidate } | null }) => void);
  onconnectionstatechange: null | (() => void);
  ondatachannel: null | ((event: { channel: RtcChannelLike }) => void);
  createDataChannel(label: string, options?: { ordered?: boolean }): RtcChannelLike;
  createOffer(): Promise<{ type?: string; sdp?: string }>;
  createAnswer(): Promise<{ type?: string; sdp?: string }>;
  setLocalDescription(description: { type?: string; sdp?: string }): Promise<void>;
  setRemoteDescription(description: SessionDescription): Promise<void>;
  addIceCandidate(candidate: IceCandidate): Promise<void>;
  close(): void;
}

export type OutgoingSignal = Omit<P2pSignal, 'from' | 'ts'>;

export interface P2pCoreDeps {
  me: string;
  peer: string;
  signaling: {
    /** Publica um sinal; o transporte carimba `from` e `ts` (hora do servidor). */
    send(signal: OutgoingSignal): Promise<void>;
    /** Ouve o que o contato publica. Devolve o cancelamento. */
    listen(onSignal: (raw: unknown) => void): () => void;
    /** Apaga os sinais DESTA sessão. */
    clear(): Promise<void>;
    /** Hora do servidor (ms). */
    serverNow(): number;
  };
  presence: { watch(onChange: (online: boolean) => void): () => void };
  createPeer(): RtcPeerLike;
  timers: {
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
    /** Relógio local (ms), usado só no limite de taxa e nas esperas curtas. */
    now(): number;
  };
  newSessionId(): string;
  onState(state: P2pConnectionState, reason: P2pFailureReason | null): void;
  /** Mensagem OU confirmacao de leitura: quem recebe despacha pelo `kind`. */
  onMessage(message: WirePacket): void;
  /** Termina de preparar o que a conexão precisa (servidores TURN, por exemplo) antes da primeira tentativa. */
  ready?: Promise<unknown>;
  /** A aba está visível? Só a visível atende uma oferta. */
  isVisible?: () => boolean;
  random?: () => number;
  log?: (event: string, data?: Record<string, unknown>) => void;
  config?: Partial<P2pCoreConfig>;
}

export type P2pCoreConfig = {
  connectTimeoutMs: number;
  disconnectGraceMs: number;
  maxAttempts: number;
  offerCooldownMs: number;
  helloCooldownMs: number;
  rateMax: number;
  rateWindowMs: number;
  maxBufferedNegotiations: number;
  maxBufferedCandidates: number;
};

export const DEFAULT_P2P_CONFIG: P2pCoreConfig = {
  connectTimeoutMs: 20_000,
  disconnectGraceMs: 4_000,
  maxAttempts: 4,
  offerCooldownMs: 2_000,
  helloCooldownMs: 2_000,
  rateMax: 30,
  rateWindowMs: 10_000,
  maxBufferedNegotiations: 4,
  maxBufferedCandidates: 64,
};

export interface P2pCore {
  /** `true` se a mensagem foi entregue ao túnel aberto. */
  sendWire(message: WirePacket): boolean;
  /** Recomeça agora, por vontade da pessoa. */
  reconnect(): void;
  /** A aba voltou a ficar visível: quem ignorou uma oferta pede outra. */
  notifyVisible(): void;
  destroy(): void;
  getState(): { state: P2pConnectionState; reason: P2pFailureReason | null };
  getStats(): { rejectedSignals: number; rejectedWire: number; rateLimited: number; attempts: number };
}

export function createP2pCore(deps: P2pCoreDeps): P2pCore {
  const cfg: P2pCoreConfig = { ...DEFAULT_P2P_CONFIG, ...deps.config };
  const { me, peer, signaling, timers } = deps;
  const random = deps.random ?? Math.random;
  const isInitiator = me < peer;
  const rate = createRateLimiter({ max: cfg.rateMax, windowMs: cfg.rateWindowMs }, () => timers.now());

  let destroyed = false;
  let state: P2pConnectionState = 'idle';
  let reason: P2pFailureReason | null = null;
  let lastFailure: P2pFailureReason = 'signaling';
  let peerOnline = false;
  let presenceKnown = false;
  let pc: RtcPeerLike | null = null;
  let dc: RtcChannelLike | null = null;
  let negotiation: string | null = null;
  let sdpSent = false;
  let gotAnswer = false;
  let remoteDescSet = false;
  let outIce: IceCandidate[] = [];
  const inIce = new Map<string, IceCandidate[]>();
  let attempt = 0;
  let lastOfferAt = -Infinity;
  let lastHelloAt = -Infinity;
  let connectTimer: unknown = null;
  let disconnectTimer: unknown = null;
  let retryTimer: unknown = null;
  let chain: Promise<void> = Promise.resolve();
  const stats = { rejectedSignals: 0, rejectedWire: 0, rateLimited: 0 };

  const log = (event: string, data?: Record<string, unknown>) => deps.log?.(event, data);

  const setState = (next: P2pConnectionState, why: P2pFailureReason | null = null) => {
    if (state === next && reason === why) return;
    state = next;
    reason = why;
    log('state', { state: next, reason: why });
    deps.onState(next, why);
  };

  const clearTimers = () => {
    for (const handle of [connectTimer, disconnectTimer, retryTimer]) if (handle !== null) timers.clearTimeout(handle);
    connectTimer = disconnectTimer = retryTimer = null;
  };

  const teardown = () => {
    const canal = dc;
    const conexao = pc;
    dc = null;
    pc = null;
    negotiation = null;
    sdpSent = false;
    gotAnswer = false;
    remoteDescSet = false;
    outIce = [];
    if (canal) {
      canal.onopen = canal.onclose = canal.onerror = canal.onmessage = null;
      try { canal.close(); } catch { /* já fechado */ }
    }
    if (conexao) {
      conexao.onicecandidate = conexao.onconnectionstatechange = conexao.ondatachannel = null;
      try { conexao.close(); } catch { /* já fechada */ }
    }
  };

  const armConnectTimer = () => {
    if (connectTimer !== null) timers.clearTimeout(connectTimer);
    connectTimer = timers.setTimeout(() => {
      connectTimer = null;
      if (destroyed || state === 'connected') return;
      onFailure(gotAnswer || remoteDescSet ? 'nat' : 'signaling');
    }, cfg.connectTimeoutMs);
  };

  const bufferIncoming = (sessionId: string, candidate: IceCandidate) => {
    let lista = inIce.get(sessionId);
    if (!lista) {
      if (inIce.size >= cfg.maxBufferedNegotiations) {
        const maisAntigo = inIce.keys().next().value;
        if (maisAntigo !== undefined) inIce.delete(maisAntigo);
      }
      lista = [];
      inIce.set(sessionId, lista);
    }
    if (lista.length < cfg.maxBufferedCandidates) lista.push(candidate);
  };

  const flushIncoming = async (sessionId: string, conn: RtcPeerLike) => {
    const lista = inIce.get(sessionId);
    inIce.delete(sessionId);
    for (const candidato of lista ?? []) {
      if (pc !== conn || destroyed) return;
      await conn.addIceCandidate(candidato).catch(() => {});
    }
  };

  const sendIce = (sessionId: string, candidate: IceCandidate) => {
    void signaling.send({ type: 'ice', sessionId, candidate }).catch((err) => log('ice-send-failed', { error: String(err) }));
  };

  const flushOutgoing = (sessionId: string) => {
    const lista = outIce;
    outIce = [];
    for (const candidato of lista) sendIce(sessionId, candidato);
  };

  const markConnected = () => {
    clearTimers();
    attempt = 0;
    setState('connected');
    void signaling.clear().catch(() => {});
  };

  const wireChannel = (channel: RtcChannelLike, conn: RtcPeerLike) => {
    dc = channel;
    channel.onopen = () => {
      if (destroyed || pc !== conn || dc !== channel) return;
      markConnected();
    };
    channel.onclose = channel.onerror = () => {
      if (destroyed || pc !== conn || dc !== channel) return;
      onFailure('closed');
    };
    channel.onmessage = (event) => {
      if (destroyed || dc !== channel) return;
      if (!rate.allow()) {
        stats.rateLimited++;
        log('rate-limited');
        return;
      }
      const result = parseWireData(event.data, { expectedSender: peer, now: timers.now() });
      if (!result.ok) {
        stats.rejectedWire++;
        log('wire-rejected', { reason: result.reason as WireRejection });
        return;
      }
      deps.onMessage(result.message);
    };
  };

  const wirePeer = (conn: RtcPeerLike, sessionId: string) => {
    conn.onicecandidate = (event) => {
      if (destroyed || pc !== conn || !event.candidate) return;
      const candidato = event.candidate.toJSON();
      // Só depois da oferta/resposta: os candidatos nascem durante setLocalDescription e chegariam ANTES dela.
      if (sdpSent) sendIce(sessionId, candidato);
      else outIce.push(candidato);
    };
    conn.onconnectionstatechange = () => {
      if (destroyed || pc !== conn) return;
      const s = conn.connectionState;
      if (s === 'connected') {
        if (disconnectTimer !== null) {
          timers.clearTimeout(disconnectTimer);
          disconnectTimer = null;
        }
      } else if (s === 'disconnected') {
        if (disconnectTimer === null) {
          disconnectTimer = timers.setTimeout(() => {
            disconnectTimer = null;
            if (!destroyed && pc === conn && conn.connectionState !== 'connected') onFailure('nat');
          }, cfg.disconnectGraceMs);
        }
      } else if (s === 'failed') {
        onFailure('nat');
      }
    };
    conn.ondatachannel = (event) => wireChannel(event.channel, conn);
  };

  /** Falhou. Com tentativas sobrando, espera e recomeça (a pessoa vê "conectando"); sem elas, estado final com o motivo. */
  function onFailure(why: P2pFailureReason) {
    if (destroyed) return;
    clearTimers();
    teardown();
    lastFailure = why;
    log('failure', { reason: why, attempt });
    if (!peerOnline) {
      setState('peer-offline');
      return;
    }
    if (attempt >= cfg.maxAttempts) {
      setState('failed', why);
      return;
    }
    const espera = reconnectDelayMs(attempt, random);
    attempt++;
    setState('connecting');
    retryTimer = timers.setTimeout(() => {
      retryTimer = null;
      if (destroyed || !peerOnline) return;
      void startNegotiation();
    }, espera);
  }

  async function startOffer(): Promise<void> {
    if (destroyed || !isInitiator) return;
    await deps.ready?.catch(() => {});
    if (destroyed) return;
    clearTimers();
    teardown();
    const id = deps.newSessionId();
    negotiation = id;
    const conn = deps.createPeer();
    pc = conn;
    wirePeer(conn, id);
    setState('connecting');
    armConnectTimer();
    lastOfferAt = timers.now();
    wireChannel(conn.createDataChannel('exelula-p2p-v1', { ordered: true }), conn);
    try {
      const offer = await conn.createOffer();
      if (pc !== conn || destroyed) return;
      await conn.setLocalDescription(offer);
      if (pc !== conn || destroyed) return;
      await signaling.send({ type: 'offer', sessionId: id, sdp: { type: 'offer', sdp: offer.sdp ?? '' } });
      if (pc !== conn || destroyed) return;
      sdpSent = true;
      flushOutgoing(id);
    } catch (err) {
      log('offer-failed', { error: String(err) });
      if (pc === conn && !destroyed) onFailure('signaling');
    }
  }

  async function sendHello(): Promise<void> {
    if (destroyed) return;
    const agora = timers.now();
    if (agora - lastHelloAt < cfg.helloCooldownMs) return;
    lastHelloAt = agora;
    await deps.ready?.catch(() => {});
    if (destroyed) return;
    try {
      await signaling.send({ type: 'hello', sessionId: deps.newSessionId() });
    } catch (err) {
      log('hello-failed', { error: String(err) });
    }
  }

  /** Começa (ou recomeça) uma negociação: o iniciador oferece; o outro lado avisa que está pronto. */
  async function startNegotiation(): Promise<void> {
    if (destroyed || !peerOnline) return;
    if (isInitiator) await startOffer();
    else {
      setState('connecting');
      armConnectTimer();
      await sendHello();
    }
  }

  const begin = () => {
    if (destroyed || !peerOnline) return;
    void startNegotiation();
  };

  async function handleSignal(signal: P2pSignal): Promise<void> {
    if (destroyed) return;
    switch (signal.type) {
      case 'hello': {
        if (!isInitiator || !peerOnline || state === 'connected') return;
        const agora = timers.now();
        if (state === 'connecting' && negotiation !== null && agora - lastOfferAt < cfg.offerCooldownMs) return;
        await startOffer();
        return;
      }
      case 'offer': {
        if (isInitiator || !signal.sdp) return;
        if (signal.sessionId === negotiation) return; // entrega duplicada da mesma oferta
        if (deps.isVisible && !deps.isVisible()) {
          log('offer-ignored-hidden');
          return;
        }
        await deps.ready?.catch(() => {});
        if (destroyed) return;
        clearTimers();
        teardown();
        negotiation = signal.sessionId;
        const id = signal.sessionId;
        const conn = deps.createPeer();
        pc = conn;
        wirePeer(conn, id);
        setState('connecting');
        armConnectTimer();
        try {
          await conn.setRemoteDescription(signal.sdp);
          if (pc !== conn || destroyed) return;
          remoteDescSet = true;
          await flushIncoming(id, conn);
          const answer = await conn.createAnswer();
          if (pc !== conn || destroyed) return;
          await conn.setLocalDescription(answer);
          if (pc !== conn || destroyed) return;
          await signaling.send({ type: 'answer', sessionId: id, sdp: { type: 'answer', sdp: answer.sdp ?? '' } });
          if (pc !== conn || destroyed) return;
          sdpSent = true;
          flushOutgoing(id);
        } catch (err) {
          log('answer-failed', { error: String(err) });
          if (pc === conn && !destroyed) onFailure('signaling');
        }
        return;
      }
      case 'answer': {
        const conn = pc;
        if (!isInitiator || !conn || !signal.sdp || signal.sessionId !== negotiation) return;
        if (conn.signalingState !== 'have-local-offer') return;
        try {
          await conn.setRemoteDescription(signal.sdp);
          if (pc !== conn || destroyed) return;
          gotAnswer = true;
          remoteDescSet = true;
          await flushIncoming(signal.sessionId, conn);
        } catch (err) {
          log('answer-apply-failed', { error: String(err) });
          if (pc === conn && !destroyed) onFailure('signaling');
        }
        return;
      }
      case 'ice': {
        if (!signal.candidate) return;
        if (pc && signal.sessionId === negotiation && remoteDescSet) {
          await pc.addIceCandidate(signal.candidate).catch(() => {});
        } else {
          bufferIncoming(signal.sessionId, signal.candidate);
        }
        return;
      }
    }
  }

  const stopSignals = signaling.listen((raw) => {
    if (destroyed) return;
    const result = parseSignal(raw, { expectedFrom: peer, serverNow: signaling.serverNow() });
    if (!result.ok) {
      stats.rejectedSignals++;
      log('signal-rejected', { reason: result.reason as SignalRejection });
      return;
    }
    // Um sinal por vez, na ordem de chegada: a oferta precisa estar aplicada antes do primeiro candidato.
    chain = chain.then(() => handleSignal(result.signal)).catch((err) => log('signal-error', { error: String(err) }));
  });

  const stopPresence = deps.presence.watch((online) => {
    if (destroyed) return;
    if (presenceKnown && online === peerOnline) return; // abrir outra aba do contato muda o nó, mas não a presença
    presenceKnown = true;
    peerOnline = online;
    if (!online) {
      if (dc?.readyState === 'open') return; // o túnel aberto não depende do WebSocket de presença
      clearTimers();
      teardown();
      setState('peer-offline');
      return;
    }
    if (state === 'connected' && dc?.readyState === 'open') return;
    attempt = 0;
    begin();
  });

  return {
    sendWire(message) {
      const canal = dc;
      if (destroyed || !canal || canal.readyState !== 'open') return false;
      try {
        canal.send(JSON.stringify(message));
        return true;
      } catch {
        return false;
      }
    },
    reconnect() {
      if (destroyed) return;
      attempt = 0;
      clearTimers();
      teardown();
      if (peerOnline) begin();
      else setState('peer-offline');
    },
    notifyVisible() {
      if (destroyed || !peerOnline || state === 'connected') return;
      // Aba que acabou de aparecer: quem não atendeu antes pede outra oferta; o iniciador simplesmente tenta de novo.
      if (isInitiator) void startOffer();
      else void sendHello();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimers();
      stopSignals();
      stopPresence();
      teardown();
      void signaling.clear().catch(() => {});
    },
    getState: () => ({ state, reason }),
    getStats: () => ({ ...stats, attempts: attempt }),
  };
}
