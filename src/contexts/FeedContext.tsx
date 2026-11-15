
"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Post, Comment } from '@/lib/types';
import { Timestamp as FirestoreTimestamp } from 'firebase/firestore';

// Interface for the state of a single feed
export interface FeedState {
  viewerKey: string | null;
  queryKey: string | null;
  posts: (Post | Comment)[];
  isLoading: boolean;
  isRefreshing: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  hasNewItems: boolean;
  error: Error | null;
  cursor: FirestoreTimestamp | null;
  newestPostTimestamp: FirestoreTimestamp | null;
  initialLoadDone: boolean;
}

// Initial state for a new feed
export const initialFeedState: FeedState = {
  viewerKey: null,
  queryKey: null,
  posts: [],
  isLoading: false, // Start as false, let the hook trigger the first load
  isRefreshing: false,
  isLoadingMore: false,
  hasMore: true,
  hasNewItems: false,
  error: null,
  cursor: null,
  newestPostTimestamp: null,
  initialLoadDone: false,
};

type Listener = () => void;
type FeedsState = { [feedId: string]: FeedState | undefined };

/**
 * Estado dos feeds, FORA do React. Antes ele morava num contexto: qualquer mudança (carregar mais posts, a posição de
 * rolagem que era gravada a cada pausa, o aviso de "novos posts") trocava o valor do contexto e REDESENHAVA todo componente
 * que o usava, isto é, cada cartão do feed (os ganchos de curtir e comentar leem `hidePost` dele). Agora:
 *  - as ações (`useFeedActions`) são um objeto fixo e não assinam nada;
 *  - cada leitura assina só o que mostra: um feed (`useFeedState`, `useFeedSelector`) ou o conjunto de posts escondidos;
 *  - a posição de rolagem é gravada sem avisar ninguém (ninguém a desenha).
 */
export class FeedStore {
  private feeds: FeedsState = {};
  private hidden: ReadonlySet<string> = new Set();
  private scroll = new Map<string, number>();
  private feedListeners = new Map<string, Set<Listener>>();
  private hiddenListeners = new Set<Listener>();

  getFeedState = (feedId: string): FeedState => this.feeds[feedId] ?? initialFeedState;

  setFeedState = (feedId: string, newState: Partial<FeedState>): void => {
    this.feeds = {
      ...this.feeds,
      [feedId]: { ...(this.feeds[feedId] ?? initialFeedState), ...newState },
    };
    this.emitFeed(feedId);
  };

  /** Posição de rolagem do feed (para voltar a ela ao trocar de aba). Gravar NÃO redesenha nada. */
  getScrollPosition = (feedId: string): number => this.scroll.get(feedId) ?? 0;
  saveScrollPosition = (feedId: string, scrollY: number): void => {
    this.scroll.set(feedId, scrollY);
  };

  removePostFromFeed = (postId: string): void => {
    let next: FeedsState | null = null;
    const touched: string[] = [];
    for (const feedId of Object.keys(this.feeds)) {
      const feed = this.feeds[feedId];
      if (!feed) continue;
      const index = feed.posts.findIndex((p) => (p as Post | Comment).id === postId);
      if (index < 0) continue;
      const posts = feed.posts.slice();
      posts.splice(index, 1);
      next = next ?? { ...this.feeds };
      next[feedId] = { ...feed, posts };
      touched.push(feedId);
    }
    if (!next) return;
    this.feeds = next;
    touched.forEach((feedId) => this.emitFeed(feedId));
  };

  hidePost = (postId: string): void => {
    const next = new Set(this.hidden);
    next.add(postId);
    this.hidden = next;
    try {
      sessionStorage.setItem('soberan_hidden_posts', JSON.stringify(Array.from(next)));
    } catch { /* sem sessionStorage: vale só até recarregar */ }
    this.hiddenListeners.forEach((listener) => listener());
  };

  getHidden = (): ReadonlySet<string> => this.hidden;

  /** Lê os posts escondidos da sessão (só no navegador, depois de montar). */
  loadHiddenFromSession = (): void => {
    try {
      const stored = sessionStorage.getItem('soberan_hidden_posts');
      if (!stored) return;
      this.hidden = new Set<string>(JSON.parse(stored));
      this.hiddenListeners.forEach((listener) => listener());
    } catch { /* valor inválido: ignora */ }
  };

  subscribeFeed = (feedId: string, listener: Listener): (() => void) => {
    let set = this.feedListeners.get(feedId);
    if (!set) {
      set = new Set();
      this.feedListeners.set(feedId, set);
    }
    set.add(listener);
    return () => { set!.delete(listener); };
  };

  subscribeHidden = (listener: Listener): (() => void) => {
    this.hiddenListeners.add(listener);
    return () => { this.hiddenListeners.delete(listener); };
  };

  private emitFeed(feedId: string): void {
    this.feedListeners.get(feedId)?.forEach((listener) => listener());
  }

  /** Ações que não mudam nunca (o mesmo objeto a vida toda): quem só as chama não é redesenhado por nada. */
  readonly actions = {
    getFeedState: this.getFeedState,
    setFeedState: this.setFeedState,
    getScrollPosition: this.getScrollPosition,
    saveScrollPosition: this.saveScrollPosition,
    removePostFromFeed: this.removePostFromFeed,
    hidePost: this.hidePost,
  };
}

const FeedStoreContext = createContext<FeedStore | undefined>(undefined);

function useStore(): FeedStore {
  const store = useContext(FeedStoreContext);
  if (!store) throw new Error('Os ganchos de feed precisam estar dentro de um FeedProvider');
  return store;
}

/** Ações do feed (obter/gravar estado, esconder post...). Objeto fixo: NÃO redesenha quem o usa. */
export const useFeedActions = () => useStore().actions;

/** O estado de UM feed. Redesenha só quando esse feed muda. */
export function useFeedState(feedId: string): FeedState {
  const store = useStore();
  const subscribe = useCallback((listener: Listener) => store.subscribeFeed(feedId, listener), [store, feedId]);
  return useSyncExternalStore(subscribe, () => store.getFeedState(feedId), () => initialFeedState);
}

/**
 * Um pedaço do estado de um feed. Redesenha só quando o valor escolhido muda (compare por `Object.is`: devolva um número,
 * texto, booleano ou um objeto que já exista no estado, nunca um novo a cada chamada).
 */
export function useFeedSelector<T>(feedId: string, select: (state: FeedState) => T): T {
  const store = useStore();
  const subscribe = useCallback((listener: Listener) => store.subscribeFeed(feedId, listener), [store, feedId]);
  return useSyncExternalStore(subscribe, () => select(store.getFeedState(feedId)), () => select(initialFeedState));
}

const NO_HIDDEN: ReadonlySet<string> = new Set();

/** Os posts que a pessoa escondeu nesta sessão. */
export function useHiddenPostIds(): ReadonlySet<string> {
  const store = useStore();
  return useSyncExternalStore(store.subscribeHidden, store.getHidden, () => NO_HIDDEN);
}

interface FeedProviderProps {
  children: ReactNode;
}

export const FeedProvider = ({ children }: FeedProviderProps) => {
  const storeRef = useRef<FeedStore>();
  if (!storeRef.current) storeRef.current = new FeedStore();
  const store = storeRef.current;

  // Posts escondidos da sessão: lidos uma vez, no navegador, depois de montar.
  useEffect(() => { store.loadHiddenFromSession(); }, [store]);

  return <FeedStoreContext.Provider value={store}>{children}</FeedStoreContext.Provider>;
};
