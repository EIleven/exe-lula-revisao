// src/components/comments/ReplyDialogContent.tsx
'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { Comment, Post, ReplyPermission, Media } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { useToast } from '@/hooks/use-toast';
import { Loader2, X, MessageSquare, CornerDownRight } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import TextWithMentions from '@/components/shared/TextWithMentions';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { replyToComment as serverReplyToComment } from '@/lib/services/comments/commentWriteActions';
import CommentInputArea from '@/components/comments/CommentInputArea';
import { useCommentInteractions } from '@/hooks/features/comment/useCommentInteractions';
import EmbeddedPostCard from '../feed/EmbeddedPostCard';
import { useLocale } from 'next-intl';
import { useVisualViewport } from '@/hooks/useVisualViewport';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { friendlyErrorMessage } from '@/lib/utils/friendlyError';

interface ReplyDialogContentProps {
  parentPost?: Post; // The post being replied to (for top-level comments)
  parentComment?: Comment; // The comment being replied to
  onReplySubmitted: (newComment: Comment) => void;
  dialogClose: () => void;
  // `false` = não enviou (o formulário mantém o texto); lançar erro também conta como falha.
  onSendMessage?: (data: { text?: string; media?: Media[] | null; youtubeVideoId?: string; quotedPostObject?: Post | null; replyPermission: ReplyPermission; allowReposts: boolean; }) => Promise<void | boolean>;
}

// O guard fica FORA dos hooks (regra dos hooks): sem conteúdo para responder não há o que renderizar.
export default function ReplyDialogContent(props: ReplyDialogContentProps) {
  if (!props.parentComment && !props.parentPost) {
    // This should not happen if the component is used correctly
    return null;
  }
  return <ReplyDialogContentInner {...props} />;
}

function ReplyDialogContentInner({ parentPost, parentComment, onReplySubmitted, dialogClose, onSendMessage }: ReplyDialogContentProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { currentUser } = useCurrentUser();
  const { toast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const locale = useLocale();
  const isMobile = useIsMobile();
  const viewportHeight = useVisualViewport();
  const dialogStyle = isMobile ? { height: viewportHeight ? `${viewportHeight}px` : '100svh' } : {};
  
  const isTopLevelComment = !!parentPost && !parentComment;
  const contentToReplyTo = parentComment || parentPost;
  
  // Generate a unique ID for the form and button
  const formId = useMemo(() => `reply-form-${parentComment?.id || parentPost?.id || 'new'}`, [parentComment, parentPost]);
  const submitButtonId = `${formId}-submit-button`;
  
  // Hook needs an initial comment, so we can use parentComment or a dummy for top-level
  const { handleFileUpload } = useCommentInteractions({
    initialComment: parentComment || contentToReplyTo as any,
    currentUserId: currentUser?.id || null,
  });

  const focusReplyAtEnd = () => {
    const aplicarFoco = () => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    };
    requestAnimationFrame(aplicarFoco);
    setTimeout(aplicarFoco, 80);
    setTimeout(aplicarFoco, 200);
  };

  useEffect(() => {
    focusReplyAtEnd();
  }, []);

  // Devolve `false` quando o envio não deu certo: o CommentInputArea então mantém o texto e as imagens para a pessoa
  // tentar de novo (antes ele limpava tudo mesmo com o erro na tela).
  const handleLocalSendMessage = async (data: { text?: string; media?: Media[] | null; youtubeVideoId?: string; quotedPostObject?: Post | null; replyPermission: ReplyPermission; allowReposts: boolean; }): Promise<boolean> => {
    if (isTopLevelComment && onSendMessage) {
      setIsSubmitting(true);
      try {
        if ((await onSendMessage(data)) === false) return false;
        dialogClose();
        return true;
      } catch (error: unknown) {
        console.error('Erro ao enviar comentário:', error);
        toast({ title: 'Erro ao enviar comentário', description: friendlyErrorMessage(error, 'Não foi possível enviar o comentário. Seu texto foi mantido: tente de novo.'), variant: 'destructive' });
        return false;
      } finally {
        setIsSubmitting(false);
      }
    }

    if (!parentComment) return false;

    if (!currentUser) {
      toast({ title: 'Você precisa estar logado para responder.', variant: 'destructive' });
      return false;
    }
    if (!parentComment.parentPostId) {
      toast({ title: 'Não foi possível encontrar a publicação principal.', variant: 'destructive' });
      return false;
    }

    setIsSubmitting(true);
    try {
      const newReply = await serverReplyToComment(parentComment.parentPostId, parentComment.id, currentUser.id, data);
      if (newReply) {
        toast({ title: 'Resposta enviada!' });
        onReplySubmitted(newReply);
        dialogClose();
        return true;
      }
      throw new Error('Falha ao enviar resposta.');
    } catch (error: unknown) {
      console.error('Erro ao enviar resposta:', error);
      toast({ title: 'Erro ao enviar resposta', description: friendlyErrorMessage(error, 'Não foi possível enviar a resposta. Seu texto foi mantido: tente de novo.'), variant: 'destructive' });
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const initialText = isTopLevelComment || !parentComment?.user ? '' : `@${parentComment.user.username} `;


  return (
    <DialogContent 
        className={cn(
            "p-0 gap-0 flex flex-col",
            isMobile ? 'h-screen' : 'sm:h-auto sm:max-h-[90vh] sm:max-w-lg'
        )}
        style={dialogStyle}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          focusReplyAtEnd();
        }}
        showCloseButton={false}
    >
      <DialogHeader className="p-4 h-14 flex flex-row items-center justify-between border-b">
        <DialogClose asChild>
            <Button type="button" variant="ghost">Cancelar</Button>
        </DialogClose>
        <DialogTitle className="sr-only">{isTopLevelComment ? "Escreva um comentário" : "Responder ao Comentário"}</DialogTitle>
        <DialogDescription className="sr-only">
           {isTopLevelComment ? "Compartilhe suas ideias sobre esta publicação." : "Escreva sua resposta ao comentário. Sua resposta será visível para todos que podem ver esta publicação."}
        </DialogDescription>
        <Button
          type="button"
          size="sm"
          className="rounded-full"
          disabled={isSubmitting}
          onClick={() => {
            document.getElementById(submitButtonId)?.click();
          }}
        >
          {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Responder'}
        </Button>
      </DialogHeader>

      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-shrink-0 p-4 space-y-4 border-b">
          <div className="max-h-64 overflow-y-auto pr-2">
              <EmbeddedPostCard
                post={isTopLevelComment ? parentPost : undefined}
                comment={!isTopLevelComment ? parentComment : undefined}
                scrollable={true}
                className="mt-0"
              />
          </div>

          {!isTopLevelComment && parentComment && parentComment.user && (
              <div className="flex items-start space-x-3 relative">
                  <div className="flex flex-col items-center self-stretch">
                      <div className="w-0.5 h-4 bg-border" />
                      <CornerDownRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground -ml-1">
                      Respondendo a <Link href={`/${locale}/profile/${parentComment.user.id}`} className="text-primary hover:underline">@{parentComment.user.username}</Link>
                  </p>
              </div>
          )}
        </div>

        <CommentInputArea
          formId={formId}
          ref={textareaRef}
          onSendMessage={handleLocalSendMessage}
          onFileUpload={handleFileUpload}
          isSubmitting={isSubmitting}
          placeholder="Escreva um comentário..."
          initialText={initialText}
          isModalLayout={true}
          showAvatar={true}
        />
      </div>
    </DialogContent>
  );
}
