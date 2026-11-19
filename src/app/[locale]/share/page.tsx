// src/app/[locale]/share/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import {
  ArrowLeft,
  FileText,
  Image as ImageIcon,
  Link2,
  Loader2,
  MessageSquare,
  Newspaper,
  PenSquare,
  Search,
  Send,
  Share2,
  Users,
  Video as VideoIcon,
  X,
} from 'lucide-react';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import CreatePostDialogContent from '@/components/feed/CreatePostDialogContent';
import CreateNewsDialogContent from '@/components/feed/CreateNewsDialogContent';
import {
  clearPendingShare,
  consumeNativeAndroidShare,
  extractShareParts,
  getPendingShare,
  setPendingShare,
  type IncomingSharePayload,
} from '@/lib/share/pendingShareStore';
import {
  getOrCreateConversation,
  getUserConversations,
  sendDirectMessage,
} from '@/lib/services/conversationService';
import {
  directMessageMediaPathFactory,
  isLikelyVideoFile,
  postMediaPathFactory,
  uploadFileToStorage,
} from '@/lib/services/mediaUploadService';
import { searchUsers } from '@/lib/services/userService';
import { useDebounce } from '@/hooks/use-debounce';
import { useToast } from '@/hooks/use-toast';
import { haptics } from '@/lib/haptics';
import type { Conversation, Post, User } from '@/lib/types';

