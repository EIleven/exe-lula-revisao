// src/lib/server/purgeSuspended.ts
// Remoção física paginada no Firestore de perfis, posts, comentários, vínculos e índices de domínios suspensos.
import type { DocumentData, Query, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminFirestore } from '@/lib/server/firebaseAdmin';
import {
  isFromSuspendedFediverseDomain,
  isSuspendedFediverseHost,
  SUSPENDED_FEDIVERSE_DOMAINS,
} from '@/lib/federation/suspendedDomains';

const PAGE_SIZE = 300;

function isSuspendedRecord(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  return (
    isFromSuspendedFediverseDomain({
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
    isSuspendedFediverseHost(typeof data.domain === 'string' ? data.domain : null) ||
    isSuspendedFediverseHost(typeof data.host === 'string' ? data.host : null) ||
    (typeof data.handle === 'string' &&
      data.handle.includes('@') &&
      isSuspendedFediverseHost(data.handle.split('@').pop())) ||
    (typeof data.apObjectId === 'string' && isFromSuspendedFediverseDomain({ remoteUrl: data.apObjectId })) ||
    (typeof data.actorId === 'string' && isFromSuspendedFediverseDomain({ remoteUrl: data.actorId })) ||
    (typeof data.url === 'string' && isFromSuspendedFediverseDomain({ remoteUrl: data.url })) ||
    (typeof data.canonicalUrl === 'string' && isFromSuspendedFediverseDomain({ remoteUrl: data.canonicalUrl }))
  );
}

async function scanPaginated(
  baseQuery: Query<DocumentData>,
  onDoc: (docSnap: QueryDocumentSnapshot<DocumentData>) => Promise<void>,
): Promise<void> {
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
  while (true) {
    let q = baseQuery.limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const docSnap of snap.docs) {
      await onDoc(docSnap);
    }
    if (snap.docs.length < PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
}

export async function purgeSuspendedDomainsFromFirestore() {
  const db = adminFirestore();
  const userIds = new Set<string>();
  const counts = {
    users: 0,
    posts: 0,
    comments: 0,
    ap_remote_comments: 0,
    ap_remote_actors: 0,
    ap_followers: 0,
    ap_following: 0,
    ap_handles: 0,
    fontes: 0,
  };

  // 1. Usuários remotos
  await scanPaginated(
    db.collection('users').where('isRemoteFediverse', '==', true),
    async (docSnap) => {
      if (isSuspendedRecord(docSnap.data())) {
        userIds.add(docSnap.id);
        counts.users++;
        await db.recursiveDelete(docSnap.ref);
      }
    },
  );

  // 2. Posts remotos (paginado)
  await scanPaginated(
    db.collection('posts').where('isRemoteFediverse', '==', true),
    async (docSnap) => {
      const data = docSnap.data();
      if (userIds.has(String(data.userId || '')) || isSuspendedRecord(data)) {
        counts.posts++;
        await db.recursiveDelete(docSnap.ref);
      }
    },
  );

  // 3. Comentários remotos (inclusive em posts locais)
  await scanPaginated(
    db.collectionGroup('comments').where('isRemoteFediverse', '==', true),
    async (docSnap) => {
      const data = docSnap.data();
      if (userIds.has(String(data.userId || '')) || isSuspendedRecord(data)) {
        counts.comments++;
        await db.recursiveDelete(docSnap.ref);
      }
    },
  );

  // 4. ap_remote_comments
  await scanPaginated(db.collection('ap_remote_comments'), async (docSnap) => {
    if (isSuspendedRecord(docSnap.data())) {
      counts.ap_remote_comments++;
      await docSnap.ref.delete();
    }
  });

  // 5. ap_remote_actors
  await scanPaginated(db.collection('ap_remote_actors'), async (docSnap) => {
    if (isSuspendedRecord(docSnap.data()) || isSuspendedFediverseHost(docSnap.id)) {
      counts.ap_remote_actors++;
      await docSnap.ref.delete();
    }
  });

  // 6. ap_followers (coleção plana: doc('${uid}__${sha(actorId)}'))
  await scanPaginated(db.collection('ap_followers'), async (docSnap) => {
    if (isSuspendedRecord(docSnap.data())) {
      counts.ap_followers++;
      await docSnap.ref.delete();
    }
  });

  // 7. ap_following/{uid}/actors
  const followingParents = await db.collection('ap_following').get();
  for (const parent of followingParents.docs) {
    const actorsSnap = await parent.ref.collection('actors').get();
    for (const actorDoc of actorsSnap.docs) {
      if (isSuspendedRecord(actorDoc.data())) {
        counts.ap_following++;
        await actorDoc.ref.delete();
      }
    }
  }

  // 8. ap_handles
  await scanPaginated(db.collection('ap_handles'), async (docSnap) => {
    const handleHasDomain =
      docSnap.id.includes('@') && isSuspendedFediverseHost(docSnap.id.split('@').pop());
    if (handleHasDomain || isSuspendedRecord(docSnap.data())) {
      counts.ap_handles++;
      await docSnap.ref.delete();
    }
  });

  // 9. fontes (índice público da aba Fontes)
  await scanPaginated(db.collection('fontes'), async (docSnap) => {
    if (isSuspendedRecord(docSnap.data())) {
      counts.fontes++;
      await docSnap.ref.delete();
    }
  });

  // 10. Política de instância + registro de auditoria
  const executedAtMs = Date.now();
  for (const domain of SUSPENDED_FEDIVERSE_DOMAINS) {
    await db.collection('ap_instance_policy').doc(domain).set(
      {
        action: 'suspend',
        updatedAtMs: executedAtMs,
        reason: 'Desfederação e remoção de conteúdo atendida',
      },
      { merge: true },
    );
  }

  await db.collection('ap_audit').add({
    action: 'purge_suspended_domains',
    domains: [...SUSPENDED_FEDIVERSE_DOMAINS],
    counts,
    executedAtMs,
    expireAt: new Date(executedAtMs + 90 * 86_400_000),
  });

  return {
    domains: [...SUSPENDED_FEDIVERSE_DOMAINS],
    counts,
    executedAtMs,
  };
}
