// src/components/messages/MessageBubble.tsx
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import type { DirectMessage, Post } from '@/lib/types';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import Link from 'next/link';
import Image from 'next/image';
import TextWithMentions from '@/components/shared/TextWithMentions';
import ImageViewer from '@/components/shared/ImageViewer';
import { Check, CheckCheck, Loader2, Lock, MoreHorizontal, MessageSquareReply, Copy, Forward, Star, Trash2 } from 'lucide-react';
import { getPostById } from '@/lib/services/postReadService';
import EmbeddedPostCard from '@/components/feed/EmbeddedPostCard';
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

interface MessageBubbleProps {
  message: DirectMessage;
  isCurrentUserSender: boolean;
  onDeleteMessage: (messageId: string) => void;
  onReply: (message: DirectMessage) => void;
}

export default function MessageBubble({ message, isCurrentUserSender, onDeleteMessage, onReply }: MessageBubbleProps) {
  const sender = message.sender;
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [sharedPost, setSharedPost] = useState<Post | null | undefined>(message.sharedPost);
  const [isLoadingPost, setIsLoadingPost] = useState(false);
  const locale = useLocale();

  const [linkPreviewPost, setLinkPreviewPost] = useState<Post | null>(null);
  const [isLoadingLinkPreview, setIsLoadingLinkPreview] = useState(false);
  
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const youtubeInfo = useMemo(() => extractYoutubeVideoInfo(message.text || ''), [message.text]);


  useEffect(() => {
    const fetchSharedPost = async () => {
      if (message.sharedPostId && !sharedPost) {
        setIsLoadingPost(true);
        try {
          const post = await getPostById(message.sharedPostId);
          setSharedPost(post);
        } catch (error) {
          console.error("Failed to fetch shared post:", error);
          setSharedPost(null);
        } finally {
          setIsLoadingPost(false);
        }
      }
    };
    fetchSharedPost();
  }, [message.sharedPostId, sharedPost]);

  useEffect(() => {
    const URL_REGEX = /^(https?:\/\/[^\s]+)$/;
    const textIsUrl = message.text && URL_REGEX.test(message.text);

    // Only fetch preview if there's no other content (shared post or file)
    if (textIsUrl && !youtubeInfo.videoId && !sharedPost && !message.fileUrl) {
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
  }, [message.text, youtubeInfo.videoId, sharedPost, message.fileUrl]);

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
    if (message.fileUrl && message.fileType === 'image') {
      return (
        <>
          <ImageViewer
            isOpen={isViewerOpen}
            onOpenChange={setIsViewerOpen}
            imageUrl={message.fileUrl}
          />
          <div className="mt-2" data-interactive="true">
            <div 
              onClick={handleImageClick}
              className="block max-w-full rounded-lg overflow-hidden cursor-pointer group"
            >
                <img
                src={message.fileUrl}
                alt="Uploaded image"
                className="w-full h-auto transition-transform group-hover:scale-105"
                />
            </div>
          </div>
        </>
      );
    }

    if (message.fileUrl && message.fileType === 'audio') {
        return (
            <div className="mt-2" data-interactive="true">
                <audio controls src={message.fileUrl} className="w-full max-w-full">
                    Your browser does not support the audio element.
                </audio>
            </div>
        );
    }

    if (message.fileUrl && message.fileType === 'video') {
         return (
            <div className="mt-2 max-w-[260px] sm:max-w-[300px] overflow-hidden rounded-lg bg-black/90" data-interactive="true">
                <PlatformVideo controls src={message.fileUrl} className="w-full max-h-[260px] rounded-lg object-contain" preload="metadata" />
            </div>
        );
    }

    return null;
  };

  const renderReadReceipt = () => {
    if (!isCurrentUserSender) return null;

    if (message.readAt) {
      return <CheckCheck className="h-4 w-4 text-blue-400" title={`Read at ${format(new Date(message.readAt), 'p')}`} />;
    }
    if (message.createdAt) { // Assuming createdAt means delivered
      return <Check className="h-4 w-4 text-muted-foreground/80" title="Delivered" />;
    }
    return null;
  };
  
  const renderMessageBody = () => {
    if (isLoadingPost || isLoadingLinkPreview) {
        return (
            <div className="p-2 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
            </div>
        )
    }

    if (sharedPost) {
        return (
            <div className="mt-2">
                <EmbeddedPostCard post={sharedPost} />
            </div>
        )
    }
    
    if (youtubeInfo.videoId) {
        return (
            <div className="mt-2 min-w-0 space-y-2">
                {youtubeInfo.cleanedText && (
                    <p className="min-w-0 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
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

    if (linkPreviewPost) {
        return (
            <div className="mt-2">
                <EmbeddedPostCard post={linkPreviewPost} />
            </div>
        )
    }

    if (message.text) {
        return (
            <p className="min-w-0 text-sm whitespace-pre-wrap break-words mr-auto [overflow-wrap:anywhere]">
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
                    isCurrentUserSender ? "bg-primary text-primary-foreground rounded-br-none" : "bg-card text-card-foreground rounded-bl-none border border-border"
                    )}
                >
                    <div className={cn("absolute top-0 right-0 transition-opacity z-10", isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" data-interactive="true" onClick={(e) => e.stopPropagation()}>
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
                            {message.isP2p ? (
                              <span
                                title={
                                  message.p2pStatus === 'queued'
                                    ? 'Na fila P2P: será entregue automaticamente quando o contato conectar (Zero DB)'
                                    : 'Entregue direto dispositivo a dispositivo (Zero DB)'
                                }
                                className={cn(
                                  "rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                                  message.p2pStatus === 'queued'
                                    ? (isCurrentUserSender ? "bg-amber-400/20 text-amber-100" : "bg-amber-500/15 text-amber-400")
                                    : (isCurrentUserSender ? "bg-white/15 text-primary-foreground/90" : "bg-emerald-500/15 text-emerald-400")
                                )}
                              >
                                {message.p2pStatus === 'queued' ? 'P2P · Na fila' : 'P2P'}
                              </span>
                            ) : (
                              <span
                                title="Mensagem armazenada no banco de dados"
                                className={cn(
                                  "rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide",
                                  isCurrentUserSender ? "bg-white/10 text-primary-foreground/70" : "bg-muted-foreground/15 text-muted-foreground/80"
                                )}
                              >
                                DB
                              </span>
                            )}
                            {message.e2ee && (
                              <span title="Criptografada de ponta a ponta" className={cn(isCurrentUserSender ? "text-primary-foreground/70" : "text-muted-foreground/70")}>
                                <Lock className="h-2.5 w-2.5" />
                              </span>
                            )}
                            <p className={cn("text-[10px]", isCurrentUserSender ? "text-primary-foreground/70" : "text-muted-foreground/70")}>
                                {format(new Date(message.createdAt), "p")}
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
