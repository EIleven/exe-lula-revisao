'use client';

import {
  getDatabase,
  onChildAdded,
  onDisconnect,
  onValue,
  push,
  ref,
  remove,
  set,
} from 'firebase/database';
import type { User } from '@/lib/types';
import { MAX_TEXT_CHARS } from './p2pProtocol';
import {
  loadP2pHistoryFromOwnDevices,
  syncP2pHistoryToOwnDevices,
  watchOwnDevicesP2pHistory,
  type LocalP2pMessage,
} from './p2pChannel';
import {
  deleteMessage,
  loadConversation,
  saveMessage,
  updateMessageStatus,
  type StorageLike,
  type StoredP2pMessage,
} from './p2pLocalStore';

const MAX_GROUP_PEERS = 8;
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

type GroupSignal = {
  from: string;
  sessionId: string;
  type: 'offer' | 'answer' | 'ice';
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  ts: number;
};

type GroupWireMessage = {
  v: 1;
  kind: 'group_dm';
  id: string;
  senderId: string;
  senderName?: string;
  senderAvatar?: string;
  createdAt: string;
  text: string;
  parentMessageId?: string | null;
  parentMessageText?: string | null;
  parentMessageSenderName?: string | null;
};

export interface P2pGroupSessionController {
  sendText: (
    text: string,
    replyMeta?: {
      parentMessageId?: string | null;
      parentMessageText?: string | null;
      parentMessageSenderName?: string | null;
    },
  ) => Promise<LocalP2pMessage | null>;
  destroy: () => void;
}

const localStore = (): StorageLike | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

export async function loadGroupP2pHistory(params: {
  conversationId: string;
  currentUser: User;
  participantsById: Record<string, User>;
}): Promise<LocalP2pMessage[]> {
  const { conversationId, currentUser, participantsById } = params;
  const fallbackUser: User = {
    id: 'group_peer',
    name: 'Participante',
    username: 'participante',
    email: '',
    avatarUrl: '',
    followersCount: 0,
    followingCount: 0,
    postsCount: 0,
    isAdmin: false,
    isModerator: false,
    dmPreference: 'everyone',
    profileVisibility: 'public',
    createdAt: new Date().toISOString(),
  };
  const list = await loadP2pHistoryFromOwnDevices(
    currentUser.id,
    conversationId,
    currentUser,
    fallbackUser,
  );
  return list.map((m) => ({
    ...m,
    sender: participantsById[m.senderId] || m.sender || fallbackUser,
  }));
}

export function deleteGroupLocalP2pMessage(
  currentUserId: string,
  conversationId: string,
  messageId: string,
): void {
  const store = localStore();
  if (store) deleteMessage(store, currentUserId, conversationId, messageId);
}

