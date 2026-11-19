// src/app/api/ap/lookup/route.ts
// Busca remota segura (SSRF-safe) de perfis do Fediverso via WebFinger + ActivityPub Person.
import type { NextRequest } from 'next/server';
import { json } from '@/lib/server/federation';
import { localUserIdOfHandle } from '@/lib/server/localIdentity';
import { resolveRemoteProfile } from '@/lib/server/remoteProfile';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';
import { evaluateRequestSecurity } from '@/lib/security/antiBotGuard';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const ip = requestIp(request);
  const guard = evaluateRequestSecurity({
    ip,
    path: '/api/ap/lookup',
    userAgent: request.headers.get('user-agent'),
    acceptLanguage: request.headers.get('accept-language'),
  });
  if (!guard.allowed && guard.action === 'block') {
    return json(429, { error: 'bloqueio-anti-bot' }, { 'Retry-After': String(guard.retryAfterSec || 30) });
  }
  if (!takeRateLimit(`ap-lookup:${ip}`, 30, 60_000)) {
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
    // Perfil que aprova seguidores manualmente: o botão vira "Pedir para seguir" (e abre o bilhete cordial).
    manuallyApprovesFollowers: p.manuallyApprovesFollowers === true,
  });
}
