// src/lib/activitypub/remoteIdentity.ts
// Identidade das contas e dos objetos do Fediverso DENTRO do app. Uma só fonte para três perguntas que o código antes
// respondia em quinze lugares, cada um do seu jeito:
//
//   1. Qual é o id local de um ator/post/comentário remoto?          → remoteUserIdOf / remotePostIdOf / remoteFollowDocIdOf
//   2. Esta URL é NOSSA (um ator ou um post daqui)?                   → ownActorHandle / ownPostRef / isOwnHostUrl
//   3. O documento que um servidor remoto devolveu como "ator" é de
//      quem dissemos que era?                                         → validateFetchedActor
//
// A regra que este módulo existe para garantir: **uma conta ou post do NOSSO domínio nunca vira `ap_...`.** O @Breno e
// o @Breno@exercitodolula.app são a mesma pessoa, com o mesmo UID. Antes, uma resposta ou um repost vindo do Fediverso
// criava, ao sincronizar o perfil de quem repostou, um "Breno" fantasma e cópias dos posts dele.
//
// NÚCLEO DE SERVIÇO: só importa `node:*` e vizinhos (com extensão .ts), nunca Firebase nem Next (o armazenamento e a
// rede entram por parâmetro). É o que o deixa testável sem emuladores.
import { createHash } from 'node:crypto';
import { domainOfUrl, isOwnUrl, normalizeHandle, normalizeHostname, parseLocalPath } from './identity.ts';

const sha = (texto: string) => createHash('sha256').update(texto).digest('hex');

// ───────────────────────── ids locais de conteúdo remoto ─────────────────────────

export const REMOTE_ID_PREFIX = 'ap_';

/** O id é de um usuário, post ou comentário materializado do Fediverso? */
export const isRemoteId = (id: unknown): boolean => typeof id === 'string' && id.startsWith(REMOTE_ID_PREFIX);

/**
 * `users/ap_<24 hex>` a partir da URL do ator. **Não normaliza a URL**: os ids já gravados em produção foram calculados
 * sobre o texto exato, e mudar isto separaria cada pessoa remota de todo o histórico dela.
 */
export const remoteUserIdOf = (actorId: string): string => `${REMOTE_ID_PREFIX}${sha(actorId).slice(0, 24)}`;

/** Os 24 hex do objeto, SEM prefixo: é o id do mapa `ap_remote_comments/{chave}` que liga um comentário remoto ao documento. */
export const remoteObjectKeyOf = (objectId: string): string => sha(objectId).slice(0, 24);

/** `posts/ap_<24 hex>` (e `comments/ap_<24 hex>`) a partir do id ActivityPub do objeto. */
export const remotePostIdOf = (objectId: string): string => `${REMOTE_ID_PREFIX}${remoteObjectKeyOf(objectId)}`;

/** Id do documento em `ap_following/{uid}/actors/{id}`: 32 hex, e não 24, por herança do primeiro desenho. */
export const remoteFollowDocIdOf = (actorId: string): string => sha(actorId).slice(0, 32);

/** Chave de coleções auxiliares (`ap_followers`, `ap_remote_actors`, `ap_remote_comments`): o hash inteiro. */
export const remoteHashOf = (texto: string): string => sha(texto);

/**
 * Qual id de objeto usar para um item que o servidor remoto descreve com duas URLs: `uri` (o id ActivityPub, o mesmo que
 * o inbox recebe) e `url` (a página para humanos). O id do post tem de sair do `uri`: antes saía da `url` no sincronismo
 * de perfil e do `uri` no inbox, e o MESMO post ganhava dois ids e aparecia duas vezes.
 */
export function canonicalObjectId(candidatos: { uri?: unknown; url?: unknown }): string | null {
  for (const c of [candidatos.uri, candidatos.url]) {
    if (typeof c === 'string' && c.startsWith('https://') && c.length <= 2048) return c;
  }
  return null;
}

// ───────────────────────── o que é NOSSO ─────────────────────────

