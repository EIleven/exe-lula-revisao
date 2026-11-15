// src/components/trending/TopNewsItem.tsx
'use client';

import type { Post } from '@/lib/types';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { ptBR, enUS } from 'date-fns/locale';
import { ExternalLink } from 'lucide-react';
import { useMemo } from 'react';
import { extractFirstMediaFromHtml } from '@/lib/utils/textUtils';
import { cn } from '@/lib/utils';
import { useLocale, useTranslations } from 'next-intl';

interface TopNewsItemProps {
  newsItem: Post;
  className?: string;
  density?: 'default' | 'compact';
}

const NEWS_PREVIEW_LENGTH = 150;

export default function TopNewsItem({ newsItem, className, density = 'default' }: TopNewsItemProps) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('TopNewsItem');

  // Calculados na renderização (e só quando o artigo muda): o texto de um artigo pode ter milhares de caracteres de HTML e
  // a hora em estado custava uma segunda renderização de cada artigo do feed.
  const timeAgo = useMemo(() => {
    if (!newsItem.createdAt) return '';
    const createdAt = typeof newsItem.createdAt === 'string'
      ? new Date(newsItem.createdAt)
      : newsItem.createdAt.toDate();
    const formatted = formatDistanceToNow(createdAt, { addSuffix: true, locale: locale === 'pt-BR' ? ptBR : enUS });
    return locale === 'pt-BR' ? formatted.replace('cerca de ', '') : formatted;
  }, [newsItem.createdAt, locale]);

  const previewText = useMemo(() => {
    if (!newsItem.text) return '';
    const plainText = newsItem.text.replace(/<[^>]*>?/gm, ' ');
    return plainText.length > NEWS_PREVIEW_LENGTH ? plainText.substring(0, NEWS_PREVIEW_LENGTH) + '...' : plainText;
  }, [newsItem.text]);

  const thumbnailUrl = useMemo(() => {
    if (newsItem.media && newsItem.media.length > 0 && newsItem.media[0].type === 'image') {
      return newsItem.media[0].url;
    }
    return extractFirstMediaFromHtml(newsItem.text);
  }, [newsItem.media, newsItem.text]);

  const sourceHostname = useMemo(() => {
    if (!newsItem.sourceUrl) return '';
    try {
      return new URL(newsItem.sourceUrl).hostname;
    } catch {
      return newsItem.sourceUrl;
    }
  }, [newsItem.sourceUrl]);

  const isCompact = density === 'compact';
  const articleAuthor = newsItem.user ?? {
    id: newsItem.authorDetails.userId,
    name: newsItem.authorDetails.name,
    username: newsItem.authorDetails.username,
  };

  const handleArticleClick = (e: React.MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    let currentElement: HTMLElement | null = target;

    while (currentElement && currentElement !== e.currentTarget) {
      if (
        currentElement.tagName === 'A' ||
        currentElement.tagName === 'BUTTON' ||
        currentElement.dataset.interactive === 'true'
      ) {
        return;
      }
      currentElement = currentElement.parentElement;
    }
    router.push(`/${locale}/post/${newsItem.id}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'A' ||
        target.tagName === 'BUTTON' ||
        target.dataset.interactive === 'true'
      ) {
        if (target !== e.currentTarget) return;
      }
      e.preventDefault();
      router.push(`/${locale}/post/${newsItem.id}`);
    }
  };

  const renderArticleBody = () => {
    if (!newsItem.text) return null;

    return (
      <p className={cn('text-muted-foreground', isCompact ? 'mb-1 line-clamp-1 text-xs' : 'mb-2 line-clamp-3 text-sm')}>
        {previewText}
      </p>
    );
  };

  return (
    <article
      key={newsItem.id}
      className={cn(
        'flex cursor-pointer break-words rounded-lg border border-border transition-colors hover:bg-muted/30',
        isCompact ? 'flex-row gap-3 p-2' : 'flex-col gap-4 p-4 sm:flex-row',
        className
      )}
      onClick={handleArticleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="link"
      aria-label={t('readArticle', { title: newsItem.headline || t('untitledArticle') })}
    >
      {thumbnailUrl && (
        <div
          className={cn(
            'relative shrink-0 overflow-hidden rounded-md',
            isCompact ? 'h-[76px] w-[76px]' : 'h-40 w-full aspect-[16/9] sm:h-auto sm:w-1/3 sm:aspect-square',
          )}
        >
          <Image
            src={thumbnailUrl}
            alt={newsItem.media?.[0]?.alt || newsItem.headline || t('articleImage')}
            fill
            sizes={isCompact ? '76px' : '(max-width: 640px) 100vw, (max-width: 768px) 33vw, 200px'}
            className="object-cover"
            data-ai-hint={newsItem.media?.[0]?.['data-ai-hint'] || 'news article image'}
          />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <h3 className={cn('mb-1 line-clamp-2 font-semibold text-foreground hover:underline', isCompact ? 'text-sm leading-snug' : 'text-md')}>
          {newsItem.headline}
        </h3>
        {renderArticleBody()}
        <div className={cn('flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground/80', isCompact && 'leading-tight')}>
          <span className="truncate">
            {t('by')}{' '}
            <Link
              href={`/${locale}/profile/${articleAuthor.id}`}
              className="font-medium text-foreground/90 hover:underline"
              onClick={(e) => e.stopPropagation()}
              data-interactive="true"
            >
              {articleAuthor.name}
            </Link>{' '}
            {!isCompact && <> (@{articleAuthor.username})</>}
          </span>
          <span className="shrink-0">{timeAgo || '...'}</span>
        </div>
        {newsItem.sourceUrl && (
          <Link
            href={newsItem.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn('mt-1 flex items-center truncate text-xs text-primary hover:underline', isCompact && 'max-w-full')}
            onClick={(e) => e.stopPropagation()}
            data-interactive="true"
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            {t('source')}: {sourceHostname}
          </Link>
        )}
      </div>
    </article>
  );
}
