// src/components/messages/MessageBubble.tsx
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import type { DirectMessage, Post } from '@/lib/types';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR, enUS } from 'date-fns/locale';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import Link from 'next/link';
import Image from 'next/image';
import TextWithMentions from '@/components/shared/TextWithMentions';
import ImageViewer from '@/components/shared/ImageViewer';
import { Check, CheckCheck, Clock, Cloud, ExternalLink, Loader2, Lock, MoreHorizontal, MessageSquareReply, Copy, Forward, Star, Trash2, Zap } from 'lucide-react';
import { useMessagesHost } from '@/modules/messages';
import { useLocale } from 'next-intl';
import { Skeleton } from '../ui/skeleton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { deleteDirectMessage } from '@/lib/services/conversationService';
import { extractYoutubeVideoInfo } from '@/lib/utils/youtubeLinks';
import YoutubeEmbed from '@/components/shared/YoutubeEmbed';
import PlatformVideo from '@/components/shared/PlatformVideo';
import { useCurrentUserId } from '@/contexts/CurrentUserContext';
import { decryptMediaToObjectUrl, lerDescritorDeMidia } from '@/lib/crypto/e2eeMedia';
import AnexoProtegidoGrande from './AnexoProtegidoGrande';

interface MessageBubbleProps {
  message: DirectMessage;
  isCurrentUserSender: boolean;
  peerPublicKey?: string | null;
  onDeleteMessage: (messageId: string) => void;
  onReply: (message: DirectMessage) => void;
}

