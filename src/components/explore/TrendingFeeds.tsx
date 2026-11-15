// src/components/explore/TrendingFeeds.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useLocale } from 'next-intl';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import UserProfileHoverCard from '@/components/profile/UserProfileHoverCard';
import { getTrendingTopics } from '@/lib/services/hashtagService';
import type { User } from '@/lib/types';

interface TrendingTopic {
  topic: string;
  count: number;
  topUsers: User[];
}

interface TrendingFeedsProps {
  locationLabel?: string;
  limit?: number;
  onShowMore?: () => void;
}

const TrendingFeedSkeleton = ({ count = 5 }: { count?: number }) => (
  <div className="divide-y divide-border/60" aria-hidden="true">
    {[...Array(count)].map((_, index) => (
      <div key={index} className="space-y-1.5 px-4 py-3">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-24" />
      </div>
    ))}
  </div>
);

export default function TrendingFeeds({
  locationLabel = 'Brasil',
  limit = 10,
  onShowMore,
}: TrendingFeedsProps) {
  const locale = useLocale();
  const [trendingTopics, setTrendingTopics] = useState<TrendingTopic[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const fetchTrending = async () => {
      setIsLoading(true);
      try {
        const data = await getTrendingTopics(Math.max(limit, 10), 200);
        if (active) setTrendingTopics(data);
      } catch (error) {
        console.error('Failed to fetch trending topics:', error);
        if (active) setTrendingTopics([]);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void fetchTrending();
    return () => {
      active = false;
    };
  }, [limit]);

  const topicUrl = (topic: string) =>
    topic.startsWith('#')
      ? `/${locale}/tag/${encodeURIComponent(topic.substring(1))}`
      : `/${locale}/search?q=${encodeURIComponent(topic)}`;

  const visibleTopics = trendingTopics.slice(0, limit);

  return (
    <section aria-label="Assuntos do momento">
      {isLoading ? (
        <TrendingFeedSkeleton count={Math.min(limit, 5)} />
      ) : visibleTopics.length > 0 ? (
        <div className="divide-y divide-border/60">
          {visibleTopics.map((item, index) => (
            <Link
              key={item.topic}
              href={topicUrl(item.topic)}
              className="group flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/30"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-muted-foreground">
                  {index + 1} · Assunto do momento em {locationLabel}
                </p>
                <p className="mt-0.5 truncate text-[15px] font-bold text-foreground group-hover:text-primary transition-colors">
                  {item.topic}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  {item.count.toLocaleString(locale)}{' '}
                  {item.count === 1 ? 'publicação' : 'publicações'}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {item.topUsers.length > 0 && (
                  <div className="hidden sm:flex -space-x-1.5">
                    {item.topUsers.slice(0, 3).map((u) => (
                      <UserProfileHoverCard key={u.id} user={u}>
                        <Avatar className="h-6 w-6 ring-2 ring-background">
                          <AvatarImage src={u.avatarUrl} alt={u.name} />
                          <AvatarFallback className="text-[10px]">
                            {u.name?.substring(0, 1) || '?'}
                          </AvatarFallback>
                        </Avatar>
                      </UserProfileHoverCard>
                    ))}
                  </div>
                )}
                <MoreHorizontal className="h-4 w-4 text-muted-foreground/70 group-hover:text-foreground" />
              </div>
            </Link>
          ))}

          {onShowMore && trendingTopics.length > visibleTopics.length && (
            <button
              type="button"
              onClick={onShowMore}
              className="w-full px-4 py-3 text-left text-sm font-medium text-primary transition-colors hover:bg-muted/30"
            >
              Mostrar mais assuntos
            </button>
          )}
        </div>
      ) : (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhum assunto em alta no momento.
        </p>
      )}
    </section>
  );
}
