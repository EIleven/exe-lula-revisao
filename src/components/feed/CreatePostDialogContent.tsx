
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
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
  FormMessage,
} from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { createPost as serverCreatePost } from '@/lib/services/posts/createPostActions';
import type { Post, ReplyPermission, Draft, Media, PollDraft, PostLocation } from '@/lib/types';
import Image from 'next/image';
import {
  Camera, Image as ImageIcon, Link as LinkIcon, Globe, Loader2, Megaphone, X, XCircle, Users, RefreshCw, Circle, Save, FileVideo, Share2, ChevronDown
} from 'lucide-react';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { extractYoutubeVideoInfo } from '@/lib/utils/textUtils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { ECHO_COMMENT_MAX_LENGTH } from '@/lib/constants/domain';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { uploadFileToStorage, postMediaPathFactory, isLikelyVideoFile } from '@/lib/services/mediaUploadService';
import InteractionSettingsDialog from '@/components/shared/InteractionSettingsDialog';
import AltTextDialog from '@/components/shared/AltTextDialog';
import { ToastAction } from '@/components/ui/toast';
import Link from 'next/link';
import { useQuotedPostPreview } from '@/hooks/features/post/useQuotedPostPreview';
import EmbeddedPostCard from './EmbeddedPostCard';
import { useLocale, useTranslations } from 'next-intl';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cacheService } from '@/lib/services/cacheService';
import { useMentions } from '@/hooks/features/mentions/useMentions';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import CommentInputArea from '@/components/comments/CommentInputArea';
import { useVisualViewport } from '@/hooks/useVisualViewport';
import { useIsMobile } from '@/hooks/use-mobile';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { friendlyErrorMessage } from '@/lib/utils/friendlyError';
import PublishTargetsControls, { usePublishTargets } from '@/components/federation/PublishTargetsControls';


const createPostFormSchema = z.object({
  text: z.string().max(ECHO_COMMENT_MAX_LENGTH, `Posts can't exceed ${ECHO_COMMENT_MAX_LENGTH} characters.`).optional(),
}).refine(data => !!data.text?.trim(), {
  message: "A post must have some text.",
  path: ["text"],
});

type CreatePostFormValues = z.infer<typeof createPostFormSchema>;

interface CreatePostDialogContentProps {
  onPostCreated?: (newPost: Post) => void;
  dialogClose?: () => void;
  initialData?: Partial<Draft>;
  initialFiles?: File[] | null;
}

