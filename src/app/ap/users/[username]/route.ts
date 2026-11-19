// src/app/ap/users/[username]/route.ts
// O ator (Person). Quem pede o JSON do ActivityPub recebe o JSON; um NAVEGADOR (que pede text/html) é mandado para o
// perfil de verdade. O ator é uma projeção do perfil: desligar a federação não muda nada no perfil local.
import type { NextRequest } from 'next/server';
import { normalizeHandle, profilePageUrl, wantsActivityJson } from '@/lib/activitypub/identity';
import { DEFAULT_LOCALE, renderActor } from '@/lib/activitypub/render';
import { apResponse, federation, legacyFederationOrigin } from '@/lib/server/federation';
import { siteConfig } from '@/config/site';
import { actorUrl } from '@/lib/activitypub/identity';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

async function servir(request: NextRequest, context: { params: Promise<{ username: string }> }, comCorpo: boolean) {
  if (!takeRateLimit(`ap-actor:${requestIp(request)}`, 240, 60_000)) {
    return new Response(null, { status: 429, headers: { 'Retry-After': '60' } });
  }
  const f = federation();
  const handle = normalizeHandle((await context.params).username);
  if (!handle) return new Response(null, { status: 404 });

  // Navegador: manda para o perfil (só se a conta federa; senão 404, para não revelar conta desligada).
  if (!wantsActivityJson(request.headers.get('accept'))) {
    const reserva = await f.store.getHandle(handle);
    const conta = reserva ? await f.store.getAccount(reserva.uid) : null;
    if (!reserva || reserva.state !== 'active' || !conta?.enabled) return new Response(null, { status: 404 });
    return new Response(null, {
      status: 302,
      headers: { Location: profilePageUrl(f.origin, DEFAULT_LOCALE, reserva.uid), Vary: 'Accept' },
    });
  }

  // Pedido pelo domínio ANTIGO: o ator sai com o id daquele domínio e com `movedTo` para o canônico. Pelo canônico,
  // sai com o auto-alias da migração, que é a prova que o Mastodon exige para aceitar o `Move`.
  const antigo = legacyFederationOrigin(request);
  const alias = antigo || !siteConfig.migrationAliasEnabled
    ? []
    : Array.from(new Set(siteConfig.legacyFederationHosts.map((h) => actorUrl(`https://${h.replace(/^www\./, '')}`, handle))));
  const r = await renderActor(f.render, handle, { legacyOrigin: antigo, alsoKnownAs: alias });
  // 410 + Tombstone não deve ficar em cache por muito tempo: a conta pode ser reativada pelo mesmo dono.
  const cache = r.status === 200 ? 'public, max-age=300' : 'public, max-age=60';
  const resposta = apResponse(r.status, r.body, { 'Cache-Control': cache });
  return comCorpo ? resposta : new Response(null, { status: resposta.status, headers: resposta.headers });
}

export async function GET(request: NextRequest, context: { params: Promise<{ username: string }> }) {
  return servir(request, context, true);
}

export async function HEAD(request: NextRequest, context: { params: Promise<{ username: string }> }) {
  return servir(request, context, false);
}
