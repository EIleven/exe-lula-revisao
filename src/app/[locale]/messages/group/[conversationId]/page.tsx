// src/app/[locale]/messages/group/[conversationId]/page.tsx
'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  getConversationById,
  sendDirectMessage,
  declineOrLeaveConversation,
  markConversationAsRead,
  deleteDirectMessage,
} from '@/lib/services/conversationService';
import { getUser as serverGetUser } from '@/lib/services/userService';
import { collection, doc, query, orderBy, onSnapshot, Timestamp } from 'firebase/firestore';
import type { Conversation, DirectMessage, User } from '@/lib/types';
import MessageBubble from '@/components/messages/MessageBubble';
import MessageInputArea from '@/components/messages/MessageInputArea';
import P2pNoticeBanner from '@/components/messages/P2pNoticeBanner';
import { GroupManagementDialog } from '@/components/messages/GroupManagementDialog';
import { navigateBack } from '@/lib/backNavigation';
import { getP2pPreferences } from '@/lib/p2p/p2pPreferences';
import type { LocalP2pMessage } from '@/lib/p2p/p2pChannel';
import {
  createP2pGroupSession,
  deleteGroupLocalP2pMessage,
  loadGroupP2pHistory,
  type P2pGroupSessionController,
} from '@/lib/p2p/p2pGroupChannel';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  ArrowLeft,
  AlertCircle,
  MessageSquareOff,
  LogIn,
  MoreVertical,
  LogOut,
  Loader2,
  Users,
  Shield,
  UserPlus,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { useLocale } from 'next-intl';
import { db } from '@/lib/firebase';

function GroupConversationSkeleton() {
  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex items-center p-4 border-b border-border">
        <Skeleton className="h-10 w-10 rounded-full mr-3" />
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="flex-1 p-4 space-y-4 overflow-y-auto">
        {[...Array(5)].map((_, i) => (
          <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
            <Skeleton className={`h-10 w-48 rounded-lg ${i % 2 === 0 ? 'mr-auto' : 'ml-auto'}`} />
          </div>
        ))}
      </div>
      <div className="p-4 border-t border-border">
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
    </div>
  );
}

