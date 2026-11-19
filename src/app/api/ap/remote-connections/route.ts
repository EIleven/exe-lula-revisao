// src/app/api/ap/remote-connections/route.ts
// Lista e materializa seguidores/seguindo públicos de um perfil remoto do Fediverso.
import type { NextRequest } from 'next/server';
import { identify, json } from '@/lib/server/federation';
import { fetchAndMaterializeRemoteConnections } from '@/lib/server/remoteConnections';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';
import { evaluateRequestSecurity } from '@/lib/security/antiBotGuard';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const ip = requestIp(request);
  const guard = evaluateRequestSecurity({
    ip,
    path: '/api/ap/remote-connections',
    userAgent: request.headers.get('user-agent'),
    acceptLanguage: request.headers.get('accept-language'),
  });
  if (!guard.allowed && guard.action === 'block') {
    return json(429, { error: 'bloqueio-anti-bot' }, { 'Retry-After': String(guard.retryAfterSec || 30) });
  }
  if (!takeRateLimit(`ap-remote-connections:${ip}`, 20, 60_000)) {
    return json(429, { error: 'muitas-requisicoes' }, { 'Retry-After': '30' });
  }

  const userId = request.nextUrl.searchParams.get('userId') ?? '';
  const type = request.nextUrl.searchParams.get('type') ?? '';

  if (!/^ap_[a-f0-9]+$/.test(userId) || (type !== 'followers' && type !== 'following')) {
    return json(400, { error: 'parametros-invalidos' });
  }

  let callerUid: string | null = null;
  if (request.headers.get('authorization')?.startsWith('Bearer ')) {
    const caller = await identify(request);
    callerUid = caller?.uid ?? null;
  }

  const result = await fetchAndMaterializeRemoteConnections(userId, type, callerUid);
  return json(200, { users: result.users, restricted: Boolean(result.restricted) });
}

