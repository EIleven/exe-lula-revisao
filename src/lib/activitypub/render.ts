// src/lib/activitypub/render.ts
// Dados locais → objetos do protocolo. O ator é uma PROJEÇÃO do perfil, não a fonte: `users/{uid}` continua mandando,
// e desligar a federação não muda nada no perfil local.
//
// O que este módulo nunca emite:
// - e-mail, data de nascimento, preferências, nada de `private/` (o `LocalProfile` nem tem esses campos);
// - mídia fora da nossa URL pública (`media.exercitodolula.app/m/<id>`). Uma URL antiga do Firebase carrega o UID e o
//   caminho interno do arquivo; federá-la seria publicar isso para o mundo;
// - lista de seguidores (só a contagem, ameaça T7) nem objetos com alcance `followers` (a URL do objeto responde 404:
//   o protocolo não nos dá como provar quem pede).
import {
  AP_CONTEXT, buildActor, buildCountOnlyCollection, buildCreate, buildNote, buildOrderedCollection, buildOrderedPage,
  articleBodyToHtml, escapeHtml, hashtagsDoTexto, mencoesDoTexto, plainTextToHtml,
} from './activity.ts';
import type { NoteAttachment } from './activity.ts';
import { addressingFor } from './gate.ts';
import type { FederationScope } from './gate.ts';
import {
  actorUrl, activityUrl, buildInstanceWebfinger, buildWebfinger, followersUrl, followingUrl, hashtagPageUrl, inboxUrl, keyIdUrl, noteUrl,
  outboxUrl, postPageUrl, profilePageUrl, sharedInboxUrl,
} from './identity.ts';
import type { FederationStore, LocalComment, LocalPost } from './store.ts';

export const DEFAULT_LOCALE = 'pt-BR';
export const OUTBOX_PAGE_SIZE = 20;

export type RenderDeps = {
  store: FederationStore;
  /** `https://exercitodolula.app`. */
  origin: string;
  ownHost: string;
  /** `https://media.exercitodolula.app`. */
  mediaOrigin: string;
  /** Tipo MIME do arquivo de uma mídia nossa, pelo id; `null` se não souber. */
  mediaTypeOf: (mediaId: string) => Promise<string | null>;
  softwareVersion: string;
};

export type Rendered = { status: number; body: unknown; headers?: Record<string, string> };

const ISO = (ms: number) => new Date(ms).toISOString();
const sem = (origin: string) => origin.replace(/\/+$/, '');

// ───────────────────────── Ator ─────────────────────────

/** Como servir o ator: pelo host canônico (padrão) ou por um host ANTIGO desta instância. */
export type ActorRenderOptions = {
  /**
   * Servir pelo host antigo: TUDO é montado com ele (id, caixas, chave), e o ator ganha `movedTo` apontando para o
   * canônico. Um documento que declara `id` de outro host é recusado como falsificação pelo Mastodon e pelo nosso
   * próprio `validateFetchedActor` — foi o que deixou a identidade antiga quebrada quando o domínio mudou.
   */
  legacyOrigin?: string | null;
  /** Auto-alias da migração, só no ator canônico: o endereço desta mesma conta no domínio anterior. */
  alsoKnownAs?: readonly string[];
};

