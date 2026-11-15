// src/app/[locale]/bookmarks/page.tsx
'use client';

import React, { useState, useCallback } from 'react';
import BookmarksFeedList from '@/components/feed/BookmarksFeedList';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import PostCardSkeleton from '@/components/feed/PostCardSkeleton';
import FeedContainer from '@/components/feed/FeedContainer';
import { Card, CardContent } from '@/components/ui/card';
import BackButton from '@/components/shared/BackButton';
import { Bookmark } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function BookmarksPage() {
  const t = useTranslations('BookmarksPage');
  const { currentUser, isLoading } = useCurrentUser();
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = useCallback(async () => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  return (
    <FeedContainer onRefresh={handleRefresh}>
      <div className="container mx-auto max-w-3xl py-8">
        <div className="flex justify-between items-center mb-2 px-4">
          <div className="space-y-1">
            <h1 className="text-xl font-bold flex items-center ml-4">
              <Bookmark className="mr-3 h-6 w-6 text-primary" />
              {t('title')}
            </h1>
          </div>
          <BackButton />
        </div>
        <Card className="shadow-lg rounded-none border-x-0">
          <CardContent className="p-0">
          {isLoading ? (
            <div>
              <PostCardSkeleton />
              <PostCardSkeleton />
              <PostCardSkeleton />
            </div>
            ) : currentUser ? (
              <BookmarksFeedList key={refreshKey} userId={currentUser.id} />
            ) : (
              <p className="p-6 text-center text-muted-foreground">{t('loginPrompt')}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </FeedContainer>
  );
}
