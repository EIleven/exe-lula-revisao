// src/components/comments/CommentActionsBar.tsx
'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Heart, MessageCircle, Repeat2, Edit3, Bookmark, Loader2 } from 'lucide-react';
import type { Comment } from '@/lib/types';
import { cn } from '@/lib/utils';
import CommentOptionsMenu from './CommentOptionsMenu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import AnimatedCounter from '@/components/shared/AnimatedCounter';

interface CommentActionsBarProps {
  comment: Comment;
  onLike: (e: React.MouseEvent) => Promise<void>;
  onBookmark: (e: React.MouseEvent) => void;
  onReply: (e: React.MouseEvent) => void;
  onQuote: (e: React.MouseEvent) => void;
  onRepostToggle: (e: React.MouseEvent | Event) => void;
  onUndoQuote: (e: React.MouseEvent | Event) => void;
  onCopyText: (event: React.MouseEvent) => void;
  onMuteAuthor: (event: React.MouseEvent) => Promise<void>;
  onBlockAuthor: (event: React.MouseEvent) => Promise<void>;
  onReport: (event: React.MouseEvent) => Promise<void>;
  onDelete: (event: React.MouseEvent) => Promise<void>;
  onSendViaDirect: (event: React.MouseEvent) => void;
  onShare: (event: React.MouseEvent) => void;
  onHideComment: (event: React.MouseEvent) => void;
  isProcessingLike: boolean;
  isProcessingBookmark: boolean;
}

