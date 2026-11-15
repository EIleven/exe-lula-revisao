// src/app/.well-known/host-meta/route.ts
// Alguns servidores antigos descobrem o modelo do WebFinger por aqui antes de consultá-lo. Só com a federação ligada.
import { federation } from '@/lib/server/federation';

export const dynamic = 'force-dynamic';

export async function GET() {
  const f = federation();
  const plataforma = await f.store.getPlatform();
  if (!plataforma.enabled || plataforma.killSwitch) return new Response(null, { status: 404 });
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">' +
    `<Link rel="lrdd" template="${f.origin}/.well-known/webfinger?resource={uri}"/>` +
    '</XRD>\n';
  return new Response(xml, {
    status: 200,
    headers: { 'Content-Type': 'application/xrd+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
