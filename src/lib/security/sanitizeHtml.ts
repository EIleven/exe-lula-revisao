// src/lib/security/sanitizeHtml.ts
// Higienização do HTML de artigos (o editor TipTap e a extração de páginas externas geram HTML). Sem isso, qualquer
// pessoa publicava um "artigo" com <img onerror=...> ou <script> que rodava no navegador de quem lesse (XSS
// armazenado). A biblioteca trabalha sobre a string, então o resultado é o MESMO no servidor (SSR) e no navegador.
// Só passam as tags e atributos que o editor produz; CSS só sem posicionamento; iframe só do YouTube; links e mídia
// só com http(s) ou caminho relativo.
import xssLib from 'xss';
import type { FilterXSS as FilterXSSClass, IFilterXSSOptions } from 'xss';

// O pacote é CommonJS e pendura FilterXSS/escapeAttrValue na função exportada: o import padrão funciona no Next e no
// Node puro (usado pelo teste e2e/sanitize-html-check.mjs).
const { FilterXSS, escapeAttrValue } = xssLib as unknown as {
  FilterXSS: typeof FilterXSSClass;
  escapeAttrValue: (value: string) => string;
};

const TEXT_STYLE = ['style'];
const allowList: IFilterXSSOptions['whiteList'] = {
  p: TEXT_STYLE, div: ['data-youtube-video', 'class'], span: TEXT_STYLE, br: [], hr: [],
  h1: TEXT_STYLE, h2: TEXT_STYLE, h3: TEXT_STYLE, h4: TEXT_STYLE, h5: TEXT_STYLE, h6: TEXT_STYLE,
  strong: [], b: [], em: [], i: [], u: [], s: [], del: [], ins: [], mark: [], sub: [], sup: [], small: [],
  blockquote: TEXT_STYLE, q: [], cite: [], code: [], pre: [], kbd: [], abbr: ['title'], time: ['datetime'],
  ul: [], ol: ['start'], li: TEXT_STYLE,
  a: ['href', 'title', 'target', 'rel', 'style'],
  img: ['src', 'alt', 'title', 'width', 'height', 'data-text-align', 'loading'],
  figure: [], figcaption: [],
  video: ['src', 'controls', 'preload', 'poster', 'playsinline', 'width', 'height'],
  iframe: ['src', 'title', 'allow', 'allowfullscreen', 'frameborder', 'width', 'height'],
  table: [], thead: [], tbody: [], tfoot: [], tr: [], th: ['colspan', 'rowspan', 'scope'], td: ['colspan', 'rowspan'],
};

// CSS permitido: alinhamento e aparência de texto e caixas (o link de anexo do editor usa borda e espaçamento).
// Nada de position, z-index, transform, background ou tamanhos que permitam cobrir a interface.
const cssAllowList = {
  'text-align': /^(left|right|center|justify|start|end)$/i,
  'text-decoration': true,
  'font-weight': true,
  'font-style': true,
  display: /^(inline|inline-block|inline-flex|block|flex)$/i,
  'align-items': true,
  gap: true,
  padding: true,
  border: true,
  'border-radius': true,
  'margin-block': true,
};

// "/" só como caminho do próprio site: "//x" e "/\x" virariam endereço de outro site.
const SAFE_LINK = /^(https?:\/\/|mailto:|\/(?![/\\])|#)/i;
const SAFE_MEDIA = /^(https?:\/\/|\/(?![/\\]))/i;
const YOUTUBE_EMBED = /^https:\/\/www\.youtube(-nocookie)?\.com\/embed\/[A-Za-z0-9_-]{11}(\?[A-Za-z0-9_=&-]*)?$/;
const EXTERNAL_LINK_REL = 'noopener noreferrer nofollow ugc';

const attr = (name: string, value: string) => `${name}="${escapeAttrValue(value)}"`;

const filter = new FilterXSS({
  whiteList: allowList,
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style', 'noscript', 'template', 'object', 'embed', 'svg', 'math', 'form', 'textarea', 'select', 'button'],
  allowCommentTag: false,
  css: { whiteList: cssAllowList },
  onTagAttr(tag, name, value, isWhiteAttr) {
    if (!isWhiteAttr) return ''; // fora da lista: some
    const trimmed = value.trim();
    if (name === 'href' && tag === 'a') return SAFE_LINK.test(trimmed) ? attr('href', trimmed) : '';
    if (name === 'target' && tag === 'a') return `target="_blank" rel="${EXTERNAL_LINK_REL}"`;
    if (name === 'rel' && tag === 'a') return ''; // o rel seguro sai junto com o target
    if (tag === 'iframe' && name === 'src') return YOUTUBE_EMBED.test(trimmed) ? attr('src', trimmed) : 'src="about:blank"';
    if (name === 'src' || name === 'poster') return SAFE_MEDIA.test(trimmed) ? attr(name, trimmed) : '';
    if (tag === 'div' && name === 'class') return trimmed === 'youtube-embed' ? 'class="youtube-embed"' : '';
    if (name === 'data-text-align') return /^(left|center|right)$/.test(trimmed) ? attr(name, trimmed) : '';
    if (name === 'width' || name === 'height') return /^\d{1,4}(px|%)?$|^auto$/.test(trimmed) ? attr(name, trimmed) : '';
    return undefined; // o resto segue a lista de permitidos e o filtro de CSS padrão
  },
});

/** HTML de artigo seguro para dangerouslySetInnerHTML (servidor e navegador produzem o mesmo resultado). */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return '';
  return filter.process(html);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Texto puro de um HTML (para prévias e cartões): sem tags e com as entidades comuns decodificadas. */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>?/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
      const lower = entity.toLowerCase();
      if (lower in ENTITIES) return ENTITIES[lower];
      if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16) || 32);
      if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10) || 32);
      return match;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

/** JSON para <script type="application/ld+json">: escapa "<" (um "</script>" num título fechava a tag). */
export function safeJsonForScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .split(LINE_SEPARATOR).join('\\u2028')
    .split(PARAGRAPH_SEPARATOR).join('\\u2029');
}