export function createP2pGroupSession(params: {
  conversationId: string;
  currentUser: User;
  participantsById: Record<string, User>;
  onConnectedCountChange: (count: number) => void;
  onMessage: (message: LocalP2pMessage) => void;
  onMessageUpdated: (message: LocalP2pMessage) => void;
  onSyncedList: (messages: LocalP2pMessage[]) => void;
}): P2pGroupSessionController {
  const {
    conversationId,
    currentUser,
    participantsById,
    onConnectedCountChange,
    onMessage,
    onMessageUpdated,
    onSyncedList,
  } = params;
  const currentUserId = currentUser.id;
  const store = localStore();

  if (typeof window === 'undefined' || typeof RTCPeerConnection === 'undefined') {
    onConnectedCountChange(0);
    return { sendText: async () => null, destroy: () => {} };
  }

  const db = getDatabase();
  const presenceListRef = ref(db, `p2pGroupPresence/${conversationId}`);
  const myPresenceRef = ref(db, `p2pGroupPresence/${conversationId}/${currentUserId}`);
  const myInboxSignalsRef = ref(db, `p2pGroupSignals/${conversationId}/${currentUserId}`);
  const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  let destroyed = false;
  const peers = new Map<
    string,
    {
      pc: RTCPeerConnection;
      dc: RTCDataChannel | null;
      pendingIce: RTCIceCandidateInit[];
      peerSessionId: string | null;
    }
  >();

  const updateCount = () => {
    let open = 0;
    for (const p of peers.values()) {
      if (p.dc?.readyState === 'open') open += 1;
    }
    onConnectedCountChange(open);
  };

  const fallbackPeerUser = (uid: string, name?: string, avatar?: string): User =>
    participantsById[uid] || {
      id: uid,
      name: name || 'Participante',
      username: 'participante',
      email: '',
      avatarUrl: avatar || '',
      followersCount: 0,
      followingCount: 0,
      postsCount: 0,
      isAdmin: false,
      isModerator: false,
      dmPreference: 'everyone',
      profileVisibility: 'public',
      createdAt: new Date().toISOString(),
    };

  const stopOwnSync = watchOwnDevicesP2pHistory(
    currentUserId,
    conversationId,
    currentUser,
    fallbackPeerUser('group_peer'),
    (msgs) => {
      if (destroyed) return;
      onSyncedList(
        msgs.map((m) => ({
          ...m,
          sender: participantsById[m.senderId] || m.sender,
        })),
      );
    },
  );

  const sendSignalTo = async (
    targetUid: string,
    payload: Omit<GroupSignal, 'from' | 'sessionId' | 'ts'>,
  ) => {
    if (destroyed) return;
    try {
      const slot = ref(db, `p2pGroupSignals/${conversationId}/${targetUid}/${currentUserId}`);
      await push(slot, {
        ...payload,
        from: currentUserId,
        sessionId,
        ts: Date.now(),
      } satisfies GroupSignal);
    } catch {
      // ignore signaling error
    }
  };

  const flushQueuedToOpenPeers = () => {
    if (!store || destroyed) return;
    const openChannels = Array.from(peers.values())
      .map((p) => p.dc)
      .filter((dc): dc is RTCDataChannel => Boolean(dc && dc.readyState === 'open'));
    if (openChannels.length === 0) return;

    const queued = loadConversation(store, currentUserId, conversationId)
      .filter((m) => m.senderId === currentUserId && m.p2pStatus === 'queued')
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

    let flushed = false;
    for (const m of queued) {
      const wire: GroupWireMessage = {
        v: 1,
        kind: 'group_dm',
        id: m.id,
        senderId: currentUserId,
        senderName: currentUser.name,
        senderAvatar: currentUser.avatarUrl,
        createdAt: m.createdAt,
        text: m.text || '',
        ...(m.parentMessageId
          ? {
              parentMessageId: m.parentMessageId,
              parentMessageText: m.parentMessageText || null,
              parentMessageSenderName: m.parentMessageSenderName || null,
            }
          : {}),
      };
      const raw = JSON.stringify(wire);
      let delivered = false;
      for (const dc of openChannels) {
        try {
          dc.send(raw);
          delivered = true;
        } catch {
          // ignore
        }
      }
      if (delivered) {
        updateMessageStatus(store, currentUserId, conversationId, m.id, 'sent');
        onMessageUpdated({
          id: m.id,
          conversationId,
          senderId: currentUserId,
          sender: currentUser,
          text: m.text || '',
          createdAt: m.createdAt,
          readAt: m.createdAt,
          parentMessageId: m.parentMessageId,
          parentMessageText: m.parentMessageText,
          parentMessageSenderName: m.parentMessageSenderName,
          isP2p: true,
          p2pStatus: 'sent',
        });
        flushed = true;
      }
    }
    if (flushed) {
      void syncP2pHistoryToOwnDevices(currentUserId, conversationId);
    }
  };

  const wireDataChannel = (peerUid: string, dc: RTCDataChannel) => {
    const entry = peers.get(peerUid);
    if (!entry) return;
    entry.dc = dc;
    dc.onopen = () => {
      if (destroyed) return;
      updateCount();
      flushQueuedToOpenPeers();
    };
    dc.onclose = () => {
      if (destroyed) return;
      updateCount();
    };
    dc.onerror = () => {
      if (destroyed) return;
      updateCount();
    };
    dc.onmessage = (event) => {
      if (destroyed || typeof event.data !== 'string') return;
      try {
        const wire = JSON.parse(event.data) as GroupWireMessage;
        if (wire?.v !== 1 || wire.kind !== 'group_dm' || wire.senderId !== peerUid) return;
        const text = typeof wire.text === 'string' ? wire.text.slice(0, MAX_TEXT_CHARS) : '';
        if (!text) return;
        const registro: StoredP2pMessage = {
          id: wire.id,
          senderId: peerUid,
          text,
          createdAt: wire.createdAt || new Date().toISOString(),
          p2pStatus: 'sent',
          ...(wire.parentMessageId ? { parentMessageId: wire.parentMessageId } : {}),
          ...(wire.parentMessageText ? { parentMessageText: wire.parentMessageText } : {}),
          ...(wire.parentMessageSenderName ? { parentMessageSenderName: wire.parentMessageSenderName } : {}),
        };
        if (store && !saveMessage(store, currentUserId, conversationId, registro).inserted) return;
        onMessage({
          id: registro.id,
          conversationId,
          senderId: peerUid,
          sender: fallbackPeerUser(peerUid, wire.senderName, wire.senderAvatar),
          text,
          createdAt: registro.createdAt,
          readAt: new Date().toISOString(),
          parentMessageId: registro.parentMessageId,
          parentMessageText: registro.parentMessageText,
          parentMessageSenderName: registro.parentMessageSenderName,
          isP2p: true,
          p2pStatus: 'sent',
        });
        void syncP2pHistoryToOwnDevices(currentUserId, conversationId);
      } catch {
        // ignore invalid packet
      }
    };
  };

  const ensurePeer = (peerUid: string, initiate: boolean) => {
    if (destroyed || peerUid === currentUserId) return peers.get(peerUid) ?? null;
    const existing = peers.get(peerUid);
    if (existing) return existing;
    if (peers.size >= MAX_GROUP_PEERS) return null;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const entry = { pc, dc: null as RTCDataChannel | null, pendingIce: [] as RTCIceCandidateInit[], peerSessionId: null as string | null };
    peers.set(peerUid, entry);

    pc.onicecandidate = (e) => {
      if (e.candidate && !destroyed) {
        void sendSignalTo(peerUid, { type: 'ice', candidate: e.candidate.toJSON() });
      }
    };
    pc.ondatachannel = (e) => {
      wireDataChannel(peerUid, e.channel);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        try {
          pc.close();
        } catch {
          // ignore
        }
        peers.delete(peerUid);
        updateCount();
      }
    };

    if (initiate) {
      const dc = pc.createDataChannel('exelula-group-p2p', { ordered: true });
      wireDataChannel(peerUid, dc);
      void pc
        .createOffer()
        .then((offer) => pc.setLocalDescription(offer).then(() => offer))
        .then((offer) => sendSignalTo(peerUid, { type: 'offer', sdp: offer }))
        .catch(() => {});
    }
    return entry;
  };

  // Presença no grupo
  void set(myPresenceRef, { online: true, ts: Date.now() }).catch(() => {});
  try {
    void onDisconnect(myPresenceRef).remove();
    void onDisconnect(myInboxSignalsRef).remove();
  } catch {
    // ignore
  }

  const stopPresence = onValue(presenceListRef, (snap) => {
    if (destroyed) return;
    const val = (snap.val() || {}) as Record<string, unknown>;
    const activeIds = Object.keys(val).filter((uid) => uid !== currentUserId).slice(0, MAX_GROUP_PEERS);
    for (const peerUid of activeIds) {
      if (currentUserId < peerUid) {
        ensurePeer(peerUid, true);
      }
    }
  });

  const stopSignals = onChildAdded(myInboxSignalsRef, (senderSnap) => {
    const peerUid = senderSnap.key;
    if (!peerUid || peerUid === currentUserId || destroyed) return;
    onChildAdded(senderSnap.ref, async (sigSnap) => {
      const sig = sigSnap.val() as GroupSignal | null;
      void remove(sigSnap.ref).catch(() => {});
      if (!sig || sig.from !== peerUid || Date.now() - (sig.ts || 0) > 60_000) return;

      if (sig.type === 'offer' && sig.sdp) {
        const entry = ensurePeer(peerUid, false);
        if (!entry) return;
        entry.peerSessionId = sig.sessionId;
        try {
          await entry.pc.setRemoteDescription(new RTCSessionDescription(sig.sdp));
          for (const c of entry.pendingIce.splice(0)) {
            await entry.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
          }
          const ans = await entry.pc.createAnswer();
          await entry.pc.setLocalDescription(ans);
          await sendSignalTo(peerUid, { type: 'answer', sdp: ans });
        } catch {
          // ignore
        }
      } else if (sig.type === 'answer' && sig.sdp) {
        const entry = peers.get(peerUid);
        if (!entry) return;
        try {
          if (entry.pc.signalingState === 'have-local-offer') {
            await entry.pc.setRemoteDescription(new RTCSessionDescription(sig.sdp));
            for (const c of entry.pendingIce.splice(0)) {
              await entry.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
            }
          }
        } catch {
          // ignore
        }
      } else if (sig.type === 'ice' && sig.candidate) {
        const entry = peers.get(peerUid);
        if (!entry) return;
        if (entry.pc.remoteDescription) {
          await entry.pc.addIceCandidate(new RTCIceCandidate(sig.candidate)).catch(() => {});
        } else {
          entry.pendingIce.push(sig.candidate);
        }
      }
    });
  });

  return {
    sendText: async (text, replyMeta) => {
      if (!text.trim() || text.length > MAX_TEXT_CHARS) return null;
      const id = `p2p_${Date.now()}_${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`;
      const createdAt = new Date().toISOString();
      const openChannels = Array.from(peers.values())
        .map((p) => p.dc)
        .filter((dc): dc is RTCDataChannel => Boolean(dc && dc.readyState === 'open'));

      let sentToAny = false;
      if (openChannels.length > 0) {
        const wire: GroupWireMessage = {
          v: 1,
          kind: 'group_dm',
          id,
          senderId: currentUserId,
          senderName: currentUser.name,
          senderAvatar: currentUser.avatarUrl,
          createdAt,
          text,
          ...(replyMeta?.parentMessageId
            ? {
                parentMessageId: replyMeta.parentMessageId,
                parentMessageText: replyMeta.parentMessageText || null,
                parentMessageSenderName: replyMeta.parentMessageSenderName || null,
              }
            : {}),
        };
        const raw = JSON.stringify(wire);
        for (const dc of openChannels) {
          try {
            dc.send(raw);
            sentToAny = true;
          } catch {
            // ignore
          }
        }
      }

      const registro: StoredP2pMessage = {
        id,
        senderId: currentUserId,
        text,
        createdAt,
        p2pStatus: sentToAny ? 'sent' : 'queued',
        ...(replyMeta?.parentMessageId ? { parentMessageId: replyMeta.parentMessageId } : {}),
        ...(replyMeta?.parentMessageText ? { parentMessageText: replyMeta.parentMessageText.slice(0, 500) } : {}),
        ...(replyMeta?.parentMessageSenderName ? { parentMessageSenderName: replyMeta.parentMessageSenderName.slice(0, 500) } : {}),
      };
      if (store) saveMessage(store, currentUserId, conversationId, registro);
      void syncP2pHistoryToOwnDevices(currentUserId, conversationId);

      return {
        id,
        conversationId,
        senderId: currentUserId,
        sender: currentUser,
        text,
        createdAt,
        readAt: createdAt,
        parentMessageId: registro.parentMessageId,
        parentMessageText: registro.parentMessageText,
        parentMessageSenderName: registro.parentMessageSenderName,
        isP2p: true,
        p2pStatus: registro.p2pStatus,
      };
    },
    destroy: () => {
      destroyed = true;
      stopPresence();
      stopSignals();
      stopOwnSync();
      for (const p of peers.values()) {
        try {
          p.dc?.close();
          p.pc.close();
        } catch {
          // ignore
        }
      }
      peers.clear();
      void remove(myPresenceRef).catch(() => {});
      void remove(myInboxSignalsRef).catch(() => {});
    },
  };
}
