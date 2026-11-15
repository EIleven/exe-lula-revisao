// src/app/api/ap/follow/route.ts
// Seguir ou deixar de seguir um perfil remoto do Fediverso (envia Follow / Undo(Follow) assinado).
import { FieldValue } from 'firebase-admin/firestore';
import type { NextRequest } from 'next/server';
import { loadPrivateKey } from '@/lib/activitypub/account';
import { buildFollow, buildUndo } from '@/lib/activitypub/activity';
import { remoteFollowDocIdOf, remoteUserIdOf } from '@/lib/activitypub/remoteIdentity';
import { activityUrl, actorUrl, keyIdUrl } from '@/lib/activitypub/identity';
import { signRequest } from '@/lib/activitypub/signature';
import { safeFetchText } from '@/lib/security/safe-fetch';
import { ensureCallerFederationAccount, federation, identify, json, readJsonObject } from '@/lib/server/federation';
import { adminFirestore } from '@/lib/server/firebaseAdmin';
import { materializeRemoteProfile } from '@/lib/server/remoteMaterialize';
import { resolveRemoteProfile } from '@/lib/server/remoteProfile';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const caller = await identify(request);
  if (!caller) return json(401, { error: 'nao-autenticado' });

  const body = await readJsonObject(request);
  if (!body) return json(400, { error: 'json-invalido' });

  let handle = typeof body.handle === 'string' ? body.handle.trim() : '';
  const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId.trim() : '';
  const action = body.action === 'unfollow' ? 'unfollow' : 'follow';
  const db = adminFirestore();
  if (!handle && targetUserId) {
    const targetSnap = await db.collection('users').doc(targetUserId).get();
    if (targetSnap.exists) {
      const targetData = targetSnap.data() as { username?: string };
      if (typeof targetData.username === 'string' && targetData.username.includes('@')) {
        handle = targetData.username.trim();
      }
    }
  }
  if (!handle) return json(400, { error: 'handle-obrigatorio' });

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

  const resolved = await resolveRemoteProfile(handle, { withPosts: action === 'follow' });
  if (!resolved.ok) {
    return json(resolved.status, { error: resolved.error });
  }

  const remote = resolved.profile;
  if (action === 'follow') {
    await materializeRemoteProfile(remote).catch(() => null);
  }
  const targetInbox = remote.inbox || remote.sharedInbox;
  if (!targetInbox) {
    return json(422, { error: 'inbox-remoto-indisponivel' });
  }

  const actorHash = remoteFollowDocIdOf(remote.actorId);
  const followRef = db.collection('ap_following').doc(caller.uid).collection('actors').doc(actorHash);
  const existingSnap = await followRef.get();

  const localActor = actorUrl(f.origin, conta.handle);
  const keyId = keyIdUrl(f.origin, conta.handle);
  const nowMs = Date.now();

  let activity: Record<string, unknown>;
  let followActivityId: string;
  if (action === 'follow') {
    followActivityId = activityUrl(f.origin, conta.handle, `follow-${actorHash}-${nowMs}`);
    activity = buildFollow(followActivityId, localActor, remote.actorId);
  } else {
    const prevId = existingSnap.exists && typeof existingSnap.data()?.followActivityId === 'string'
      ? (existingSnap.data()!.followActivityId as string)
      : activityUrl(f.origin, conta.handle, `follow-${actorHash}`);
    followActivityId = prevId;
    const undoId = activityUrl(f.origin, conta.handle, `undo-follow-${actorHash}-${nowMs}`);
    activity = buildUndo(undoId, localActor, {
      id: prevId,
      type: 'Follow',
      actor: localActor,
      object: remote.actorId,
    });
  }

  const payload = JSON.stringify(activity);
  const signedHeaders = signRequest({
    method: 'POST',
    url: targetInbox,
    body: payload,
    privateKeyPem,
    keyId,
    now: nowMs,
  });

  const deliveryRes = await safeFetchText(targetInbox, {
    method: 'POST',
    body: payload,
    headers: {
      ...signedHeaders,
      'Content-Type': 'application/activity+json',
      Accept: 'application/activity+json',
      'User-Agent': `ExeLula/1.0 (+${f.origin})`,
    },
    timeoutMs: 10_000,
    discardBody: true,
  });

  if (deliveryRes.status < 200 || deliveryRes.status >= 300) {
    return json(502, { error: 'falha-entrega-remota', status: deliveryRes.status });
  }

  const remoteUid = remoteUserIdOf(remote.actorId);
  const userFollowingRef = db.collection('users').doc(caller.uid).collection('following').doc(remoteUid);
  const remoteFollowerRef = db.collection('users').doc(remoteUid).collection('followers').doc(caller.uid);

  if (action === 'follow') {
    await Promise.all([
      followRef.set({
        actorId: remote.actorId,
        handle: remote.handle,
        domain: remote.domain,
        name: remote.name,
        iconUrl: remote.iconUrl,
        url: remote.url,
        followActivityId,
        createdAtMs: nowMs,
      }),
      userFollowingRef.set({
        userId: remoteUid,
        isRemoteFediverse: true,
        createdAt: FieldValue.serverTimestamp(),
      }),
      remoteFollowerRef.set({
        userId: caller.uid,
        createdAt: FieldValue.serverTimestamp(),
      }),
    ]);
  } else {
    await Promise.all([
      followRef.delete(),
      userFollowingRef.delete(),
      remoteFollowerRef.delete(),
    ]);
  }

  return json(200, { ok: true, following: action === 'follow' });
}
