// src/lib/server/remotePostInteractions.ts
// Importa comentários, curtidas e repostagens de posts remotos do Fediverso sob demanda.
import { remoteFollowDocIdOf, remotePostIdOf } from '@/lib/activitypub/remoteIdentity';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { User } from '@/lib/types';
import { decideInstance } from '@/lib/activitypub/gate';
import { safeFetchText } from '@/lib/security/safe-fetch';
import { federation } from '@/lib/server/federation';
import { adminFirestore } from '@/lib/server/firebaseAdmin';
import { createDomainGate, createSyncMemo } from '@/lib/federation/countSyncPolicy';
import { createCountSyncer, type CountSyncOutcome, type FetchedStatus } from '@/lib/federation/countSyncer';
import { applyRemoteCounts, raiseRemoteCommentCount } from '@/lib/server/remoteCounts';
import { remoteUserIdOf } from '@/lib/server/remoteMaterialize';
import { stripHtml } from '@/lib/server/remoteProfile';

interface MastodonAccount {
  id?: string;
  username?: string;
  acct?: string;
  display_name?: string;
  note?: string;
  avatar?: string;
  header?: string;
  url?: string;
  uri?: string;
  followers_count?: number;
  following_count?: number;
  statuses_count?: number;
}

interface MastodonStatus {
  id?: string;
  uri?: string;
  url?: string;
  content?: string;
  created_at?: string;
  in_reply_to_id?: string | null;
  favourites_count?: number;
  reblogs_count?: number;
  replies_count?: number;
  account?: MastodonAccount;
}

async function resolveStatusLocation(
  postData: { remoteUrl?: string; remoteObjectId?: string; remoteActorId?: string },
  userAgent: string,
): Promise<{ domain: string; statusId: string } | null> {
  const rawUrl = postData.remoteUrl || postData.remoteObjectId || '';
  if (!rawUrl.startsWith('https://')) return null;

  let domain = '';
  try {
    domain = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }

  const f = federation();
  const plataforma = await f.store.getPlatform();
  if (!plataforma.enabled || plataforma.killSwitch) return null;
  const politica = await f.store.getInstancePolicy();
  if (decideInstance(domain, politica, f.ownHost).decision === 'reject') return null;

  const directMatch = rawUrl.match(/\/(\d+)(?:\/activity)?(?:\/)?(?:\?.*)?$/);
  if (directMatch?.[1]) {
    return { domain, statusId: directMatch[1] };
  }

  // Fallback via Mastodon search API
  const searchRes = await safeFetchText(
    `https://${domain}/api/v2/search?q=${encodeURIComponent(postData.remoteObjectId || rawUrl)}&resolve=true&type=statuses&limit=1`,
    {
      timeoutMs: 6000,
      maxBytes: 128_000,
      headers: { Accept: 'application/json', 'User-Agent': userAgent },
      allowedContentTypes: /^application\/json/i,
    },
  ).catch(() => null);

  if (searchRes?.ok) {
    try {
      const parsed = JSON.parse(searchRes.text) as { statuses?: { id?: string }[] };
      const foundId = parsed.statuses?.[0]?.id;
      if (typeof foundId === 'string' && foundId) {
        return { domain, statusId: foundId };
      }
    } catch {
      // ignora
    }
  }
  return null;
}

