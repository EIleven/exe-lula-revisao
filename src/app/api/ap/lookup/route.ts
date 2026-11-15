// src/app/api/ap/lookup/route.ts
// Busca remota segura (SSRF-safe) de perfis do Fediverso via WebFinger + ActivityPub Person.
import type { NextRequest } from 'next/server';
import { json } from '@/lib/server/federation';
import { localUserIdOfHandle } from '@/lib/server/localIdentity';
import { resolveRemoteProfile } from '@/lib/server/remoteProfile';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!takeRateLimit(`ap-lookup:${requestIp(request)}`, 30, 60_000)) {
    return json(429, { error: 'muitas-requisicoes' }, { 'Retry-After': '30' });
  }

  const rawQ = request.nextUrl.searchParams.get('q') ?? '';
  const res = await resolveRemoteProfile(rawQ, { withPosts: false });
  if (!res.ok) {
    if (res.error === 'perfil-local') {
      const localUserId = await localUserIdOfHandle(res.localHandle);
      return json(res.status, { error: res.error, ...(localUserId ? { localUserId } : {}) });
    }
    return json(res.status, { error: res.error });
  }
  const p = res.profile;
  return json(200, {
    actorId: p.actorId,
    handle: p.handle,
    domain: p.domain,
    name: p.name,
    summary: p.summary,
    iconUrl: p.iconUrl,
    url: p.url,
  });
}
