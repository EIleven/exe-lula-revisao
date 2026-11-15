// src/components/comments/CommentInputArea.tsx
'use client';

import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Loader2, Paperclip, X, Smile, Camera, Link as LinkIcon, Globe, XCircle, RefreshCw, Save, Users, Plus, FileVideo, UploadCloud, Video, Square, BarChart3, ShieldAlert, MapPin } from 'lucide-react';
import type { Post, ReplyPermission, Media, PollDraft, PostLocation } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { extractYoutubeVideoInfo } from '@/lib/utils/textUtils';
import Image from 'next/image';
import { ECHO_COMMENT_MAX_LENGTH } from '@/lib/constants/domain';
import { cn } from '@/lib/utils';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '../ui/separator';
import AltTextDialog from '@/components/shared/AltTextDialog';
import { useQuotedPostPreview } from '@/hooks/features/post/useQuotedPostPreview';
import EmbeddedPostCard from '../feed/EmbeddedPostCard';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { useMentions } from '@/hooks/features/mentions/useMentions';
import MentionSuggestions from '@/components/mentions/MentionSuggestions';
import { Popover, PopoverAnchor } from '@/components/ui/popover';
import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import InteractionSettingsDialog from '@/components/shared/InteractionSettingsDialog';
import { cacheService, type Draft } from '@/lib/services/cacheService';
import { v4 as uuidv4 } from 'uuid';
import { Skeleton } from '../ui/skeleton';
import { useIsMobile } from '@/hooks/use-mobile';
import { Capacitor } from '@capacitor/core';
import { Camera as CapacitorCamera, CameraResultType, CameraSource } from '@capacitor/camera';
import { friendlyErrorMessage } from '@/lib/utils/friendlyError';
import { haptics } from '@/lib/haptics';
import { useTranslations } from 'next-intl';
import EmojiButton from '@/components/composer/EmojiButton';
import LocationButton from '@/components/composer/LocationButton';
import PollEditor from '@/components/composer/PollEditor';
import { POLL_DEFAULT_DURATION_MINUTES, validatePoll } from '@/lib/poll';
import YoutubeEmbed from '@/components/shared/YoutubeEmbed';
import { MAX_VIDEO_DURATION_SECONDS } from '@/lib/media/videoPolicy';
import { isLikelyVideoFile } from '@/lib/services/mediaUploadService';

const MAX_MEDIA = 4;
// Limite do Storage (storage.rules): acima disso o envio é recusado, então o vídeo é barrado ANTES de enviar. As imagens
// são reduzidas antes do envio (mediaUploadService), por isso não têm esse teto na tela.
const IMAGE_TYPE = /^image\/(png|jpe?g|gif|webp|heic|heif|avif)$/;

/** Imagem, vídeo ou nada (o que o Storage não aceita, como SVG ou executável, nem chega a ser enviado). */
const classifyFile = (file: File): 'image' | 'video' | null => {
  if (IMAGE_TYPE.test(file.type) || /\.(heic|heif)$/i.test(file.name)) return 'image';
  if (isLikelyVideoFile(file)) return 'video';
  return null;
};


// Type for managing the UI state of each media item during upload
type MediaUploadState = {
  uploadId: string;
  type: 'image' | 'video';
  localPreviewUrl: string;
  remoteUrl?: string;
  alt?: string;
  status: 'uploading' | 'ready' | 'failed';
  error?: string;
  file?: File; // Keep a reference to the original file
};


