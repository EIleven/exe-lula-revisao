// src/lib/server/remoteConnections.ts
// Importa e materializa seguidores e seguindo de perfis remotos do Fediverso sob demanda.
import { remoteFollowDocIdOf } from '@/lib/activitypub/remoteIdentity';
import { FieldValue } from 'firebase-admin/firestore';
import type { User } from '@/lib/types';
import { decideInstance } from '@/lib/activitypub/gate';
import { safeFetchText } from '@/lib/security/safe-fetch';
import { federation } from '@/lib/server/federation';
import { adminFirestore } from '@/lib/server/firebaseAdmin';
import { remoteUserIdOf } from '@/lib/server/remoteMaterialize';
import { getAnySigningHeaders, stripHtml } from '@/lib/server/remoteProfile';

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

function remoteDomainFromUrl(rawUrl: string, fallback: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return fallback;
  }
}

export interface RemoteConnectionsResult {
  users: User[];
  restricted?: boolean;
}

export async function fetchAndMaterializeRemoteConnections(
  profileUserId: string,
  type: 'followers' | 'following',
  callerUid?: string | null,
): Promise<RemoteConnectionsResult> {
  const db = adminFirestore();
  const profileSnap = await db.collection('users').doc(profileUserId).get();
  if (!profileSnap.exists) return { users: [] };

  const profileData = profileSnap.data() as {
    username?: string;
    remoteDomain?: string;
    remoteActorId?: string;
    isRemoteFediverse?: boolean;
  };
  if (!profileData.isRemoteFediverse && !profileUserId.startsWith('ap_')) {
    return { users: [] };
  }

  const domain =
    profileData.remoteDomain ||
    (profileData.username?.includes('@') ? profileData.username.split('@').pop() : '') ||
    '';
  if (!domain) return { users: [] };

  const f = federation();
  const plataforma = await f.store.getPlatform();
  if (!plataforma.enabled || plataforma.killSwitch) return { users: [] };

  const politica = await f.store.getInstancePolicy();
  if (decideInstance(domain, politica, f.ownHost).decision === 'reject') return { users: [] };

  const userAgent = `ExeLula/1.0 (+${f.origin})`;
  const localUsername = (profileData.username || '').split('@')[0];
  let sawRestricted = false;

  const fetchApWithOptionalSigning = async (
    targetUrl: string,
    acceptHeader: string,
    timeoutMs: number,
    maxBytes: number,
  ) => {
    const firstTry = await safeFetchText(targetUrl, {
      timeoutMs,
      maxBytes,
      headers: { Accept: acceptHeader, 'User-Agent': userAgent },
      allowedContentTypes: /^application\/(activity\+json|ld\+json|json)/i,
    }).catch(() => null);
    if (firstTry?.ok) return firstTry;
    if (firstTry && (firstTry.status === 401 || firstTry.status === 403)) {
      const sigHeaders = await getAnySigningHeaders(f.origin, targetUrl);
      if (Object.keys(sigHeaders).length > 0) {
        const signedTry = await safeFetchText(targetUrl, {
          timeoutMs,
          maxBytes,
          headers: { Accept: acceptHeader, 'User-Agent': userAgent, ...sigHeaders },
          allowedContentTypes: /^application\/(activity\+json|ld\+json|json)/i,
        }).catch(() => null);
        if (signedTry?.ok) return signedTry;
        if (signedTry && (signedTry.status === 401 || signedTry.status === 403)) {
          sawRestricted = true;
        }
        return signedTry;
      }
      sawRestricted = true;
    }
    return firstTry;
  };

  const accounts: {
    actorId: string;
    handle: string;
    domain: string;
    name: string;
    bio: string;
    avatarUrl: string;
    coverImageUrl: string;
    url: string;
    followersCount: number;
    followingCount: number;
    postsCount: number;
  }[] = [];

  // 1. Tenta API pública Mastodon/Pleroma/Akkoma/GoToSocial (/api/v1/accounts/:id/followers|following)
  if (localUsername) {
    const lookupRes = await safeFetchText(
      `https://${domain}/api/v1/accounts/lookup?acct=${encodeURIComponent(localUsername)}`,
      {
        timeoutMs: 5000,
        maxBytes: 64_000,
        headers: { Accept: 'application/json', 'User-Agent': userAgent },
        allowedContentTypes: /^application\/json/i,
      },
    ).catch(() => null);

    let mastoId: string | null = null;
    if (lookupRes?.ok) {
      try {
        const parsed = JSON.parse(lookupRes.text) as { id?: string };
        if (typeof parsed.id === 'string' && parsed.id) mastoId = parsed.id;
      } catch {
        // ignora
      }
    }

    if (mastoId) {
      const listRes = await safeFetchText(
        `https://${domain}/api/v1/accounts/${encodeURIComponent(mastoId)}/${type}?limit=80`,
        {
          timeoutMs: 6000,
          maxBytes: 512_000,
          headers: { Accept: 'application/json', 'User-Agent': userAgent },
          allowedContentTypes: /^application\/json/i,
        },
      ).catch(() => null);

      if (listRes && (listRes.status === 400 || listRes.status === 401 || listRes.status === 403)) {
        sawRestricted = true;
      }

      if (listRes?.ok) {
        try {
          const items = JSON.parse(listRes.text) as MastodonAccount[];
          if (Array.isArray(items)) {
            for (const m of items) {
              const actorId =
                (typeof m.uri === 'string' && m.uri.startsWith('https://') ? m.uri : null) ||
                (typeof m.url === 'string' && m.url.startsWith('https://') ? m.url : null);
              if (!actorId) continue;

              const acct = typeof m.acct === 'string' && m.acct ? m.acct : m.username || '';
              if (!acct) continue;
              const handle = acct.includes('@') ? acct : `${acct}@${domain}`;
              const itemDomain = handle.split('@').pop()?.toLowerCase() || remoteDomainFromUrl(actorId, domain);

              accounts.push({
                actorId,
                handle,
                domain: itemDomain,
                name: (typeof m.display_name === 'string' && m.display_name.trim()) || m.username || handle.split('@')[0],
                bio: typeof m.note === 'string' ? stripHtml(m.note).slice(0, 500) : '',
                avatarUrl:
                  typeof m.avatar === 'string' && m.avatar.startsWith('https://') && !m.avatar.includes('missing.png')
                    ? m.avatar
                    : '',
                coverImageUrl:
                  typeof m.header === 'string' && m.header.startsWith('https://') && !m.header.includes('missing.png')
                    ? m.header
                    : '',
                url: (typeof m.url === 'string' && m.url.startsWith('https://') ? m.url : actorId),
                followersCount: typeof m.followers_count === 'number' ? m.followers_count : 0,
                followingCount: typeof m.following_count === 'number' ? m.following_count : 0,
                postsCount: typeof m.statuses_count === 'number' ? m.statuses_count : 0,
              });
            }
          }
        } catch {
          // ignora
        }
      }
    }
  }

  // 2. Fallback ActivityPub OrderedCollection caso o servidor não exponha API Mastodon
  if (accounts.length === 0 && profileData.remoteActorId) {
    const actorRes = await fetchApWithOptionalSigning(
      profileData.remoteActorId,
      'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams", application/json',
      5000,
      128_000,
    );

    let collectionUrl: string | null = null;
    if (actorRes?.ok) {
      try {
        const actorJson = JSON.parse(actorRes.text) as { followers?: string; following?: string };
        const candidate = type === 'followers' ? actorJson.followers : actorJson.following;
        if (typeof candidate === 'string' && candidate.startsWith('https://')) {
          collectionUrl = candidate;
        }
      } catch {
        // ignora
      }
    }

    if (collectionUrl) {
      const colRes = await fetchApWithOptionalSigning(
        collectionUrl,
        'application/activity+json, application/ld+json, application/json',
        5000,
        256_000,
      );

      let itemUrls: string[] = [];
      if (colRes?.ok) {
        try {
          const colJson = JSON.parse(colRes.text) as {
            orderedItems?: unknown[];
            items?: unknown[];
            first?: string | { orderedItems?: unknown[]; items?: unknown[] };
          };
          const extractUrls = (arr?: unknown[]) =>
            (arr || [])
              .map((x) => (typeof x === 'string' ? x : (x as { id?: string })?.id))
              .filter((x): x is string => typeof x === 'string' && x.startsWith('https://'));

          itemUrls = extractUrls(colJson.orderedItems ?? colJson.items);
          if (itemUrls.length === 0 && typeof colJson.first === 'string' && colJson.first.startsWith('https://')) {
            const firstRes = await fetchApWithOptionalSigning(
              colJson.first,
              'application/activity+json, application/ld+json, application/json',
              5000,
              256_000,
            );
            if (firstRes?.ok) {
              const firstJson = JSON.parse(firstRes.text) as { orderedItems?: unknown[]; items?: unknown[] };
              itemUrls = extractUrls(firstJson.orderedItems ?? firstJson.items);
            }
          } else if (itemUrls.length === 0 && colJson.first && typeof colJson.first === 'object') {
            itemUrls = extractUrls(colJson.first.orderedItems ?? colJson.first.items);
          }
        } catch {
          // ignora
        }
      }

      const settled = await Promise.all(
        itemUrls.slice(0, 30).map(async (actorUrl) => {
          const res = await fetchApWithOptionalSigning(
            actorUrl,
            'application/activity+json, application/ld+json, application/json',
            4000,
            96_000,
          );
          if (!res?.ok) return null;
          try {
            const a = JSON.parse(res.text) as {
              id?: string;
              preferredUsername?: string;
              name?: string;
              summary?: string;
              url?: string;
              icon?: { url?: string } | { url?: string }[];
              image?: { url?: string } | { url?: string }[];
            };
            const id = typeof a.id === 'string' && a.id.startsWith('https://') ? a.id : actorUrl;
            const d = remoteDomainFromUrl(id, domain);
            const pref = typeof a.preferredUsername === 'string' && a.preferredUsername ? a.preferredUsername : 'user';
            const iconRaw = Array.isArray(a.icon) ? a.icon[0]?.url : a.icon?.url;
            const imgRaw = Array.isArray(a.image) ? a.image[0]?.url : a.image?.url;
            return {
              actorId: id,
              handle: `${pref}@${d}`,
              domain: d,
              name: (typeof a.name === 'string' && a.name.trim()) || pref,
              bio: typeof a.summary === 'string' ? stripHtml(a.summary).slice(0, 500) : '',
              avatarUrl: typeof iconRaw === 'string' && iconRaw.startsWith('https://') ? iconRaw : '',
              coverImageUrl: typeof imgRaw === 'string' && imgRaw.startsWith('https://') ? imgRaw : '',
              url: typeof a.url === 'string' && a.url.startsWith('https://') ? a.url : id,
              followersCount: 0,
              followingCount: 0,
              postsCount: 0,
            };
          } catch {
            return null;
          }
        }),
      );
      for (const acc of settled) {
        if (acc) accounts.push(acc);
      }
    }
  }

  // 3. Fallback API Misskey/Sharkey/Firefish (/api/users/show + /api/users/followers|following)
  if (accounts.length === 0 && localUsername) {
    const showRes = await safeFetchText(`https://${domain}/api/users/show`, {
      method: 'POST',
      timeoutMs: 5000,
      maxBytes: 96_000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': userAgent,
      },
      body: JSON.stringify({ username: localUsername }),
      allowedContentTypes: /^application\/json/i,
    }).catch(() => null);

    if (showRes?.ok) {
      try {
        const misskeyUser = JSON.parse(showRes.text) as {
          id?: string;
          followersVisibility?: string;
          followingVisibility?: string;
        };
        const isPrivate =
          (type === 'followers' && misskeyUser.followersVisibility === 'private') ||
          (type === 'following' && misskeyUser.followingVisibility === 'private');
        if (isPrivate) {
          sawRestricted = true;
        } else if (typeof misskeyUser.id === 'string' && misskeyUser.id) {
          const listRes = await safeFetchText(`https://${domain}/api/users/${type}`, {
            method: 'POST',
            timeoutMs: 6000,
            maxBytes: 512_000,
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              'User-Agent': userAgent,
            },
            body: JSON.stringify({ userId: misskeyUser.id, limit: 60 }),
            allowedContentTypes: /^application\/json/i,
          }).catch(() => null);

          if (listRes && (listRes.status === 400 || listRes.status === 401 || listRes.status === 403)) {
            sawRestricted = true;
          } else if (listRes?.ok) {
            type MisskeyRelUser = {
              id?: string;
              username?: string;
              host?: string | null;
              name?: string | null;
              avatarUrl?: string | null;
              bannerUrl?: string | null;
              description?: string | null;
              uri?: string | null;
              url?: string | null;
              followersCount?: number;
              followingCount?: number;
              notesCount?: number;
            };
            const items = JSON.parse(listRes.text) as Array<{
              follower?: MisskeyRelUser;
              followee?: MisskeyRelUser;
            }>;
            if (Array.isArray(items)) {
              for (const entry of items) {
                const u = type === 'followers' ? entry.follower : entry.followee;
                if (!u || typeof u.username !== 'string' || !u.username) continue;
                const itemDomain = (typeof u.host === 'string' && u.host ? u.host : domain).toLowerCase();
                const actorId =
                  (typeof u.uri === 'string' && u.uri.startsWith('https://') ? u.uri : null) ||
                  (typeof u.url === 'string' && u.url.startsWith('https://') ? u.url : null) ||
                  (u.id ? `https://${itemDomain}/users/${u.id}` : '');
                if (!actorId) continue;

                accounts.push({
                  actorId,
                  handle: `${u.username}@${itemDomain}`,
                  domain: itemDomain,
                  name: (typeof u.name === 'string' && u.name.trim()) || u.username,
                  bio: typeof u.description === 'string' ? stripHtml(u.description).slice(0, 500) : '',
                  avatarUrl: typeof u.avatarUrl === 'string' && u.avatarUrl.startsWith('https://') ? u.avatarUrl : '',
                  coverImageUrl: typeof u.bannerUrl === 'string' && u.bannerUrl.startsWith('https://') ? u.bannerUrl : '',
                  url: (typeof u.url === 'string' && u.url.startsWith('https://') ? u.url : actorId),
                  followersCount: typeof u.followersCount === 'number' ? u.followersCount : 0,
                  followingCount: typeof u.followingCount === 'number' ? u.followingCount : 0,
                  postsCount: typeof u.notesCount === 'number' ? u.notesCount : 0,
                });
              }
            }
          }
        }
      } catch {
        // ignora
      }
    }
  }

  if (accounts.length === 0) return { users: [], restricted: sawRestricted };

  const ownHostLower = f.ownHost.toLowerCase();

  // Separa contas locais (do próprio Exe. Lula) das contas remotas do Fediverso
  const localResolutionMap = new Map<string, { user: User }>();
  const localCandidates = accounts.filter((a) => a.domain === ownHostLower);
  if (localCandidates.length > 0) {
    const localHandles = Array.from(
      new Set(localCandidates.map((a) => a.handle.split('@')[0].toLowerCase()).filter(Boolean)),
    );
    const handleSnaps = await Promise.all(
      localHandles.map((h) => db.collection('ap_handles').doc(h).get()),
    );
    const handleToUid = new Map<string, string>();
    handleSnaps.forEach((snap, idx) => {
      if (snap.exists) {
        const uid = (snap.data() as { uid?: string })?.uid;
        if (typeof uid === 'string' && uid) {
          handleToUid.set(localHandles[idx], uid);
        }
      }
    });

    const uniqueUids = Array.from(new Set(handleToUid.values()));
    const [userSnaps, followingSnaps] = await Promise.all([
      Promise.all(uniqueUids.map((uid) => db.collection('users').doc(uid).get())),
      callerUid
        ? Promise.all(
            uniqueUids.map((uid) =>
              db.collection('users').doc(callerUid).collection('following').doc(uid).get(),
            ),
          )
        : Promise.resolve([]),
    ]);

    const uidToUser = new Map<string, User>();
    userSnaps.forEach((snap, idx) => {
      if (!snap.exists) return;
      const d = snap.data() as Record<string, unknown>;
      const uid = uniqueUids[idx];
      const isFollowing = Boolean(followingSnaps[idx]?.exists);
      uidToUser.set(uid, {
        id: uid,
        name: typeof d.name === 'string' ? d.name : 'Usuário',
        username: typeof d.username === 'string' ? d.username : '',
        email: typeof d.email === 'string' ? d.email : '',
        bio: typeof d.bio === 'string' ? d.bio : '',
        avatarUrl: typeof d.avatarUrl === 'string' ? d.avatarUrl : '',
        coverImageUrl: typeof d.coverImageUrl === 'string' ? d.coverImageUrl : '',
        website: typeof d.website === 'string' ? d.website : '',
        followersCount: typeof d.followersCount === 'number' ? d.followersCount : 0,
        followingCount: typeof d.followingCount === 'number' ? d.followingCount : 0,
        postsCount: typeof d.postsCount === 'number' ? d.postsCount : 0,
        dmPreference: (d.dmPreference as User['dmPreference']) || 'all',
        isAdmin: Boolean(d.isAdmin),
        isModerator: Boolean(d.isModerator),
        profileVisibility: (d.profileVisibility as User['profileVisibility']) || 'public',
        createdAt: typeof d.createdAt === 'string' ? d.createdAt : new Date().toISOString(),
        isFollowing,
      });
    });

    for (const [h, uid] of handleToUid.entries()) {
      const localUser = uidToUser.get(uid);
      if (localUser) {
        localResolutionMap.set(h, { user: localUser });
      }
    }
  }

  // Verifica quais contas remotas o usuário logado já segue no Fediverso
  const remoteAccounts = accounts.filter(
    (a) => !(a.domain === ownHostLower && localResolutionMap.has(a.handle.split('@')[0].toLowerCase())),
  );
  const followedSet = new Set<string>();
  if (callerUid && remoteAccounts.length > 0) {
    const actorHashes = remoteAccounts.map((a) => remoteFollowDocIdOf(a.actorId));
    const snaps = await Promise.all(
      actorHashes.map((h) => db.collection('ap_following').doc(callerUid).collection('actors').doc(h).get()),
    );
    snaps.forEach((s, idx) => {
      if (s.exists) followedSet.add(remoteAccounts[idx].actorId);
    });
  }

  // Materializa perfis e vínculos no Firestore em lote
  const batch = db.batch();
  const nowIso = new Date().toISOString();
  const resultUsers: User[] = [];

  for (const acc of accounts) {
    const localKey = acc.domain === ownHostLower ? acc.handle.split('@')[0].toLowerCase() : '';
    const resolvedLocal = localKey ? localResolutionMap.get(localKey) : undefined;
    if (resolvedLocal) {
      const linkRef = db.collection('users').doc(profileUserId).collection(type).doc(resolvedLocal.user.id);
      batch.set(
        linkRef,
        {
          userId: resolvedLocal.user.id,
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      resultUsers.push(resolvedLocal.user);
      continue;
    }

    const uid = remoteUserIdOf(acc.actorId);
    const userRef = db.collection('users').doc(uid);
    batch.set(
      userRef,
      {
        id: uid,
        name: acc.name,
        username: acc.handle,
        bio: acc.bio,
        avatarUrl: acc.avatarUrl,
        coverImageUrl: acc.coverImageUrl,
        website: acc.url,
        followersCount: acc.followersCount,
        followingCount: acc.followingCount,
        postsCount: acc.postsCount,
        profileVisibility: 'public',
        isRemoteFediverse: true,
        remoteActorId: acc.actorId,
        remoteDomain: acc.domain,
        remoteUrl: acc.url,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const linkRef = db.collection('users').doc(profileUserId).collection(type).doc(uid);
    batch.set(
      linkRef,
      {
        userId: uid,
        isRemoteFediverse: true,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    resultUsers.push({
      id: uid,
      name: acc.name,
      username: acc.handle,
      email: '',
      bio: acc.bio,
      avatarUrl: acc.avatarUrl,
      coverImageUrl: acc.coverImageUrl,
      website: acc.url,
      followersCount: acc.followersCount,
      followingCount: acc.followingCount,
      postsCount: acc.postsCount,
      dmPreference: 'none',
      isAdmin: false,
      isModerator: false,
      profileVisibility: 'public',
      createdAt: nowIso,
      isFollowing: followedSet.has(acc.actorId),
    });
  }

  await batch.commit();
  return { users: resultUsers, restricted: false };
}

