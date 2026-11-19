// src/app/api/idp2p/linked-accounts/route.ts
// Gerencia contas unificadas (mesma rede, Fediverso, Bluesky ou provedores privados) vinculadas ao IDP2P do usuário.
import { createHash } from 'crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { evaluateRequestSecurity } from '@/lib/security/antiBotGuard';
import { adminFirestore } from '@/lib/server/firebaseAdmin';
import { requestIp, takeRateLimit, verifyRequestUser } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

const ALLOWED_PROVIDERS = new Set([
  'exercitodolula',
  'mastodon',
  'bluesky',
  'google',
  'github',
  'custom_oidc',
]);

export interface Idp2pLinkedAccount {
  id: string;
  provider: string;
  handle: string;
  label?: string;
  externalUrl?: string;
  trustLevel: 'verified_oauth' | 'declared';
  linkedAt: string;
}

function makeLinkDocId(provider: string, handle: string): string {
  return createHash('sha256').update(`${provider}:${handle.toLowerCase()}`).digest('hex').slice(0, 24);
}

function guardCheck(request: NextRequest, path: string): NextResponse | null {
  const ip = requestIp(request);
  const guard = evaluateRequestSecurity({
    ip,
    path,
    method: request.method,
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
  if (!takeRateLimit(`idp2p-links:${ip}`, 40, 60_000)) {
    return NextResponse.json({ error: 'muitas-requisicoes' }, { status: 429, headers: { 'Retry-After': '30' } });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const blocked = guardCheck(request, '/api/idp2p/linked-accounts');
  if (blocked) return blocked;

  const uid = await verifyRequestUser(request);
  if (!uid) return NextResponse.json({ error: 'nao-autenticado' }, { status: 401 });

  const db = adminFirestore();
  const snap = await db
    .collection('users')
    .doc(uid)
    .collection('idp2p_links')
    .orderBy('linkedAt', 'desc')
    .limit(50)
    .get();

  const links: Idp2pLinkedAccount[] = snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<Idp2pLinkedAccount, 'id'>),
  }));

  return NextResponse.json({
    idp2pId: `did:idp2p:exercitodolula:${uid}`,
    links,
  });
}

export async function POST(request: NextRequest) {
  const blocked = guardCheck(request, '/api/idp2p/linked-accounts');
  if (blocked) return blocked;

  const uid = await verifyRequestUser(request);
  if (!uid) return NextResponse.json({ error: 'nao-autenticado' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'json-invalido' }, { status: 400 });
  }

  const provider = typeof body.provider === 'string' ? body.provider.trim().toLowerCase() : '';
  const handle = typeof body.handle === 'string' ? body.handle.trim() : '';
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 40) : '';
  const rawUrl = typeof body.externalUrl === 'string' ? body.externalUrl.trim() : '';

  if (!ALLOWED_PROVIDERS.has(provider)) {
    return NextResponse.json({ error: 'provedor-invalido' }, { status: 400 });
  }
  if (!handle || handle.length > 120) {
    return NextResponse.json({ error: 'identificador-invalido' }, { status: 400 });
  }

  let externalUrl: string | undefined;
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        externalUrl = parsed.toString();
      }
    } catch {
      return NextResponse.json({ error: 'url-invalida' }, { status: 400 });
    }
  }

  const linkId = makeLinkDocId(provider, handle);
  const record: Omit<Idp2pLinkedAccount, 'id'> = {
    provider,
    handle,
    ...(label ? { label } : {}),
    ...(externalUrl ? { externalUrl } : {}),
    trustLevel: 'declared',
    linkedAt: new Date().toISOString(),
  };

  const db = adminFirestore();
  await db.collection('users').doc(uid).collection('idp2p_links').doc(linkId).set(record, { merge: true });

  return NextResponse.json({
    ok: true,
    link: { id: linkId, ...record },
  });
}

export async function DELETE(request: NextRequest) {
  const blocked = guardCheck(request, '/api/idp2p/linked-accounts');
  if (blocked) return blocked;

  const uid = await verifyRequestUser(request);
  if (!uid) return NextResponse.json({ error: 'nao-autenticado' }, { status: 401 });

  const id = request.nextUrl.searchParams.get('id')?.trim() ?? '';
  if (!id || !/^[a-zA-Z0-9_-]{6,64}$/.test(id)) {
    return NextResponse.json({ error: 'id-invalido' }, { status: 400 });
  }

  const db = adminFirestore();
  await db.collection('users').doc(uid).collection('idp2p_links').doc(id).delete();

  return NextResponse.json({ ok: true });
}

