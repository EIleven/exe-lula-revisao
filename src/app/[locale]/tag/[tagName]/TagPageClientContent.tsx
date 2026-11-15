// src/app/[locale]/tag/[tagName]/TagPageClientContent.tsx
'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import FeedList, { FeedListHandle } from '@/components/feed/FeedList';
import FeedContainer from '@/components/feed/FeedContainer';
import type { Post } from '@/lib/types';
import type { PaginatedPostsOptions } from '@/lib/services/postReadService';
import { getTopPostsByHashtag } from '@/lib/services/postReadService';
import { useRouter } from 'next/navigation';
import { navigateBack } from '@/lib/backNavigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

interface TagPageClientContentProps {
  tagName: string;
}

export default function TagPageClientContent({ tagName }: TagPageClientContentProps) {
  const t = useTranslations('TagPage');
  const [activeTab, setActiveTab] = useState<'top' | 'recent'>('top');
  const [topPosts, setTopPosts] = useState<Post[]>([]);
  const [isLoadingTop, setIsLoadingTop] = useState(true);
  const router = useRouter();
  const { currentUser } = useCurrentUser();

  const recentFeedListRef = useRef<FeedListHandle>(null);

  const recentFeedOptions: PaginatedPostsOptions = useMemo(() => ({
    tagName: tagName,
  }), [tagName]);

  useEffect(() => {
    if (activeTab === 'top' && topPosts.length === 0) { // Fetch only if not already fetched
      setIsLoadingTop(true);
      getTopPostsByHashtag(tagName, 50, currentUser?.id || null)
        .then(setTopPosts)
        .finally(() => setIsLoadingTop(false));
    }
  }, [activeTab, tagName, currentUser, topPosts.length]);

  const handleRefresh = async () => {
    if (activeTab === 'recent') {
      await recentFeedListRef.current?.resetFeed();
    } else {
      setIsLoadingTop(true);
      getTopPostsByHashtag(tagName, 50, currentUser?.id || null)
        .then(setTopPosts)
        .finally(() => setIsLoadingTop(false));
    }
  };

  const [newlyCreatedPostForFeed, setNewlyCreatedPostForFeed] = useState<Post | null>(null);
  const handlePostPrepended = () => setNewlyCreatedPostForFeed(null);
  const handleGlobalPostCreation = (newPost: Post) => {
    const targetTag = tagName.startsWith('#') ? tagName : `#${tagName}`;
    if (newPost.hashtags?.some(h => h === targetTag)) {
      setNewlyCreatedPostForFeed(newPost);
    }
  };

  return (
    <div className="container mx-auto max-w-3xl pb-8">
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'top' | 'recent')} className="w-full">
        {/* Sticky Header containing Back button, Title, and TabsList */}
        {/* Fica logo abaixo do cabeçalho quando ele aparece e no topo quando ele some: `.chrome-sticky`, por CSS. */}
        <div className="chrome-sticky chrome-surface sticky z-20 border-b border-border px-4 py-2">
          <div className="flex items-center space-x-2 mb-2">
              <Button variant="ghost" size="icon" onClick={() => navigateBack(router)} className="h-8 w-8 shrink-0">
                <ArrowLeft className="h-5 w-5" />
                <span className="sr-only">Voltar</span>
              </Button>
              <h1 className="text-xl font-bold text-foreground truncate">{tagName}</h1>
          </div>
          <TabsList className={cn("grid w-full grid-cols-2", "bg-background")}>
            <TabsTrigger value="top">{t('top')}</TabsTrigger>
            <TabsTrigger value="recent">{t('recent')}</TabsTrigger>
          </TabsList>
        </div>

        {/* Content now has top margin to not be hidden by the sticky header */}
        <TabsContent value="top" className="mt-4">
          <FeedContainer onRefresh={handleRefresh}>
            {isLoadingTop ? (
              <div className="flex justify-center items-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <FeedList
                key={`${tagName}-top`}
                feedId={`tag-${tagName}-top`}
                initialPosts={topPosts}
                onPostCreated={handleGlobalPostCreation}
              />
            )}
          </FeedContainer>
        </TabsContent>
        <TabsContent value="recent" className="mt-4">
          <FeedContainer onRefresh={handleRefresh}>
            <FeedList 
              ref={recentFeedListRef}
              key={`${tagName}-recent`}
              feedId={`tag-${tagName}-recent`}
              feedContextOptions={recentFeedOptions}
              newPostToPrepend={newlyCreatedPostForFeed}
              onPostPrepended={handlePostPrepended}
              onPostCreated={handleGlobalPostCreation}
            />
          </FeedContainer>
        </TabsContent>
      </Tabs>
    </div>
  );
}
