// src/components/comments/CommentOptionsMenu.tsx
'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  MoreHorizontal,
  Copy,
  Send,
  ExternalLink,
  VolumeX,
  ShieldAlert,
  AlertTriangle,
  EyeOff,
  Trash2,
} from 'lucide-react';
import type { Comment } from '@/lib/types';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { useTranslations } from 'next-intl';
import { useIsMobile } from '@/hooks/use-mobile';
import { Separator } from '../ui/separator';
import { triggerHapticFeedback } from '@/lib/utils';

interface CommentOptionsMenuProps {
  comment: Comment;
  onCopyText: (event: React.MouseEvent | Event) => void;
  onMuteAuthor: (event: React.MouseEvent | Event) => Promise<void>;
  onBlockAuthor: (event: React.MouseEvent | Event) => Promise<void>;
  onReport: (event: React.MouseEvent | Event) => Promise<void>;
  onDelete: (event: React.MouseEvent | Event) => Promise<void>; 
  onSendViaDirect: (event: React.MouseEvent | Event) => void;
  onShare: (event: React.MouseEvent | Event) => void;
  onHideComment: (event: React.MouseEvent | Event) => void;
}

export default function CommentOptionsMenu({
  comment,
  onCopyText,
  onMuteAuthor,
  onBlockAuthor,
  onReport,
  onDelete,
  onSendViaDirect,
  onShare,
  onHideComment,
}: CommentOptionsMenuProps) {
  const t = useTranslations('CommentOptionsMenu');
  const { currentUser } = useCurrentUser();
  const currentUserId = currentUser?.id;
  const isMobile = useIsMobile();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  
  const isOwnComment = currentUserId === comment.userId;
  const isAuthorMuted = comment.user?.isMuted || false;
  const isAuthorBlocked = comment.user?.isBlocked || false;
  const username = comment.user?.username || 'user';

  const handleAction = (action: (e: Event) => void, e: React.MouseEvent) => {
    e.stopPropagation();
    action(e.nativeEvent);
    setIsSheetOpen(false);
  };
  
  const handleTriggerClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHapticFeedback();
  };

  const menuItems = (
    <>
      {isOwnComment && (
        <>
          <DropdownMenuItem onSelect={(e) => onDelete(e)} className="text-destructive focus:text-destructive focus:bg-destructive/10" data-interactive="true">
            <Trash2 className="mr-2 h-4 w-4" /> {t('delete')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem onSelect={(e) => onCopyText(e)} data-interactive="true">
        <Copy className="mr-2 h-4 w-4" /> {t('copy')}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={(e) => onSendViaDirect(e)} data-interactive="true">
        <Send className="mr-2 h-4 w-4" /> {t('sendDirect')}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={(e) => onShare(e)} data-interactive="true">
        <ExternalLink className="mr-2 h-4 w-4" /> {t('share')}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={(e) => onHideComment(e)} data-interactive="true">
        <EyeOff className="mr-2 h-4 w-4" />
        {t('hide')}
      </DropdownMenuItem>

      {currentUserId && !isOwnComment && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={(e) => onMuteAuthor(e)} data-interactive="true">
            <VolumeX className="mr-2 h-4 w-4" />
            {isAuthorMuted ? t('unmute', { username }) : t('mute', { username })}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={(e) => onBlockAuthor(e)} className="text-destructive focus:text-destructive focus:bg-destructive/10" data-interactive="true">
            <ShieldAlert className="mr-2 h-4 w-4" />
            {isAuthorBlocked ? t('unblock', { username }) : t('block', { username })}
          </DropdownMenuItem>
        </>
      )}
      {!isOwnComment && (
           <DropdownMenuItem onSelect={(e) => onReport(e)} className="text-destructive focus:text-destructive focus:bg-destructive/10" data-interactive="true">
              <AlertTriangle className="mr-2 h-4 w-4" /> {t('report')}
          </DropdownMenuItem>
      )}
    </>
  );
  
  const sheetButtons = (
    <div className="flex flex-col gap-1">
        {isOwnComment && (
            <>
                <Button variant="ghost" className="w-full justify-start text-base py-4 text-destructive hover:text-destructive" onClick={(e) => handleAction(onDelete, e)}>
                    <Trash2 className="mr-2 h-4 w-4" /> {t('delete')}
                </Button>
                <Separator />
            </>
        )}
        <Button variant="ghost" className="w-full justify-start text-base py-4" onClick={(e) => handleAction(onCopyText, e)}><Copy className="mr-2 h-4 w-4" /> {t('copy')}</Button>
        <Button variant="ghost" className="w-full justify-start text-base py-4" onClick={(e) => handleAction(onSendViaDirect, e)}><Send className="mr-2 h-4 w-4" /> {t('sendDirect')}</Button>
        <Button variant="ghost" className="w-full justify-start text-base py-4" onClick={(e) => handleAction(onShare, e)}><ExternalLink className="mr-2 h-4 w-4" /> {t('share')}</Button>
        <Separator />
        <Button variant="ghost" className="w-full justify-start text-base py-4" onClick={(e) => handleAction(onHideComment, e)}><EyeOff className="mr-2 h-4 w-4" /> {t('hide')}</Button>
        {currentUserId && !isOwnComment && (
            <>
                <Separator />
                <Button variant="ghost" className="w-full justify-start text-base py-4" onClick={(e) => handleAction(onMuteAuthor, e)}>
                    <VolumeX className="mr-2 h-4 w-4" /> {isAuthorMuted ? t('unmute', { username }) : t('mute', { username })}
                </Button>
                <Button variant="ghost" className="w-full justify-start text-base py-4 text-destructive hover:text-destructive" onClick={(e) => handleAction(onBlockAuthor, e)}>
                    <ShieldAlert className="mr-2 h-4 w-4" /> {isAuthorBlocked ? t('unblock', { username }) : t('block', { username })}
                </Button>
            </>
        )}
        {!isOwnComment && (
            <Button variant="ghost" className="w-full justify-start text-base py-4 text-destructive hover:text-destructive" onClick={(e) => handleAction(onReport, e)}>
                <AlertTriangle className="mr-2 h-4 w-4" /> {t('report')}
            </Button>
        )}
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-accent-foreground" onClick={handleTriggerClick} data-interactive="true">
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">{t('moreOptions')}</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="rounded-t-lg p-4" onClick={(e) => e.stopPropagation()} data-interactive="true">
          <SheetHeader className="sr-only">
            <SheetTitle>Opções do Comentário</SheetTitle>
            <SheetDescription>Ações adicionais que você pode tomar para este comentário.</SheetDescription>
          </SheetHeader>
          {sheetButtons}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-accent-foreground" onClick={handleTriggerClick} data-interactive="true">
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">{t('moreOptions')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()} data-interactive="true">
        {menuItems}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
