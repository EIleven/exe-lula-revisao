// src/lib/p2p/p2pDevicePairing.ts
'use client';

import { onDisconnect, onValue, ref, remove, set, update } from 'firebase/database';
import { getRtdb as getSharedRtdb } from '@/lib/rtdbClient';

/**
 * O Realtime Database, ou um erro CLARO: as rotinas de pareamento são assíncronas e as telas de chaves tratam o erro com um
 * aviso. O endereço vem de um lugar só (rtdbUrl.ts), que nunca devolve texto vazio (o App Hosting entrega `databaseURL: ""`).
 */
const getRtdb = () => {
  const db = getSharedRtdb();
  if (!db) throw new Error('O tempo real (Realtime Database) está indisponível neste aparelho. Recarregue a página.');
  return db;
};
import {
  clearLocalE2eeKeyring,
  exportE2eeKeyring,
  importE2eeKeyring,
} from '@/lib/crypto/e2ee';
import {
  base64ToBytes,
  bytesToBase64,
  ECDH_PARAMS,
  type Keyring,
} from '@/lib/crypto/e2eeKeyring';
import {
  getP2pPreferences,
  saveP2pPreferences,
  type P2pPreferences,
} from '@/lib/p2p/p2pPreferences';

const DEVICE_ID_STORAGE_KEY = 'exelula:device-id:v1';
const PAIRING_TTL_MS = 5 * 60 * 1000;

export interface PairedDeviceInfo {
  deviceId: string;
  label: string;
  hasE2eeKey: boolean;
  keyId: string | null;
  online: boolean;
  lastSeenAt: number;
}

interface PairingRecord {
  code: string;
  hostDeviceId: string;
  hostLabel: string;
  hostEphemeralPub: JsonWebKey;
  guestDeviceId?: string;
  guestLabel?: string;
  guestEphemeralPub?: JsonWebKey;
  encryptedBundle?: { iv: string; ciphertext: string };
  status: 'waiting' | 'requested' | 'transferred' | 'done';
  createdAt: number;
  expiresAt: number;
}

export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return 'server';
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
    const generated =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `dev_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
        : `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, generated);
    return generated;
  } catch {
    return `dev_${Date.now().toString(36)}`;
  }
}

export function getDeviceFriendlyLabel(): string {
  if (typeof navigator === 'undefined') return 'Navegador';
  const ua = navigator.userAgent || '';
  let os = 'Dispositivo';
  if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser = 'Navegador';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\//i.test(ua) || /Opera/i.test(ua)) browser = 'Opera';
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua)) browser = 'Safari';

  const isStandalone =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(display-mode: standalone)').matches;
  return isStandalone ? `${os} · App` : `${os} · ${browser}`;
}

async function derivePairingAesKey(
  myPrivateKey: CryptoKey,
  peerPublicJwk: JsonWebKey,
  code: string
): Promise<CryptoKey> {
  const peerPub = await crypto.subtle.importKey('jwk', peerPublicJwk, ECDH_PARAMS, false, []);
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPub },
    myPrivateKey,
    256
  );
  const hkdfBase = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(`exelula:pairing:${code}`),
      info: new TextEncoder().encode('e2ee-keyring-transfer-v1'),
    },
    hkdfBase,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function generateSixDigitCode(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(100000 + (arr[0] % 900000));
}

