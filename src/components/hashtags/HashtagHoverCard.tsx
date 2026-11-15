// src/components/hashtags/HashtagHoverCard.tsx
'use client';

import React, { useState } from 'react';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Loader2 } from 'lucide-react';
import { getHashtagStats } from '@/lib/services/hashtagService';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

interface HashtagStats {
  postCount: number;
}

interface HashtagHoverCardProps {
  tagName: string; // e.g., #NextJS
  children: React.ReactNode;
}

export default function HashtagHoverCard({ tagName, children }: HashtagHoverCardProps) {
  const t = useTranslations('HashtagHoverCard');
  const [stats, setStats] = useState<HashtagStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const locale = useLocale();

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen && !stats && !isLoading) {
      setIsLoading(true);
      getHashtagStats(tagName)
        .then(setStats)
        .catch(err => {
          console.error("Failed to fetch hashtag stats:", err);
          setStats({ postCount: 0 }); // Show 0 on error
        })
        .finally(() => setIsLoading(false));
    }
  };

  return (
    <HoverCard openDelay={300} onOpenChange={handleOpenChange}>
      <HoverCardTrigger asChild>
        {children}
      </HoverCardTrigger>
      <HoverCardContent className="w-60 p-3" onClick={(e) => e.stopPropagation()} data-interactive="true">
        <div className="flex flex-col space-y-1">
          <h3 className="text-md font-bold text-foreground">{tagName}</h3>
          <div className="text-sm text-muted-foreground">
            {isLoading ? (
              <div className="flex items-center">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('loading')}
              </div>
            ) : (
              <Link href={`/${locale}/tag/${tagName.substring(1)}`} className="hover:underline">
                <span className="font-bold text-foreground">{stats?.postCount.toLocaleString() ?? 0}</span> {t('posts', { count: stats?.postCount ?? 0 })}
              </Link>
            )}
          </div>
          {/* A brief description or some recent posts could go here in the future */}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
