// src/lib/media/mediaId.ts
// Núcleo das URLs próprias de mídia. Lógica pura, sem Firebase e sem Next, para o `npm run e2e:midia` exercitar
// tudo — inclusive as tentativas de sair do bucket — sem app nem emuladores.
//
// A decisão que sustenta o desenho: a URL pública **nunca** contém um caminho de armazenamento. Ela contém um
// identificador opaco que só o nosso banco sabe traduzir. Se a URL contivesse o caminho, bastaria trocá-lo para ler
// qualquer objeto do bucket — seria um open proxy. Ver docs/arquitetura-midia.md.

/** Alfabeto base64url, sem padding: seguro em URL e sem caractere que precise de escape. */
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * 22 caracteres de base64url são ~132 bits. Isso não é só "comprido": o id é a única barreira entre quem adivinha e
 * o objeto, então precisa ser inviável de enumerar. Com 132 bits, tentar adivinhar não é um ataque, é um desperdício.
 */
export const MEDIA_ID_LENGTH = 22;

const ID_VALIDO = /^[A-Za-z0-9_-]{22}$/;

/** Gera um id novo. Usa o gerador criptográfico da plataforma — `Math.random` seria adivinhável. */
export function generateMediaId(random: Crypto = globalThis.crypto): string {
  const bytes = new Uint8Array(MEDIA_ID_LENGTH);
  random.getRandomValues(bytes);
  let id = '';
  for (const byte of bytes) id += ALFABETO[byte % ALFABETO.length];
  return id;
}

/**
 * Aceita somente o formato exato. É aqui que morrem `../`, caminho com barra, string vazia, id longo demais e
 * qualquer tentativa de injetar caminho pela URL.
 */
export function isValidMediaId(id: string | null | undefined): boolean {
  return typeof id === 'string' && ID_VALIDO.test(id);
}

/** Tipos de mídia que a plataforma conhece. */
export type MediaKind = 'postMedia' | 'avatar' | 'cover' | 'dm' | 'userFile';

/**
 * Os ÚNICOS tipos que podem ter URL pública. Anexo de mensagem (`dm`) e arquivo pessoal (`userFile`) ficam de fora
 * de propósito e para sempre: eles são servidos por `/mp/<id>`, que refaz a autorização a cada requisição.
 *
 * Hoje, antes desta camada, os dois recebiam `getDownloadURL()` e portanto JÁ eram URL pública portadora de token.
 * Esta lista é o que corrige isso.
 */
export const PUBLIC_KINDS: readonly MediaKind[] = ['postMedia', 'avatar', 'cover'];

export function canBePublic(kind: MediaKind): boolean {
  return PUBLIC_KINDS.includes(kind);
}

/** A visibilidade que o tipo deve receber ao ser gravado. Nunca confie num valor vindo do cliente. */
export function visibilityForKind(kind: MediaKind): 'public' | 'private' {
  return canBePublic(kind) ? 'public' : 'private';
}

/** Caminho público, relativo. `origin` é o domínio de mídia; sem ele não se monta URL absoluta. */
export function mediaPath(id: string): string {
  return `/m/${id}`;
}

export function publicMediaUrl(id: string, mediaOrigin: string): string {
  return new URL(mediaPath(id), mediaOrigin).href;
}

/**
 * Cabeçalho de cache. Uma hora na borda é escolha, não padrão: `immutable` seguiria servindo objeto apagado por
 * muito tempo, o que contradiz a exigência de exclusão; cache curto encarece. Ver a nota em
 * docs/arquitetura-midia.md, e o prazo precisa estar dito ao usuário.
 */
export const MEDIA_CACHE_CONTROL = 'public, max-age=3600, s-maxage=3600';

export type RangeResult =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'unsatisfiable' };

/**
 * Interpreta `Range`. Segue o que a especificação manda, e a diferença importa:
 *
 * - cabeçalho ausente ou **malformado** → servir o conteúdo inteiro (200). A especificação diz para IGNORAR Range
 *   que não se entende, não para dar erro.
 * - faixa que começa além do fim → **416**, porque aí o pedido é entendível e impossível.
 * - várias faixas (`bytes=0-1,5-6`) → servimos inteiro. Resposta multipart não vale a complexidade aqui.
 */
