// src/app/ap/notes/[id]/route.ts
// O objeto Note de um post JÁ ENTREGUE, com alcance público ou não listado. Só-seguidores responde 404: o protocolo não
// nos dá como provar quem pede. Navegador é mandado para a página do post.
import type { NextRequest } from 'next/server';
import { isValidPostId, postPageUrl, wantsActivityJson } from '@/lib/activitypub/identity';
import { DEFAULT_LOCALE, renderNote } from '@/lib/activitypub/render';
import { apResponse, federation } from '@/lib/server/federation';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!takeRateLimit(`ap-note:${requestIp(request)}`, 240, 60_000)) {
    return new Response(null, { status: 429, headers: { 'Retry-After': '60' } });
  }
  const { id } = await context.params;
  if (!isValidPostId(id)) return new Response(null, { status: 404 });
  const f = federation();
  const r = await renderNote(f.render, id);

  if (r.status === 200 && !wantsActivityJson(request.headers.get('accept'))) {
    return new Response(null, {
      status: 302,
      headers: { Location: postPageUrl(f.origin, DEFAULT_LOCALE, id), Vary: 'Accept' },
    });
  }
  return apResponse(r.status, r.body, { 'Cache-Control': r.status === 200 ? 'public, max-age=60' : 'public, max-age=30' });
}