export function registerDeviceAndWatch(params: {
  userId: string;
  hasE2eeKey: boolean;
  keyId: string | null;
  onDevicesChange: (devices: PairedDeviceInfo[]) => void;
  onRemoteUnlinked: () => void;
}): () => void {
  const { userId, hasE2eeKey, keyId, onDevicesChange, onRemoteUnlinked } = params;
  const deviceId = getOrCreateDeviceId();
  const label = getDeviceFriendlyLabel();

  const rtdb = getRtdb();
  const myDeviceRef = ref(rtdb, `p2pDeviceSync/${userId}/devices/${deviceId}`);
  const devicesRef = ref(rtdb, `p2pDeviceSync/${userId}/devices`);
  const myCommandRef = ref(rtdb, `p2pDeviceSync/${userId}/commands/${deviceId}`);

  void set(myDeviceRef, {
    deviceId,
    label,
    hasE2eeKey,
    keyId,
    online: true,
    lastSeenAt: Date.now(),
  });
  void onDisconnect(myDeviceRef).update({
    online: false,
    lastSeenAt: Date.now(),
  });

  const unsubDevices = onValue(devicesRef, (snap) => {
    const val = snap.val() as Record<string, PairedDeviceInfo> | null;
    if (!val) {
      onDevicesChange([]);
      return;
    }
    const list = Object.values(val)
      .filter((d) => d && typeof d.deviceId === 'string')
      .sort((a, b) => {
        if (a.deviceId === deviceId) return -1;
        if (b.deviceId === deviceId) return 1;
        if (a.online !== b.online) return a.online ? -1 : 1;
        return (b.lastSeenAt || 0) - (a.lastSeenAt || 0);
      });
    onDevicesChange(list);
  });

  const unsubCommands = onValue(myCommandRef, (snap) => {
    const cmd = snap.val() as { type?: string; ts?: number } | null;
    if (!cmd) return;
    if (cmd.type === 'unlink-key') {
      clearLocalE2eeKeyring(userId);
      void update(myDeviceRef, { hasE2eeKey: false, keyId: null, lastSeenAt: Date.now() });
      void remove(myCommandRef);
      onRemoteUnlinked();
    }
  });

  return () => {
    unsubDevices();
    unsubCommands();
    void update(myDeviceRef, { online: false, lastSeenAt: Date.now() });
  };
}

export async function unlinkDevice(userId: string, targetDeviceId: string): Promise<void> {
  const rtdb = getRtdb();
  const myDeviceId = getOrCreateDeviceId();
  if (targetDeviceId === myDeviceId) {
    clearLocalE2eeKeyring(userId);
    await update(ref(rtdb, `p2pDeviceSync/${userId}/devices/${myDeviceId}`), {
      hasE2eeKey: false,
      keyId: null,
      lastSeenAt: Date.now(),
    });
    return;
  }
  await set(ref(rtdb, `p2pDeviceSync/${userId}/commands/${targetDeviceId}`), {
    type: 'unlink-key',
    issuedBy: myDeviceId,
    ts: Date.now(),
  });
  await update(ref(rtdb, `p2pDeviceSync/${userId}/devices/${targetDeviceId}`), {
    hasE2eeKey: false,
    keyId: null,
  });
}

export async function forgetDeviceEntry(userId: string, targetDeviceId: string): Promise<void> {
  const rtdb = getRtdb();
  await remove(ref(rtdb, `p2pDeviceSync/${userId}/devices/${targetDeviceId}`));
  await remove(ref(rtdb, `p2pDeviceSync/${userId}/commands/${targetDeviceId}`));
}

export async function startPairingHost(params: {
  userId: string;
  onStatus: (status: 'waiting' | 'transferring' | 'done') => void;
  onError: (message: string) => void;
}): Promise<{ code: string; cancel: () => Promise<void> }> {
  const { userId, onStatus, onError } = params;
  const ring = await exportE2eeKeyring(userId);
  if (!ring) {
    throw new Error('Este aparelho não possui a chave E2EE ativa para compartilhar.');
  }

  const code = generateSixDigitCode();
  const hostKeyPair = await crypto.subtle.generateKey(ECDH_PARAMS, false, ['deriveBits']);
  const hostEphemeralPub = await crypto.subtle.exportKey('jwk', hostKeyPair.publicKey);
  const rtdb = getRtdb();
  const pairingRef = ref(rtdb, `p2pDeviceSync/${userId}/pairing/${code}`);

  await set(pairingRef, {
    code,
    hostDeviceId: getOrCreateDeviceId(),
    hostLabel: getDeviceFriendlyLabel(),
    hostEphemeralPub,
    status: 'waiting',
    createdAt: Date.now(),
    expiresAt: Date.now() + PAIRING_TTL_MS,
  } satisfies PairingRecord);
  void onDisconnect(pairingRef).remove();
  onStatus('waiting');

  let handledTransfer = false;
  const unsub = onValue(pairingRef, (snap) => {
    const rec = snap.val() as PairingRecord | null;
    if (!rec) return;
    if (rec.status === 'requested' && rec.guestEphemeralPub && !handledTransfer) {
      handledTransfer = true;
      onStatus('transferring');
      void (async () => {
        try {
          const aes = await derivePairingAesKey(hostKeyPair.privateKey, rec.guestEphemeralPub!, code);
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const payloadJson = JSON.stringify({
            ring,
            preferences: getP2pPreferences(userId),
          });
          const cipherBuf = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            aes,
            new TextEncoder().encode(payloadJson)
          );
          await update(pairingRef, {
            encryptedBundle: {
              iv: bytesToBase64(iv),
              ciphertext: bytesToBase64(new Uint8Array(cipherBuf)),
            },
            status: 'transferred',
          });
        } catch (err) {
          onError(err instanceof Error ? err.message : 'Falha ao cifrar chave para o outro aparelho.');
        }
      })();
    } else if (rec.status === 'done') {
      unsub();
      onStatus('done');
      void remove(pairingRef);
    }
  });

  return {
    code,
    cancel: async () => {
      unsub();
      await remove(pairingRef);
    },
  };
}

