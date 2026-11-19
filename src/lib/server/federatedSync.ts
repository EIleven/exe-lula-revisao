// src/lib/server/federatedSync.ts
// Sincronização consentida (Mastodon / Bluesky) de quem o usuário segue e posts públicos recentes no login federado.
import { createHash } from 'node:crypto';
import type { Agent } from '@atproto/api';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { remoteFollowDocIdOf, remoteUserIdOf } from '@/lib/activitypub/remoteIdentity';
import { safeFetchText } from '@/lib/security/safe-fetch';
import { adminFirestore } from '@/lib/server/firebaseAdmin';
import { stripHtml } from '@/lib/server/remoteProfile';

export interface FederatedSyncConsent {
  accepted: boolean;
  syncProfile: boolean;
  syncFollowing: boolean;
  syncPosts: boolean;
  transferMode: 'p2p_first' | 'direct';
  termsVersion: string;
  acceptedAt: string;
}

export const FEDERATED_TERMS_VERSION = '2026-11-15';

export function normalizeFederatedConsent(raw: unknown): FederatedSyncConsent {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const accepted = obj.accepted !== false;
  return {
    accepted,
    syncProfile: accepted && obj.syncProfile !== false,
    syncFollowing: accepted && obj.syncFollowing !== false,
    syncPosts: accepted && obj.syncPosts === true,
    transferMode: obj.transferMode === 'direct' ? 'direct' : 'p2p_first',
    termsVersion: FEDERATED_TERMS_VERSION,
    acceptedAt: new Date().toISOString(),
  };
}

// Usado apenas para ids de posts importados (`imp_`) e `bluesky_follows`; ids `ap_` usam `remoteUserIdOf`/`remoteFollowDocIdOf`.
const shortHash = (s: string) => createHash('sha256').update(s).digest('hex').substring(0, 24);

interface MastodonFollowingAccount {
  id?: string;
  username?: string;
  acct?: string;
  display_name?: string;
  note?: string;
  avatar?: string;
  header?: string;
  url?: string;
  uri?: string;
  locked?: boolean;
  followers_count?: number;
  following_count?: number;
  statuses_count?: number;
}

interface MastodonStatusItem {
  id?: string;
  uri?: string;
  url?: string;
  content?: string;
  created_at?: string;
  sensitive?: boolean;
  visibility?: string;
  in_reply_to_id?: string | null;
  reblog?: unknown;
  media_attachments?: Array<{
    type?: string;
    url?: string;
    preview_url?: string;
    description?: string;
  }>;
}

