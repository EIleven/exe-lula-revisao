// src/components/feed/QuoteCommentDialogContent.tsx
'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { quoteComment as serverQuoteComment } from '@/lib/services/posts/createPostActions'; 
import { getCurrentUserId } from '@/lib/services/authService';
import type { Post, Comment, ReplyPermission, Media, PostLocation } from '@/lib/types';
import EmbeddedPostCard from './EmbeddedPostCard';
import PublishTargetsControls, { usePublishTargets } from '@/components/federation/PublishTargetsControls';
import { Loader2 } from 'lucide-react';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { ECHO_COMMENT_MAX_LENGTH } from '@/lib/constants/domain';
import { uploadFileToStorage, postMediaPathFactory, isLikelyVideoFile } from '@/lib/services/mediaUploadService';
import { ToastAction } from '@/components/ui/toast';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import CommentInputArea from '@/components/comments/CommentInputArea'; // Importar CommentInputArea
import { useVisualViewport } from '@/hooks/useVisualViewport';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { friendlyErrorMessage } from '@/lib/utils/friendlyError';

const quoteCommentFormSchema = z.object({
  quoteText: z.string().max(ECHO_COMMENT_MAX_LENGTH, `O texto da citação não pode exceder ${ECHO_COMMENT_MAX_LENGTH} caracteres.`).optional(),
  imageUrl: z.string().optional(),
  imageAlt: z.string().max(125, 'A descrição da imagem não pode exceder 125 caracteres.').optional(),
}).refine(data => !!data.quoteText?.trim() || !!data.imageUrl, {
    message: "Uma citação deve ter texto ou uma imagem.",
    path: ["quoteText"],
});

type QuoteCommentFormValues = z.infer<typeof quoteCommentFormSchema>;

interface QuoteCommentDialogContentProps {
  originalComment: Comment;
  onCommentQuoted: (newQuotePost: Post) => void;
  dialogClose?: () => void;
}

