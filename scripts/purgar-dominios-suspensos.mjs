// scripts/purgar-dominios-suspensos.mjs
// Remove fisicamente do Firestore (paginado) todos os perfis, posts, comentários, vínculos e fontes de domínios suspensos.
// Uso: node scripts/purgar-dominios-suspensos.mjs [--dry-run]

import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const TARGET_DOMAINS = ['bolha.one', 'bolha.us', 'ursal.zone', 'alquimidia.social.br'];
const DRY_RUN = process.argv.includes('--dry-run');
const PAGE_SIZE = 300;
const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'echo-b5aw9';
const DATABASE_ID = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || 'echo-db-124325';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}

const db = getFirestore(DATABASE_ID);

function matchesTargetHost(rawHost) {
  if (typeof rawHost !== 'string' || !rawHost.trim()) return false;
  const host = rawHost.trim().toLowerCase().replace(/\.$/, '');
  return TARGET_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

function matchesUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('http')) return false;
  try {
    return matchesTargetHost(new URL(rawUrl).hostname);
  } catch {
    return false;
  }
}

function matchesHandle(rawHandle) {
  if (typeof rawHandle !== 'string' || !rawHandle.includes('@')) return false;
  return matchesTargetHost(rawHandle.split('@').pop());
}

function isTargetRecord(data) {
  if (!data || typeof data !== 'object') return false;
  return (
    matchesTargetHost(data.remoteDomain) ||
    matchesTargetHost(data.domain) ||
    matchesTargetHost(data.host) ||
    matchesHandle(data.username) ||
    matchesHandle(data.handle) ||
    matchesHandle(data.authorDetails?.username) ||
    matchesUrl(data.remoteUrl) ||
    matchesUrl(data.remoteObjectId) ||
    matchesUrl(data.remoteActorId) ||
    matchesUrl(data.apActorUri) ||
    matchesUrl(data.apObjectId) ||
    matchesUrl(data.actorId) ||
    matchesUrl(data.website) ||
    matchesUrl(data.url) ||
    matchesUrl(data.canonicalUrl)
  );
}

async function scanPaginated(baseQuery, onDoc) {
  let cursor = null;
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

async function main() {
  console.log(`[purga] Iniciando (${DRY_RUN ? 'DRY-RUN' : 'EXECUCAO REAL'}) em ${PROJECT_ID}/${DATABASE_ID}...`);
  const userIds = new Set();
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

  await scanPaginated(db.collection('users').where('isRemoteFediverse', '==', true), async (docSnap) => {
    if (isTargetRecord(docSnap.data())) {
      userIds.add(docSnap.id);
      counts.users++;
      if (!DRY_RUN) await db.recursiveDelete(docSnap.ref);
    }
  });

  await scanPaginated(db.collection('posts').where('isRemoteFediverse', '==', true), async (docSnap) => {
    const data = docSnap.data();
    if (userIds.has(String(data.userId || '')) || isTargetRecord(data)) {
      counts.posts++;
      if (!DRY_RUN) await db.recursiveDelete(docSnap.ref);
    }
  });

  await scanPaginated(db.collectionGroup('comments').where('isRemoteFediverse', '==', true), async (docSnap) => {
    const data = docSnap.data();
    if (userIds.has(String(data.userId || '')) || isTargetRecord(data)) {
      counts.comments++;
      if (!DRY_RUN) await db.recursiveDelete(docSnap.ref);
    }
  });

  await scanPaginated(db.collection('ap_remote_comments'), async (docSnap) => {
    if (isTargetRecord(docSnap.data())) {
      counts.ap_remote_comments++;
      if (!DRY_RUN) await docSnap.ref.delete();
    }
  });

  await scanPaginated(db.collection('ap_remote_actors'), async (docSnap) => {
    if (isTargetRecord(docSnap.data()) || matchesTargetHost(docSnap.id)) {
      counts.ap_remote_actors++;
      if (!DRY_RUN) await docSnap.ref.delete();
    }
  });

  await scanPaginated(db.collection('ap_followers'), async (docSnap) => {
    if (isTargetRecord(docSnap.data())) {
      counts.ap_followers++;
      if (!DRY_RUN) await docSnap.ref.delete();
    }
  });

  const followingParents = await db.collection('ap_following').get();
  for (const parent of followingParents.docs) {
    const actorsSnap = await parent.ref.collection('actors').get();
    for (const actorDoc of actorsSnap.docs) {
      if (isTargetRecord(actorDoc.data())) {
        counts.ap_following++;
        if (!DRY_RUN) await actorDoc.ref.delete();
      }
    }
  }

  await scanPaginated(db.collection('ap_handles'), async (docSnap) => {
    if (matchesHandle(docSnap.id) || isTargetRecord(docSnap.data())) {
      counts.ap_handles++;
      if (!DRY_RUN) await docSnap.ref.delete();
    }
  });

  await scanPaginated(db.collection('fontes'), async (docSnap) => {
    if (isTargetRecord(docSnap.data())) {
      counts.fontes++;
      if (!DRY_RUN) await docSnap.ref.delete();
    }
  });

  if (!DRY_RUN) {
    for (const domain of TARGET_DOMAINS) {
      await db.collection('ap_instance_policy').doc(domain).set(
        { action: 'suspend', updatedAtMs: Date.now(), reason: 'Desfederação e remoção de conteúdo atendida' },
        { merge: true },
      );
    }
  }

  console.log('[purga] Concluído:', { domains: TARGET_DOMAINS, counts, dryRun: DRY_RUN });
}

main().catch((err) => {
  console.error('[purga] Erro:', err);
  process.exit(1);
});
