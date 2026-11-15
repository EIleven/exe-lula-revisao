'use client';

// src/lib/p2p/p2pChannel.ts
// A ponta do NAVEGADOR do canal P2P (Zero DB): liga o motor da sessão (p2pSession.ts, testado em Node com conexões falsas) ao
// Realtime Database (só para a sinalização efêmera), ao RTCPeerConnection real e ao histórico local. A API pública continua a
// mesma (`createP2pSession`, `loadLocalP2pMessages`...) para as telas; a lógica de negociação, tentativas e validação está
// no motor e no protocolo.
import { get, getDatabase, onChildAdded, onDisconnect, onValue, push, ref, remove, serverTimestamp, set } from 'firebase/database';
import { auth } from '@/lib/firebase';
import type { DirectMessage, E2eeMessagePayload, User } from '@/lib/types';
import { decryptDirectMessage, encryptDirectMessage, ensureUserE2eeKeyPair } from '@/lib/crypto/e2ee';
import { MAX_TEXT_CHARS, toIceServers, type IceConfig, type WireMessage } from './p2pProtocol';
import {
  createP2pCore,
  type OutgoingSignal,
  type P2pConnectionState,
  type P2pFailureReason,
  type RtcPeerLike,
} from './p2pSession';
import { deleteMessage, loadConversation, saveMessage, updateMessageStatus, type StorageLike, type StoredP2pMessage } from './p2pLocalStore';

export type { P2pConnectionState, P2pFailureReason };

export type LocalP2pMessage = DirectMessage & {
  isP2p?: boolean;
  p2pStatus?: 'queued' | 'sent';
};

const ENCRYPTED_PLACEHOLDER = '🔒 Mensagem P2P criptografada (chave indisponível neste dispositivo)';

const localStore = (): StorageLike | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

// ───────────────────────── Servidores ICE ─────────────────────────

const ICE_CACHE_MS = 10 * 60_000;
let iceCache: { at: number; value: IceConfig } | null = null;

/** STUN e, se o servidor tiver TURN configurado, um relay com credencial temporária. Qualquer falha cai para só STUN. */
async function loadIceConfig(): Promise<IceConfig | null> {
  if (iceCache && Date.now() - iceCache.at < ICE_CACHE_MS) return iceCache.value;
  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return null;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 3_000);
    const res = await fetch('/api/p2p/ice', { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: 'no-store' });
    window.clearTimeout(timer);
    if (!res.ok) return null;
    const body = (await res.json()) as { stun?: unknown; turn?: { urls?: unknown; username?: unknown; credential?: unknown } | null };
    const cfg: IceConfig = {
      stun: Array.isArray(body.stun) ? body.stun.filter((u): u is string => typeof u === 'string') : [],
      turn:
        body.turn && Array.isArray(body.turn.urls) && typeof body.turn.username === 'string' && typeof body.turn.credential === 'string'
          ? { urls: body.turn.urls.filter((u): u is string => typeof u === 'string'), username: body.turn.username, credential: body.turn.credential }
          : null,
    };
    iceCache = { at: Date.now(), value: cfg };
    return cfg;
  } catch {
    return null;
  }
}

// ───────────────────────── Histórico local ─────────────────────────

export function deleteLocalP2pMessage(currentUserId: string, conversationId: string, messageId: string): void {
  const store = localStore();
  if (store) deleteMessage(store, currentUserId, conversationId, messageId);
}

const toLocalMessage = (
  m: StoredP2pMessage,
  conversationId: string,
  text: string,
  mine: boolean,
  users: { currentUser: User; otherUser: User },
): LocalP2pMessage => ({
  id: m.id,
  conversationId,
  senderId: m.senderId,
  sender: mine ? users.currentUser : users.otherUser,
  text,
  e2ee: m.e2ee,
  createdAt: m.createdAt,
  readAt: m.createdAt,
  parentMessageId: m.parentMessageId,
  parentMessageText: m.parentMessageText,
  parentMessageSenderName: m.parentMessageSenderName,
  isP2p: true,
  p2pStatus: m.p2pStatus ?? 'sent',
});

