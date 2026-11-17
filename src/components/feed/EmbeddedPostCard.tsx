// src/components/feed/EmbeddedPostCard.tsx
'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Post, Comment, EmbeddedUserDetails, OriginalPostDetails, Media } from '@/lib/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import TextWithMentions from '@/components/shared/TextWithMentions';
import { formatDistanceToNow } from 'date-fns';
import { ptBR, enUS } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { htmlToPlainText } from '@/lib/security/sanitizeHtml';
import SensitiveMediaCover from '@/components/shared/SensitiveMediaCover';
import TranslateActionLine from '@/components/shared/TranslateActionLine';
import { useTextTranslation } from '@/hooks/useTextTranslation';

const TEXT_PREVIEW_LENGTH = 300;

interface EmbeddedCardProps {
  post?: Post;
  comment?: Comment;
  className?: string;
  truncateText?: boolean;
  scrollable?: boolean; // New prop for scrolling
  onImageClick?: (imageUrl: string) => void;
}

// O guard fica FORA dos hooks (regra dos hooks): o conteúdo real é renderizado pelo componente interno.
const EmbeddedPostCard: React.FC<EmbeddedCardProps> = (props) => {
  const t = useTranslations('EmbeddedPostCard');
  if (!props.post && !props.comment) {
    return <div className={cn("block mt-2 p-3 border border-border rounded-lg bg-card/50 min-h-[100px]", props.className)}></div>;
  }
  if (props.post && (props.post as OriginalPostDetails).isUnavailable) {
    return (
      <div className={cn("block mt-2 p-3 border border-dashed border-border rounded-lg bg-card/50 text-sm text-muted-foreground", props.className)}>
        {t('unavailable')}
      </div>
    );
  }
  return <EmbeddedPostCardContent {...props} />;
};

