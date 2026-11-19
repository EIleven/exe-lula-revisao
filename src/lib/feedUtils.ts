import type { Comment, Post } from '@/lib/types';

export type FeedItem = Post | Comment;

/**
 * Identidade do conteúdo no feed. Um repost continua sendo o mesmo conteúdo do post/comentário original; usar o id do
 * marcador faria o mesmo conteúdo aparecer de novo em outra página ou depois de restaurar o cache.
 */
export function getFeedContentKey(item: FeedItem): string {
  if ('parentPostId' in item) return `comment:${item.parentPostId}/${item.id}`;
  if (item.repostedComment) {
    return `comment:${item.repostedComment.parentPostId}/${item.repostedComment.id}`;
  }
  // O mesmo post do Fediverso pode existir com dois ids locais (um criado pelo inbox, pelo id ActivityPub, e outro pelo
  // sincronismo de perfil, pela URL da página). A página (`remoteUrl`) é a mesma nos dois: ela identifica o conteúdo.
  if (item.isRemoteFediverse && item.remoteUrl) return `remote:${item.remoteUrl}`;
  return `post:${item.id}`;
}

/** Mantém a primeira ocorrência, pois os feeds já chegam da atividade mais nova para a mais antiga. */
export function uniqueFeedItems<T extends FeedItem>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getFeedContentKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const toMillis = (value: unknown): number => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' || value instanceof Date) {
    const millis = new Date(value).getTime();
    return Number.isFinite(millis) ? millis : 0;
  }
  if (typeof value === 'object' && value !== null) {
    const timestamp = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis();
    if (typeof timestamp.seconds === 'number') {
      return timestamp.seconds * 1000 + Math.floor((timestamp.nanoseconds ?? 0) / 1_000_000);
    }
  }
  return 0;
};

/** Reposts são ordenados pelo momento do repost, não pela publicação original. */
export function getFeedActivityMillis(item: FeedItem): number {
  const repostedAt = 'repostedAt' in item ? item.repostedAt : undefined;
  return toMillis(repostedAt) || toMillis(item.createdAt);
}

/**
 * Ordena itens do feed pela atividade mais recente (`repostedAt || createdAt`) e remove duplicatas
 * mantendo sempre a ocorrência mais recente de cada conteúdo.
 */
export function sortAndDedupeFeedItems<T extends FeedItem>(items: T[]): T[] {
  if (items.length <= 1) return uniqueFeedItems(items);
  const sorted = [...items].sort((a, b) => getFeedActivityMillis(b) - getFeedActivityMillis(a));
  return uniqueFeedItems(sorted);
}