export function parseRange(header: string | null | undefined, size: number): RangeResult {
  if (!header || size <= 0) return { kind: 'full' };

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return { kind: 'full' };

  const [, cruA, cruB] = match;
  if (cruA === '' && cruB === '') return { kind: 'full' };

  // `bytes=-500`: os últimos 500 bytes.
  if (cruA === '') {
    const pedido = Number(cruB);
    if (!Number.isFinite(pedido) || pedido <= 0) return { kind: 'full' };
    const start = Math.max(0, size - pedido);
    return { kind: 'partial', start, end: size - 1 };
  }

  const start = Number(cruA);
  if (!Number.isFinite(start) || start < 0) return { kind: 'full' };
  if (start >= size) return { kind: 'unsatisfiable' };

  // `bytes=100-`: do 100 até o fim.
  if (cruB === '') return { kind: 'partial', start, end: size - 1 };

  const pedidoFim = Number(cruB);
  if (!Number.isFinite(pedidoFim) || pedidoFim < start) return { kind: 'full' };
  return { kind: 'partial', start, end: Math.min(pedidoFim, size - 1) };
}

/** Quantos bytes a resposta leva. */
export function rangeLength(range: RangeResult, size: number): number {
  return range.kind === 'partial' ? range.end - range.start + 1 : size;
}

/**
 * Descobre o tipo a partir do caminho que as fábricas geram em `mediaUploadService`. Existe para a camada de mídia
 * não exigir mudança em nenhuma chamada de upload existente: o tipo já está no caminho, só não estava sendo lido.
 *
 * Desconhecido vira `userFile`, que é o tipo PRIVADO — na dúvida, não publicar.
 */
export function kindFromPath(storagePath: string): MediaKind {
  const caminho = storagePath ?? '';
  if (caminho.includes('/postMedia/')) return 'postMedia';
  if (caminho.includes('/avatars/')) return 'avatar';
  if (caminho.includes('/covers/')) return 'cover';
  if (caminho.includes('/dms/')) return 'dm';
  return 'userFile';
}

/**
 * Caminho da midia PRIVADA. Relativo de proposito: ela e servida pelo dominio principal, onde o cookie de sessao
 * existe, e nunca por media.exercitodolula.app, que serve conteudo publico com CORS aberto.
 */
export function privateMediaPath(id: string): string {
  return `/mp/${id}`;
}

/**
 * O MESMO padrão que `functions/src/mediaAccess.ts` usa. A duplicação é deliberada — são pacotes diferentes, com
 * `node_modules` e build próprios — e é o teste que garante que não divergem. Se divergirem, as Functions deixam de
 * achar a mídia de um post apagado e o inventário deixa de ver referências vivas.
 *
 * O segmento é capturado para distinguir `/m/` (pública) de `/mp/` (privada): são rotas com regras opostas, e
 * confundi-las no inventário classificaria mídia privada como pública.
 */
const URL_PROPRIA = /\/(m|mp)\/([A-Za-z0-9_-]{22})(?:[?#]|$)/;

/**
 * Lê o id de uma URL própria. Devolve `null` para qualquer outra coisa — inclusive para a URL antiga do Firebase,
 * que não tem `/m/` nem `/mp/`, e para `/mp/<id>/qualquer-coisa`, que não é URL nossa.
 */
export function mediaIdFromUrl(
  value: string | null | undefined,
): { id: string; visibility: 'public' | 'private' } | null {
  const achado = URL_PROPRIA.exec(value ?? '');
  if (!achado) return null;
  return { id: achado[2], visibility: achado[1] === 'm' ? 'public' : 'private' };
}

/**
 * Caminho de armazenamento aceitável. Vale para validar `media/{id}.storagePath` lido do banco: um registro cujo
 * caminho não tem esta forma não serve nada, e contá-lo como "objeto registrado" esconderia um registro quebrado.
 *
 * O limite de 500 e a exigência de `user_uploads/<uid>/` são os mesmos de `firestore.rules`.
 */
export function isValidStoragePath(path: string | null | undefined): boolean {
  if (typeof path !== 'string' || path.length === 0 || path.length > 500) return false;
  if (path.includes('..') || path.includes('//')) return false;
  return /^user_uploads\/[^/]+\/[^/].*[^/]$/.test(path);
}