export default function ShareTargetPage() {
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser, isLoading } = useCurrentUser();
  const { toast } = useToast();

  const [payload, setPayload] = useState<IncomingSharePayload | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftText, setDraftText] = useState('');
  const [sharedUrl, setSharedUrl] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [initializing, setInitializing] = useState(true);

  const [activeMode, setActiveMode] = useState<'choose' | 'post' | 'article' | 'dm'>('choose');
  const [articleSeedImageUrl, setArticleSeedImageUrl] = useState<string | null>(null);
  const [preparingArticle, setPreparingArticle] = useState(false);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConvos, setLoadingConvos] = useState(false);
  const [dmSearch, setDmSearch] = useState('');
  const debouncedDmSearch = useDebounce(dmSearch, 250);
  const [foundUsers, setFoundUsers] = useState<User[]>([]);
  const [sendingTargetId, setSendingTargetId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const qTitle = searchParams.get('title');
      const qText = searchParams.get('text');
      const qUrl = searchParams.get('url');

      let resolved: IncomingSharePayload | null = null;
      if (qTitle || qText || qUrl) {
        const parts = extractShareParts({ title: qTitle, text: qText, url: qUrl });
        resolved = {
          title: parts.title,
          text: parts.text,
          url: parts.url,
          files: [],
          source: 'web',
        };
        setPendingShare(resolved);
      } else {
        resolved = (await consumeNativeAndroidShare()) || getPendingShare();
      }

      if (cancelled) return;
      if (resolved) {
        const parts = extractShareParts({
          title: resolved.title,
          text: resolved.text,
          url: resolved.url,
        });
        setPayload(resolved);
        setDraftTitle(parts.title);
        setSharedUrl(parts.url);
        setDraftText(parts.combinedText);
        setFiles(resolved.files || []);
      }
      setInitializing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  const filePreviews = useMemo(
    () =>
      files.map((file) => ({
        file,
        kind: file.type.startsWith('image/')
          ? ('image' as const)
          : isLikelyVideoFile(file)
            ? ('video' as const)
            : ('file' as const),
        previewUrl:
          file.type.startsWith('image/') || isLikelyVideoFile(file)
            ? URL.createObjectURL(file)
            : null,
      })),
    [files]
  );

  useEffect(() => {
    return () => {
      filePreviews.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    };
  }, [filePreviews]);

  useEffect(() => {
    if (activeMode !== 'dm' || !currentUser?.id) return;
    let cancelled = false;
    setLoadingConvos(true);
    void getUserConversations(currentUser.id)
      .then((list) => {
        if (!cancelled) setConversations(list.slice(0, 15));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoadingConvos(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeMode, currentUser?.id]);

  useEffect(() => {
    if (activeMode !== 'dm' || !currentUser?.id || debouncedDmSearch.trim().length < 2) {
      setFoundUsers([]);
      return;
    }
    let cancelled = false;
    void searchUsers(debouncedDmSearch.trim(), currentUser.id)
      .then((list) => {
        if (!cancelled) {
          setFoundUsers(
            list.filter(
              (u) =>
                u.id !== currentUser.id &&
                u.dmPreference !== 'none' &&
                !u.hasBlockedCurrentUser &&
                !u.isBlocked
            )
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeMode, currentUser?.id, debouncedDmSearch]);

  const handleOpenArticle = async () => {
    if (!currentUser?.id || preparingArticle) return;
    haptics.select();
    const firstImage = files.find((f) => f.type.startsWith('image/'));
    if (firstImage && !articleSeedImageUrl) {
      setPreparingArticle(true);
      try {
        const uploaded = await uploadFileToStorage(currentUser.id, firstImage, postMediaPathFactory);
        setArticleSeedImageUrl(uploaded.downloadURL);
      } catch {
        toast({
          title: 'Imagem não anexada ao artigo',
          description: 'Você ainda pode adicionar uma imagem dentro do editor de artigo.',
        });
      } finally {
        setPreparingArticle(false);
      }
    }
    setActiveMode('article');
  };

  const handlePostCreated = (newPost: Post) => {
    clearPendingShare();
    haptics.success();
    toast({ title: 'Publicado com sucesso!' });
    router.replace(`/${locale}/post/${newPost.id}`);
  };

  const sendToConversation = async (convo: Conversation) => {
    if (!currentUser?.id || sendingTargetId) return;
    setSendingTargetId(convo.id);
    try {
      let fileUrl: string | undefined;
      let fileType: 'image' | 'video' | 'file' | undefined;
      const firstFile = files[0];
      if (firstFile) {
        const up = await uploadFileToStorage(currentUser.id, firstFile, directMessageMediaPathFactory);
        fileUrl = up.downloadURL;
        fileType = firstFile.type.startsWith('image/')
          ? 'image'
          : isLikelyVideoFile(firstFile)
            ? 'video'
            : 'file';
      }

      const messageText = draftText.trim() || (fileUrl ? '' : sharedUrl);
      if (!messageText && !fileUrl) {
        toast({ title: 'Escreva uma mensagem ou anexe um arquivo para enviar.', variant: 'destructive' });
        return;
      }

      await sendDirectMessage(convo.id, currentUser.id, {
        text: messageText,
        fileUrl,
        fileType,
      });

      clearPendingShare();
      haptics.success();
      toast({ title: 'Enviado!' });
      if (convo.isGroup) {
        router.replace(`/${locale}/messages/group/${convo.id}`);
      } else {
        const other = convo.participantsInfo?.find((p) => p.id !== currentUser.id);
        const otherId = convo.participantIds.find((id) => id !== currentUser.id) || other?.id;
        router.replace(otherId ? `/${locale}/messages/user/${otherId}` : `/${locale}/messages`);
      }
    } catch (err) {
      toast({
        title: 'Falha ao enviar',
        description: err instanceof Error ? err.message : 'Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setSendingTargetId(null);
    }
  };

  const sendToUser = async (targetUser: User) => {
    if (!currentUser?.id || sendingTargetId) return;
    setSendingTargetId(targetUser.id);
    try {
      const convo = await getOrCreateConversation(currentUser.id, targetUser.id);
      if (!convo) throw new Error('Não foi possível abrir a conversa.');
      await sendToConversation(convo);
    } catch (err) {
      toast({
        title: 'Falha ao enviar DM',
        description: err instanceof Error ? err.message : 'Tente novamente.',
        variant: 'destructive',
      });
      setSendingTargetId(null);
    }
  };

  const removeFileAt = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  if (initializing || isLoading) {
    return (
      <div className="max-w-xl mx-auto p-6 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  if (!currentUser) {
    const loginHref = `/${locale}/login?redirect=${encodeURIComponent(`/${locale}/share`)}`;
    return (
      <div className="max-w-xl mx-auto p-4 sm:p-6">
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Share2 className="h-5 w-5 text-primary" />
              Compartilhar no HiperVerso
            </CardTitle>
            <CardDescription>
              Entre na sua conta para publicar esse conteúdo como Post, Artigo ou enviar por DM.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {draftText && (
              <div className="rounded-xl border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground line-clamp-4">
                {draftText}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button asChild className="rounded-full">
                <Link href={loginHref}>Entrar e continuar</Link>
              </Button>
              <Button variant="outline" asChild className="rounded-full">
                <Link href={`/${locale}`}>Ir para o Feed</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const hasContent = Boolean(draftText.trim() || sharedUrl || files.length > 0 || payload);

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              clearPendingShare();
              router.push(`/${locale}`);
            }}
            aria-label="Voltar"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2">
              <Share2 className="h-5 w-5 text-primary" />
              Compartilhar rápido
            </h1>
            <p className="text-xs text-muted-foreground">
              Escolha em 1 toque como publicar ou enviar o conteúdo recebido.
            </p>
          </div>
        </div>
      </div>

      {!hasContent ? (
        <Card>
          <CardContent className="p-6 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              Nenhum link, texto ou mídia pendente no momento. Compartilhe de qualquer aplicativo usando &ldquo;Compartilhar → HiperVerso&rdquo;.
            </p>
            <Button asChild className="rounded-full">
              <Link href={`/${locale}`}>Voltar ao Feed</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="border-border/80 bg-card/80">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-sm font-semibold">Conteúdo recebido</CardTitle>
                {sharedUrl && (
                  <Badge variant="secondary" className="gap-1 max-w-full truncate font-normal">
                    <Link2 className="h-3 w-3 shrink-0 text-primary" />
                    <span className="truncate">{sharedUrl}</span>
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                rows={4}
                placeholder="Adicione um comentário ou edite o texto antes de escolher..."
                className="resize-y text-sm"
              />

              {filePreviews.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {filePreviews.map((item, idx) => (
                    <div
                      key={`${item.file.name}-${idx}`}
                      className="relative aspect-square rounded-xl border border-border overflow-hidden bg-muted flex items-center justify-center"
                    >
                      {item.kind === 'image' && item.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.previewUrl}
                          alt={item.file.name}
                          className="h-full w-full object-cover"
                        />
                      ) : item.kind === 'video' ? (
                        <div className="flex flex-col items-center gap-1 p-2 text-center">
                          <VideoIcon className="h-6 w-6 text-primary" />
                          <span className="text-[11px] text-muted-foreground line-clamp-2">{item.file.name}</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1 p-2 text-center">
                          <FileText className="h-6 w-6 text-primary" />
                          <span className="text-[11px] text-muted-foreground line-clamp-2">{item.file.name}</span>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => removeFileAt(idx)}
                        aria-label="Remover anexo"
                        className="absolute top-1 right-1 rounded-full bg-black/70 p-1 text-white hover:bg-black"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => {
                haptics.select();
                setActiveMode('post');
              }}
              className="flex flex-col items-start gap-2 rounded-2xl border border-primary/40 bg-primary/10 p-4 text-left transition-colors hover:border-primary hover:bg-primary/15"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <PenSquare className="h-5 w-5" />
              </div>
              <div>
                <div className="font-bold text-sm text-foreground">Postar no Feed</div>
                <div className="text-xs text-muted-foreground">Publicação rápida com texto, link e mídias</div>
              </div>
            </button>

            <button
              type="button"
              disabled={preparingArticle}
              onClick={() => void handleOpenArticle()}
              className="flex flex-col items-start gap-2 rounded-2xl border border-border/80 bg-card p-4 text-left transition-colors hover:border-primary/60 hover:bg-muted/30"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted border border-border text-primary">
                {preparingArticle ? <Loader2 className="h-5 w-5 animate-spin" /> : <Newspaper className="h-5 w-5" />}
              </div>
              <div>
                <div className="font-bold text-sm text-foreground">Publicar Artigo</div>
                <div className="text-xs text-muted-foreground">Matéria completa com fonte e categoria</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                haptics.select();
                setActiveMode((prev) => (prev === 'dm' ? 'choose' : 'dm'));
              }}
              className="flex flex-col items-start gap-2 rounded-2xl border border-border/80 bg-card p-4 text-left transition-colors hover:border-primary/60 hover:bg-muted/30"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted border border-border text-primary">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div>
                <div className="font-bold text-sm text-foreground">Enviar por DM / Grupo</div>
                <div className="text-xs text-muted-foreground">Compartilhar direto com alguém ou grupo</div>
              </div>
            </button>
          </div>

          {activeMode === 'dm' && (
            <Card className="border-primary/35">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Send className="h-4 w-4 text-primary" />
                  Escolha a conversa ou pessoa
                </CardTitle>
                <div className="relative pt-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={dmSearch}
                    onChange={(e) => setDmSearch(e.target.value)}
                    placeholder="Buscar pessoa pelo nome ou @..."
                    className="pl-9"
                  />
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-64 pr-2">
                  {loadingConvos ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {debouncedDmSearch.trim().length >= 2 &&
                        foundUsers.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            disabled={Boolean(sendingTargetId)}
                            onClick={() => void sendToUser(u)}
                            className="w-full flex items-center justify-between gap-3 rounded-xl p-2.5 text-left hover:bg-muted transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <Avatar className="h-9 w-9 shrink-0">
                                <AvatarImage src={u.avatarUrl} alt={u.name} />
                                <AvatarFallback>{u.name?.[0] || '?'}</AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="text-sm font-semibold truncate">{u.name}</p>
                                <p className="text-xs text-muted-foreground truncate">@{u.username}</p>
                              </div>
                            </div>
                            {sendingTargetId === u.id ? (
                              <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                            ) : (
                              <Send className="h-4 w-4 text-primary shrink-0" />
                            )}
                          </button>
                        ))}

                      {debouncedDmSearch.trim().length < 2 &&
                        conversations.map((c) => {
                          const other = c.participantsInfo?.find((p) => p.id !== currentUser.id) || c.participantsInfo?.[0];
                          const title = c.isGroup
                            ? c.groupName || 'Grupo'
                            : other?.name || 'Conversa';
                          const subtitle = c.isGroup
                            ? `${c.participantIds.length} participantes`
                            : other?.username
                              ? `@${other.username}`
                              : '';
                          const avatar = c.isGroup ? c.groupAvatarUrl || undefined : other?.avatarUrl;
                          return (
                            <button
                              key={c.id}
                              type="button"
                              disabled={Boolean(sendingTargetId)}
                              onClick={() => void sendToConversation(c)}
                              className="w-full flex items-center justify-between gap-3 rounded-xl p-2.5 text-left hover:bg-muted transition-colors"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <Avatar className="h-9 w-9 shrink-0">
                                  <AvatarImage src={avatar} alt={title} />
                                  <AvatarFallback>
                                    {c.isGroup ? <Users className="h-4 w-4" /> : title[0] || '?'}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold truncate">{title}</p>
                                  {subtitle && (
                                    <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
                                  )}
                                </div>
                              </div>
                              {sendingTargetId === c.id ? (
                                <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                              ) : (
                                <Send className="h-4 w-4 text-primary shrink-0" />
                              )}
                            </button>
                          );
                        })}

                      {!loadingConvos &&
                        debouncedDmSearch.trim().length < 2 &&
                        conversations.length === 0 && (
                          <p className="py-8 text-center text-xs text-muted-foreground">
                            Digite o nome ou @ acima para iniciar uma conversa direta.
                          </p>
                        )}
                      {debouncedDmSearch.trim().length >= 2 && foundUsers.length === 0 && (
                        <p className="py-8 text-center text-xs text-muted-foreground">
                          Nenhuma pessoa encontrada para enviar DM.
                        </p>
                      )}
                    </div>
                  )}
                </ScrollArea>
                {files.length > 1 && (
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                    Na DM será enviado o primeiro anexo junto ao texto; no Post você pode publicar até 4 mídias.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={activeMode === 'post'} onOpenChange={(open) => !open && setActiveMode('choose')}>
        <CreatePostDialogContent
          initialData={{ text: draftText }}
          initialFiles={files}
          onPostCreated={handlePostCreated}
          dialogClose={() => setActiveMode('choose')}
        />
      </Dialog>

      <Dialog open={activeMode === 'article'} onOpenChange={(open) => !open && setActiveMode('choose')}>
        <CreateNewsDialogContent
          initialData={{
            headline: draftTitle,
            text: draftText,
            sourceUrl: sharedUrl,
            imageUrl: articleSeedImageUrl,
          }}
          onPostCreated={handlePostCreated}
          dialogClose={() => setActiveMode('choose')}
        />
      </Dialog>
    </div>
  );
}