async function resolveAccountToUser(
  m: MastodonAccount,
  fallbackDomain: string,
  ownHostLower: string,
): Promise<{ uid: string; name: string; username: string; avatarUrl: string; actorId: string; isLocal: boolean; userObj: User } | null> {
  const actorId =
    (typeof m.uri === 'string' && m.uri.startsWith('https://') ? m.uri : null) ||
    (typeof m.url === 'string' && m.url.startsWith('https://') ? m.url : null);
  if (!actorId) return null;

  const acct = typeof m.acct === 'string' && m.acct ? m.acct : m.username || '';
  if (!acct) return null;
  const handle = acct.includes('@') ? acct : `${acct}@${fallbackDomain}`;
  const itemDomain = handle.split('@').pop()?.toLowerCase() || fallbackDomain;

  const db = adminFirestore();
  if (itemDomain === ownHostLower) {
    const localHandle = handle.split('@')[0].toLowerCase();
    const hSnap = await db.collection('ap_handles').doc(localHandle).get();
    const localUid = (hSnap.data() as { uid?: string } | undefined)?.uid;
    if (localUid) {
      const uSnap = await db.collection('users').doc(localUid).get();
      if (uSnap.exists) {
        const d = uSnap.data() as Record<string, unknown>;
        const userObj: User = {
          id: localUid,
          name: typeof d.name === 'string' ? d.name : 'Usuário',
          username: typeof d.username === 'string' ? d.username : handle.split('@')[0],
          email: '',
          bio: typeof d.bio === 'string' ? d.bio : '',
          avatarUrl: typeof d.avatarUrl === 'string' ? d.avatarUrl : '',
          coverImageUrl: typeof d.coverImageUrl === 'string' ? d.coverImageUrl : '',
          website: typeof d.website === 'string' ? d.website : '',
          followersCount: typeof d.followersCount === 'number' ? d.followersCount : 0,
          followingCount: typeof d.followingCount === 'number' ? d.followingCount : 0,
          postsCount: typeof d.postsCount === 'number' ? d.postsCount : 0,
          dmPreference: (d.dmPreference as User['dmPreference']) || 'everyone',
          isAdmin: Boolean(d.isAdmin),
          isModerator: Boolean(d.isModerator),
          profileVisibility: (d.profileVisibility as User['profileVisibility']) || 'public',
          createdAt: typeof d.createdAt === 'string' ? d.createdAt : new Date().toISOString(),
        };
        return {
          uid: localUid,
          name: userObj.name,
          username: userObj.username,
          avatarUrl: userObj.avatarUrl || '',
          actorId,
          isLocal: true,
          userObj,
        };
      }
    }
  }

  const uid = remoteUserIdOf(actorId);
  const name = (typeof m.display_name === 'string' && m.display_name.trim()) || m.username || handle.split('@')[0];
  const bio = typeof m.note === 'string' ? stripHtml(m.note).slice(0, 500) : '';
  const avatarUrl =
    typeof m.avatar === 'string' && m.avatar.startsWith('https://') && !m.avatar.includes('missing.png')
      ? m.avatar
      : '';
  const coverImageUrl =
    typeof m.header === 'string' && m.header.startsWith('https://') && !m.header.includes('missing.png')
      ? m.header
      : '';
  const url = typeof m.url === 'string' && m.url.startsWith('https://') ? m.url : actorId;
  const followersCount = typeof m.followers_count === 'number' ? m.followers_count : 0;
  const followingCount = typeof m.following_count === 'number' ? m.following_count : 0;
  const postsCount = typeof m.statuses_count === 'number' ? m.statuses_count : 0;

  await db.collection('users').doc(uid).set(
    {
      id: uid,
      name,
      username: handle,
      bio,
      avatarUrl,
      coverImageUrl,
      website: url,
      followersCount,
      followingCount,
      postsCount,
      profileVisibility: 'public',
      isRemoteFediverse: true,
      remoteActorId: actorId,
      remoteDomain: itemDomain,
      remoteUrl: url,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return {
    uid,
    name,
    username: handle,
    avatarUrl,
    actorId,
    isLocal: false,
    userObj: {
      id: uid,
      name,
      username: handle,
      email: '',
      bio,
      avatarUrl,
      coverImageUrl,
      website: url,
      followersCount,
      followingCount,
      postsCount,
      dmPreference: 'everyone',
      isAdmin: false,
      isModerator: false,
      profileVisibility: 'public',
      createdAt: new Date().toISOString(),
    },
  };
}

/** O que o `/api/v1/statuses/{id}` da origem diz sobre os três contadores (campo ausente = a origem não informou). */
const originCountsOf = (st: MastodonStatus) => ({
  likes: st.favourites_count,
  reposts: st.reblogs_count,
  commentsCount: st.replies_count,
});

// ───────────────────────── revalidação dos contadores em segundo plano ─────────────────────────
// Chamada pelo feed (`/api/ap/sync-counts`) para os posts remotos que acabaram de chegar perto da tela, para que o número
// já apareça sem abrir o post. Custa uma busca a SERVIDOR ALHEIO por post, então tudo aqui existe para limitar essa
// busca (a regra pura está em src/lib/federation/countSyncPolicy.ts e é testada em e2e/count-sync-check.mjs):
//  - validade: um post revalidado (por qualquer pessoa, em qualquer aba) não é buscado de novo por 3 min; falha passageira
//    espera 1 min e "não existe lá / não deixa ler" espera 30 min;
//  - por servidor: no máximo 2 buscas ao mesmo tempo e 20 por minuto, e quem responde 429/503 não recebe nada até o prazo
//    do `Retry-After` (o IP é compartilhado com a sincronização de comentários e de quem reagiu);
//  - a gravação passa pela regra de counterPolicy.ts DENTRO de transação (applyRemoteCounts): sobe, DESCE quando alguém
//    descurtiu na origem, e não perde a curtida daqui somada no meio do caminho.
const syncMemo = createSyncMemo();
const domainGate = createDomainGate();

type RemotePostFields = {
  remoteUrl?: string;
  remoteObjectId?: string;
  remoteActorId?: string;
  remoteCountsAtMs?: number;
};

/** Servidor de origem do post, lido do próprio documento (sem rede), ou `null`. */
function remoteHostOf(post: RemotePostFields): string | null {
  const raw = post.remoteUrl || post.remoteObjectId || '';
  if (!raw.startsWith('https://')) return null;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const syncUserAgent = () => `ExeLula/1.0 (+${federation().origin})`;

/** Busca o status na origem e o traduz para o que o orquestrador entende (sem decidir nada). */
async function fetchRemoteStatus(location: { domain: string; statusId: string }): Promise<FetchedStatus> {
  const res = await safeFetchText(`https://${location.domain}/api/v1/statuses/${encodeURIComponent(location.statusId)}`, {
    timeoutMs: 5000,
    maxBytes: 256_000,
    headers: { Accept: 'application/json', 'User-Agent': syncUserAgent() },
    allowedContentTypes: /^application\/json/i,
  }).catch(() => null);
  if (!res) return { kind: 'error' };
  if (res.status === 429 || res.status === 503) return { kind: 'rate-limited', status: res.status, retryAfter: res.headers['retry-after'] };
  if ([401, 403, 404, 410].includes(res.status)) return { kind: 'gone', status: res.status };
  if (!res.ok) return { kind: 'error', status: res.status };
  try {
    return { kind: 'ok', origin: originCountsOf(JSON.parse(res.text) as MastodonStatus) };
  } catch {
    return { kind: 'error', status: res.status };
  }
}

const syncOnePost = createCountSyncer<RemotePostFields>({
  now: () => Date.now(),
  readPost: async (id) => {
    const snap = await adminFirestore().collection('posts').doc(id).get();
    return snap.exists ? (snap.data() as RemotePostFields) : null;
  },
  hostOf: remoteHostOf,
  checkedAtMsOf: (post) => post.remoteCountsAtMs,
  locate: (post) => resolveStatusLocation(post, syncUserAgent()),
  fetchStatus: fetchRemoteStatus,
  apply: async (id, origin, fetchedAtMs) => {
    const decisions = await applyRemoteCounts(id, { origin, fetchedAtMs });
    if (!decisions) return 'missing';
    return Object.values(decisions).some((d) => d && d.action !== 'keep') ? 'updated' : 'unchanged';
  },
  gate: domainGate,
  memo: syncMemo,
  warn: (message) => console.warn(message),
});

/** Revalida os contadores de UM post remoto na origem (com todos os freios). Nunca lança. */
export function syncRemotePostCounts(postId: string, now?: number): Promise<CountSyncOutcome> {
  return syncOnePost(postId, now);
}

export async function syncRemotePostComments(postId: string): Promise<number> {
  const db = adminFirestore();
  const postSnap = await db.collection('posts').doc(postId).get();
  if (!postSnap.exists) return 0;
  const postData = postSnap.data() as {
    userId?: string;
    visibility?: string;
    commentsCount?: number;
    remoteUrl?: string;
    remoteObjectId?: string;
    remoteActorId?: string;
    isRemoteFediverse?: boolean;
  };
  if (!postData.isRemoteFediverse && !postId.startsWith('ap_')) return 0;

  const f = federation();
  const userAgent = `ExeLula/1.0 (+${f.origin})`;
  const loc = await resolveStatusLocation(postData, userAgent);
  if (!loc) return 0;

  const [ctxRes, statusRes] = await Promise.all([
    safeFetchText(
      `https://${loc.domain}/api/v1/statuses/${encodeURIComponent(loc.statusId)}/context`,
      {
        timeoutMs: 6000,
        maxBytes: 512_000,
        headers: { Accept: 'application/json', 'User-Agent': userAgent },
        allowedContentTypes: /^application\/json/i,
      },
    ).catch(() => null),
    safeFetchText(
      `https://${loc.domain}/api/v1/statuses/${encodeURIComponent(loc.statusId)}`,
      {
        timeoutMs: 6000,
        maxBytes: 256_000,
        headers: { Accept: 'application/json', 'User-Agent': userAgent },
        allowedContentTypes: /^application\/json/i,
      },
    ).catch(() => null),
  ]);

  if (statusRes?.ok) {
    try {
      // A origem é a fonte do número PÚBLICO; a regra (counterPolicy.ts) decide quando subir, quando descer (alguém descurtiu
      // no Fediverso) e quando desconfiar (zero de uma instância que esconde contagens). Dentro de uma transação, para não
      // desfazer uma curtida daqui somada no meio do caminho.
      await applyRemoteCounts(postId, { origin: originCountsOf(JSON.parse(statusRes.text) as MastodonStatus) }).catch(() => null);
    } catch {
      // ignora erro de parse do status remoto
    }
  }

  if (!ctxRes?.ok) return 0;
  let descendants: MastodonStatus[] = [];
  try {
    const parsed = JSON.parse(ctxRes.text) as { descendants?: MastodonStatus[] };
    if (Array.isArray(parsed.descendants)) descendants = parsed.descendants.slice(0, 40);
  } catch {
    return 0;
  }

  if (descendants.length === 0) return 0;

  const ownHostLower = f.ownHost.toLowerCase();
  const statusIdToCommentId = new Map<string, string>();
  for (const s of descendants) {
    const objId = s.uri || s.url || '';
    if (!objId || !s.id) continue;
    const cId = remotePostIdOf(objId);
    statusIdToCommentId.set(s.id, cId);
  }

  let added = 0;
  for (const s of descendants) {
    const objId = s.uri || s.url || '';
    const text = typeof s.content === 'string' ? stripHtml(s.content).slice(0, 2000) : '';
    if (!objId || !text || !s.account) continue;

    const resolvedAuthor = await resolveAccountToUser(s.account, loc.domain, ownHostLower);
    if (!resolvedAuthor) continue;

    const commentId = remotePostIdOf(objId);
    const parentCommentId =
      s.in_reply_to_id && s.in_reply_to_id !== loc.statusId
        ? (statusIdToCommentId.get(s.in_reply_to_id) ?? null)
        : null;
    const createdMs = s.created_at && Number.isFinite(Date.parse(s.created_at))
      ? Date.parse(s.created_at)
      : Date.now();

    const cRef = db.collection('posts').doc(postId).collection('comments').doc(commentId);
    const existing = await cRef.get();
    if (!existing.exists) {
      await cRef.set({
        userId: resolvedAuthor.uid,
        authorDetails: {
          userId: resolvedAuthor.uid,
          name: resolvedAuthor.name,
          username: resolvedAuthor.username,
          avatarUrl: resolvedAuthor.avatarUrl || null,
        },
        isRemoteFediverse: !resolvedAuthor.isLocal,
        remoteActorUrl: resolvedAuthor.actorId,
        remoteHandle: resolvedAuthor.username,
        apObjectId: objId,
        parentPostId: postId,
        postAuthorId: postData.userId || '',
        postVisibility: postData.visibility || 'public',
        parentCommentId,
        text,
        hasMedia: false,
        createdAt: Timestamp.fromMillis(createdMs),
        likes: typeof s.favourites_count === 'number' ? s.favourites_count : 0,
        repostsCount: typeof s.reblogs_count === 'number' ? s.reblogs_count : 0,
        repliesCount: typeof s.replies_count === 'number' ? s.replies_count : 0,
        isDeleted: false,
      });
      added++;
    } else if (!existing.data()?.apObjectId) {
      await cRef.update({ apObjectId: objId }).catch(() => null);
    }
  }

  // Piso, não valor: o `postData` lido no começo ficou velho durante as buscas e a materialização (uma comentada daqui
  // somada pela Function nesse meio tempo seria desfeita por um `update` com o número antigo). Na transação, só sobe.
  await applyRemoteCounts(postId, { lowerBound: { commentsCount: descendants.length } }).catch(() => null);
  return added;
}

async function fetchReactorsForStatus(
  loc: { domain: string; statusId: string },
  mode: 'likes' | 'reposts',
  expectedCount: number,
  callerUid?: string | null,
): Promise<{ users: User[]; restricted: boolean }> {
  const f = federation();
  const userAgent = `ExeLula/1.0 (+${f.origin})`;
  const db = adminFirestore();

  const endpoint = mode === 'likes' ? 'favourited_by' : 'reblogged_by';
  const res = await safeFetchText(
    `https://${loc.domain}/api/v1/statuses/${encodeURIComponent(loc.statusId)}/${endpoint}?limit=40`,
    {
      timeoutMs: 6000,
      maxBytes: 512_000,
      headers: { Accept: 'application/json', 'User-Agent': userAgent },
      allowedContentTypes: /^application\/json/i,
    },
  ).catch(() => null);

  if (!res?.ok) {
    return { users: [], restricted: expectedCount > 0 };
  }
  let items: MastodonAccount[] = [];
  try {
    const parsed = JSON.parse(res.text) as MastodonAccount[];
    if (Array.isArray(parsed)) items = parsed;
  } catch {
    return { users: [], restricted: expectedCount > 0 };
  }

  const ownHostLower = f.ownHost.toLowerCase();
  const resolvedList = (
    await Promise.all(items.map((m) => resolveAccountToUser(m, loc.domain, ownHostLower)))
  ).filter((x): x is NonNullable<typeof x> => Boolean(x));

  if (callerUid && resolvedList.length > 0) {
    const followChecks = await Promise.all(
      resolvedList.map((r) =>
        r.isLocal
          ? db.collection('users').doc(callerUid).collection('following').doc(r.uid).get()
          : db
              .collection('ap_following')
              .doc(callerUid)
              .collection('actors')
              .doc(remoteFollowDocIdOf(r.actorId))
              .get(),
      ),
    );
    followChecks.forEach((snap, idx) => {
      resolvedList[idx].userObj.isFollowing = snap.exists;
    });
  }

  const users = resolvedList.map((r) => r.userObj);
  return { users, restricted: users.length === 0 && expectedCount > 0 };
}

export async function fetchAndMaterializeRemotePostReactors(
  postId: string,
  mode: 'likes' | 'reposts',
  callerUid?: string | null,
): Promise<{ users: User[]; restricted: boolean }> {
  const db = adminFirestore();
  const postSnap = await db.collection('posts').doc(postId).get();
  if (!postSnap.exists) return { users: [], restricted: false };
  const postData = postSnap.data() as {
    remoteUrl?: string;
    remoteObjectId?: string;
    remoteActorId?: string;
    isRemoteFediverse?: boolean;
    likes?: number;
    reposts?: number;
  };
  if (!postData.isRemoteFediverse && !postId.startsWith('ap_')) {
    return { users: [], restricted: false };
  }

  const expectedCount =
    mode === 'likes' ? Number(postData.likes ?? 0) : Number(postData.reposts ?? 0);
  const f = federation();
  const userAgent = `ExeLula/1.0 (+${f.origin})`;
  const loc = await resolveStatusLocation(postData, userAgent);
  if (!loc) return { users: [], restricted: expectedCount > 0 };

  const result = await fetchReactorsForStatus(loc, mode, expectedCount, callerUid);
  // A lista traz só a primeira página: é um PISO (há pelo menos esta gente), nunca o total. Só faz o contador subir.
  if (result.users.length > 0) {
    await applyRemoteCounts(postId, { lowerBound: { [mode]: result.users.length } }).catch(() => null);
  }
  return result;
}

export async function fetchAndMaterializeRemoteCommentReactors(
  postId: string,
  commentId: string,
  mode: 'likes' | 'reposts',
  callerUid?: string | null,
): Promise<{ users: User[]; restricted: boolean }> {
  const db = adminFirestore();
  const commentSnap = await db
    .collection('posts')
    .doc(postId)
    .collection('comments')
    .doc(commentId)
    .get();
  if (!commentSnap.exists) return { users: [], restricted: false };

  const commentData = commentSnap.data() as {
    apObjectId?: string;
    remoteUrl?: string;
    remoteObjectId?: string;
    remoteActorUrl?: string;
    isRemoteFediverse?: boolean;
    likes?: number;
    repostsCount?: number;
  };
  if (!commentData.isRemoteFediverse && !commentId.startsWith('ap_')) {
    return { users: [], restricted: false };
  }

  const expectedCount =
    mode === 'likes' ? Number(commentData.likes ?? 0) : Number(commentData.repostsCount ?? 0);
  const f = federation();
  const userAgent = `ExeLula/1.0 (+${f.origin})`;
  const loc = await resolveStatusLocation(
    {
      remoteUrl: commentData.remoteUrl || commentData.apObjectId,
      remoteObjectId: commentData.remoteObjectId || commentData.apObjectId,
      remoteActorId: commentData.remoteActorUrl,
    },
    userAgent,
  );
  if (!loc) return { users: [], restricted: expectedCount > 0 };

  const result = await fetchReactorsForStatus(loc, mode, expectedCount, callerUid);
  // O contador a subir é o do COMENTÁRIO. Antes isto gravava o tamanho da lista de reagentes do comentário no contador do POST
  // pai (`posts/{postId}.likes`/`.reposts`), inflando o post toda vez que alguém abria a lista de curtidas de um comentário.
  await raiseRemoteCommentCount(postId, commentId, mode === 'likes' ? 'likes' : 'repostsCount', result.users.length).catch(() => null);
  return result;
}
