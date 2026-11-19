// src/components/feed/PostCardFooter.tsx
import React from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import QuotePostDialogContent from './QuotePostDialogContent';
import EditPostDialogContent from './EditPostDialogContent';
import CreateNewsDialogContent from './CreateNewsDialogContent';
import PostAnalyticsDialog from '@/components/analytics/PostAnalyticsDialog'; // Import the new component
import MountOnceOpened from '@/components/shared/MountOnceOpened';
import {
  Accessibility, Check, MessageCircle, Heart, Repeat2, Edit3, MoreHorizontal,
  Copy, Send, ExternalLink, EyeOff, VolumeX, ShieldAlert, AlertTriangle, Trash2, Loader2, BarChart2, Pin, Bookmark // Import Bookmark icon
} from 'lucide-react';
import type { Post } from '@/lib/types';
import { useToast } from "@/hooks/use-toast";
import { cn } from '@/lib/utils';
import AnimatedCounter from '@/components/shared/AnimatedCounter';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { triggerHapticFeedback } from '@/lib/utils';

interface PostCardFooterProps {
  post: Post; 
  currentUserId: string | null;
  isSinglePostView?: boolean;
  // For Quote Dialog
  isQuoteDialogOpen: boolean;
  setIsQuoteDialogOpen: (isOpen: boolean) => void;
  // For Edit Dialog
  isEditDialogOpen: boolean;
  setIsEditDialogOpen: (isOpen: boolean) => void;
  onPostEdited: (editedPost: Post) => void;
  // For other actions
  canCurrentUserReplyToPost: boolean;
  onCommentButtonClick: (e: React.MouseEvent) => void;
  onRepostToggle: (e: React.MouseEvent | Event) => void; 
  onQuoteButtonClick: (e: Event | React.MouseEvent) => void;      
  onUndoQuote: (e: Event) => void;
  onLikePost: (e: React.MouseEvent) => void;
  isProcessingLike: boolean;
  onBookmarkPost: (e: React.MouseEvent) => void; // Added for bookmarking
  isProcessingBookmark: boolean; // Added for bookmarking state
  onCopyText: (e: Event) => void; 
  onSendViaDirect: (e: Event) => void; 
  onShare: (e: Event) => void; 
  onMutePostAuthor: (e: Event) => void; 
  onBlockPostAuthor: (e: Event) => void; 
  onReportPostAction: (e: Event) => void; 
  onDeletePost: () => Promise<void>;
  onPostQuoted: (newQuotePost: Post, updatedOriginalPost: Post) => void;
  onPinPost: (e: React.MouseEvent | Event) => Promise<void>; // Added for pinning
  onHidePost: (e: React.MouseEvent | Event) => void;
  onMoreOfThis?: (e: Event) => void; 
  onLessOfThis?: (e: Event) => void; 
  onMuteThread?: (e: Event) => void; 
  onMuteWords?: (e: Event) => void; 
  hasPostImages?: boolean;
  hasMissingImageAlt?: boolean;
  altRequested?: boolean;
  isRequestingAltText?: boolean;
  onOpenAltTextEditor?: () => void;
  onRequestAltText?: (e: React.MouseEvent | Event) => void;
}


