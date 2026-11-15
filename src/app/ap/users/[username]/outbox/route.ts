// src/app/ap/users/[username]/outbox/route.ts
// O que a pessoa publicou com alcance PÚBLICO. Não lista não listados nem só-seguidores.
import type { NextRequest } from 'next/server';
import { normalizeHandle } from '@/lib/activitypub/identity';
import { renderOutbox } from '@/lib/activitypub/render';
import { apResponse, federation } from '@/lib/server/federation';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ username: string }> }) {
  if (!takeRateLimit(`ap-outbox:${requestIp(request)}`, 120, 60_000)) {
    return new Response(null, { status: 429, headers: { 'Retry-After': '60' } });
  }
  const handle = normalizeHandle((await context.params).username);
  if (!handle) return new Response(null, { status: 404 });

  const params = request.nextUrl.searchParams;
  let pagina: { before: number | null } | null = null;
  if (params.get('page') === 'true') {
    const antes = params.get('before');
    // `before` só aceita um inteiro: nada de texto livre indo para a consulta.
    const valor = antes === null ? null : /^\d{1,16}$/.test(antes) ? Number(antes) : Number.NaN;
    if (valor !== null && Number.isNaN(valor)) return new Response(null, { status: 400 });
    pagina = { before: valor };
  }
  const r = await renderOutbox(federation().render, handle, pagina);
  return apResponse(r.status, r.body, { 'Cache-Control': 'public, max-age=60' });
}
