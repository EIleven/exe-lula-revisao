// src/components/feed/CommentCard.tsx
'use client';

import type { Comment, Post, EmbeddedUserDetails } from '@/lib/types';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR, enUS } from 'date-fns/locale';
import { getCurrentUserId } from '@/lib/services/authService';
import TextWithMentions from '@/components/shared/TextWithMentions';
import LoginOrRegisterPromptDialog from '@/components/auth/LoginOrRegisterPromptDialog';
import { useCommentInteractions } from '@/hooks/features/comment/useCommentInteractions';
import CommentActionsBar from '../comments/CommentActionsBar';
import { CommentInteractionsDialog, type CommentInteractionTab } from '../comments/CommentInteractionsDialog';
import { Dialog } from '../ui/dialog';
import QuoteCommentDialogContent from './QuoteCommentDialogContent';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { Repeat2 } from 'lucide-react';
import EmbeddedPostCard from './EmbeddedPostCard';
import ReplyDialogContent from '../comments/ReplyDialogContent';
import { useToast } from '@/hooks/use-toast';
import { useLocale, useTranslations } from 'next-intl';
import UserProfileHoverCard from '@/components/profile/UserProfileHoverCard';
import ImageViewer from '../shared/ImageViewer';
import MediaGrid from '../shared/MediaGrid';
import TranslateActionLine from '@/components/shared/TranslateActionLine';
import { useTextTranslation } from '@/hooks/useTextTranslation';
import YoutubeEmbed from '@/components/shared/YoutubeEmbed';
import SensitiveMediaCover from '@/components/shared/SensitiveMediaCover';

interface CommentCardProps {
  comment: Comment & { depth?: number };
  onCommentAdded?: (newComment: Comment) => void;
  onPostCreated?: (newPost: Post) => void;
  onCommentDeleted?: (commentId: string) => void; // For unbookmarking
  parentPostAuthorId?: string | null;
  repostedBy?: EmbeddedUserDetails;
  repostedAt?: string;
  isFocused?: boolean;
  hasThreadLine?: boolean;
}

