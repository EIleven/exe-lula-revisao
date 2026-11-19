// src/app/api/ap/dm/route.ts
// Envia uma Mensagem Direta (ActivityPub Create { Note } privada) para um ator remoto do Fediverso.
import { FieldValue } from 'firebase-admin/firestore';
import type { NextRequest } from 'next/server';
import { loadPrivateKey } from '@/lib/activitypub/account';
import { activityUrl, actorUrl, keyIdUrl } from '@/lib/activitypub/identity';
import { signRequest } from '@/lib/activitypub/signature';
import { safeFetchText } from '@/lib/security/safe-fetch';
import { ensureCallerFederationAccount, federation, identify, json, readJsonObject } from '@/lib/server/federation';
import { adminFirestore } from '@/lib/server/firebaseAdmin';
import { materializeRemoteProfile } from '@/lib/server/remoteMaterialize';
import { resolveRemoteProfile } from '@/lib/server/remoteProfile';

export const dynamic = 'force-dynamic';

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function linkifyEscapedHtml(escaped: string): string {
  return escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) =>
      `<a href="${url}" target="_blank" rel="nofollow noopener noreferrer">${url}</a>`
  );
}

function buildMentionHtml(
  raw: string,
  targetActorId: string,
  fullHandle: string
): string {
  const cleanHandle = fullHandle.replace(/^@+/, '');
  const localPart = cleanHandle.split('@')[0] || 'user';
  const mentionSpan = `<span class="h-card"><a href="${escapeHtml(
    targetActorId
  )}" class="u-url mention">@<span>${escapeHtml(localPart)}</span></a></span>`;
  const bodyHtml = linkifyEscapedHtml(escapeHtml(raw)).replace(/\n/g, '<br />');
  return `<p>${mentionSpan} ${bodyHtml}</p>`;
}