export default function MessageBubble({ message, isCurrentUserSender, peerPublicKey, onDeleteMessage, onReply }: MessageBubbleProps) {
  const currentUserId = useCurrentUserId();
  const messagesHost = useMessagesHost();
  const sender = message.sender;
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const locale = useLocale();
  // 'p' sem locale cai no relógio de 12 horas (3:40 PM). Em pt-BR a hora é 15:40.
  const localeDatas = locale === 'pt-BR' ? ptBR : enUS;

  const [linkPreviewPost, setLinkPreviewPost] = useState<Post | null>(null);
  const [isLoadingLinkPreview, setIsLoadingLinkPreview] = useState(false);
  
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const youtubeInfo = useMemo(() => extractYoutubeVideoInfo(message.text || ''), [message.text]);
  const [decryptedMediaUrl, setDecryptedMediaUrl] = useState<string | null>(null);
  const [mediaDecryptError, setMediaDecryptError] = useState<'missing-key' | 'failed' | null>(null);
  /** Descritor do anexo cifrado. Anexo GRANDE (v2) tem tela própria e não baixa sozinho. */
  const [descritorDaMidia, setDescritorDaMidia] = useState<{ v: number; bruto: unknown } | null>(null);

  useEffect(() => {
    if (!message.fileUrl || !message.mediaE2ee || !currentUserId) {
      setDescritorDaMidia(null);
      return;
    }
    let cancelado = false;
    void lerDescritorDeMidia(message.mediaE2ee, currentUserId, isCurrentUserSender, peerPublicKey).then((d) => {
      if (!cancelado) setDescritorDaMidia(d);
    });
    return () => { cancelado = true; };
  }, [message.fileUrl, message.mediaE2ee, currentUserId, isCurrentUserSender, peerPublicKey]);

  useEffect(() => {
    if (!message.fileUrl || !message.mediaE2ee || !currentUserId || descritorDaMidia?.v === 2) {
      setDecryptedMediaUrl(null);
      setMediaDecryptError(null);
      return;
    }
    let cancelled = false;
    void decryptMediaToObjectUrl(
      message.fileUrl,
      message.mediaE2ee,
      currentUserId,
      isCurrentUserSender,
      peerPublicKey
    ).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setDecryptedMediaUrl(res.objectUrl);
        setMediaDecryptError(null);
      } else {
        setDecryptedMediaUrl(null);
        setMediaDecryptError(res.reason === 'missing-key' ? 'missing-key' : 'failed');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [message.fileUrl, message.mediaE2ee, currentUserId, isCurrentUserSender, peerPublicKey, descritorDaMidia?.v]);


  useEffect(() => {
    const URL_REGEX = /^(https?:\/\/[^\s]+)$/;
    const textIsUrl = message.text && URL_REGEX.test(message.text);

    // Only fetch preview if there's no other content (shared post or file)
    if (textIsUrl && !youtubeInfo.videoId && !message.sharedPostId && !message.fileUrl) {
      const fetchLinkPreview = async () => {
        setIsLoadingLinkPreview(true);
        setLinkPreviewPost(null);
        try {
          const res = await fetch(`/api/quote-preview?url=${encodeURIComponent(message.text!)}`);
          if (res.ok) {
            const data = await res.json();
            setLinkPreviewPost(data);
          } else {
            setLinkPreviewPost(null);
          }
        } catch (error) {
          console.error("Failed to fetch link preview:", error);
          setLinkPreviewPost(null);
        } finally {
          setIsLoadingLinkPreview(false);
        }
      };

      fetchLinkPreview();
    } else {
        setLinkPreviewPost(null);
        setIsLoadingLinkPreview(false);
    }
  }, [message.text, youtubeInfo.videoId, message.sharedPostId, message.fileUrl]);

  const handleImageClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsViewerOpen(true);
  };
  
  const handleCopy = () => {
    if (message.text) {
        navigator.clipboard.writeText(message.text);
        toast({ title: 'Texto copiado!' });
    }
  };

  const handleReply = () => {
    onReply(message);
  };

  const handleDeleteConfirm = () => {
    setShowDeleteConfirm(true);
  };
  
  const handleDelete = async () => {
    try {
        if (!message.isP2p) {
          await deleteDirectMessage(message.conversationId, message.id);
        }
        onDeleteMessage(message.id);
        toast({ title: 'Mensagem apagada.' });
    } catch (error: any) {
        toast({ title: 'Erro', description: error.message || 'Não foi possível apagar a mensagem.', variant: 'destructive' });
    } finally {
        setShowDeleteConfirm(false);
    }
  };
  
  const showPlaceholderToast = () => {
    toast({ title: 'Funcionalidade em desenvolvimento.' });
  };
  
  const menuContent = (
    <>
      <DropdownMenuItem onSelect={handleReply}>
          <MessageSquareReply className="mr-2 h-4 w-4" />
          <span>Responder</span>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={handleCopy} disabled={!message.text}>
          <Copy className="mr-2 h-4 w-4" />
          <span>Copiar</span>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={showPlaceholderToast}>
          <Forward className="mr-2 h-4 w-4" />
          <span>Encaminhar</span>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={showPlaceholderToast}>
          <Star className="mr-2 h-4 w-4" />
          <span>Favoritar</span>
      </DropdownMenuItem>
      {isCurrentUserSender && (
          <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={handleDeleteConfirm} className="text-destructive focus:text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" />
                  <span>Apagar</span>
              </DropdownMenuItem>
          </>
      )}
    </>
  );

  const renderFile = () => {
    if (!message.fileUrl) return null;

    // Anexo grande protegido: capa, tamanho e um toque para baixar. Nada vem sozinho.
    if (message.mediaE2ee && descritorDaMidia?.v === 2) {
      return (
        <AnexoProtegidoGrande
          fileUrl={message.fileUrl}
          posterUrl={message.posterUrl}
          descritor={descritorDaMidia.bruto}
        />
      );
    }

    if (message.mediaE2ee) {
      if (mediaDecryptError) {
        return (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300">
            <Lock className="h-4 w-4 shrink-0" />
            <span>
              {mediaDecryptError === 'missing-key'
                ? 'Mídia cifrada ponta a ponta — pareie este aparelho em Configurações → P2P / E2EE.'
                : 'Não foi possível decifrar esta mídia neste aparelho.'}
            </span>
          </div>
        );
      }
      if (!decryptedMediaUrl) {
        return <Skeleton className="mt-2 h-36 w-52 rounded-lg" />;
      }
    }

    const mediaSrc = message.mediaE2ee ? decryptedMediaUrl! : message.fileUrl;

    if (message.fileType === 'image') {
      return (
        <>
          <ImageViewer
            isOpen={isViewerOpen}
            onOpenChange={setIsViewerOpen}
            imageUrl={mediaSrc}
          />
          <div className="mt-2 max-w-[260px] sm:max-w-[300px]" data-interactive="true">
            <div 
              onClick={handleImageClick}
              className="block max-w-full rounded-lg overflow-hidden cursor-pointer group bg-black/20"
            >
                <img
                src={mediaSrc}
                alt="Uploaded image"
                className="w-full max-h-[260px] object-contain rounded-lg transition-transform group-hover:scale-[1.02]"
                />
            </div>
          </div>
        </>
      );
    }

    if (message.fileType === 'audio') {
        return (
            <div className="mt-2" data-interactive="true">
                <audio controls src={mediaSrc} className="w-full max-w-full">
                    Your browser does not support the audio element.
                </audio>
            </div>
        );
    }

    if (message.fileType === 'video') {
         return (
            <div className="mt-2 max-w-[260px] sm:max-w-[300px] overflow-hidden rounded-lg bg-black/90" data-interactive="true">
                <PlatformVideo controls src={mediaSrc} className="w-full max-h-[260px] rounded-lg object-contain" preload="metadata" />
            </div>
        );
    }

    return null;
  };

  // A marca diz o que de fato sabemos, e nada mais.
  //
  // AZUL ("Lida") so quando a marca d'agua do aparelho da OUTRA pessoa cobre esta mensagem (quem preenche `readAt` a
  // partir dela e a tela da conversa; ver src/lib/messages/recibos.ts). Sem hora: a marca guarda o instante em que a
  // pessoa abriu a conversa, nao o em que leu esta linha, e "leu as 15:40" e prova de leitura.
  // A classe `hv-recibo` governa SO a marca azul: desligar a confirmacao esconde a leitura dos outros (e deixa de
  // enviar a sua), mas o ✓ de enviada e o ✓✓ de entregue falam do SEU envio e continuam sempre visiveis.
  const renderReadReceipt = () => {
    if (!isCurrentUserSender) return null;

    if (message.readAt) {
      return (
        <span title="Lida" className="hv-recibo inline-flex">
          <CheckCheck className="h-4 w-4 text-blue-400" />
        </span>
      );
    }
    if (message.isP2p) {
      // Na fila já tem aviso próprio ao lado; repetir aqui seria dizer duas vezes a mesma coisa.
      if (message.p2pStatus === 'queued') return null;
      return (
        <span title="Entregue no aparelho da pessoa" className="inline-flex">
          <CheckCheck className="h-4 w-4 text-muted-foreground/80" />
        </span>
      );
    }
    if (message.createdAt) {
      return (
        <span title="Enviada" className="inline-flex">
          <Check className="h-4 w-4 text-muted-foreground/80" />
        </span>
      );
    }
    return null;
  };
  
  const renderMessageBody = () => {
    if (isLoadingLinkPreview) {
      return (
        <div className="p-2 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      );
    }

    if (message.sharedPostId) {
      return (
        <div className="mt-2">
          {messagesHost.renderSharedPost ? (
            messagesHost.renderSharedPost(message.sharedPostId, locale)
          ) : (
            <Link
              href={messagesHost.getPostHref(message.sharedPostId, locale)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/60 px-3 py-2 text-xs font-medium hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Abrir publicação compartilhada
            </Link>
          )}
        </div>
      );
    }

    if (youtubeInfo.videoId) {
        return (
            <div className="mt-2 min-w-0 space-y-2">
                {youtubeInfo.cleanedText && (
                    <p className="hv-escala min-w-0 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
                        <TextWithMentions
                          text={youtubeInfo.cleanedText}
                          linkClassName={isCurrentUserSender ? 'text-primary-foreground underline font-medium hover:opacity-90' : undefined}
                        />
                    </p>
                )}
                <YoutubeEmbed videoId={youtubeInfo.videoId} title="Vídeo enviado na conversa" />
            </div>
        )
    }

    if (linkPreviewPost?.id) {
      return (
        <div className="mt-2">
          {messagesHost.renderSharedPost ? (
            messagesHost.renderSharedPost(linkPreviewPost.id, locale)
          ) : (
            <Link
              href={messagesHost.getPostHref(linkPreviewPost.id, locale)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/60 px-3 py-2 text-xs font-medium hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Abrir link compartilhado
            </Link>
          )}
        </div>
      );
    }

    if (message.text) {
        return (
            <p className="hv-escala min-w-0 text-sm whitespace-pre-wrap break-words mr-auto [overflow-wrap:anywhere]">
                <TextWithMentions
                  text={message.text}
                  linkClassName={isCurrentUserSender ? 'text-primary-foreground underline font-medium hover:opacity-90' : undefined}
                />
            </p>
        )
    }
    return null;
  }

  return (
    <div id={`message-bubble-${message.id}`}>
        <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Apagar mensagem?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Esta ação não pode ser desfeita. A mensagem será permanentemente apagada.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">Apagar</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>

        <div className={cn("group flex min-w-0 w-fit items-end max-w-[92%] sm:max-w-[80%] gap-2", isCurrentUserSender ? "ml-auto flex-row-reverse" : "mr-auto")}>
            <div className="flex min-w-0 max-w-full items-start gap-2">
                {!isCurrentUserSender && sender && (
                    <Link href={`/${locale}/profile/${sender.id}`} className="shrink-0 self-end mb-1" data-interactive="true" onClick={(e) => e.stopPropagation()}>
                    <Avatar className="h-8 w-8">
                        <AvatarImage src={sender.avatarUrl} alt={sender.name} data-ai-hint={sender["data-ai-hint"] || "person avatar"} />
                        <AvatarFallback>{sender.name.substring(0,1)}</AvatarFallback>
                    </Avatar>
                    </Link>
                )}
                <div 
                    className={cn(
                    "relative min-w-0 max-w-full overflow-hidden px-3 py-2 rounded-lg shadow-md",
                    // No celular o menu "..." fica sempre visível: reserva o canto para ele não deitar sobre o texto.
                    isMobile && "pr-8",
                    isCurrentUserSender ? "bg-primary text-primary-foreground rounded-br-none" : "bg-card text-card-foreground rounded-bl-none border border-border"
                    )}
                >
                    <div className={cn("absolute top-0 right-0 transition-opacity z-10", isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full opacity-40 hover:opacity-100 focus-visible:opacity-100" data-interactive="true" onClick={(e) => e.stopPropagation()}>
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align={isCurrentUserSender ? 'end' : 'start'} onClick={(e) => e.stopPropagation()}>
                                {menuContent}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>

                    {message.parentMessageId && (
                        <a
                            onClick={(e) => {
                              e.stopPropagation();
                              const el = document.getElementById(`message-bubble-${message.parentMessageId}`);
                              if (el) {
                                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                el.classList.add('bg-primary/10', 'rounded-md');
                                setTimeout(() => el.classList.remove('bg-primary/10'), 2000);
                              }
                            }}
                            className={cn("block min-w-0 max-w-full overflow-hidden mb-2 p-2 rounded-md cursor-pointer border-l-2", isCurrentUserSender ? "bg-primary-foreground/20 border-primary-foreground/50 hover:bg-primary-foreground/30" : "bg-muted hover:bg-muted/80 border-primary/50")}
                            data-interactive="true"
                        >
                            <p className="text-xs font-semibold">{message.parentMessageSenderName}</p>
                            <p className="text-xs opacity-80 truncate">{message.parentMessageText}</p>
                        </a>
                    )}
                    {renderFile()}
                    <div className={cn("flex min-w-0 max-w-full flex-wrap items-end justify-end gap-x-2", message.fileUrl ? 'mt-2' : '')}>
                        {renderMessageBody() || <div className="flex-grow"></div>}
                        <div className="flex items-center space-x-1 self-end flex-shrink-0">
                            {/* O caminho da mensagem é sinal, não cartaz: só "Na fila" ganha palavra, porque é o único estado
                                em que a pessoa precisa agir (ou esperar). O resto vive no title, para quem quiser saber. */}
                            {message.isP2p ? (
                              message.p2pStatus === 'queued' ? (
                                <span
                                  title="Esperando o contato conectar para ser entregue direto (Zero DB)"
                                  className={cn(
                                    "inline-flex",
                                    isCurrentUserSender ? "text-amber-100" : "text-amber-500"
                                  )}
                                >
                                  <Clock className="h-2.5 w-2.5" />
                                  <span className="sr-only">Esperando entrega</span>
                                </span>
                              ) : (
                                <span
                                  title="Entregue direto dispositivo a dispositivo (Zero DB)"
                                  className={cn("inline-flex", isCurrentUserSender ? "text-primary-foreground/80" : "text-emerald-500")}
                                >
                                  <Zap className="h-2.5 w-2.5" />
                                  <span className="sr-only">Entregue direto, sem passar pelo servidor</span>
                                </span>
                              )
                            ) : (
                              <span
                                title="Mensagem armazenada no banco de dados"
                                className={cn("inline-flex", isCurrentUserSender ? "text-primary-foreground/55" : "text-muted-foreground/60")}
                              >
                                <Cloud className="h-2.5 w-2.5" />
                                <span className="sr-only">Guardada no servidor</span>
                              </span>
                            )}
                            {message.e2ee && (
                              <span title="Criptografada de ponta a ponta" className={cn(isCurrentUserSender ? "text-primary-foreground/70" : "text-muted-foreground/70")}>
                                <Lock className="h-2.5 w-2.5" />
                              </span>
                            )}
                            <p className={cn("text-[10px]", isCurrentUserSender ? "text-primary-foreground/70" : "text-muted-foreground/70")}>
                                {format(new Date(message.createdAt), "p", { locale: localeDatas })}
                            </p>
                            {renderReadReceipt()}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
  );
}
