// src/app/messages/user/[otherUserId]/page.tsx
'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { navigateBack } from '@/lib/backNavigation';
import Link from 'next/link';
import { getCurrentUserId } from '@/lib/services/authService';
import { getOrCreateConversation, sendDirectMessage, declineOrLeaveConversation, conversationsCollection, markConversationAsRead, deleteDirectMessage } from '@/lib/services/conversationService';
import { getUser as serverGetUser } from '@/lib/services/userService';
import { collection, query, orderBy, onSnapshot, Timestamp, where } from 'firebase/firestore'; 
import type { Conversation, DirectMessage, User } from '@/lib/types';
import MessageBubble from '@/components/messages/MessageBubble';
import MessageInputArea from '@/components/messages/MessageInputArea';
import P2pNoticeBanner from '@/components/messages/P2pNoticeBanner';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ArrowLeft, AlertCircle, MessageSquareOff, LogIn, MoreVertical, LogOut, Loader2, Lock, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { encryptDirectMessage, decryptDirectMessage, getE2eeStatus, type IdentityStatus } from '@/lib/crypto/e2ee';
import {
  createP2pSession,
  deleteLocalP2pMessage,
  loadHydratedP2pMessages,
  loadP2pHistoryFromOwnDevices,
  watchOwnDevicesP2pHistory,
  type LocalP2pMessage,
  type P2pConnectionState,
  type P2pFailureReason,
  type P2pSessionController,
} from '@/lib/p2p/p2pChannel';
import { getP2pPreferences } from '@/lib/p2p/p2pPreferences';
import { describeP2pState, shouldAutoConnect } from '@/lib/p2p/p2pProtocol';
import { UserFacingSendError } from '@/lib/services/userFacingError';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { cn } from '@/lib/utils';
import { useLocale } from 'next-intl';

function ConversationPageSkeleton() {
 return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex items-center p-4 border-b border-border">
        <Skeleton className="h-10 w-10 rounded-full mr-3" />
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="flex-1 p-4 space-y-4 overflow-y-auto">
        {[...Array(5)].map((_, i) => (
          <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
            <Skeleton className={`h-10 w-48 rounded-lg ${i % 2 === 0 ? 'mr-auto' : 'ml-auto'}`} />
          </div>
        ))}
      </div>
      <div className="p-4 border-t">
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
    </div>
  );
}

