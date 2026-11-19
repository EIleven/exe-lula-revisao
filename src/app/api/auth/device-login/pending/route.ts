// src/app/api/auth/device-login/pending/route.ts
import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/server/firebaseAdmin';
import { listPendingDeviceLoginChallenges } from '@/lib/server/deviceLogin';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
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

  const requests = await listPendingDeviceLoginChallenges(uid);
  return NextResponse.json({ requests }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}

