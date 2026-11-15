// src/components/search/HashtagListItem.tsx
'use client';

import Link from 'next/link';
import { Hash } from 'lucide-react';
import { useLocale } from 'next-intl';
import { useTranslations } from 'next-intl';

interface HashtagListItemProps {
  tag: string;
  count: number;
}

export default function HashtagListItem({ tag, count }: HashtagListItemProps) {
  const t = useTranslations('HashtagListItem');
  const locale = useLocale();
  const tagNameForUrl = tag.startsWith('#') ? tag.substring(1) : tag;

  return (
    <Link 
      href={`/${locale}/tag/${encodeURIComponent(tagNameForUrl)}`} 
      className="flex items-center p-2 rounded-lg hover:bg-muted transition-colors group"
    >
      <div className="flex-shrink-0 mr-4 grid place-items-center h-10 w-10 rounded-full bg-muted group-hover:bg-primary/20">
          <Hash className="h-5 w-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-primary truncate">{tag}</p>
        <p className="text-sm text-muted-foreground">{t('postCount', { count: count.toLocaleString() })}</p>
      </div>
    </Link>
  );
}
