// src/components/feed/PostCardContent.tsx
'use client';

import React, { useRef, useEffect, Fragment } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import { Accessibility, Check, ExternalLink, Loader2, Newspaper, MapPin } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
import SensitiveMediaCover from '@/components/shared/SensitiveMediaCover';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { playbackKey } from '@/lib/media/videoPlaybackState';
import { buildMixedMediaQueue, findStartIndex, videoQueueMemory, type QueueEntry } from '@/lib/media/videoQueue';
import { PROFILE_MEDIA_CONTEXT, useVideoQueueSource } from '@/contexts/VideoQueueContext';

// O teatro de vídeo só é baixado quando alguém abre um (não pesa em nenhum feed).
const ExeLulaVideoTheater = dynamic(() => import('@/components/shared/theater/ExeLulaVideoTheater'), { ssr: false });
import LinkPreviewCard, { extractFirstUrlFromText } from '@/components/shared/LinkPreviewCard';
import { extractYoutubeVideoInfo } from '@/lib/utils/youtubeLinks';

interface PostCardContentProps {
  post: Post;
  isSinglePostView?: boolean;
  onImageClick: (imageUrl: string) => void;
  currentUserId?: string | null;
  onOpenAltTextEditor?: () => void;
  onRequestAltText?: (e: React.MouseEvent) => void;
  altRequested?: boolean;
  isRequestingAltText?: boolean;
}

