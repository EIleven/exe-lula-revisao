// src/lib/activitypub/officialPost.ts
// Entrada da API da conta oficial (`/api/admin/official-account`): valida e normaliza o que a administração manda ANTES de
// qualquer escrita. Módulo puro (sem Firebase nem Next), para a suíte e2e/ap-oficial-check.mjs exercitar cada recusa.
//
// Por que existe: a rota gravava `media`, `location`, `youtubeVideoId`, `sourceUrl` e `replyPermission` exatamente como vinham.
// Dois estragos concretos, ambos SILENCIOSOS:
//   1. uma mídia que não é da nossa URL pública (`media.exercitodolula.app/m/<id>`) era descartada na hora de federar: o post
//      saía só com texto e ninguém era avisado; o mesmo vale para o 9º anexo em diante (o Fediverso leva até 8);
//   2. um `youtubeVideoId` qualquer vira endereço no corpo do post que sai (`youtube.com/watch?v=<id>`).
// A regra: o que não pode ser federado como foi pedido é RECUSADO com um código, e não "consertado" em silêncio.
//
// (Sem "parameter properties" nem enums: o Node, ao rodar os testes, só remove tipos e não compila essa sintaxe.)

export const OFFICIAL_MAX_TEXT = 5000;
export const OFFICIAL_MAX_HEADLINE = 200;
export const OFFICIAL_MAX_MEDIA = 8;
export const OFFICIAL_MAX_ALT = 1500;
/** Avatar de partida da conta oficial: arquivo estático que EXISTE (`public/brand/lula.png`, 512×512). */
export const OFFICIAL_DEFAULT_AVATAR = '/brand/lula.png';
/** O avatar de partida antigo: o arquivo nunca existiu (404 em produção). Quem o tem gravado é consertado. */
export const OFFICIAL_BROKEN_AVATAR = '/lula-icon.png';

const REPLY_PERMISSIONS = ['everyone', 'followed', 'mentioned', 'none'] as const;
const FEDERATION_REACHES = ['local', 'public', 'unlisted', 'followers'] as const;

export type OfficialReplyPermission = (typeof REPLY_PERMISSIONS)[number];
export type OfficialFederation = (typeof FEDERATION_REACHES)[number];

export type OfficialPostErrorCode =
  | 'titulo-obrigatorio'
  | 'titulo-longo'
  | 'conteudo-vazio'
  | 'texto-longo'
  | 'midia-invalida'
  | 'midia-nao-federavel'
  | 'youtube-invalido'
  | 'link-invalido'
  | 'permissao-invalida'
  | 'local-invalido'
  | 'alcance-invalido';

export type OfficialPostContext = {
  /** Origem pública da mídia (`https://media.exercitodolula.app`). */
  mediaOrigin: string;
};

export type OfficialMedia = { url: string; type: 'image' | 'video'; alt?: string };

export type ParsedOfficialPost = {
  category: 'echo' | 'news';
  /** Texto como veio (sem `trim`: quebras de linha e espaços do autor são dele), ou `''`. */
  text: string;
  headline: string;
  sourceUrl: string | null;
  newsCategory: string | null;
  media: OfficialMedia[];
  youtubeVideoId: string | null;
  allowReposts: boolean;
  replyPermission: OfficialReplyPermission;
  location: { name: string; state: string; ibgeId: number } | null;
  sensitive: boolean;
  federation: OfficialFederation;
};

export type OfficialPostResult = { ok: true; post: ParsedOfficialPost } | { ok: false; error: OfficialPostErrorCode; detail: string };

const recusa = (error: OfficialPostErrorCode, detail: string): OfficialPostResult => ({ ok: false, error, detail });
const semBarra = (u: string) => u.replace(/\/+$/, '');

/** `https://` absoluto e bem formado, até 2048 caracteres. */
export function isHttpsUrl(valor: unknown, max = 2048): valor is string {
  if (typeof valor !== 'string' || valor.length === 0 || valor.length > max) return false;
  try {
    return new URL(valor).protocol === 'https:';
  } catch {
    return false;
  }
}

const EXTRA_OWN_MEDIA_ORIGINS = [
  'https://media.hiperverso.app',
  'https://media.hiperverso.social',
];

/** Este endereço de mídia é da nossa URL pública, a única que o Fediverso recebe? */
export function isOwnPublicMedia(url: string, mediaOrigin: string): boolean {
  if (url.startsWith(`${semBarra(mediaOrigin)}/m/`)) return true;
  return EXTRA_OWN_MEDIA_ORIGINS.some((origin) => url.startsWith(`${origin}/m/`));
}

