// src/app/api/auth/device-login/respond/route.ts
import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/server/firebaseAdmin';
import { respondDeviceLoginChallenge } from '@/lib/server/deviceLogin';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const ip = requestIp(request);
  if (!takeRateLimit(`device-login-respond:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Muitas tentativas.' }, { status: 429 });
  }

  const authHeader = request.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return NextResponse.json({ error: 'Autenticação necessária.' }, { status: 401 });
  }

  let uid = '';
  try {
    const decoded = await adminAuth().verifyIdToken(match[1]);
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ error: 'Sessão inválida ou expirada.' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corpo JSON inválido.' }, { status: 400 });
  }

  const challengeId = typeof body.challengeId === 'string' ? body.challengeId : '';
  const action = body.action === 'approve' ? 'approve' : body.action === 'reject' ? 'reject' : null;
  const approverDeviceId =
    typeof body.approverDeviceId === 'string' ? body.approverDeviceId : 'web';
  const approverDeviceLabel =
    typeof body.approverDeviceLabel === 'string' ? body.approverDeviceLabel : 'Dispositivo Conectado';

  if (!challengeId || !action) {
    return NextResponse.json({ error: 'Parâmetros inválidos.' }, { status: 400 });
  }

  const result = await respondDeviceLoginChallenge({
    challengeId,
    uid,
    action,
    // O código que a pessoa DIGITOU (lido da tela do aparelho novo). Sem ele não se aprova: ver deviceLoginCore.ts.
    verificationCode: body.verificationCode,
    approverDeviceId,
    approverDeviceLabel,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, status: result.status });
}

