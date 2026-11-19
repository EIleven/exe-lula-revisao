'use client';

// src/lib/crypto/e2ee.ts
// A ponta do navegador do E2EE: liga o serviço de identidade (e2eeIdentity.ts, testado em Node) ao localStorage e à chave
// pública publicada no perfil (`users/{uid}.e2eePublicKey`, no Firestore). A API antiga (`ensureUserE2eeKeyPair`,
// `encryptDirectMessage`, `decryptDirectMessage`) continua, para as telas que já a usam; o que mudou é o comportamento:
// aparelho sem a chave da conta NÃO gera outra nem a sobrescreve (ver e2eeIdentity.ts).
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  createIdentityService,
  type DecryptResult,
  type E2eeEncryptedPayload,
  type IdentityStatus,
  type PublishedKeys,
  type StorageLike,
} from './e2eeIdentity';
import { activeKey, fingerprint, safetyNumber, type Keyring } from './e2eeKeyring';

export type { DecryptResult, E2eeEncryptedPayload, IdentityStatus };

export const isWebCryptoSupported = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.crypto !== 'undefined' &&
  typeof window.crypto.subtle !== 'undefined';

/** localStorage com guarda: modo privado, cota e política do navegador podem fazê-lo lançar em qualquer chamada. */
const storage: StorageLike = {
  getItem(key) {
    try {
      return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    if (typeof window === 'undefined') throw new Error('sem armazenamento');
    window.localStorage.setItem(key, value); // pode lançar: o serviço trata ("storage-unavailable")
  },
  removeItem(key) {
    try {
      if (typeof window !== 'undefined') window.localStorage.removeItem(key);
    } catch {
      // ignora
    }
  },
};

const published: PublishedKeys = {
  async get(userId) {
    const snap = await getDoc(doc(db, 'users', userId));
    const value = snap.exists() ? snap.data()?.e2eePublicKey : null;
    return typeof value === 'string' && value.length > 0 ? value : null;
  },
  async set(userId, publicKeyJson) {
    await updateDoc(doc(db, 'users', userId), { e2eePublicKey: publicKeyJson });
  },
};

let service: ReturnType<typeof createIdentityService> | null = null;
const identity = () => (service ??= createIdentityService({ storage, published }));

/** Estado da identidade E2EE da conta neste aparelho (cria a chave só se a conta ainda não tem nenhuma). */
export const getE2eeStatus = (userId: string): Promise<IdentityStatus> =>
  isWebCryptoSupported() && userId ? identity().status(userId) : Promise.resolve({ status: 'unsupported' });

/**
 * Garante a identidade e devolve o par ATIVO, ou `null` quando este aparelho não pode cifrar (sem WebCrypto, armazenamento
 * bloqueado, ou a conta tem uma chave que este aparelho não possui: ver `getE2eeStatus`).
 */
export const ensureUserE2eeKeyPair = async (
  userId: string,
): Promise<{ publicKeyJson: string; publicJwk: JsonWebKey; privateJwk: JsonWebKey } | null> => {
  const st = await getE2eeStatus(userId);
  if (st.status !== 'ready') return null;
  const ring = await identity().loadRing(userId);
  if (!ring) return null;
  const ativa = activeKey(ring);
  return { publicKeyJson: st.publicKeyJson, publicJwk: ativa.publicJwk, privateJwk: ativa.privateJwk };
};

export const encryptDirectMessage = async (
  plaintext: string,
  senderUserId: string,
  recipientPublicKeyJson?: string | null,
): Promise<E2eeEncryptedPayload | null> => {
  if (!isWebCryptoSupported()) return null;
  return identity().encrypt(plaintext, senderUserId, recipientPublicKeyJson);
};

export const decryptDirectMessage = async (
  payload: E2eeEncryptedPayload,
  currentUserId: string,
  isSender: boolean,
  peerPublicKeyJson?: string | null,
): Promise<DecryptResult> => {
  if (!isWebCryptoSupported()) return { ok: false, reason: 'unsupported' };
  return identity().decrypt(payload, currentUserId, isSender, peerPublicKeyJson);
};

// ───────────────────────── Gestão (Configurações) ─────────────────────────

/** Gira a chave: a nova passa a valer, a antiga continua no chaveiro e o histórico segue legível. */
export const rotateE2eeKey = (userId: string) => identity().rotate(userId);
/** "Começar do zero": publica uma identidade nova, mesmo que a conta já tivesse outra (ato explícito). */
export const createNewE2eeIdentity = (userId: string) => identity().createNewIdentity(userId);
export const exportE2eeKeyring = (userId: string): Promise<Keyring | null> => identity().exportKeyring(userId);
export const importE2eeKeyring = (userId: string, ring: Keyring) => identity().importKeyring(userId, ring);
export const clearLocalE2eeKeyring = (userId: string) => identity().clearLocalKeys(userId);
export const e2eeFingerprint = fingerprint;
export const e2eeSafetyNumber = safetyNumber;
