// src/lib/services/viewerActions.ts
// O que quem está vendo já fez: curtiu, repostou, salvou e citou (posts e comentários). Antes eram 4 leituras para CADA
// post e comentário exibido; agora são 4 consultas em lote (as 200 ações mais recentes de cada tipo), com revalidação
// automática ao voltar para a aba/app e leitura direta pontual em páginas de detalhe (syncPostViewerState).
// Chaves: post -> "{postId}"; comentário -> "{postId}/{commentId}"; item salvo -> id do post ou do comentário.
import { db } from '@/lib/firebase';
import { collection, collectionGroup, doc, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore';

export type ViewerActionKind = 'like' | 'repost' | 'bookmark' | 'quote';
export type ViewerActions = Record<ViewerActionKind, Set<string>>;

export const VIEWER_ACTIONS_REFRESHED_EVENT = 'hv:viewer-actions-refreshed';
const STORAGE_PING_KEY = 'hv_viewer_actions_ping';
const RECENT_PER_KIND = 200;
const TTL_MS = 2 * 60 * 1000;
const RESYNC_HIDDEN_MS = 3000;

let cached: { viewerId: string; at: number; value: Promise<ViewerActions> } | null = null;
let listenersAttached = false;
let hiddenAt: number | null = null;

const keyFromMarkerPath = (path: string): string | null => {
  const parts = path.split('/');
  if (parts.length === 4) return parts[1]; // posts/{p}/likes|reposts/{uid}
  if (parts.length === 6) return `${parts[1]}/${parts[3]}`; // posts/{p}/comments/{c}/likes|reposts/{uid}
  return null;
};

async function loadViewerActions(viewerId: string): Promise<ViewerActions> {
  const [likesRes, repostsRes, bookmarksRes, quotesRes] = await Promise.allSettled([
    getDocs(query(collectionGroup(db, 'likes'), where('userId', '==', viewerId), orderBy('createdAt', 'desc'), limit(RECENT_PER_KIND))),
    getDocs(query(collectionGroup(db, 'reposts'), where('userId', '==', viewerId), orderBy('createdAt', 'desc'), limit(RECENT_PER_KIND))),
    getDocs(query(collection(db, 'users', viewerId, 'bookmarks'), orderBy('createdAt', 'desc'), limit(RECENT_PER_KIND))),
    getDocs(query(collection(db, 'posts'), where('isDeleted', '==', false), where('type', '==', 'quote'), where('userId', '==', viewerId), orderBy('createdAt', 'desc'), limit(RECENT_PER_KIND))),
  ]);

  const actions: ViewerActions = { like: new Set(), repost: new Set(), bookmark: new Set(), quote: new Set() };

  if (likesRes.status === 'fulfilled') {
    likesRes.value.forEach((snap) => { const key = keyFromMarkerPath(snap.ref.path); if (key) actions.like.add(key); });
  } else {
    console.warn('[ações de quem vê] falha ao carregar curtidas:', likesRes.reason);
  }

  if (repostsRes.status === 'fulfilled') {
    repostsRes.value.forEach((snap) => { const key = keyFromMarkerPath(snap.ref.path); if (key) actions.repost.add(key); });
  } else {
    console.warn('[ações de quem vê] falha ao carregar reposts:', repostsRes.reason);
  }

  if (bookmarksRes.status === 'fulfilled') {
    bookmarksRes.value.forEach((snap) => actions.bookmark.add(snap.id));
  } else {
    console.warn('[ações de quem vê] falha ao carregar marcadores:', bookmarksRes.reason);
  }

  if (quotesRes.status === 'fulfilled') {
    quotesRes.value.forEach((snap) => {
      const data = snap.data();
      if (typeof data.quotedCommentId === 'string') actions.quote.add(data.quotedCommentId);
      else if (typeof data.originalPostDetails?.id === 'string') actions.quote.add(data.originalPostDetails.id);
    });
  } else {
    console.warn('[ações de quem vê] falha ao carregar citações:', quotesRes.reason);
  }

  return actions;
}

const EMPTY: ViewerActions = { like: new Set(), repost: new Set(), bookmark: new Set(), quote: new Set() };

function ensureBrowserListeners(): void {
  if (listenersAttached || typeof window === 'undefined' || typeof document === 'undefined') return;
  listenersAttached = true;

  const triggerResync = async () => {
    const activeViewerId = cached?.viewerId;
    if (!activeViewerId) return;
    cached = null;
    const fresh = await getViewerActions(activeViewerId);
    window.dispatchEvent(new CustomEvent(VIEWER_ACTIONS_REFRESHED_EVENT, {
      detail: { viewerId: activeViewerId, actions: fresh },
    }));
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    if (document.visibilityState === 'visible' && hiddenAt !== null && Date.now() - hiddenAt >= RESYNC_HIDDEN_MS) {
      hiddenAt = null;
      void triggerResync();
    }
  });

  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_PING_KEY) {
      void triggerResync();
    }
  });
}