/** A URL é do NOSSO host? Compara só o host (porta e esquema não mudam de quem é o domínio). */
export function isOwnHostUrl(url: string | null | undefined, ownHost: string): boolean {
  const host = domainOfUrl(url);
  return host !== null && host === ownHost.trim().toLowerCase();
}

/** Handle local (minúsculo) de uma URL de ator do nosso domínio (`/ap/users/<handle>`), ou `null`. */
export function ownActorHandle(url: string | null | undefined, origin: string): string | null {
  if (!url || !isOwnUrl(url, origin)) return null;
  const rota = parseLocalPath(new URL(url).pathname);
  return rota && rota.kind === 'actor' ? rota.handle : null;
}

export type OwnPostRef = { postId: string; commentId: string | null };

const NOTA_PROPRIA = /^\/ap\/notes\/([A-Za-z0-9_-]{1,128})\/?$/;
const COMENTARIO_PROPRIO = /^\/ap\/notes\/([A-Za-z0-9_-]{1,128})\/comments\/([A-Za-z0-9_-]{1,128})\/?$/;
const PAGINA_DO_POST = /^\/[A-Za-z-]{2,8}\/post\/([A-Za-z0-9_-]{1,128})\/?$/;

/**
 * Qual post (e comentário) NOSSO a URL aponta: a nota ActivityPub, o comentário ActivityPub ou a página web do post.
 * `null` se a URL não é daqui ou não é de um post. É o que separa "respondeu a um post de fora" de "respondeu a um post
 * nosso", e o que impede um post nosso de virar `ap_...`.
 */
export function ownPostRef(url: string | null | undefined, origin: string): OwnPostRef | null {
  if (!url || !isOwnUrl(url, origin)) return null;
  const caminho = new URL(url).pathname;
  const comentario = COMENTARIO_PROPRIO.exec(caminho);
  if (comentario) return { postId: comentario[1], commentId: comentario[2] };
  const nota = NOTA_PROPRIA.exec(caminho) ?? PAGINA_DO_POST.exec(caminho);
  return nota ? { postId: nota[1], commentId: null } : null;
}

/** Os dois endereços são do mesmo host? (Autoria: o objeto só vale se vier do servidor de quem diz tê-lo escrito.) */
export function sameHost(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = domainOfUrl(a);
  return x !== null && x === domainOfUrl(b);
}

// ───────────────────────── o documento de ator buscado é de quem dissemos? ─────────────────────────

export type ActorValidationFailure =
  | 'tipo-invalido'
  | 'id-divergente'
  | 'ator-proprio'
  | 'usuario-divergente'
  | 'host-divergente'
  | 'inbox-de-outro-host';

export type ValidatedActor = {
  /** O `id` do ator, já conferido contra a URL pedida. */
  actorId: string;
  /** `usuario@dominio-do-handle`, com o usuário que o ATOR declara (preferredUsername). */
  handle: string;
  /** Domínio do handle (o que a pessoa digitou / o WebFinger respondeu). */
  domain: string;
  inbox: string | null;
  sharedInbox: string | null;
  outbox: string | null;
};

const TIPOS_DE_ATOR = ['Person', 'Service', 'Application', 'Group', 'Organization'];

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const semAncora = (url: string) => { const i = url.indexOf('#'); return i < 0 ? url : url.slice(0, i); };

/**
 * Valida o documento que um servidor remoto devolveu quando pedimos `requestedUrl` (o `self` do WebFinger de
 * `handleUser@handleDomain`). Cada regra fecha um ataque; sem elas, um servidor hostil pode se passar por QUALQUER ator:
 *
 *  - **id divergente**: o `id` tem de ser a URL que pedimos (ou a final, depois de redirecionamentos). Sem isso o servidor
 *    responde com o `id` de OUTRO ator e nós gravamos os dados dele no perfil em cache do alvo (envenenamento de cache,
 *    inclusive do `inbox`, que é para onde vão DMs, curtidas e respostas).
 *  - **ator próprio**: um ator do nosso domínio nunca é remoto. É assim que o @Breno deixaria de ser uma pessoa só.
 *  - **usuário divergente**: o `preferredUsername` tem de ser o do handle (sem diferenciar maiúsculas).
 *  - **host divergente**: o host do ator é o domínio do handle ou um subdomínio dele (o caso comum de `WEB_DOMAIN`). Outro
 *    domínio seria o servidor A dizendo que `x@A` é uma pessoa que mora em B.
 *  - **inbox de outro host**: caixa de entrada fora do host do ator faz a nossa entrega ir parar onde ele escolheu.
 */
