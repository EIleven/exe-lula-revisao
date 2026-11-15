// src/app/ap/users/[username]/following/route.ts
// Na v1 ninguém daqui segue contas do Fediverso: a coleção existe (o protocolo a espera) e vale zero.
import type { NextRequest } from 'next/server';
import { normalizeHandle } from '@/lib/activitypub/identity';
import { renderCountCollection } from '@/lib/activitypub/render';
import { apResponse, federation } from '@/lib/server/federation';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ username: string }> }) {
  if (!takeRateLimit(`ap-col:${requestIp(request)}`, 120, 60_000)) {
    return new Response(null, { status: 429, headers: { 'Retry-After': '60' } });
  }
  const handle = normalizeHandle((await context.params).username);
  if (!handle) return new Response(null, { status: 404 });
  const r = await renderCountCollection(federation().render, handle, 'following');
  return apResponse(r.status, r.body, { 'Cache-Control': 'public, max-age=120' });
}
