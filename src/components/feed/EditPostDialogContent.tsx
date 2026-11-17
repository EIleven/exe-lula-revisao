// src/components/feed/EditPostDialogContent.tsx
'use client';

import { useState, useEffect, useRef } from 'react';
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
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { editPost as serverEditPost } from '@/lib/services/posts/editPostAction';
import type { Post, ReplyPermission, Media } from '@/lib/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Link as LinkIcon, Users, Image as ImageIcon, XCircle, Newspaper, UploadCloud, Accessibility, ShieldAlert } from 'lucide-react';
import { NEWS_BODY_MAX_LENGTH, NEWS_HEADLINE_MAX_LENGTH, ECHO_COMMENT_MAX_LENGTH } from '@/lib/constants/domain';
import ArticleEditor from '@/components/editor/ArticleEditor'; 
import { uploadFileToStorage, postMediaPathFactory, isLikelyVideoFile } from '@/lib/services/mediaUploadService';
import { Editor } from '@tiptap/react';
import { Textarea } from '../ui/textarea';
import InteractionSettingsDialog from '../shared/InteractionSettingsDialog';
import { Separator } from '../ui/separator';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { extractYoutubeVideoInfo } from '@/lib/utils/textUtils';
import { useVisualViewport } from '@/hooks/useVisualViewport';
import { useIsMobile } from '@/hooks/use-mobile';
import PlatformVideo from '@/components/shared/PlatformVideo';
import AltTextDialog from '@/components/shared/AltTextDialog';
import { ScrollArea } from '../ui/scroll-area';
import YoutubeEmbed from '@/components/shared/YoutubeEmbed';
import { useCurrentUserId } from '@/contexts/CurrentUserContext';

const MAX_EDIT_MEDIA = 4;

const newsCategories = [
  "Ciência", "Tecnologia", "Política", "Artes", "Cinema", "Música", "Esportes",
  "Negócios", "Saúde", "Meio Ambiente", "Notícias do Mundo", "Notícias Locais",
  "Opinião", "Estilo de Vida", "Educação", "Outro"
];

const createEditPostFormSchema = (category: 'echo' | 'news' | undefined) => {
  if (category === 'news') {
    return z.object({
      headline: z.string().min(5, "O título deve ter pelo menos 5 caracteres.").max(NEWS_HEADLINE_MAX_LENGTH, `O título não pode exceder ${NEWS_HEADLINE_MAX_LENGTH} caracteres.`),
      text: z.string().min(10, "O corpo da notícia deve ter pelo menos 10 caracteres.").max(NEWS_BODY_MAX_LENGTH, `O corpo da notícia não pode exceder ${NEWS_BODY_MAX_LENGTH} caracteres.`),
      sourceUrl: z.string().url("Por favor, insira uma URL de fonte válida.").optional().or(z.literal('')),
      newsCategory: z.string().min(1, "Por favor, selecione uma categoria de notícia."),
      customNewsCategory: z.string().max(50, "A categoria personalizada não pode exceder 50 caracteres.").optional(),
    }).refine(data => {
      if (data.newsCategory === 'Outro') {
        return !!data.customNewsCategory && data.customNewsCategory.trim().length > 0;
      }
      return true;
    }, {
      message: "Por favor, especifique uma categoria personalizada.",
      path: ["customNewsCategory"],
    });
  } else { 
    return z.object({
        text: z.string().max(ECHO_COMMENT_MAX_LENGTH, `O post não pode exceder ${ECHO_COMMENT_MAX_LENGTH} caracteres.`).optional(),
    }).refine(data => !!data.text?.trim(), {
        message: "O post não pode estar vazio.",
        path: ["text"],
    });
  }
};


interface EditPostDialogContentProps {
  postToEdit: Post;
  onPostEdited: (updatedPost: Post) => void;
  dialogClose?: () => void;
}

