// src/lib/media/videoQueue.ts
// A FILA do teatro de vídeo do HiperVerso (modo imersivo): quais vídeos entram, por onde começa, para onde ↑/↓ andam e quais
// ficam montados. PURO (sem React nem DOM): e2e/video-playback-check.mjs prova cada regra.
//
// A fila é a lista que a pessoa estava vendo (o feed ou a aba Mídia do perfil), já carregada: cada vídeo de cada post vira uma
// entrada. Posts apagados e posts com aviso de conteúdo sensível ficam de FORA (no cartão eles aparecem borrados até a pessoa
// tocar; o teatro não pode exibi-los sozinho, de tela cheia e tocando).

export type QueueMedia = { type?: string | null; url?: unknown };

export type QueuePost = {
  id?: string | null;
  isDeleted?: boolean;
  sensitive?: boolean;
  media?: readonly QueueMedia[] | null;
};

export type QueueEntry<P extends QueuePost = QueuePost> = {
  /** `${post.id}:${índice da mídia}`: único na fila. */
  key: string;
  postId: string;
  mediaIndex: number;
  url: string;
  mediaType?: 'video' | 'image';
  post: P;
};

export const QUEUE_MAX_ENTRIES = 200;
export const QUEUE_MEMORY_TTL_MS = 30 * 60_000;
const MAX_URL_LENGTH = 2048;
const URL_OK = /^(?:https?:\/\/|\/(?!\/))/i;

/** O endereço do arquivo sem `?` nem `#` (o mesmo vídeo pode vir com token ou versão diferente). */
export function urlBase(url: unknown): string {
  return typeof url === 'string' ? url.split('#')[0].split('?')[0] : '';
}

/** Um vídeo por entrada, na ordem da lista; sem apagados, sem sensíveis, sem endereço inválido, sem repetição, até 200. */
export function buildVideoQueue<P extends QueuePost>(posts: readonly (P | null | undefined)[] | null | undefined): QueueEntry<P>[] {
  const entries: QueueEntry<P>[] = [];
  if (!Array.isArray(posts)) return entries;
  const vistos = new Set<string>();
  for (const post of posts) {
    if (!post || typeof post.id !== 'string' || post.id === '' || post.isDeleted === true || post.sensitive === true) continue;
    const media: readonly QueueMedia[] = Array.isArray(post.media) ? post.media : [];
    media.forEach((item, mediaIndex) => {
      if (entries.length >= QUEUE_MAX_ENTRIES) return;
      if (!item || item.type !== 'video' || typeof item.url !== 'string' || item.url.length === 0 || item.url.length > MAX_URL_LENGTH || !URL_OK.test(item.url)) return;
      const key = `${post.id}:${mediaIndex}`;
      if (vistos.has(key)) return;
      vistos.add(key);
      entries.push({ key, postId: post.id as string, mediaIndex, url: item.url, mediaType: 'video', post });
    });
  }
  return entries;
}

/** Fila mista (vídeos e imagens) para paginação contínua no modo imersivo. */
export function buildMixedMediaQueue<P extends QueuePost>(posts: readonly (P | null | undefined)[] | null | undefined): QueueEntry<P>[] {
  const entries: QueueEntry<P>[] = [];
  if (!Array.isArray(posts)) return entries;
  const vistos = new Set<string>();
  for (const post of posts) {
    if (!post || typeof post.id !== 'string' || post.id === '' || post.isDeleted === true || post.sensitive === true) continue;
    const media: readonly QueueMedia[] = Array.isArray(post.media) ? post.media : [];
    media.forEach((item, mediaIndex) => {
      if (entries.length >= QUEUE_MAX_ENTRIES) return;
      if (!item || (item.type !== 'video' && item.type !== 'image') || typeof item.url !== 'string' || item.url.length === 0 || item.url.length > MAX_URL_LENGTH || !URL_OK.test(item.url)) return;
      const key = `${post.id}:${mediaIndex}`;
      if (vistos.has(key)) return;
      vistos.add(key);
      entries.push({ key, postId: post.id as string, mediaIndex, url: item.url, mediaType: item.type, post });
    });
  }
  return entries;
}