const EmbeddedPostCardContent: React.FC<EmbeddedCardProps> = ({ post, comment, className, truncateText = false, scrollable = false, onImageClick }) => {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('EmbeddedPostCard');

  const isPost = !!post;
  const contentData = post || comment;
  
  const isExternalLink = isPost && post.id.startsWith('http');

  const authorUserObject = isPost ? post.user : comment!.user;
  const authorDetailsObject = isPost ? post.authorDetails : comment!.authorDetails;

  const authorName = authorUserObject?.name || authorDetailsObject?.name || 'User';
  const authorUsername = authorUserObject?.username || authorDetailsObject?.username || 'user';
  const authorId = authorUserObject?.id || authorDetailsObject?.userId || (isPost ? (post as Post).userId : (comment as Comment).userId);
  const authorAvatarUrl = authorUserObject?.avatarUrl || authorDetailsObject?.avatarUrl;
  const aiHint = authorUserObject?.['data-ai-hint'] || authorDetailsObject?.['data-ai-hint'] || 'author avatar';

  const contentText = isPost ? (post as Post).text : (comment as Comment).text;
  const youtubeVideoId = isPost ? (post as Post).youtubeVideoId : (comment as Comment).youtubeVideoId;
  const createdAt = contentData?.createdAt;

  const thumbnail = useMemo(() => {
    const media = isPost ? post.media : comment?.media;
    if (media && media.length > 0 && media[0].type === 'image') {
      return media[0];
    }
    return null;
  }, [isPost, post, comment]);

  const formattedTime = createdAt ? formatDistanceToNow(new Date(createdAt), { addSuffix: true, locale: locale === 'pt-BR' ? ptBR : enUS }) : '';
  const timeAgo = locale === 'pt-BR' ? formattedTime.replace('cerca de ', '') : formattedTime;

  const cardHref = useMemo(() => {
    if (isExternalLink) {
        return post!.id; // The external URL itself
    }
    if (isPost) {
      const details = post as OriginalPostDetails;
      if (details.parentPostId) {
        return `/${locale}/post/${details.parentPostId}#comment-${details.id}`;
      }
      return `/${locale}/post/${details.id}`;
    } else {
      return `/${locale}/post/${(comment as Comment).parentPostId}#comment-${comment.id}`;
    }
  }, [isPost, post, comment, locale, isExternalLink]);

  const handleNavigation = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    // Stop navigation if an interactive element was clicked
    if ((e.target as HTMLElement).closest('[data-interactive="true"]')) {
      return;
    }
    if (isExternalLink) {
        window.open(cardHref, '_blank', 'noopener,noreferrer');
    } else {
        router.push(cardHref);
    }
  };

  const nestedOriginalPost = isPost ? (contentData as Post).originalPostDetails : undefined;
  const isNewsArticle = Boolean(isPost && post?.category === 'news');
  const rawEmbedText = isPost ? post?.text : comment?.text;
  const headlineToRender = isPost ? post?.headline : null;
  const plainEmbedText = isNewsArticle ? htmlToPlainText(rawEmbedText) : (rawEmbedText || '');
  const translationInput = headlineToRender ? `${headlineToRender}\n${plainEmbedText}` : plainEmbedText;
  const translation = useTextTranslation(translationInput);

  const renderContent = () => {
    const displayed = translation.isTranslated && translation.translatedText
      ? translation.translatedText
      : plainEmbedText;
    const isTruncated = truncateText && !scrollable && displayed.length > TEXT_PREVIEW_LENGTH;
    const finalPlainText = isTruncated ? displayed.substring(0, TEXT_PREVIEW_LENGTH) + '...' : displayed;

    const textComponent = (
      <>
        {headlineToRender && !translation.isTranslated && (
          <h3 className="text-md font-semibold text-foreground mb-1 line-clamp-2">{headlineToRender}</h3>
        )}
        {finalPlainText && (
          <p className={cn("text-sm whitespace-pre-wrap", isNewsArticle ? "line-clamp-3 text-foreground/80" : "text-foreground")}>
            <TextWithMentions text={finalPlainText} />
            {isTruncated && (
              <Link href={cardHref} target={isExternalLink ? "_blank" : "_self"} rel={isExternalLink ? "noopener noreferrer" : ""} className="text-primary hover:underline ml-1" onClick={(e) => e.stopPropagation()} data-interactive="true">
                {t('continueReading')}
              </Link>
            )}
          </p>
        )}
        <TranslateActionLine
          canTranslate={translation.canTranslate}
          isTranslating={translation.isTranslating}
          isTranslated={translation.isTranslated}
          targetLabel={translation.targetLabel}
          detectedSource={translation.detectedSource}
          hasError={translation.hasError}
          onToggle={translation.toggleTranslation}
          className="mb-0.5"
        />
      </>
    );

    return (
      <div className="flex-1 min-w-0">{textComponent}</div>
    );
  };

  return (
    <div
      onClick={handleNavigation}
      className={cn(
        "block mt-2 p-3 border border-border rounded-lg bg-card/50 hover:bg-border/50 transition-colors cursor-pointer",
        scrollable && "max-h-52 overflow-y-auto",
        className
      )}
      role="link"
      aria-label={`View quoted content by ${authorName}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground mb-2">
        <Avatar className="h-5 w-5 self-center">
          <AvatarImage src={authorAvatarUrl} alt={authorName} data-ai-hint={aiHint} />
          <AvatarFallback>{authorName.substring(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
        <Link 
          href={`/${locale}/profile/${authorId}`} 
          className="font-semibold text-foreground hover:underline"
          onClick={(e) => e.stopPropagation()}
          data-interactive="true"
        >
          {authorName}
        </Link>
        <span className="truncate">@{authorUsername}</span>
        <span className="text-muted-foreground">&#183;</span>
        <span className="text-muted-foreground whitespace-nowrap">{timeAgo}</span>
      </div>

      {thumbnail && (
        <SensitiveMediaCover
          sensitive={Boolean(contentData?.sensitive)}
          contentKey={contentData?.id}
          compact
          className="mt-2 mb-2"
        >
          <div className="aspect-video w-full rounded-lg overflow-hidden border relative">
              <Image
                  src={thumbnail.url}
                  alt={thumbnail.alt || post?.headline || 'Embedded content image'}
                  fill
                  className="object-cover"
                  sizes="(max-width: 640px) 90vw, 520px"
              />
          </div>
        </SensitiveMediaCover>
      )}

      <div className={cn(thumbnail && 'mt-2')}>
        {renderContent()}
      </div>
      
      {nestedOriginalPost && (
        <EmbeddedPostCard post={nestedOriginalPost as Post} onImageClick={onImageClick} />
      )}
    </div>
  );
};

export default EmbeddedPostCard;
