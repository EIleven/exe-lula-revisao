// src/components/profile/PaginatedCommentList.tsx
'use client';

import React, { useEffect, useRef, useCallback, forwardRef } from 'react';
import type { Comment, Post } from '@/lib/types';
import CommentCard from '@/components/feed/CommentCard'; // Corrected import
import { useInfiniteFeed } from '@/hooks/features/feed/useInfiniteFeed';
import { fetchPaginatedComments, type PaginatedPostsOptions } from '@/lib/services/comments'; 
import { Loader2, AlertTriangle, MessageSquareOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from "@/components/ui/skeleton"; // For loading state
import { Card } from '@/components/ui/card';
import { useReplyManagement } from '@/hooks/features/comment/useReplyManagement';
import type { FirestoreTimestamp } from 'firebase/firestore';
import { useTranslations } from 'next-intl';

export interface FeedListHandle {
  resetFeed: () => Promise<void>;
  getNewestPostTimestamp: () => FirestoreTimestamp | null;
}

interface PaginatedCommentListProps {
  feedId: string;
  onPostCreatedFromCommentQuote?: (newPost: Post) => void;
  feedContextOptions?: PaginatedPostsOptions;
}

const PaginatedCommentList = forwardRef<FeedListHandle, PaginatedCommentListProps>(({
  feedId,
  onPostCreatedFromCommentQuote,
  feedContextOptions = {},
}, ref) => {
  const t = useTranslations('PaginatedLists');
  const {
    posts: comments, // Rename posts to comments for clarity
    loadMorePosts: loadMoreComments,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    resetFeed,
    getNewestPostTimestamp,
  } = useInfiniteFeed<FirestoreTimestamp | null>({
    feedId,
    fetchPostsFunction: fetchPaginatedComments,
    options: feedContextOptions,
    limit: 15,
  });

  const observer = useRef<IntersectionObserver>();
  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (isLoading || isLoadingMore) return;
      if (observer.current) observer.current.disconnect();
      observer.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading) {
          loadMoreComments();
        }
      });
      if (node) observer.current.observe(node);
    },
    [isLoading, isLoadingMore, hasMore, loadMoreComments]
  );


  if (isLoading && comments.length === 0) {
    return (
      <div className="space-y-0">
        {[...Array(3)].map((_, i) => (
           <Card className="w-full max-w-2xl mx-auto shadow-sm rounded-none lg:rounded-xl overflow-hidden bg-card border-x-0 border-b lg:border p-4" key={`comment-skel-${i}`}>
              <div className="flex items-start space-x-3">
                <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                    <div className="flex justify-between items-center">
                        <div className="space-y-1">
                            <Skeleton className="h-4 w-32" />
                            <Skeleton className="h-3 w-24" />
                        </div>
                    </div>
                    <div className="pt-2">
                        <Skeleton className="h-4 w-full mb-2" />
                        <Skeleton className="h-4 w-3/4 mb-3" />
                    </div>
                </div>
              </div>
            </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive mb-3" />
        <h3 className="text-lg font-semibold text-destructive">{t('errorTitle')}</h3>
        <p className="text-muted-foreground mb-4">{error.message || t('errorMessage')}</p>
        <Button onClick={() => resetFeed()} variant="outline">
          <Loader2 className={`mr-2 h-4 w-4 ${!(isLoading || isLoadingMore) ? 'hidden' : 'animate-spin'}`} />
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (comments.length === 0 && !hasMore && !isLoading && !isLoadingMore) {
    return (
      <div className="text-center py-10">
        <MessageSquareOff className="mx-auto h-12 w-12 text-muted-foreground" />
        <p className="mt-4 text-muted-foreground">{t('noComments')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {(comments as (Comment & { depth?: number })[]).map((comment) => (
          (comment.user && comment.parentPostUser) ? (
             <CommentCard
                 key={comment.id}
                 comment={comment}
                 onPostCreated={onPostCreatedFromCommentQuote}
                 parentPostAuthorId={comment.parentPostUser?.userId}
             />
          ) : (
            <div key={comment.id} className="border-b p-4 text-sm text-muted-foreground">
                {t('commentLoadError')}
            </div>
          )
      ))}
      {isLoadingMore && (
        <div className="flex justify-center items-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
      {!isLoadingMore && !hasMore && comments.length > 0 && (
        <div className="text-center py-10">
          <p className="text-muted-foreground">{t('endOfComments')}</p>
        </div>
      )}
      {hasMore && !isLoading && <div ref={sentinelRef} style={{ height: '1px' }} />}
    </div>
  );
});

PaginatedCommentList.displayName = 'PaginatedCommentList';

export default PaginatedCommentList;