export default function EditPostDialogContent({ postToEdit, onPostEdited, dialogClose }: EditPostDialogContentProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const viewportHeight = useVisualViewport();
  const isNews = postToEdit.category === 'news';
  const dialogStyle = isMobile ? { height: viewportHeight ? `${viewportHeight}px` : '90svh' } : {};
  
  const [replyPermission, setReplyPermission] = useState<ReplyPermission>(postToEdit.replyPermission);
  const [allowReposts, setAllowReposts] = useState(postToEdit.allowReposts);
  const [media, setMedia] = useState<Media[]>(postToEdit.media || []);
  const [sensitive, setSensitive] = useState<boolean>(Boolean(postToEdit.sensitive));
  const [detectedVideoId, setDetectedVideoId] = useState<string | null>(postToEdit.youtubeVideoId || null);
  const [charCount, setCharCount] = useState(postToEdit.text?.length || 0);
  const [showCustomCategoryInput, setShowCustomCategoryInput] = useState(false);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [editingAltIndex, setEditingAltIndex] = useState<number | null>(null);
  const currentUserId = useCurrentUserId();
  
  const editorRef = useRef<Editor>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const formSchema = createEditPostFormSchema(postToEdit.category);
  type EditPostFormValues = z.infer<typeof formSchema>;

  const form = useForm<EditPostFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      text: postToEdit.text || '',
      ...(isNews && {
        headline: postToEdit.headline || '',
        sourceUrl: postToEdit.sourceUrl || '',
        newsCategory: '',
        customNewsCategory: '',
      }),
    },
    mode: 'onChange',
  });
  
  const { setValue, getValues, formState: { isDirty, isValid }, trigger } = form;

  useEffect(() => {
    if (isNews) {
      const isCustom = postToEdit.newsCategory && !newsCategories.includes(postToEdit.newsCategory);
      setShowCustomCategoryInput(isCustom);
      form.reset({
        text: postToEdit.text || '',
        headline: postToEdit.headline || '',
        sourceUrl: postToEdit.sourceUrl || '',
        newsCategory: isCustom ? 'Outro' : postToEdit.newsCategory,
        customNewsCategory: isCustom ? postToEdit.newsCategory : '',
      });
    } else {
      form.reset({
        text: postToEdit.text || '',
      });
    }
    setSensitive(Boolean(postToEdit.sensitive));
  }, [postToEdit, form, isNews]);

  useEffect(() => {
    if (media.length === 0 && sensitive) {
      setSensitive(false);
    }
  }, [media.length, sensitive]);

  const hasInteractionSettingsChanged = replyPermission !== postToEdit.replyPermission || allowReposts !== postToEdit.allowReposts;
  const hasSensitiveChanged = (media.length > 0 ? sensitive : false) !== Boolean(postToEdit.sensitive);
  const hasMediaChanged = JSON.stringify(media) !== JSON.stringify(postToEdit.media || []) || detectedVideoId !== (postToEdit.youtubeVideoId || null);
  const canSubmit = !isSubmitting && !isUploadingMedia && (isDirty || hasMediaChanged || hasInteractionSettingsChanged || hasSensitiveChanged);
  
  const handleEditorUpdate = (htmlContent: string) => {
    setValue('text', htmlContent, { shouldValidate: true, shouldDirty: true });
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    form.setValue('text', text, { shouldValidate: true });
    setCharCount(text.length);

    const { videoId } = extractYoutubeVideoInfo(text);
    if (videoId) {
        setDetectedVideoId(videoId);
        setMedia([]); // Clear media if a video link is pasted
    } else if (detectedVideoId && !text.includes(detectedVideoId)) {
        setDetectedVideoId(null);
    }
  };

  const removeImage = (indexToRemove: number) => {
    setMedia(prev => prev.filter((_, index) => index !== indexToRemove));
  };

  const uploadEditorFile = async (file: File): Promise<string | null> => {
    if (!currentUserId) {
      toast({ title: 'Login obrigatório', description: 'Entre novamente para enviar mídia.', variant: 'destructive' });
      return null;
    }
    try {
      const result = await uploadFileToStorage(currentUserId, file, postMediaPathFactory);
      return result.downloadURL;
    } catch (error) {
      toast({ title: 'Falha no envio', description: error instanceof Error ? error.message : 'Não foi possível enviar a mídia.', variant: 'destructive' });
      return null;
    }
  };

  const addMediaFiles = async (files: File[]) => {
    if (isUploadingMedia) return;
    const supported = files.filter((file) => file.type.startsWith('image/') || isLikelyVideoFile(file));
    const available = Math.max(0, MAX_EDIT_MEDIA - media.length);
    if (supported.length === 0) {
      toast({ title: 'Arquivo não suportado', description: 'Use uma imagem ou um vídeo.', variant: 'destructive' });
      return;
    }
    if (available === 0) {
      toast({ title: 'Limite de mídia atingido', description: `Você pode anexar até ${MAX_EDIT_MEDIA} arquivos.`, variant: 'destructive' });
      return;
    }
    if (supported.length > available) {
      toast({ title: 'Alguns arquivos não foram anexados', description: `Restam ${available} vagas de mídia.`, variant: 'destructive' });
    }
    setIsUploadingMedia(true);
    const uploaded: Media[] = [];
    try {
      for (const file of supported.slice(0, available)) {
        const url = await uploadEditorFile(file);
        if (url) uploaded.push({ url, type: isLikelyVideoFile(file) ? 'video' : 'image', alt: '' });
      }
      if (uploaded.length > 0) {
        setDetectedVideoId(null);
        setMedia((current) => [...current, ...uploaded].slice(0, MAX_EDIT_MEDIA));
      }
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const handleMediaPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
      .filter((file) => file.type.startsWith('image/') || isLikelyVideoFile(file));
    if (files.length === 0) return;
    event.preventDefault();
    void addMediaFiles(files);
  };

  async function onSubmit(data: EditPostFormValues) {
    if (!canSubmit) return;
    
    setIsSubmitting(true);
    try {
      const editData: Partial<Post> & { media?: Media[] | null } = {
        text: data.text,
        allowReposts,
        replyPermission,
        media: media,
        sensitive: media.length > 0 ? sensitive : false,
        youtubeVideoId: detectedVideoId || null,
      };

      if (postToEdit.category === 'news') {
        const newsData = data as Extract<EditPostFormValues, { headline: string; newsCategory?: string; customNewsCategory?: string; }>;
        editData.headline = newsData.headline;
        editData.sourceUrl = newsData.sourceUrl;
        editData.newsCategory = newsData.newsCategory === 'Outro' ? newsData.customNewsCategory : newsData.newsCategory;
      }
      
      const updatedPost = await serverEditPost(postToEdit.id, editData);

      if (updatedPost) {
        toast({ title: 'Post Atualizado!', description: 'Suas alterações foram salvas.' });
        onPostEdited(updatedPost);
        if (dialogClose) dialogClose();
      } else {
         toast({ title: 'Atualização Não Aplicada', description: 'Nenhuma alteração foi salva.', variant: 'default' });
      }
    } catch (error: any) {
      toast({ title: 'Erro ao Atualizar Post', description: error.message || 'Por favor, tente novamente.', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <DialogContent 
      className={cn(
        "p-0 gap-0 flex flex-col",
        isNews 
          ? "sm:max-w-3xl"
          : (isMobile ? 'h-screen' : 'sm:h-auto sm:max-h-[90vh] sm:max-w-lg')
      )}
      style={dialogStyle}
      onOpenAutoFocus={(e) => e.preventDefault()} 
      showCloseButton={false}
    >
      <DialogHeader className="p-4 flex flex-row items-center justify-between border-b">
        <DialogClose asChild>
            <Button type="button" variant="ghost">Cancelar</Button>
        </DialogClose>
        <DialogTitle className="sr-only">Editar {postToEdit.category === 'news' ? 'Artigo' : 'Post'}</DialogTitle>
        <DialogDescription className="sr-only">
            Faça alterações em sua {postToEdit.category === 'news' ? 'publicação' : 'post'}. 
            {postToEdit.category !== 'news' && " Você só pode editar um post uma vez."}
        </DialogDescription>
         <Button type="submit" onClick={form.handleSubmit(onSubmit)} disabled={!canSubmit} size="sm">
          {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Salvar
        </Button>
      </DialogHeader>
      
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="relative flex-1 flex flex-col min-h-0"
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setIsDraggingOver(true); }}
          onDragLeave={(event) => {
            event.preventDefault();
            if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
            setIsDraggingOver(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setIsDraggingOver(false);
            void addMediaFiles(Array.from(event.dataTransfer.files));
          }}
        >
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4">
              
              {isNews && (
                <>
                  <FormField
                    control={form.control}
                    name="headline"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input placeholder="Título do Artigo" {...field} className="text-2xl font-bold border-none shadow-none p-0 focus-visible:ring-0 focus-visible:ring-offset-0 h-auto" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="text"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <ArticleEditor
                              content={field.value || ''}
                              onUpdate={handleEditorUpdate}
                              onImageUpload={uploadEditorFile}
                              editorRef={editorRef}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {postToEdit.category === 'echo' && (
                  <FormField
                      control={form.control}
                      name="text"
                      render={({ field }) => (
                          <FormItem>
                          <FormControl>
                              <Textarea 
                                  ref={textareaRef}
                                  placeholder="O que está acontecendo?" 
                                  {...field} 
                                   onChange={(e) => {
                                       field.onChange(e);
                                       handleTextChange(e);
                                   }}
                                   onPaste={handleMediaPaste}
                                  className="min-h-[120px] text-base border-none shadow-none focus-visible:ring-0"
                              />
                          </FormControl>
                          <FormMessage />
                          </FormItem>
                      )}
                  />
              )}
           
            {media.length > 0 && (
              <div className="mt-2 grid gap-2 rounded-lg border" style={{gridTemplateColumns: `repeat(${media.length > 1 ? 2 : 1}, 1fr)`}}>
                  {media.map((mediaItem, index) => (
                      <div key={mediaItem.url + index} className="relative group aspect-video">
                          {mediaItem.type === 'video' ? (
                            <PlatformVideo src={mediaItem.url} className="h-full w-full rounded-md object-cover" preload="metadata" playsInline />
                          ) : (
                            <>
                              <Image src={mediaItem.url} alt={mediaItem.alt || `Mídia ${index + 1}`} fill className="rounded-md object-cover" />
                              <button
                                type="button"
                                onClick={() => setEditingAltIndex(index)}
                                className="absolute bottom-1.5 left-1.5 z-10 inline-flex items-center gap-1 rounded-full bg-black/75 px-2 py-0.5 text-[11px] font-semibold text-white border border-white/20 hover:bg-black"
                                title={mediaItem.alt ? 'Editar Alt Text' : 'Adicionar Alt Text'}
                              >
                                <Accessibility className="h-3 w-3 text-emerald-400" />
                                {mediaItem.alt?.trim() ? 'ALT' : '+ ALT'}
                              </button>
                            </>
                          )}
                          <Button type="button" variant="destructive" size="icon" className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100" onClick={() => removeImage(index)}><XCircle className="h-4 w-4" /></Button>
                      </div>
                  ))}
              </div>
            )}
            {editingAltIndex !== null && (
              <AltTextDialog
                isOpen={editingAltIndex !== null}
                onOpenChange={(open) => {
                  if (!open) setEditingAltIndex(null);
                }}
                initialAltText={media[editingAltIndex]?.alt}
                onSave={(newAlt) => {
                  setMedia((prev) =>
                    prev.map((m, idx) => (idx === editingAltIndex ? { ...m, alt: newAlt.trim() || undefined } : m))
                  );
                }}
              />
            )}
             {detectedVideoId && (
                <YoutubeEmbed videoId={detectedVideoId} className="mt-2" title="Prévia do vídeo do YouTube" />
            )}

              </div>
            </ScrollArea>
             <DialogFooter className="p-4 flex items-center justify-between w-full border-t">
                  <div className="flex items-center gap-1">
                      <Dialog>
                          <DialogTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="text-primary h-8 w-8"
                                  aria-label="Configurações de Interação"
                                  title="Configurações de Interação"
                                  >
                                  <Users className="h-5 w-5"/>
                              </Button>
                          </DialogTrigger>
                          <InteractionSettingsDialog 
                              currentReplyPermission={replyPermission} 
                              currentAllowReposts={allowReposts} 
                              onSave={(newSettings) => {
                                  setReplyPermission(newSettings.replyPermission);
                                  setAllowReposts(newSettings.allowReposts);
                              }}
                          />
                      </Dialog>
                      {postToEdit.category === 'echo' && (
                          <>
                              <input
                                type="file"
                                accept="image/*,video/*"
                                multiple
                                ref={fileInputRef}
                                className="hidden"
                                onChange={(event) => {
                                  void addMediaFiles(Array.from(event.target.files ?? []));
                                  event.target.value = '';
                                }}
                              />
                              <Button type="button" variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} className="text-primary h-8 w-8" disabled={isSubmitting || isUploadingMedia} aria-label="Adicionar imagem ou vídeo" title="Adicionar imagem ou vídeo">
                                  <ImageIcon className="h-5 w-5"/>
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => setSensitive((prev) => !prev)}
                                className={cn('text-primary h-8 w-8', sensitive && 'bg-destructive/15 text-destructive')}
                                disabled={isSubmitting || isUploadingMedia || media.length === 0}
                                aria-label="Marcar mídia como conteúdo sensível"
                                title="Marcar mídia como conteúdo sensível"
                                aria-pressed={sensitive}
                                data-testid="composer-sensitive-button"
                              >
                                <ShieldAlert className="h-5 w-5" />
                              </Button>
                          </>
                      )}
                       {isNews && (
                          <div className="flex items-center gap-2">
                           <FormField
                              control={form.control}
                              name="newsCategory"
                              render={({ field }) => (
                                <FormItem>
                                  <Select
                                    onValueChange={(value) => {
                                      field.onChange(value);
                                      setShowCustomCategoryInput(value === 'Outro');
                                       if (value !== 'Outro') {
                                         setValue('customNewsCategory', '');
                                       }
                                       trigger('customNewsCategory');
                                    }}
                                    value={field.value}
                                  >
                                    <FormControl>
                                      <SelectTrigger className="w-auto h-8 px-2 border-dashed">
                                        <Newspaper className="h-4 w-4 text-muted-foreground" />
                                        <SelectValue placeholder="Categoria" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      {newsCategories.map(category => (
                                        <SelectItem key={category} value={category}>{category}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </FormItem>
                              )}
                            />
                             {showCustomCategoryInput && (
                                <FormField
                                  control={form.control}
                                  name="customNewsCategory"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormControl>
                                        <Input
                                          placeholder="Qual categoria?"
                                          {...field}
                                          value={field.value || ''}
                                          className="h-8 pl-2 border-dashed"
                                          onChange={(e) => {
                                            field.onChange(e);
                                            trigger('customNewsCategory');
                                          }}
                                        />
                                      </FormControl>
                                      <FormMessage className="text-xs" />
                                    </FormItem>
                                  )}
                                />
                            )}
                            </div>
                      )}
                  </div>
                  {postToEdit.category === 'echo' && (
                      <div className={cn( "text-sm", charCount > ECHO_COMMENT_MAX_LENGTH ? "text-destructive" : "text-muted-foreground" )}>
                          {charCount}/{ECHO_COMMENT_MAX_LENGTH}
                      </div>
                   )}
            </DialogFooter>
            {isDraggingOver && (
              <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/95 text-primary">
                <UploadCloud className="h-10 w-10" aria-hidden="true" />
                <p className="mt-2 font-semibold">Solte a imagem ou o vídeo para anexar</p>
              </div>
            )}
        </form>
      </Form>
    </DialogContent>
  );
}