export async function renderActor(deps: RenderDeps, handleBruto: string, opcoes: ActorRenderOptions = {}): Promise<Rendered> {
  const { store } = deps;
  // A origem desta resposta: o host antigo, quando o pedido veio por ele; senão o canônico.
  const origin = opcoes.legacyOrigin ?? deps.origin;
  const plataforma = await store.getPlatform();
  if (!plataforma.enabled || plataforma.killSwitch) return { status: 404, body: null };

  const reserva = await store.getHandle(handleBruto);
  if (!reserva) return { status: 404, body: null };
  const id = actorUrl(origin, reserva.handle);

  // Conta que saiu ou foi apagada: 410 + Tombstone. Diz aos outros servidores "isto existiu e não existe mais", que
  // é diferente de 404 e é o que os faz esquecer o ator.
  const conta = await store.getAccount(reserva.uid);
  if (reserva.state !== 'active' || !conta?.enabled) {
    return { status: 410, body: { '@context': 'https://www.w3.org/ns/activitystreams', id, type: 'Tombstone', formerType: 'Person' } };
  }

  const perfil = await store.getProfile(reserva.uid);
  if (!perfil) return { status: 404, body: null };

  return {
    status: 200,
    body: buildActor({
      id,
      handle: reserva.handle,
      name: perfil.name,
      summaryHtml: perfil.bio ? plainTextToHtml(perfil.bio, { tagHref: (t) => hashtagPageUrl(origin, DEFAULT_LOCALE, t) }) : '',
      profileUrl: profilePageUrl(origin, DEFAULT_LOCALE, reserva.uid),
      inbox: inboxUrl(origin, reserva.handle),
      outbox: outboxUrl(origin, reserva.handle),
      followers: followersUrl(origin, reserva.handle),
      following: followingUrl(origin, reserva.handle),
      sharedInbox: sharedInboxUrl(origin),
      keyId: keyIdUrl(origin, reserva.handle),
      publicKeyPem: reserva.publicKeyPem,
      avatarUrl: imagemDePerfil(deps, perfil.avatarUrl),
      avatarAlt: perfil.avatarAlt ?? null,
      coverUrl: imagemDePerfil(deps, perfil.coverUrl),
      coverAlt: perfil.coverUrlAlt ?? null,
      // Descoberta e indexação começam DESLIGADAS para qualquer pessoa. A conta institucional da casa existe para ser
      // encontrada (diretório e busca de outras instâncias), e `isOfficial` só quem administra a rede grava.
      discoverable: perfil.isOfficial === true,
      indexable: perfil.isOfficial === true,
      publishedIso: ISO(reserva.createdAtMs),
      // `conta.alsoKnownAs` (o campo antigo, que a pessoa preenchia) continua FORA. O único alias que sai é o da
      // migração de domínio, montado pela rota e passado aqui.
      alsoKnownAs: opcoes.legacyOrigin ? [] : [...(opcoes.alsoKnownAs ?? [])],
      // Pedido pelo host antigo: o ator diz para onde a conta se mudou. Pelo canônico, vale o que a conta tiver.
      movedTo: opcoes.legacyOrigin ? actorUrl(deps.origin, reserva.handle) : conta.movedTo,
      website: perfil.website && /^https?:\/\//i.test(perfil.website) ? perfil.website : null,
      location: perfil.location,
    }),
  };
}

const EXTRA_OWN_MEDIA_ORIGINS = [
  'https://media.hiperverso.app',
  'https://media.hiperverso.social',
  'https://media.exercitodolula.app',
];

/** A mídia só sai se for da NOSSA URL pública. */
export function nossaMidia(deps: Pick<RenderDeps, 'mediaOrigin'>, url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith(`${sem(deps.mediaOrigin)}/m/`)) return url;
  return EXTRA_OWN_MEDIA_ORIGINS.some((origin) => url.startsWith(`${origin}/m/`)) ? url : null;
}

// Arquivo ESTÁTICO do próprio site (`public/`), gravado como caminho a partir da raiz: sem `//`, sem `..`, e fora das rotas
// dinâmicas (`/api`) e das de mídia (`/m`, `/mp`, que têm regra própria). Só imagem.
const ARQUIVO_ESTATICO = /^\/(?!\/)(?!(?:api|m|mp)\/)(?!.*\.\.)[A-Za-z0-9._/-]{1,200}\.(?:png|jpe?g|webp|gif)$/;

/**
 * Imagem de PERFIL (avatar e capa): a mídia pública nossa OU um arquivo estático do próprio site. A conta oficial guarda o
 * avatar como `/brand/lula.png`; com `nossaMidia` sozinha o ator saía SEM `icon` e a foto não aparecia nas outras instâncias.
 */