/**
 * O histórico P2P deste aparelho, pronto para a tela: o remetente vem dos usuários da conversa (o registro guardado não leva
 * o perfil embutido) e o que está só cifrado é decifrado aqui (ou mostra o aviso, se a chave não estiver neste aparelho).
 */
export async function loadHydratedP2pMessages(params: {
  currentUser: User;
  otherUser: User;
  conversationId: string;
}): Promise<LocalP2pMessage[]> {
  const store = localStore();
  if (!store) return [];
  const { currentUser, otherUser, conversationId } = params;
  const guardadas = loadConversation(store, currentUser.id, conversationId);
  return Promise.all(
    guardadas.map(async (m) => {
      const mine = m.senderId === currentUser.id;
      let text = m.text ?? '';
      if (!text && m.e2ee) {
        const dec = await decryptDirectMessage(m.e2ee, currentUser.id, mine, otherUser.e2eePublicKey).catch(() => null);
        text = dec?.ok ? dec.text : ENCRYPTED_PLACEHOLDER;
      }
      return toLocalMessage(m, conversationId, text, mine, { currentUser, otherUser });
    }),
  );
}

export async function syncP2pHistoryToOwnDevices(
  currentUserId: string,
  conversationId: string,
): Promise<void> {
  const store = localStore();
  if (!store || !currentUserId || !conversationId) return;
  try {
    const guardadas = loadConversation(store, currentUserId, conversationId).slice(-100);
    const db = getDatabase();
    const res = await ensureUserE2eeKeyPair(currentUserId);
    if (res?.publicKeyJson) {
      const payload = await encryptDirectMessage(JSON.stringify(guardadas), currentUserId, res.publicKeyJson);
      if (payload) {
        await set(ref(db, `p2pDeviceSync/${currentUserId}/${conversationId}`), {
          e2ee: payload,
          updatedAt: Date.now(),
        });
        return;
      }
    }
    await set(ref(db, `p2pDeviceSync/${currentUserId}/${conversationId}`), {
      items: guardadas,
      updatedAt: Date.now(),
    });
  } catch {
    // silencioso se não estiver autenticado no RTDB
  }
}

async function applyDeviceSyncSnapshot(
  store: StorageLike,
  currentUserId: string,
  conversationId: string,
  val: { e2ee?: E2eeMessagePayload; items?: StoredP2pMessage[] } | null,
): Promise<boolean> {
  if (!val) return false;
  let list: StoredP2pMessage[] | null = null;
  if (val.e2ee) {
    const res = await ensureUserE2eeKeyPair(currentUserId);
    const dec = await decryptDirectMessage(val.e2ee, currentUserId, true, res?.publicKeyJson).catch(() => null);
    if (dec?.ok) {
      const parsed = JSON.parse(dec.text) as StoredP2pMessage[];
      if (Array.isArray(parsed)) list = parsed;
    }
  } else if (Array.isArray(val.items)) {
    list = val.items;
  }
  if (!list) return false;
  let changed = false;
  const existentes = new Map(loadConversation(store, currentUserId, conversationId).map((m) => [m.id, m]));
  for (const item of list) {
    const prev = existentes.get(item.id);
    if (!prev) {
      if (saveMessage(store, currentUserId, conversationId, item).inserted) changed = true;
    } else if (prev.p2pStatus === 'queued' && item.p2pStatus === 'sent') {
      updateMessageStatus(store, currentUserId, conversationId, item.id, 'sent');
      changed = true;
    }
  }
  return changed;
}

