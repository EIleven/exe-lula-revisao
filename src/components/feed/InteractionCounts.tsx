// src/components/feed/InteractionCounts.tsx
'use client';

import type { Post } from '@/lib/types';
import Link from 'next/link';
import { useLocale } from 'next-intl';

interface InteractionCountsProps {
  post: Post;
}

export default function InteractionCounts({ post }: InteractionCountsProps) {
  const locale = useLocale();
  // The bar should be visible if any interaction metric is available to be shown.
  const hasAnyInteractionsToShow =
    post.reposts !== undefined ||
    post.quotesCount !== undefined ||
    post.likes !== undefined ||
    post.views !== undefined;

  if (!hasAnyInteractionsToShow) {
    return null;
  }

  return (
    <div className="mt-3 pt-3 border-t border-border text-muted-foreground">
      <div className="flex items-center space-x-4 text-sm">
        {/* Always show Reposts link */}
        <Link
          href={`/${locale}/post/${post.id}/reposts`}
          className="hover:underline"
          data-interactive="true"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="font-bold text-foreground">{post.reposts || 0}</span> Reposts
        </Link>

        {/* Always show Quotes link */}
        <Link
          href={`/${locale}/post/${post.id}/quotes`}
          className="hover:underline"
          data-interactive="true"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="font-bold text-foreground">{post.quotesCount || 0}</span> Citações
        </Link>
        
        {/* Always show Likes link */}
        <Link
          href={`/${locale}/post/${post.id}/likes`}
          className="hover:underline"
          data-interactive="true"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="font-bold text-foreground">{post.likes || 0}</span> Likes
        </Link>
        
        {/* Always show Impressions */}
        <span>
          <span className="font-bold text-foreground">{post.views || 0}</span> Impressões
        </span>
      </div>
    </div>
  );
}
