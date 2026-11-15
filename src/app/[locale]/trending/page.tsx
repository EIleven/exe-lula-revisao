// src/app/[locale]/trending/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { getTrendingTopics } from '@/lib/services/hashtagService';
import { fetchPaginatedPosts } from '@/lib/services/postReadService';
import type { Post, User } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { TrendingUp, Newspaper, Hash } from 'lucide-react';
import TopNewsItem from '@/components/trending/TopNewsItem';
import { useLocale, useTranslations } from 'next-intl';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import PostCardSkeleton from '@/components/feed/PostCardSkeleton';

interface TrendingTopic {
  topic: string;
  count: number;
  topUsers: User[];
}

const TrendingPageSkeleton = () => (
  <div className="container mx-auto max-w-3xl py-8 space-y-8">
    <header className="mb-4">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-4 w-64 mt-2" />
    </header>
    <Card>
      <CardHeader>
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-56 mt-2" />
      </CardHeader>
      <CardContent className="space-y-4">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </CardContent>
    </Card>
    <Card>
      <CardHeader>
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-48 mt-2" />
      </CardHeader>
      <CardContent className="space-y-2 p-0">
        {[...Array(3)].map((_, i) => <PostCardSkeleton key={i} />)}
      </CardContent>
    </Card>
  </div>
);


export default function TrendingPage() {
  const locale = useLocale();
  const t = useTranslations('TrendingPage');
  
  const [topHashtags, setTopHashtags] = useState<{ topic: string; count: number; topUsers: User[] }[]>([]);
  const [topNews, setTopNews] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [hashtags, newsResponse] = await Promise.all([
          getTrendingTopics(20),
          fetchPaginatedPosts(null, 5, null, { feedContext: 'top_news' }),
        ]);
        setTopHashtags(hashtags);
        setTopNews(newsResponse.posts);
      } catch (error) {
        console.error("Failed to load trending page data:", error);
        // Optionally set an error state to show a message to the user
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  if (isLoading) {
    return <TrendingPageSkeleton />;
  }

  return (
    <div className="container mx-auto max-w-3xl py-8 space-y-8">
      <header className="mb-4">
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center">
          <TrendingUp className="mr-3 h-8 w-8 text-primary" />
          {t('title')}
        </h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </header>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center text-2xl">
            <Hash className="mr-3 h-6 w-6 text-primary" />
            {t('topHashtagsTitle')}
          </CardTitle>
          <CardDescription>{t('topHashtagsDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {topHashtags.length > 0 ? (
            <div className="space-y-4">
              {topHashtags.map(({ topic, count, topUsers }) => { 
                  let tagNameForUrl = '';
                  if (typeof topic === 'string') { 
                    tagNameForUrl = topic.startsWith('#') ? topic.substring(1) : topic;
                  }
                  if (!tagNameForUrl) return null; 

                  return (
                    <div key={topic} className="group rounded-lg hover:bg-muted/50 -mx-4 px-4 py-3 transition-colors">
                        <Link href={`/${locale}/tag/${encodeURIComponent(tagNameForUrl)}`} data-interactive="true" className="block cursor-pointer">
                            <Badge variant="secondary" className="text-lg font-bold group-hover:bg-primary/20">{topic}</Badge>
                            <p className="text-sm text-muted-foreground mt-1">{count.toLocaleString()} posts</p>
                        </Link>
                        {topUsers.length > 0 && (
                            <div className="flex -space-x-2 mt-2">
                                {topUsers.map((user) => (
                                    <Link href={`/${locale}/profile/${user.id}`} key={user.id} data-interactive="true" className="relative z-10 block" onClick={(e) => e.stopPropagation()}>
                                        <Avatar className="h-8 w-8 border-2 border-background hover:ring-2 hover:ring-primary transition-all">
                                            <AvatarImage src={user.avatarUrl} alt={user.name} />
                                            <AvatarFallback>{user.name[0]}</AvatarFallback>
                                        </Avatar>
                                    </Link>
                                ))}
                            </div>
                        )}
                    </div>
                  );
                })}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-4">{t('noHashtags')}</p>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center text-2xl">
            <Newspaper className="mr-3 h-6 w-6 text-primary" />
            {t('topNewsTitle')}
          </CardTitle>
          <CardDescription>{t('topNewsDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-0 sm:p-6 sm:pt-0">
          {topNews.length > 0 ? (
            topNews.map((newsItem: Post) => (
              <TopNewsItem key={newsItem.id} newsItem={newsItem} />
            ))
          ) : (
            <p className="p-4 text-muted-foreground text-center">{t('noNews')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