function MediaAltBadge({
  altText,
  isAuthor,
  canRequestAltText,
  altRequested,
  isRequestingAltText,
  onOpenAltTextEditor,
  onRequestAltText,
}: {
  altText?: string | null;
  isAuthor: boolean;
  canRequestAltText: boolean;
  altRequested?: boolean;
  isRequestingAltText?: boolean;
  onOpenAltTextEditor?: () => void;
  onRequestAltText?: (e: React.MouseEvent) => void;
}) {
  const cleanAlt = typeof altText === 'string' ? altText.trim() : '';

  if (cleanAlt) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            data-interactive="true"
            aria-label="Ver descrição alternativa da imagem"
            title="Ver descrição alternativa (Alt Text)"
            className="absolute bottom-2 left-2 z-10 inline-flex items-center gap-1 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-white border border-white/15 backdrop-blur-sm hover:bg-black/90 transition-colors"
          >
            ALT
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          onClick={(e) => e.stopPropagation()}
          data-interactive="true"
          className="w-72 max-w-[85vw] p-3 text-xs leading-relaxed space-y-1.5"
        >
          <div className="flex items-center gap-1.5 font-semibold text-foreground">
            <Accessibility className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            <span>Descrição da imagem (Alt Text)</span>
          </div>
          <p className="text-muted-foreground whitespace-pre-wrap break-words">{cleanAlt}</p>
        </PopoverContent>
      </Popover>
    );
  }

  if (isAuthor && onOpenAltTextEditor) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenAltTextEditor();
        }}
        data-interactive="true"
        title="Adicionar descrição alternativa (Alt Text)"
        className="absolute bottom-2 left-2 z-10 inline-flex items-center gap-1 rounded-full bg-black/75 px-2 py-0.5 text-[11px] font-semibold text-white border border-white/20 backdrop-blur-sm hover:bg-primary hover:border-primary transition-colors"
      >
        <Accessibility className="h-3 w-3 text-emerald-400" />
        + ALT
      </button>
    );
  }

  if (canRequestAltText && onRequestAltText) {
    return (
      <button
        type="button"
        disabled={Boolean(altRequested || isRequestingAltText)}
        onClick={(e) => {
          e.stopPropagation();
          onRequestAltText(e);
        }}
        data-interactive="true"
        title={
          altRequested
            ? 'Solicitação de Alt Text já enviada ao autor'
            : 'Notificar quem postou para adicionar descrição (Alt Text)'
        }
        className={cn(
          'absolute bottom-2 left-2 z-10 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium backdrop-blur-sm border transition-colors',
          altRequested
            ? 'bg-emerald-950/85 text-emerald-200 border-emerald-500/50 cursor-default'
            : 'bg-black/70 text-white/95 border-white/20 hover:bg-black/90 hover:border-primary/70'
        )}
      >
        {isRequestingAltText ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : altRequested ? (
          <Check className="h-3 w-3 text-emerald-400" />
        ) : (
          <Accessibility className="h-3 w-3 text-amber-300" />
        )}
        <span>{altRequested ? 'Alt pedido' : 'Sem ALT · Pedir'}</span>
      </button>
    );
  }

  return null;
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
  currentUserId,
  onOpenAltTextEditor,
  onRequestAltText,
  altRequested = false,
  isRequestingAltText = false,
}: PostCardContentProps) {
  const viewerIdFromCtx = useCurrentUserSelector((s) => s.currentUser?.id ?? null);
  const viewerId = currentUserId !== undefined ? currentUserId : viewerIdFromCtx;
  const isAuthor = Boolean(viewerId && post.userId === viewerId);
  const isLocalPost = !post.id.startsWith('ap_') && Boolean(post.userId) && !post.userId.startsWith('ap_');
  const canRequestAltText = isLocalPost && !isAuthor;
  const articleBodyRef = useRef<HTMLDivElement>(null);
  const locale = useLocale();
  const router = useRouter();
  const queueSource = useVideoQueueSource();
  const [theater, setTheater] = React.useState<{ entries: QueueEntry<Post>[]; start: number } | null>(null);
  // Ao fechar o teatro os players deste cartão são remontados: releem a posição que o teatro guardou (o vídeo continua do mesmo segundo).
  const [videoEpoch, setVideoEpoch] = React.useState(0);
  const closeTheater = React.useCallback(() => {
    setTheater(null);
    setVideoEpoch((e) => e + 1);
  }, []);

  /** A fila do teatro: a lista mista (vídeos + imagens) de onde a pessoa veio; sem lista, só este post. */
  const openTheater = (mediaUrl: string): boolean => {
    const remembered = isSinglePostView ? videoQueueMemory.recall<Post>(post.id) : null;
    const lista: readonly Post[] = !isSinglePostView && queueSource ? queueSource.getPosts() : remembered ? remembered.posts : [post];
    let entries = buildMixedMediaQueue<Post>(lista);
    let start = findStartIndex(entries, post.id, mediaUrl);
    if (start < 0) {
      entries = buildMixedMediaQueue<Post>([post]);
      start = findStartIndex(entries, post.id, mediaUrl);
    }
    if (entries.length === 0 || start < 0) return false;
    setTheater({ entries, start });
    return true;
  };

  /**
   * O toque na SUPERFÍCIE do vídeo ou imagem abre o modo imersivo (teatro) direto com rolagem contínua.
   * Conteúdo sensível ou apagado não entra no teatro.
   */
  const surfaceHandler = (mediaUrl: string): (() => void) | undefined => {
    if (!post.id) return undefined;
    const elegivel = post.sensitive !== true && post.isDeleted !== true;
    if (isSinglePostView) return elegivel ? () => void openTheater(mediaUrl) : undefined;
    return () => {
      if (elegivel && queueSource?.context === PROFILE_MEDIA_CONTEXT && openTheater(mediaUrl)) return;
      if (elegivel && openTheater(mediaUrl)) return;
      videoQueueMemory.remember(queueSource?.context ?? 'feed', queueSource ? queueSource.getPosts() : []);
      router.push(`/${locale}/post/${post.id}`);
    };
  };
  const t = useTranslations('TopNewsItem');

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
      if (post.sensitive !== true && post.isDeleted !== true && openTheater(imageUrl)) {
        return;
      }
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

  const rawPostText = post.text ?? '';
  // Mantém a URL no banco e no envio federado (Fediverso/Bluesky), mas oculta o link bruto duplicado no cartão
  // quando o cartão de incorporação/prévia já está sendo exibido.
  const displayPostText = React.useMemo(() => {
    if (!rawPostText || post.category === 'news') return rawPostText;
    if (previewUrl) {
      return rawPostText.replace(previewUrl, '').replace(/\n{3,}/g, '\n\n').trim();
    }
    if (isPostQuote) {
      return rawPostText.replace(/\s*https?:\/\/[^\s]+\s*$/, '').trim();
    }
    return rawPostText;
  }, [rawPostText, post.category, previewUrl, isPostQuote]);

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
            : displayPostText && (
                <p className="text-sm text-foreground mb-3 whitespace-pre-wrap">
                  <TextWithMentions text={displayPostText} customEmojis={post.customEmojis} />
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
            <>
              <SensitiveMediaCover sensitive={post.sensitive === true} contentKey={post.id} className="mt-2">
                {(hideSensitive) => (
                  <div className={cn(
                      'grid gap-0.5',
                      hideSensitive && 'pointer-events-none select-none',
                      {
                        'grid-cols-1': post.media!.length === 1,
                        'grid-cols-2': post.media!.length > 1,
                      }
                    )}>
                    {post.media!.map((mediaItem, index) => {
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
                               <div className="w-full bg-black flex items-center justify-center">
                                 <PlatformVideo src={mediaItem.url} className="w-full h-auto max-h-[65vh] object-contain" controls playsInline preload="metadata" onClick={(e) => e.stopPropagation()} themed playbackKey={playbackKey(post.id, mediaItem.url)} onSurfaceClick={surfaceHandler(mediaItem.url)} autoplayOnResume={isSinglePostView} suspended={theater !== null} key={`${mediaItem.url}:${videoEpoch}`} />
                               </div>
                            ) : (
                              <>
                                <img
                                  src={mediaItem.url}
                                  alt={mediaItem.alt || post.text?.substring(0,50) || `Media ${index + 1}`}
                                  className="w-full h-auto max-h-[50vh] object-cover"
                                  loading="lazy"
                                  decoding="async"
                                  onLoad={releaseImageReserve}
                                  data-ai-hint={mediaItem['data-ai-hint'] || 'social media image'}
                                />
                                <MediaAltBadge
                                  altText={mediaItem.alt}
                                  isAuthor={isAuthor}
                                  canRequestAltText={canRequestAltText}
                                  altRequested={altRequested}
                                  isRequestingAltText={isRequestingAltText}
                                  onOpenAltTextEditor={onOpenAltTextEditor}
                                  onRequestAltText={onRequestAltText}
                                />
                              </>
                            )}
                          </div>
                        );
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
                              <PlatformVideo src={mediaItem.url} className="h-full w-full object-contain bg-black" controls playsInline preload="metadata" onClick={(e) => e.stopPropagation()} themed playbackKey={playbackKey(post.id, mediaItem.url)} onSurfaceClick={surfaceHandler(mediaItem.url)} autoplayOnResume={isSinglePostView} suspended={theater !== null} key={`${mediaItem.url}:${videoEpoch}`} />
                            ) : (
                              <>
                                <Image
                                  src={mediaItem.url}
                                  alt={mediaItem.alt || post.text?.substring(0,50) || `Media ${index + 1}`}
                                  fill
                                  sizes="(max-width: 640px) 100vw, 520px"
                                  className="object-cover"
                                  data-ai-hint={mediaItem['data-ai-hint'] || 'social media image'}
                                />
                                <MediaAltBadge
                                  altText={mediaItem.alt}
                                  isAuthor={isAuthor}
                                  canRequestAltText={canRequestAltText}
                                  altRequested={altRequested}
                                  isRequestingAltText={isRequestingAltText}
                                  onOpenAltTextEditor={onOpenAltTextEditor}
                                  onRequestAltText={onRequestAltText}
                                />
                              </>
                            )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </SensitiveMediaCover>
              {theater && (
                <ExeLulaVideoTheater entries={theater.entries} startIndex={theater.start} onClose={closeTheater} />
              )}
            </>
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
