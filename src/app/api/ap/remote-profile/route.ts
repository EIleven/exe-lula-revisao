// src/app/api/ap/remote-profile/route.ts
// Perfil completo de um usuário remoto do Fediverso (com posts públicos recentes e status de follow de quem pede).
//
// Esta rota GRAVA no banco (materializa o perfil e os posts do remoto), por isso exige login: antes qualquer visitante,
// sem conta, fazia o servidor buscar e gravar o que um servidor qualquer respondesse.
import type { NextRequest } from 'next/server';
import { remoteFollowDocIdOf, remoteUserIdOf } from '@/lib/activitypub/remoteIdentity';
import { identify, json } from '@/lib/server/federation';
import { adminFirestore } from '@/lib/server/firebaseAdmin';
import { localUserIdOfHandle } from '@/lib/server/localIdentity';
import { materializeRemoteProfile } from '@/lib/server/remoteMaterialize';
import { resolveRemoteProfile } from '@/lib/server/remoteProfile';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!takeRateLimit(`ap-remote-profile:${requestIp(request)}`, 20, 60_000)) {
    return json(429, { error: 'muitas-requisicoes' }, { 'Retry-After': '30' });
  }
  const caller = await identify(request);
  if (!caller) return json(401, { error: 'login-obrigatorio' });
  if (!takeRateLimit(`ap-remote-profile-uid:${caller.uid}`, 40, 60_000)) {
    return json(429, { error: 'muitas-requisicoes' }, { 'Retry-After': '30' });
  }

  const handle = request.nextUrl.searchParams.get('handle') ?? '';
  const res = await resolveRemoteProfile(handle, { withPosts: true });
  if (!res.ok) {
    if (res.error === 'perfil-local') {
      // Alguém do NOSSO domínio: quem chamou abre o perfil local, em vez de ganhar um "fantasma" ap_.
      const localUserId = await localUserIdOfHandle(res.localHandle);
      return json(res.status, { error: res.error, ...(localUserId ? { localUserId } : {}) });
    }
    return json(res.status, { error: res.error });
  }

  const db = adminFirestore();
  const remoteUid = remoteUserIdOf(res.profile.actorId);
  const [acctSnap, followSnap, followerSnap] = await Promise.all([
    db.collection('users').doc(caller.uid).collection('private').doc('federation').get(),
    db.collection('ap_following').doc(caller.uid).collection('actors').doc(remoteFollowDocIdOf(res.profile.actorId)).get(),
    db.collection('users').doc(caller.uid).collection('followers').doc(remoteUid).get(),
  ]);
  const acctData = acctSnap.data();
  const callerFederationEnabled = acctData?.enabled === true && acctData?.paused !== true;
  const isFollowing = followSnap.exists;
  const isFollowedBy = followerSnap.exists;

  const { user: nativeUser, posts: nativePosts } = await materializeRemoteProfile(res.profile);

  return json(200, {
    ...res.profile,
    nativeUser: { ...nativeUser, isFollowing, isFollowedBy },
    nativePosts,
    isFollowing,
    isFollowedBy,
    callerFederationEnabled,
  });
}
