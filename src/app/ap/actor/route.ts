// src/app/ap/actor/route.ts
// O ator da INSTÂNCIA (tipo Application): a identidade com que o servidor assina as buscas que faz em outros servidores do
// Fediverso. Quem verifica uma assinatura nossa busca esta URL para pegar a chave pública. Não é uma pessoa: ninguém publica
// aqui, e a chave é só da casa (ver src/lib/activitypub/instanceActor.ts).
//
// Com a federação desligada a rota não existe (404), como as demais. Sem a chave-mestra configurada responde 503.
import type { NextRequest } from 'next/server';
import { wantsActivityJson } from '@/lib/activitypub/identity';
import { ensureInstanceKeys, renderInstanceActor } from '@/lib/activitypub/instanceActor';
import { apResponse, federation } from '@/lib/server/federation';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

async function servir(request: NextRequest, comCorpo: boolean) {
  if (!takeRateLimit(`ap-instance-actor:${requestIp(request)}`, 240, 60_000)) {
    return new Response(null, { status: 429, headers: { 'Retry-After': '60' } });
  }
  const f = federation();
  const plataforma = await f.store.getPlatform();
  if (!plataforma.enabled || plataforma.killSwitch) return new Response(null, { status: 404 });

  // Navegador: a página inicial. Só quem pede ActivityPub recebe o JSON.
  if (!wantsActivityJson(request.headers.get('accept'))) {
    return new Response(null, { status: 302, headers: { Location: f.origin, Vary: 'Accept' } });
  }
  let publicKeyPem: string;
  try {
    publicKeyPem = (await ensureInstanceKeys(f.instance())).publicKeyPem;
  } catch {
    return apResponse(503, { error: 'federacao-nao-configurada' });
  }
  const resposta = apResponse(200, renderInstanceActor({ origin: f.origin, ownHost: f.ownHost, publicKeyPem }), { 'Cache-Control': 'public, max-age=300' });
  return comCorpo ? resposta : new Response(null, { status: resposta.status, headers: resposta.headers });
}

export async function GET(request: NextRequest) {
  return servir(request, true);
}

export async function HEAD(request: NextRequest) {
  return servir(request, false);
}
