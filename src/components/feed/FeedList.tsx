
// src/components/feed/FeedList.tsx
'use client';

import React, { useEffect, useRef, useCallback, forwardRef, useImperativeHandle, Fragment, useMemo } from 'react';
import type { Post, Comment } from '@/lib/types';
import PostCard from './PostCard';
import { siteConfig } from '@/config/site';
import CommentCard from './CommentCard';
import { useInfiniteFeed } from '@/hooks/features/feed/useInfiniteFeed';
import { fetchPaginatedPosts, type PaginatedPostsOptions } from '@/lib/services/postReadService'; 
import { Loader2, AlertTriangle, Frown, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Timestamp as FirestoreTimestamp } from 'firebase/firestore';
import { useHiddenPostIds } from '@/contexts/FeedContext';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { detectLikelyLanguage } from '@/lib/i18n/detectLanguage';
import PostCardSkeleton from './PostCardSkeleton';
import { VideoQueueContext, type VideoQueueSource } from '@/contexts/VideoQueueContext';

export interface FeedListHandle {
  resetFeed: () => Promise<void>;
  getNewestPostTimestamp: () => FirestoreTimestamp | null;
}

interface FeedListProps {
  feedId?: string; // Made optional for static lists
  onPostDeleted?: (postId: string) => void;
  onPostCreated?: (newPost: Post) => void;
  feedContextOptions?: PaginatedPostsOptions; 
  newPostToPrepend?: Post | Comment | null; 
  onPostPrepended?: () => void;
  onPostsChange?: (items: (Post | Comment)[]) => void;
  initialPosts?: (Post | Comment)[];
  /**
   * Desliga o filtro de idioma desta lista. Serve para a BUSCA: lá a pessoa pediu aquilo explicitamente, e esconder
   * um resultado por causa do idioma do feed fazia o contador dizer 12 e a lista mostrar 3 — o número nunca batia.
   */
  semFiltroDeIdioma?: boolean;
}

const EMPTY_FEED_OPTIONS: PaginatedPostsOptions = {};

