// src/app/api/media/theater-feed/route.ts
// Feed paginado de vídeos e imagens (incluindo posts do Fediverso) com recomendação unificada entre redes e prioridade pt-BR.
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { evaluateRequestSecurity } from '@/lib/security/antiBotGuard';
import { identify } from '@/lib/server/federation';
import { adminFirestore } from '@/lib/server/firebaseAdmin';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

const PT_HINTS = /\b(não|nao|você|voce|para|com|que|uma|por|mais|como|aqui|brasil|lula|gente|agora|hoje|tudo|isso)\b|[ãõçáéíóúâêô]/i;

interface RawMedia {
  type?: string;
  url?: string;
  width?: number;
  height?: number;
}

interface RawPostDoc {
  id: string;
  userId?: string;
  visibility?: string;
  isDeleted?: boolean;
  sensitive?: boolean;
  hasMedia?: boolean;
  media?: RawMedia[];
  text?: string | null;
  lang?: string;
  createdAt?: unknown;
  isRemote?: boolean;
  federatedOrigin?: string;
  authorDetails?: {
    username?: string;
    name?: string;
  };
  [key: string]: unknown;
}

function toIsoDate(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return new Date(0).toISOString();
}

export async function GET(request: NextRequest) {
  const ip = requestIp(request);
  const guard = evaluateRequestSecurity({
    ip,
    path: '/api/media/theater-feed',
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
  if (!takeRateLimit(`theater-feed:${ip}`, 40, 60_000)) {
    return NextResponse.json({ error: 'muitas-requisicoes' }, { status: 429, headers: { 'Retry-After': '15' } });
  }

  const locale = request.nextUrl.searchParams.get('locale') || 'pt-BR';
  const cursor = request.nextUrl.searchParams.get('cursor');
  const excludeRaw = request.nextUrl.searchParams.get('exclude') || '';
  const excludeIds = new Set(excludeRaw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200));

  const caller = await identify(request).catch(() => null);
  const db = adminFirestore();

  const followedIds = new Set<string>();
  if (caller?.uid) {
    const [localFollowing, apFollowing] = await Promise.all([
      db.collection('users').doc(caller.uid).collection('following').limit(200).get().catch(() => null),
      db.collection('ap_following').doc(caller.uid).collection('actors').limit(200).get().catch(() => null),
    ]);
    localFollowing?.docs.forEach((d) => followedIds.add(d.id));
    apFollowing?.docs.forEach((d) => {
      const data = d.data() as { remoteUserId?: string };
      if (typeof data.remoteUserId === 'string') followedIds.add(data.remoteUserId);
    });
  }

  let q = db
    .collection('posts')
    .where('visibility', '==', 'public')
    .where('hasMedia', '==', true)
    .orderBy('createdAt', 'desc')
    .limit(60);

  if (cursor) {
    const cursorSnap = await db.collection('posts').doc(cursor).get().catch(() => null);
    if (cursorSnap?.exists) {
      q = q.startAfter(cursorSnap);
    } else {
      const parsed = new Date(cursor);
      if (!Number.isNaN(parsed.getTime())) {
        q = q.startAfter(parsed);
      }
    }
  }

  const snap = await q.get();
  const candidates: Array<{ post: RawPostDoc; createdIso: string; docId: string }> = [];

  for (const doc of snap.docs) {
    if (excludeIds.has(doc.id)) continue;
    const data = doc.data() as Omit<RawPostDoc, 'id'>;
    if (data.isDeleted === true || data.sensitive === true) continue;
    const media = Array.isArray(data.media)
      ? data.media.filter((m) => m && (m.type === 'video' || m.type === 'image') && typeof m.url === 'string' && m.url.length > 0)
      : [];
    if (media.length === 0) continue;

    const createdIso = toIsoDate(data.createdAt);
    candidates.push({
      docId: doc.id,
      createdIso,
      post: {
        ...data,
        id: doc.id,
        createdAt: createdIso,
      },
    });
    if (candidates.length >= 20) break;
  }

  // Ordem cronológica estrita (mais recente -> mais antigo) para rolagem infinita contínua
  candidates.sort((a, b) => b.createdIso.localeCompare(a.createdIso));
  const selected = candidates.map((c) => c.post);
  const lastCandidate = candidates[candidates.length - 1];
  const lastSnapDoc = snap.docs[snap.docs.length - 1];
  const hasMoreDocs = snap.docs.length >= 60 || candidates.length >= 20;
  const cursorId = hasMoreDocs ? (lastCandidate?.docId ?? lastSnapDoc?.id ?? null) : null;

  return NextResponse.json({ posts: selected, nextCursor: cursorId });
}
