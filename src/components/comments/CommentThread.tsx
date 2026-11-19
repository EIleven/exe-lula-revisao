// src/components/comments/CommentThread.tsx
import React, { useState } from 'react';
import type { Comment as CommentType, User, EmbeddedUserDetails, Post } from '@/lib/types'; 
import Link from 'next/link';
import Image from 'next/image'; 
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge'; 
import {
    MoreHorizontal,
    Loader2,
    Trash2
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR, enUS } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import TextWithMentions from '@/components/shared/TextWithMentions';
import { useToast } from "@/hooks/use-toast";
import { useCommentInteractions } from '@/hooks/features/comment/useCommentInteractions';
import { useLocale } from 'next-intl';

import CommentActionsBar from '@/components/comments/CommentActionsBar';
import ReplyDialogContent from '@/components/comments/ReplyDialogContent';
import QuoteCommentDialogContent from '../feed/QuoteCommentDialogContent';
import { Dialog } from '../ui/dialog';
import ImageViewer from '../shared/ImageViewer';
import MediaGrid from '../shared/MediaGrid';
import SensitiveMediaCover from '../shared/SensitiveMediaCover';
import UserProfileHoverCard from '@/components/profile/UserProfileHoverCard';

interface CommentThreadProps {
  comment: CommentType & { depth: number };
  postAuthorId: string;
  currentUserId: string | null;
  canCurrentUserReplyToPost: boolean;
  isSinglePostView: boolean;
  onCommentUpdated?: (updatedComment: CommentType) => void;
  onPostCreated?: (newPost: any) => void;
  openLoginPrompt: (actionName: string) => void;
}

