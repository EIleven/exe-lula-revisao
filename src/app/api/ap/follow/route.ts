// src/app/api/ap/follow/route.ts
// Seguir, PEDIR para seguir (perfil fechado), deixar de seguir e cancelar um pedido, num perfil remoto do Fediverso. As regras vivem em
// lib/activitypub/outboundFollow.ts (testadas sem banco nem rede); aqui só entram a identidade, o banco, a assinatura e a entrega.
import { FieldValue } from 'firebase-admin/firestore';
import type { NextRequest } from 'next/server';
import { loadPrivateKey } from '@/lib/activitypub/account';
import { keyIdUrl } from '@/lib/activitypub/identity';
import {
  followRemote,
  unfollowRemote,
  type FollowRecord,
  type OutboundFollowDeps,
  type RemoteFollowTarget,
} from '@/lib/activitypub/outboundFollow';
import { remoteFollowDocIdOf, remoteUserIdOf } from '@/lib/activitypub/remoteIdentity';
import { signRequest } from '@/lib/activitypub/signature';
import { safeFetchText } from '@/lib/security/safe-fetch';
import { ensureCallerFederationAccount, federation, identify, json, readJsonObject } from '@/lib/server/federation';
import { adminFirestore } from '@/lib/server/firebaseAdmin';
import { materializeRemoteProfile } from '@/lib/server/remoteMaterialize';
import { resolveRemoteProfile, type RemoteProfileData } from '@/lib/server/remoteProfile';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

type RemoteUserDoc = {
  username?: string;
  remoteActorId?: string;
  remoteInbox?: string | null;
};