export async function loadP2pHistoryFromOwnDevices(
  currentUserId: string,
  conversationId: string,
  currentUser: User,
  otherUser: User,
): Promise<LocalP2pMessage[]> {
  const store = localStore();
  if (!store || !currentUserId || !conversationId) return [];
  try {
    const db = getDatabase();
    const snap = await get(ref(db, `p2pDeviceSync/${currentUserId}/${conversationId}`));
    if (snap.exists()) {
      await applyDeviceSyncSnapshot(
        store,
        currentUserId,
        conversationId,
        snap.val() as { e2ee?: E2eeMessagePayload; items?: StoredP2pMessage[] } | null,
      );
    }
  } catch {
    // fallback para histórico local já salvo
  }
  return loadHydratedP2pMessages({ currentUser, otherUser, conversationId });
}

export function watchOwnDevicesP2pHistory(
  currentUserId: string,
  conversationId: string,
  currentUser: User,
  otherUser: User,
  onSynced: (messages: LocalP2pMessage[]) => void,
): () => void {
  const store = localStore();
  if (!store || !currentUserId || !conversationId) return () => {};
  const db = getDatabase();
  const syncRef = ref(db, `p2pDeviceSync/${currentUserId}/${conversationId}`);
  return onValue(syncRef, (snap) => {
    if (!snap.exists()) return;
    void applyDeviceSyncSnapshot(
      store,
      currentUserId,
      conversationId,
      snap.val() as { e2ee?: E2eeMessagePayload; items?: StoredP2pMessage[] } | null,
    ).then(async (changed) => {
      if (!changed) return;
      const hydrated = await loadHydratedP2pMessages({ currentUser, otherUser, conversationId });
      onSynced(hydrated);
    });
  });
}

// ───────────────────────── Sessão ─────────────────────────

export interface P2pSessionController {
  sendText: (
    text: string,
    replyMeta?: {
      parentMessageId?: string | null;
      parentMessageText?: string | null;
      parentMessageSenderName?: string | null;
    },
  ) => Promise<LocalP2pMessage | null>;
  reconnect: () => void;
  destroy: () => void;
}

/**
 * Sessão WebRTC DataChannel dispositivo-a-dispositivo (Zero DB). O Realtime Database só leva a sinalização efêmera (SDP/ICE),
 * apagada assim que o túnel abre; nada de mensagem passa por ele.
 */
