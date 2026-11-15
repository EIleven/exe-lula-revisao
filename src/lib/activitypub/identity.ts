// src/lib/activitypub/identity.ts
// Identidade federada: handles, URLs canônicas e o formato do WebFinger. Módulo puro, sem imports.
//
// O handle federado é `usuario@exercitodolula.app`, com `usuario` = o @ da pessoa em minúsculas. Duas decisões que
// o resto do sistema assume:
//
// 1. **O handle federado é imutável depois de criado.** A URL do actor (`/ap/users/<handle>`) é a identidade da
//    pessoa para os outros servidores: mudá-la faz o Fediverso enxergar OUTRA pessoa. Se ela trocar o @ aqui
//    dentro, o handle federado continua o que era (e fica reservado em `ap_handles`).
// 2. **Ids de objeto nunca contêm dado pessoal.** Post vira `/ap/notes/<postId>`, atividade vira um id opaco.

/** Handle local: o mesmo padrão do cadastro (`[a-zA-Z0-9_]{3,15}`), em minúsculas. */
const HANDLE_LOCAL = /^[a-z0-9_]{3,15}$/;
/** Id de post do Firestore (20 caracteres alfanuméricos) e variações que a rede já aceita em outras rotas. */
const POST_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** Id opaco de atividade: o que nós mesmos geramos. */
const ACTIVITY_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Nome de host aceitável para um servidor REMOTO. Exige ao menos um ponto e um TLD alfabético, e recusa IP literal,
 * `localhost` e sufixos que nunca são Internet pública — federar com `192.168.0.5` é só uma porta para SSRF.
 * (A guarda de conexão do safe-fetch é a defesa de verdade; isto só evita nem tentar.)
 */
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const SUFIXOS_INTERNOS = ['.local', '.localhost', '.internal', '.lan', '.home', '.corp', '.intranet', '.onion', '.invalid', '.test', '.example'];

export function normalizeHostname(bruto: string | null | undefined): string | null {
  if (typeof bruto !== 'string') return null;
  const host = bruto.trim().toLowerCase().replace(/\.$/, '');
  // O último rótulo precisa COMEÇAR por letra: é o que recusa IP literal (127.0.0.1, 10.0.0.5) sem um teste à parte.
  if (!HOSTNAME.test(host)) return null;
  if (SUFIXOS_INTERNOS.some((s) => host.endsWith(s))) return null;
  return host;
}

/** `Ana_Silva` → `ana_silva`; devolve `null` se não couber no padrão de handle. */
export function normalizeHandle(bruto: string | null | undefined): string | null {
  if (typeof bruto !== 'string') return null;
  const limpo = bruto.trim().replace(/^@/, '').toLowerCase();
  return HANDLE_LOCAL.test(limpo) ? limpo : null;
}

export function isValidPostId(id: string | null | undefined): id is string {
  return typeof id === 'string' && POST_ID.test(id);
}

export function isValidActivityId(id: string | null | undefined): id is string {
  return typeof id === 'string' && ACTIVITY_ID.test(id);
}

// ───────────────────────── acct: ─────────────────────────

export type Acct = { user: string; host: string };

/**
 * Lê `acct:ana@host`, `@ana@host` ou `ana@host`. O usuário remoto pode ter pontos e hífens (outros servidores
 * permitem); o host passa por `normalizeHostname`. Devolve `null` para qualquer outra coisa, inclusive porta.
 */
export function parseAcct(bruto: string | null | undefined): Acct | null {
  if (typeof bruto !== 'string' || bruto.length > 320) return null;
  const limpo = bruto.trim().replace(/^acct:/i, '').replace(/^@/, '');
  const partes = limpo.split('@');
  if (partes.length !== 2) return null;
  const [user, hostBruto] = partes;
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(user)) return null;
  const host = normalizeHostname(hostBruto);
  return host ? { user, host } : null;
}