function CommentCard({
    comment: initialComment,
    onCommentAdded,
    onPostCreated,
    onCommentDeleted, // Receive prop
    parentPostAuthorId,
    repostedBy,
    repostedAt,
    isFocused = false,
    hasThreadLine = false,
}: CommentCardProps) {

   const t = useTranslations('CommentCard');
   const router = useRouter();
   const pathname = usePathname();
   const currentUserId = getCurrentUserId();
   const { toast } = useToast();
   const locale = useLocale();
   const { depth = 0 } = initialComment; // Default depth to 0 if not provided

   const [isReplyDialogOpen, setIsReplyDialogOpen] = useState(false);
   const [timeAgo, setTimeAgo] = useState('');
   const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
   const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
   const [interactionsDialogOpen, setInteractionsDialogOpen] = useState(false);
   const [interactionsInitialTab, setInteractionsInitialTab] = useState<CommentInteractionTab>('likes');

   const openInteractionsDialog = (e: React.MouseEvent, tab: CommentInteractionTab) => {
     e.stopPropagation();
     setInteractionsInitialTab(tab);
     setInteractionsDialogOpen(true);
   };

   const {
    comment,
    setComment,
    handleLike,
    isProcessingLike,
    handleBookmarkComment,
    isProcessingBookmark,
    handleRepostToggle,
    handleQuote,
    handleCopyText,
    handleDelete,
    handleMuteAuthor,
    handleBlockAuthor,
    handleReport,
    showLoginPrompt,
    loginPromptActionName,
    openLoginPrompt,
    closeLoginPrompt,
    handleSendViaDirect,
    handleShare,
    handleHideComment,
    isQuoteDialogOpen,
    setIsQuoteDialogOpen,
    handleUndoQuote,
  } = useCommentInteractions({
    initialComment,
    currentUserId,
    onPostCreated,
    onInteractionDeleted: onCommentDeleted,
  });

  const translation = useTextTranslation(!comment?.isDeleted ? comment?.text : null);

  useEffect(() => {
    if (comment?.createdAt) {
      const localeOptions = locale === 'pt-BR' ? { locale: ptBR } : { locale: enUS };
      const formatted = formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true, ...localeOptions });
      setTimeAgo(
        locale === 'pt-BR' ? formatted.replace('cerca de ', '') : formatted
      );
    } else {
      setTimeAgo('');
    }
  }, [comment?.createdAt, locale]);

  const handleCardNavigation = (e: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) => {
    if (!comment.parentPostId) return;
    const target = e.target as HTMLElement;

    let currentElement: HTMLElement | null = target;
    while (currentElement && currentElement !== e.currentTarget) {
        if (
            currentElement.tagName === 'A' ||
            currentElement.tagName === 'BUTTON' ||
            currentElement.tagName === 'TEXTAREA' ||
            currentElement.tagName === 'INPUT' ||
            currentElement.dataset.interactive === 'true' ||
            (currentElement.hasAttribute('role') && ['button', 'menuitem', 'dialog', 'link'].includes(currentElement.getAttribute('role')!))
        ) {
            return;
        }
        currentElement = currentElement.parentElement;
    }
    router.push(`/${locale}/post/${comment.parentPostId}?commentId=${comment.id}#focused-comment`);
  };
  
  const openImage = (url: string) => {
    setSelectedImageUrl(url);
    setIsImageViewerOpen(true);
  };

  const handleToggleReplyDialog = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUserId) {
        openLoginPrompt("reply to this comment");
        return;
    }
    // Simple permission check for now. A more robust one might be needed.
    if (comment.parentPostUser && !comment.parentPostUser.allowReposts && currentUserId !== comment.parentPostUser.userId) {
        toast({ title: "Cannot Reply", description: "The author has limited replies on this post.", variant: "destructive" });
        return;
    }
    setIsReplyDialogOpen(true);
  };

  const handleReplySubmitted = (newComment: Comment) => {
    setIsReplyDialogOpen(false);
    // After a successful reply, optimistically update the parent comment's reply count
    const updatedParentComment = {
      ...comment,
      repliesCount: (comment.repliesCount || 0) + 1,
    };
    setComment(updatedParentComment); // Update local state as well for immediate feedback
    onCommentAdded?.(newComment);
  };


  const commentAuthorName = comment.user?.name || 'User';
  const commentAuthorUsername = comment.user?.username || 'user';
  const commentAuthorAvatarUrl = comment.user?.avatarUrl;
  const commentAuthorAiHint = comment.user?.["data-ai-hint"] || "person avatar";
  const commentAuthorId = comment.user?.id;

  const actualParentPostAuthorId = parentPostAuthorId || comment.parentPostUser?.id;

  const isCommenterAuthorOfParentPost = !!(commentAuthorId && actualParentPostAuthorId && commentAuthorId === actualParentPostAuthorId);

  if (!comment || !comment.id) {
    return <div className="border-b p-4 text-sm text-muted-foreground">Comentário não pode ser carregado.</div>;
  }

  const displayUsername = commentAuthorUsername && commentAuthorUsername !== 'user' ? `@${commentAuthorUsername}` : (commentAuthorId ? '@user' : 'user');

  const handleQuoteSubmit = (newQuotePost: Post) => {
    setIsQuoteDialogOpen(false);
    if (onPostCreated) onPostCreated(newQuotePost);
    const updatedComment = { ...comment, repostsCount: (comment.repostsCount || 0) + 1, isQuotedByCurrentUser: true };
    setComment(updatedComment);
  }

  const contentToDisplayAsQuote = comment.quotedPostObject;

  return (
    <>
      <LoginOrRegisterPromptDialog
        open={showLoginPrompt}
        onOpenChange={closeLoginPrompt}
        actionName={loginPromptActionName}
        currentPath={pathname}
      />
      <ImageViewer
        isOpen={isImageViewerOpen}
        onOpenChange={setIsImageViewerOpen}
        imageUrl={selectedImageUrl}
        images={comment?.media?.filter((m) => m.type !== 'video' && m.url).map((m) => m.url) ?? []}
      />

      <Dialog open={isQuoteDialogOpen || isReplyDialogOpen} onOpenChange={(open) => {
        if(isQuoteDialogOpen && !open) setIsQuoteDialogOpen(false);
        if(isReplyDialogOpen && !open) setIsReplyDialogOpen(false);
      }}>
        <Card
            id={isFocused ? 'focused-comment' : `comment-${comment.id}`}
            className={cn(
                "w-full rounded-none border-x-0 overflow-hidden bg-card relative",
                isFocused
                  ? "border-l-2 border-l-primary bg-primary/[0.04] border-b"
                  : "hover:bg-card/95 transition-colors duration-150 cursor-pointer",
                !isFocused && (depth > 0 ? "" : "border-b")
            )}
            onClick={isFocused ? undefined : handleCardNavigation}
            onKeyDown={!isFocused ? (e) => (e.key === 'Enter' || e.key === ' ') && handleCardNavigation(e) : undefined}
            role={isFocused ? "article" : "link"}
            aria-label={`View post for comment by ${commentAuthorName}`}
            tabIndex={isFocused ? undefined : 0}
        >
            {repostedBy && (
            <div className="pt-2 px-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 flex-shrink-0" />
                <div className="text-xs text-muted-foreground" onClick={(e) => e.stopPropagation()} data-interactive="true">
                  <Repeat2 className="inline-block h-3 w-3 mr-1" />
                  {repostedBy.userId === currentUserId ? t('youReposted') : (
                    <>
                      <UserProfileHoverCard user={repostedBy as unknown as User}>
                        <Link href={`/${locale}/profile/${repostedBy.userId}`} className="hover:underline font-semibold text-foreground">
                          {repostedBy.name}
                        </Link>
                      </UserProfileHoverCard>
                      {' '}{t('reposted')}
                    </>
                  )}
                  {repostedAt && !Number.isNaN(new Date(repostedAt).getTime()) && (
                    <span className="ml-1 text-muted-foreground/80">
                      · {(() => {
                        const formatted = formatDistanceToNow(new Date(repostedAt), {
                          addSuffix: true,
                          locale: locale === 'pt-BR' ? ptBR : enUS,
                        });
                        return locale === 'pt-BR' ? formatted.replace('cerca de ', '') : formatted;
                      })()}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
            <div
                 className={cn(
                   "py-3 pr-3 sm:py-4 sm:pr-4 comment-depth-pad",
                   repostedBy && "pt-2"
                 )}
                 style={{ '--comment-depth': depth } as React.CSSProperties}
            >
                <div className={cn("flex items-start space-x-2.5 sm:space-x-3", depth > 0 && "border-l-2 border-border/60 pl-2.5 sm:pl-3")}>
                    <div className="shrink-0">
                         {commentAuthorId ? (
                            <UserProfileHoverCard user={comment.user}>
                                <Link href={`/${locale}/profile/${commentAuthorId}`} className="cursor-pointer" onClick={(e) => e.stopPropagation()} data-interactive="true">
                                    <Avatar className="h-8 w-8">
                                        <AvatarImage src={commentAuthorAvatarUrl} alt={commentAuthorName} data-ai-hint={commentAuthorAiHint} />
                                        <AvatarFallback>{commentAuthorName?.substring(0, 1)?.toUpperCase() || 'U'}</AvatarFallback>
                                    </Avatar>
                                </Link>
                            </UserProfileHoverCard>
                        ) : (
                             <Avatar className="h-8 w-8">
                                <AvatarFallback>{commentAuthorName?.substring(0, 1)?.toUpperCase() || 'U'}</AvatarFallback>
                            </Avatar>
                        )}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between">
                            <div className="flex flex-wrap items-baseline gap-x-2 min-w-0">
                                {commentAuthorId ? (
                                    <UserProfileHoverCard user={comment.user}>
                                        <Link href={`/${locale}/profile/${commentAuthorId}`} className="cursor-pointer hover:underline" onClick={(e) => e.stopPropagation()} data-interactive="true">
                                        <p className="text-sm font-semibold text-foreground truncate">{commentAuthorName}</p>
                                        </Link>
                                    </UserProfileHoverCard>
                                ) : (
                                    <p className="text-sm font-semibold text-foreground truncate">{commentAuthorName}</p>
                                )}
                                <p className="text-xs text-muted-foreground flex-shrink-0">
                                {commentAuthorId ? (
                                    <UserProfileHoverCard user={comment.user}>
                                        <Link href={`/${locale}/profile/${commentAuthorId}`} className="cursor-pointer hover:underline" onClick={(e) => e.stopPropagation()} data-interactive="true">
                                            <span className="truncate">{displayUsername}</span>
                                        </Link>
                                    </UserProfileHoverCard>
                                ) : (
                                    <span className="truncate">{displayUsername}</span>
                                )}
                                <span className="mx-1">·</span>
                                <span className="whitespace-nowrap">{timeAgo}</span>
                                </p>
                            </div>
                            {isCommenterAuthorOfParentPost && (
                                <Badge variant="outline" className="px-1.5 py-0.5 text-xs border-primary text-primary shrink-0 ml-2">{t('authorBadge')}</Badge>
                            )}
                        </div>
                        <div className="mt-2 space-y-2">
                            <p className="text-sm text-foreground whitespace-pre-wrap">
                              <TextWithMentions
                                text={(translation.isTranslated ? translation.translatedText : comment.text) || ''}
                              />
                            </p>
                            <TranslateActionLine
                              canTranslate={translation.canTranslate}
                              isTranslating={translation.isTranslating}
                              isTranslated={translation.isTranslated}
                              targetLabel={translation.targetLabel}
                              detectedSource={translation.detectedSource}
                              hasError={translation.hasError}
                              onToggle={translation.toggleTranslation}
                            />
                            {comment.media && comment.media.length > 0 && (
                              <SensitiveMediaCover
                                sensitive={comment.sensitive === true}
                                contentKey={comment.id}
                                compact
                                className="mt-2"
                              >
                                <MediaGrid
                                    media={comment.media}
                                    fallbackAlt={comment.text?.substring(0, 50)}
                                    onImageClick={openImage}
                                />
                              </SensitiveMediaCover>
                            )}
                            {comment.youtubeVideoId && (
                              <YoutubeEmbed videoId={comment.youtubeVideoId} className="mt-2" />
                            )}
                            {contentToDisplayAsQuote && (
                            <EmbeddedPostCard
                                post={contentToDisplayAsQuote}
                                truncateText={true}
                                className="mt-3"
                            />
                            )}
                        </div>
                        {isFocused && (
                          <div className="mt-3 pt-2.5 border-t border-border/70 space-y-2" data-interactive="true" onClick={(e) => e.stopPropagation()}>
                            {comment.createdAt && (
                              <div className="text-xs text-muted-foreground">
                                {format(new Date(comment.createdAt), "p · PP", { locale: locale === 'pt-BR' ? ptBR : enUS })}
                              </div>
                            )}
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 border-t border-border/60 text-xs sm:text-sm text-muted-foreground">
                              <button
                                type="button"
                                onClick={(e) => openInteractionsDialog(e, 'reposts')}
                                className="hover:underline focus:outline-none [touch-action:manipulation]"
                              >
                                <span className="font-semibold text-foreground">{comment.repostsCount || 0}</span>{' '}
                                {(comment.repostsCount || 0) === 1 ? 'repostagem' : 'repostagens'}
                              </button>
                              <button
                                type="button"
                                onClick={(e) => openInteractionsDialog(e, 'quotes')}
                                className="hover:underline focus:outline-none [touch-action:manipulation]"
                              >
                                <span className="font-semibold text-foreground">{(comment as Comment & { quotesCount?: number }).quotesCount || 0}</span>{' '}
                                {((comment as Comment & { quotesCount?: number }).quotesCount || 0) === 1 ? 'citação' : 'citações'}
                              </button>
                              <button
                                type="button"
                                onClick={(e) => openInteractionsDialog(e, 'likes')}
                                className="hover:underline focus:outline-none [touch-action:manipulation]"
                              >
                                <span className="font-semibold text-foreground">{comment.likes || 0}</span>{' '}
                                {(comment.likes || 0) === 1 ? 'curtida' : 'curtidas'}
                              </button>
                            </div>
                          </div>
                        )}
                        <CommentActionsBar
                            comment={comment}
                            onLike={handleLike}
                            isProcessingLike={isProcessingLike}
                            onBookmark={handleBookmarkComment}
                            isProcessingBookmark={isProcessingBookmark}
                            onReply={handleToggleReplyDialog}
                            onQuote={handleQuote}
                            onRepostToggle={handleRepostToggle}
                            onUndoQuote={handleUndoQuote}
                            onCopyText={handleCopyText}
                            onDelete={handleDelete}
                            onMuteAuthor={handleMuteAuthor}
                            onBlockAuthor={handleBlockAuthor}
                            onReport={handleReport}
                            onSendViaDirect={handleSendViaDirect}
                            onShare={handleShare}
                            onHideComment={handleHideComment}
                        />
                    </div>
                </div>
            </div>
        </Card>
        {isQuoteDialogOpen && (
          <QuoteCommentDialogContent
              originalComment={comment}
              onCommentQuoted={handleQuoteSubmit}
              dialogClose={() => setIsQuoteDialogOpen(false)}
          />
        )}
        {isReplyDialogOpen && (
            <ReplyDialogContent
                parentComment={comment}
                onReplySubmitted={handleReplySubmitted}
                dialogClose={() => setIsReplyDialogOpen(false)}
            />
        )}
      </Dialog>
      <CommentInteractionsDialog
        open={interactionsDialogOpen}
        onOpenChange={setInteractionsDialogOpen}
        comment={comment}
        currentUserId={currentUserId}
        initialTab={interactionsInitialTab}
      />
    </>
  );
}

// O cartão de comentário só se redesenha quando o seu comentário (ou as funções recebidas) mudar.
export default React.memo(CommentCard);
