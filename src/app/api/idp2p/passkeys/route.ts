// src/app/api/idp2p/passkeys/route.ts
// Registra e lista aparelhos com Passkey/Biometria ativa para dar visibilidade real entre dispositivos do mesmo usuário.
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { evaluateRequestSecurity } from '@/lib/security/antiBotGuard';
import { adminFirestore } from '@/lib/server/firebaseAdmin';
import { requestIp, takeRateLimit, verifyRequestUser } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

export interface PasskeyDeviceRecord {
  deviceId: string;
  deviceLabel: string;
  credentialId: string;
  updatedAt: string;
}

export async function GET(request: NextRequest) {
  const uid = await verifyRequestUser(request);
  if (!uid) return NextResponse.json({ error: 'nao-autenticado' }, { status: 401 });

  const db = adminFirestore();
  const snap = await db.collection('users').doc(uid).collection('idp2p_passkeys').limit(20).get();
  const passkeys: PasskeyDeviceRecord[] = snap.docs.map((d) => d.data() as PasskeyDeviceRecord);
  return NextResponse.json({ passkeys });
}

export async function POST(request: NextRequest) {
  const ip = requestIp(request);
  const guard = evaluateRequestSecurity({
    ip,
    path: '/api/idp2p/passkeys',
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
  if (!takeRateLimit(`idp2p-passkeys:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: 'muitas-requisicoes' }, { status: 429 });
  }

  const uid = await verifyRequestUser(request);
  if (!uid) return NextResponse.json({ error: 'nao-autenticado' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim().slice(0, 80) : '';
  const deviceLabel = typeof body?.deviceLabel === 'string' ? body.deviceLabel.trim().slice(0, 80) : 'Aparelho';
  const credentialId = typeof body?.credentialId === 'string' ? body.credentialId.trim().slice(0, 256) : '';
  if (!deviceId || !credentialId) {
    return NextResponse.json({ error: 'dados-invalidos' }, { status: 400 });
  }

  const record: PasskeyDeviceRecord = {
    deviceId,
    deviceLabel,
    credentialId,
    updatedAt: new Date().toISOString(),
  };

  const db = adminFirestore();
  await db.collection('users').doc(uid).collection('idp2p_passkeys').doc(deviceId).set(record, { merge: true });

  return NextResponse.json({ ok: true, record });
}

