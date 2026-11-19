import { createHash, randomBytes } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminFirestore } from './firebaseAdmin';
import type { SocialConnectionSummary, SocialProvider } from '@/lib/social/types';
import type { FederatedSyncConsent } from './federatedSync';

const CONNECTIONS = 'social_connections';
const LINK_STATES = 'social_oauth_links';
const ATPROTO_STATES = 'social_atproto_states';
const ATPROTO_SESSIONS = 'social_atproto_sessions';
const PUBLICATIONS = 'social_publications';

export interface StoredSocialConnection extends SocialConnectionSummary {
  uid: string;
  provider: SocialProvider;
  connected: true;
  did?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
}

interface LinkState {
  uid: string;
  provider: SocialProvider;
  expiresAt: number;
  verifier?: string;
  locale?: string;
  consent?: FederatedSyncConsent;
}

const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const connectionId = (uid: string, provider: SocialProvider) => `${uid}_${provider}`;

export const randomUrlToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export async function getConnection(uid: string, provider: SocialProvider): Promise<StoredSocialConnection | null> {
  const snapshot = await adminFirestore().collection(CONNECTIONS).doc(connectionId(uid, provider)).get();
  return snapshot.exists ? snapshot.data() as StoredSocialConnection : null;
}

export async function saveConnection(connection: StoredSocialConnection): Promise<void> {
  await adminFirestore().collection(CONNECTIONS).doc(connectionId(connection.uid, connection.provider)).set({
    ...clean(connection),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export async function deleteConnection(uid: string, provider: SocialProvider): Promise<void> {
  await adminFirestore().collection(CONNECTIONS).doc(connectionId(uid, provider)).delete();
}

export async function createLinkState(input: Omit<LinkState, 'expiresAt'>): Promise<string> {
  const state = randomUrlToken();
  await adminFirestore().collection(LINK_STATES).doc(hash(state)).set({
    ...input,
    expiresAt: Date.now() + 10 * 60 * 1000,
    expireAt: Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
    createdAt: FieldValue.serverTimestamp(),
  });
  return state;
}

export async function peekLinkState(state: string, provider: SocialProvider): Promise<LinkState | null> {
  if (!state || state.length > 512) return null;
  const snapshot = await adminFirestore().collection(LINK_STATES).doc(hash(state)).get();
  if (!snapshot.exists) return null;
  const value = snapshot.data() as LinkState;
  if (value.provider !== provider || value.expiresAt < Date.now()) return null;
  return value;
}

/** Reads and deletes an OAuth state in one transaction, so a callback cannot be replayed. */
export async function consumeLinkState(state: string, provider: SocialProvider): Promise<LinkState | null> {
  if (!state || state.length > 512) return null;
  const ref = adminFirestore().collection(LINK_STATES).doc(hash(state));
  return adminFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return null;
    transaction.delete(ref);
    const value = snapshot.data() as LinkState;
    if (value.provider !== provider || value.expiresAt < Date.now()) return null;
    return value;
  });
}

export const atprotoStateStore = {
  async set(key: string, value: unknown) {
    await adminFirestore().collection(ATPROTO_STATES).doc(hash(key)).set({
      value: clean(value),
      expiresAt: Date.now() + 10 * 60 * 1000,
      expireAt: Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
      createdAt: FieldValue.serverTimestamp(),
    });
  },
  async get(key: string) {
    const snapshot = await adminFirestore().collection(ATPROTO_STATES).doc(hash(key)).get();
    if (!snapshot.exists) return undefined;
    const data = snapshot.data()!;
    if (typeof data.expiresAt === 'number' && data.expiresAt < Date.now()) {
      await snapshot.ref.delete().catch(() => undefined);
      return undefined;
    }
    return data.value;
  },
  async del(key: string) {
    await adminFirestore().collection(ATPROTO_STATES).doc(hash(key)).delete();
  },
};

export const atprotoSessionStore = {
  async set(sub: string, value: unknown) {
    await adminFirestore().collection(ATPROTO_SESSIONS).doc(hash(sub)).set({
      sub,
      value: clean(value),
      updatedAt: FieldValue.serverTimestamp(),
    });
  },
  async get(sub: string) {
    const snapshot = await adminFirestore().collection(ATPROTO_SESSIONS).doc(hash(sub)).get();
    return snapshot.exists ? snapshot.data()!.value : undefined;
  },
  async del(sub: string) {
    await adminFirestore().collection(ATPROTO_SESSIONS).doc(hash(sub)).delete();
  },
};

export async function claimPublication(uid: string, postId: string, provider: SocialProvider) {
  const ref = adminFirestore().collection(PUBLICATIONS).doc(hash(`${uid}:${postId}:${provider}`));
  return adminFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const previous = snapshot.data();
    if (previous?.status === 'success') {
      return { claim: false as const, previous: previous as { url?: string } };
    }
    const updatedAt = previous?.updatedAt instanceof Timestamp ? previous.updatedAt.toMillis() : 0;
    if (previous?.status === 'pending' && Date.now() - updatedAt < 2 * 60 * 1000) {
      return { claim: false as const, pending: true as const };
    }
    transaction.set(ref, {
      uid,
      postId,
      provider,
      status: 'pending',
      attempts: Number(previous?.attempts ?? 0) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { claim: true as const, ref };
  });
}

export async function finishPublication(
  uid: string,
  postId: string,
  provider: SocialProvider,
  result: { status: 'success'; url: string; externalId: string } | { status: 'failed'; errorCode: string },
): Promise<void> {
  await adminFirestore().collection(PUBLICATIONS).doc(hash(`${uid}:${postId}:${provider}`)).set({
    ...result,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

/**
 * Remove credenciais, estados OAuth e historico tecnico local de uma conta.
 * A revogacao no provedor e feita antes pela rota de exclusao; esta funcao
 * garante a parte que esta sob nosso controle mesmo se o provedor estiver fora.
 */
export async function cleanupSocialData(uid: string): Promise<StoredSocialConnection[]> {
  const firestore = adminFirestore();
  const [connections, links, publications] = await Promise.all([
    firestore.collection(CONNECTIONS).where('uid', '==', uid).get(),
    firestore.collection(LINK_STATES).where('uid', '==', uid).get(),
    firestore.collection(PUBLICATIONS).where('uid', '==', uid).get(),
  ]);
  const savedConnections = connections.docs.map((doc) => doc.data() as StoredSocialConnection);
  const refs = [
    ...connections.docs.map((doc) => doc.ref),
    ...links.docs.map((doc) => doc.ref),
    ...publications.docs.map((doc) => doc.ref),
    ...savedConnections
      .filter((connection) => connection.provider === 'bluesky' && connection.did)
      .map((connection) => firestore.collection(ATPROTO_SESSIONS).doc(hash(connection.did!))),
  ];
  for (let offset = 0; offset < refs.length; offset += 450) {
    const batch = firestore.batch();
    refs.slice(offset, offset + 450).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
  return savedConnections;
}
