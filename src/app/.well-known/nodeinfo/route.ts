// src/app/.well-known/nodeinfo/route.ts
// Índice do NodeInfo: aponta para o documento versionado. Respondido só com a federação ligada.
import { renderNodeInfoIndex } from '@/lib/activitypub/render';
import { federation } from '@/lib/server/federation';

export const dynamic = 'force-dynamic';

export async function GET() {
  const f = federation();
  const plataforma = await f.store.getPlatform();
  if (!plataforma.enabled || plataforma.killSwitch) return new Response(null, { status: 404 });
  return Response.json(renderNodeInfoIndex(f.origin).body, {
    headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' },
  });
}
