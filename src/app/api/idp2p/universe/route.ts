// src/app/api/idp2p/universe/route.ts
// Grava e lê o universo ativo (lente IDP2P) via cookie leve no servidor, sem estado pesado no cliente.
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { evaluateRequestSecurity } from '@/lib/security/antiBotGuard';
import { requestIp } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

const LENS_COOKIE = 'idp2p_lens';
const VALID_LENS = /^[a-z0-9_.:@-]{2,80}$/i;

export async function GET(request: NextRequest) {
  const lens = request.cookies.get(LENS_COOKIE)?.value || 'exercitodolula';
  return NextResponse.json({ lens });
}

export async function POST(request: NextRequest) {
  const guard = evaluateRequestSecurity({
    ip: requestIp(request),
    path: '/api/idp2p/universe',
    method: 'POST',
    userAgent: request.headers.get('user-agent'),
    acceptLanguage: request.headers.get('accept-language'),
    isAuthenticated: Boolean(request.headers.get('authorization')),
  });
  if (!guard.allowed && guard.action === 'block') {
    return NextResponse.json(
      { error: 'bloqueio-anti-bot' },
      { status: 429, headers: { 'Retry-After': String(guard.retryAfterSec || 30) } }
    );
  }

  const body = (await request.json().catch(() => null)) as { lens?: unknown } | null;
  const rawLens = typeof body?.lens === 'string' ? body.lens.trim() : 'exercitodolula';
  const lens = VALID_LENS.test(rawLens) ? rawLens : 'exercitodolula';

  const res = NextResponse.json({ ok: true, lens });
  res.cookies.set(LENS_COOKIE, lens, {
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}

