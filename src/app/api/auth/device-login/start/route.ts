// src/app/api/auth/device-login/start/route.ts
import { NextResponse } from 'next/server';
import { startDeviceLoginChallenge } from '@/lib/server/deviceLogin';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const ip = requestIp(request);
  if (!takeRateLimit(`device-login-start:${ip}`, 15, 60_000)) {
    return NextResponse.json(
      { error: 'Muitas tentativas em sequência. Aguarde um instante.' },
      { status: 429 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corpo JSON inválido.' }, { status: 400 });
  }

  const handle = typeof body.handle === 'string' ? body.handle : '';
  const requesterDeviceId =
    typeof body.requesterDeviceId === 'string' ? body.requesterDeviceId : 'web';
  const requesterDeviceLabel =
    typeof body.requesterDeviceLabel === 'string' ? body.requesterDeviceLabel : 'Navegador';

  const result = await startDeviceLoginChallenge({
    handle,
    requesterDeviceId,
    requesterDeviceLabel,
    requesterIp: ip,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    challengeId: result.challengeId,
    secretToken: result.secretToken,
    verificationCode: result.verificationCode,
    expiresAt: result.expiresAt,
    account: result.account,
  });
}

