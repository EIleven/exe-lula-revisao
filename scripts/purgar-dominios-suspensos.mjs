// scripts/purgar-dominios-suspensos.mjs
// Remove fisicamente do Firestore todos os perfis, posts, comentários e vínculos vindos de domínios suspensos.
// Uso: node scripts/purgar-dominios-suspensos.mjs [--dry-run]

import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const TARGET_DOMAINS = ['bolha.one', 'bolha.us', 'ursal.zone', 'alquimidia.social.br'];
const DRY_RUN = process.argv.includes('--dry-run');
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
    matchesHandle(data.username) ||
    matchesHandle(data.handle) ||
    matchesHandle(data.authorDetails?.username) ||
    matchesUrl(data.remoteUrl) ||
    matchesUrl(data.remoteObjectId) ||
    matchesUrl(data.remoteActorId) ||
    matchesUrl(data.apActorUri) ||
    matchesUrl(data.apObjectId) ||
    matchesUrl(data.actorId) ||
    matchesUrl(data.website)
  );
}

async function deleteDocRecursive(docRef) {
  if (DRY_RUN) return;
  await db.recursiveDelete(docRef);
}

async function purgeUsers() {
  const userIds = new Set();
  const snap = await db.collection('users').where('isRemoteFediverse', '==', true).get();
  for (const docSnap of snap.docs) {
    if (isTargetRecord(docSnap.data())) {
      userIds.add(docSnap.id);
      console.log(`[purga] user ${docSnap.id} (${docSnap.data().username || ''})`);
      await deleteDocRecursive(docSnap.ref);
    }
  }
  return userIds;
}

async function purgePosts(targetUserIds) {
  let count = 0;
  const snap = await db.collection('posts').where('isRemoteFediverse', '==', true).get();
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (targetUserIds.has(data.userId) || isTargetRecord(data)) {
      count++;
      console.log(`[purga] post ${docSnap.id}`);
      await deleteDocRecursive(docSnap.ref);
    }
  }
  return count;
}

async function purgeApHandles() {
  let count = 0;
  const snap = await db.collection('ap_handles').get();
  for (const docSnap of snap.docs) {
    if (matchesHandle(docSnap.id) || isTargetRecord(docSnap.data())) {
      count++;
      console.log(`[purga] ap_handle ${docSnap.id}`);
      if (!DRY_RUN) await docSnap.ref.delete();
    }
  }
  return count;
}

async function purgeFollowSubcollections() {
  let followingRemoved = 0;
  let followersRemoved = 0;
  for (const colName of ['ap_following', 'ap_followers']) {
    const parents = await db.collection(colName).get();
    for (const parent of parents.docs) {
      const actorsSnap = await parent.ref.collection('actors').get();
      for (const actorDoc of actorsSnap.docs) {
        if (isTargetRecord(actorDoc.data())) {
          if (colName === 'ap_following') followingRemoved++;
          else followersRemoved++;
          console.log(`[purga] ${colName}/${parent.id}/actors/${actorDoc.id}`);
          if (!DRY_RUN) await actorDoc.ref.delete();
        }
      }
    }
  }
  return { followingRemoved, followersRemoved };
}

async function ensureInstancePolicySuspended() {
  for (const domain of TARGET_DOMAINS) {
    console.log(`[purga] ap_instance_policy/${domain} -> suspend`);
    if (!DRY_RUN) {
      await db.collection('ap_instance_policy').doc(domain).set(
        {
          action: 'suspend',
          updatedAtMs: Date.now(),
          reason: 'Solicitação de desfederação e remoção de conteúdo',
        },
        { merge: true },
      );
    }
  }
}

async function main() {
  console.log(`[purga] Iniciando (${DRY_RUN ? 'DRY-RUN' : 'EXECUCAO REAL'}) em ${PROJECT_ID}/${DATABASE_ID}...`);
  const userIds = await purgeUsers();
  const postsRemoved = await purgePosts(userIds);
  const handlesRemoved = await purgeApHandles();
  const { followingRemoved, followersRemoved } = await purgeFollowSubcollections();
  await ensureInstancePolicySuspended();
  console.log('[purga] Resumo:', {
    usersRemoved: userIds.size,
    postsRemoved,
    handlesRemoved,
    followingRemoved,
    followersRemoved,
    dryRun: DRY_RUN,
  });
}

main().catch((err) => {
  console.error('[purga] Erro:', err);
  process.exit(1);
});