export async function syncMastodonData(params: {
  uid: string;
  domain: string;
  accountId: string;
  accessToken: string;
  consent: FederatedSyncConsent;
  origin: string;
}): Promise<{ followedImported: number; postsImported: number }> {
  const { uid, domain, accountId, accessToken, consent, origin } = params;
  const db = adminFirestore();
  let followedImported = 0;
  let postsImported = 0;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'User-Agent': `HiperVerso/1.0 (+${origin})`,
  };

  if (consent.syncFollowing) {
    try {
      const res = await safeFetchText(
        `https://${domain}/api/v1/accounts/${encodeURIComponent(accountId)}/following?limit=40`,
        { timeoutMs: 5000, maxBytes: 512_000, headers, allowedContentTypes: /^application\/json/i },
      );
      if (res.ok) {
        const list = JSON.parse(res.text) as MastodonFollowingAccount[];
        if (Array.isArray(list)) {
          const OWN_DOMAINS = new Set([
            'exercitodolula.app',
            'hiperverso.app',
            'hiperverso.social',
          ]);
          const userSnap = await db.collection('users').doc(uid).get();
          const batch = db.batch();
          let ops = 0;
          for (const acc of list.slice(0, 40)) {
            const actorId = typeof acc.uri === 'string' && acc.uri.startsWith('https://') ? acc.uri : typeof acc.url === 'string' && acc.url.startsWith('https://') ? acc.url : '';
            if (!actorId) continue;
            const handle = acc.acct?.includes('@') ? acc.acct : `${acc.username || 'user'}@${domain}`;
            const handleDomain = (handle.split('@').pop() || domain).toLowerCase();
            let actorHost = '';
            try {
              actorHost = new URL(actorId).hostname.toLowerCase();
            } catch {
              actorHost = '';
            }

            // Nunca cria fantasma ap_ para contas do nosso próprio domínio: resolve para o UID real local
            if (OWN_DOMAINS.has(handleDomain) || OWN_DOMAINS.has(actorHost)) {
              const localPart = handle.split('@')[0].toLowerCase();
              if (localPart) {
                const [apHandleSnap, unameSnap] = await Promise.all([
                  db.collection('ap_handles').doc(localPart).get(),
                  db.collection('usernames').doc(localPart).get(),
                ]);
                const localTargetUid =
                  (apHandleSnap.exists ? (apHandleSnap.data()?.uid as string) : undefined) ||
                  (unameSnap.exists
                    ? ((unameSnap.data()?.userId || unameSnap.data()?.uid) as string)
                    : undefined);
                if (localTargetUid && localTargetUid !== uid) {
                  batch.set(
                    db.collection('users').doc(uid).collection('following').doc(localTargetUid),
                    { userId: localTargetUid, createdAt: FieldValue.serverTimestamp() },
                    { merge: true }
                  );
                  batch.set(
                    db.collection('users').doc(localTargetUid).collection('followers').doc(uid),
                    { userId: uid, createdAt: FieldValue.serverTimestamp() },
                    { merge: true }
                  );
                  followedImported++;
                  ops += 2;
                }
              }
              continue;
            }

            const remoteUid = remoteUserIdOf(actorId);
            const actorHash = remoteFollowDocIdOf(actorId);
            const avatar = typeof acc.avatar === 'string' && acc.avatar.startsWith('https://') && !acc.avatar.includes('missing.png') ? acc.avatar : '';
            const header = typeof acc.header === 'string' && acc.header.startsWith('https://') && !acc.header.includes('missing.png') ? acc.header : '';

            batch.set(
              db.collection('users').doc(remoteUid),
              {
                id: remoteUid,
                name: (acc.display_name || '').trim() || acc.username || handle.split('@')[0],
                name_lowercase: ((acc.display_name || '').trim() || acc.username || handle.split('@')[0] || '').toLowerCase(),
                username: handle,
                bio: typeof acc.note === 'string' ? stripHtml(acc.note).slice(0, 500) : '',
                avatarUrl: avatar,
                coverImageUrl: header,
                website: acc.url || actorId,
                followersCount: typeof acc.followers_count === 'number' ? acc.followers_count : 0,
                followingCount: typeof acc.following_count === 'number' ? acc.following_count : 0,
                postsCount: typeof acc.statuses_count === 'number' ? acc.statuses_count : 0,
                dmPreference: 'everyone',
                profileVisibility: 'public',
                isRemoteFediverse: true,
                remoteActorId: actorId,
                remoteDomain: handle.split('@').pop() || domain,
                remoteUrl: acc.url || actorId,
                remoteManuallyApprovesFollowers: acc.locked === true,
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true },
            );
            batch.set(
              db.collection('ap_following').doc(uid).collection('actors').doc(actorHash),
              {
                actorId,
                handle,
                domain: handle.split('@').pop() || domain,
                name: (acc.display_name || '').trim() || acc.username || handle,
                iconUrl: avatar || null,
                url: acc.url || actorId,
                status: 'accepted',
                importedFrom: 'mastodon_oauth',
                createdAtMs: Date.now(),
              },
              { merge: true },
            );
            batch.set(
              db.collection('users').doc(uid).collection('following').doc(remoteUid),
              { userId: remoteUid, isRemoteFediverse: true, createdAt: FieldValue.serverTimestamp() },
              { merge: true },
            );
            followedImported++;
            ops += 3;
            if (ops >= 360) break;
          }
          if (followedImported > 0) {
            const currentFollowing = Number((userSnap.data() as { followingCount?: number } | undefined)?.followingCount || 0);
            if (currentFollowing < followedImported) {
              batch.set(db.collection('users').doc(uid), { followingCount: followedImported }, { merge: true });
            }
            await batch.commit();
          }
        }
      }
    } catch {
      // sincronização é melhor esforço: nunca impede o login
    }
  }

  if (consent.syncPosts) {
    try {
      const res = await safeFetchText(
        `https://${domain}/api/v1/accounts/${encodeURIComponent(accountId)}/statuses?limit=20&exclude_replies=true&exclude_reblogs=true`,
        { timeoutMs: 5000, maxBytes: 512_000, headers, allowedContentTypes: /^application\/json/i },
      );
      if (res.ok) {
        const statuses = JSON.parse(res.text) as MastodonStatusItem[];
        if (Array.isArray(statuses) && statuses.length > 0) {
          const userSnap = await db.collection('users').doc(uid).get();
          const u = (userSnap.data() || {}) as { name?: string; username?: string; avatarUrl?: string };
          const batch = db.batch();
          for (const st of statuses.slice(0, 20)) {
            if (st.reblog || st.in_reply_to_id || (st.visibility !== 'public' && st.visibility !== 'unlisted')) continue;
            const sourceUri = st.uri || st.url || `mastodon:${domain}:${st.id}`;
            if (!sourceUri) continue;
            const postId = `imp_${shortHash(`${uid}:${sourceUri}`)}`;
            const text = typeof st.content === 'string' ? stripHtml(st.content).slice(0, 2000) : '';
            const mediaList = (st.media_attachments ?? [])
              .filter((m) => m.url && m.url.startsWith('https://'))
              .slice(0, 4)
              .map((m) => ({
                url: m.url!,
                type: (m.type === 'video' || m.type === 'gifv' ? 'video' : 'image') as 'image' | 'video',
                alt: m.description || '',
              }));
            const createdDate = st.created_at ? new Date(st.created_at) : new Date();
            const createdTs = Number.isNaN(createdDate.getTime()) ? Timestamp.now() : Timestamp.fromDate(createdDate);

            batch.set(
              db.collection('posts').doc(postId),
              {
                id: postId,
                userId: uid,
                authorDetails: {
                  userId: uid,
                  name: u.name || u.username || 'Usuário',
                  username: u.username || 'user',
                  avatarUrl: u.avatarUrl || '',
                },
                type: 'post',
                text: text || null,
                ...(mediaList.length > 0 ? { media: mediaList, hasMedia: true } : { hasMedia: false }),
                visibility: 'public',
                sensitive: Boolean(st.sensitive && mediaList.length > 0),
                importedFromUri: sourceUri,
                createdAt: createdTs,
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true },
            );
            postsImported++;
          }
          if (postsImported > 0) {
            await batch.commit();
          }
        }
      }
    } catch {
      // melhor esforço
    }
  }

  return { followedImported, postsImported };
}