export default function CommentThread({
  comment: initialComment,
  postAuthorId,
  currentUserId,
  canCurrentUserReplyToPost,
  isSinglePostView,
  onCommentUpdated,
  onPostCreated,
  openLoginPrompt,
}: CommentThreadProps) {
  const [isReplyDialogOpen, setIsReplyDialogOpen] = useState(false);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const locale = useLocale();

  const { toast } = useToast();
  
  const {
    comment,
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
    onCommentUpdated,
    onPostCreated,
  });

  const { depth, userId, user, authorDetails, createdAt, text, parentCommentId, parentPostUser, parentPostAuthorDetails, imageUrl, youtubeVideoId, isDeleted } = comment;

  const onToggleReply = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUserId) {
        openLoginPrompt("reply to this comment");
        return;
    }
    if (!canCurrentUserReplyToPost && currentUserId !== postAuthorId) {
        toast({ title: "Cannot Reply", description: "You do not have permission to reply to comments on this post.", variant: "destructive" });
        return;
    }
    setIsReplyDialogOpen(true);
  };
  
  const handleReplySubmitted = (newComment: CommentType) => {
    setIsReplyDialogOpen(false);
  }


  const commentAuthorName = user?.name || authorDetails?.name || 'User';
  const commentAuthorUsername = user?.username || authorDetails?.username;
  const commentAuthorAvatarUrl = user?.avatarUrl || authorDetails?.avatarUrl;
  const commentAuthorAiHint = user?.["data-ai-hint"] || authorDetails?.["data-ai-hint"] || "person avatar";
  const commentAuthorIdToUse = user?.id || authorDetails?.userId;
  const isRemoteFediverse = Boolean((comment as { isRemoteFediverse?: boolean }).isRemoteFediverse) || (commentAuthorIdToUse?.startsWith('ap:') ?? false);
  const remoteProfileHref = isRemoteFediverse && commentAuthorUsername
    ? `/${locale}/fediverse/${encodeURIComponent(commentAuthorUsername)}`
    : null;
  const authorProfileHref = remoteProfileHref || (commentAuthorIdToUse ? `/${locale}/profile/${commentAuthorIdToUse}` : null);

  const displayCommentUsername = commentAuthorUsername ? `@${commentAuthorUsername}` : (commentAuthorIdToUse ? '@user' : 'user');

  const actualParentCommentAuthorUsername = comment.parentCommentAuthorDetails?.username;
  const actualParentCommentAuthorId = comment.parentCommentAuthorDetails?.userId;

  const isCommenterAuthorOfMainPost = !!(commentAuthorIdToUse && postAuthorId && commentAuthorIdToUse === postAuthorId);

  const stopPropagation = (e: React.MouseEvent | Event) => e.stopPropagation();

  const handleImageClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if(imageUrl) {
        setSelectedImageUrl(imageUrl);
        setIsImageViewerOpen(true);
    }
  };

  const timeAgoString = isSinglePostView && createdAt
    ? format(new Date(createdAt), "p · PP", { locale: locale === 'pt-BR' ? ptBR : enUS })
    : (createdAt ? formatDistanceToNow(new Date(createdAt), { addSuffix: true, locale: locale === 'pt-BR' ? ptBR : enUS }) : 'some time ago');
    
  const finalTimeAgo = isSinglePostView ? timeAgoString : (locale === 'pt-BR' ? timeAgoString.replace('cerca de ', '') : timeAgoString);


  if (isDeleted || !user) {
    return (
        <div 
          className={cn("flex items-start space-x-2 comment-depth-margin", depth > 0 && "border-l-2 border-border/60 pl-2.5 sm:pl-3")}
          style={{ '--comment-depth': depth } as React.CSSProperties}
        >
            <div className="flex-1 p-2 rounded-md min-w-0 text-xs text-muted-foreground italic flex items-center">
                <Trash2 className="h-3 w-3 mr-2 flex-shrink-0"/>
                [Comment deleted by author]
            </div>
        </div>
    );
  }

  return (
    <>
    <ImageViewer
        isOpen={isImageViewerOpen}
        onOpenChange={setIsImageViewerOpen}
        imageUrl={selectedImageUrl}
        postUrl={comment ? `${window.location.origin}/${locale}/post/${comment.parentPostId}` : undefined}
    />
    <Dialog open={isQuoteDialogOpen || isReplyDialogOpen} onOpenChange={(open) => {
      if(isQuoteDialogOpen && !open) setIsQuoteDialogOpen(false);
      if(isReplyDialogOpen && !open) setIsReplyDialogOpen(false);
    }}>
      <div className="relative">
        <div
          className={cn("flex items-start space-x-2 comment-depth-margin", depth > 0 && "border-l-2 border-border/60 pl-2.5 sm:pl-3")}
          style={{ '--comment-depth': depth } as React.CSSProperties}
        >
          {commentAuthorIdToUse ? (
              <UserProfileHoverCard user={user}>
                <Link href={`/${locale}/profile/${commentAuthorIdToUse}`} className="cursor-pointer shrink-0 z-10" onClick={stopPropagation} data-interactive="true">
                <Avatar className="h-8 w-8">
                    <AvatarImage src={commentAuthorAvatarUrl} alt={commentAuthorName} data-ai-hint={commentAuthorAiHint}/>
                    <AvatarFallback>{commentAuthorName.substring(0, 1)?.toUpperCase() || 'U'}</AvatarFallback>
                </Avatar>
                </Link>
              </UserProfileHoverCard>
          ) : (
              <Avatar className="h-8 w-8 shrink-0 z-10">
                  <AvatarFallback>U</AvatarFallback>
              </Avatar>
          )}

          <div className="flex-1 bg-card p-2 rounded-md shadow-sm min-w-0 border border-border">
            <div className="flex items-start justify-between">
                <div className="flex flex-wrap items-baseline gap-x-2 min-w-0">
                    {authorProfileHref ? (
                        isRemoteFediverse ? (
                            <Link href={authorProfileHref} className="cursor-pointer hover:underline" onClick={stopPropagation} data-interactive="true">
                                <p className="text-sm font-semibold text-foreground truncate">{commentAuthorName}</p>
                            </Link>
                        ) : (
                            <UserProfileHoverCard user={user}>
                                <Link href={authorProfileHref} className="cursor-pointer hover:underline" onClick={stopPropagation} data-interactive="true">
                                    <p className="text-sm font-semibold text-foreground truncate">{commentAuthorName}</p>
                                </Link>
                            </UserProfileHoverCard>
                        )
                    ) : (
                        <p className="text-sm font-semibold text-foreground truncate">{commentAuthorName}</p>
                    )}
                    {isRemoteFediverse && (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">Fediverso</Badge>
                    )}
                    <p className="text-xs text-muted-foreground flex-shrink-0">
                        {commentAuthorUsername && authorProfileHref ? (
                            isRemoteFediverse ? (
                                <Link href={authorProfileHref} className="cursor-pointer hover:underline" onClick={stopPropagation} data-interactive="true">
                                    <span className="truncate">{displayCommentUsername}</span>
                                </Link>
                            ) : (
                                <UserProfileHoverCard user={user}>
                                    <Link href={authorProfileHref} className="cursor-pointer hover:underline" onClick={stopPropagation} data-interactive="true">
                                        <span className="truncate">{displayCommentUsername}</span>
                                    </Link>
                                </UserProfileHoverCard>
                            )
                        ) : (
                            <span className="truncate">{displayCommentUsername}</span>
                        )}
                        <span className="mx-1">&middot;</span>
                        <span className="whitespace-nowrap">{finalTimeAgo}</span>
                    </p>
                </div>
                {isCommenterAuthorOfMainPost && (
                    <Badge variant="outline" className="px-1.5 py-0.5 text-xs border-primary text-primary shrink-0 ml-2">Author</Badge>
                )}
            </div>

            {parentCommentId && actualParentCommentAuthorUsername && actualParentCommentAuthorId && (
              <p className="text-xs text-muted-foreground mb-1 truncate">
                Replying to <UserProfileHoverCard user={{ id: actualParentCommentAuthorId, username: actualParentCommentAuthorUsername } as User}><Link href={`/${locale}/profile/${actualParentCommentAuthorId}`} className="hover:underline text-primary" onClick={stopPropagation} data-interactive="true">@{actualParentCommentAuthorUsername}</Link></UserProfileHoverCard>
              </p>
            )}

            {(comment.media && comment.media.length > 0) ? (
              <SensitiveMediaCover
                sensitive={comment.sensitive === true}
                contentKey={comment.id}
                compact
                className="mt-2"
              >
                <MediaGrid
                  media={comment.media}
                  fallbackAlt={text?.substring(0, 50)}
                  onImageClick={(url) => {
                    setSelectedImageUrl(url);
                    setIsImageViewerOpen(true);
                  }}
                />
              </SensitiveMediaCover>
            ) : imageUrl ? (
              <SensitiveMediaCover
                sensitive={comment.sensitive === true}
                contentKey={comment.id}
                compact
                className="mt-2"
              >
                <div
                  className="rounded-md overflow-hidden border border-border aspect-video relative cursor-pointer group"
                  onClick={handleImageClick}
                  data-interactive="true"
                >
                  <Image
                    src={imageUrl}
                    alt="Comment image"
                    layout="fill"
                    objectFit="cover"
                    className="group-hover:opacity-90 transition-opacity"
                    data-ai-hint={comment["data-ai-hint"] || "image content"}
                  />
                </div>
              </SensitiveMediaCover>
            ) : null}
            {youtubeVideoId && (
              <div className="mt-2 aspect-video w-full rounded-lg overflow-hidden border border-border">
                  <iframe
                      width="100%"
                      height="100%"
                      src={`https://www.youtube.com/embed/${youtubeVideoId}`}
                      title="YouTube video player"
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                  ></iframe>
              </div>
            )}
            <p className="text-xs text-foreground mt-1 whitespace-pre-wrap"><TextWithMentions text={text} /></p>

            {(authorDetails || user) && (
              <CommentActionsBar 
                  comment={comment}
                  onLike={handleLike} 
                  isProcessingLike={isProcessingLike}
                  onBookmark={handleBookmarkComment}
                  isProcessingBookmark={isProcessingBookmark}
                  onReply={onToggleReply} 
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
            )}
          </div>
        </div>
      </div>
      {isQuoteDialogOpen && (
        <QuoteCommentDialogContent
          originalComment={comment}
          onCommentQuoted={(newPost: Post) => {
              if (onPostCreated) onPostCreated(newPost);
              setIsQuoteDialogOpen(false);
          }}
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
    </>
  );
}