const FeedList = forwardRef<FeedListHandle, FeedListProps>(({
  feedId, // Can be undefined now
  onPostDeleted,
  onPostCreated,
  feedContextOptions = EMPTY_FEED_OPTIONS,
  newPostToPrepend,
  onPostPrepended,
  onPostsChange,
  initialPosts,
  semFiltroDeIdioma = false
}, ref) => {
  const hiddenPostIds = useHiddenPostIds();
  const { currentUser } = useCurrentUser();
  const feedLanguageFilter = currentUser?.tabPreferences?.feedLanguageFilter || 'all';
  const queueContext = feedContextOptions.feedContext ?? (initialPosts !== undefined ? 'static' : 'feed');
  
  const isStaticList = initialPosts !== undefined;
  const effectiveFeedId = feedId || 'static_list'; // Use a default ID for static lists if none is provided

  const {
    posts,
    loadMorePosts,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    resetFeed, 
    prependPosts,
    removePostById,
    getNewestPostTimestamp,
    isRefreshing, // Get the new refreshing state
  } = useInfiniteFeed<FirestoreTimestamp | null>({
    feedId: effectiveFeedId,
    fetchPostsFunction: fetchPaginatedPosts,
    options: feedContextOptions,
    limit: 20,
    enabled: !isStaticList, // The hook is disabled if it's a static list
  });
  
  useEffect(() => {
    if (isStaticList && onPostsChange) {
      onPostsChange(initialPosts || []);
    } else if (onPostsChange) {
      onPostsChange(posts as (Post | Comment)[]);
    }
  }, [posts, initialPosts, isStaticList, onPostsChange]);
  
  useImperativeHandle(ref, () => ({
    resetFeed,
    getNewestPostTimestamp,
  }), [resetFeed, getNewestPostTimestamp]);

  const observer = useRef<IntersectionObserver>();
  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      // Com erro o sentinela não observa: a falha de uma página não pode virar um laço de pedidos que falham. Quem retoma é o
      // botão "Tentar novamente" do fim da lista.
      if (isStaticList || isLoading || isLoadingMore || error) return;

      if (observer.current) observer.current.disconnect();
      observer.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasMore && !isLoading) {
            loadMorePosts();
          }
        },
        { rootMargin: '1200px 0px' }
      );
      if (node) observer.current.observe(node);
    },
    [isStaticList, isLoading, isLoadingMore, hasMore, loadMorePosts, error]
  );

  useEffect(() => {
    if (newPostToPrepend) {
      prependPosts([newPostToPrepend]);
      if (onPostPrepended) {
        onPostPrepended(); 
      }
    }
  }, [newPostToPrepend, prependPosts, onPostPrepended]);

  // Identidade fixa: o cartão do feed é memoizado e só se redesenha quando o SEU post muda.
  const handlePostDeletedFromCard = useCallback((deletedPostId: string) => {
    removePostById(deletedPostId);
  }, [removePostById]);
  
  const finalPosts = useMemo(() => {
    const listToFilter = isStaticList ? initialPosts : posts;
    if (!listToFilter) return [];
    const shouldFilterLang =
      !semFiltroDeIdioma &&
      feedLanguageFilter !== 'all' &&
      !String(queueContext).startsWith('profile');

    return listToFilter.filter((item) => {
      if (hiddenPostIds.has((item as Post | Comment).id)) return false;
      if (!shouldFilterLang || 'parentPostId' in item) return true;

      const post = item as Post & { lang?: string; language?: string };
      const explicitLang = (post.language || post.lang || '').split('-')[0].toLowerCase().trim();
      const textSample = [post.headline, post.text].filter(Boolean).join(' ').trim();
      const detected = explicitLang || detectLikelyLanguage(textSample);

      // Se o post tem idioma identificável diferente do escolhido pelo usuário, oculta no feed.
      if (detected && detected !== feedLanguageFilter) {
        return false;
      }
      return true;
    });
  }, [isStaticList, initialPosts, posts, hiddenPostIds, feedLanguageFilter, queueContext, semFiltroDeIdioma]);

  // A fila do teatro de vídeo é esta lista (só os posts, sem comentários). O valor do contexto é estável: a função lê a lista atual
  // pela ref no momento do toque, então carregar mais uma página não redesenha nenhum cartão.
  const queuePostsRef = useRef<Post[]>([]);
  queuePostsRef.current = (finalPosts ?? []).filter((item) => !('parentPostId' in item)) as Post[];
  const videoQueueSource = useMemo<VideoQueueSource>(
    () => ({ context: queueContext, getPosts: () => queuePostsRef.current }),
    [queueContext],
  );


  if (isRefreshing) {
    return (
      <div className="space-y-0">
        <PostCardSkeleton />
        <PostCardSkeleton />
        <PostCardSkeleton />
      </div>
    );
  }

  if ((isLoading || isLoadingMore) && finalPosts && finalPosts.length === 0 && !isStaticList) {
    return (
      <div className="space-y-0">
        <PostCardSkeleton />
        <PostCardSkeleton />
        <PostCardSkeleton />
      </div>
    );
  }

  // Sem nada para mostrar, o erro ocupa a tela. Com posts já na lista (a falha foi de uma página extra, ou da revalidação
  // de um feed que veio do cache) a lista fica onde está e o erro aparece no fim: antes, uma falha na página 4 trocava o
  // feed inteiro pelo aviso e "Tentar Novamente" recomeçava do topo.
  if (error && finalPosts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive mb-3" />
        <h3 className="text-lg font-semibold text-destructive">Falha ao carregar posts</h3>
        <p className="text-muted-foreground mb-4"> {error.message || "Ocorreu um erro inesperado."}</p>
        <Button onClick={() => resetFeed()} variant="outline">
          <Loader2 className={`mr-2 h-4 w-4 ${!(isLoading || isLoadingMore) ? 'hidden' : 'animate-spin'}`} />
          Tentar Novamente
        </Button>
      </div>
    );
  }

  if (finalPosts && finalPosts.length === 0 && !hasMore && !isLoading && !isLoadingMore) {
    return (
      <div className="text-center py-10 px-4">
        <Frown className="mx-auto h-12 w-12 text-muted-foreground" />
        <p className="mt-4 text-muted-foreground">Nenhum post encontrado para este feed.</p>
        <Button onClick={() => resetFeed()} variant="outline" className="mt-4">
          <RefreshCw className="mr-2 h-4 w-4" />
          Recarregar
        </Button>
      </div>
    );
  }

  return (
    <VideoQueueContext.Provider value={videoQueueSource}>
    <div>
      {finalPosts && finalPosts.map((item, index) => {
        const itemIsComment = 'parentPostId' in item;

        return (
          <Fragment key={(item as Post | Comment).id}>
            {itemIsComment ? (
              <CommentCard
                comment={item as Comment}
                onPostCreated={onPostCreated}
                parentPostAuthorId={(item as Comment).postAuthorId}
              />
            ) : (
              <PostCard
                post={item as Post}
                onPostDeleted={handlePostDeletedFromCard}
                onPostCreated={onPostCreated}
                isSinglePostView={false}
              />
            )}
          </Fragment>
        )
      })}

      {!isStaticList && (
        <>
          <div ref={sentinelRef} className="h-px" aria-hidden="true" />
          {/* Carregamento discreto no fim da lista: com rootMargin amplo, o prefetch acontece antes de chegar aqui. */}
          {isLoadingMore && (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="ml-2 text-sm">Carregando mais...</span>
            </div>
          )}
          {error && (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-6 text-center" role="alert">
              <p className="text-sm text-muted-foreground">Falha ao carregar mais posts.</p>
              <Button onClick={() => loadMorePosts()} variant="outline" size="sm">
                <RefreshCw className="mr-2 h-4 w-4" />
                Tentar Novamente
              </Button>
            </div>
          )}
          {!error && !isLoadingMore && !hasMore && posts && posts.length > 0 && (
            <div className="flex min-h-32 flex-col items-center justify-center text-center">
              <p className="text-muted-foreground">Você chegou ao fim do feed.</p>
              <Button onClick={() => resetFeed()} variant="outline" className="mt-4">
                <RefreshCw className="mr-2 h-4 w-4" />
                Atualizar
              </Button>
            </div>
          )}
        </>
      )}
    </div>
    </VideoQueueContext.Provider>
  );
});
FeedList.displayName = 'FeedList';
export default FeedList;
