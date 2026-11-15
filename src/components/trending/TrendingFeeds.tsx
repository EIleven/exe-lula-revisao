// src/components/trending/TrendingFeeds.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { Badge } from '../ui/badge';
import { TrendingUp } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useRouter } from 'next/navigation';
import { getTrendingTopics } from '@/lib/services/hashtagService';
import { Skeleton } from '../ui/skeleton';
import { useLocale } from 'next-intl';
import type { User } from '@/lib/types';
import Link from 'next/link';
import UserProfileHoverCard from '@/components/profile/UserProfileHoverCard';

interface TrendingTopic {
  topic: string;
  count: number;
  topUsers: User[];
}

const TrendingFeedSkeleton = () => (
  <div role="list" className="flex flex-col">
    {[...Array(5)].map((_, index) => (
      <div key={`skel-${index}`} className="flex items-center gap-4 py-3 border-b border-border last:border-b-0 -mx-4 px-4">
        <Skeleton className="h-5 w-4" />
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
    ))}
  </div>
);

export default function TrendingFeeds() {
  const router = useRouter();
  const locale = useLocale();
  const [trendingTopics, setTrendingTopics] = useState<TrendingTopic[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchTrending = async () => {
      setIsLoading(true);
      try {
        const topics = await getTrendingTopics(10, 200);
        setTrendingTopics(topics);
      } catch (error) {
        console.error("Failed to fetch trending topics:", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchTrending();
  }, []);

  const handleItemClick = (topicName: string) => {
    if (topicName.startsWith('#')) {
      router.push(`/${locale}/tag/${encodeURIComponent(topicName.substring(1))}`);
    } else {
      router.push(`/${locale}/search?q=${encodeURIComponent(topicName)}`);
    }
  };

  return (
    <section className="py-4 px-4">
      <h2 className="text-lg font-bold flex items-center mb-2">
        <TrendingUp className="mr-2 h-5 w-5 text-primary" />
        Em Alta
      </h2>
      {isLoading ? (
        <TrendingFeedSkeleton />
      ) : trendingTopics.length > 0 ? (
        <div role="list" className="flex flex-col">
          {trendingTopics.map((item, index) => (
            <div
              key={item.topic}
              role="listitem"
              className="flex items-center gap-4 py-3 border-b border-border last:border-b-0 cursor-pointer hover:bg-muted/50 -mx-4 px-4"
              onClick={() => handleItemClick(item.topic)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleItemClick(item.topic)}
              tabIndex={0}
              aria-label={`Ver feed ${item.topic}`}
            >
              <span className="text-lg font-bold text-muted-foreground w-4 text-center">{index + 1}</span>
              
              {item.topUsers.length > 0 ? (
                <div className="flex -space-x-3 shrink-0">
                    {item.topUsers.map((user, userIndex) => (
                        <UserProfileHoverCard key={user.id} user={user}>
                            <Link href={`/${locale}/profile/${user.id}`} onClick={e => e.stopPropagation()} data-interactive="true">
                                <Avatar className="h-10 w-10 border-2 border-background hover:ring-2 hover:ring-primary" style={{ zIndex: 4 - userIndex }}>
                                    <AvatarImage src={user.avatarUrl} alt={user.name} />
                                    <AvatarFallback>{user.name[0]}</AvatarFallback>
                                </Avatar>
                            </Link>
                        </UserProfileHoverCard>
                    ))}
                </div>
              ) : (
                <Avatar className="h-10 w-10">
                    <AvatarImage src={`https://placehold.co/40x40.png?text=${item.topic.charAt(1)}`} data-ai-hint="logo" />
                    <AvatarFallback>{item.topic.charAt(1).toUpperCase()}</AvatarFallback>
                </Avatar>
              )}
              
              <div className="flex-1">
                <Badge variant="default" className="text-base font-semibold">
                    <span>{item.topic.startsWith('#') ? item.topic : item.topic.charAt(0).toUpperCase() + item.topic.slice(1)}</span>
                    <span className="ml-1.5 text-primary-foreground/70 font-normal">{item.count.toLocaleString()}</span>
                </Badge>
              </div>
              {index < 2 && <Badge variant="destructive">Em alta</Badge>}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-center py-4">Nenhuma tendência no momento.</p>
      )}
    </section>
  );
}