/** Onde a fila começa: o vídeo exato (post + arquivo), senão o primeiro vídeo do post, senão -1. */
export function findStartIndex(entries: readonly QueueEntry[], postId: string | null | undefined, mediaUrl?: unknown): number {
  if (!postId) return -1;
  if (mediaUrl !== undefined && mediaUrl !== null) {
    const base = urlBase(mediaUrl);
    const exato = entries.findIndex((e) => e.postId === postId && urlBase(e.url) === base);
    if (exato >= 0) return exato;
  }
  return entries.findIndex((e) => e.postId === postId);
}

/** Anda `delta` posições sem dar a volta (no primeiro/último fica onde está). Fila vazia → 0. */
export function stepIndex(atual: number, delta: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const base = Number.isFinite(atual) ? Math.trunc(atual) : 0;
  const passo = Number.isFinite(delta) ? Math.trunc(delta) : 0;
  return Math.min(total - 1, Math.max(0, base + passo));
}

/** Os índices que ficam com o <video> montado: o ativo e `raio` vizinhos de cada lado (o resto vira espaço vazio). */
export function windowIndexes(ativo: number, total: number, raio = 1): Set<number> {
  const janela = new Set<number>();
  if (!Number.isFinite(total) || total <= 0) return janela;
  const centro = Math.min(total - 1, Math.max(0, Number.isFinite(ativo) ? Math.trunc(ativo) : 0));
  const r = Number.isFinite(raio) ? Math.max(0, Math.trunc(raio)) : 1;
  for (let i = Math.max(0, centro - r); i <= Math.min(total - 1, centro + r); i++) janela.add(i);
  return janela;
}

/** Contador curto para os ícones: 999 · 1,2 mil · 15 mil · 1,3 mi. Inválido ou negativo vira 0. */
export function compactCount(valor: unknown): string {
  const n = typeof valor === 'number' && Number.isFinite(valor) && valor > 0 ? Math.floor(valor) : 0;
  if (n < 1000) return String(n);
  // Décimos em aritmética inteira (sem 1.1 * 10 = 11.000000000000002).
  const decimos = (d: number) => String(d / 10).replace('.', ',');
  if (n < 10_000) return `${decimos(Math.floor(n / 100))} mil`;
  if (n < 1_000_000) return `${Math.floor(n / 1000)} mil`;
  return `${decimos(Math.floor(n / 100_000))} mi`;
}

/** Tooltip com o número exato formatado quando o contador está compactado (>= 1000). */
export function exactCountTitle(valor: unknown): string | undefined {
  const n = typeof valor === 'number' && Number.isFinite(valor) && valor >= 1000 ? Math.floor(valor) : 0;
  return n >= 1000 ? n.toLocaleString('pt-BR') : undefined;
}

/**
 * A lista de onde a pessoa saiu (feed → página do post): quando ela abre o teatro na página do post, a fila é essa lista, não só o
 * post. Só vale se o post estiver nela e por 30 min; senão a fila é o próprio post.
 */
export function createQueueMemory(now: () => number = () => Date.now()) {
  let guardada: { context: string; posts: readonly QueuePost[]; at: number } | null = null;
  return {
    remember(context: string, posts: readonly QueuePost[] | null | undefined): void {
      if (!Array.isArray(posts) || posts.length === 0) {
        guardada = null;
        return;
      }
      guardada = { context, posts, at: now() };
    },
    recall<P extends QueuePost = QueuePost>(postId: string | null | undefined): { context: string; posts: readonly P[] } | null {
      if (!guardada || !postId) return null;
      if (now() - guardada.at > QUEUE_MEMORY_TTL_MS) {
        guardada = null;
        return null;
      }
      if (!guardada.posts.some((p) => p && p.id === postId)) return null;
      return { context: guardada.context, posts: guardada.posts as readonly P[] };
    },
    clear(): void {
      guardada = null;
    },
  };
}

export const videoQueueMemory = createQueueMemory();
