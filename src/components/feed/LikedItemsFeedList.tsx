// src/components/feed/LikedItemsFeedList.tsx
'use client';

import React, { useEffect, useRef, useCallback, useState } from 'react';
import type { LikedItem, Post, Comment } from '@/lib/types';
import { fetchPaginatedLikedItems, type PaginatedLikedItemsResponse } from '@/lib/services/postReadService';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { Timestamp as FirestoreTimestamp } from 'firebase/firestore';
import PostCard from './PostCard';
import CommentCard from './CommentCard';
import { Loader2, AlertTriangle, HeartOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslations } from 'next-intl';

interface LikedItemsFeedListProps {
  userId: string;
  onPostCreatedFromQuote?: (newPost: Post) => void;
}

export default function LikedItemsFeedList({ userId, onPostCreatedFromQuote }: LikedItemsFeedListProps) {
  const t = useTranslations('PaginatedLists');
  const { currentUser } = useCurrentUser();
  const [items, setItems] = useState<LikedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const cursorRef = useRef<FirestoreTimestamp | null>(null);
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
      const response = await fetchPaginatedLikedItems(userId, cursorRef.current, 10, currentUser?.id || null);
      setItems((prev) => {
        if (isInitialLoad) return response.items;
        const seen = new Set(prev.map((x) => `${x.type}:${x.content?.id ?? ''}`));
        const next = response.items.filter((x) => {
          const k = `${x.type}:${x.content?.id ?? ''}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        return [...prev, ...next];
      });
      cursorRef.current = response.nextCursor;
      hasMoreRef.current = response.hasMore;
      setHasMore(response.hasMore);
    } catch (e: any) {
      setError(e);
      console.error("Failed to fetch liked items:", e);
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
         <HeartOff className="mx-auto h-12 w-12 text-muted-foreground" />
        <p className="mt-4 text-muted-foreground">{t('noLikes')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {items.map((item) => {
        if (!item || !item.content) return null; // Add this check
        if (item.type === 'post') {
          return (
            <PostCard
              key={`liked-post-${item.content.id}`}
              post={item.content as Post}
              onPostCreated={onPostCreatedFromQuote}
            />
          );
        }
        if (item.type === 'comment') {
          return (
            <CommentCard
              key={`liked-comment-${item.content.id}`}
              comment={item.content as Comment}
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