export default function CommentActionsBar({
  comment,
  onLike,
  onBookmark,
  onReply,
  onQuote,
  onRepostToggle,
  onUndoQuote,
  onCopyText,
  onMuteAuthor,
  onBlockAuthor,
  onReport,
  onDelete,
  onSendViaDirect,
  onShare,
  onHideComment,
  isProcessingLike,
  isProcessingBookmark,
}: CommentActionsBarProps) {
  const isMobile = useIsMobile();
  const { currentUser } = useCurrentUser();
  const currentUserId = currentUser?.id ?? null;
  const [isRepostSheetOpen, setIsRepostSheetOpen] = useState(false);
  const hasUserInteracted = comment.isQuotedByCurrentUser || comment.isReposted;
  const totalRepostsAndQuotes = (comment.repostsCount || 0);
  // Comentário de post só para seguidores não é repostado nem citado (o servidor recusa): a opção fica desabilitada e
  // explicada, em vez de parecer disponível e falhar com erro de permissão.
  const isRestricted = (comment.postVisibility ?? 'public') !== 'public' && comment.postAuthorId !== currentUserId;
  const restrictedReason = 'Este comentário é de um post só para seguidores: não pode ser repostado nem citado.';

  // Função que devolve o JSX (e NÃO um componente declarado aqui dentro): um componente novo a cada render faria o React
  // desmontar e montar de novo o botão a cada mudança de contador, fechando o menu aberto e perdendo o foco.
  const renderRepostAndQuoteButton = () => {
    if (isMobile) {
      return (
        <Sheet open={isRepostSheetOpen} onOpenChange={setIsRepostSheetOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "flex items-center space-x-1 px-1.5 sm:px-2.5 h-8 hover-repost [touch-action:manipulation]",
                hasUserInteracted ? "text-[hsl(var(--repost))]" : "text-muted-foreground"
              )}
              onClick={(e) => e.stopPropagation()}
              data-interactive="true"
              aria-pressed={!!hasUserInteracted}
            >
              <Repeat2 className={cn("h-4 w-4", hasUserInteracted && "fill-current")} />
              <AnimatedCounter count={totalRepostsAndQuotes} className="text-xs" />
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="rounded-t-lg p-4" onClick={(e) => e.stopPropagation()} data-interactive="true">
            <SheetHeader className="sr-only">
              <SheetTitle>Opções de Repost</SheetTitle>
              <SheetDescription>Escolha entre repostar ou citar este comentário.</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                className="w-full justify-start text-base py-6"
                onClick={(e) => {
                  onRepostToggle(e);
                  setIsRepostSheetOpen(false);
                }}
                disabled={!comment.userId || (isRestricted && !comment.isReposted)}
                title={isRestricted ? restrictedReason : undefined}
              >
                <Repeat2 className={cn("mr-2 h-4 w-4", comment.isReposted && "fill-current text-[hsl(var(--repost))]")} />
                {comment.isReposted ? "Desfazer Repost" : "Repostar Comentário"}
              </Button>
              {comment.isQuotedByCurrentUser ? (
                <Button variant="outline" className="w-full justify-start text-base py-6 text-destructive" onClick={(e) => { onUndoQuote(e); setIsRepostSheetOpen(false); }} disabled={!comment.userId} >
                  <Edit3 className="mr-2 h-4 w-4" />
                  Desfazer Citação
                </Button>
              ) : (
                <Button
                  variant="outline"
                  className="w-full justify-start text-base py-6"
                  onClick={(e) => {
                    onQuote(e);
                    setIsRepostSheetOpen(false);
                  }}
                  disabled={!comment.userId || isRestricted}
                  title={isRestricted ? restrictedReason : undefined}
                >
                  <Edit3 className="mr-2 h-4 w-4" />
                  Citar Comentário
                </Button>
              )}
            </div>
          </SheetContent>
        </Sheet>
      );
    }
    
    // Desktop version
    return (
       <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "flex items-center space-x-1 px-1.5 sm:px-2.5 h-8 hover-repost [touch-action:manipulation]",
              hasUserInteracted ? "text-[hsl(var(--repost))]" : "text-muted-foreground"
            )}
            onClick={(e) => e.stopPropagation()}
            data-interactive="true"
            aria-pressed={!!hasUserInteracted}
            aria-label={hasUserInteracted ? "You've interacted with this" : "Repost or Quote"}
          >
            <Repeat2 className={cn("h-4 w-4", hasUserInteracted && "fill-current")} />
            <AnimatedCounter count={totalRepostsAndQuotes} className="text-xs" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" onClick={(e) => e.stopPropagation()} data-interactive="true">
            <DropdownMenuItem
              onSelect={onRepostToggle}
              data-interactive="true"
              disabled={!comment.userId || (isRestricted && !comment.isReposted)}
              title={isRestricted ? restrictedReason : undefined}
              className={cn(comment.isReposted && "text-[hsl(var(--repost))]")}
            >
              <Repeat2 className="mr-2 h-4 w-4" />
              {comment.isReposted ? "Desfazer Repost" : "Repostar Comentário"}
            </DropdownMenuItem>
            {comment.isQuotedByCurrentUser ? (
                <DropdownMenuItem onSelect={onUndoQuote} className="text-destructive focus:text-destructive focus:bg-destructive/10" data-interactive="true" disabled={!comment.userId}>
                  <Edit3 className="mr-2 h-4 w-4" />
                  Desfazer Citação
                </DropdownMenuItem>
            ) : (
                 <DropdownMenuItem
                  onSelect={onQuote}
                  data-interactive="true"
                  disabled={!comment.userId || isRestricted}
                  title={isRestricted ? restrictedReason : undefined}
                >
                  <Edit3 className="mr-2 h-4 w-4" />
                  Citar Comentário
                </DropdownMenuItem>
            )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <div className="flex w-full items-center justify-between gap-1 mt-1.5 pt-1 min-w-0">
      <Button
        variant="ghost"
        size="sm"
        className="flex items-center space-x-1 px-1.5 sm:px-2.5 h-8 text-muted-foreground hover-comment [touch-action:manipulation]"
        onClick={onReply}
        data-interactive="true"
        title="Reply to comment"
      >
        <MessageCircle className="h-4 w-4" />
        <AnimatedCounter count={comment.repliesCount || 0} className="text-xs" />
      </Button>
      
      {renderRepostAndQuoteButton()}

      <Button
        variant="ghost"
        size="sm"
        className={cn('flex items-center space-x-1 px-1.5 sm:px-2.5 h-8 hover-like [touch-action:manipulation]', {
          'text-[hsl(var(--like))]': comment.isLiked,
          'text-muted-foreground': !comment.isLiked,
        })}
        onClick={onLike}
        data-interactive="true"
        title={comment.isLiked ? 'Unlike comment' : 'Like comment'}
        aria-pressed={!!comment.isLiked}
      >
        <Heart
          className={cn('h-4 w-4 like-icon', {
            'fill-current': comment.isLiked,
          })}
        />
        <AnimatedCounter count={comment.likes || 0} className="text-xs" />
      </Button>
      
      <div className="flex items-center gap-0.5 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBookmark}
          className={cn('h-8 w-8 hover:bg-blue-500/10 [touch-action:manipulation]', {
            'text-blue-500': comment.isBookmarked,
            'text-muted-foreground': !comment.isBookmarked,
          })}
          data-interactive="true"
          aria-pressed={!!comment.isBookmarked}
          title={comment.isBookmarked ? "Remove Bookmark" : "Bookmark"}
        >
          <Bookmark className={cn('h-4 w-4', { 'fill-current': comment.isBookmarked })} />
        </Button>
        <CommentOptionsMenu
          comment={comment}
          onCopyText={onCopyText}
          onMuteAuthor={onMuteAuthor}
          onBlockAuthor={onBlockAuthor}
          onReport={onReport}
          onDelete={onDelete}
          onSendViaDirect={onSendViaDirect}
          onShare={onShare}
          onHideComment={onHideComment}
        />
      </div>
    </div>
  );
}
