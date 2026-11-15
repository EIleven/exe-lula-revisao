// src/lib/services/viewerActions.ts
// O que quem está vendo já fez: curtiu, repostou, salvou e citou (posts e comentários). Antes eram 4 leituras para CADA
// post e comentário exibido; agora são 4 consultas por sessão (as 200 ações mais recentes de cada tipo), válidas por
// 30 minutos e atualizadas na hora quando a própria pessoa age nesta aba (markViewerAction). Ações antigas, fora das
// 200 mais recentes, podem aparecer como não feitas até a pessoa interagir de novo.
// Chaves: post -> "{postId}"; comentário -> "{postId}/{commentId}"; item salvo -> id do post ou do comentário.
import { db } from '@/lib/firebase';
import { collection, collectionGroup, getDocs, limit, orderBy, query, where } from 'firebase/firestore';

export type ViewerActionKind = 'like' | 'repost' | 'bookmark' | 'quote';
export type ViewerActions = Record<ViewerActionKind, Set<string>>;

const RECENT_PER_KIND = 200;
const TTL_MS = 30 * 60 * 1000;
let cached: { viewerId: string; at: number; value: Promise<ViewerActions> } | null = null;

const keyFromMarkerPath = (path: string): string | null => {
  const parts = path.split('/');
  if (parts.length === 4) return parts[1]; // posts/{p}/likes|reposts/{uid}
  if (parts.length === 6) return `${parts[1]}/${parts[3]}`; // posts/{p}/comments/{c}/likes|reposts/{uid}
  return null;
};

async function loadViewerActions(viewerId: string): Promise<ViewerActions> {
  const [likes, reposts, bookmarks, quotes] = await Promise.all([
    getDocs(query(collectionGroup(db, 'likes'), where('userId', '==', viewerId), orderBy('createdAt', 'desc'), limit(RECENT_PER_KIND))),
    getDocs(query(collectionGroup(db, 'reposts'), where('userId', '==', viewerId), orderBy('createdAt', 'desc'), limit(RECENT_PER_KIND))),
    getDocs(query(collection(db, 'users', viewerId, 'bookmarks'), orderBy('createdAt', 'desc'), limit(RECENT_PER_KIND))),
    getDocs(query(collection(db, 'posts'), where('isDeleted', '==', false), where('type', '==', 'quote'), where('userId', '==', viewerId), orderBy('createdAt', 'desc'), limit(RECENT_PER_KIND))),
  ]);
  const actions: ViewerActions = { like: new Set(), repost: new Set(), bookmark: new Set(), quote: new Set() };
  likes.forEach((snap) => { const key = keyFromMarkerPath(snap.ref.path); if (key) actions.like.add(key); });
  reposts.forEach((snap) => { const key = keyFromMarkerPath(snap.ref.path); if (key) actions.repost.add(key); });
  bookmarks.forEach((snap) => actions.bookmark.add(snap.id));
  quotes.forEach((snap) => {
    const data = snap.data();
    if (typeof data.quotedCommentId === 'string') actions.quote.add(data.quotedCommentId);
    else if (typeof data.originalPostDetails?.id === 'string') actions.quote.add(data.originalPostDetails.id);
  });
  return actions;
}

const EMPTY: ViewerActions = { like: new Set(), repost: new Set(), bookmark: new Set(), quote: new Set() };

/** Ações de quem vê (vazio se a consulta falhar: melhor um ícone apagado do que um post que não carrega). */
export async function getViewerActions(viewerId: string): Promise<ViewerActions> {
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

/** Registra na hora o que a pessoa acabou de fazer (curtir, desfazer...), para as próximas telas já mostrarem. */
export function markViewerAction(viewerId: string, kind: ViewerActionKind, key: string, done: boolean): void {
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