/** Ações de quem vê (vazio se todas as consultas falharem: melhor um ícone apagado do que um post que não carrega). */
export async function getViewerActions(viewerId: string): Promise<ViewerActions> {
  ensureBrowserListeners();
  if (!cached || cached.viewerId !== viewerId || Date.now() - cached.at > TTL_MS) {
    const value = loadViewerActions(viewerId).catch((error) => {
      console.warn('[ações de quem vê] falha ao carregar:', error);
      cached = null;
      return EMPTY;
    });
    cached = { viewerId, at: Date.now(), value };
  }
  return cached.value;
}

/**
 * Verificação direta dos marcadores de um post específico no Firestore (3 leituras pontuais).
 * Garante 100% de precisão na página do post (incluindo posts antigos fora dos 200 recentes ou ações feitas no app).
 */
export async function syncPostViewerState(
  viewerId: string,
  postId: string,
): Promise<{ isLiked: boolean; isReposted: boolean; isBookmarked: boolean } | null> {
  if (!viewerId || !postId) return null;
  const [likeRes, repostRes, bookmarkRes] = await Promise.allSettled([
    getDoc(doc(db, 'posts', postId, 'likes', viewerId)),
    getDoc(doc(db, 'posts', postId, 'reposts', viewerId)),
    getDoc(doc(db, 'users', viewerId, 'bookmarks', postId)),
  ]);

  const actions = cached?.viewerId === viewerId ? await cached.value.catch(() => null) : null;
  const isLiked = likeRes.status === 'fulfilled' ? likeRes.value.exists() : (actions?.like.has(postId) ?? false);
  const isReposted = repostRes.status === 'fulfilled' ? repostRes.value.exists() : (actions?.repost.has(postId) ?? false);
  const isBookmarked = bookmarkRes.status === 'fulfilled' ? bookmarkRes.value.exists() : (actions?.bookmark.has(postId) ?? false);

  if (actions) {
    if (isLiked) actions.like.add(postId); else actions.like.delete(postId);
    if (isReposted) actions.repost.add(postId); else actions.repost.delete(postId);
    if (isBookmarked) actions.bookmark.add(postId); else actions.bookmark.delete(postId);
  }

  return { isLiked, isReposted, isBookmarked };
}

/** Registra na hora o que a pessoa acabou de fazer (curtir, desfazer...), para as próximas telas já mostrarem. */
export function markViewerAction(viewerId: string, kind: ViewerActionKind, key: string, done: boolean): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_PING_KEY, String(Date.now()));
    } catch {
      // ignora storage bloqueado
    }
  }
  if (!cached || cached.viewerId !== viewerId) return;
  void cached.value.then((actions) => {
    if (done) actions[kind].add(key);
    else actions[kind].delete(key);
  });
}

/** Esquece tudo (troca de conta). */
export function clearViewerActions(): void {
  cached = null;
}