function ConversationPageContent() {
  const [clientHasMounted, setClientHasMounted] = useState(false);
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, refreshCurrentUser } = useCurrentUser();
  const currentUserId = currentUser?.id;
  const locale = useLocale();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [otherUser, setOtherUser] = useState<User | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [p2pMessages, setP2pMessages] = useState<LocalP2pMessage[]>([]);
  const [p2pState, setP2pState] = useState<P2pConnectionState>('offline');
  const [p2pReason, setP2pReason] = useState<P2pFailureReason | null>(null);
  const [e2eeStatus, setE2eeStatus] = useState<IdentityStatus | null>(null);
  const [zeroDbOnly, setZeroDbOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [replyingTo, setReplyingTo] = useState<DirectMessage | null>(null);

  const p2pSessionRef = useRef<P2pSessionController | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottom = useRef(true);

  const mergedMessages = useMemo(() => {
    if (p2pMessages.length === 0) return messages;
    return [...messages, ...p2pMessages].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [messages, p2pMessages]);

  const scrollToBottom = useCallback((behavior: 'smooth' | 'auto' = 'auto') => {
    const scrollEl = scrollContainerRef.current;
    if (scrollEl) {
      scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior });
    }
  }, []);

  const handleScroll = useCallback(() => {
    const scrollEl = scrollContainerRef.current;
    if (scrollEl) {
      const isNearBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 150;
      shouldStickToBottom.current = isNearBottom;
    }
  }, []);

  useEffect(() => {
    const scrollEl = scrollContainerRef.current;
    if (scrollEl) {
      scrollEl.addEventListener('scroll', handleScroll, { passive: true });
      return () => scrollEl.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  // Observer for content size changes
  useEffect(() => {
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) return;

    const resizeObserver = new ResizeObserver(() => {
      if (shouldStickToBottom.current) {
        scrollToBottom('auto');
      }
    });

    resizeObserver.observe(scrollEl);
    return () => resizeObserver.disconnect();
  }, [scrollToBottom]);

  // Initial scroll and new message scroll
  useEffect(() => {
    if (messages.length > 0) {
      // For initial load or when a new message is added by the current user
      if (shouldStickToBottom.current) {
        scrollToBottom('auto');
      }
    }
  }, [messages, scrollToBottom]);

  useEffect(() => {
    setClientHasMounted(true);
  }, []);

  
  useEffect(() => {
    const otherUserId = params?.otherUserId as string;

    if (!clientHasMounted || !currentUserId || !otherUserId) {
        if (clientHasMounted && !currentUserId) {
            setError("Faça login para ver ou enviar mensagens.");
            setIsLoading(false);
        }
        return;
    }
    
    const isSelfChat = otherUserId === currentUserId;

    setIsLoading(true);
    let unsubscribe: (() => void) | null = null;

    const initialize = async () => {
        try {
            void getE2eeStatus(currentUserId).catch(() => {});
            const fetchedOtherUser = await serverGetUser(otherUserId, currentUserId, { fresh: true });
            if (!fetchedOtherUser) {
                setError("O usuário que você está tentando contatar não existe.");
                setIsLoading(false);
                return;
            }
            setOtherUser(fetchedOtherUser);

            const conv = await getOrCreateConversation(currentUserId, otherUserId);
            if (!conv) {
                setError(`Você não tem permissão para enviar mensagens para @${fetchedOtherUser.username}.`);
                setIsLoading(false);
                return;
            }
            setConversation(conv);
            
            // Mark conversation as read
            if (conv.unreadCounts?.[currentUserId] > 0) {
              await markConversationAsRead(conv.id, currentUserId);
              await refreshCurrentUser(); // Refresh context to update global unread count
            }

            const messagesRef = collection(conversationsCollection, conv.id, 'messages');
            let q = query(messagesRef, orderBy('createdAt', 'asc'));
            
            // Filter messages based on when the user left
            const userLeftTimestamp = conv.userLeftAt?.[currentUserId];
            if (userLeftTimestamp) {
                q = query(q, where('createdAt', '>', userLeftTimestamp));
            }

            unsubscribe = onSnapshot(q, async (querySnapshot) => {
                const fetchedMessages: DirectMessage[] = [];
                const senderPromises = new Map<string, Promise<User | null | undefined>>();

                for (const doc of querySnapshot.docs) {
                    const data = doc.data({ serverTimestamps: 'estimate' }) as Omit<DirectMessage, 'id' | 'sender' | 'createdAt'> & { createdAt: Timestamp, senderId: string, readAt?: Timestamp };
                    
                    if (!senderPromises.has(data.senderId)) {
                        senderPromises.set(data.senderId, serverGetUser(data.senderId));
                    }
                    const sender = await senderPromises.get(data.senderId);

                    if(sender) {
                        let resolvedText = data.text || '';
                        if (data.e2ee) {
                            const decrypted = await decryptDirectMessage(
                                data.e2ee,
                                currentUserId,
                                data.senderId === currentUserId,
                                isSelfChat ? undefined : fetchedOtherUser.e2eePublicKey,
                            );
                            resolvedText = decrypted.ok
                                ? decrypted.text
                                : decrypted.reason === 'missing-key' || decrypted.reason === 'key-not-in-keyring'
                                    ? '🔒 Mensagem criptografada. A chave para abri-la não está neste aparelho: restaure seu backup em Configurações > P2P e E2EE.'
                                    : '🔒 Mensagem criptografada que não pôde ser aberta (conteúdo inválido ou alterado).';
                        }
                        fetchedMessages.push({
                            ...data,
                            text: resolvedText,
                            id: doc.id,
                            // O documento da mensagem não guarda o id da conversa (ele está no caminho). Sem isto, apagar a mensagem estourava
                            // "Cannot read properties of undefined (reading 'indexOf')" ao montar a referência do Firestore.
                            conversationId: conv.id,
                            sender: sender,
                            createdAt: (data.createdAt ? data.createdAt.toDate() : new Date()).toISOString(),
                            readAt: data.readAt ? data.readAt.toDate().toISOString() : null,
                        });
                    }
                }
                setMessages(fetchedMessages);
                setIsLoading(false);
            }, (err) => {
                console.error("Error on message listener:", err);
                setError("Ocorreu um erro ao escutar por novas mensagens.");
                setIsLoading(false);
            });

        } catch (e: any) {
            console.error("Failed to load conversation:", e);
            setError(e.message || "Ocorreu um erro inesperado.");
            setIsLoading(false);
        }
    };
    
    initialize();

    return () => {
        if (unsubscribe) {
            unsubscribe();
        }
    };
  }, [clientHasMounted, params, currentUserId, router, toast, refreshCurrentUser]);

  // A identidade E2EE desta conta NESTE aparelho: se a conta tem uma chave que este aparelho não possui, avisa (e bloqueia o
  // envio cifrado) em vez de gerar outra e tirar a chave de quem já a tem.
  useEffect(() => {
    if (!currentUserId) return;
    let cancelled = false;
    void getE2eeStatus(currentUserId).then((st) => { if (!cancelled) setE2eeStatus(st); }).catch(() => {});
    return () => { cancelled = true; };
  }, [currentUserId]);

  // Sessão P2P dispositivo-a-dispositivo (WebRTC DataChannel + E2EE, Zero DB).
  // As dependências são os IDENTIFICADORES, não os objetos: o contexto recria `currentUser` a cada atualização do perfil, e
  // uma dependência de objeto derrubava e refazia a conexão (e a sinalização) sem motivo.
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  const otherUserRef = useRef(otherUser);
  otherUserRef.current = otherUser;
  const conversationId = conversation?.id ?? null;
  const otherId = otherUser?.id ?? null;
  const otherKey = otherUser?.e2eePublicKey ?? null;
  const isMutualContact = Boolean(otherUser?.isFollowing && otherUser?.isFollowedBy);
  useEffect(() => {
    const me = currentUserRef.current;
    const other = otherUserRef.current;
    if (!conversationId || !other || !me || !currentUserId) return;
    if (other.id === currentUserId || other.id.startsWith('ap_')) {
      setP2pState('offline');
      return;
    }

    const prefs = getP2pPreferences(currentUserId);
    setZeroDbOnly(prefs.defaultZeroDbOnly);
    let cancelled = false;
    void loadHydratedP2pMessages({ currentUser: me, otherUser: other, conversationId }).then((msgs) => {
      if (!cancelled) setP2pMessages(msgs);
    });
    void loadP2pHistoryFromOwnDevices(currentUserId, conversationId, me, other).then((recovered) => {
      if (!cancelled && recovered.length > 0) setP2pMessages(recovered);
    });
    const stopOwnDeviceSync = watchOwnDevicesP2pHistory(currentUserId, conversationId, me, other, (synced) => {
      if (!cancelled && synced.length > 0) setP2pMessages(synced);
    });
    // O túnel mostra o seu endereço de rede ao contato: por padrão só conecta sozinho com contato MÚTUO.
    const conectar = shouldAutoConnect({
      autoConnectP2p: prefs.autoConnectP2p,
      zeroDbOnly: prefs.defaultZeroDbOnly,
      scope: prefs.autoConnectScope,
      isMutual: isMutualContact,
    });
    if (!conectar) {
      setP2pState('offline');
      return () => {
        cancelled = true;
        stopOwnDeviceSync();
      };
    }
    const controller = createP2pSession({
      conversationId,
      currentUserId,
      otherUser: other,
      currentUser: me,
      relayOnly: prefs.relayOnly,
      onStateChange: setP2pState,
      onStateDetail: (_state, reason) => setP2pReason(reason),
      onMessage: (incoming) => {
        shouldStickToBottom.current = true;
        setP2pMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
      },
      onMessageUpdated: (updated) => {
        setP2pMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      },
    });
    p2pSessionRef.current = controller;

    return () => {
      cancelled = true;
      stopOwnDeviceSync();
      controller.destroy();
      p2pSessionRef.current = null;
      setP2pState('offline');
      setP2pReason(null);
    };
  }, [conversationId, otherId, otherKey, currentUserId, isMutualContact]);

  const handleDeleteMessage = (messageIdToDelete: string) => {
    if (messageIdToDelete.startsWith('p2p_') && currentUserId && conversation) {
      deleteLocalP2pMessage(currentUserId, conversation.id, messageIdToDelete);
      setP2pMessages((prev) => prev.filter((msg) => msg.id !== messageIdToDelete));
      return;
    }
    setMessages(currentMessages =>
        currentMessages.filter(msg => msg.id !== messageIdToDelete)
    );
  };
  
  const handleReply = (message: DirectMessage) => {
    setReplyingTo(message);
    const inputEl = document.getElementById('message-input-area');
    if (inputEl) inputEl.focus();
  };
  
  const handleCancelReply = () => {
    setReplyingTo(null);
  };

  const handleSendMessage = async (data: { text?: string; fileUrl?: string; fileType?: DirectMessage['fileType'] }) => {
    if (!conversation || !currentUserId) {
       toast({ title: "Login obrigatório", description: "Faça login para enviar mensagens.", variant: "destructive" });
       router.push(`/${locale}/login`);
      return;
    }
    
    const isSelfChat = otherUser?.id === currentUserId;

    // Envio direto P2P (Zero DB) quando conectado OU enfileiramento cronológico quando Zero DB está ativo
    if (!isSelfChat && !data.fileUrl && data.text?.trim() && p2pSessionRef.current && (p2pState === 'connected' || zeroDbOnly)) {
      shouldStickToBottom.current = true;
      const sentP2p = await p2pSessionRef.current.sendText(
        data.text,
        replyingTo
          ? {
              parentMessageId: replyingTo.id,
              parentMessageText: replyingTo.e2ee
                ? '🔒 Mensagem criptografada'
                : (replyingTo.text || (replyingTo.fileUrl ? 'Media attachment' : 'Shared post')),
              parentMessageSenderName: replyingTo.sender?.name || 'Usuário',
            }
          : undefined,
      );
      if (sentP2p) {
        setP2pMessages((prev) => (prev.some((m) => m.id === sentP2p.id) ? prev : [...prev, sentP2p]));
        setReplyingTo(null);
        if (sentP2p.p2pStatus === 'queued') {
          toast({
            title: 'Mensagem P2P na fila',
            description: `Será entregue direto para @${otherUser?.username || 'contato'} assim que o dispositivo conectar.`,
          });
        }
        return;
      }
    }

    if (zeroDbOnly && !isSelfChat && !data.fileUrl) {
      // Lança (em vez de só avisar e voltar): o campo de mensagem devolve o texto digitado. Antes ele já tinha sido apagado, e a
      // mensagem se perdia sem aviso de que nada tinha saído.
      const info = describeP2pState(p2pState, p2pReason);
      throw new UserFacingSendError(
        `Modo Zero DB ativo: nada é gravado no servidor, então o contato precisa estar conectado por P2P. ${info.label}: ${info.detail} Desligue o modo Zero DB para enviar pelo caminho normal (com E2EE).`,
      );
    }

    // E2EE: se a conversa É cifrada (o contato publicou chave, ou é "Mensagens Salvas"), a mensagem vai cifrada ou NÃO VAI.
    // Antes, qualquer falha ao cifrar seguia em texto claro, em silêncio, com o selo de criptografia na tela.
    let encryptedPayload = null;
    if (data.text?.trim() && otherUser && !otherUser.id.startsWith('ap_') && (isSelfChat || otherUser.e2eePublicKey)) {
      const identidade = await getE2eeStatus(currentUserId);
      if (identidade.status === 'needs-restore') {
        throw new UserFacingSendError('Este aparelho não tem a chave de criptografia (E2EE) da sua conta. Restaure o backup em Configurações > P2P e E2EE antes de enviar mensagens cifradas.');
      }
      if (identidade.status === 'storage-unavailable') {
        throw new UserFacingSendError('O navegador não está deixando guardar a chave de criptografia (modo privado ou armazenamento bloqueado). A mensagem não foi enviada.');
      }
      if (identidade.status === 'ready') {
        const destinatario = isSelfChat ? identidade.publicKeyJson : otherUser.e2eePublicKey;
        encryptedPayload = await encryptDirectMessage(data.text, currentUserId, destinatario);
        if (!encryptedPayload) throw new UserFacingSendError('Não foi possível criptografar a mensagem, então ela não foi enviada.');
      }
      // 'unsupported' (navegador sem WebCrypto): segue sem E2EE, e a tela não mostra o selo.
    }

    const messagePayload = {
      ...data,
      ...(encryptedPayload ? { e2ee: encryptedPayload } : {}),
      ...(replyingTo && {
        parentMessageId: replyingTo.id,
        parentMessageText: replyingTo.e2ee
          ? '🔒 Mensagem criptografada'
          : (replyingTo.text || (replyingTo.fileUrl ? 'Media attachment' : 'Shared post')),
        parentMessageSenderName: replyingTo.sender?.name || 'Usuário'
      })
    };

    try {
      shouldStickToBottom.current = true;
      const newMessage = await sendDirectMessage(conversation.id, currentUserId, messagePayload);
      if (!newMessage) {
        toast({ title: "Erro ao enviar mensagem", description: "Não foi possível enviar sua mensagem. Verifique suas permissões ou rede e tente novamente.", variant: "destructive" });
      } else {
        setReplyingTo(null); // Clear reply state on success
      }
    } catch (e: any) {
       console.error("Error in handleSendMessage:", e);
       const errorMessage = (e instanceof Error) ? e.message : "Ocorreu um erro inesperado.";
       toast({ title: "Erro ao enviar mensagem", description: errorMessage, variant: "destructive" });
    }
  };
  
  const handleFileUpload = async (file: File) => {
    if (!currentUserId) {
      toast({ title: "Login obrigatório", description: "Você deve estar logado para enviar arquivos.", variant: "destructive" });
      throw new Error("Usuário não logado");
    }
    const { uploadFileToStorage, directMessageMediaPathFactory, isLikelyVideoFile } = await import('@/lib/services/mediaUploadService');
    const result = await uploadFileToStorage(currentUserId, file, directMessageMediaPathFactory);
    const fileType: DirectMessage['fileType'] = file.type.startsWith('image/') ? 'image'
                   : isLikelyVideoFile(file) ? 'video'
                   : file.type.startsWith('audio/') ? 'audio'
                   : 'file';
    return { url: result.downloadURL, type: fileType };
  };

  const handleLeaveConversation = async () => {
    if (!conversation || !currentUserId) return;
    setIsLeaving(true);
    try {
      await declineOrLeaveConversation(conversation.id, currentUserId);
      toast({ title: "Sucesso", description: "Você saiu da conversa." });
      router.replace(`/${locale}/messages`);
    } catch (e: any) {
      toast({ title: "Erro", description: e.message || "Falha ao sair da conversa.", variant: "destructive" });
      setIsLeaving(false);
    }
  };

  if (!clientHasMounted || (isLoading && !error)) {
    return <ConversationPageSkeleton />;
  }

  if (error) {
    return (
      <div className="container mx-auto max-w-2xl py-8 text-center">
         <Card className="shadow-lg">
            <CardHeader>
                 <Button variant="ghost" size="sm" onClick={() => navigateBack(router, { fallbackUrl: `/${locale}/messages` })} className="absolute left-4 top-4">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
                </Button>
                <div className="flex flex-col items-center pt-8">
                    <AlertCircle className="h-12 w-12 text-destructive mb-4" />
                    <CardTitle>Erro</CardTitle>
                </div>
            </CardHeader>
            <CardContent>
                <p className="text-destructive">{error}</p>
                {error.includes("login") || error.includes("Login") ? (
                     <Button onClick={() => router.push(`/${locale}/login`)} className="mt-6">
                        <LogIn className="mr-2 h-4 w-4" /> Login
                    </Button>
                ) : (
                    <Button onClick={() => router.push(`/${locale}/messages`)} className="mt-6">Ir para Mensagens</Button>
                )}
            </CardContent>
        </Card>
      </div>
    );
  }

  if (!conversation || !otherUser) { 
    return (
      <div className="container mx-auto max-w-2xl py-8 text-center">
        <Card className="shadow-lg">
            <CardHeader>
                <Button variant="ghost" size="sm" onClick={() => navigateBack(router, { fallbackUrl: `/${locale}/messages` })} className="absolute left-4 top-4">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
                </Button>
                <div className="flex flex-col items-center pt-8">
                    <MessageSquareOff className="h-12 w-12 text-muted-foreground mb-4" />
                    <CardTitle>Conversa indisponível</CardTitle>
                </div>
            </CardHeader>
            <CardContent>
                <p className="text-muted-foreground">Não foi possível carregar esta conversa. O usuário pode não existir ou você pode não ter permissão para contatá-lo.</p>
                <Button onClick={() => router.push(`/${locale}/messages`)} className="mt-6">Ir para Mensagens</Button>
            </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <AlertDialog open={showLeaveConfirm} onOpenChange={setShowLeaveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Você tem certeza?</AlertDialogTitle>
            <AlertDialogDescription>
              Você não poderá mais ver o histórico desta conversa. Você pode iniciar uma nova conversa com este usuário mais tarde.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLeaving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleLeaveConversation} disabled={isLeaving}>
              {isLeaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Sair
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-background">
        <header className="flex min-w-0 items-center p-3 sm:p-4 border-b border-border sticky top-0 bg-background z-10">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/${locale}/messages`)} className="mr-2 min-[800px]:hidden">
            <ArrowLeft className="h-5 w-5" />
            <span className="sr-only">Voltar para Mensagens</span>
          </Button>
          <Link href={`/${locale}/profile/${otherUser.id}`} className="group flex min-w-0 flex-1 items-center space-x-3">
              <Avatar className="h-9 w-9 sm:h-10 sm:w-10">
                <AvatarImage src={otherUser.avatarUrl} alt={otherUser.name} data-ai-hint={otherUser["data-ai-hint"] || "person avatar"}/>
                <AvatarFallback>{otherUser.name.substring(0,1)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm sm:text-base font-semibold text-foreground group-hover:underline">
                      {otherUser.id === currentUserId ? 'Mensagens Salvas' : otherUser.name}
                    </p>
                    {!otherUser.id.startsWith('ap_') && otherUser.id !== currentUserId && p2pState === 'connected' ? (
                      <span
                        title="Conexão direta dispositivo-a-dispositivo ativa (Zero DB)"
                        className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-500 shrink-0"
                      >
                        <Wifi className="h-2.5 w-2.5" />
                        P2P · Zero DB
                      </span>
                    ) : !otherUser.id.startsWith('ap_') && otherUser.id !== currentUserId && p2pState === 'connecting' ? (
                      <span
                        title="Estabelecendo conexão direta P2P..."
                        className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-500 shrink-0"
                      >
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        P2P...
                      </span>
                    ) : !otherUser.id.startsWith('ap_') && (otherUser.e2eePublicKey || otherUser.id === currentUserId) ? (
                      <span
                        title="Criptografia de ponta a ponta ativa (ECDH P-256 + AES-GCM)"
                        className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-500 shrink-0"
                      >
                        <Lock className="h-2.5 w-2.5" />
                        E2EE
                      </span>
                    ) : null}
                    {!otherUser.id.startsWith('ap_') && otherUser.id !== currentUserId && p2pState === 'failed' && (
                      <span
                        title={describeP2pState(p2pState, p2pReason).detail}
                        className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500 shrink-0"
                      >
                        <WifiOff className="h-2.5 w-2.5" />
                        {describeP2pState(p2pState, p2pReason).label}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {otherUser.id === currentUserId ? 'Suas anotações privadas' : `@${otherUser.username}`}
                  </p>
              </div>
          </Link>
          {!otherUser.id.startsWith('ap_') && otherUser.id !== currentUserId && (
            <Button
              type="button"
              variant={zeroDbOnly ? 'default' : 'outline'}
              size="sm"
              onClick={() => setZeroDbOnly((v) => !v)}
              title={zeroDbOnly ? 'Somente P2P (Zero DB): nunca grava mensagens no banco' : 'Ativar modo estrito Zero DB (somente P2P)'}
              className={cn(
                'mr-1 h-7 rounded-full px-2.5 text-[11px] font-medium shrink-0',
                zeroDbOnly && 'bg-emerald-600 hover:bg-emerald-500 text-white'
              )}
            >
              {zeroDbOnly ? <Wifi className="mr-1 h-3 w-3" /> : <WifiOff className="mr-1 h-3 w-3" />}
              <span className="hidden sm:inline">Zero DB</span>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreVertical className="h-5 w-5" />
                <span className="sr-only">Opções da conversa</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {!otherUser.id.startsWith('ap_') && otherUser.id !== currentUserId && (
                <DropdownMenuItem onSelect={() => p2pSessionRef.current?.reconnect()}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  <span>Reconectar P2P</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setShowLeaveConfirm(true)} className="text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                <span>Sair da conversa</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <div ref={scrollContainerRef} className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
          <div className="min-w-0 max-w-full p-3 sm:p-4 space-y-4">
            {e2eeStatus?.status === 'needs-restore' && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs space-y-1.5" role="status">
                <p className="font-medium text-amber-600 dark:text-amber-400">Este aparelho não tem a chave E2EE da sua conta</p>
                <p className="text-muted-foreground">
                  Sua conta já tem uma chave de criptografia criada em outro aparelho. Para ler e enviar mensagens cifradas aqui, restaure o backup das chaves.
                  Enquanto isso, as mensagens cifradas não abrem e o envio cifrado fica bloqueado (nada é enviado em texto claro).
                </p>
                <Link href={`/${locale}/settings/p2p`} className="inline-block underline text-primary">
                  Restaurar o backup em Configurações
                </Link>
              </div>
            )}
            {currentUserId && !otherUser.id.startsWith('ap_') && otherUser.id !== currentUserId && (
              <P2pNoticeBanner
                userId={currentUserId}
                compact
                onDefaultEnabled={() => setZeroDbOnly(true)}
              />
            )}
            {mergedMessages.map((msg) => (
              <MessageBubble 
                key={msg.id} 
                message={msg} 
                isCurrentUserSender={currentUserId ? msg.senderId === currentUserId : false}
                onDeleteMessage={handleDeleteMessage}
                onReply={handleReply}
              />
            ))}
             {mergedMessages.length === 0 && !isLoading && (
                <p className="text-center text-muted-foreground py-10">
                    Nenhuma mensagem ainda. Inicie a conversa!
                </p>
            )}
          </div>
        </div>

        <MessageInputArea 
            onSendMessage={handleSendMessage} 
            onFileUpload={handleFileUpload}
            disabled={!currentUserId}
            replyingTo={replyingTo}
            onCancelReply={handleCancelReply}
        />
      </div>
    </>
  );
}


export default function ConversationPage() {
  return (
    <Suspense fallback={<ConversationPageSkeleton />}>
      <ConversationPageContent />
    </Suspense>
  )
}