// Sub-component for Repost/Quote button logic
const RepostAndQuoteButton = ({
  post,
  isMobile,
  onRepostToggle,
  onQuoteButtonClick,
  onUndoQuote,
  currentUserId,
}: Pick<PostCardFooterProps, 'post' | 'onRepostToggle' | 'onQuoteButtonClick' | 'onUndoQuote' | 'currentUserId'> & { isMobile: boolean }) => {
  const [isRepostSheetOpen, setIsRepostSheetOpen] = React.useState(false);
  const hasUserRepostedOrQuoted = post.isReposted || post.isQuotedByCurrentUser;
  const totalRepostsAndQuotes = (post.reposts || 0) + (post.quotesCount || 0);
  // Post de OUTRA pessoa que é só para seguidores não é repostado nem citado: levaria o conteúdo para fora do círculo
  // do autor, e o servidor recusa. O próprio autor reposta e cita o que é dele (nasce com a visibilidade do perfil
  // dele). As opções ficam desabilitadas e explicadas, em vez de parecerem disponíveis e falharem.
  const isRestricted = (post.visibility ?? 'public') !== 'public' && post.userId !== currentUserId;
  const restrictedReason = 'Este post é só para seguidores do autor: só ele pode repostar ou citar.';
  const cannotRepost = !currentUserId || isRestricted
    || (!post.allowReposts && post.userId !== currentUserId && !post.isReposted);
  const cannotQuote = !currentUserId || isRestricted
    || (!post.allowReposts && post.userId !== currentUserId);

  if (isMobile) {
    return (
        <Sheet open={isRepostSheetOpen} onOpenChange={setIsRepostSheetOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost" size="sm"
              className={cn("flex items-center space-x-1.5 sm:space-x-2 rounded-full transition-all duration-150 active:scale-95 hover-repost", hasUserRepostedOrQuoted ? "text-[hsl(var(--repost))]" : "text-muted-foreground")}
              onClick={(e) => e.stopPropagation()}
              data-interactive="true"
              aria-pressed={!!hasUserRepostedOrQuoted}
            >
              <Repeat2 className={cn("h-5 w-5", hasUserRepostedOrQuoted && "fill-current")} />
              <AnimatedCounter count={totalRepostsAndQuotes} className="text-sm" />
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="rounded-t-lg p-4" onClick={(e) => e.stopPropagation()} data-interactive="true">
            <SheetHeader className="sr-only">
              <SheetTitle>Opções de Repost</SheetTitle>
              <SheetDescription>Escolha entre repostar ou citar a postagem.</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-2">
              <Button variant="outline" className="w-full justify-start text-base py-6" onClick={(e) => { onRepostToggle(e); setIsRepostSheetOpen(false); }} disabled={cannotRepost && !post.isReposted} title={isRestricted ? restrictedReason : undefined} >
                <Repeat2 className={cn("mr-2 h-4 w-4", post.isReposted && "fill-current text-[hsl(var(--repost))]")} />
                {post.isReposted ? "Desfazer Repost" : "Repostar"}
              </Button>
              {post.isQuotedByCurrentUser ? (
                <Button variant="outline" className="w-full justify-start text-base py-6 text-destructive" onClick={(e) => { onUndoQuote(e); setIsRepostSheetOpen(false); }} disabled={!currentUserId} >
                  <Edit3 className="mr-2 h-4 w-4" />
                  Desfazer Citação
                </Button>
              ) : (
                <Button
                  variant="outline"
                  className="w-full justify-start text-base py-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    onQuoteButtonClick(e);
                    setIsRepostSheetOpen(false);
                  }}
                  disabled={cannotQuote}
                  title={isRestricted ? restrictedReason : undefined}
                >
                  <Edit3 className="mr-2 h-4 w-4" />
                  Citar postagem
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
            variant="ghost" size="sm"
            className={cn("flex items-center space-x-1.5 sm:space-x-2 rounded-full transition-all duration-150 active:scale-95 hover-repost", hasUserRepostedOrQuoted ? "text-[hsl(var(--repost))]" : "text-muted-foreground")}
            onClick={(e) => e.stopPropagation()}
            data-interactive="true"
            aria-pressed={!!hasUserRepostedOrQuoted}
          >
            <Repeat2 className={cn("h-5 w-5", hasUserRepostedOrQuoted && "fill-current")} />
            <AnimatedCounter count={totalRepostsAndQuotes} className="text-sm" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" onClick={(e) => e.stopPropagation()} data-interactive="true">
          <DropdownMenuItem onSelect={onRepostToggle} data-interactive="true" disabled={cannotRepost && !post.isReposted} title={isRestricted ? restrictedReason : undefined} className={cn(post.isReposted && "text-[hsl(var(--repost))]")} >
            <Repeat2 className={cn("mr-2 h-4 w-4", post.isReposted && "fill-current")} />
            {post.isReposted ? "Desfazer Repost" : "Repostar"}
          </DropdownMenuItem>
          {post.isQuotedByCurrentUser ? (
            <DropdownMenuItem onSelect={onUndoQuote} className="text-destructive focus:text-destructive focus:bg-destructive/10" data-interactive="true" disabled={!currentUserId}>
              <Edit3 className="mr-2 h-4 w-4" />
              Desfazer Citação
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={onQuoteButtonClick} disabled={cannotQuote} title={isRestricted ? restrictedReason : undefined} data-interactive="true" >
              <Edit3 className="mr-2 h-4 w-4" />
              Citar postagem
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
  );
};


// Sub-component for the "More Options" menu
const MoreOptionsMenu = ({
    post,
    isDeleting,
    isMobile,
    currentUserId,
    handleDeleteClick,
    setIsAnalyticsOpen,
    setIsEditDialogOpen,
    onPinPost,
    onCopyText,
    onSendViaDirect,
    onShare,
    onHidePost,
    onMutePostAuthor,
    onBlockPostAuthor,
    onReportPostAction,
    hasPostImages,
    hasMissingImageAlt,
    altRequested,
    isRequestingAltText,
    onOpenAltTextEditor,
    onRequestAltText,
}: {
    post: Post;
    isDeleting: boolean;
    isMobile: boolean;
    currentUserId: string | null;
    handleDeleteClick: (e: React.MouseEvent | Event) => Promise<void>;
    setIsAnalyticsOpen: (open: boolean) => void;
    setIsEditDialogOpen: (open: boolean) => void;
    onPinPost: (e: React.MouseEvent | Event) => Promise<void>;
    onCopyText: (e: Event) => void;
    onSendViaDirect: (e: Event) => void;
    onShare: (e: Event) => void;
    onHidePost: (e: React.MouseEvent | Event) => void;
    onMutePostAuthor: (e: Event) => void;
    onBlockPostAuthor: (e: Event) => void;
    onReportPostAction: (e: Event) => void;
    hasPostImages?: boolean;
    hasMissingImageAlt?: boolean;
    altRequested?: boolean;
    isRequestingAltText?: boolean;
    onOpenAltTextEditor?: () => void;
    onRequestAltText?: (e: React.MouseEvent | Event) => void;
}) => {
    const [isMoreOptionsSheetOpen, setIsMoreOptionsSheetOpen] = React.useState(false);
    
    const handleTriggerClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        triggerHapticFeedback();
    };

    const dropdownItems = (
        <>
          {post.userId === currentUserId && (
            <>
              <DropdownMenuItem onSelect={() => setIsAnalyticsOpen(true)} data-interactive="true">
                <BarChart2 className="mr-2 h-4 w-4" /> Ver Análise
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onPinPost} data-interactive="true">
                <Pin className="mr-2 h-4 w-4" /> {post.isPinned ? 'Desafixar do perfil' : 'Fixar no seu perfil'}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setIsEditDialogOpen(true)} disabled={(post.editCount || 0) >= 1 && post.category !== 'news'} data-interactive="true">
                <Edit3 className="mr-2 h-4 w-4" /> Editar post
              </DropdownMenuItem>
              {hasPostImages && onOpenAltTextEditor && (
                <DropdownMenuItem onSelect={() => onOpenAltTextEditor()} data-interactive="true">
                  <Accessibility className="mr-2 h-4 w-4 text-emerald-500" /> {hasMissingImageAlt ? 'Adicionar Alt Text' : 'Editar Alt Text'}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={handleDeleteClick} className="text-destructive focus:text-destructive focus:bg-destructive/10" data-interactive="true" disabled={isDeleting}>
                {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />} Deletar post
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onSelect={onCopyText} data-interactive="true"> <Copy className="mr-2 h-4 w-4" /> Copiar texto do post </DropdownMenuItem>
          <DropdownMenuItem onSelect={onSendViaDirect} data-interactive="true"> <Send className="mr-2 h-4 w-4" /> Enviar via Direct </DropdownMenuItem>
          <DropdownMenuItem onSelect={onShare} data-interactive="true"> <ExternalLink className="mr-2 h-4 w-4" /> Compartilhar </DropdownMenuItem>
          {/* Funcionalidade de pedir Alt Text entre usuários desativada temporariamente
          {hasMissingImageAlt && post.userId !== currentUserId && !post.userId.startsWith('ap_') && !post.id.startsWith('ap_') && onRequestAltText && (
            <DropdownMenuItem
              onSelect={(e) => onRequestAltText(e)}
              disabled={Boolean(altRequested || isRequestingAltText)}
              data-interactive="true"
            >
              {altRequested ? (
                <Check className="mr-2 h-4 w-4 text-emerald-500" />
              ) : (
                <Accessibility className="mr-2 h-4 w-4 text-emerald-500" />
              )}
              {altRequested ? 'Alt Text já solicitado' : 'Notificar autor sobre Alt Text'}
            </DropdownMenuItem>
          )}
          */}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onHidePost} data-interactive="true"> <EyeOff className="mr-2 h-4 w-4" /> Ocultar este post para mim </DropdownMenuItem>
          {post.user && currentUserId && post.userId !== currentUserId && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onMutePostAuthor} data-interactive="true">
                <VolumeX className="mr-2 h-4 w-4" /> {post.user.isMuted ? 'Não silenciar' : 'Silenciar'} @{post.user.username}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onBlockPostAuthor} className="text-destructive focus:text-destructive focus:bg-destructive/10" data-interactive="true">
                <ShieldAlert className="mr-2 h-4 w-4" /> {post.user.isBlocked ? 'Desbloquear' : 'Bloquear'} @{post.user.username}
              </DropdownMenuItem>
            </>
          )}
          {currentUserId && post.userId !== currentUserId && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={onReportPostAction} className="text-destructive focus:text-destructive focus:bg-destructive/10" data-interactive="true">
            <AlertTriangle className="mr-2 h-4 w-4" /> Reportar post
          </DropdownMenuItem>
        </>
      );
  
      const sheetButtons = (
        <div className="flex flex-col gap-1">
          {post.userId === currentUserId && (
            <>
              <Button variant="ghost" className="w-full justify-start text-base py-4" onClick={() => { setIsAnalyticsOpen(true); setIsMoreOptionsSheetOpen(false); }}>
                <BarChart2 className="mr-2 h-4 w-4" /> Ver Análise
              </Button>
              <Button variant="ghost" className="w-full justify-start text-base py-4" onClick={(e) => { onPinPost(e); setIsMoreOptionsSheetOpen(false); }}>
                <Pin className="mr-2 h-4 w-4" /> {post.isPinned ? 'Desafixar do perfil' : 'Fixar no seu perfil'}
              </Button>
              <Button variant="ghost" className="w-full justify-start text-base py-4" onClick={() => { setIsEditDialogOpen(true); setIsMoreOptionsSheetOpen(false); }} disabled={(post.editCount || 0) >= 1 && post.category !== 'news'}>
                <Edit3 className="mr-2 h-4 w-4" /> Editar post
              </Button>
              {hasPostImages && onOpenAltTextEditor && (
                <Button variant="ghost" className="w-full justify-start text-base py-4" onClick={() => { onOpenAltTextEditor(); setIsMoreOptionsSheetOpen(false); }}>
                  <Accessibility className="mr-2 h-4 w-4 text-emerald-500" /> {hasMissingImageAlt ? 'Adicionar Alt Text' : 'Editar Alt Text'}
                </Button>
              )}
              <Button variant="ghost" className="w-full justify-start text-base py-4 text-destructive hover:text-destructive" onClick={(e) => { handleDeleteClick(e); setIsMoreOptionsSheetOpen(false); }} disabled={isDeleting}>
                {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />} Deletar post
              </Button>
              <Separator />
            </>
          )}
          <Button variant="ghost" className="w-full justify-start text-base py-4" onClick={(e) => { onCopyText(e); setIsMoreOptionsSheetOpen(false); }}>
            <Copy className="mr-2 h-4 w-4" /> Copiar texto do post
          </Button>
          <Button variant="ghost" className="w-full justify-start text-base py-4" onClick={(e) => { onSendViaDirect(e); setIsMoreOptionsSheetOpen(false); }}>
            <Send className="mr-2 h-4 w-4" /> Enviar via Direct
          </Button>
          <Button variant="ghost" className="w-full justify-start text-base py-4" onClick={(e) => { onShare(e); setIsMoreOptionsSheetOpen(false); }}>
            <ExternalLink className="mr-2 h-4 w-4" /> Compartilhar
          </Button>
          {/* Funcionalidade de pedir Alt Text entre usuários desativada temporariamente
          {hasMissingImageAlt && post.userId !== currentUserId && !post.userId.startsWith('ap_') && !post.id.startsWith('ap_') && onRequestAltText && (
            <Button
              variant="ghost"
              className="w-full justify-start text-base py-4"
              disabled={Boolean(altRequested || isRequestingAltText)}
              onClick={(e) => { onRequestAltText(e); setIsMoreOptionsSheetOpen(false); }}
            >
              {altRequested ? (
                <Check className="mr-2 h-4 w-4 text-emerald-500" />
              ) : (
                <Accessibility className="mr-2 h-4 w-4 text-emerald-500" />
              )}
              {altRequested ? 'Alt Text já solicitado' : 'Notificar autor sobre Alt Text'}
            </Button>
          )}
          */}
          <Separator />
          <Button variant="ghost" className="w-full justify-start text-base py-4" onClick={(e) => { onHidePost(e); setIsMoreOptionsSheetOpen(false); }}>
            <EyeOff className="mr-2 h-4 w-4" /> Ocultar este post para mim
          </Button>
          {post.user && currentUserId && post.userId !== currentUserId && (
            <>
              <Separator />
              <Button variant="ghost" className="w-full justify-start text-base py-4" onClick={(e) => { onMutePostAuthor(e); setIsMoreOptionsSheetOpen(false); }}>
                <VolumeX className="mr-2 h-4 w-4" /> {post.user.isMuted ? 'Não silenciar' : 'Silenciar'} @{post.user.username}
              </Button>
              <Button variant="ghost" className="w-full justify-start text-base py-4 text-destructive hover:text-destructive" onClick={(e) => { onBlockPostAuthor(e); setIsMoreOptionsSheetOpen(false); }}>
                <ShieldAlert className="mr-2 h-4 w-4" /> {post.user.isBlocked ? 'Desbloquear' : 'Bloquear'} @{post.user.username}
              </Button>
            </>
          )}
          {currentUserId && post.userId !== currentUserId && <Separator />}
          <Button variant="ghost" className="w-full justify-start text-base py-4 text-destructive hover:text-destructive" onClick={(e) => { onReportPostAction(e); setIsMoreOptionsSheetOpen(false); }}>
            <AlertTriangle className="mr-2 h-4 w-4" /> Reportar post
          </Button>
        </div>
      );
      
      if (isMobile) {
        return (
          <Sheet open={isMoreOptionsSheetOpen} onOpenChange={setIsMoreOptionsSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-all duration-150 active:scale-95" onClick={handleTriggerClick} data-interactive="true" aria-label="More options">
                <MoreHorizontal className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-lg p-4" onClick={(e) => e.stopPropagation()} data-interactive="true">
              <SheetHeader className="sr-only">
                <SheetTitle>Opções do Post</SheetTitle>
                <SheetDescription>Ações adicionais que você pode tomar para este post.</SheetDescription>
              </SheetHeader>
              {sheetButtons}
            </SheetContent>
          </Sheet>
        );
      }
  
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-all duration-150 active:scale-95" onClick={handleTriggerClick} data-interactive="true" aria-label="More options">
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()} data-interactive="true">
            {dropdownItems}
          </DropdownMenuContent>
        </DropdownMenu>
      );
}


export default function PostCardFooter({
  post,
  currentUserId,
  isSinglePostView = false,
  isQuoteDialogOpen,
  setIsQuoteDialogOpen,
  isEditDialogOpen,
  setIsEditDialogOpen,
  onPostEdited,
  canCurrentUserReplyToPost,
  onCommentButtonClick,
  onRepostToggle,
  onQuoteButtonClick,
  onUndoQuote,
  onLikePost,
  isProcessingLike,
  onBookmarkPost,
  isProcessingBookmark,
  onCopyText,
  onSendViaDirect,
  onShare,
  onMutePostAuthor,
  onBlockPostAuthor,
  onReportPostAction,
  onDeletePost,
  onPostQuoted,
  onPinPost, 
  onHidePost,
  hasPostImages,
  hasMissingImageAlt,
  altRequested,
  isRequestingAltText,
  onOpenAltTextEditor,
  onRequestAltText,
}: PostCardFooterProps) {
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [isAnalyticsOpen, setIsAnalyticsOpen] = React.useState(false);
  const isMobile = useIsMobile();


  const handleDeleteClick = async (e: React.MouseEvent | Event) => {
    e.stopPropagation();
    setIsDeleting(true);
    try {
      await onDeletePost();
    } catch (error) {
      console.error("Error from onDeletePost callback in PostCardFooter:", error);
      setIsDeleting(false);
    }
  };

  if (post.isDeleted) {
    return null; // Don't show footer for deleted posts
  }

  const commentsCount = post.commentsCount || 0;
  const likesCount = post.likes || 0;

  return (
    <div className={cn(
      "mt-2 pt-1 flex w-full justify-between gap-1 items-center min-w-0",
      isSinglePostView && "border-t"
    )}>
      <Button
        variant="ghost"
        size="sm"
        onClick={onCommentButtonClick}
        className="flex items-center space-x-1.5 sm:space-x-2 px-1.5 sm:px-2.5 rounded-full text-muted-foreground hover-comment transition-all duration-150 active:scale-95 [touch-action:manipulation]"
        data-interactive="true"
        disabled={(!canCurrentUserReplyToPost && !!currentUserId && post.userId !== currentUserId && post.replyPermission !== 'everyone')}
        title={(!canCurrentUserReplyToPost && !!currentUserId && post.userId !== currentUserId && post.replyPermission !== 'everyone') ? "Replies are limited for this post" : "View comments"}
      >
        <MessageCircle className="h-5 w-5" />
        <AnimatedCounter count={commentsCount} className="text-sm" />
      </Button>

      <Dialog open={isQuoteDialogOpen} onOpenChange={setIsQuoteDialogOpen}>
        <RepostAndQuoteButton 
          post={post}
          isMobile={isMobile}
          onRepostToggle={onRepostToggle}
          onQuoteButtonClick={onQuoteButtonClick}
          onUndoQuote={onUndoQuote}
          currentUserId={currentUserId}
        />
        <MountOnceOpened open={isQuoteDialogOpen}>
          <QuotePostDialogContent originalPost={post} onPostQuoted={onPostQuoted} dialogClose={() => setIsQuoteDialogOpen(false)} />
        </MountOnceOpened>
      </Dialog>

      <Button
        variant="ghost"
        size="sm"
        onClick={onLikePost}
        className={cn('flex items-center space-x-1.5 sm:space-x-2 px-1.5 sm:px-2.5 rounded-full hover-like transition-all duration-150 active:scale-95 [touch-action:manipulation]', {
          'text-[hsl(var(--like))]': post.isLiked,
          'text-muted-foreground': !post.isLiked,
        })}
        data-interactive="true"
        aria-pressed={!!post.isLiked} 
        title={post.isLiked ? "Unlike" : "Like"}
      >
        <Heart className={cn('h-5 w-5 like-icon', { 'fill-current': post.isLiked })} />
        <AnimatedCounter count={likesCount} className="text-sm" />
      </Button>
      
      <div className="flex items-center gap-0.5 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBookmarkPost}
          className={cn('h-8 w-8 rounded-full hover-bookmark transition-all duration-150 active:scale-95 [touch-action:manipulation]', {
            'text-blue-500': post.isBookmarked,
            'text-muted-foreground': !post.isBookmarked,
          })}
          data-interactive="true"
          aria-pressed={!!post.isBookmarked}
          title={post.isBookmarked ? "Remove Bookmark" : "Bookmark"}
        >
          <Bookmark className={cn('h-5 w-5', { 'fill-current': post.isBookmarked })} />
        </Button>

        <Dialog open={isAnalyticsOpen} onOpenChange={setIsAnalyticsOpen}>
           <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                <MoreOptionsMenu 
                    post={post}
                    isDeleting={isDeleting}
                    isMobile={isMobile}
                    currentUserId={currentUserId}
                    handleDeleteClick={handleDeleteClick}
                    setIsAnalyticsOpen={setIsAnalyticsOpen}
                    setIsEditDialogOpen={setIsEditDialogOpen}
                    onPinPost={onPinPost}
                    onCopyText={onCopyText}
                    onSendViaDirect={onSendViaDirect}
                    onShare={onShare}
                    onHidePost={onHidePost}
                    onMutePostAuthor={onMutePostAuthor}
                    onBlockPostAuthor={onBlockPostAuthor}
                    onReportPostAction={onReportPostAction}
                    hasPostImages={hasPostImages}
                    hasMissingImageAlt={hasMissingImageAlt}
                    altRequested={altRequested}
                    isRequestingAltText={isRequestingAltText}
                    onOpenAltTextEditor={onOpenAltTextEditor}
                    onRequestAltText={onRequestAltText}
                />
                <MountOnceOpened open={isEditDialogOpen}>
                  {post.category === 'news' ? (
                    <CreateNewsDialogContent
                      postToEdit={post}
                      onPostEdited={onPostEdited}
                      dialogClose={() => setIsEditDialogOpen(false)}
                    />
                  ) : (
                    <EditPostDialogContent postToEdit={post} onPostEdited={onPostEdited} dialogClose={() => setIsEditDialogOpen(false)} />
                  )}
                </MountOnceOpened>
           </Dialog>
           {/* As estatísticas só são buscadas quando alguém abre o diálogo (antes eram lidas do servidor para TODO cartão). */}
           <MountOnceOpened open={isAnalyticsOpen}>
             <PostAnalyticsDialog post={post} />
           </MountOnceOpened>
        </Dialog>
      </div>
    </div>
  );
}