function parseMedia(bruto: unknown, federa: boolean, ctx: OfficialPostContext): { ok: true; media: OfficialMedia[] } | { ok: false; error: OfficialPostErrorCode; detail: string } {
  if (bruto === undefined || bruto === null) return { ok: true, media: [] };
  if (!Array.isArray(bruto)) return { ok: false, error: 'midia-invalida', detail: 'media deve ser uma lista' };
  if (bruto.length > OFFICIAL_MAX_MEDIA) {
    // Para o Fediverso o limite é duro (o 9º anexo seria descartado sem aviso); para um post só daqui, é só sanidade.
    return { ok: false, error: federa ? 'midia-nao-federavel' : 'midia-invalida', detail: `no máximo ${OFFICIAL_MAX_MEDIA} anexos` };
  }
  const media: OfficialMedia[] = [];
  for (const [i, item] of bruto.entries()) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return { ok: false, error: 'midia-invalida', detail: `anexo ${i + 1} não é um objeto` };
    const { url, type, alt } = item as Record<string, unknown>;
    if (typeof url !== 'string' || url.length === 0 || url.length > 2048) return { ok: false, error: 'midia-invalida', detail: `anexo ${i + 1}: url ausente ou longa demais` };
    if (type !== 'image' && type !== 'video') return { ok: false, error: 'midia-invalida', detail: `anexo ${i + 1}: tipo deve ser image ou video` };
    if (alt !== undefined && alt !== null && (typeof alt !== 'string' || alt.length > OFFICIAL_MAX_ALT)) {
      return { ok: false, error: 'midia-invalida', detail: `anexo ${i + 1}: texto alternativo inválido (até ${OFFICIAL_MAX_ALT} caracteres)` };
    }
    if (federa && !isOwnPublicMedia(url, ctx.mediaOrigin)) {
      return { ok: false, error: 'midia-nao-federavel', detail: `anexo ${i + 1} não é da mídia pública da casa (${semBarra(ctx.mediaOrigin)}/m/…): iria para o Fediverso SEM a imagem` };
    }
    if (!federa && !isHttpsUrl(url) && !/^\/(?!\/)[^\s]*$/.test(url)) return { ok: false, error: 'midia-invalida', detail: `anexo ${i + 1}: endereço inválido` };
    media.push({ url, type, ...(typeof alt === 'string' && alt.trim() ? { alt: alt.trim() } : {}) });
  }
  return { ok: true, media };
}

/** Valida o corpo do POST de publicação. Nada é escrito aqui. */
export function parseOfficialPost(body: Record<string, unknown>, ctx: OfficialPostContext): OfficialPostResult {
  const category: 'echo' | 'news' = body.category === 'news' ? 'news' : 'echo';

  let federation: OfficialFederation = 'public';
  if (body.federation !== undefined && body.federation !== null) {
    if (typeof body.federation !== 'string' || !(FEDERATION_REACHES as readonly string[]).includes(body.federation)) {
      return recusa('alcance-invalido', `federation deve ser ${FEDERATION_REACHES.join(', ')}`);
    }
    federation = body.federation as OfficialFederation;
  }
  const federa = federation !== 'local';

  const text = typeof body.text === 'string' ? body.text : '';
  if (text.length > OFFICIAL_MAX_TEXT) return recusa('texto-longo', `o texto passa de ${OFFICIAL_MAX_TEXT} caracteres`);

  const headline = typeof body.headline === 'string' ? body.headline.trim() : '';
  if (headline.length > OFFICIAL_MAX_HEADLINE) return recusa('titulo-longo', `o título passa de ${OFFICIAL_MAX_HEADLINE} caracteres`);
  if (category === 'news' && headline.length < 5) return recusa('titulo-obrigatorio', 'notícia precisa de título com ao menos 5 caracteres');

  const midia = parseMedia(body.media, federa, ctx);
  if (!midia.ok) return recusa(midia.error, midia.detail);

  let youtubeVideoId: string | null = null;
  if (body.youtubeVideoId !== undefined && body.youtubeVideoId !== null && body.youtubeVideoId !== '') {
    if (typeof body.youtubeVideoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(body.youtubeVideoId)) {
      return recusa('youtube-invalido', 'youtubeVideoId deve ter 11 caracteres (letras, números, _ e -)');
    }
    youtubeVideoId = body.youtubeVideoId;
  }

  if (!text.trim() && midia.media.length === 0 && !youtubeVideoId) return recusa('conteudo-vazio', 'sem texto, mídia ou vídeo');

  let sourceUrl: string | null = null;
  if (category === 'news' && body.sourceUrl !== undefined && body.sourceUrl !== null && body.sourceUrl !== '') {
    if (!isHttpsUrl(body.sourceUrl)) return recusa('link-invalido', 'sourceUrl deve ser um endereço https:// válido');
    sourceUrl = body.sourceUrl;
  }

  let replyPermission: OfficialReplyPermission = 'everyone';
  if (body.replyPermission !== undefined && body.replyPermission !== null) {
    if (typeof body.replyPermission !== 'string' || !(REPLY_PERMISSIONS as readonly string[]).includes(body.replyPermission)) {
      return recusa('permissao-invalida', `replyPermission deve ser ${REPLY_PERMISSIONS.join(', ')}`);
    }
    replyPermission = body.replyPermission as OfficialReplyPermission;
  }

  let location: ParsedOfficialPost['location'] = null;
  if (body.location !== undefined && body.location !== null) {
    const l = body.location as Record<string, unknown>;
    const ok = typeof l === 'object' && !Array.isArray(l)
      && typeof l.name === 'string' && l.name.trim().length > 0 && l.name.length <= 120
      && typeof l.state === 'string' && /^[A-Za-z]{2}$/.test(l.state)
      && typeof l.ibgeId === 'number' && Number.isInteger(l.ibgeId) && l.ibgeId >= 0;
    if (!ok) return recusa('local-invalido', 'location deve ser { name, state (2 letras), ibgeId (inteiro) }');
    location = { name: (l.name as string).trim(), state: (l.state as string).toUpperCase(), ibgeId: l.ibgeId as number };
  }

  const newsCategory = category === 'news' && typeof body.newsCategory === 'string' && body.newsCategory.trim()
    ? body.newsCategory.trim().slice(0, 60)
    : null;

  return {
    ok: true,
    post: {
      category,
      text,
      headline: category === 'news' ? headline : '',
      sourceUrl,
      newsCategory,
      media: midia.media,
      youtubeVideoId,
      allowReposts: body.allowReposts !== false,
      replyPermission,
      location,
      sensitive: Boolean(body.sensitive) && midia.media.length > 0,
      federation,
    },
  };
}