export async function POST(request: NextRequest) {
  const caller = await identify(request);
  if (!caller) return json(401, { error: 'nao-autenticado' });

  const body = await readJsonObject(request);
  if (!body) return json(400, { error: 'json-invalido' });

  let handle = typeof body.handle === 'string' ? body.handle.trim() : '';
  const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId.trim() : '';
  // `cancel` (cancelar o pedido) e `unfollow` são o mesmo `Undo(Follow)`: a tela só muda o rótulo.
  const action = body.action === 'unfollow' || body.action === 'cancel' ? 'unfollow' : 'follow';

  // Cada pedido de seguir é UM clique de uma pessoa: o teto barra laço de script e rajada (e o aviso que cada Follow gera do outro lado).
  const limiteUsuario = takeRateLimit(`ap-follow:${caller.uid}`, action === 'follow' ? 30 : 60, 60_000);
  const limiteIp = takeRateLimit(`ap-follow-ip:${requestIp(request)}`, 90, 60_000);
  if (!limiteUsuario || !limiteIp) return json(429, { error: 'muitas-requisicoes' }, { 'Retry-After': '30' });

  const db = adminFirestore();
  let stored: RemoteUserDoc | null = null;
  if (targetUserId) {
    const targetSnap = await db.collection('users').doc(targetUserId).get();
    if (targetSnap.exists) {
      stored = targetSnap.data() as RemoteUserDoc;
      if (!handle && typeof stored.username === 'string' && stored.username.includes('@')) handle = stored.username.trim();
    }
  }
  if (!handle) return json(400, { error: 'handle-obrigatorio' });

  const f = federation();
  const plataforma = await f.store.getPlatform();
  const plataformaLigada = plataforma.enabled && !plataforma.killSwitch;
  const conta = plataformaLigada ? await ensureCallerFederationAccount(caller) : null;
  const contaPronta = Boolean(conta?.enabled && conta.handle && !conta.paused);
  const privateKeyPem = contaPronta ? await loadPrivateKey(f.account(), caller.uid) : null;
  const podeEnviar = Boolean(plataformaLigada && contaPronta && privateKeyPem);

  if (action === 'follow') {
    // Seguir de verdade exige tudo pronto; cada falta tem o seu código estável (a tela traduz).
    if (!plataformaLigada) return json(409, { error: 'plataforma-desligada' });
    if (!conta?.enabled || !conta.handle) return json(409, { error: 'federacao-nao-ativada' });
    if (conta.paused) return json(409, { error: 'conta-pausada' });
    if (!privateKeyPem) return json(500, { error: 'chave-indisponivel' });
  }

  const deliver: OutboundFollowDeps['deliver'] = async (inbox, activity) => {
    if (!privateKeyPem || !conta?.handle) return { ok: false, status: 0 };
    const payload = JSON.stringify(activity);
    const signedHeaders = signRequest({
      method: 'POST',
      url: inbox,
      body: payload,
      privateKeyPem,
      keyId: keyIdUrl(f.origin, conta.handle),
      now: Date.now(),
    });
    try {
      const res = await safeFetchText(inbox, {
        method: 'POST',
        body: payload,
        headers: {
          ...signedHeaders,
          'Content-Type': 'application/activity+json',
          Accept: 'application/activity+json',
          'User-Agent': `HiperVerso/1.0 (+${f.origin})`,
        },
        timeoutMs: 10_000,
        discardBody: true,
      });
      return { ok: res.status >= 200 && res.status < 300, status: res.status };
    } catch {
      return { ok: false, status: 0 };
    }
  };

  const followRef = (actorHash: string) => db.collection('ap_following').doc(caller.uid).collection('actors').doc(actorHash);
  const baseDeps = (materialize?: OutboundFollowDeps['materialize']): OutboundFollowDeps => ({
    now: Date.now,
    origin: f.origin,
    local: { uid: caller.uid, handle: conta?.handle ?? '' },
    getFollow: async (_uid, actorHash) => {
      const snap = await followRef(actorHash).get();
      return snap.exists ? (snap.data() as FollowRecord) : null;
    },
    saveFollow: async (_uid, actorHash, registro) => {
      await followRef(actorHash).set(registro);
    },
    deleteFollow: async (_uid, actorHash) => {
      await followRef(actorHash).delete();
    },
    saveEdges: async (uid, remoteUid) => {
      await Promise.all([
        db.collection('users').doc(uid).collection('following').doc(remoteUid).set({
          userId: remoteUid,
          isRemoteFediverse: true,
          createdAt: FieldValue.serverTimestamp(),
        }),
        db.collection('users').doc(remoteUid).collection('followers').doc(uid).set({
          userId: uid,
          createdAt: FieldValue.serverTimestamp(),
        }),
      ]);
    },
    deleteEdges: async (uid, remoteUid) => {
      await Promise.all([
        db.collection('users').doc(uid).collection('following').doc(remoteUid).delete(),
        db.collection('users').doc(remoteUid).collection('followers').doc(uid).delete(),
      ]);
    },
    deliver,
    materialize,
    nonce: () => Math.random().toString(36).slice(2, 8),
  });

  if (action === 'unfollow') {
    // Sair não depende da rede: o que é nosso é limpo primeiro; o endereço do perfil vem do que já guardamos (sem buscar na rede).
    let actorId = typeof stored?.remoteActorId === 'string' ? stored.remoteActorId : '';
    let inbox = typeof stored?.remoteInbox === 'string' && stored.remoteInbox ? stored.remoteInbox : null;
    if (!actorId || !inbox) {
      try {
        const resolved = await resolveRemoteProfile(handle, { withPosts: false });
        if (resolved.ok) {
          actorId = actorId || resolved.profile.actorId;
          inbox = inbox || resolved.profile.inbox || resolved.profile.sharedInbox;
        }
      } catch {
        // a busca é só para achar a caixa de entrada: sem ela, sai-se do mesmo jeito
      }
    }
    if (!actorId) return json(404, { error: 'perfil-remoto-desconhecido' });
    const result = await unfollowRemote(baseDeps(), { actorId, handle, inbox: podeEnviar ? inbox : null });
    return json(result.status, result.body);
  }

  const resolved = await resolveRemoteProfile(handle, { withPosts: true });
  if (!resolved.ok) return json(resolved.status, { error: resolved.error });
  const remote: RemoteProfileData = resolved.profile;
  const target: RemoteFollowTarget = {
    actorId: remote.actorId,
    handle: remote.handle,
    domain: remote.domain,
    name: remote.name,
    iconUrl: remote.iconUrl,
    url: remote.url,
    inbox: remote.inbox,
    sharedInbox: remote.sharedInbox,
    manuallyApprovesFollowers: remote.manuallyApprovesFollowers === true,
  };
  const result = await followRemote(
    baseDeps(async () => {
      await materializeRemoteProfile(remote);
    }),
    target,
    { note: body.note },
  );
  // O id do usuário remoto que a tela conhece (ap_…): devolvido para ela atualizar o cartão certo.
  return json(
    result.status,
    result.status === 200 ? { ...result.body, remoteUserId: remoteUserIdOf(remote.actorId), actorHash: remoteFollowDocIdOf(remote.actorId) } : result.body,
  );
}
