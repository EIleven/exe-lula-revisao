// src/components/feed/PostCardContent.tsx
'use client';

import React, { useRef, useEffect, Fragment } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Newspaper, MapPin, ShieldAlert } from 'lucide-react';
import TextWithMentions from '@/components/shared/TextWithMentions';
import EmbeddedPostCard from './EmbeddedPostCard';
import type { Post } from '@/lib/types';
import { cn } from '@/lib/utils';
import TopNewsItem from '@/components/trending/TopNewsItem';
import { useLocale, useTranslations } from 'next-intl';
import AdClientComponent from '../shared/AdClientComponent';
import { linkifyHashtagsInHtml } from '@/lib/utils/textUtils'; // Importar a função
import { sanitizeHtml } from '@/lib/security/sanitizeHtml';
import { useCurrentUserSelector } from '@/contexts/CurrentUserContext';
import { Button } from '@/components/ui/button';
import PostPoll from './PostPoll';
import YoutubeEmbed from '@/components/shared/YoutubeEmbed';
import PlatformVideo from '@/components/shared/PlatformVideo';
import LinkPreviewCard, { extractFirstUrlFromText } from '@/components/shared/LinkPreviewCard';
import { extractYoutubeVideoInfo } from '@/lib/utils/youtubeLinks';

interface PostCardContentProps {
  post: Post;
  isSinglePostView?: boolean;
  onImageClick: (imageUrl: string) => void;
}

const NEWS_PREVIEW_LENGTH = 150;

/** A imagem chegou: a reserva de espaço do cartão (proporção 4:3, `aspect-[4/3] bg-muted`) já cumpriu o papel e sai, sem estado do React. */
const releaseImageReserve = (event: React.SyntheticEvent<HTMLImageElement>) => {
  event.currentTarget.parentElement?.classList.remove('aspect-[4/3]', 'bg-muted');
};

