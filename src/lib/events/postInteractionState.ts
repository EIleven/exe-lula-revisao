export const POST_INTERACTION_EVENT = 'soberan:post-interaction';
export const COMMENT_INTERACTION_EVENT = 'soberan:comment-interaction';

export interface PostInteractionPatch {
  isLiked?: boolean;
  likes?: number;
  isReposted?: boolean;
  reposts?: number;
  isBookmarked?: boolean;
  isQuotedByCurrentUser?: boolean;
  quotesCount?: number;
  commentsCount?: number;
}

export interface CommentInteractionPatch {
  isLiked?: boolean;
  likes?: number;
  isReposted?: boolean;
  repostsCount?: number;
  isBookmarked?: boolean;
  isQuotedByCurrentUser?: boolean;
  repliesCount?: number;
}

export interface PostInteractionEventDetail {
  viewerId: string;
  postId: string;
  patch: PostInteractionPatch;
}

export interface CommentInteractionEventDetail {
  viewerId: string;
  commentId: string;
  patch: CommentInteractionPatch;
}

const postCache = new Map<string, { patch: PostInteractionPatch; at: number }>();
const commentCache = new Map<string, CommentInteractionPatch>();

/**
 * Os números (curtidas, reposts, citações, comentários) que a pessoa viu ao interagir só valem por pouco tempo: depois disso o
 * servidor já os atualizou, e reaplicar o número guardado fazia o cartão voltar a mostrar uma contagem velha ao remontar. Os
 * marcadores DA PESSOA (curtiu, repostou, salvou) não envelhecem: são dela, e o servidor só os confirma.
 */
export const CACHED_COUNT_TTL_MS = 60_000;
const COUNT_KEYS = ['likes', 'reposts', 'quotesCount', 'commentsCount'] as const;

export function getCachedPostInteraction(
  viewerId: string | null | undefined,
  postId: string | null | undefined,
  now: number = Date.now()
): PostInteractionPatch | undefined {
  if (!viewerId || !postId) return undefined;
  const hit = postCache.get(`${viewerId}:${postId}`);
  if (!hit) return undefined;
  if (now - hit.at <= CACHED_COUNT_TTL_MS) return hit.patch;
  const semNumeros: PostInteractionPatch = { ...hit.patch };
  for (const k of COUNT_KEYS) delete semNumeros[k];
  return semNumeros;
}

export function dispatchPostInteraction(
  viewerId: string | null | undefined,
  postId: string | null | undefined,
  patch: PostInteractionPatch
): void {
  if (!viewerId || !postId) return;
  const key = `${viewerId}:${postId}`;
  const prev = postCache.get(key)?.patch || {};
  postCache.set(key, { patch: { ...prev, ...patch }, at: Date.now() });
  if (typeof window !== 'undefined') {
    // O evento leva SÓ o que mudou agora: quem já está na tela tem o resto. Antes ia o acumulado, e um número velho de uma
    // interação anterior (curtidas = 6) sobrescrevia o atual quando a pessoa repostava depois.
    window.dispatchEvent(
      new CustomEvent<PostInteractionEventDetail>(POST_INTERACTION_EVENT, {
        detail: { viewerId, postId, patch },
      })
    );
  }
}

export function getCachedCommentInteraction(
  viewerId: string | null | undefined,
  commentId: string | null | undefined
): CommentInteractionPatch | undefined {
  if (!viewerId || !commentId) return undefined;
  return commentCache.get(`${viewerId}:${commentId}`);
}

export function dispatchCommentInteraction(
  viewerId: string | null | undefined,
  commentId: string | null | undefined,
  patch: CommentInteractionPatch
): void {
  if (!viewerId || !commentId) return;
  const key = `${viewerId}:${commentId}`;
  const prev = commentCache.get(key) || {};
  const merged = { ...prev, ...patch };
  commentCache.set(key, merged);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<CommentInteractionEventDetail>(COMMENT_INTERACTION_EVENT, {
        detail: { viewerId, commentId, patch: merged },
      })
    );
  }
}

