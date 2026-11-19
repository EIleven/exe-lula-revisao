// src/app/api/system/provenance-alert/route.ts
import { FieldValue } from 'firebase-admin/firestore';
import { NextRequest, NextResponse } from 'next/server';
import { adminFirestore } from '@/lib/server/firebaseAdmin';
import { json, readJsonObject, requireCaller } from '@/lib/server/federation';
import { isAuthorizedHost } from '@/lib/system/provenance';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

const COLLECTION = 'systemProvenanceAlerts';
const WINDOW_MS = 10 * 60 * 1000;
const FQDN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const SAFE_TAG_RE = /^[a-z0-9._:-]{1,64}$/i;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sanitizeDocId(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9._-]/g, '_').slice(0, 140) || 'unknown';
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  try {
    const ip = requestIp(request);
    if (
      !takeRateLimit(`provenance:ip:${ip}`, 10, WINDOW_MS) ||
      !takeRateLimit('provenance:global', 50, WINDOW_MS)
    ) {
      return NextResponse.json({ ok: false, error: 'rate-limited' }, { status: 429, headers: CORS_HEADERS });
    }

    const body = await readJsonObject(request);
    if (!body) {
      return NextResponse.json({ ok: false, error: 'invalid-json' }, { status: 400, headers: CORS_HEADERS });
    }

    const hostname = typeof body.hostname === 'string' ? body.hostname.trim().toLowerCase().slice(0, 200) : '';
    const rawOrigin = typeof body.origin === 'string' ? body.origin.trim().slice(0, 240) : '';
    const rawPath = typeof body.pathname === 'string' ? body.pathname.trim().split(/[?#]/)[0].slice(0, 240) : '/';
    const pathname = rawPath.startsWith('/') ? rawPath : '/';
    const rawProvenanceId = typeof body.provenanceId === 'string' ? body.provenanceId.trim() : 'unknown';
    const rawChannel = typeof body.channel === 'string' ? body.channel.trim() : 'unknown';
    const provenanceId = SAFE_TAG_RE.test(rawProvenanceId) ? rawProvenanceId : 'unknown';
    const channel = SAFE_TAG_RE.test(rawChannel) ? rawChannel : 'unknown';
    const buildTag = typeof body.buildTag === 'string' && SAFE_TAG_RE.test(body.buildTag.trim())
      ? body.buildTag.trim()
      : '';
    const referrer = typeof body.referrer === 'string' ? body.referrer.trim().slice(0, 300) : '';

    if (!hostname || isAuthorizedHost(hostname)) {
      return NextResponse.json({ ok: true, ignored: true }, { status: 200, headers: CORS_HEADERS });
    }
    if (!FQDN_RE.test(hostname)) {
      return NextResponse.json({ ok: false, error: 'invalid-hostname' }, { status: 400, headers: CORS_HEADERS });
    }

    let origin = '';
    if (rawOrigin) {
      try {
        const parsedOrigin = new URL(rawOrigin);
        if (
          (parsedOrigin.protocol === 'https:' || parsedOrigin.protocol === 'http:') &&
          parsedOrigin.hostname.toLowerCase() === hostname
        ) {
          origin = parsedOrigin.origin;
        }
      } catch {
        return NextResponse.json({ ok: false, error: 'invalid-origin' }, { status: 400, headers: CORS_HEADERS });
      }
    }

    if (!takeRateLimit(`provenance:host:${hostname}`, 10, WINDOW_MS)) {
      return NextResponse.json({ ok: false, error: 'rate-limited' }, { status: 429, headers: CORS_HEADERS });
    }

    const userAgent = (request.headers.get('user-agent') || '').slice(0, 300);
    const country =
      request.headers.get('x-appengine-country') ||
      request.headers.get('x-vercel-ip-country') ||
      request.headers.get('cf-ipcountry') ||
      '';
    const region =
      request.headers.get('x-appengine-region') ||
      request.headers.get('x-vercel-ip-country-region') ||
      '';
    const city =
      request.headers.get('x-appengine-city') ||
      request.headers.get('x-vercel-ip-city') ||
      '';

    const docId = sanitizeDocId(`${hostname}__${provenanceId}`);
    const db = adminFirestore();
    const ref = db.collection(COLLECTION).doc(docId);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const nowIso = new Date().toISOString();
      if (!snap.exists) {
        tx.set(ref, {
          id: docId,
          hostname,
          origin,
          provenanceId,
          channel,
          buildTag,
          hitCount: 1,
          firstSeenAt: nowIso,
          lastSeenAt: nowIso,
          lastPathname: pathname,
          lastReferrer: referrer,
          lastRequestIp: ip,
          lastUserAgent: userAgent,
          country: country.slice(0, 40),
          region: region.slice(0, 80),
          city: city.slice(0, 80),
          samplePaths: pathname ? [pathname] : [],
        });
      } else {
        const existingPaths: string[] = Array.isArray(snap.data()?.samplePaths)
          ? snap.data()!.samplePaths
          : [];
        const nextPaths =
          pathname && !existingPaths.includes(pathname)
            ? [...existingPaths, pathname].slice(-10)
            : existingPaths;
        tx.update(ref, {
          origin: origin || snap.data()?.origin || '',
          channel,
          buildTag,
          hitCount: FieldValue.increment(1),
          lastSeenAt: nowIso,
          lastPathname: pathname,
          lastReferrer: referrer || snap.data()?.lastReferrer || '',
          lastRequestIp: ip,
          lastUserAgent: userAgent || snap.data()?.lastUserAgent || '',
          country: (country || snap.data()?.country || '').slice(0, 40),
          region: (region || snap.data()?.region || '').slice(0, 80),
          city: (city || snap.data()?.city || '').slice(0, 80),
          samplePaths: nextPaths,
        });
      }
    });

    return NextResponse.json({ ok: true }, { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    console.error('[provenance-alert] POST error:', err);
    return NextResponse.json({ ok: false }, { status: 500, headers: CORS_HEADERS });
  }
}

async function requireAdmin(request: NextRequest, key: string) {
  const caller = await requireCaller(request, key, 60);
  if (caller instanceof Response) return caller;
  const db = adminFirestore();
  const userSnap = await db.collection('users').doc(caller.uid).get();
  if (!userSnap.exists || userSnap.data()?.isAdmin !== true) {
    return json(403, { error: 'apenas-administrador' });
  }
  return { uid: caller.uid, db };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request, 'provenance-get');
  if (auth instanceof Response) return auth;

  const snap = await auth.db
    .collection(COLLECTION)
    .orderBy('lastSeenAt', 'desc')
    .limit(100)
    .get();

  const alerts = snap.docs.map((d) => d.data());
  return json(200, { alerts });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request, 'provenance-delete');
  if (auth instanceof Response) return auth;

  const id = request.nextUrl.searchParams.get('id')?.trim();
  if (!id) {
    return json(400, { error: 'missing-id' });
  }

  await auth.db.collection(COLLECTION).doc(sanitizeDocId(id)).delete();
  return json(200, { ok: true });
}

