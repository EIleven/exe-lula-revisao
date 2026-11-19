// src/components/feed/CreateNewsDialogContent.tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, FormProvider } from 'react-hook-form';
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
import { createPost as serverCreatePost } from '@/lib/services/posts/createPostActions';
import { editPost as serverEditPost } from '@/lib/services/posts/editPostAction';
import type { Post, ReplyPermission, Draft } from '@/lib/types'; // Import Draft type
import { useRouter } from 'next/navigation';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Link as LinkIcon, Newspaper, Users, Save, Eye, Pencil } from 'lucide-react'; // Import Save icon
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { NEWS_BODY_MAX_LENGTH, NEWS_HEADLINE_MAX_LENGTH } from '@/lib/constants/domain';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import InteractionSettingsDialog from '@/components/shared/InteractionSettingsDialog';
import ArticleEditor from '@/components/editor/ArticleEditor';
import type { ArticleFontStyle } from '@/components/editor/Toolbar';
import { sanitizeHtml } from '@/lib/security/sanitizeHtml';
import { uploadFileToStorage, postMediaPathFactory } from '@/lib/services/mediaUploadService';
import { Editor } from '@tiptap/react';
import Image from 'next/image';
import { ToastAction } from '@/components/ui/toast';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { cacheService } from '@/lib/services/cacheService'; // Import cacheService
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { useVisualViewport } from '@/hooks/useVisualViewport';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import PublishTargetsControls, { usePublishTargets } from '@/components/federation/PublishTargetsControls';

const newsCategories = [
  "Ciência", "Tecnologia", "Política", "Artes", "Cinema", "Música", "Esportes",
  "Negócios", "Saúde", "Meio Ambiente", "Notícias do Mundo", "Notícias Locais",
  "Opinião", "Estilo de Vida", "Educação", "Outro"
];