function GroupConversationContent() {
  const [clientHasMounted, setClientHasMounted] = useState(false);
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser } = useCurrentUser();
  const currentUserId = currentUser?.id;
  const locale = useLocale();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showGroupManage, setShowGroupManage] = useState(false);
  const [replyingTo, setReplyingTo] = useState<DirectMessage | null>(null);
  const [p2pMessages, setP2pMessages] = useState<LocalP2pMessage[]>([]);
  const [p2pConnectedCount, setP2pConnectedCount] = useState(0);
  const [zeroDbOnly, setZeroDbOnly] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottom = useRef(true);
  const p2pGroupRef = useRef<P2pGroupSessionController | null>(null);

  const conversationId =
    typeof params?.conversationId === 'string' ? params.conversationId : undefined;

  const scrollToBottom = useCallback((behavior: 'smooth' | 'auto' = 'auto') => {
    const scrollEl = scrollContainerRef.current;
    if (scrollEl) {
      scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior });
    }
  }, []);

  const handleScroll = useCallback(() => {
    const scrollEl = scrollContainerRef.current;
    if (scrollEl) {
      const isNearBottom =
        scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 150;
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

  useEffect(() => {
    if (messages.length > 0 && shouldStickToBottom.current) {
      scrollToBottom('auto');
    }
  }, [messages.length, scrollToBottom]);

  useEffect(() => {
    setClientHasMounted(true);
  }, []);

  useEffect(() => {
    if (!clientHasMounted) return;

    if (!currentUserId) {
      setError('Você precisa estar logado para acessar este grupo.');
      setIsLoading(false);
      return;
    }
    if (!conversationId) {
      setError('ID do grupo inválido.');
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    const convDocRef = doc(db, 'conversations', conversationId);
    let lastMetaKey = '';

    const unsubscribeConv = onSnapshot(
      convDocRef,
      async (snap) => {
        if (!isMounted) return;
        if (!snap.exists()) {
          setConversation(null);
          setError('Grupo não encontrado ou você não tem permissão para acessá-lo.');
          setIsLoading(false);
          return;
        }
        const data = snap.data();
        const participantIds: string[] = Array.isArray(data.participantIds) ? data.participantIds : [];
        if (!participantIds.includes(currentUserId)) {
          setConversation(null);
          setError('Você não participa mais deste grupo.');
          setIsLoading(false);
          return;
        }
        const adminIds: string[] = Array.isArray(data.adminIds) ? data.adminIds : [];
        const metaKey = `${data.groupName || ''}|${participantIds.join(',')}|${adminIds.join(',')}`;
        if (metaKey === lastMetaKey) {
          return;
        }
        lastMetaKey = metaKey;

        try {
          const convo = await getConversationById(conversationId, currentUserId);
          if (!isMounted) return;
          if (!convo) {
            setError('Grupo não encontrado ou você não tem permissão para acessá-lo.');
            setIsLoading(false);
            return;
          }
          setConversation(convo);
          setIsLoading(false);
          void markConversationAsRead(convo.id, currentUserId);
        } catch {
          if (isMounted) {
            setError('Falha ao carregar o grupo.');
            setIsLoading(false);
          }
        }
      },
      () => {
        if (isMounted) {
          setError('Grupo não encontrado ou você não tem permissão para acessá-lo.');
          setIsLoading(false);
        }
      }
    );

    return () => {
      isMounted = false;
      unsubscribeConv();
    };
  }, [clientHasMounted, conversationId, currentUserId]);

  const activeConversationId = conversation?.id;
  const participantsInfoRef = useRef<User[]>([]);
  useEffect(() => {
    participantsInfoRef.current = conversation?.participantsInfo || [];
  }, [conversation?.participantsInfo]);

  useEffect(() => {
    if (!activeConversationId || !currentUserId) return;

    const messagesQuery = query(
      collection(db, 'conversations', activeConversationId, 'messages'),
      orderBy('createdAt', 'asc')
    );

    const participantMap = new Map<string, User>();
    participantsInfoRef.current.forEach((p) => participantMap.set(p.id, p));

    const unsubscribe = onSnapshot(
      messagesQuery,
      async (snapshot) => {
        participantsInfoRef.current.forEach((p) => participantMap.set(p.id, p));
        const fetchedMessages: DirectMessage[] = await Promise.all(
          snapshot.docs.map(async (docSnap) => {
            const data = docSnap.data();
            let sender = participantMap.get(data.senderId);
            if (!sender) {
              sender = (await serverGetUser(data.senderId, currentUserId)) || undefined;
              if (sender) participantMap.set(data.senderId, sender);
            }
            const createdAtTimestamp = data.createdAt as Timestamp | null;
            return {
              id: docSnap.id,
              conversationId: activeConversationId,
              senderId: data.senderId,
              sender,
              text: data.text || '',
              fileUrl: data.fileUrl,
              fileType: data.fileType,
              sharedPostId: data.sharedPostId,
              createdAt: createdAtTimestamp
                ? createdAtTimestamp.toDate().toISOString()
                : new Date().toISOString(),
              readAt: data.readAt
                ? (data.readAt as Timestamp).toDate().toISOString()
                : null,
              parentMessageId: data.parentMessageId,
              parentMessageText: data.parentMessageText,
              parentMessageSenderName: data.parentMessageSenderName,
            };
          })
        );
        setMessages(fetchedMessages);
        void markConversationAsRead(activeConversationId, currentUserId);
      },
      (err) => {
        console.error('Error listening to group messages:', err);
      }
    );

    return () => unsubscribe();
  }, [activeConversationId, currentUserId]);

  const participantsById = useMemo(() => {
    const map: Record<string, User> = {};
    if (currentUser) map[currentUser.id] = currentUser;
    for (const participant of conversation?.participantDetails || []) {
      if (participant?.id) {
        map[participant.id] = participant;
      }
    }
    return map;
  }, [conversation?.participantDetails, currentUser]);

  useEffect(() => {
    if (!conversation?.id || !currentUser) return;
    let cancelled = false;

    const prefs = getP2pPreferences(currentUser.id);
    if (prefs.defaultZeroDbOnly) {
      setZeroDbOnly(true);
    }

    void loadGroupP2pHistory({
      conversationId: conversation.id,
      currentUser,
      participantsById,
    }).then((history) => {
      if (!cancelled) {
        setP2pMessages(history);
      }
    });

    if (!prefs.autoConnectP2p && !prefs.defaultZeroDbOnly && !zeroDbOnly) {
      p2pGroupRef.current?.destroy();
      p2pGroupRef.current = null;
      setP2pConnectedCount(0);
      return () => {
        cancelled = true;
      };
    }

    const session = createP2pGroupSession({
      conversationId: conversation.id,
      currentUser,
      participantsById,
      onConnectedCountChange: (count) => {
        if (!cancelled) setP2pConnectedCount(count);
      },
      onMessage: (msg) => {
        if (cancelled) return;
        setP2pMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      },
      onMessageUpdated: (updated) => {
        if (cancelled) return;
        setP2pMessages((prev) => {
          const exists = prev.some((m) => m.id === updated.id);
          if (!exists) return [...prev, updated];
          return prev.map((m) => (m.id === updated.id ? updated : m));
        });
      },
      onSyncedList: (synced) => {
        if (!cancelled) {
          setP2pMessages(synced);
        }
      },
    });
    p2pGroupRef.current = session;

    return () => {
      cancelled = true;
      session.destroy();
      if (p2pGroupRef.current === session) {
        p2pGroupRef.current = null;
      }
      setP2pConnectedCount(0);
    };
  }, [conversation?.id, currentUser, participantsById, zeroDbOnly]);

  const combinedMessages = useMemo(() => {
    return [...messages, ...p2pMessages].sort((a, b) => {
      const ta = new Date(a.createdAt).getTime() || 0;
      const tb = new Date(b.createdAt).getTime() || 0;
      return ta - tb;
    });
  }, [messages, p2pMessages]);

  const handleSendMessage = async (data: {
    text?: string;
    fileUrl?: string;
    fileType?: DirectMessage['fileType'];
  }) => {
    if (!conversation || !currentUserId) return;
    shouldStickToBottom.current = true;
    try {
      const replyData = replyingTo
        ? {
            parentMessageId: replyingTo.id,
            parentMessageText:
              replyingTo.text || (replyingTo.fileUrl ? 'Arquivo anexado' : 'Post compartilhado'),
            parentMessageSenderName: replyingTo.sender?.name || 'Participante',
          }
        : {};

      if (!data.fileUrl && data.text?.trim() && (p2pConnectedCount > 0 || zeroDbOnly)) {
        if (!p2pGroupRef.current) {
          toast({
            title: 'Modo Zero DB iniciando',
            description: 'Aguarde um instante enquanto a sessão P2P do grupo é inicializada.',
          });
          return;
        }
        const sent = await p2pGroupRef.current.sendText(data.text.trim(), replyData);
        setP2pMessages((prev) => {
          if (prev.some((m) => m.id === sent.id)) return prev;
          return [...prev, sent];
        });
        setReplyingTo(null);
        scrollToBottom('smooth');
        if (sent.p2pStatus === 'queued') {
          toast({
            title: 'Na fila P2P (Zero DB)',
            description:
              'Nenhum participante conectado agora. A mensagem será entregue automaticamente quando alguém conectar e já sincroniza entre seus dispositivos.',
          });
        }
        return;
      }

      if (zeroDbOnly) {
        toast({
          title: 'Modo Zero DB ativo',
          description: 'Arquivos/mídias ainda usam envio padrão. Desative Zero DB para anexos.',
          variant: 'destructive',
        });
        return;
      }

      await sendDirectMessage(conversation.id, currentUserId, { ...data, ...replyData });
      setReplyingTo(null);
      scrollToBottom('smooth');
    } catch {
      toast({
        title: 'Erro ao enviar mensagem',
        description: 'Não foi possível enviar sua mensagem para o grupo.',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!conversation || !currentUserId) return;
    try {
      if (messageId.startsWith('p2p_')) {
        deleteGroupLocalP2pMessage(currentUserId, conversation.id, messageId);
        setP2pMessages((prev) => prev.filter((m) => m.id !== messageId));
        toast({ title: 'Mensagem P2P apagada localmente' });
        return;
      }
      await deleteDirectMessage(conversation.id, messageId);
      toast({ title: 'Mensagem apagada' });
    } catch {
      toast({
        title: 'Erro',
        description: 'Não foi possível apagar a mensagem.',
        variant: 'destructive',
      });
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!currentUserId) throw new Error('Usuário não logado');
    const { uploadFileToStorage, directMessageMediaPathFactory, isLikelyVideoFile } =
      await import('@/lib/services/mediaUploadService');
    const result = await uploadFileToStorage(currentUserId, file, directMessageMediaPathFactory);
    const fileType: DirectMessage['fileType'] = file.type.startsWith('image/')
      ? 'image'
      : isLikelyVideoFile(file)
      ? 'video'
      : file.type.startsWith('audio/')
      ? 'audio'
      : 'file';
    return { url: result.downloadURL, type: fileType };
  };

  const handleLeaveGroup = async () => {
    if (!conversation || !currentUserId) return;
    setIsLeaving(true);
    try {
      await declineOrLeaveConversation(conversation.id, currentUserId);
      toast({ title: 'Você saiu do grupo' });
      router.replace(`/${locale}/messages`);
    } catch {
      toast({
        title: 'Erro',
        description: 'Falha ao sair do grupo.',
        variant: 'destructive',
      });
      setIsLeaving(false);
    }
  };

  if (!clientHasMounted || (isLoading && !error)) {
    return <GroupConversationSkeleton />;
  }

  if (error) {
    return (
      <div className="container mx-auto max-w-2xl py-8 text-center">
        <Card className="shadow-lg">
          <CardHeader>
            <div className="flex flex-col items-center pt-4">
              <AlertCircle className="h-12 w-12 text-destructive mb-4" />
              <CardTitle>Erro</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-destructive">{error}</p>
            {error.toLowerCase().includes('logado') ? (
              <Button onClick={() => router.push(`/${locale}/login`)} className="mt-6">
                <LogIn className="mr-2 h-4 w-4" /> Login
              </Button>
            ) : (
              <Button onClick={() => router.push(`/${locale}/messages`)} className="mt-6">
                Ir para Mensagens
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="container mx-auto max-w-2xl py-8 text-center">
        <Card className="shadow-lg">
          <CardHeader>
            <div className="flex flex-col items-center pt-4">
              <MessageSquareOff className="h-12 w-12 text-muted-foreground mb-4" />
              <CardTitle>Grupo indisponível</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.push(`/${locale}/messages`)} className="mt-4">
              Ir para Mensagens
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isCurrentUserAdmin = Boolean(
    currentUserId && conversation.adminIds?.includes(currentUserId)
  );

  const memberNames = conversation.participantsInfo
    .map((p) => p.name.split(' ')[0])
    .slice(0, 5)
    .join(', ');

  return (
    <>
      {currentUserId && (
        <GroupManagementDialog
          open={showGroupManage}
          onOpenChange={setShowGroupManage}
          conversation={conversation}
          currentUserId={currentUserId}
        />
      )}

      <AlertDialog open={showLeaveConfirm} onOpenChange={setShowLeaveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair do grupo?</AlertDialogTitle>
            <AlertDialogDescription>
              Você deixará de acompanhar novas mensagens deste grupo na sua caixa de entrada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLeaving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleLeaveGroup} disabled={isLeaving}>
              {isLeaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Sair
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-background">
        <header className="flex min-w-0 items-center p-3 sm:p-4 border-b border-border sticky top-0 bg-background z-10">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigateBack(router, `/${locale}/messages`)}
            className="mr-2 min-[800px]:hidden"
          >
            <ArrowLeft className="h-5 w-5" />
            <span className="sr-only">Voltar para Mensagens</span>
          </Button>
          <button
            type="button"
            onClick={() => setShowGroupManage(true)}
            className="flex min-w-0 flex-1 items-center space-x-3 text-left rounded-lg hover:bg-muted/30 p-1 -m-1 transition-colors"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/30">
              <Users className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-sm sm:text-base font-semibold text-foreground">
                  {conversation.groupName || 'Grupo'}
                </p>
                {isCurrentUserAdmin && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary shrink-0">
                    <Shield className="h-2.5 w-2.5" />
                    Admin
                  </span>
                )}
                {p2pConnectedCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-500 border border-emerald-500/30 shrink-0">
                    <Wifi className="h-3 w-3" />
                    P2P · {p2pConnectedCount}
                  </span>
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {conversation.participantIds.length} participantes · {memberNames}
              </p>
            </div>
          </button>
          <Button
            variant={zeroDbOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => setZeroDbOnly((v) => !v)}
            title="Modo Zero DB: envia mensagens em texto direto via P2P (ou enfileira localmente e sincroniza entre seus dispositivos)"
            className={`mr-1 h-8 gap-1.5 rounded-full px-2.5 text-xs shrink-0 ${
              zeroDbOnly ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''
            }`}
          >
            {zeroDbOnly ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">Zero DB</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreVertical className="h-5 w-5" />
                <span className="sr-only">Opções do grupo</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setShowGroupManage(true)}>
                <UserPlus className="mr-2 h-4 w-4" />
                <span>{isCurrentUserAdmin ? 'Gerenciar grupo e admins' : 'Ver participantes'}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => setShowLeaveConfirm(true)}
                className="text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span>Sair do grupo</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <div
          ref={scrollContainerRef}
          className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
        >
          <div className="min-w-0 max-w-full p-3 sm:p-4 space-y-4">
            {currentUserId && <P2pNoticeBanner userId={currentUserId} compact />}
            {combinedMessages.map((msg) => {
              const isSender = currentUserId ? msg.senderId === currentUserId : false;
              return (
                <div key={msg.id} className="space-y-1">
                  {!isSender && msg.sender?.name && (
                    <p className="px-1 text-[11px] font-medium text-muted-foreground">
                      {msg.sender.name}
                    </p>
                  )}
                  <MessageBubble
                    message={msg}
                    isCurrentUserSender={isSender}
                    onDeleteMessage={handleDeleteMessage}
                    onReply={setReplyingTo}
                  />
                </div>
              );
            })}
            {combinedMessages.length === 0 && !isLoading && (
              <p className="text-center text-muted-foreground py-10">
                Nenhuma mensagem ainda. Diga olá para o grupo!
              </p>
            )}
          </div>
        </div>

        <MessageInputArea
          onSendMessage={handleSendMessage}
          onFileUpload={handleFileUpload}
          disabled={!currentUserId}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
        />
      </div>
    </>
  );
}

export default function GroupConversationPage() {
  return (
    <Suspense fallback={<GroupConversationSkeleton />}>
      <GroupConversationContent />
    </Suspense>
  );
}

