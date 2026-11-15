// src/app/.well-known/webfinger/route.ts
// WebFinger (RFC 7033): `acct:usuario@exercitodolula.app` → o ator. É a porta de entrada da descoberta no Fediverso.
// Só responde por contas ATIVAS de ESTE host: contas desligadas, removidas ou de outro servidor dão 404, sem revelar
// se existiram. Além das pessoas, responde pelo ator da INSTÂNCIA (`acct:exercitodolula.app@exercitodolula.app` → `/ap/actor`):
// é por ali que um servidor em modo de busca autorizada confirma a chave com que assinamos as nossas buscas.
import type { NextRequest } from 'next/server';
import { isInstanceWebfingerResource, parseWebfingerResource } from '@/lib/activitypub/identity';
import { renderInstanceWebfinger, renderWebfinger } from '@/lib/activitypub/render';
import { federation } from '@/lib/server/federation';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

const CORS = { 'Access-Control-Allow-Origin': '*' };

export async function GET(request: NextRequest) {
  if (!takeRateLimit(`ap-wf:${requestIp(request)}`, 120, 60_000)) {
    return new Response(null, { status: 429, headers: { ...CORS, 'Retry-After': '60' } });
  }
  const f = federation();
  const resource = request.nextUrl.searchParams.get('resource');
  if (!resource) return new Response(null, { status: 400, headers: CORS });

  let r;
  if (isInstanceWebfingerResource(resource, f.ownHost, f.origin)) {
    r = await renderInstanceWebfinger(f.render);
  } else {
    const handle = parseWebfingerResource(resource, f.ownHost, f.origin);
    if (!handle) return new Response(null, { status: 404, headers: CORS });
    r = await renderWebfinger(f.render, handle);
  }
  if (r.status !== 200) return new Response(null, { status: r.status, headers: CORS });
  return new Response(JSON.stringify(r.body), {
    status: 200,
    headers: { ...CORS, ...r.headers, 'Cache-Control': 'public, max-age=300' },
  });
}
