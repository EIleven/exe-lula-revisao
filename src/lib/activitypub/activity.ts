// src/lib/activitypub/activity.ts
// Objetos do ActivityPub: o que construímos para sair e a validação do que chega. Módulo puro, sem imports.
//
// O que ENTRA é tratado como hostil até prova em contrário. `parseInboundActivity` não confia em nada que o JSON
// afirma sobre si mesmo; cada regra existe contra um ataque concreto:
//
// - o `id` da atividade tem de ser https e do MESMO host do ator — senão um servidor poderia assinar uma atividade
//   cujo id aponta para o objeto de outro, e fazer o nosso banco tratá-la como se fosse daquele outro;
// - o `attributedTo` do objeto tem de ser o ator que assinou. É a defesa contra "o servidor A assina um Create
//   cujo autor declarado é B": a assinatura prova A, não B;
// - ator local é recusado: atividades nossas nunca chegam por HTTP, então quem diz ser nosso ator pela rede está
//   mentindo;
// - orçamento de tamanho e profundidade do JSON, para que um corpo dentro do limite de bytes não vire um custo
//   enorme de processamento.

export const AS_PUBLIC = 'https://www.w3.org/ns/activitystreams#Public';

/**
 * Contexto do actor: ActivityStreams, a extensão de segurança (publicKey) e os termos que Mastodon e companhia
 * reconhecem. Sem processar JSON-LD de verdade — como todo o Fediverso, tratamos o contexto como convenção fixa.
 */
export const AP_CONTEXT = [
  'https://www.w3.org/ns/activitystreams',
  'https://w3id.org/security/v1',
  {
    manuallyApprovesFollowers: 'as:manuallyApprovesFollowers',
    toot: 'http://joinmastodon.org/ns#',
    discoverable: 'toot:discoverable',
    indexable: 'toot:indexable',
    sensitive: 'as:sensitive',
    alsoKnownAs: { '@id': 'as:alsoKnownAs', '@type': '@id' },
    movedTo: { '@id': 'as:movedTo', '@type': '@id' },
    schema: 'http://schema.org#',
    PropertyValue: 'schema:PropertyValue',
    value: 'schema:value',
    Hashtag: 'as:Hashtag',
  },
] as const;

