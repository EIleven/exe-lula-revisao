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
import {
  getGroupP2pMode,
  setGroupP2pMode,
  type GroupP2pMode,
} from '@/lib/p2p/p2pPreferences';
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
  Check,
  Database,
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
  const [groupP2pMode, setGroupP2pModeState] = useState<GroupP2pMode>('hybrid');

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
    for (const participant of conversation?.participantsInfo || []) {
      if (participant?.id) {
        map[participant.id] = participant;
      }
    }
    return map;
  }, [conversation?.participantsInfo, currentUser]);

  useEffect(() => {
    if (!currentUserId || !conversation?.id) return;
    setGroupP2pModeState(getGroupP2pMode(currentUserId, conversation.id));
  }, [currentUserId, conversation?.id]);

  const handleChangeGroupP2pMode = useCallback(
    (nextMode: GroupP2pMode) => {
      setGroupP2pModeState(nextMode);
      if (currentUserId && conversation?.id) {
        setGroupP2pMode(currentUserId, conversation.id, nextMode);
      }
      if (nextMode === 'off') {
        toast({
          title: 'P2P desativado neste grupo',
          description: 'Mensagens enviadas e recebidas pelo banco (DB) para todos os participantes.',
        });
      } else {
        toast({
          title: 'P2P ativado neste grupo',
          description: 'Entrega direto via P2P para conectados e via banco (DB) para quem está offline ou sem P2P.',
        });
      }
    },
    [currentUserId, conversation?.id, toast]
  );

  useEffect(() => {
    if (!conversation?.id || !currentUser) return;
    let cancelled = false;

    void loadGroupP2pHistory({
      conversationId: conversation.id,
      currentUser,
      participantsById,
    }).then((history) => {
      if (!cancelled) {
        setP2pMessages(history);
      }
    });

    if (groupP2pMode === 'off') {
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
  }, [conversation?.id, currentUser, participantsById, groupP2pMode]);

  const combinedMessages = useMemo(() => {
    const senderLookup = new Map<string, User>();
    for (const [id, u] of Object.entries(participantsById)) {
      if (u) senderLookup.set(id, u);
    }
    for (const m of messages) {
      if (m.sender?.id) senderLookup.set(m.sender.id, m.sender);
    }

    const byId = new Map<string, DirectMessage>();
    for (const m of messages) {
      byId.set(m.id, m);
    }
    for (const p of p2pMessages) {
      const resolvedSender = senderLookup.get(p.senderId) || p.sender;
      const enriched = resolvedSender ? { ...p, sender: resolvedSender } : p;
      if (!byId.has(enriched.id) || enriched.isP2p) {
        byId.set(enriched.id, enriched);
      }
    }
    return Array.from(byId.values()).sort((a, b) => {
      const ta = new Date(a.createdAt).getTime() || 0;
      const tb = new Date(b.createdAt).getTime() || 0;
      return ta - tb;
    });
  }, [messages, p2pMessages, participantsById]);

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
            parentMessageSenderName: replyingTo.sender?.name || 'Membro',
          }
        : {};

      const trimmedText = data.text?.trim() || '';
      const otherMemberCount = conversation.participantIds.filter((id) => id !== currentUserId).length;
      const allOthersConnectedViaP2p = otherMemberCount > 0 && p2pConnectedCount >= otherMemberCount;

      if (groupP2pMode === 'hybrid' && !data.fileUrl && trimmedText && p2pConnectedCount > 0 && p2pGroupRef.current) {
        const sent = await p2pGroupRef.current.sendText(trimmedText, replyData);
        if (sent) {
          setP2pMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
        }
        // Em grupos, quem estiver offline ou com P2P desativado também recebe a mensagem pelo DB (mesmo ID, sem duplicar).
        if (!allOthersConnectedViaP2p) {
          await sendDirectMessage(conversation.id, currentUserId, {
            ...data,
            text: trimmedText,
            ...replyData,
            customMessageId: sent?.id,
          });
        }
        setReplyingTo(null);
        scrollToBottom('smooth');
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
      const hasLocalP2p = p2pMessages.some((m) => m.id === messageId) || messageId.startsWith('p2p_');
      const hasDbDoc = messages.some((m) => m.id === messageId) || !messageId.startsWith('p2p_');
      if (hasLocalP2p) {
        deleteGroupLocalP2pMessage(currentUserId, conversation.id, messageId);
        setP2pMessages((prev) => prev.filter((m) => m.id !== messageId));
      }
      if (hasDbDoc) {
        await deleteDirectMessage(conversation.id, messageId);
      }
      toast({ title: 'Mensagem apagada' });
    } catch {
      toast({
        title: 'Erro',
        description: 'Não foi possível apagar a mensagem.',
        variant: 'destructive',
      });
    }
  };

  const handleFileUpload = async (file: File, aoProgredir?: (p: number) => void) => {
    if (!currentUserId) throw new Error('Usuário não logado');
    const { uploadFileToStorage, directMessageMediaPathFactory, isLikelyVideoFile } =
      await import('@/lib/services/mediaUploadService');
    const result = await uploadFileToStorage(currentUserId, file, directMessageMediaPathFactory, aoProgredir);
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
            onClick={() => navigateBack(router, { fallbackUrl: `/${locale}/messages` })}
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
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <p className="truncate text-sm sm:text-base font-semibold text-foreground">
                  {conversation.groupName || 'Grupo'}
                </p>
                {isCurrentUserAdmin && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary shrink-0">
                    <Shield className="h-2.5 w-2.5" />
                    <span className="hidden sm:inline">Admin</span>
                  </span>
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {conversation.participantIds.length} participantes · {memberNames}
              </p>
            </div>
          </button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleChangeGroupP2pMode(groupP2pMode === 'off' ? 'hybrid' : 'off')}
            aria-label={
              groupP2pMode === 'off'
                ? 'Ativar P2P neste grupo'
                : 'Desativar P2P neste grupo'
            }
            title={
              groupP2pMode === 'hybrid'
                ? 'P2P ativo (entrega direta via P2P e compatível via DB para quem está offline ou sem P2P). Clique para desativar.'
                : 'P2P desativado neste grupo (usando DB). Clique para ativar P2P.'
            }
            className={`mr-1 h-8 gap-1.5 rounded-full px-2.5 text-[11px] sm:text-xs font-medium shrink-0 ${
              groupP2pMode === 'hybrid'
                ? 'border-emerald-500/45 bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25'
                : 'border-border/70 text-muted-foreground hover:text-foreground'
            }`}
          >
            {groupP2pMode === 'off' ? (
              <WifiOff className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <Wifi className="h-3.5 w-3.5 shrink-0" />
            )}
            <span>
              {groupP2pMode === 'hybrid'
                ? p2pConnectedCount > 0
                  ? `P2P · ${p2pConnectedCount}`
                  : 'P2P Ativo'
                : 'P2P Off'}
            </span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreVertical className="h-5 w-5" />
                <span className="sr-only">Opções do grupo</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onSelect={() => handleChangeGroupP2pMode('hybrid')}>
                <Wifi className="mr-2 h-4 w-4 text-emerald-500" />
                <span className="flex-1">Ativar P2P (Todos recebem)</span>
                {groupP2pMode === 'hybrid' && <Check className="ml-2 h-4 w-4 text-emerald-500" />}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleChangeGroupP2pMode('off')}>
                <Database className="mr-2 h-4 w-4 text-muted-foreground" />
                <span className="flex-1">Desativar P2P (Só DB)</span>
                {groupP2pMode === 'off' && <Check className="ml-2 h-4 w-4 text-primary" />}
              </DropdownMenuItem>
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
                  {!isSender && msg.sender && (
                    <div className="flex items-center gap-1.5 px-1">
                      <span className="text-[11px] font-semibold text-foreground/90">
                        {msg.sender.name || msg.sender.username}
                      </span>
                      {msg.sender.username && msg.sender.username !== 'participante' && (
                        <span className="text-[10px] text-muted-foreground">
                          @{msg.sender.username}
                        </span>
                      )}
                    </div>
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
              <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Users className="h-5 w-5" />
                </span>
                <p className="text-sm font-medium text-foreground">Grupo novo</p>
                <p className="max-w-[17rem] text-xs text-muted-foreground">
                  Diga olá. A primeira mensagem puxa a conversa.
                </p>
              </div>
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