export async function POST(request: NextRequest) {
  const caller = await identify(request);
  if (!caller) return json(401, { error: 'nao-autenticado' });

  const body = await readJsonObject(request);
  if (!body) return json(400, { error: 'json-invalido' });

  const recipientId = typeof body.recipientId === 'string' ? body.recipientId.trim() : '';
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const conversationId =
    typeof body.conversationId === 'string' && /^[A-Za-z0-9_-]{3,120}$/.test(body.conversationId.trim())
      ? body.conversationId.trim()
      : '';
  if (!recipientId || !text) {
    return json(400, { error: 'parametros-obrigatorios' });
  }

  const f = federation();
  const plataforma = await f.store.getPlatform();
  if (!plataforma.enabled || plataforma.killSwitch) {
    return json(409, { error: 'plataforma-desligada' });
  }

  const conta = await ensureCallerFederationAccount(caller);
  if (!conta?.enabled || !conta.handle) {
    return json(409, { error: 'federacao-nao-ativada' });
  }
  if (conta.paused) {
    return json(409, { error: 'conta-pausada' });
  }

  const privateKeyPem = await loadPrivateKey(f.account(), caller.uid);
  if (!privateKeyPem) {
    return json(500, { error: 'chave-indisponivel' });
  }

  const db = adminFirestore();
  const recipientSnap = await db.collection('users').doc(recipientId).get();
  if (!recipientSnap.exists) {
    return json(404, { error: 'destinatario-nao-encontrado' });
  }

  const rData = recipientSnap.data() as {
    username?: string;
    federatedLoginHandle?: string;
    federatedLoginProvider?: string;
    remoteActorId?: string;
    remoteInbox?: string;
    isRemoteFediverse?: boolean;
  };

  let targetActorId = typeof rData.remoteActorId === 'string' ? rData.remoteActorId : '';
  let targetInbox = typeof rData.remoteInbox === 'string' ? rData.remoteInbox : '';
  const handleForResolution =
    (rData.federatedLoginProvider === 'fediverse' && typeof rData.federatedLoginHandle === 'string'
      ? rData.federatedLoginHandle
      : '') ||
    (typeof rData.username === 'string' ? rData.username : '');

  if ((!targetActorId || !targetInbox) && handleForResolution.includes('@')) {
    const resolved = await resolveRemoteProfile(handleForResolution, { withPosts: false });
    if (resolved.ok) {
      if (recipientId.startsWith('ap_')) {
        await materializeRemoteProfile(resolved.profile).catch(() => null);
      }
      targetActorId = resolved.profile.actorId;
      targetInbox = resolved.profile.inbox || resolved.profile.sharedInbox || '';
    }
  }

  if (!targetActorId || !targetInbox) {
    return json(422, { error: 'inbox-remoto-indisponivel' });
  }

  const localActor = actorUrl(f.origin, conta.handle);
  const targetMentionName = rData.username?.startsWith('@')
    ? rData.username
    : `@${rData.username || 'user'}`;

  // Se a mensagem veio de um grupo, inclui metadados ActivityPub compartilhados (to + Mention tags + context + inReplyTo)
  // para que Mastodon, Catodon, Misskey e Wafrn agrupem todas as falas em um único fio coletivo.
  let groupThreadRootNoteId: string | null = null;
  let shouldSaveGroupRoot = false;
  const extraGroupMentions: Array<{ type: 'Mention'; href: string; name: string }> = [];
  const extraGroupActors: string[] = [];

  if (conversationId) {
    const convSnap = await db.collection('conversations').doc(conversationId).get().catch(() => null);
    const convData = convSnap?.exists
      ? (convSnap.data() as {
          isGroup?: boolean;
          participantIds?: string[];
          apGroupThreadRootNoteId?: string;
        })
      : null;
    if (convData?.isGroup && Array.isArray(convData.participantIds) && convData.participantIds.includes(caller.uid)) {
      if (typeof convData.apGroupThreadRootNoteId === 'string' && convData.apGroupThreadRootNoteId.startsWith('http')) {
        groupThreadRootNoteId = convData.apGroupThreadRootNoteId;
      } else {
        shouldSaveGroupRoot = true;
      }

      const peerIds = convData.participantIds
        .filter((pid) => pid && pid !== caller.uid && pid !== recipientId)
        .slice(0, 30);

      if (peerIds.length > 0) {
        const userRefs = peerIds.map((pid) => db.collection('users').doc(pid));
        const accRefs = peerIds.map((pid) => db.collection('ap_accounts').doc(pid));
        const [userSnaps, accSnaps] = await Promise.all([
          db.getAll(...userRefs).catch(() => []),
          db.getAll(...accRefs).catch(() => []),
        ]);
        const accById = new Map<string, string>();
        for (const aSnap of accSnaps) {
          if (aSnap.exists) {
            const h = (aSnap.data() as { handle?: string })?.handle;
            if (h) accById.set(aSnap.id, h);
          }
        }
        for (const uSnap of userSnaps) {
          if (!uSnap.exists) continue;
          const u = uSnap.data() as {
            username?: string;
            federatedLoginProvider?: string;
            federatedLoginHandle?: string;
            remoteActorId?: string;
          };
          let peerActorId = typeof u.remoteActorId === 'string' ? u.remoteActorId : '';
          let peerHandle =
            (u.federatedLoginProvider === 'fediverse' && u.federatedLoginHandle) ||
            u.username ||
            '';
          const localApHandle = accById.get(uSnap.id);
          if (!peerActorId && localApHandle) {
            peerActorId = actorUrl(f.origin, localApHandle);
            peerHandle = localApHandle;
          }
          if (peerActorId && peerActorId.startsWith('http') && peerActorId !== targetActorId && peerActorId !== localActor) {
            extraGroupActors.push(peerActorId);
            const clean = peerHandle.replace(/^@+/, '');
            if (clean) {
              extraGroupMentions.push({
                type: 'Mention',
                href: peerActorId,
                name: `@${clean}`,
              });
            }
          }
        }
      }
    }
  }

  const msgSuffix = `dm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const actId = activityUrl(f.origin, conta.handle, actSuffix(msgSuffix));
  const noteId = activityUrl(f.origin, conta.handle, `note-${msgSuffix}`);
  const published = new Date().toISOString();
  const originHost = f.origin.replace(/^https?:\/\//i, '').replace(/\/+$/, '');

  const visibility = body.visibility === 'public' ? 'public' : 'direct';
  const isDirect = visibility === 'direct';
  const toRecipients = isDirect
    ? Array.from(new Set([targetActorId, ...extraGroupActors]))
    : ['https://www.w3.org/ns/activitystreams#Public'];
  const ccRecipients = isDirect
    ? []
    : Array.from(new Set([targetActorId, ...extraGroupActors]));

  const noteTags: Array<{ type: 'Mention'; href: string; name: string }> = [
    {
      type: 'Mention',
      href: targetActorId,
      name: targetMentionName,
    },
    ...extraGroupMentions,
  ];

  const noteObject = {
    id: noteId,
    type: 'Note',
    attributedTo: localActor,
    published,
    to: toRecipients,
    cc: ccRecipients,
    content: buildMentionHtml(text, targetActorId, rData.username || 'user'),
    directMessage: isDirect,
    ...(conversationId
      ? {
          context: `${f.origin.replace(/\/+$/, '')}/ap/groups/${conversationId}`,
          conversation: `tag:${originHost},2026:group:${conversationId}`,
          ...(groupThreadRootNoteId ? { inReplyTo: groupThreadRootNoteId } : {}),
        }
      : {}),
    tag: noteTags,
  };

  const createActivity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: actId,
    type: 'Create',
    actor: localActor,
    published,
    to: toRecipients,
    cc: ccRecipients,
    directMessage: isDirect,
    object: noteObject,
  };

  const bodyStr = JSON.stringify(createActivity);
  const signedHeaders = signRequest({
    method: 'POST',
    url: targetInbox,
    body: bodyStr,
    keyId: keyIdUrl(f.origin, conta.handle),
    privateKeyPem,
    now: Date.now(),
  });

  const res = await safeFetchText(targetInbox, {
    method: 'POST',
    timeoutMs: 8000,
    maxBytes: 64_000,
    headers: {
      ...signedHeaders,
      'Content-Type': 'application/activity+json',
      Accept: 'application/activity+json, application/json',
      'User-Agent': `HiperVerso/1.0 (+${f.origin})`,
    },
    body: bodyStr,
  }).catch((err) => ({ ok: false, status: 502, text: String(err) }));

  if (!res.ok) {
    return json(502, {
      error: 'falha-entrega-dm',
      status: res.status,
      detail: res.text.slice(0, 200),
    });
  }

  await db
    .collection('users')
    .doc(recipientId)
    .set({ remoteInbox: targetInbox, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    .catch(() => null);

  if (conversationId && shouldSaveGroupRoot) {
    await db
      .collection('conversations')
      .doc(conversationId)
      .set({ apGroupThreadRootNoteId: noteId }, { merge: true })
      .catch(() => null);
  }

  return json(200, { ok: true, activityId: actId, noteId });
}

function actSuffix(msgSuffix: string): string {
  return `create-${msgSuffix}`;
}