export default function PostCardContent({
  post,
  isSinglePostView = false,
  onImageClick,
}: PostCardContentProps) {
  const articleBodyRef = useRef<HTMLDivElement>(null);
  const locale = useLocale();
  const t = useTranslations('TopNewsItem');
  const contentT = useTranslations('PostContent');
  // Só esta preferência: um seguidor novo ou uma mensagem não lida não redesenha o conteúdo de cada cartão do feed.
  const alwaysShowSensitive = useCurrentUserSelector((state) => state.currentUser?.displaySensitiveContent === true);
  const [showSensitive, setShowSensitive] = React.useState(false);

  useEffect(() => setShowSensitive(false), [post.id]);

  useEffect(() => {
    const handleArticleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'IMG' && target.hasAttribute('src')) {
        event.stopPropagation();
        onImageClick(target.getAttribute('src')!);
      }
    };

    const articleBody = articleBodyRef.current;
    const timers: number[] = [];
    const statusNodes: HTMLElement[] = [];
    if (articleBody) {
      articleBody.addEventListener('click', handleArticleClick);
      // O corpo de artigo vem como HTML do Tiptap, portanto seus <video> não passam pelo componente React
      // PlatformVideo. Aplicamos o mesmo protocolo HEAD aqui e só entregamos o player quando o FFmpeg terminar.
      for (const video of Array.from(articleBody.querySelectorAll<HTMLVideoElement>('video[src]'))) {
        const src = video.getAttribute('src') || '';
        if (!/\/(?:m|mp)\/[A-Za-z0-9_-]{22}(?:[?#]|$)/.test(src)) continue;
        const status = document.createElement('div');
        status.className = 'my-3 flex min-h-36 items-center justify-center rounded-lg bg-muted p-6 text-center text-sm';
        status.textContent = 'Compactando vídeo em 1080p…';
        video.hidden = true;
        video.before(status);
        statusNodes.push(status);
        const check = async () => {
          try {
            const response = await fetch(src, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store' });
            if (!video.isConnected) return;
            if (response.ok) {
              video.hidden = false;
              status.remove();
              video.load();
              return;
            }
            if (response.status === 422 || response.status === 410) {
              status.textContent = 'Não foi possível processar este vídeo.';
              return;
            }
            const progress = response.headers.get('x-media-progress');
            status.textContent = progress && Number(progress) > 0
              ? `Compactando vídeo em 1080p — ${progress}%`
              : 'Compactando vídeo em 1080p…';
          } catch {
            // Rede oscilou; o próximo ciclo tenta de novo sem trocar o estado da publicação.
          }
          timers.push(window.setTimeout(check, 8_000));
        };
        void check();
      }
    }

    return () => {
      if (articleBody) {
        articleBody.removeEventListener('click', handleArticleClick);
      }
      timers.forEach((timer) => window.clearTimeout(timer));
      statusNodes.forEach((node) => node.remove());
    };
  }, [onImageClick, post.id]);

  if (!post) return null;

  if (post.isDeleted) {
    return (
      <div className="text-sm italic text-muted-foreground p-3 border border-dashed border-border rounded-md my-2">
        Post deleted by author.
      </div>
    );
  }

  const embeddedContent = post.originalPostDetails || post.quotedComment;
  const isPostQuote = !!post.originalPostDetails;
  const isCommentQuote = !!post.quotedComment;
  const hideSensitive = post.sensitive === true && !alwaysShowSensitive && !showSensitive;
  const detectedYoutubeId = !post.youtubeVideoId && post.category !== 'news' && post.text
    ? extractYoutubeVideoInfo(post.text).videoId
    : null;
  const effectiveYoutubeId = post.youtubeVideoId || detectedYoutubeId;
  const previewUrl =
    post.category !== 'news' &&
    !effectiveYoutubeId &&
    !isPostQuote &&
    !isCommentQuote &&
    !post.poll &&
    (!post.media || post.media.length === 0)
      ? extractFirstUrlFromText(post.text)
      : null;

  const handleImageClick = (e: React.MouseEvent, imageUrl: string) => {
    e.stopPropagation(); // Prevent card navigation
    if (imageUrl) {
      onImageClick(imageUrl);
    }
  };
  
  const renderFullArticleBody = () => {
    if (!post.text) return null;
    // Primeiro higieniza o HTML do autor (sem isso um artigo podia rodar script no navegador de quem lê); depois
    // acrescenta os links das hashtags, que são nossos.
    const processedHtml = linkifyHashtagsInHtml(sanitizeHtml(post.text), locale);
    return (
        <div 
          ref={articleBodyRef} 
          className="prose prose-sm dark:prose-invert max-w-none mb-3"
          dangerouslySetInnerHTML={{ __html: processedHtml }}
        />
    );
  };

  return (
    <>
      {post.category === 'news' && !isSinglePostView ? (
        <TopNewsItem newsItem={post} />
      ) : (
        <>
          {post.category === 'news' && post.headline && (
            <h2 className={cn("text-xl font-semibold text-foreground mb-1", isSinglePostView && "text-2xl")}>
              {post.headline}
            </h2>
          )}

          {post.category === 'news'
            ? renderFullArticleBody()
            : post.text && (
                <p className="text-sm text-foreground mb-3 whitespace-pre-wrap">
                  <TextWithMentions text={post.text} customEmojis={post.customEmojis} />
                </p>
              )}

          {post.location && (
            <div className="mb-3 flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="post-location">
              <MapPin className="h-4 w-4 text-primary" aria-hidden="true" />
              <span>{post.location.name}, {post.location.state}</span>
            </div>
          )}

          {post.poll && (
            <PostPoll
              postId={post.id}
              poll={post.poll}
              initialCounts={post.pollCounts}
              initialTotal={post.pollTotal}
              initialVote={post.myPollVote}
            />
          )}

          {effectiveYoutubeId && (
            <YoutubeEmbed videoId={effectiveYoutubeId} className="mb-3" />
          )}

          {previewUrl && (
            <div className="mb-3">
              <LinkPreviewCard url={previewUrl} />
            </div>
          )}

          {post.media && post.media.length > 0 && (
            <div className="relative mt-2 overflow-hidden rounded-lg border border-border">
               {/* Mídia sensível coberta NÃO baixa nem decodifica a mídia (antes ela era desfocada com `blur-2xl`, um filtro caro
                   a cada quadro de rolagem, e o desfoque do fundo da capa): fica só um bloco do mesmo tamanho e a capa. */}
               <div className={cn(
                  'grid gap-0.5',
                  hideSensitive && 'pointer-events-none select-none',
                  {
                    'grid-cols-1': post.media.length === 1,
                    'grid-cols-2': post.media.length > 1,
                  }
                )}>
                  {post.media.map((mediaItem, index) => {
                    const isThreeItems = post.media?.length === 3;
                    const isVideo = mediaItem.type === 'video';
                    const isSingleMedia = post.media?.length === 1;

                    // SINGLE MEDIA ITEM
                    if (isSingleMedia) {
                      return (
                        <div
                          key={mediaItem.url || index}
                          // Enquanto a imagem não chega o cartão já ocupa um espaço (não pula quando ela carrega); ao carregar,
                          // a reserva sai (veja onLoad) e a imagem volta ao seu tamanho natural.
                          className={cn('relative group cursor-pointer', !hideSensitive && !isVideo && 'aspect-[4/3] bg-muted')}
                          onClick={(e) => handleImageClick(e, mediaItem.url)}
                          data-interactive="true"
                        >
                          {hideSensitive ? (
                            <div className="aspect-[4/3] max-h-[50vh] w-full bg-muted" />
                          ) : isVideo ? (
                             <PlatformVideo src={mediaItem.url} className="w-full h-auto max-h-[50vh] object-cover" controls preload="metadata" onClick={(e) => e.stopPropagation()} />
                          ) : (
                            <img
                              src={mediaItem.url}
                              alt={mediaItem.alt || post.text?.substring(0,50) || `Media ${index + 1}`}
                              className="w-full h-auto max-h-[50vh] object-cover"
                              loading="lazy"
                              decoding="async"
                              onLoad={releaseImageReserve}
                              data-ai-hint={mediaItem['data-ai-hint'] || 'social media image'}
                            />
                          )}
                        </div>
                      )
                    }
                    
                    // MULTI MEDIA GRID
                    return (
                      <div 
                          key={mediaItem.url || index} 
                          className={cn(
                              "relative group cursor-pointer aspect-square bg-muted overflow-hidden rounded-sm",
                              {
                                'row-span-2 col-span-1': isThreeItems && index === 0,
                                'col-span-1 row-span-1': isThreeItems && index > 0,
                              }
                          )}
                          onClick={(e) => handleImageClick(e, mediaItem.url)}
                          data-interactive="true"
                      >
                          {hideSensitive ? null : isVideo ? (
                            <PlatformVideo src={mediaItem.url} className="h-full w-full object-cover" controls preload="metadata" onClick={(e) => e.stopPropagation()} />
                          ) : (
                            <Image
                              src={mediaItem.url} 
                              alt={mediaItem.alt || post.text?.substring(0,50) || `Media ${index + 1}`} 
                              fill 
                              sizes="(max-width: 640px) 100vw, 520px" 
                              className="object-cover"
                              data-ai-hint={mediaItem['data-ai-hint'] || 'social media image'} 
                            />
                          )}
                      </div>
                    )
                  })}
               </div>
               {hideSensitive && (
                 <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-background/80 p-5 text-center" data-testid="sensitive-cover">
                   <ShieldAlert className="h-7 w-7 text-destructive" aria-hidden="true" />
                   <p className="font-semibold">{contentT('sensitiveWarning')}</p>
                   <p className="max-w-sm text-xs text-muted-foreground">{contentT('sensitiveHint')}</p>
                   <Button type="button" variant="secondary" size="sm" onClick={(event) => { event.stopPropagation(); setShowSensitive(true); }}>
                     {contentT('showSensitive')}
                   </Button>
                 </div>
               )}
            </div>
          )}
            
            {isPostQuote && post.originalPostDetails && (
              <EmbeddedPostCard
                post={post.originalPostDetails as Post}
                onImageClick={onImageClick}
              />
            )}
            {isCommentQuote && post.quotedComment && (
               <EmbeddedPostCard
                comment={post.quotedComment}
                onImageClick={onImageClick}
              />
            )}


          {post.category === 'news' && post.sourceUrl && (
            <a
              href={post.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline flex items-center mt-2"
              onClick={(e) => e.stopPropagation()}
              data-interactive="true"
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              {t('source')}: {new URL(post.sourceUrl).hostname}
            </a>
          )}
        </>
      )}
    </>
  );
}