const createNewsFormSchema = z.object({
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

type CreateNewsFormValues = z.infer<typeof createNewsFormSchema>;

interface CreateNewsDialogContentProps {
  onPostCreated?: (newPost: Post) => void;
  postToEdit?: Post;
  onPostEdited?: (updatedPost: Post) => void;
  dialogClose?: () => void;
  initialData?: Partial<Draft> & { imageUrl?: string | null };
}

const escapeHtmlText = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const formatInitialArticleHtml = (data?: Partial<Draft> & { imageUrl?: string | null }): string => {
  if (!data) return '';
  let body = (data.text || '').trim();
  const hasHtmlBlock = /<(p|div|h[1-6]|ul|ol|blockquote|pre|img|video|figure|br)\b/i.test(body);
  if (body && !hasHtmlBlock) {
    body = body
      .split(/\n{2,}/)
      .map((para) => para.trim())
      .filter(Boolean)
      .map((para) => `<p>${escapeHtmlText(para).replace(/\n/g, '<br>')}</p>`)
      .join('');
  }
  if (data.imageUrl) {
    const safeSrc = escapeHtmlText(data.imageUrl);
    const safeAlt = escapeHtmlText(data.headline || '');
    return `<img src="${safeSrc}" alt="${safeAlt}" />${body}`;
  }
  return body;
};

export default function CreateNewsDialogContent({ onPostCreated, postToEdit, onPostEdited, dialogClose, initialData }: CreateNewsDialogContentProps) {
  const isEditMode = Boolean(postToEdit);
  const effectiveInitial = postToEdit
    ? {
        headline: postToEdit.headline || '',
        text: postToEdit.text || '',
        sourceUrl: postToEdit.sourceUrl || '',
        newsCategory: postToEdit.newsCategory || '',
        replyPermission: postToEdit.replyPermission,
        allowReposts: postToEdit.allowReposts,
      }
    : initialData;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draftId, setDraftId] = useState<string | undefined>(initialData?.id);
  const [replyPermission, setReplyPermission] = useState<ReplyPermission>((effectiveInitial?.replyPermission as ReplyPermission) || 'everyone');
  const [allowReposts, setAllowReposts] = useState(effectiveInitial?.allowReposts ?? true);
  const [showCustomCategoryInput, setShowCustomCategoryInput] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [fontStyle, setFontStyle] = useState<ArticleFontStyle>('sans');
  const editorRef = useRef<Editor>(null);
  const locale = useLocale();
  const isMobile = useIsMobile();
  const viewportHeight = useVisualViewport();
  const dialogStyle = isMobile ? { height: viewportHeight ? `${viewportHeight}px` : '100svh' } : {};

  const headlineInputRef = useRef<HTMLInputElement>(null);

  const { toast } = useToast();
  const { currentUser } = useCurrentUser();
  const currentUserId = currentUser?.id;
  const {
    federationReach,
    updateFederationReach,
    connectedNetworks,
    selectedNetworks,
    toggleNetwork,
    postWillBePublic,
    publishExternally,
  } = usePublishTargets();

  const form = useForm<CreateNewsFormValues>({
    resolver: zodResolver(createNewsFormSchema),
    defaultValues: {
      headline: effectiveInitial?.headline || '',
      text: formatInitialArticleHtml(effectiveInitial),
      sourceUrl: effectiveInitial?.sourceUrl || '',
      newsCategory: '',
      customNewsCategory: '',
    },
    mode: 'onChange',
  });
  
  const { formState: { isValid }, control, setValue, getValues, trigger } = form;
  
  useEffect(() => {
    const seed = postToEdit
      ? {
          headline: postToEdit.headline || '',
          text: postToEdit.text || '',
          sourceUrl: postToEdit.sourceUrl || '',
          newsCategory: postToEdit.newsCategory || '',
        }
      : initialData;
    if (seed) {
      const editorContent = formatInitialArticleHtml(seed);
      const isCustomCategory = Boolean(seed.newsCategory && !newsCategories.includes(seed.newsCategory));
      setShowCustomCategoryInput(isCustomCategory);
      
      form.reset({
        headline: seed.headline,
        text: editorContent,
        sourceUrl: seed.sourceUrl,
        newsCategory: isCustomCategory ? 'Outro' : seed.newsCategory,
        customNewsCategory: isCustomCategory ? seed.newsCategory : '',
      });
      if (!postToEdit) setDraftId(initialData?.id);
    }
    const timer = setTimeout(() => {
      const el = headlineInputRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }, 100);
    return () => clearTimeout(timer);
  }, [initialData, postToEdit, form]);
  
  const handleClose = () => {
    if (dialogClose) dialogClose();
  }

  const handleEditorUpdate = (htmlContent: string) => {
    setValue('text', htmlContent, { shouldValidate: true, shouldDirty: true });
  };

  const handleImageUpload = async (file: File) => {
    if (!currentUserId) {
        toast({ title: "Autenticação Necessária", variant: "destructive" });
        return null;
    }
    try {
      const uploadResult = await uploadFileToStorage(currentUserId, file, postMediaPathFactory);
      return uploadResult.downloadURL;
    } catch (error) {
      toast({ title: "Falha no Upload", description: "Não foi possível carregar a imagem.", variant: "destructive"});
      return null;
    }
  };
  
  const handleSaveDraft = async () => {
    const values = getValues();
    if (!values.headline && !values.text) {
      toast({ title: "Nada para salvar", description: "Escreva algo para salvar como rascunho.", variant: "default" });
      return;
    }
    setIsSubmitting(true);
    try {
      const finalCategory = values.newsCategory === 'Outro' ? values.customNewsCategory : values.newsCategory;

      const newDraftId = await cacheService.saveDraft({
        id: draftId,
        draftType: 'news',
        ...values,
        newsCategory: finalCategory,
        replyPermission,
        allowReposts,
      });
      setDraftId(newDraftId);
      toast({ title: "Rascunho salvo!", description: "Seu artigo foi salvo localmente." });
    } catch (error) {
      toast({ title: "Erro ao Salvar", description: "Não foi possível salvar o rascunho.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  async function onSubmit(data: CreateNewsFormValues) {
    if (!currentUserId) {
      toast({ title: "Autenticação Necessária", description: "Por favor, faça login para criar um artigo de notícia.", variant: "destructive" });
      handleClose();
      return;
    }
    setIsSubmitting(true);
    try {
      const finalCategory = data.newsCategory === 'Outro' ? data.customNewsCategory : data.newsCategory;

      if (postToEdit) {
        const updatedPost = await serverEditPost(postToEdit.id, {
          text: data.text,
          headline: data.headline,
          sourceUrl: data.sourceUrl,
          newsCategory: finalCategory,
          allowReposts,
          replyPermission,
        });
        if (updatedPost) {
          toast({ title: 'Artigo atualizado!', description: 'Suas alterações foram salvas.' });
          onPostEdited?.(updatedPost);
          handleClose();
        } else {
          toast({ title: 'Atualização não aplicada', description: 'Nenhuma alteração foi salva.' });
        }
        return;
      }
      
      const newPost = await serverCreatePost({
        userId: currentUserId,
        headline: data.headline,
        text: data.text,
        sourceUrl: data.sourceUrl,
        newsCategory: finalCategory,
        allowReposts: allowReposts,
        replyPermission: replyPermission,
        category: 'news',
        federation: federationReach,
      });
      
      if (onPostCreated && newPost) {
        if(draftId) await cacheService.deleteDraft(draftId);
        onPostCreated(newPost);
      } else {
        toast({
          title: 'Artigo de Notícia Publicado!',
          description: 'Seu artigo de notícia está no ar.',
          action: newPost ? (
            <ToastAction altText="Ver Artigo" asChild>
              <Link href={`/${locale}/post/${newPost.id}`}>Ver Artigo</Link>
            </ToastAction>
          ) : undefined,
        });
      }

      form.reset();
      handleClose();
      if (newPost) void publishExternally(newPost, [...selectedNetworks]);

    } catch (error: any) {
      console.error("Error publishing news:", error);
      toast({
        title: 'Erro ao Publicar Notícia',
        description: error.message || 'Não foi possível publicar o artigo de notícia. Por favor, tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <DialogContent 
      className={cn(
        "p-0 gap-0 w-full max-w-[100vw] overflow-hidden flex flex-col sm:h-[88vh] sm:max-h-[90vh]",
        isMobile ? 'h-screen' : 'sm:max-w-3xl lg:max-w-4xl'
      )}
      style={dialogStyle}
      onOpenAutoFocus={(e) => e.preventDefault()}
      showCloseButton={false}
    >
      <DialogHeader className="px-3 sm:px-4 h-14 flex flex-row items-center justify-between gap-2 border-b relative flex-shrink-0">
        <DialogClose asChild>
          <Button type="button" variant="ghost" size="sm" className="px-2 sm:px-3">Cancelar</Button>
        </DialogClose>
        <div className="sr-only">
          <DialogTitle>{isEditMode ? 'Editar Artigo' : 'Criar Artigo'}</DialogTitle>
          <DialogDescription>Compartilhe uma atualização ou história importante. Forneça um título, corpo e, opcionalmente, uma imagem ou fonte.</DialogDescription>
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          {!isEditMode && (
            <PublishTargetsControls
              federationReach={federationReach}
              onFederationChange={updateFederationReach}
              connectedNetworks={connectedNetworks}
              selectedNetworks={selectedNetworks}
              onToggleNetwork={toggleNetwork}
              postWillBePublic={postWillBePublic}
              disabled={isSubmitting}
            />
          )}
          <Button
            type="button"
            variant={previewMode ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setPreviewMode((prev) => !prev)}
            disabled={isSubmitting}
            className="h-8 px-2.5"
            title={previewMode ? 'Voltar a escrever' : 'Pré-visualizar artigo'}
          >
            {previewMode ? <Pencil className="h-4 w-4 sm:mr-1.5" /> : <Eye className="h-4 w-4 sm:mr-1.5" />}
            <span className="hidden sm:inline">{previewMode ? 'Editar' : 'Preview'}</span>
          </Button>
          {!isEditMode && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSaveDraft}
              disabled={isSubmitting}
              className="h-8 px-2.5"
              title="Salvar Rascunho"
            >
              <Save className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Salvar</span>
            </Button>
          )}
          <Button type="submit" form="create-news-form" disabled={isSubmitting || !isValid} size="sm" className="rounded-full h-8 px-3.5">
            {isSubmitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {isEditMode
              ? (isSubmitting ? 'Salvando...' : 'Salvar')
              : (isSubmitting ? 'Publicando...' : 'Publicar')}
          </Button>
        </div>
      </DialogHeader>
      
      <Form {...form}>
        <form id="create-news-form" onSubmit={form.handleSubmit(onSubmit)} className="flex-1 flex flex-col min-h-0 min-w-0 w-full overflow-hidden">
            <ScrollArea className="flex-1 w-full min-w-0 [&>[data-radix-scroll-area-viewport]>div]:!block [&>[data-radix-scroll-area-viewport]>div]:min-w-0">
              <div className="p-4 sm:p-6 space-y-4 w-full max-w-full min-w-0">
                <FormField
                  control={form.control}
                  name="headline"
                  render={({ field }) => (
                      <FormItem>
                      <FormControl>
                          <Input
                            {...field}
                            ref={(el) => {
                              field.ref(el);
                              (headlineInputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
                            }}
                            placeholder="Título do Artigo"
                            className="text-xl sm:text-2xl font-bold border-none shadow-none p-0 focus-visible:ring-0 focus-visible:ring-offset-0 h-auto bg-transparent"
                          />
                      </FormControl>
                      <FormMessage />
                      </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 border-y border-border/60 py-3">
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
                              <SelectTrigger className="w-full h-9 px-3 bg-muted/30 border-border/70">
                                  <div className="flex items-center gap-2 truncate">
                                    <Newspaper className="h-4 w-4 text-primary shrink-0"/>
                                    <SelectValue placeholder="Escolha a categoria *" />
                                  </div>
                              </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                              {newsCategories.map(category => (
                              <SelectItem key={category} value={category}>{category}</SelectItem>
                              ))}
                          </SelectContent>
                          </Select>
                          <FormMessage className="text-xs" />
                      </FormItem>
                      )}
                  />
                  <FormField
                      control={form.control}
                      name="sourceUrl"
                      render={({ field }) => (
                          <FormItem>
                              <FormControl>
                                  <div className="relative">
                                      <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                      <Input placeholder="URL da fonte (opcional)" {...field} className="h-9 pl-9 bg-muted/30 border-border/70"/>
                                  </div>
                              </FormControl>
                              <FormMessage className="text-xs"/>
                          </FormItem>
                      )}
                  />
                  {showCustomCategoryInput && (
                    <FormField
                        control={form.control}
                        name="customNewsCategory"
                        render={({ field }) => (
                          <FormItem className="sm:col-span-2">
                              <FormControl>
                                <Input 
                                  placeholder="Qual categoria personalizada?" 
                                  {...field}
                                  value={field.value || ''}
                                  className="h-9 px-3 bg-muted/30 border-border/70" 
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

                <FormField
                  control={form.control}
                  name="text"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        {previewMode ? (
                          <div className={cn("w-full max-w-full min-w-0 overflow-hidden break-words rounded-lg border border-border/70 bg-card/50 p-5 sm:p-7 min-h-[300px]", fontStyle === 'serif' ? 'font-serif' : 'font-sans')}>
                            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-4 break-words">
                              {getValues('headline') || 'Título do Artigo'}
                            </h1>
                            <div
                              className="prose prose-sm sm:prose-base dark:prose-invert w-full max-w-full min-w-0 break-words"
                              dangerouslySetInnerHTML={{
                                __html: sanitizeHtml(field.value || '<p class="text-muted-foreground">Nada escrito ainda...</p>'),
                              }}
                            />
                          </div>
                        ) : (
                          <ArticleEditor
                              content={field.value || ''}
                              onUpdate={handleEditorUpdate}
                              onImageUpload={handleImageUpload}
                              editorRef={editorRef}
                              fontStyle={fontStyle}
                              onFontStyleChange={setFontStyle}
                              placeholder="Escreva seu artigo aqui... (suporta títulos, citações, imagens, vídeos, links e formatação)"
                          />
                        )}
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </ScrollArea>
          <DialogFooter className="px-4 py-2.5 flex flex-row items-center justify-between w-full flex-shrink-0 border-t bg-background/95">
            <div className="flex items-center gap-2">
              <Dialog>
                  <DialogTrigger asChild>
                      <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-primary h-8 px-2.5 gap-1.5"
                          aria-label="Configurações de Interação"
                          title="Configurações de Interação"
                          >
                          <Users className="h-4 w-4"/>
                          <span className="text-xs font-medium">Quem pode responder</span>
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
            </div>
            {selectedNetworks.includes('bluesky') && (
              <span className="text-[11px] text-muted-foreground truncate">
                Bluesky receberá título + link do artigo
              </span>
            )}
          </DialogFooter>
        </form>
      </Form>
    </DialogContent>
  );
}