export default function CreatePostDialogContent({ onPostCreated, dialogClose, initialData, initialFiles }: CreatePostDialogContentProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [postAsOfficial, setPostAsOfficial] = useState(false);
  const [draftId, setDraftId] = useState<string | undefined>(initialData?.id);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { toast } = useToast();
  const { currentUser, firebaseUser } = useCurrentUser();
  const currentUserId = currentUser?.id;
  const locale = useLocale();
  const t = useTranslations('CreatePostDialog');
  const isMobile = useIsMobile();
  const viewportHeight = useVisualViewport();
  const dialogStyle = isMobile ? { height: viewportHeight ? `${viewportHeight}px` : '100svh' } : {};

  const focusTextareaAtEnd = useCallback(() => {
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
  }, []);

  useEffect(() => {
    focusTextareaAtEnd();
  }, [focusTextareaAtEnd]);
  const {
    federationReach,
    updateFederationReach,
    connectedNetworks,
    selectedNetworks,
    toggleNetwork,
    postWillBePublic,
    publishExternally,
  } = usePublishTargets();

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

  // Devolve `false` quando o post NÃO foi publicado: o formulário mantém o texto e as imagens (antes limpava tudo
  // mesmo com o erro na tela).
  async function handleSendMessage(data: { text?: string; media?: Media[] | null; youtubeVideoId?: string; quotedPostObject?: Post | null; replyPermission: ReplyPermission; allowReposts: boolean; location?: PostLocation | null; sensitive?: boolean; poll?: PollDraft | null; }): Promise<boolean> {
      if (!currentUserId) {
          toast({ title: t('authNeededTitle'), description: t('authNeededDescription'), variant: "destructive" });
          handleClose();
          return false;
      }
      
      setIsSubmitting(true);
      
      try {
          let newPost: Post | undefined;
          if (postAsOfficial && currentUser?.isAdmin && firebaseUser) {
              const token = await firebaseUser.getIdToken();
              const res = await fetch('/api/admin/official-account', {
                  method: 'POST',
                  headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({
                      text: data.text,
                      media: data.media,
                      youtubeVideoId: data.youtubeVideoId,
                      allowReposts: data.allowReposts,
                      replyPermission: data.replyPermission,
                      category: 'echo',
                      location: data.location,
                      sensitive: data.sensitive,
                      federation: federationReach,
                  }),
              });
              if (!res.ok) {
                  // A rota diz o porquê (anexo que não vai ao Fediverso, vídeo inválido...): mostra isso, e não o aviso genérico.
                  const erro = (await res.json().catch(() => null)) as { detail?: unknown } | null;
                  throw new Error(typeof erro?.detail === 'string' && erro.detail ? erro.detail : 'Falha ao publicar como @ExercitoDoLula');
              }
              const json = (await res.json()) as { post?: Post };
              newPost = json.post;
          } else {
              newPost = await serverCreatePost({
                  userId: currentUserId,
                  text: data.text,
                  media: data.media,
                  youtubeVideoId: data.youtubeVideoId,
                  allowReposts: data.allowReposts,
                  replyPermission: data.replyPermission,
                  category: 'echo',
                  quotedPostObject: data.quotedPostObject,
                  location: data.location,
                  sensitive: data.sensitive,
                  poll: data.poll,
                  // Enquete ainda não federa: fica só aqui; citações já federam normalmente.
                  federation: data.poll ? 'local' : federationReach,
              });
          }

          if (onPostCreated && newPost) {
              if (draftId) void cacheService.deleteDraft(draftId).catch(() => undefined);
              onPostCreated(newPost);
          } else {
              toast({
                  title: t('postSentTitle'),
                  description: t('postSentDescription'),
                  action: newPost ? (
                      <ToastAction altText={t('viewPost')} asChild>
                          <Link href={`/${locale}/post/${newPost.id}`}>{t('viewPost')}</Link>
                      </ToastAction>
                  ) : undefined,
              });
          }
          
          // A pessoa escolheu o Fediverso mas o post tem enquete: saiu só aqui. Dizer isso é parte da escolha.
          if (federationReach !== 'local' && data.poll) {
              toast({ title: t('federationSkippedTitle'), description: t('federationSkippedDescription') });
          }
          handleClose();
          // O post no Echo já foi confirmado e a janela já fechou. O envio externo acontece depois e nunca atrasa,
          // desfaz ou mascara o sucesso local; cada provedor devolve seu próprio resultado em um toast separado.
          if (newPost) void publishExternally(newPost, [...selectedNetworks]);
          return true;

      } catch (error: unknown) {
          console.error('Erro ao publicar o post:', error);
          toast({ title: t('errorTitle'), description: friendlyErrorMessage(error, t('errorDescription')), variant: "destructive" });
          return false;
      } finally {
          setIsSubmitting(false);
      }
  }


  return (
    <DialogContent 
        className="p-0 gap-0 sm:max-w-[600px] flex flex-col sm:h-auto sm:max-h-[90vh]"
        style={dialogStyle}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          focusTextareaAtEnd();
        }}
        showCloseButton={false}
    >
       <DialogHeader className="p-2 px-4 flex flex-row items-center justify-between border-b relative h-14">
            <Button type="button" variant="ghost" onClick={handleClose}>{t('cancelButton')}</Button>
             <DialogTitle className="sr-only">{t('title')}</DialogTitle>
             <DialogDescription className="sr-only">{t('description')}</DialogDescription>
             <div className="flex items-center gap-1.5">
                {currentUser?.isAdmin && (
                  <Button
                    type="button"
                    size="sm"
                    variant={postAsOfficial ? 'default' : 'outline'}
                    className="h-8 px-2.5 text-xs rounded-full gap-1"
                    onClick={() => setPostAsOfficial((v) => !v)}
                    disabled={isSubmitting}
                    title="Alternar publicação como conta oficial @ExercitoDoLula"
                  >
                    <Megaphone className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">@ExercitoDoLula</span>
                  </Button>
                )}
                <PublishTargetsControls
                  federationReach={federationReach}
                  onFederationChange={updateFederationReach}
                  connectedNetworks={connectedNetworks}
                  selectedNetworks={selectedNetworks}
                  onToggleNetwork={toggleNetwork}
                  postWillBePublic={postWillBePublic}
                  disabled={isSubmitting}
                />
                <Button type="submit" form="create-post-form" size="sm" className="rounded-full" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isSubmitting ? t('postButtonSubmitting') : t('postButton')}
                </Button>
             </div>
        </DialogHeader>
        
        <CommentInputArea
          formId="create-post-form"
          ref={textareaRef}
          onSendMessage={handleSendMessage}
          onFileUpload={handleFileUpload}
          isSubmitting={isSubmitting}
          placeholder={t('placeholder')}
          initialText={initialData?.text || ''}
          initialMedia={initialData?.media}
          initialFiles={initialFiles}
          initialReplyPermission={initialData?.replyPermission as ReplyPermission | undefined}
          initialAllowReposts={initialData?.allowReposts}
          initialQuotedPost={initialData?.quotedPostObject}
          initialLocation={initialData?.location}
          initialSensitive={initialData?.sensitive}
          initialPoll={initialData?.pollInput}
          draftId={initialData?.id}
          isModalLayout={true}
          showAvatar={true}
          enablePostOptions={true}
        />
    </DialogContent>
  );
}
