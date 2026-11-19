// src/lib/activitypub/purgeSuspended.ts
// Remoção física no Firestore de perfis, posts, handles e vínculos de domínios suspensos.
import { adminFirestore } from '@/lib/server/firebaseAdmin';
import { isFromSuspendedFediverseDomain, isSuspendedFediverseHost, SUSPENDED_FEDIVERSE_DOMAINS } from '@/lib/federation/suspendedDomains';

function isSuspendedRecord(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  return isFromSuspendedFediverseDomain({
    remoteDomain: typeof data.remoteDomain === 'string' ? data.remoteDomain : null,
    username: typeof data.username === 'string' ? data.username : null,
    remoteUrl: typeof data.remoteUrl === 'string' ? data.remoteUrl : null,
    remoteActorId: typeof data.remoteActorId === 'string' ? data.remoteActorId : null,
    apActorUri: typeof data.apActorUri === 'string' ? data.apActorUri : null,
    website: typeof data.website === 'string' ? data.website : null,
    authorDetails:
      data.authorDetails && typeof data.authorDetails === 'object'
        ? { username: (data.authorDetails as { username?: string }).username ?? null }
        : null,
  }) ||
  (typeof data.handle === 'string' && data.handle.includes('@') && isSuspendedFediverseHost(data.handle.split('@').pop())) ||
  (typeof data.apObjectId === 'string' && isFromSuspendedFediverseDomain({ remoteUrl: data.apObjectId })) ||
  (typeof data.actorId === 'string' && isFromSuspendedFediverseDomain({ remoteUrl: data.actorId }));
}

export async function purgeSuspendedDomainsFromFirestore() {
  const db = adminFirestore();
  const userIds = new Set<string>();
  let postsRemoved = 0;
  let handlesRemoved = 0;
  let followingRemoved = 0;
  let followersRemoved = 0;

  const usersSnap = await db.collection('users').where('isRemoteFediverse', '==', true).get();
  for (const docSnap of usersSnap.docs) {
    if (isSuspendedRecord(docSnap.data())) {
      userIds.add(docSnap.id);
      await db.recursiveDelete(docSnap.ref);
    }
  }

  const postsSnap = await db.collection('posts').where('isRemoteFediverse', '==', true).get();
  for (const docSnap of postsSnap.docs) {
    const data = docSnap.data();
    if (userIds.has(String(data.userId || '')) || isSuspendedRecord(data)) {
      postsRemoved++;
      await db.recursiveDelete(docSnap.ref);
    }
  }

  const handlesSnap = await db.collection('ap_handles').get();
  for (const docSnap of handlesSnap.docs) {
    const handleHasDomain = docSnap.id.includes('@') && isSuspendedFediverseHost(docSnap.id.split('@').pop());
    if (handleHasDomain || isSuspendedRecord(docSnap.data())) {
      handlesRemoved++;
      await docSnap.ref.delete();
    }
  }

  for (const colName of ['ap_following', 'ap_followers'] as const) {
    const parents = await db.collection(colName).get();
    for (const parent of parents.docs) {
      const actorsSnap = await parent.ref.collection('actors').get();
      for (const actorDoc of actorsSnap.docs) {
        if (isSuspendedRecord(actorDoc.data())) {
          if (colName === 'ap_following') followingRemoved++;
          else followersRemoved++;
          await actorDoc.ref.delete();
        }
      }
    }
  }

  for (const domain of SUSPENDED_FEDIVERSE_DOMAINS) {
    await db.collection('ap_instance_policy').doc(domain).set(
      {
        action: 'suspend',
        updatedAtMs: Date.now(),
        reason: 'Desfederação e remoção de conteúdo atendida',
      },
      { merge: true },
    );
  }

  return {
    domains: [...SUSPENDED_FEDIVERSE_DOMAINS],
    usersRemoved: userIds.size,
    postsRemoved,
    handlesRemoved,
    followingRemoved,
    followersRemoved,
  };
}
