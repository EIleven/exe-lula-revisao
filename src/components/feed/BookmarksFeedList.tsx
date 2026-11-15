// src/components/feed/BookmarksFeedList.tsx
'use client';

import React, { useEffect, useRef, useCallback, useState } from 'react';
import type { LikedItem, Post, Comment } from '@/lib/types';
import { fetchPaginatedBookmarks, type PaginatedBookmarksResponse } from '@/lib/services/postReadService';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { Timestamp as FirestoreTimestamp } from 'firebase/firestore';
import PostCard from './PostCard';
import CommentCard from './CommentCard';
import { Loader2, AlertTriangle, BookmarkX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslations } from 'next-intl';

interface BookmarksFeedListProps {
  userId: string;
  onPostCreatedFromQuote?: (newPost: Post) => void;
}

export default function BookmarksFeedList({ userId, onPostCreatedFromQuote }: BookmarksFeedListProps) {
  const t = useTranslations('PaginatedLists'); // Reusing existing translations
  const { currentUser } = useCurrentUser();
  const [items, setItems] = useState<LikedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const cursorRef = useRef<FirestoreTimestamp | null>(null);
  // O que a função lê para decidir NÃO pode estar nas dependências do useCallback: com `isLoadingMore` e `hasMore` lá, cada
  // rolagem que carregava mais mudava a identidade da função, o efeito de baixo rodava de novo como "primeira carga" e a lista
  // voltava à primeira página (com o spinner no lugar dela). Mesmo conserto do LikedItemsFeedList.
  const isLoadingMoreRef = useRef(false);
  const hasMoreRef = useRef(true);

  const loadMoreItems = useCallback(async (isInitialLoad = false) => {
    if (!isInitialLoad && (isLoadingMoreRef.current || !hasMoreRef.current)) return;

    if (isInitialLoad) {
      setIsLoading(true);
      cursorRef.current = null;
      hasMoreRef.current = true;
      setHasMore(true);
    } else {
      isLoadingMoreRef.current = true;
      setIsLoadingMore(true);
    }
    setError(null);

    try {
      const response: PaginatedBookmarksResponse = await fetchPaginatedBookmarks(userId, cursorRef.current, 10, currentUser?.id || null);
      setItems((prev) => {
        if (isInitialLoad) return response.items;
        const vistos = new Set(prev.map((x) => `${x.type}:${x.content?.id ?? ''}`));
        return [...prev, ...response.items.filter((x) => {
          const chave = `${x.type}:${x.content?.id ?? ''}`;
          if (vistos.has(chave)) return false;
          vistos.add(chave);
          return true;
        })];
      });
      cursorRef.current = response.nextCursor;
      hasMoreRef.current = response.hasMore;
      setHasMore(response.hasMore);
    } catch (e: any) {
      setError(e);
      console.error("Failed to fetch bookmarked items:", e);
    } finally {
      setIsLoading(false);
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [userId, currentUser?.id]);

  useEffect(() => {
    loadMoreItems(true);
  }, [loadMoreItems]);

  const observer = useRef<IntersectionObserver>();
  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (isLoading || isLoadingMore) return;
      if (observer.current) observer.current.disconnect();
      observer.current = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting && hasMore) {
          loadMoreItems();
        }
      });
      if (node) observer.current.observe(node);
    },
    [isLoading, isLoadingMore, hasMore, loadMoreItems]
  );
  
  // This function will be called from PostCard/CommentCard when an item is unbookmarked
  const handleItemDeletion = (contentId: string) => {
     setItems(prevItems => prevItems.filter(item => item.content.id !== contentId));
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-10">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive mb-3" />
        <h3 className="text-lg font-semibold text-destructive">{t('errorTitle')}</h3>
        <p className="text-muted-foreground mb-4">{error.message || t('errorMessage')}</p>
        <Button onClick={() => loadMoreItems(true)} variant="outline">{t('retry')}</Button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-10">
         <BookmarkX className="mx-auto h-12 w-12 text-muted-foreground" />
        <p className="mt-4 text-muted-foreground">{t('noBookmarks')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {items.map((item) => {
        if (!item || !item.content) return null;
        if (item.type === 'post') {
          return (
            <PostCard
              key={`bookmarked-post-${item.content.id}`}
              post={item.content as Post}
              onPostDeleted={handleItemDeletion}
              onPostCreated={onPostCreatedFromQuote}
            />
          );
        }
        if (item.type === 'comment') {
          return (
            <CommentCard
              key={`bookmarked-comment-${item.content.id}`}
              comment={item.content as Comment}
              onCommentDeleted={handleItemDeletion}
              onPostCreated={onPostCreatedFromQuote}
            />
          );
        }
        return null;
      })}

      {isLoadingMore && (
        <div className="flex justify-center items-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
      {!hasMore && items.length > 0 && (
        <div className="text-center py-10">
          <p className="text-muted-foreground">{t('endOfFeed')}</p>
        </div>
      )}
      <div ref={sentinelRef} style={{ height: '1px' }} />
    </div>
  );
}