interface CommentInputAreaProps {
  /**
   * Devolver `false` (ou lançar um erro) quando o envio NÃO deu certo: o texto e as imagens continuam no formulário
   * para a pessoa tentar de novo. Qualquer outro retorno é sucesso e limpa o formulário.
   */
  onSendMessage: (data: { text?: string; media?: Media[] | null; youtubeVideoId?: string; quotedPostObject?: Post | null; replyPermission: ReplyPermission; allowReposts: boolean; location?: PostLocation | null; sensitive?: boolean; poll?: PollDraft | null; }) => Promise<void | boolean>;
  onFileUpload: (file: File) => Promise<{ url: string; type: 'image' | 'video' | 'file' }>;
  isSubmitting: boolean;
  disabled?: boolean;
  placeholder?: string;
  onCancel?: () => void;
  formId?: string;
  initialText?: string;
  initialMedia?: Media[] | null;
  initialReplyPermission?: ReplyPermission;
  initialAllowReposts?: boolean;
  initialQuotedPost?: Post | null;
  draftId?: string;
  isModalLayout?: boolean;
  showAvatar?: boolean;
  /** Opções que pertencem ao post (localização, aviso de conteúdo e enquete), não a comentários/respostas. */
  enablePostOptions?: boolean;
  initialLocation?: PostLocation | null;
  initialSensitive?: boolean;
  initialPoll?: PollDraft | null;
  children?: React.ReactNode;
}

