// src/app/api/ap/account/route.ts
// A federação da PRÓPRIA conta: ver o estado e ligar, pausar, retomar ou desligar. Exige o ID token no cabeçalho
// (cookie não serve: ação que muda estado não pode depender de cookie) e e-mail confirmado para ligar.
import {
  disableFederation, enableFederation, getFederationStatus, pauseFederation, resumeFederation, setAlsoKnownAs,
} from '@/lib/activitypub/account';
import type { AccountFailure } from '@/lib/activitypub/account';
import { safeFetchText } from '@/lib/security/safe-fetch';
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
  'alias-invalido': 422,
  'muitos-aliases': 422,
};

async function resolveAliasToActorUri(raw: string): Promise<string | null> {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('https://')) return trimmed;

  const cleanAcct = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  const atIdx = cleanAcct.indexOf('@');
  if (atIdx <= 0 || atIdx === cleanAcct.length - 1) return null;
  const user = cleanAcct.slice(0, atIdx);
  const domain = cleanAcct.slice(atIdx + 1).toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return null;

  const wfUrl = `https://${domain}/.well-known/webfinger?resource=${encodeURIComponent(`acct:${user}@${domain}`)}`;
  const res = await safeFetchText(wfUrl, {
    timeoutMs: 6000,
    maxBytes: 64_000,
    headers: { Accept: 'application/jrd+json, application/json' },
    allowedContentTypes: /^application\/(jrd\+json|json)/i,
  });
  if (!res.ok) return null;
  try {
    const parsed = JSON.parse(res.text) as { links?: { rel?: string; type?: string; href?: string }[] };
    const selfLink = parsed.links?.find(
      (l) => l.rel === 'self' && typeof l.href === 'string' && l.href.startsWith('https://')
        && (!l.type || /activity\+json|ld\+json/i.test(l.type)),
    );
    return selfLink?.href ?? null;
  } catch {
    return null;
  }
}

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
    case 'set-aliases': {
      if (!Array.isArray(corpo.aliases) || corpo.aliases.length > 5) {
        return json(422, { error: 'alias-invalido' });
      }
      const resolved: string[] = [];
      for (const item of corpo.aliases) {
        if (typeof item !== 'string') return json(422, { error: 'alias-invalido' });
        const uri = await resolveAliasToActorUri(item);
        if (!uri) return json(422, { error: 'alias-nao-encontrado' });
        resolved.push(uri);
      }
      r = await setAlsoKnownAs(deps, quem.uid, resolved);
      break;
    }
    default: return json(400, { error: 'acao-invalida' });
  }
  if (!r.ok) return json(STATUS_DA_FALHA[r.reason], { error: r.reason });
  const f = federation();
  return json(200, await getFederationStatus({ store: f.store, ownHost: f.ownHost }, quem.uid));
}