export default function QuoteCommentDialogContent({ originalComment, onCommentQuoted, dialogClose }: QuoteCommentDialogContentProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // "Postar" envia o formulário do CommentInputArea clicando no botão escondido dele, que tem ESTE id. Antes o id era
  // fixo ("reply-form-submit-button"), que só existe na outra cópia do CommentInputArea: o botão não achava nada e
  // citar um comentário simplesmente não fazia nada.
  const formId = useMemo(() => `quote-comment-form-${originalComment?.id ?? 'novo'}`, [originalComment?.id]);
  const submitButtonId = `${formId}-submit-button`;
  const { toast } = useToast();
  const { currentUser } = useCurrentUser();
  const currentUserId = currentUser?.id;
  const locale = useLocale();
  const isMobile = useIsMobile();
  const viewportHeight = useVisualViewport();
  const dialogStyle = isMobile ? { height: viewportHeight ? `${viewportHeight}px` : '100svh' } : {};
  const {
    federationReach,
    updateFederationReach,
    connectedNetworks,
    selectedNetworks,
    toggleNetwork,
    postWillBePublic,
    publishExternally,
  } = usePublishTargets();

  useEffect(() => {
    setTimeout(() => {
        textareaRef.current?.focus();
    }, 100);
  }, []);

  const handleFileUpload = async (file: File) => {
    if (!currentUserId) {
      toast({ title: "Login obrigatório", description: "Você deve estar logado para enviar arquivos.", variant: "destructive" });
      throw new Error("Usuário não logado");
    }
    const result = await uploadFileToStorage(currentUserId, file, postMediaPathFactory);
    const fileType: 'image' | 'video' | 'file' = file.type.startsWith('image/') ? 'image'
                   : isLikelyVideoFile(file) ? 'video'
                   : 'file';
    return { url: result.downloadURL, type: fileType };
  };

  
  const handleClose = () => {
      if (dialogClose) dialogClose();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  };

  // `false` = a citação NÃO foi publicada: o formulário mantém o texto e as imagens.
  async function handleSendMessage(data: { text?: string; media?: Media[] | null; youtubeVideoId?: string; quotedPostObject?: Post | null; replyPermission: ReplyPermission; allowReposts: boolean; location?: PostLocation | null; sensitive?: boolean; }): Promise<boolean> {
    if (!currentUserId) {
      toast({ title: "Autenticação Necessária", description: "Por favor, faça login para citar um comentário.", variant: "destructive" });
      handleClose();
      return false;
    }
    if (!data.text?.trim() && (!data.media || data.media.length === 0)) {
        toast({ title: "Não é possível postar conteúdo vazio", description: "Por favor, adicione algum texto ou uma imagem.", variant: "destructive" });
        return false;
    }

    setIsSubmitting(true);
    try {
      
      const newQuotePost = await serverQuoteComment(
        originalComment.id,
        originalComment.parentPostId,
        currentUserId,
        data.text || '',
        {
          media: data.media || undefined,
          allowReposts: data.allowReposts,
          replyPermission: data.replyPermission,
          federation: federationReach,
          location: data.location,
          sensitive: data.sensitive,
        }
      );

      if (!newQuotePost) {
        throw new Error('Falha ao citar o comentário.');
      }
      toast({
        title: "Comentário Citado!",
        description: "Seu novo post citando este comentário está no ar.",
        action: (
          <ToastAction altText="Ver post" asChild>
            <Link href={`/${locale}/post/${newQuotePost.id}`}>Ver Post</Link>
          </ToastAction>
        ),
      });
      onCommentQuoted(newQuotePost);
      handleClose();
      void publishExternally(newQuotePost, [...selectedNetworks]);
      return true;

    } catch (error: unknown) {
      console.error("Error in onSubmit QuoteCommentDialogContent:", error);
      toast({
        title: 'Erro ao citar',
        description: friendlyErrorMessage(error, 'Não foi possível citar o comentário. Seu texto foi mantido: tente de novo.'),
        variant: 'destructive',
      });
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
     <DialogContent 
        className="sm:max-w-[600px] p-0 gap-0 flex flex-col sm:h-auto sm:max-h-[90vh]"
        style={dialogStyle}
        showCloseButton={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
     >
       <DialogHeader className="p-2 px-4 flex flex-row items-center justify-between border-b relative">
            <DialogClose asChild>
                <Button type="button" variant="ghost">Cancelar</Button>
            </DialogClose>
            <DialogTitle className="sr-only">Citar Comentário</DialogTitle>
            <DialogDescription className="sr-only">Adicione seu comentário e, opcionalmente, uma imagem a este comentário do usuário. Personalize as configurações de interação para sua citação abaixo.</DialogDescription>
            <div className="flex items-center gap-1.5">
              <PublishTargetsControls
                federationReach={federationReach}
                onFederationChange={updateFederationReach}
                connectedNetworks={connectedNetworks}
                selectedNetworks={selectedNetworks}
                onToggleNetwork={toggleNetwork}
                postWillBePublic={postWillBePublic}
                disabled={isSubmitting}
              />
              <Button type="button" size="sm" className="rounded-full" disabled={isSubmitting} onClick={() => document.getElementById(submitButtonId)?.click()}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Postar
              </Button>
            </div>
      </DialogHeader>

        <CommentInputArea
          ref={textareaRef}
          onSendMessage={handleSendMessage as any}
          onFileUpload={handleFileUpload}
          isSubmitting={isSubmitting}
          placeholder="E aí..."
          isModalLayout={true}
          showAvatar={true}
          enablePostOptions={true}
          formId={formId}
        >
          <div className="max-h-52 overflow-y-auto rounded-lg p-1">
            <EmbeddedPostCard comment={originalComment} />
          </div>
        </CommentInputArea>
        
    </DialogContent>
  );
}