export function imagemDePerfil(deps: Pick<RenderDeps, 'origin' | 'mediaOrigin'>, url: string | null | undefined): string | null {
  const midia = nossaMidia(deps, url);
  if (midia) return midia;
  if (!url || !ARQUIVO_ESTATICO.test(url)) return null;
  return `${sem(deps.origin)}${url}`;
}

// ───────────────────────── Nota ─────────────────────────

async function anexosDe(deps: RenderDeps, post: LocalPost): Promise<NoteAttachment[]> {
  const anexos: NoteAttachment[] = [];
  for (const m of post.media.slice(0, 8)) {
    const url = nossaMidia(deps, m.url);
    if (!url) continue;
    const id = url.slice(url.lastIndexOf('/') + 1);
    const tipo = (await deps.mediaTypeOf(id)) ?? (m.type === 'video' ? 'video/mp4' : 'image/jpeg');
    anexos.push({ url, mediaType: tipo, alt: m.alt });
  }
  return anexos;
}

/**
 * O texto do post em TEXTO PURO. Serve de base para as hashtags e de alternativa quando não há HTML.
 *
 * No Artigo, vem o título mais o corpo INTEIRO, com os parágrafos preservados. Não corta em 360 caracteres (quem lia no
 * Mastodon via reticências e tinha de abrir o site) e não enfia o endereço no meio do texto: o endereço canônico é o campo
 * `url` da nota.
 */