const CommentInputArea = forwardRef((
  {
    onSendMessage,
    onFileUpload,
    isSubmitting,
    disabled = false,
    placeholder = 'Write a comment...',
    onCancel,
    formId,
    initialText = '',
    initialMedia = null,
    initialReplyPermission = 'everyone',
    initialAllowReposts = true,
    initialQuotedPost,
    draftId: initialDraftId,
    isModalLayout = false,
    showAvatar = true,
    enablePostOptions = false,
    initialLocation = null,
    initialSensitive = false,
    initialPoll = null,
    children,
  }: CommentInputAreaProps,
  ref: React.Ref<HTMLTextAreaElement>
) => {
  const [textValue, setTextValue] = useState(initialText);
  const [draftId, setDraftId] = useState(initialDraftId);
  const [mediaItems, setMediaItems] = useState<MediaUploadState[]>(() =>
    (initialMedia || []).map(m => ({ ...m, uploadId: uuidv4(), localPreviewUrl: m.url, remoteUrl: m.url, status: 'ready' }))
  );
  const [editingMediaIndex, setEditingMediaIndex] = useState<number | null>(null);
  // Vagas de mídia ocupadas: o que já está na lista MAIS o que foi aceito e ainda está sendo lido. Um contador em ref
  // (e não o tamanho da lista no estado) para vários arquivos escolhidos de uma vez respeitarem o limite de 4.
  const slotsUsedRef = useRef((initialMedia || []).length);

  const [charCount, setCharCount] = useState(initialText.length);
  const [detectedVideoId, setDetectedVideoId] = useState<string | null>(null);

  const [replyPermission, setReplyPermission] = useState<ReplyPermission>(initialReplyPermission);
  const [allowReposts, setAllowReposts] = useState(initialAllowReposts);
  const [location, setLocation] = useState<PostLocation | null>(initialLocation);
  const [sensitive, setSensitive] = useState(initialSensitive);
  const [poll, setPoll] = useState<PollDraft | null>(initialPoll);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const isMobile = useIsMobile();

  useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement);

  useEffect(() => {
    if (!isModalLayout) return;
    const focarNoFinal = () => {
      const el = textareaRef.current;
      if (!el || el.disabled) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    };
    const raf = requestAnimationFrame(focarNoFinal);
    const t1 = setTimeout(focarNoFinal, 60);
    const t2 = setTimeout(focarNoFinal, 180);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isModalLayout]);

  const { toast } = useToast();
  const { currentUser } = useCurrentUser();
  const composerT = useTranslations('Composer');

  const handleCameraClick = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        const image = await CapacitorCamera.getPhoto({
          quality: 90,
          allowEditing: false,
          resultType: CameraResultType.Uri,
          source: CameraSource.Prompt,
          saveToGallery: true,
        });

        if (image.webPath) {
          const response = await fetch(image.webPath);
          const blob = await response.blob();
          const fileName = `camera_${Date.now()}.${image.format}`;
          const file = new File([blob], fileName, {
            type: image.webPath.endsWith('png') ? 'image/png' : 'image/jpeg',
          });
          addMediaFile(file);
        }
      } catch (error: any) {
        console.error('Capacitor camera error:', error);
        if (error.message !== 'User cancelled photos app' && error.message !== 'No photo selected') {
          toast({
            title: 'Erro na Câmera',
            description: 'Não foi possível acessar a câmera. Por favor, garanta que o aplicativo tem permissão.',
            variant: 'destructive',
          });
        }
      }
    } else {
      // Web fallback
      cameraInputRef.current?.click();
    }
  };

  const {
    quotedPost,
    isLoading: isLoadingPreview,
    error: previewError,
    removeQuotedPost,
  } = useQuotedPostPreview(textValue, (urlToRemove) => {
    const newText = textValue.replace(urlToRemove, '').trim();
    setTextValue(newText);
  });

  const finalQuotedPost = quotedPost || initialQuotedPost;

  const {
    suggestionType,
    suggestionQuery,
    suggestionsOpen,
    setSuggestionsOpen,
    handleSelect,
  } = useMentions(textValue, textareaRef);

  const handleSelectMention = (selectedValue: string) => {
    const { newText, newCursorPosition } = handleSelect(selectedValue) || {};
    if (newText !== undefined && newCursorPosition !== undefined) {
      setTextValue(newText);
      setTimeout(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(newCursorPosition, newCursorPosition);
      }, 0);
    }
  };

  useEffect(() => {
    setTextValue(initialText);
    setMediaItems((initialMedia || []).map(m => ({ ...m, uploadId: uuidv4(), localPreviewUrl: m.url, remoteUrl: m.url, status: 'ready' })));
    slotsUsedRef.current = (initialMedia || []).length;
    setCharCount(initialText.length);
    setLocation(initialLocation);
    setSensitive(initialSensitive);
    setPoll(initialPoll);
  }, [initialText, initialMedia, initialLocation, initialSensitive, initialPoll]);

  useEffect(() => {
    if (mediaItems.length === 0) setSensitive(false);
  }, [mediaItems.length]);

  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      
      let maxHeight;
      if (isModalLayout) {
        if (isMobile) {
          // Increase height for mobile modals as requested
          maxHeight = window.innerHeight * 0.50;
        } else {
          // Keep a generous but fixed height for desktop modals
          maxHeight = 350;
        }
      } else {
        // Default height for non-modal inputs (e.g., comment section in a post)
        maxHeight = 150;
      }
      
      const scrollHeight = textareaRef.current.scrollHeight;

      if (scrollHeight > maxHeight) {
        textareaRef.current.style.height = `${maxHeight}px`;
        textareaRef.current.style.overflowY = 'auto';
      } else {
        textareaRef.current.style.height = `${scrollHeight}px`;
        textareaRef.current.style.overflowY = 'hidden';
      }
    }
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [textValue, mediaItems, detectedVideoId, quotedPost, isModalLayout, isMobile]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setTextValue(text);
    setCharCount(text.length);

    const { videoId } = extractYoutubeVideoInfo(text);
    if (videoId) {
      setDetectedVideoId(videoId);
      setMediaItems([]); // Clear media if a video link is pasted
      slotsUsedRef.current = 0;
    } else {
      setDetectedVideoId(null);
    }
  };

  /** Insere o emoji exatamente no cursor, sem mandar a pessoa para o fim do texto. */
  const insertEmoji = (emoji: string) => {
    const input = textareaRef.current;
    const start = input?.selectionStart ?? textValue.length;
    const end = input?.selectionEnd ?? start;
    const next = `${textValue.slice(0, start)}${emoji}${textValue.slice(end)}`;
    setTextValue(next);
    setCharCount(next.length);
    requestAnimationFrame(() => {
      const cursor = start + emoji.length;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(cursor, cursor);
    });
  };

  /** Envia o arquivo de um item já na lista (também usado para tentar de novo um envio que falhou). */
  const runUpload = (uploadId: string, file: File) => {
    onFileUpload(file).then(({ url, type }) => {
      setMediaItems(prev => prev.map(item =>
        item.uploadId === uploadId
          ? { ...item, remoteUrl: url, type: type === 'video' ? 'video' : 'image', status: 'ready', error: undefined }
          : item
      ));
    }).catch((error: unknown) => {
      console.error("Upload failed:", error);
      const reason = friendlyErrorMessage(error, 'Não foi possível enviar o arquivo. Tente de novo.');
      toast({ title: "Falha no envio do arquivo", description: reason, variant: "destructive" });
      setMediaItems(prev => prev.map(item =>
        item.uploadId === uploadId
          ? { ...item, status: 'failed', error: reason }
          : item
      ));
    });
  };

  const retryUpload = (item: MediaUploadState) => {
    if (!item.file) return;
    setMediaItems(prev => prev.map(entry => entry.uploadId === item.uploadId ? { ...entry, status: 'uploading', error: undefined } : entry));
    runUpload(item.uploadId, item.file);
  };

  /** Libera a vaga de mídia reservada quando o arquivo desiste antes de entrar na lista. */
  const releaseSlot = () => {
    slotsUsedRef.current = Math.max(0, slotsUsedRef.current - 1);
  };

  const startUpload = (file: File, mediaType: 'image' | 'video') => {
    const uploadId = uuidv4();

    const reader = new FileReader();
    reader.onloadend = () => {
        const localPreviewUrl = reader.result as string; // This will be the data: URL

        const placeholder: MediaUploadState = {
            uploadId,
            localPreviewUrl,
            type: mediaType,
            status: 'uploading',
            file: file,
        };
        setMediaItems(prev => [...prev, placeholder]);
        runUpload(uploadId, file);
    };
    reader.onerror = (error) => {
        console.error("FileReader error:", error);
        releaseSlot();
        toast({ title: "Erro ao ler arquivo", description: "Não foi possível processar o arquivo localmente.", variant: "destructive" });
    };
    reader.readAsDataURL(file); // Read the file as a Base64 data URL
  };


  const addMediaFile = async (file: File) => {
    if (poll) {
      toast({ title: composerT('pollMediaConflictTitle'), description: composerT('pollMediaConflictDescription'), variant: 'destructive' });
      return;
    }
    const kind = classifyFile(file);
    if (!kind) {
      toast({ title: 'Arquivo não suportado', description: 'Anexe imagens (PNG, JPG, GIF, WebP) ou vídeos.', variant: 'destructive' });
      return;
    }
    // A regra do Storage exige tamanho estritamente menor que 5 MiB.
    if (slotsUsedRef.current >= MAX_MEDIA) {
      toast({ title: 'Limite de mídia atingido', description: `Você pode anexar até ${MAX_MEDIA} arquivos.`, variant: 'destructive' });
      return;
    }
    slotsUsedRef.current += 1; // reserva a vaga já aqui: a leitura do arquivo é assíncrona e vários arquivos chegam juntos

    if (kind === 'video') {
      const videoEl = document.createElement('video');
      videoEl.preload = 'metadata';
      videoEl.src = URL.createObjectURL(file); // Blob URL is fine for metadata reading
      videoEl.onloadedmetadata = () => {
        URL.revokeObjectURL(videoEl.src);
        if (videoEl.duration > MAX_VIDEO_DURATION_SECONDS) {
          releaseSlot();
          toast({ title: "Vídeo muito longo", description: "Escolha um vídeo com até 2 horas e 50 minutos.", variant: 'destructive'});
        } else {
          startUpload(file, 'video');
        }
      };
      videoEl.onerror = () => {
         URL.revokeObjectURL(videoEl.src);
         // O navegador pode não conhecer o codec; o FFmpeg do servidor ainda pode processá-lo.
         startUpload(file, 'video');
      };
    } else {
      startUpload(file, 'image');
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      Array.from(files).forEach(addMediaFile);
    }
    if (event.target) {
        event.target.value = '';
    }
  };
  
  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && (item.type.startsWith('image/') || item.type.startsWith('video/')))
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);
    if (files.length === 0) return; // só texto: o navegador cola normalmente
    event.preventDefault(); // era imagem: não cola o nome do arquivo no texto
    files.forEach(addMediaFile);
  };

  const removeMedia = (uploadIdToRemove: string) => {
    setMediaItems(prev => prev.filter(item => item.uploadId !== uploadIdToRemove));
    releaseSlot();
  };

  const handleAltTextSave = (altText: string) => {
    if (editingMediaIndex !== null) {
      setMediaItems(prev => prev.map((item, index) =>
        index === editingMediaIndex ? { ...item, alt: altText } : item
      ));
    }
    setEditingMediaIndex(null);
  };

  const handleSubmit = async (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();

    const isUploading = mediaItems.some(item => item.status === 'uploading');
    const hasFailedUploads = mediaItems.some(item => item.status === 'failed');

    if (isUploading) {
        toast({ title: "Aguarde o upload terminar", description: "Algumas mídias ainda estão sendo enviadas.", variant: "default" });
        return;
    }
    if (hasFailedUploads) {
        toast({ title: "Falha no upload", description: "Remova as mídias que falharam ou tente novamente.", variant: "destructive" });
        return;
    }
    if (isSubmitting || disabled) return;
    if (!textValue.trim() && mediaItems.length === 0 && !finalQuotedPost && !poll && !children) return;
    // Antes o texto era cortado em silêncio no limite e a pessoa publicava um texto diferente do que escreveu.
    if (textValue.trim().length > ECHO_COMMENT_MAX_LENGTH) {
      toast({ title: 'Texto longo demais', description: `O limite é de ${ECHO_COMMENT_MAX_LENGTH} caracteres. Encurte o texto para enviar.`, variant: 'destructive' });
      return;
    }
    if (poll) {
      const pollError = validatePoll(poll);
      if (pollError) {
        toast({ title: composerT('pollInvalidTitle'), description: composerT(`pollError_${pollError}`), variant: 'destructive' });
        return;
      }
      if (mediaItems.length > 0 || detectedVideoId) {
        toast({ title: composerT('pollMediaConflictTitle'), description: composerT('pollMediaConflictDescription'), variant: 'destructive' });
        return;
      }
    }

    const mediaPayload: Media[] = mediaItems
      .filter(m => m.status === 'ready' && !!m.remoteUrl)
      .map(m => ({
        url: m.remoteUrl!,
        type: m.type,
        alt: m.alt || '',
        'data-ai-hint': m.alt ? 'custom' : 'user upload' // Basic logic
      }));

    try {
      const result = await onSendMessage({
        text: textValue.trim(),
        media: mediaPayload.length > 0 ? mediaPayload : null,
        youtubeVideoId: detectedVideoId || undefined,
        quotedPostObject: finalQuotedPost,
        replyPermission,
        allowReposts,
        location: enablePostOptions ? location : undefined,
        sensitive: enablePostOptions ? sensitive : undefined,
        poll: enablePostOptions ? poll : undefined,
      });
      // Envio recusado (erro, sem login, vazio): o texto e as imagens ficam onde estão para a pessoa tentar de novo.
      if (result === false) return;
      haptics.success();

      setTextValue('');
      setCharCount(0);
      setMediaItems([]);
      slotsUsedRef.current = 0;
      setDetectedVideoId(null);
      removeQuotedPost();
      setLocation(null);
      setSensitive(false);
      setPoll(null);
      if (onCancel) onCancel();

    } catch (error) {
      console.error("Failed to send message:", error);
      toast({ title: "Mensagem não enviada", description: friendlyErrorMessage(error, 'Não foi possível enviar. Seu texto foi mantido: tente de novo.'), variant: "destructive" });
    }
  };

  // Ctrl+Enter (ou Cmd+Enter) envia, como nas outras redes.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void handleSubmit();
    }
  };

  const handleSaveDraft = async () => {
    if (!textValue.trim() && mediaItems.length === 0 && !finalQuotedPost && !poll) {
      toast({ title: "Nada para salvar", description: "Escreva algo para salvar como rascunho.", variant: "default" });
      return;
    }
    const mediaPayload: Media[] = mediaItems
      .filter(m => m.status === 'ready' && m.remoteUrl)
      .map(m => ({ url: m.remoteUrl!, type: m.type, alt: m.alt }));

    const draftData: Omit<Draft, 'savedAt'> = {
      id: draftId,
      draftType: 'post',
      text: textValue,
      media: mediaPayload,
      quotedPostObject: finalQuotedPost,
      replyPermission,
      allowReposts,
      location: enablePostOptions ? location : undefined,
      sensitive: enablePostOptions ? sensitive : undefined,
      pollInput: enablePostOptions ? poll : undefined,
    };
    const newDraftId = await cacheService.saveDraft(draftData);
    setDraftId(newDraftId);
    toast({ title: "Rascunho salvo!", description: "Seu post foi salvo localmente." });
  };
  
  const isAnyMediaUploading = mediaItems.some(item => item.status === 'uploading');
  const isAnyMediaFailed = mediaItems.some(item => item.status === 'failed');
  const isEffectivelyDisabled = disabled || isSubmitting || isAnyMediaUploading || isAnyMediaFailed;
  
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };
  
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    setIsDraggingOver(false);
  };
  
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      Array.from(e.dataTransfer.files).forEach(addMediaFile);
      e.dataTransfer.clearData();
    }
  };

  return (
      <div className="flex-1 flex flex-col min-h-0">
        <AltTextDialog
          isOpen={editingMediaIndex !== null}
          onOpenChange={(isOpen) => !isOpen && setEditingMediaIndex(null)}
          initialAltText={editingMediaIndex !== null ? mediaItems[editingMediaIndex]?.alt : ''}
          onSave={handleAltTextSave}
        />
        <form
          id={formId}
          onSubmit={handleSubmit}
          className="relative flex-1 flex flex-col min-h-0"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-x-4 flex">
              {showAvatar && (
              <Avatar className="w-10 h-10">
                  <AvatarImage src={currentUser?.avatarUrl} alt={currentUser?.name} data-ai-hint={currentUser?.["data-ai-hint"] || "person avatar"} />
                  <AvatarFallback>{currentUser?.name?.substring(0, 1)?.toUpperCase() || 'U'}</AvatarFallback>
              </Avatar>
              )}
              <div className="flex-1">
                  <Popover open={suggestionsOpen} onOpenChange={setSuggestionsOpen}>
                  <PopoverAnchor asChild>
                      <Textarea
                      ref={textareaRef}
                      autoFocus={isModalLayout}
                      value={textValue}
                      onChange={handleTextChange}
                      onPaste={handlePaste}
                      onKeyDown={handleKeyDown}
                      placeholder={placeholder}
                      className="w-full text-lg border-none resize-none overflow-y-auto focus-visible:ring-0 focus-visible:ring-offset-0 p-0 shadow-none min-h-[180px]"
                      disabled={isSubmitting || disabled}
                      />
                  </PopoverAnchor>
                  {suggestionsOpen && (
                      <MentionSuggestions
                      type={suggestionType}
                      query={suggestionQuery}
                      onSelect={handleSelectMention}
                      />
                  )}
                  </Popover>

                  <div className="mt-2 space-y-2">
                      {mediaItems.length > 0 && (
                          <div className={cn('grid gap-1 rounded-lg border p-1', mediaItems.length === 1 ? 'grid-cols-1' : 'grid-cols-2')} data-testid="composer-media">
                              {mediaItems.map((item, index) => {
                                  const isVideo = item.type === 'video';
                                  const single = mediaItems.length === 1;
                                  return (
                                      <div
                                          key={item.uploadId}
                                          data-status={item.status}
                                          className={cn(
                                              'relative overflow-hidden rounded-md bg-muted',
                                              !single && 'aspect-square',
                                              mediaItems.length === 3 && index === 0 && 'row-span-2',
                                          )}
                                      >
                                          {isVideo ? (
                                              <video src={item.localPreviewUrl} className={cn('w-full rounded-md', single ? 'h-auto max-h-[40vh]' : 'h-full object-cover')} controls={false} preload="metadata" playsInline />
                                          ) : (
                                              <img src={item.localPreviewUrl} alt={item.alt || `Mídia ${index + 1}`} className={cn('w-full rounded-md', single ? 'h-auto max-h-[40vh]' : 'h-full object-cover')} draggable={false} />
                                          )}
                                          {/* Os controles ficam SEMPRE visíveis: no toque não existe "passar o mouse", e a camada transparente que
                                              existia por cima engolia o toque nos botões (inclusive o de tentar de novo). Alvos maiores no toque. */}
                                          <button type="button" aria-label="Remover mídia" title="Remover mídia" onClick={() => removeMedia(item.uploadId)} className="absolute right-1.5 top-1.5 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white shadow hover:bg-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"><X className="h-4 w-4" /></button>
                                          {item.status === 'ready' && item.type === 'image' && (
                                              <button type="button" onClick={() => setEditingMediaIndex(index)} aria-label={item.alt ? 'Editar a descrição da imagem' : 'Adicionar descrição à imagem'} className="absolute bottom-1.5 left-1.5 z-20 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-white shadow hover:bg-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white [@media(pointer:coarse)]:px-3 [@media(pointer:coarse)]:py-2">{item.alt ? 'ALT ✓' : '+ ALT'}</button>
                                          )}
                                          {item.status === 'uploading' && (
                                              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50" role="status" aria-label="Enviando"><Loader2 className="h-6 w-6 animate-spin text-white" /></div>
                                          )}
                                          {item.status === 'failed' && (
                                              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-destructive/75 p-2 text-center text-destructive-foreground">
                                                  <p className="text-xs font-bold">O envio falhou</p>
                                                  <Button type="button" size="sm" variant="secondary" className="relative z-20 h-8 text-xs [@media(pointer:coarse)]:h-10" onClick={() => retryUpload(item)}>Tentar novamente</Button>
                                              </div>
                                          )}
                                      </div>
                                  );
                              })}
                          </div>
                      )}
                      {detectedVideoId && (
                        <YoutubeEmbed videoId={detectedVideoId} className="mt-2" title="Prévia do vídeo do YouTube" />
                      )}
                      {isLoadingPreview && ( <div className="mt-2 flex items-center justify-center p-4 border rounded-lg"><Loader2 className="mr-2 h-4 w-4 animate-spin" /><span>Carregando post...</span></div>)}
                      {previewError && <div className="mt-2 text-destructive text-sm p-4 border rounded-lg border-destructive/50 bg-destructive/10">{previewError}</div>}
                      {finalQuotedPost && (
                          <div className="mt-2 relative">
                              <EmbeddedPostCard post={finalQuotedPost} />
                              <Button type="button" variant="destructive" size="icon" className="absolute top-2 right-2 h-7 w-7 rounded-full" onClick={removeQuotedPost}><XCircle className="h-5 w-5" /></Button>
                          </div>
                      )}
                      {enablePostOptions && location && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="composer-location-selected">
                          <MapPin className="h-4 w-4 text-primary" aria-hidden="true" />
                          <span>{location.name}, {location.state}</span>
                          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => setLocation(null)} disabled={isEffectivelyDisabled}>
                            {composerT('locationRemove')}
                          </Button>
                        </div>
                      )}
                      {enablePostOptions && poll && (
                        <PollEditor value={poll} onChange={setPoll} onRemove={() => setPoll(null)} disabled={isEffectivelyDisabled} />
                      )}
                      {children}
                  </div>
              </div>
          </div>
          <div className="mt-auto">
            <Separator />
            <div className="p-2 px-4 flex items-center justify-between w-full">
                <div className="flex items-center gap-1">
                    <EmojiButton onPick={insertEmoji} disabled={isEffectivelyDisabled} />
                    <Dialog>
                        <DialogTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" className="text-primary h-8 w-8" aria-label="Configurações de Interação" title="Configurações de Interação" >
                                <Users className="h-5 w-5"/>
                            </Button>
                        </DialogTrigger>
                        <InteractionSettingsDialog currentReplyPermission={replyPermission} currentAllowReposts={allowReposts} onSave={(newSettings) => { setReplyPermission(newSettings.replyPermission); setAllowReposts(newSettings.allowReposts); }} />
                    </Dialog>
                    <Button type="button" variant="ghost" size="icon" className="text-primary h-8 w-8" onClick={handleSaveDraft} title="Salvar Rascunho"><Save className="h-5 w-5"/></Button>
                    {enablePostOptions && (
                      <>
                        <LocationButton value={location} onChange={setLocation} disabled={isEffectivelyDisabled} />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={cn('h-8 w-8 text-primary', poll && 'bg-primary/10')}
                          aria-label={composerT('pollButton')}
                          title={composerT('pollButton')}
                          aria-pressed={!!poll}
                          data-testid="composer-poll-button"
                          disabled={isEffectivelyDisabled || (!poll && (mediaItems.length > 0 || !!detectedVideoId))}
                          onClick={() => setPoll(current => current ? null : { options: ['', ''], durationMinutes: POLL_DEFAULT_DURATION_MINUTES })}
                        >
                          <BarChart3 className="h-5 w-5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={cn('h-8 w-8 text-primary', sensitive && 'bg-destructive/15 text-destructive')}
                          aria-label={composerT('sensitiveButton')}
                          title={composerT('sensitiveButton')}
                          aria-pressed={sensitive}
                          data-testid="composer-sensitive-button"
                          disabled={isEffectivelyDisabled || mediaItems.length === 0}
                          onClick={() => setSensitive(value => !value)}
                        >
                          <ShieldAlert className="h-5 w-5" />
                        </Button>
                      </>
                    )}
                    <input type="file" multiple accept="image/*,video/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" id="modal-file-upload-icon"/>
                    <input type="file" accept="image/*,video/*" capture ref={cameraInputRef} onChange={handleFileChange} className="hidden" />
                    <Button type="button" variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} className="text-primary h-8 w-8" aria-label="Adicionar imagem ou vídeo" title="Adicionar imagem ou vídeo" disabled={isEffectivelyDisabled || !!poll}><Paperclip className="h-5 w-5"/></Button>
                    <Button type="button" variant="ghost" size="icon" onClick={handleCameraClick} className="text-primary h-8 w-8" aria-label="Usar câmera" title="Usar câmera" disabled={isEffectivelyDisabled || !!poll}><Camera className="h-5 w-5"/></Button>
                </div>
                <div className={cn("text-sm", charCount > ECHO_COMMENT_MAX_LENGTH ? "text-destructive" : "text-muted-foreground")}>
                    {charCount}/{ECHO_COMMENT_MAX_LENGTH}
                </div>
            </div>
          </div>
          <button id={formId ? `${formId}-submit-button` : 'fallback-submit-id'} type="submit" className="hidden">Submit</button>
          {isDraggingOver && (
              <div className="absolute inset-0 bg-primary/20 flex flex-col items-center justify-center pointer-events-none rounded-lg z-30">
                  <UploadCloud className="h-12 w-12 text-primary" />
                  <p className="mt-2 text-lg font-semibold text-primary">Solte para fazer o upload</p>
              </div>
          )}
        </form>
      </div>
  );
});

CommentInputArea.displayName = 'CommentInputArea';
export default CommentInputArea;