// ───────────────────────── Texto → HTML ─────────────────────────

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (texto: string) => texto.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Pontuação que costuma colar no fim de uma URL numa frase e não faz parte dela. */
const PONTUACAO_FINAL = /[.,;:!?)\]}'"»”’]+$/;
const TOKEN = /(https?:\/\/[^\s<>"']+)|(^|[\s(\[{])#([\p{L}\p{N}_]{1,100})/gu;

export type TextToHtmlOptions = { tagHref: (tag: string) => string };

/**
 * As hashtags que o texto REALMENTE contém: sem o `#`, sem repetir (`#Lula` e `#lula` são a mesma) e na ordem de aparição.
 * É o que vai no campo `tag` da nota: o servidor remoto só indexa a hashtag por ele (o link no corpo não basta) e só o que o
 * leitor vê no texto deve estar lá. Usa o MESMO tokenizador do `plainTextToHtml`, então `tag` e link nunca discordam.
 *
 * Existe porque o app guarda `posts.hashtags` COM o `#` (`["#Lula"]`) e o `tag` saía `##Lula`, com href `/tag/%23Lula`: o
 * Mastodon não reconhece esse nome e a hashtag nunca era indexada lá (conferido em produção, 2026-11-14).
 */
export function hashtagsDoTexto(texto: string, max = 30): string[] {
  const vistos = new Set<string>();
  const nomes: string[] = [];
  for (const linha of texto.replace(/\r\n?/g, '\n').split('\n')) {
    for (const m of linha.matchAll(TOKEN)) {
      if (m[1] || !m[3]) continue; // é uma URL (o `#` dentro dela não é hashtag) ou não achou nome
      const chave = m[3].toLowerCase();
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      nomes.push(m[3]);
      if (nomes.length >= max) return nomes;
    }
  }
  return nomes;
}

/**
 * Texto puro do post → HTML mínimo do ActivityPub. TUDO é escapado primeiro; só o que construímos (parágrafos,
 * `<br>`, links) vira marcação. Não há caminho para HTML do usuário chegar cru ao Fediverso.
 *
 * O texto de um post comum é puro, com `#hashtags` e URLs soltas (o compositor não gera HTML).
 */
export function plainTextToHtml(texto: string, opcoes: TextToHtmlOptions): string {
  const normalizado = texto.replace(/\r\n?/g, '\n').trim();
  if (!normalizado) return '';
  const paragrafos = normalizado.split(/\n{2,}/);
  return paragrafos
    .map((p) => `<p>${p.split('\n').map((linha) => linhaParaHtml(linha, opcoes)).join('<br>')}</p>`)
    .join('');
}

function linhaParaHtml(linha: string, { tagHref }: TextToHtmlOptions): string {
  let saida = '';
  let cursor = 0;
  for (const m of linha.matchAll(TOKEN)) {
    const inicio = m.index ?? 0;
    saida += escapeHtml(linha.slice(cursor, inicio));
    if (m[1]) {
      const crua = m[1];
      const url = crua.replace(PONTUACAO_FINAL, '');
      const resto = crua.slice(url.length);
      let valida = false;
      try {
        valida = ['http:', 'https:'].includes(new URL(url).protocol);
      } catch {
        valida = false;
      }
      saida += valida
        ? `<a href="${escapeHtml(url)}" rel="nofollow noopener noreferrer" target="_blank">${escapeHtml(url)}</a>${escapeHtml(resto)}`
        : escapeHtml(crua);
      cursor = inicio + crua.length;
    } else {
      const antes = m[2] ?? '';
      const tag = m[3];
      saida += `${escapeHtml(antes)}<a href="${escapeHtml(tagHref(tag))}" class="mention hashtag" rel="tag">#<span>${escapeHtml(tag)}</span></a>`;
      cursor = inicio + m[0].length;
    }
  }
  return saida + escapeHtml(linha.slice(cursor));
}

// ───────────────────────── Construtores de saída ─────────────────────────

export type ActorInput = {
  id: string;
  handle: string;
  name: string;
  summaryHtml: string;
  profileUrl: string;
  inbox: string;
  outbox: string;
  followers: string;
  following: string;
  sharedInbox: string;
  keyId: string;
  publicKeyPem: string;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  publishedIso: string;
  discoverable?: boolean;
  /** Consentimento para mecanismos de busca (Mastodon 4.3+). Segue o mesmo padrão protetor: desligado. */
  indexable?: boolean;
  alsoKnownAs?: string[];
  movedTo?: string | null;
  website?: string | null;
  location?: string | null;
};

export function buildActor(a: ActorInput) {
  const attachment: unknown[] = [];
  if (a.website) {
    attachment.push({
      type: 'PropertyValue',
      name: 'Site',
      value: `<a href="${escapeHtml(a.website)}" rel="me nofollow noopener noreferrer" target="_blank">${escapeHtml(a.website)}</a>`,
    });
  }
  if (a.location) attachment.push({ type: 'PropertyValue', name: 'Local', value: escapeHtml(a.location) });

  return {
    '@context': AP_CONTEXT,
    id: a.id,
    type: 'Person',
    preferredUsername: a.handle,
    name: a.name,
    summary: a.summaryHtml,
    url: a.profileUrl,
    inbox: a.inbox,
    outbox: a.outbox,
    followers: a.followers,
    following: a.following,
    endpoints: { sharedInbox: a.sharedInbox },
    // Aprovação manual de seguidores não existe na v1: quem não quer um seguidor o remove ou o bloqueia.
    manuallyApprovesFollowers: false,
    // Descoberta e indexação são escolha da pessoa e começam DESLIGADAS: padrão protetor.
    discoverable: a.discoverable ?? false,
    indexable: a.indexable ?? false,
    published: a.publishedIso,
    publicKey: { id: a.keyId, owner: a.id, publicKeyPem: a.publicKeyPem },
    ...(a.avatarUrl ? { icon: { type: 'Image', url: a.avatarUrl } } : {}),
    ...(a.coverUrl ? { image: { type: 'Image', url: a.coverUrl } } : {}),
    ...(attachment.length ? { attachment } : {}),
    ...(a.alsoKnownAs?.length ? { alsoKnownAs: a.alsoKnownAs } : {}),
    ...(a.movedTo ? { movedTo: a.movedTo } : {}),
  };
}

export type NoteAttachment = { url: string; mediaType: string; alt?: string | null };

export type NoteInput = {
  id: string;
  actorId: string;
  contentHtml: string;
  publishedIso: string;
  updatedIso?: string | null;
  to: string[];
  cc: string[];
  url: string;
  sensitive: boolean;
  inReplyTo?: string | null;
  quoteUrl?: string | null;
  attachments: NoteAttachment[];
  hashtags: { name: string; href: string }[];
};

export function buildNote(n: NoteInput) {
  return {
    id: n.id,
    type: 'Note',
    attributedTo: n.actorId,
    content: n.contentHtml,
    // Sem `contentMap`: o idioma do post não é registrado hoje, e declarar um errado é pior que não declarar.
    published: n.publishedIso,
    ...(n.updatedIso ? { updated: n.updatedIso } : {}),
    to: n.to,
    cc: n.cc,
    url: n.url,
    sensitive: n.sensitive,
    inReplyTo: n.inReplyTo ?? null,
    ...(n.quoteUrl ? { quoteUrl: n.quoteUrl, quoteUri: n.quoteUrl, _misskey_quote: n.quoteUrl } : {}),
    attachment: n.attachments.map((a) => ({
      type: 'Document',
      mediaType: a.mediaType,
      url: a.url,
      ...(a.alt ? { name: a.alt } : {}),
    })),
    tag: n.hashtags.map((h) => ({ type: 'Hashtag', href: h.href, name: `#${h.name}` })),
  };
}

type Note = ReturnType<typeof buildNote>;

export function buildCreate(id: string, actorId: string, note: Note) {
  return {
    '@context': AP_CONTEXT,
    id,
    type: 'Create',
    actor: actorId,
    published: note.published,
    to: note.to,
    cc: note.cc,
    object: note,
  };
}

export function buildUpdate(id: string, actorId: string, note: Note, updatedIso: string) {
  return {
    '@context': AP_CONTEXT,
    id,
    type: 'Update',
    actor: actorId,
    published: updatedIso,
    to: note.to,
    cc: note.cc,
    object: { ...note, updated: updatedIso },
  };
}

export function buildDelete(id: string, actorId: string, objectId: string, to: string[], cc: string[]) {
  return {
    '@context': AP_CONTEXT,
    id,
    type: 'Delete',
    actor: actorId,
    to,
    cc,
    object: { id: objectId, type: 'Tombstone', formerType: 'Note' },
  };
}

/** `Delete` do próprio actor: a pessoa saiu da federação. Melhor esforço, como toda exclusão remota. */
export function buildDeleteActor(id: string, actorId: string) {
  return { '@context': AP_CONTEXT, id, type: 'Delete', actor: actorId, to: [AS_PUBLIC], object: actorId };
}

/** `Accept`/`Reject` de um `Follow`. Leva o Follow inteiro: é assim que a maioria dos servidores o casa. */
export function buildFollowResponse(
  type: 'Accept' | 'Reject',
  id: string,
  actorId: string,
  follow: Record<string, unknown>,
) {
  return { '@context': AP_CONTEXT, id, type, actor: actorId, object: follow };
}

export function buildFollow(id: string, actorId: string, targetActorId: string) {
  return { '@context': AP_CONTEXT, id, type: 'Follow', actor: actorId, object: targetActorId };
}

export function buildLike(id: string, actorId: string, objectId: string) {
  return { '@context': AP_CONTEXT, id, type: 'Like', actor: actorId, object: objectId };
}

export function buildUndo(id: string, actorId: string, inner: Record<string, unknown>) {
  return { '@context': AP_CONTEXT, id, type: 'Undo', actor: actorId, object: inner };
}

export function buildMove(id: string, actorId: string, targetActorId: string) {
  return { '@context': AP_CONTEXT, id, type: 'Move', actor: actorId, object: actorId, target: targetActorId };
}

export function buildAnnounce(
  id: string,
  actorId: string,
  objectId: string,
  to: string[],
  cc: string[],
  publishedIso: string,
) {
  return { '@context': AP_CONTEXT, id, type: 'Announce', actor: actorId, published: publishedIso, to, cc, object: objectId };
}

// ───────────────────────── Coleções ─────────────────────────

/** Coleção só com a contagem. Não lista ninguém: é o padrão (ameaça T7, enumeração de seguidores). */
export function buildCountOnlyCollection(id: string, totalItems: number) {
  return { '@context': AP_CONTEXT, id, type: 'OrderedCollection', totalItems };
}

export function buildOrderedCollection(id: string, totalItems: number, firstUrl: string) {
  return { '@context': AP_CONTEXT, id, type: 'OrderedCollection', totalItems, first: firstUrl };
}

export function buildOrderedPage(entrada: {
  id: string;
  partOf: string;
  items: unknown[];
  next?: string | null;
}) {
  return {
    '@context': AP_CONTEXT,
    id: entrada.id,
    type: 'OrderedCollectionPage',
    partOf: entrada.partOf,
    orderedItems: entrada.items,
    ...(entrada.next ? { next: entrada.next } : {}),
  };
}

// ───────────────────────── Entrada: validação ─────────────────────────

/** Tipos de atividade que o inbox processa. Qualquer outro é ignorado com 202, sem erro. */
export const HANDLED_TYPES = [
  'Follow', 'Accept', 'Reject', 'Undo', 'Create', 'Update', 'Delete', 'Like', 'Announce', 'Block', 'Flag', 'Move',
] as const;
export type HandledType = (typeof HANDLED_TYPES)[number];

/** Tipos de OBJETO aceitos em Create/Update. O resto não é conteúdo que saibamos tratar com segurança. */
const OBJECT_TYPES = ['Note', 'Article', 'Page', 'Question'];

export const INBOUND_LIMITS = {
  maxContentChars: 100_000,
  maxAttachments: 16,
  maxTags: 100,
  maxUrlLength: 2048,
  maxDepth: 12,
  maxNodes: 20_000,
} as const;

export type InboundReason =
  | 'json-invalido'
  | 'estrutura-grande-demais'
  | 'sem-id'
  | 'sem-ator'
  | 'id-nao-https'
  | 'id-de-outro-host'
  | 'ator-local'
  | 'tipo-ignorado'
  | 'objeto-invalido'
  | 'autor-diferente-do-ator'
  | 'conteudo-grande-demais';

export type InboundActivity = {
  id: string;
  type: HandledType;
  actor: string;
  actorHost: string;
  object: unknown;
  objectId: string | null;
  objectType: string | null;
  to: string[];
  cc: string[];
  raw: Record<string, unknown>;
};

export type InboundResult = { ok: true; activity: InboundActivity } | { ok: false; reason: InboundReason };

const recusar = (reason: InboundReason): InboundResult => ({ ok: false, reason });

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `https://host/...` sem credenciais e dentro do limite. Devolve o host em minúsculas, ou `null`. */
function hostHttps(url: unknown): string | null {
  if (typeof url !== 'string' || url.length === 0 || url.length > INBOUND_LIMITS.maxUrlLength) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname) return null;
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Conta nós e profundidade sem recursão ilimitada. `false` = estourou o orçamento. */
function withinBudget(raiz: unknown): boolean {
  let nos = 0;
  const pilha: [unknown, number][] = [[raiz, 0]];
  while (pilha.length) {
    const [v, profundidade] = pilha.pop() as [unknown, number];
    if (++nos > INBOUND_LIMITS.maxNodes || profundidade > INBOUND_LIMITS.maxDepth) return false;
    if (Array.isArray(v)) for (const item of v) pilha.push([item, profundidade + 1]);
    else if (ehObjeto(v)) for (const item of Object.values(v)) pilha.push([item, profundidade + 1]);
  }
  return true;
}

/** `string | {id} | (string|{id})[]` → lista de ids. Só strings https entram. */
function idsDe(v: unknown): string[] {
  const itens = Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
  const ids: string[] = [];
  for (const item of itens) {
    if (typeof item === 'string') ids.push(item);
    else if (ehObjeto(item) && typeof item.id === 'string') ids.push(item.id);
  }
  return ids;
}

const listaDeStrings = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).filter((x): x is string => typeof x === 'string');

/**
 * Valida a estrutura de uma atividade recebida. NÃO verifica assinatura (isso é `signature.ts`) nem política de
 * instância; verifica que o que o JSON afirma é coerente consigo mesmo e com o ator que assinou.
 *
 * `signerActor` é o ator que a assinatura provou. A atividade tem de afirmar ser dele.
 */
export function parseInboundActivity(
  json: unknown,
  contexto: { signerActor: string; ownHost: string },
): InboundResult {
  if (!ehObjeto(json)) return recusar('json-invalido');
  if (!withinBudget(json)) return recusar('estrutura-grande-demais');

  const id = json.id;
  if (typeof id !== 'string' || !id) return recusar('sem-id');
  const hostDoId = hostHttps(id);
  if (!hostDoId) return recusar('id-nao-https');

  const atores = idsDe(json.actor);
  if (atores.length !== 1) return recusar('sem-ator');
  const actor = atores[0];
  const hostDoAtor = hostHttps(actor);
  if (!hostDoAtor) return recusar('sem-ator');

  // A assinatura provou UM ator. A atividade tem de ser dele.
  if (actor !== contexto.signerActor) return recusar('autor-diferente-do-ator');
  if (hostDoAtor === contexto.ownHost.toLowerCase()) return recusar('ator-local');
  if (hostDoId !== hostDoAtor) return recusar('id-de-outro-host');

  const tipo = json.type;
  if (typeof tipo !== 'string' || !(HANDLED_TYPES as readonly string[]).includes(tipo)) return recusar('tipo-ignorado');
  const type = tipo as HandledType;

  const objeto = json.object;
  const objectId = typeof objeto === 'string' ? objeto : ehObjeto(objeto) && typeof objeto.id === 'string' ? objeto.id : null;
  const objectType = ehObjeto(objeto) && typeof objeto.type === 'string' ? objeto.type : null;

  const base = {
    id,
    type,
    actor,
    actorHost: hostDoAtor,
    object: objeto,
    objectId,
    objectType,
    to: listaDeStrings(json.to),
    cc: listaDeStrings(json.cc),
    raw: json,
  };

  switch (type) {
    case 'Follow':
    case 'Like':
    case 'Announce':
    case 'Block':
      // Esses tipos apontam para algo por id. Objeto embutido aqui seria inventar conteúdo.
      if (typeof objeto !== 'string' || !hostHttps(objeto)) return recusar('objeto-invalido');
      break;

    case 'Accept':
    case 'Reject':
    case 'Undo': {
      if (typeof objeto === 'string') {
        if (!hostHttps(objeto)) return recusar('objeto-invalido');
        break;
      }
      if (!ehObjeto(objeto) || typeof objeto.type !== 'string') return recusar('objeto-invalido');
      // Undo de atividade EMBUTIDA: o autor dela tem de ser quem desfaz. Senão alguém "desfaz" a curtida de outro.
      if (type === 'Undo' && idsDe(objeto.actor)[0] !== actor) return recusar('autor-diferente-do-ator');
      break;
    }

    case 'Create':
    case 'Update': {
      if (!ehObjeto(objeto)) return recusar('objeto-invalido');
      const objetoTipo = objeto.type;
      if (typeof objetoTipo !== 'string' || !OBJECT_TYPES.includes(objetoTipo)) return recusar('tipo-ignorado');
      const idDoObjeto = objeto.id;
      if (typeof idDoObjeto !== 'string' || hostHttps(idDoObjeto) !== hostDoAtor) return recusar('id-de-outro-host');
      // O ponto central contra falsificação de autoria.
      if (idsDe(objeto.attributedTo)[0] !== actor) return recusar('autor-diferente-do-ator');
      const conteudo = objeto.content;
      if (conteudo !== undefined && (typeof conteudo !== 'string' || conteudo.length > INBOUND_LIMITS.maxContentChars)) {
        return recusar('conteudo-grande-demais');
      }
      const anexos = objeto.attachment;
      if (anexos !== undefined && (!Array.isArray(anexos) || anexos.length > INBOUND_LIMITS.maxAttachments)) {
        return recusar('conteudo-grande-demais');
      }
      const tags = objeto.tag;
      if (tags !== undefined && (!Array.isArray(tags) || tags.length > INBOUND_LIMITS.maxTags)) {
        return recusar('conteudo-grande-demais');
      }
      break;
    }

    case 'Delete': {
      if (!objectId || !hostHttps(objectId)) return recusar('objeto-invalido');
      // Só se apaga o que é do próprio host: um ator não apaga objeto de outro servidor.
      if (hostHttps(objectId) !== hostDoAtor) return recusar('id-de-outro-host');
      break;
    }

    case 'Flag': {
      const alvos = idsDe(objeto);
      if (alvos.length === 0 || alvos.length > 20 || alvos.some((a) => !hostHttps(a))) return recusar('objeto-invalido');
      const conteudo = json.content;
      if (conteudo !== undefined && (typeof conteudo !== 'string' || conteudo.length > 5000)) {
        return recusar('conteudo-grande-demais');
      }
      break;
    }

    case 'Move': {
      if (objeto !== actor) return recusar('objeto-invalido');
      if (typeof json.target !== 'string' || !hostHttps(json.target)) return recusar('objeto-invalido');
      break;
    }
  }

  return { ok: true, activity: base };
}

/** Endereçada ao público? (`Public` em `to` ou `cc`.) */
export function isAddressedToPublic(a: { to: string[]; cc: string[] }): boolean {
  return a.to.includes(AS_PUBLIC) || a.cc.includes(AS_PUBLIC) || a.to.includes('as:Public') || a.cc.includes('as:Public');
}
