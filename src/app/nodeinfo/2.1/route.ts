// src/app/nodeinfo/2.1/route.ts
// NodeInfo 2.1. As contagens são só da federação (contas que optaram e objetos públicos entregues).
import { renderNodeInfo } from '@/lib/activitypub/render';
import { federation } from '@/lib/server/federation';

export const dynamic = 'force-dynamic';

export async function GET() {
  const r = await renderNodeInfo(federation().render);
  if (r.status !== 200) return new Response(null, { status: r.status });
  return new Response(JSON.stringify(r.body), {
    status: 200,
    headers: { ...r.headers, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=1800' },
  });
}