export function buildAcct(handle: string, host: string): string {
  return `${handle}@${host}`;
}

// ───────────────────────── URLs canônicas ─────────────────────────

/** `origin` sempre sem barra final: `https://exercitodolula.app`. */
const semBarra = (origin: string) => origin.replace(/\/+$/, '');

export const actorUrl = (origin: string, handle: string) => `${semBarra(origin)}/ap/users/${handle}`;
export const keyIdUrl = (origin: string, handle: string) => `${actorUrl(origin, handle)}#main-key`;
export const inboxUrl = (origin: string, handle: string) => `${actorUrl(origin, handle)}/inbox`;
export const outboxUrl = (origin: string, handle: string) => `${actorUrl(origin, handle)}/outbox`;
export const followersUrl = (origin: string, handle: string) => `${actorUrl(origin, handle)}/followers`;
export const followingUrl = (origin: string, handle: string) => `${actorUrl(origin, handle)}/following`;
export const sharedInboxUrl = (origin: string) => `${semBarra(origin)}/ap/inbox`;
/** O ator da INSTÂNCIA (tipo Application): assina as buscas que o servidor faz sem ser em nome de uma pessoa. */
export const instanceActorUrl = (origin: string) => `${semBarra(origin)}/ap/actor`;
export const instanceKeyIdUrl = (origin: string) => `${instanceActorUrl(origin)}#main-key`;
export const noteUrl = (origin: string, postId: string) => `${semBarra(origin)}/ap/notes/${postId}`;
export const activityUrl = (origin: string, handle: string, id: string) =>
  `${actorUrl(origin, handle)}/activities/${id}`;
/** Página HTML do post, a que uma pessoa abre no navegador. */
export const postPageUrl = (origin: string, locale: string, postId: string) =>
  `${semBarra(origin)}/${locale}/post/${postId}`;
export const profilePageUrl = (origin: string, locale: string, userId: string) =>
  `${semBarra(origin)}/${locale}/profile/${userId}`;
export const hashtagPageUrl = (origin: string, locale: string, tag: string) =>
  `${semBarra(origin)}/${locale}/tag/${encodeURIComponent(tag)}`;

/** Mesma origem que a nossa? Compara protocolo, host e porta; nunca por prefixo de texto. */
export function isOwnUrl(url: string | null | undefined, origin: string): boolean {
  if (typeof url !== 'string') return false;
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/** Domínio (host) de uma URL https, ou `null`. Remoto: sempre passa por `normalizeHostname`. */
export function domainOfUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || url.length > 2048) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return normalizeHostname(u.hostname);
  } catch {
    return null;
  }
}

export type LocalRoute =
  | { kind: 'actor'; handle: string }
  | { kind: 'inbox'; handle: string }
  | { kind: 'outbox'; handle: string }
  | { kind: 'followers'; handle: string }
  | { kind: 'following'; handle: string }
  | { kind: 'sharedInbox' }
  | { kind: 'note'; postId: string };

/** Reconhece um caminho nosso: `/ap/users/ana/inbox` → `{ kind: 'inbox', handle: 'ana' }`. */
export function parseLocalPath(pathname: string): LocalRoute | null {
  const usuario = /^\/ap\/users\/([A-Za-z0-9_]{3,15})(?:\/(inbox|outbox|followers|following))?\/?$/.exec(pathname);
  if (usuario) {
    const handle = normalizeHandle(usuario[1]);
    if (!handle) return null;
    return { kind: (usuario[2] ?? 'actor') as 'actor' | 'inbox' | 'outbox' | 'followers' | 'following', handle };
  }
  if (/^\/ap\/inbox\/?$/.test(pathname)) return { kind: 'sharedInbox' };
  const nota = /^\/ap\/notes\/([A-Za-z0-9_-]{1,128})\/?$/.exec(pathname);
  return nota ? { kind: 'note', postId: nota[1] } : null;
}

// ───────────────────────── WebFinger ─────────────────────────

