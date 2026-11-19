// src/app/api/ap/account/route.ts
// A federação da PRÓPRIA conta: ver o estado e ligar, pausar, retomar ou desligar. Exige o ID token no cabeçalho
// (cookie não serve: ação que muda estado não pode depender de cookie) e e-mail confirmado para ligar.
import {
  disableFederation, enableFederation, getFederationStatus, pauseFederation, resumeFederation,
} from '@/lib/activitypub/account';
import type { AccountFailure } from '@/lib/activitypub/account';
import { configError, federation, json, readJsonObject, requireCaller } from '@/lib/server/federation';

export const dynamic = 'force-dynamic';

const STATUS_DA_FALHA: Record<AccountFailure, number> = {
  'plataforma-desligada': 409,
  'email-nao-confirmado': 403,
  'perfil-inexistente': 404,
  'handle-invalido': 422,
  'handle-indisponivel': 409,
  'conta-removida': 410,
  'nao-ativada': 409,
  'ja-ativada': 409,
};

export async function GET(request: Request) {
  const quem = await requireCaller(request, 'account-get', 60);
  if (quem instanceof Response) return quem;
  const f = federation();
  return json(200, await getFederationStatus({ store: f.store, ownHost: f.ownHost }, quem.uid));
}

export async function POST(request: Request) {
  const quem = await requireCaller(request, 'account-post', 20);
  if (quem instanceof Response) return quem;
  const corpo = await readJsonObject(request);
  if (!corpo) return json(400, { error: 'corpo-invalido' });

  let deps;
  try {
    deps = federation().account();
  } catch {
    return configError();
  }

  let r;
  switch (corpo.action) {
    case 'enable': r = await enableFederation(deps, quem.uid, { emailVerified: quem.emailVerified }); break;
    case 'pause': r = await pauseFederation(deps, quem.uid); break;
    case 'resume': r = await resumeFederation(deps, quem.uid); break;
    case 'disable': r = await disableFederation(deps, quem.uid); break;
    // Vincular contas externas (`alsoKnownAs`) foi DESATIVADO: o vinculo ia para o ator publico, aberto a qualquer um.
    // A resposta e explicita (e nao um generico "acao invalida") para que uma versao antiga da tela diga o que houve.
    case 'set-aliases': return json(410, { error: 'alias-desativado' });
    default: return json(400, { error: 'acao-invalida' });
  }
  if (!r.ok) return json(STATUS_DA_FALHA[r.reason], { error: r.reason });
  const f = federation();
  return json(200, await getFederationStatus({ store: f.store, ownHost: f.ownHost }, quem.uid));
}
