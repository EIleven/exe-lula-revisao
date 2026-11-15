// src/components/feed/QuotePostDialogContent.tsx
'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { quotePost as serverQuotePost } from '@/lib/services/posts/createPostActions';
import type { Post, ReplyPermission, Media, PostLocation } from '@/lib/types';
import EmbeddedPostCard from './EmbeddedPostCard';
import PublishTargetsControls, { usePublishTargets } from '@/components/federation/PublishTargetsControls';
import { Loader2 } from 'lucide-react';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { uploadFileToStorage, postMediaPathFactory, isLikelyVideoFile } from '@/lib/services/mediaUploadService';
import { ToastAction } from '@/components/ui/toast';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import CommentInputArea from '@/components/comments/CommentInputArea';
import { useVisualViewport } from '@/hooks/useVisualViewport';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { friendlyErrorMessage } from '@/lib/utils/friendlyError';

interface QuotePostDialogContentProps {
  originalPost: Post;
  onPostQuoted: (newQuotePost: Post, updatedOriginalPost: Post) => void;
  dialogClose?: () => void;
}

export default function QuotePostDialogContent({ originalPost, onPostQuoted, dialogClose }: QuotePostDialogContentProps) {
  // "Postar" envia o formulário do CommentInputArea clicando no botão escondido dele, que tem ESTE id. Antes o id era
  // fixo ("reply-form-submit-button"), que só existe na outra cópia do CommentInputArea: o botão não achava nada e
  // citar um post simplesmente não fazia nada.
  const formId = useMemo(() => `quote-post-form-${originalPost?.id ?? 'novo'}`, [originalPost?.id]);
  const submitButtonId = `${formId}-submit-button`;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
  };

  // `false` = a citação NÃO foi publicada: o formulário mantém o texto e as imagens.
  async function handleSendMessage(data: { text?: string; media?: Media[] | null; youtubeVideoId?: string; quotedPostObject?: Post | null; replyPermission: ReplyPermission; allowReposts: boolean; location?: PostLocation | null; sensitive?: boolean; }): Promise<boolean> {
    if (!currentUserId) {
      toast({ title: "Autenticação Necessária", description: "Por favor, faça login para citar um post.", variant: "destructive" });
      handleClose();
      return false;
    }

    if (!data.text?.trim() && (!data.media || data.media.length === 0) && !data.quotedPostObject) {
        toast({ title: "Não é possível postar conteúdo vazio", description: "Por favor, adicione algum texto ou mídia.", variant: "destructive" });
        return false;
    }

    setIsSubmitting(true);
    try {
      const result = await serverQuotePost(
        originalPost.id,
        currentUserId,
        data.text || '',
        {
          media: data.media || undefined,
          allowReposts: data.allowReposts,
          replyPermission: data.replyPermission,
          quotedPostObject: data.quotedPostObject || null,
          federation: federationReach,
          location: data.location,
          sensitive: data.sensitive,
        }
      );

      if (!result || !result.newPost || !result.updatedOriginalPost) {
        throw new Error('Falha ao citar o post.');
      }
      
      toast({
        title: 'Post Citado!',
        description: 'Sua citação foi postada.',
        action: (
          <ToastAction altText="Ver post" asChild>
            <Link href={`/${locale}/post/${result.newPost.id}`}>Ver Post</Link>
          </ToastAction>
        ),
      });

      onPostQuoted(result.newPost, result.updatedOriginalPost);
      handleClose();
      void publishExternally(result.newPost, [...selectedNetworks]);
      return true;

    } catch (error: unknown) {
      console.error("Error in onSubmit QuotePostDialogContent:", error);
      toast({ title: 'Erro ao citar', description: friendlyErrorMessage(error, 'Não foi possível citar o post. Seu texto foi mantido: tente de novo.'), variant: "destructive" });
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <DialogContent 
        className={cn("p-0 gap-0 flex flex-col", isMobile ? 'h-screen' : 'sm:h-auto sm:max-h-[90vh] sm:max-w-lg')} 
        style={dialogStyle}
        showCloseButton={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
    >
      <DialogHeader className="p-2 px-4 flex flex-row items-center justify-between border-b relative">
            <DialogClose asChild>
                <Button type="button" variant="ghost">Cancelar</Button>
            </DialogClose>
            <DialogTitle className="sr-only">Citar Post</DialogTitle>
            <DialogDescription className="sr-only">Adicione seu comentário e, opcionalmente, uma imagem a este post. Personalize as configurações de interação para sua citação abaixo.</DialogDescription>
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
          <EmbeddedPostCard post={originalPost} />
        </div>
      </CommentInputArea>
    </DialogContent>
  );
}