export async function syncBlueskyData(params: {
  uid: string;
  agent: Agent;
  did: string;
  consent: FederatedSyncConsent;
}): Promise<{ followedImported: number; postsImported: number }> {
  const { uid, agent, did, consent } = params;
  const db = adminFirestore();
  let followedImported = 0;
  let postsImported = 0;

  if (consent.syncFollowing) {
    try {
      const res = await agent.getFollows({ actor: did, limit: 40 });
      const follows = res.data?.follows ?? [];
      if (follows.length > 0) {
        const batch = db.batch();
        for (const f of follows.slice(0, 40)) {
          if (!f.did) continue;
          const ref = db.collection('users').doc(uid).collection('bluesky_follows').doc(shortHash(f.did));
          batch.set(
            ref,
            {
              did: f.did,
              handle: f.handle,
              displayName: f.displayName || f.handle,
              avatar: f.avatar || '',
              importedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          followedImported++;
        }
        if (followedImported > 0) {
          await batch.commit();
        }
      }
    } catch {
      // melhor esforço
    }
  }

  if (consent.syncPosts) {
    try {
      const feed = await agent.getAuthorFeed({ actor: did, limit: 20, filter: 'posts_no_replies' });
      const items = feed.data?.feed ?? [];
      if (items.length > 0) {
        const userSnap = await db.collection('users').doc(uid).get();
        const u = (userSnap.data() || {}) as { name?: string; username?: string; avatarUrl?: string };
        const batch = db.batch();
        for (const entry of items.slice(0, 20)) {
          if (entry.reason) continue; // ignora reposts
          const post = entry.post;
          if (!post?.uri) continue;
          const record = (post.record || {}) as { text?: string; createdAt?: string };
          const postId = `imp_${shortHash(`${uid}:${post.uri}`)}`;
          const createdDate = record.createdAt ? new Date(record.createdAt) : new Date();
          const createdTs = Number.isNaN(createdDate.getTime()) ? Timestamp.now() : Timestamp.fromDate(createdDate);

          batch.set(
            db.collection('posts').doc(postId),
            {
              id: postId,
              userId: uid,
              authorDetails: {
                userId: uid,
                name: u.name || u.username || 'Usuário',
                username: u.username || 'user',
                avatarUrl: u.avatarUrl || '',
              },
              type: 'post',
              text: typeof record.text === 'string' ? record.text.slice(0, 2000) : null,
              hasMedia: false,
              visibility: 'public',
              importedFromUri: post.uri,
              createdAt: createdTs,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          postsImported++;
        }
        if (postsImported > 0) {
          await batch.commit();
        }
      }
    } catch {
      // melhor esforço
    }
  }

  return { followedImported, postsImported };
}