/**
 * O `resource` de uma consulta WebFinger para ESTA instância: `acct:ana@exercitodolula.app` ou a URL do actor.
 * Devolve o handle, ou `null` se for de outro host ou não for nosso formato.
 *
 * Recusar host diferente é deliberado: responder por `ana@outro.com` faria da nossa rota um oráculo de existência
 * de contas de terceiros e um vetor de personificação.
 */
export function parseWebfingerResource(resource: string | null | undefined, host: string, origin: string): string | null {
  if (typeof resource !== 'string' || resource.length > 320) return null;
  const acct = parseAcct(resource);
  if (acct && /^acct:/i.test(resource.trim())) {
    return acct.host === host.toLowerCase() ? normalizeHandle(acct.user) : null;
  }
  if (isOwnUrl(resource, origin)) {
    const rota = parseLocalPath(new URL(resource).pathname);
    return rota && 'handle' in rota && rota.kind === 'actor' ? rota.handle : null;
  }
  return null;
}

/**
 * A consulta WebFinger é pelo ator da INSTÂNCIA? `acct:<domínio>@<domínio>` (o `preferredUsername` do ator é o domínio, e é assim
 * que o Mastodon confirma um ator antes de aceitar uma assinatura dele) ou a URL do ator (`/ap/actor`). Sem esta resposta, um
 * servidor em modo de busca autorizada recusa a nossa chave e as buscas assinadas nunca valem.
 */
export function isInstanceWebfingerResource(resource: string | null | undefined, host: string, origin: string): boolean {
  if (typeof resource !== 'string' || resource.length > 320) return false;
  const bruto = resource.trim();
  if (/^acct:/i.test(bruto)) {
    const acct = parseAcct(bruto);
    const dominio = host.toLowerCase();
    return acct !== null && acct.host === dominio && acct.user.toLowerCase() === dominio;
  }
  if (!isOwnUrl(bruto, origin)) return false;
  try {
    return new URL(bruto).pathname.replace(/\/+$/, '') === '/ap/actor';
  } catch {
    return false;
  }
}

/** Documento JRD do WebFinger do ator da instância (o `self` aponta para `/ap/actor`, que é o `id` do ator). */
export function buildInstanceWebfinger({ host, origin }: { host: string; origin: string }) {
  const ator = instanceActorUrl(origin);
  return {
    subject: `acct:${buildAcct(host, host)}`,
    aliases: [ator],
    links: [
      { rel: 'self', type: 'application/activity+json', href: ator },
      { rel: 'http://webfinger.net/rel/profile-page', type: 'text/html', href: semBarra(origin) },
    ],
  };
}

export type WebfingerInput = { handle: string; host: string; origin: string; locale: string; userId: string };

/** Documento JRD do WebFinger. */
export function buildWebfinger({ handle, host, origin, locale, userId }: WebfingerInput) {
  const ator = actorUrl(origin, handle);
  const perfil = profilePageUrl(origin, locale, userId);
  return {
    subject: `acct:${buildAcct(handle, host)}`,
    aliases: [ator, perfil],
    links: [
      { rel: 'self', type: 'application/activity+json', href: ator },
      { rel: 'http://webfinger.net/rel/profile-page', type: 'text/html', href: perfil },
    ],
  };
}

/** Tipos de mídia do ActivityPub que aceitamos servir e receber. */
export const ACTIVITY_CONTENT_TYPES = [
  'application/activity+json',
  'application/ld+json',
  'application/json',
] as const;

/**
 * O pedido quer a representação ActivityPub? Decide entre o JSON do actor e a página HTML. Quem pede `text/html`
 * (navegador) é mandado para o perfil; só `Accept` com um tipo de ActivityPub recebe o JSON.
 */
export function wantsActivityJson(accept: string | null | undefined): boolean {
  if (typeof accept !== 'string') return false;
  return /application\/(activity\+json|ld\+json)/i.test(accept);
}