export async function joinPairingGuest(params: {
  userId: string;
  code: string;
}): Promise<{ hostLabel: string }> {
  const { userId } = params;
  const code = params.code.replace(/\D/g, '').slice(0, 6);
  if (code.length !== 6) {
    throw new Error('Digite o código de 6 dígitos exibido no outro aparelho.');
  }

  const rtdb = getRtdb();
  const pairingRef = ref(rtdb, `p2pDeviceSync/${userId}/pairing/${code}`);
  const guestKeyPair = await crypto.subtle.generateKey(ECDH_PARAMS, false, ['deriveBits']);
  const guestEphemeralPub = await crypto.subtle.exportKey('jwk', guestKeyPair.publicKey);

  return new Promise<{ hostLabel: string }>((resolve, reject) => {
    let requested = false;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsub();
      reject(new Error('Tempo esgotado. Confirme se o código está aberto no outro aparelho.'));
    }, 30_000);

    const finishError = (msg: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsub();
      reject(new Error(msg));
    };

    const unsub = onValue(pairingRef, (snap) => {
      const rec = snap.val() as PairingRecord | null;
      if (!rec) {
        if (!requested) {
          finishError('Código não encontrado ou expirado. Gere um novo código no outro aparelho.');
        }
        return;
      }
      if (Date.now() > rec.expiresAt) {
        finishError('Este código expirou. Gere um novo código no outro aparelho.');
        return;
      }

      if (rec.status === 'waiting' && !requested) {
        requested = true;
        void update(pairingRef, {
          guestDeviceId: getOrCreateDeviceId(),
          guestLabel: getDeviceFriendlyLabel(),
          guestEphemeralPub,
          status: 'requested',
        }).catch((err) => finishError(err instanceof Error ? err.message : 'Erro ao solicitar pareamento.'));
        return;
      }

      if (rec.status === 'transferred' && rec.encryptedBundle && !settled) {
        settled = true;
        clearTimeout(timer);
        unsub();
        void (async () => {
          try {
            const aes = await derivePairingAesKey(guestKeyPair.privateKey, rec.hostEphemeralPub, code);
            const iv = base64ToBytes(rec.encryptedBundle!.iv);
            const ct = base64ToBytes(rec.encryptedBundle!.ciphertext);
            const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aes, ct);
            const parsed = JSON.parse(new TextDecoder().decode(plainBuf)) as {
              ring: Keyring;
              preferences?: P2pPreferences;
            };
            await importE2eeKeyring(userId, parsed.ring);
            if (parsed.preferences) {
              saveP2pPreferences(userId, parsed.preferences);
            }
            await update(pairingRef, { status: 'done' });
            await update(ref(rtdb, `p2pDeviceSync/${userId}/devices/${getOrCreateDeviceId()}`), {
              hasE2eeKey: true,
              keyId: parsed.ring.activeId,
              lastSeenAt: Date.now(),
            });
            resolve({ hostLabel: rec.hostLabel || 'Outro aparelho' });
          } catch (err) {
            reject(
              new Error(
                err instanceof Error
                  ? err.message
                  : 'Não foi possível decifrar ou importar a chave recebida.'
              )
            );
          }
        })();
      }
    });
  });
}
