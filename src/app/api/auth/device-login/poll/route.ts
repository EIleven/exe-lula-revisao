// src/app/api/auth/device-login/poll/route.ts
import { NextResponse } from 'next/server';
import { pollDeviceLoginChallenge } from '@/lib/server/deviceLogin';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

// A resposta pode levar a credencial de login: nunca em cache de navegador, proxy ou CDN.
const SEM_CACHE = { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' };

export async function POST(request: Request) {
  const ip = requestIp(request);
  if (!takeRateLimit(`device-login-poll:${ip}`, 90, 60_000)) {
    return NextResponse.json({ error: 'Muitas consultas.' }, { status: 429, headers: SEM_CACHE });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corpo JSON inválido.' }, { status: 400, headers: SEM_CACHE });
  }

  const challengeId = typeof body.challengeId === 'string' ? body.challengeId : '';
  const secretToken = typeof body.secretToken === 'string' ? body.secretToken : '';

  try {
    const result = await pollDeviceLoginChallenge({ challengeId, secretToken });
    return NextResponse.json(result, { headers: SEM_CACHE });
  } catch (err) {
    // Falha do SERVIDOR (banco fora do ar...): a tela continua consultando; nada de 500 sem corpo que ela não saiba ler.
    console.error('[device-login/poll] falha inesperada:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ status: 'pending', error: 'temporarily_unavailable' }, { status: 503, headers: SEM_CACHE });
  }
}