export function validateFetchedActor(entrada: {
  requestedUrl: string;
  finalUrl?: string | null;
  handleUser: string;
  handleDomain: string;
  json: unknown;
  ownHost: string;
}): { ok: true; actor: ValidatedActor } | { ok: false; reason: ActorValidationFailure } {
  const { json } = entrada;
  if (!ehObjeto(json)) return { ok: false, reason: 'tipo-invalido' };
  const tipo = json.type;
  const tipos = Array.isArray(tipo) ? tipo : [tipo];
  if (!tipos.some((t) => typeof t === 'string' && TIPOS_DE_ATOR.includes(t))) return { ok: false, reason: 'tipo-invalido' };

  const id = typeof json.id === 'string' ? json.id : '';
  if (!id.startsWith('https://')) return { ok: false, reason: 'tipo-invalido' };
  const pedidas = [entrada.requestedUrl, entrada.finalUrl].filter((u): u is string => typeof u === 'string').map(semAncora);
  if (!pedidas.includes(semAncora(id))) {
    // Divergente. Se o `id` declarado for do nosso domínio é a tentativa de se passar por alguém daqui; senão, é o
    // envenenamento do cache de outro ator. Os dois são recusados; o motivo mais específico ajuda a investigar.
    return { ok: false, reason: isOwnHostUrl(id, entrada.ownHost) ? 'ator-proprio' : 'id-divergente' };
  }
  if (isOwnHostUrl(id, entrada.ownHost) || isOwnHostUrl(entrada.requestedUrl, entrada.ownHost)) {
    return { ok: false, reason: 'ator-proprio' };
  }

  const actorHost = domainOfUrl(id);
  const handleDomain = normalizeHostname(entrada.handleDomain);
  if (!actorHost || !handleDomain) return { ok: false, reason: 'host-divergente' };
  if (actorHost !== handleDomain && !actorHost.endsWith(`.${handleDomain}`)) return { ok: false, reason: 'host-divergente' };

  const declarado = typeof json.preferredUsername === 'string' ? json.preferredUsername.trim() : '';
  if (!declarado || declarado.toLowerCase() !== entrada.handleUser.trim().toLowerCase()) {
    return { ok: false, reason: 'usuario-divergente' };
  }

  const noMesmoHost = (valor: unknown): string | null | 'fora' => {
    if (valor === undefined || valor === null || valor === '') return null;
    if (typeof valor !== 'string' || !valor.startsWith('https://')) return 'fora';
    return domainOfUrl(valor) === actorHost ? valor : 'fora';
  };
  const inbox = noMesmoHost(json.inbox);
  const endpoints = ehObjeto(json.endpoints) ? json.endpoints : {};
  const sharedInbox = noMesmoHost(endpoints.sharedInbox);
  if (inbox === 'fora' || sharedInbox === 'fora') return { ok: false, reason: 'inbox-de-outro-host' };
  const outboxBruto = noMesmoHost(json.outbox);

  return {
    ok: true,
    actor: {
      actorId: id,
      handle: `${declarado}@${handleDomain}`,
      domain: handleDomain,
      inbox,
      sharedInbox,
      outbox: outboxBruto === 'fora' ? null : outboxBruto,
    },
  };
}

/** Handle local de um acct do nosso domínio (`@Breno@exercitodolula.app` → `breno`), ou `null` se for de outro host. */
export function ownHandleOfAcct(user: string, host: string, ownHost: string): string | null {
  return normalizeHostname(host) === ownHost.trim().toLowerCase() ? normalizeHandle(user) : null;
}