export function contentTextOf(post: LocalPost, origin?: string): string {
  if (post.category === 'news') {
    const corpo = (post.text || '')
      .replace(/<\/p\s*>|<br\s*\/?>|<\/h[1-6]\s*>|<\/li\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return [post.headline?.trim(), corpo].filter(Boolean).join('\n\n');
  }
  let texto = post.youtubeVideoId ? `${post.text}\n\nhttps://www.youtube.com/watch?v=${post.youtubeVideoId}`.trim() : post.text;
  if (post.type === 'quote') {
    const linkCitado = post.quotedPostUrl ?? (post.quotedPostId && origin ? postPageUrl(origin, DEFAULT_LOCALE, post.quotedPostId) : null);
    if (linkCitado && !texto.includes(linkCitado)) {
      texto = `${texto}\n\n${linkCitado}`.trim();
    }
  }
  return texto;
}

/**
 * O `content` da nota, em HTML.
 *
 * Artigo: título em negrito e o corpo inteiro convertido do editor (`articleBodyToHtml`), para ser lido de ponta a ponta
 * dentro do Mastodon, Misskey, Pleroma ou Organica, sem sair de lá. Post comum: o texto puro virando parágrafos, como sempre.
 */
function contentHtmlOf(post: LocalPost, origin: string, texto: string): string {
  const tagHref = (tag: string) => hashtagPageUrl(origin, DEFAULT_LOCALE, tag);
  if (post.category !== 'news') return plainTextToHtml(texto, { tagHref });
  const titulo = post.headline?.trim();
  const corpo = articleBodyToHtml(post.text || '');
  // Sem HTML aproveitável (artigo só com mídia, ou corpo vazio), cai no caminho comum em vez de publicar nota vazia.
  if (!corpo) return plainTextToHtml(texto, { tagHref });
  return `${titulo ? `<p><strong>${escapeHtml(titulo)}</strong></p>` : ''}${corpo}`;
}

/**
 * Resolve `@usuario@dominio` do texto para o endereço do ator, usando só quem este servidor já conhece. Quem nunca passou
 * por aqui fica de fora: inventar um endereço mandaria a nota para o servidor errado.
 */
async function mencoesResolvidas(deps: Pick<RenderDeps, 'store' | 'ownHost'>, texto: string): Promise<{ href: string; acct: string }[]> {
  const handles = mencoesDoTexto(texto, deps.ownHost);
  if (handles.length === 0 || !deps.store.findRemoteActorByHandle) return [];
  const achados = await Promise.all(handles.map((h) => deps.store.findRemoteActorByHandle!(h).catch(() => null)));
  const saida: { href: string; acct: string }[] = [];
  achados.forEach((ator, i) => {
    if (ator?.actorId) saida.push({ href: ator.actorId, acct: handles[i] });
  });
  return saida;
}

export async function noteFor(deps: RenderDeps, handle: string, post: LocalPost, scope: FederationScope) {
  const { origin } = deps;
  const ator = actorUrl(origin, handle);
  const { to, cc } = addressingFor(scope, followersUrl(origin, handle));
  const quoteUrl = post.type === 'quote'
    ? (post.quotedPostUrl ?? (post.quotedPostId && !post.quotedPostId.startsWith('ap_') ? noteUrl(origin, post.quotedPostId) : null))
    : null;
  const texto = contentTextOf(post, origin);
  return buildNote({
    id: noteUrl(origin, post.id),
    actorId: ator,
    contentHtml: contentHtmlOf(post, origin, texto),
    publishedIso: ISO(post.createdAtMs),
    updatedIso: post.updatedAtMs ? ISO(post.updatedAtMs) : null,
    to,
    cc,
    url: postPageUrl(origin, DEFAULT_LOCALE, post.id),
    sensitive: post.sensitive,
    quoteUrl,
    attachments: await anexosDe(deps, post),
    // As hashtags vêm do TEXTO que vai no corpo (hashtagsDoTexto), não de `post.hashtags`: o app guarda aquela lista com o `#` e
    // o `tag` saía `##Lula`. Assim `tag` e links do corpo concordam, e uma hashtag só do resumo cortado não vira tag invisível.
    hashtags: hashtagsDoTexto(texto).map((name) => ({ name, href: hashtagPageUrl(origin, DEFAULT_LOCALE, name) })),
    mentions: await mencoesResolvidas(deps, texto),
  });
}

export function commentNoteUrl(origin: string, postId: string, commentId: string): string {
  return `${sem(origin)}/ap/notes/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`;
}

export function commentNoteFor(deps: Pick<RenderDeps, 'origin'>, handle: string, comment: LocalComment, scope: FederationScope) {
  const { origin } = deps;
  const ator = actorUrl(origin, handle);
  const { to, cc } = addressingFor(scope, followersUrl(origin, handle));
  const inReplyTo = comment.parentCommentId
    ? commentNoteUrl(origin, comment.postId, comment.parentCommentId)
    : noteUrl(origin, comment.postId);
  const attachments: NoteAttachment[] = Array.isArray(comment.media)
    ? comment.media
        .slice(0, 4)
        .filter((m) => Boolean(m?.url && /^https:\/\//i.test(m.url)))
        .map((m) => ({
          url: m.url,
          mediaType: m.type === 'video' ? 'video/mp4' : 'image/jpeg',
          alt: m.alt ?? null,
        }))
    : [];
  return buildNote({
    id: commentNoteUrl(origin, comment.postId, comment.id),
    actorId: ator,
    contentHtml: plainTextToHtml(comment.text, { tagHref: (t) => hashtagPageUrl(origin, DEFAULT_LOCALE, t) }),
    publishedIso: ISO(comment.createdAtMs),
    to,
    cc,
    url: postPageUrl(origin, DEFAULT_LOCALE, comment.postId),
    sensitive: comment.sensitive,
    inReplyTo,
    attachments,
    hashtags: hashtagsDoTexto(comment.text).map((name) => ({ name, href: hashtagPageUrl(origin, DEFAULT_LOCALE, name) })),
  });
}

/** `GET /ap/notes/:id`. Só objetos já entregues, com alcance público ou não listado. */
export async function renderNote(deps: RenderDeps, postId: string): Promise<Rendered> {
  const { store } = deps;
  const plataforma = await store.getPlatform();
  if (!plataforma.enabled || plataforma.killSwitch) return { status: 404, body: null };

  const objeto = await store.getObject(postId);
  if (!objeto) return { status: 404, body: null };

  const id = noteUrl(deps.origin, postId);
  // Apagado: 410 + Tombstone, para o outro servidor entender que foi retirado.
  if (objeto.state === 'deleted') {
    return { status: 410, body: { '@context': 'https://www.w3.org/ns/activitystreams', id, type: 'Tombstone', formerType: 'Note' } };
  }
  // Só-seguidores: 404. Não temos como provar que quem pede é seguidor.
  if (objeto.scope === 'followers') return { status: 404, body: null };

  const [post, reserva, conta] = await Promise.all([store.getPost(postId), store.findHandleByUid(objeto.uid), store.getAccount(objeto.uid)]);
  if (!post || post.isDeleted) {
    return { status: 410, body: { '@context': 'https://www.w3.org/ns/activitystreams', id, type: 'Tombstone', formerType: 'Note' } };
  }
  if (!reserva || reserva.state !== 'active' || !conta?.enabled) return { status: 404, body: null };

  const nota = await noteFor(deps, reserva.handle, post, objeto.scope);
  return { status: 200, body: { '@context': AP_CONTEXT, ...nota } };
}

// ───────────────────────── Coleções ─────────────────────────

/** Seguidores e seguindo: só a contagem. Nunca a lista (ameaça T7, enumeração). */
export async function renderCountCollection(deps: RenderDeps, handleBruto: string, qual: 'followers' | 'following'): Promise<Rendered> {
  const { store, origin } = deps;
  const plataforma = await store.getPlatform();
  if (!plataforma.enabled || plataforma.killSwitch) return { status: 404, body: null };
  const reserva = await store.getHandle(handleBruto);
  if (!reserva || reserva.state !== 'active') return { status: 404, body: null };
  const conta = await store.getAccount(reserva.uid);
  if (!conta?.enabled) return { status: 404, body: null };
  const total = qual === 'followers' ? await store.countFollowers(reserva.uid) : 0;
  const id = qual === 'followers' ? followersUrl(origin, reserva.handle) : followingUrl(origin, reserva.handle);
  return { status: 200, body: buildCountOnlyCollection(id, total) };
}

/** Outbox: só o que foi federado com alcance PÚBLICO. Não lista não listados nem só-seguidores. */
export async function renderOutbox(deps: RenderDeps, handleBruto: string, pagina: { before: number | null } | null): Promise<Rendered> {
  const { store, origin } = deps;
  const plataforma = await store.getPlatform();
  if (!plataforma.enabled || plataforma.killSwitch) return { status: 404, body: null };
  const reserva = await store.getHandle(handleBruto);
  if (!reserva || reserva.state !== 'active') return { status: 404, body: null };
  const conta = await store.getAccount(reserva.uid);
  if (!conta?.enabled) return { status: 404, body: null };

  const id = outboxUrl(origin, reserva.handle);
  if (!pagina) {
    const total = await store.countPublicObjects(reserva.uid);
    return { status: 200, body: buildOrderedCollection(id, total, `${id}?page=true`) };
  }

  const objetos = await store.listPublicObjects(reserva.uid, pagina.before, OUTBOX_PAGE_SIZE + 1);
  const temMais = objetos.length > OUTBOX_PAGE_SIZE;
  const visiveis = objetos.slice(0, OUTBOX_PAGE_SIZE).filter((o) => o.state === 'federated');
  const atividades = [];
  for (const o of visiveis) {
    const post = await store.getPost(o.postId);
    if (!post || post.isDeleted) continue;
    const nota = await noteFor(deps, reserva.handle, post, o.scope);
    atividades.push(buildCreate(activityUrl(origin, reserva.handle, `create-${o.postId}`), actorUrl(origin, reserva.handle), nota));
  }
  const ultimo = visiveis[visiveis.length - 1];
  return {
    status: 200,
    body: buildOrderedPage({
      id: pagina.before === null ? `${id}?page=true` : `${id}?page=true&before=${pagina.before}`,
      partOf: id,
      items: atividades,
      next: temMais && ultimo ? `${id}?page=true&before=${ultimo.createdAtMs}` : null,
    }),
  };
}

// ───────────────────────── Descoberta ─────────────────────────

export async function renderWebfinger(
  deps: RenderDeps,
  handleBruto: string,
  /** Pedido por um host antigo: a resposta aponta para o ator DELE, que é quem tem `movedTo`. */
  opcoes: { legacyOrigin?: string | null; legacyHost?: string | null } = {},
): Promise<Rendered> {
  const { store } = deps;
  const origin = opcoes.legacyOrigin ?? deps.origin;
  const ownHost = opcoes.legacyHost ?? deps.ownHost;
  const plataforma = await store.getPlatform();
  if (!plataforma.enabled || plataforma.killSwitch) return { status: 404, body: null };
  const reserva = await store.getHandle(handleBruto);
  // WebFinger só responde por conta ATIVA: não revela contas desligadas nem removidas.
  if (!reserva || reserva.state !== 'active') return { status: 404, body: null };
  const conta = await store.getAccount(reserva.uid);
  if (!conta?.enabled) return { status: 404, body: null };
  return {
    status: 200,
    body: buildWebfinger({ handle: reserva.handle, host: ownHost, origin, locale: DEFAULT_LOCALE, userId: reserva.uid }),
    headers: { 'Content-Type': 'application/jrd+json; charset=utf-8' },
  };
}

/**
 * WebFinger do ator da INSTÂNCIA (`acct:<domínio>@<domínio>`). Existe enquanto a plataforma estiver ligada, como o próprio ator
 * (`/ap/actor`): com ela desligada ou no botão de emergência, 404.
 */
export async function renderInstanceWebfinger(deps: Pick<RenderDeps, 'store' | 'origin' | 'ownHost'>): Promise<Rendered> {
  const plataforma = await deps.store.getPlatform();
  if (!plataforma.enabled || plataforma.killSwitch) return { status: 404, body: null };
  return {
    status: 200,
    body: buildInstanceWebfinger({ host: deps.ownHost, origin: deps.origin }),
    headers: { 'Content-Type': 'application/jrd+json; charset=utf-8' },
  };
}

export function renderNodeInfoIndex(origin: string): Rendered {
  return {
    status: 200,
    body: { links: [{ rel: 'http://nodeinfo.diaspora.software/ns/schema/2.1', href: `${sem(origin)}/nodeinfo/2.1` }] },
  };
}

/**
 * NodeInfo 2.1. Contagens só de FEDERAÇÃO (contas que optaram e objetos que saíram), não da rede toda: é o que a
 * própria federação revela, nada além. `openRegistrations: false` — o cadastro da rede tem limite e não queremos
 * aparecer em diretórios de instâncias abertas (decisão a revisitar quando o limite subir).
 */
export async function renderNodeInfo(deps: RenderDeps): Promise<Rendered> {
  const { store } = deps;
  const plataforma = await store.getPlatform();
  if (!plataforma.enabled || plataforma.killSwitch) return { status: 404, body: null };
  const metricas = await store.federationCounts();
  return {
    status: 200,
    body: {
      version: '2.1',
      software: { name: 'exelula', version: deps.softwareVersion },
      protocols: ['activitypub'],
      services: { inbound: [], outbound: [] },
      openRegistrations: false,
      usage: { users: { total: metricas.accounts }, localPosts: metricas.publicObjects },
      metadata: {
        nodeName: 'HiperVerso',
        nodeDescription:
          'Comunidade brasileira independente e rede ActivityPub autoral em Next.js/TypeScript com WebRTC P2P e E2EE (sem vinculo institucional partidario ou governamental).',
        maintainer: 'Breno Ramos',
        homepageUrl: 'https://hiperverso.app/pt-BR/about',
        repositoryUrl: 'https://github.com/EIleven/hiperverso',
        devPortalUrl: 'https://hiperverso.app/pt-BR/dev',
        softwareStack: 'Codigo proprio em TypeScript/Next.js + ActivityPub nativo (nao e fork de Misskey)',
      },
    },
    headers: { 'Content-Type': 'application/json; profile="http://nodeinfo.diaspora.software/ns/schema/2.1#"' },
  };
}