export function createP2pSession(params: {
  conversationId: string;
  currentUserId: string;
  otherUser: User;
  currentUser: User;
  /** `true`: só usa relay (TURN), escondendo o seu IP do contato. Sem TURN configurado no servidor, não conecta. */
  relayOnly?: boolean;
  onStateChange: (state: P2pConnectionState) => void;
  /** O mesmo estado com o MOTIVO da falha (rede restritiva x contato sem resposta), para a tela explicar. */
  onStateDetail?: (state: P2pConnectionState, reason: P2pFailureReason | null) => void;
  onMessage: (message: LocalP2pMessage) => void;
  onMessageUpdated?: (message: LocalP2pMessage) => void;
}): P2pSessionController {
  const { conversationId, currentUserId, otherUser, currentUser, onStateChange, onStateDetail, onMessage, onMessageUpdated } = params;
  const otherUserId = otherUser.id;

  if (typeof window === 'undefined' || currentUserId === otherUserId || otherUserId.startsWith('ap_')) {
    onStateChange('offline');
    return { sendText: async () => null, reconnect: () => {}, destroy: () => {} };
  }
  if (typeof RTCPeerConnection === 'undefined') {
    onStateChange('unsupported');
    onStateDetail?.('unsupported', null);
    return { sendText: async () => null, reconnect: () => {}, destroy: () => {} };
  }

  const db = getDatabase();
  const mySlot = ref(db, `p2pSignals/${conversationId}/${currentUserId}`);
  const peerSlot = ref(db, `p2pSignals/${conversationId}/${otherUserId}`);
  const peerPresence = ref(db, `status/${otherUserId}/connections`);

  // Hora do servidor: o carimbo dos sinais é o do servidor, então relógio errado num aparelho não derruba a conexão.
  let serverOffset = 0;
  const stopOffset = onValue(ref(db, '.info/serverTimeOffset'), (snap) => {
    const v = snap.val();
    if (typeof v === 'number' && Number.isFinite(v)) serverOffset = v;
  });
  const serverNow = () => Date.now() + serverOffset;

  const mine = new Set<string>();
  const signaling = {
    async send(signal: OutgoingSignal) {
      const node = push(mySlot);
      if (node.key) mine.add(node.key);
      void onDisconnect(node).remove().catch(() => {});
      await set(node, { ...signal, from: currentUserId, ts: serverTimestamp() });
    },
    listen(onSignal: (raw: unknown) => void) {
      return onChildAdded(peerSlot, (snap) => onSignal(snap.val()));
    },
    async clear() {
      const keys = [...mine];
      mine.clear();
      await Promise.all(keys.map((k) => remove(ref(db, `p2pSignals/${conversationId}/${currentUserId}/${k}`)).catch(() => {})));
    },
    serverNow,
  };

  // Sinal velho deixado por uma sessão que caiu sem limpar (aba fechada à força): varre os MEUS, nunca os do contato.
  void get(mySlot)
    .then((snap) => {
      snap.forEach((filho) => {
        const ts = (filho.val() as { ts?: unknown } | null)?.ts;
        if (typeof ts !== 'number' || serverNow() - ts > 120_000) void remove(filho.ref).catch(() => {});
      });
    })
    .catch(() => {});

  const presence = {
    watch(onChange: (online: boolean) => void) {
      return onValue(peerPresence, (snap) => onChange(snap.exists()), () => onChange(false));
    },
  };

  let iceServers = toIceServers(null);
  let hasTurn = false;
  const ready = loadIceConfig().then((cfg) => {
    iceServers = toIceServers(cfg);
    hasTurn = Boolean(cfg?.turn);
  });

  const newSessionId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const store = localStore();

  const handleIncoming = async (wire: WireMessage) => {
    const registro: StoredP2pMessage = {
      id: wire.id,
      senderId: otherUserId,
      createdAt: wire.createdAt,
      p2pStatus: 'sent',
      ...(wire.e2ee ? { e2ee: wire.e2ee } : { text: wire.text }),
      ...(wire.parentMessageId ? { parentMessageId: wire.parentMessageId } : {}),
      ...(wire.parentMessageText ? { parentMessageText: wire.parentMessageText } : {}),
      ...(wire.parentMessageSenderName ? { parentMessageSenderName: wire.parentMessageSenderName } : {}),
    };
    // Mensagem repetida (o contato reenviou, ou a rede entregou duas vezes) não vira duas.
    if (store && !saveMessage(store, currentUserId, conversationId, registro).inserted) return;

    let text = wire.text ?? '';
    if (wire.e2ee) {
      const dec = await decryptDirectMessage(wire.e2ee, currentUserId, false, otherUser.e2eePublicKey).catch(() => null);
      text = dec?.ok ? dec.text : ENCRYPTED_PLACEHOLDER;
    }
    onMessage(toLocalMessage(registro, conversationId, text, false, { currentUser, otherUser }));
    void syncP2pHistoryToOwnDevices(currentUserId, conversationId);
  };

  const flushQueued = async () => {
    if (!store) return;
    const pendentes = loadConversation(store, currentUserId, conversationId)
      .filter((m) => m.senderId === currentUserId && m.p2pStatus === 'queued')
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    let flushedAny = false;
    for (const m of pendentes) {
      const wire: WireMessage = {
        v: 1,
        kind: 'dm',
        id: m.id,
        senderId: currentUserId,
        createdAt: m.createdAt,
        ...(m.e2ee ? { e2ee: m.e2ee } : { text: m.text ?? '' }),
        ...(m.parentMessageId
          ? {
              parentMessageId: m.parentMessageId,
              ...(m.parentMessageText ? { parentMessageText: m.parentMessageText } : {}),
              ...(m.parentMessageSenderName ? { parentMessageSenderName: m.parentMessageSenderName } : {}),
            }
          : {}),
      };
      if (!core.sendWire(wire)) break;
      const updatedRegistro: StoredP2pMessage = { ...m, p2pStatus: 'sent' };
      updateMessageStatus(store, currentUserId, conversationId, m.id, 'sent');
      let text = m.text ?? '';
      if (!text && m.e2ee) {
        const dec = await decryptDirectMessage(m.e2ee, currentUserId, true, otherUser.e2eePublicKey).catch(() => null);
        text = dec?.ok ? dec.text : ENCRYPTED_PLACEHOLDER;
      }
      onMessageUpdated?.(toLocalMessage(updatedRegistro, conversationId, text, true, { currentUser, otherUser }));
      flushedAny = true;
    }
    if (flushedAny) {
      void syncP2pHistoryToOwnDevices(currentUserId, conversationId);
    }
  };

  const core = createP2pCore({
    me: currentUserId,
    peer: otherUserId,
    signaling,
    presence,
    ready,
    createPeer: () =>
      new RTCPeerConnection({
        iceServers,
        // "Ocultar meu IP": só relay. Sem TURN configurado isso impediria qualquer conexão; então só vale com TURN.
        ...(params.relayOnly && hasTurn ? { iceTransportPolicy: 'relay' as RTCIceTransportPolicy } : {}),
      }) as unknown as RtcPeerLike,
    timers: {
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (handle) => window.clearTimeout(handle as number),
      now: () => Date.now(),
    },
    newSessionId,
    isVisible: () => document.visibilityState === 'visible',
    onState: (state, reason) => {
      onStateChange(state);
      onStateDetail?.(state, reason);
      if (state === 'connected') {
        void flushQueued();
      }
    },
    onMessage: (wire) => void handleIncoming(wire),
    log: (event, data) => {
      if (process.env.NODE_ENV !== 'production') console.debug('[P2P]', event, data ?? '');
    },
  });

  const onVisibility = () => {
    if (document.visibilityState === 'visible') core.notifyVisible();
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    sendText: async (text, replyMeta) => {
      if (typeof text !== 'string' || text.trim().length === 0 || text.length > MAX_TEXT_CHARS) return null;

      // Se o contato tem chave E2EE, a mensagem VAI cifrada ou NÃO VAI: nunca cai para texto claro por falha silenciosa.
      let e2ee: Awaited<ReturnType<typeof encryptDirectMessage>> = null;
      if (otherUser.e2eePublicKey) {
        e2ee = await encryptDirectMessage(text, currentUserId, otherUser.e2eePublicKey).catch(() => null);
        if (!e2ee) return null;
      }

      const id = `p2p_${Date.now()}_${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`;
      const createdAt = new Date().toISOString();
      const parent = replyMeta?.parentMessageId
        ? {
            parentMessageId: replyMeta.parentMessageId,
            ...(replyMeta.parentMessageText ? { parentMessageText: replyMeta.parentMessageText.slice(0, 500) } : {}),
            ...(replyMeta.parentMessageSenderName ? { parentMessageSenderName: replyMeta.parentMessageSenderName.slice(0, 500) } : {}),
          }
        : {};
      const wire: WireMessage = {
        v: 1,
        kind: 'dm',
        id,
        senderId: currentUserId,
        createdAt,
        ...(e2ee ? { e2ee } : { text }),
        ...parent,
      };
      const sentNow = core.sendWire(wire);

      const registro: StoredP2pMessage = {
        id,
        senderId: currentUserId,
        createdAt,
        p2pStatus: sentNow ? 'sent' : 'queued',
        ...(e2ee ? { e2ee } : { text }),
        ...parent,
      };
      if (store) saveMessage(store, currentUserId, conversationId, registro);
      void syncP2pHistoryToOwnDevices(currentUserId, conversationId);
      return toLocalMessage(registro, conversationId, text, true, { currentUser, otherUser });
    },
    reconnect: () => core.reconnect(),
    destroy: () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stopOffset();
      core.destroy();
    },
  };
}
