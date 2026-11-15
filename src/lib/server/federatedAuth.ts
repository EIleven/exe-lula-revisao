// src/lib/server/federatedAuth.ts
// Provisionamento e autenticação de contas criadas/logadas via Fediverso (ActivityPub/Mastodon) ou Atmosfera (Bluesky).
import { createHash, randomBytes } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { enableFederation } from '@/lib/activitypub/account';
import { federation } from '@/lib/server/federation';
import { adminAuth, adminFirestore } from '@/lib/server/firebaseAdmin';

export interface FederatedProfileInput {
  provider: 'fediverse' | 'bluesky';
  externalId: string;
  handle: string;
  name: string;
  bio: string;
  avatarUrl: string;
  coverImageUrl: string;
  website: string;
  actorId?: string;
  did?: string;
  locale: string;
}

const hashKey = (value: string) => createHash('sha256').update(value).digest('hex');

function sanitizeLocalUsername(rawHandle: string): string {
  const firstPart = rawHandle.replace(/^@/, '').split(/[@.]/)[0] || 'user';
  const cleaned = firstPart.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (cleaned.length >= 3) return cleaned.slice(0, 15);
  return `user_${cleaned || 'fed'}`.slice(0, 15);
}

async function allocateUniqueUsername(baseRaw: string): Promise<string> {
  const db = adminFirestore();
  const base = sanitizeLocalUsername(baseRaw);
  for (let i = 0; i < 20; i++) {
    const suffix = i === 0 ? '' : String(i === 1 ? Math.floor(10 + Math.random() * 89) : Math.floor(100 + Math.random() * 899));
    const candidate = `${base.slice(0, Math.max(3, 15 - suffix.length))}${suffix}`;
    const snap = await db.collection('usernames').doc(candidate.toLowerCase()).get();
    if (!snap.exists) return candidate;
  }
  return `u_${randomBytes(4).toString('hex')}`.slice(0, 15);
}

export async function provisionOrLoginFederatedUser(
  input: FederatedProfileInput,
): Promise<{ uid: string; isNewUser: boolean; customToken: string }> {
  const db = adminFirestore();
  const auth = adminAuth();
  const identityDocId = `${input.provider}_${hashKey(input.externalId).slice(0, 32)}`;
  const identityRef = db.collection('federated_identities').doc(identityDocId);
  const identitySnap = await identityRef.get();

  let uid: string;
  let isNewUser = false;

  if (identitySnap.exists) {
    uid = String((identitySnap.data() as { uid?: string }).uid || '');
    const userSnap = uid ? await db.collection('users').doc(uid).get() : null;
    if (!uid || !userSnap?.exists) {
      uid = '';
    }
  } else {
    uid = '';
  }

  if (!uid) {
    isNewUser = true;
    const username = await allocateUniqueUsername(input.handle);
    const displayName = (input.name || username).slice(0, 60);
    const created = await auth.createUser({ displayName });
    uid = created.uid;

    const nowIso = new Date().toISOString();
    const batch = db.batch();
    batch.set(db.collection('usernames').doc(username.toLowerCase()), {
      uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.set(db.collection('users').doc(uid), {
      id: uid,
      name: displayName,
      username,
      email: '',
      bio: input.bio.slice(0, 500),
      avatarUrl: input.avatarUrl || '',
      coverImageUrl: input.coverImageUrl || '',
      website: input.website || '',
      followersCount: 0,
      followingCount: 0,
      postsCount: 0,
      dmPreference: 'all',
      isAdmin: false,
      isModerator: false,
      profileVisibility: 'public',
      createdAt: nowIso,
      updatedAt: FieldValue.serverTimestamp(),
      federatedLoginProvider: input.provider,
      federatedLoginHandle: input.handle,
    });
    batch.set(identityRef, {
      uid,
      provider: input.provider,
      externalId: input.externalId,
      handle: input.handle,
      createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
  }

  await auth.setCustomUserClaims(uid, { member: true });

  // Ativa @handle@exercitodolula.app automaticamente para unificar a identidade dentro e fora da rede
  try {
    const accountDeps = federation().account();
    const res = await enableFederation(accountDeps, uid, { emailVerified: true });
    if (res.ok && input.actorId) {
      const f = federation();
      const existing = await f.store.getAccount(uid);
      const currentAliases = existing?.alsoKnownAs ?? [];
      if (!currentAliases.includes(input.actorId) && currentAliases.length < 5) {
        await db
          .collection('users')
          .doc(uid)
          .collection('private')
          .doc('federation')
          .set({ alsoKnownAs: [...currentAliases, input.actorId] }, { merge: true });
      }
    }
  } catch (err) {
    console.warn('Auto-enable federation warning:', err instanceof Error ? err.message : String(err));
  }

  const customToken = await auth.createCustomToken(uid);
  return { uid, isNewUser, customToken };
}

export async function createLoginTicket(payload: {
  customToken: string;
  uid: string;
  isNewUser: boolean;
}): Promise<string> {
  const ticket = randomBytes(24).toString('base64url');
  const db = adminFirestore();
  await db.collection('auth_login_tickets').doc(hashKey(ticket)).set({
    customToken: payload.customToken,
    uid: payload.uid,
    isNewUser: payload.isNewUser,
    expiresAt: Date.now() + 5 * 60 * 1000,
    expireAt: Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
    createdAt: FieldValue.serverTimestamp(),
  });
  return ticket;
}

export async function consumeLoginTicket(
  ticket: string,
): Promise<{ customToken: string; uid: string; isNewUser: boolean } | null> {
  if (!ticket || ticket.length > 256) return null;
  const db = adminFirestore();
  const ref = db.collection('auth_login_tickets').doc(hashKey(ticket));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    tx.delete(ref);
    const data = snap.data() as {
      customToken?: string;
      uid?: string;
      isNewUser?: boolean;
      expiresAt?: number;
    };
    if (!data.customToken || !data.uid || (data.expiresAt ?? 0) < Date.now()) {
      return null;
    }
    return {
      customToken: data.customToken,
      uid: data.uid,
      isNewUser: Boolean(data.isNewUser),
    };
  });
}

