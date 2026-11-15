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

function textToHtml(raw: string): string {
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return `<p>${escaped.replace(/\n/g, '<br />')}</p>`;
}

export async function POST(request: NextRequest) {
  const caller = await identify(request);
  if (!caller) return json(401, { error: 'nao-autenticado' });

  const body = await readJsonObject(request);
  if (!body) return json(400, { error: 'json-invalido' });

  const recipientId = typeof body.recipientId === 'string' ? body.recipientId.trim() : '';
  const text = typeof body.text === 'string' ? body.text.trim() : '';
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
    remoteActorId?: string;
    remoteInbox?: string;
    isRemoteFediverse?: boolean;
  };

  let targetActorId = typeof rData.remoteActorId === 'string' ? rData.remoteActorId : '';
  let targetInbox = typeof rData.remoteInbox === 'string' ? rData.remoteInbox : '';

  if ((!targetActorId || !targetInbox) && typeof rData.username === 'string' && rData.username.includes('@')) {
    const resolved = await resolveRemoteProfile(rData.username, { withPosts: false });
    if (resolved.ok) {
      await materializeRemoteProfile(resolved.profile).catch(() => null);
      targetActorId = resolved.profile.actorId;
      targetInbox = resolved.profile.inbox || resolved.profile.sharedInbox || '';
    }
  }

  if (!targetActorId || !targetInbox) {
    return json(422, { error: 'inbox-remoto-indisponivel' });
  }

  const localActor = actorUrl(f.origin, conta.handle);
  const msgSuffix = `dm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const actId = activityUrl(f.origin, conta.handle, actSuffix(msgSuffix));
  const noteId = activityUrl(f.origin, conta.handle, `note-${msgSuffix}`);
  const published = new Date().toISOString();

  const noteObject = {
    id: noteId,
    type: 'Note',
    attributedTo: localActor,
    published,
    to: [targetActorId],
    cc: [],
    content: textToHtml(text),
    directMessage: true,
    tag: [
      {
        type: 'Mention',
        href: targetActorId,
        name: rData.username?.startsWith('@') ? rData.username : `@${rData.username || 'user'}`,
      },
    ],
  };

  const createActivity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: actId,
    type: 'Create',
    actor: localActor,
    published,
    to: [targetActorId],
    cc: [],
    directMessage: true,
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
      'User-Agent': `ExeLula/1.0 (+${f.origin})`,
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

  return json(200, { ok: true, activityId: actId, noteId });
}

function actSuffix(msgSuffix: string): string {
  return `create-${msgSuffix}`;
}