// ───────────────────────── Perfil ─────────────────────────

export type OfficialProfilePatch = {
  name?: string;
  bio?: string;
  avatarUrl?: string;
  coverImageUrl?: string;
  website?: string;
  location?: string;
};

export type OfficialProfileResult = { ok: true; patch: OfficialProfilePatch } | { ok: false; error: 'imagem-nao-federavel' | 'site-invalido'; detail: string };

// Mesmo critério de `imagemDePerfil` (render.ts): arquivo estático do próprio site, só imagem, fora de /api, /m e /mp.
const ARQUIVO_ESTATICO = /^\/(?!\/)(?!(?:api|m|mp)\/)(?!.*\.\.)[A-Za-z0-9._/-]{1,200}\.(?:png|jpe?g|webp|gif)$/;

/** Esta imagem de perfil aparece nas outras instâncias? (mídia pública da casa ou arquivo estático do site) */
export function isFederableProfileImage(url: string, ctx: OfficialPostContext): boolean {
  return isOwnPublicMedia(url, ctx.mediaOrigin) || ARQUIVO_ESTATICO.test(url);
}

/**
 * O PATCH do perfil. Avatar e capa que o Fediverso não consegue buscar eram aceitos e simplesmente não apareciam lá (a foto
 * oficial sumia nas outras instâncias sem erro nenhum): agora a recusa diz o motivo. Vazio apaga a imagem.
 */
export function parseOfficialProfilePatch(body: Record<string, unknown>, ctx: OfficialPostContext): OfficialProfileResult {
  const patch: OfficialProfilePatch = {};
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 80);
  if (typeof body.bio === 'string') patch.bio = body.bio.trim().slice(0, 500);
  for (const campo of ['avatarUrl', 'coverImageUrl'] as const) {
    const valor = body[campo];
    if (typeof valor !== 'string') continue;
    // O avatar de partida antigo apontava para um arquivo que nunca existiu: troca pelo que existe.
    const url = valor.trim() === OFFICIAL_BROKEN_AVATAR ? OFFICIAL_DEFAULT_AVATAR : valor.trim();
    if (url && !isFederableProfileImage(url, ctx)) {
      return { ok: false, error: 'imagem-nao-federavel', detail: `${campo} precisa ser da mídia pública da casa (${semBarra(ctx.mediaOrigin)}/m/…) ou um arquivo do site (ex.: ${OFFICIAL_DEFAULT_AVATAR}); outro endereço não aparece no Fediverso` };
    }
    patch[campo] = url;
  }
  if (typeof body.website === 'string') {
    const site = body.website.trim().slice(0, 200);
    if (site && !isHttpsUrl(site, 200)) return { ok: false, error: 'site-invalido', detail: 'website deve ser um endereço https:// válido' };
    patch.website = site;
  }
  if (typeof body.location === 'string') patch.location = body.location.trim().slice(0, 100);
  return { ok: true, patch };
}
