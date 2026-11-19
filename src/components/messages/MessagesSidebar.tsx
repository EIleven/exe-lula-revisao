// src/components/messages/MessagesSidebar.tsx
'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { collection, query, where, orderBy, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getCurrentUserId } from '@/lib/services/authService';
import {
  firestoreToConversation,
  acceptConversationRequest,
  declineOrLeaveConversation,
  markConversationAsRead,
} from '@/lib/services/conversationService';
import { getFollowedUserIds } from '@/lib/services/userService';
import type { Conversation } from '@/lib/types';
import ConversationListItem from '@/components/messages/ConversationListItem';
import { NewConversationDialog } from '@/components/messages/NewConversationDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { useLocale } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  MailPlus,
  ChevronDown,
  Search,
  CheckCheck,
  Settings,
  Check,
  MessageSquare,
  Inbox,
  Pin,
} from 'lucide-react';
import { useHiperChatMode } from '@/hooks/useHiperChatMode';
import { useHiperChatPins, useHiperChatPreferences } from '@/hooks/useHiperChatPreferences';
import { estaFixada, separarFixadas, MAX_FIXADAS, type HiperChatFilter } from '@/lib/hiperchat/preferences';
import { chatBadges, contarGruposNaoLidos } from '@/lib/hiperchat/badges';

type FilterOption = 'all' | 'unread' | 'direct' | 'groups' | 'requests' | 'pinned';
type TabOption = 'conversations' | 'messages';

const FILTER_LABELS: Record<FilterOption, string> = {
  all: 'Tudo',
  unread: 'Não lido',
  direct: 'Direto',
  groups: 'Grupos',
  requests: 'Solicitações',
  pinned: 'Fixadas',
};

/** A navegação do HiperChat vira filtro aqui. Link de verdade: recarregar e o botão Voltar continuam funcionando. */
const FILTRO_DA_NAVEGACAO: Record<HiperChatFilter, FilterOption> = {
  todas: 'all',
  grupos: 'groups',
  fixadas: 'pinned',
};

const ehRotuloDeNavegacao = (valor: string | null | undefined): valor is HiperChatFilter =>
  valor === 'todas' || valor === 'grupos' || valor === 'fixadas';

interface MessagesSidebarProps {
  activeOtherUserId?: string;
  activeConversationId?: string;
}

export default function MessagesSidebar({
  activeOtherUserId,
  activeConversationId,
}: MessagesSidebarProps) {
  const [requests, setRequests] = useState<Conversation[]>([]);
  const [activeConversations, setActiveConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isNewConvoDialogOpen, setIsNewConvoDialogOpen] = useState(false);
  const [filter, setFilter] = useState<FilterOption>('all');
  const [activeTab, setActiveTab] = useState<TabOption>('conversations');
  const [searchTerm, setSearchTerm] = useState('');
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);

  const currentUserId = getCurrentUserId();
  const router = useRouter();
  const locale = useLocale();
  const { toast } = useToast();

  // ─── só no HiperChat: fixadas, preferências do aparelho e o filtro que vem da navegação ───
  const isHiperChat = useHiperChatMode();
  const searchParams = useSearchParams();
  // Com o uid nulo os dois ganchos não leem nem gravam nada: fora do HiperChat esta tela não encosta no armazenamento.
  const uidHiperChat = isHiperChat ? currentUserId : null;
  const { fixadas, alternar: alternarFixada } = useHiperChatPins(uidHiperChat);
  const { preferencias } = useHiperChatPreferences(uidHiperChat);
  // Depois do primeiro toque num filtro, a escolha é dela: o padrão do aparelho não volta por cima.
  const escolheuFiltro = useRef(false);
  const filtroDaUrl = searchParams?.get('filtro') ?? null;

  useEffect(() => {
    if (!isHiperChat) return;
    // Com `?filtro=` na URL manda a navegação; sem ele, manda o padrão que a pessoa escolheu em Configurações.
    const rotulo = ehRotuloDeNavegacao(filtroDaUrl) ? filtroDaUrl : null;
    if (rotulo) {
      escolheuFiltro.current = false;
      setFilter(FILTRO_DA_NAVEGACAO[rotulo]);
      setActiveTab('conversations');
      return;
    }
    if (!escolheuFiltro.current) setFilter(FILTRO_DA_NAVEGACAO[preferencias.filtroInicial]);
  }, [isHiperChat, filtroDaUrl, preferencias.filtroInicial]);

  // Os números da barra de navegação: só esta lista sabe quantos grupos têm mensagem nova.
  useEffect(() => {
    if (!isHiperChat) return;
    const existentes = new Set(activeConversations.map((c) => c.id));
    chatBadges.publish({
      grupos: contarGruposNaoLidos(activeConversations, currentUserId),
      fixadas: fixadas.filter((id) => existentes.has(id)).length,
    });
  }, [isHiperChat, activeConversations, fixadas, currentUserId]);

  useEffect(() => {
    if (!currentUserId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const q = query(
      collection(db, 'conversations'),
      where('participantIds', 'array-contains', currentUserId),
      orderBy('lastMessageAt', 'desc')
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      q,
      async (snapshot) => {
        const followedIds = new Set(await getFollowedUserIds(currentUserId));

        const userConvosPromises = snapshot.docs
          .filter((doc) => !doc.data().userLeftAt?.[currentUserId])
          .map((doc) => firestoreToConversation(doc.id, doc.data(), currentUserId));

        const userConvos = (await Promise.all(userConvosPromises)).filter(
          (c): c is Conversation => c !== null
        );

        const requestsList: Conversation[] = [];
        const activeList: Conversation[] = [];

        userConvos.forEach((convo) => {
          if (!convo.lastMessage || convo.isGroup) {
            activeList.push(convo);
            return;
          }

          const otherParticipantId = convo.participantIds.find((id) => id !== currentUserId);
          const isRequest =
            convo.lastMessage.senderId !== currentUserId &&
            Boolean(otherParticipantId) &&
            !followedIds.has(otherParticipantId as string);

          if (isRequest) {
            requestsList.push(convo);
          } else {
            activeList.push(convo);
          }
        });

        setRequests(requestsList);
        setActiveConversations(activeList);
        setIsLoading(false);
      },
      (error) => {
        console.error('Failed to listen for conversation updates:', error);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUserId]);

  const handleRequestAction = async (conversationId: string, action: 'accept' | 'decline') => {
    if (!currentUserId) return;

    const originalRequests = [...requests];
    const originalActive = [...activeConversations];

    const conversationToMove = requests.find((r) => r.id === conversationId);
    setRequests((prev) => prev.filter((r) => r.id !== conversationId));
    if (action === 'accept' && conversationToMove) {
      setActiveConversations((prev) => [conversationToMove, ...prev]);
    }

    try {
      if (action === 'accept') {
        await acceptConversationRequest(conversationId, currentUserId);
        toast({
          title: 'Pedido aceito',
          description: 'A conversa foi movida para Conversas.',
        });
      } else {
        await declineOrLeaveConversation(conversationId, currentUserId);
        toast({
          title: 'Pedido recusado',
          description: 'A conversa foi removida.',
        });
      }
    } catch (error: unknown) {
      setRequests(originalRequests);
      setActiveConversations(originalActive);
      const message =
        error instanceof Error ? error.message : 'Não foi possível processar o pedido.';
      toast({ title: 'Erro', description: message, variant: 'destructive' });
    }
  };

  const handleMarkAllAsRead = async () => {
    if (!currentUserId || isMarkingAllRead) return;
    const unreadConvos = [...activeConversations, ...requests].filter(
      (c) => (c.unreadCounts?.[currentUserId] || 0) > 0
    );
    if (unreadConvos.length === 0) {
      toast({ title: 'Tudo em dia', description: 'Não há mensagens não lidas.' });
      return;
    }

    setIsMarkingAllRead(true);
    try {
      await Promise.all(
        unreadConvos.map((convo) => markConversationAsRead(convo.id, currentUserId))
      );
      toast({
        title: 'Mensagens lidas',
        description: `${unreadConvos.length} conversa(s) marcada(s) como lida(s).`,
      });
    } catch {
      toast({
        title: 'Erro',
        description: 'Não foi possível marcar todas como lidas.',
        variant: 'destructive',
      });
    } finally {
      setIsMarkingAllRead(false);
    }
  };

  const handleSelectFilter = (nextFilter: FilterOption) => {
    escolheuFiltro.current = true;
    setFilter(nextFilter);
    if (nextFilter === 'requests') {
      setActiveTab('messages');
    } else if (activeTab === 'messages' && nextFilter !== 'unread') {
      setActiveTab('conversations');
    }
  };

  const visibleConversations = useMemo(() => {
    const source =
      filter === 'requests' || activeTab === 'messages' ? requests : activeConversations;

    const term = searchTerm.trim().toLowerCase();

    return source.filter((convo) => {
      if (filter === 'unread') {
        const unread = currentUserId ? convo.unreadCounts?.[currentUserId] || 0 : 0;
        if (unread <= 0) return false;
      } else if (filter === 'groups') {
        if (!convo.isGroup && convo.participantIds.length <= 2) return false;
      } else if (filter === 'direct') {
        if (convo.isGroup || convo.participantIds.length > 2) return false;
      } else if (filter === 'pinned') {
        if (!estaFixada(fixadas, convo.id)) return false;
      }

      if (!term) return true;
      const other = convo.participantsInfo.find((p) => p.id !== currentUserId);
      const groupMatch = convo.groupName?.toLowerCase().includes(term);
      const nameMatch = other?.name?.toLowerCase().includes(term);
      const usernameMatch = other?.username?.toLowerCase().includes(term);
      const lastMsgMatch = convo.lastMessage?.text?.toLowerCase().includes(term);
      return Boolean(groupMatch || nameMatch || usernameMatch || lastMsgMatch);
    });
  }, [activeConversations, requests, filter, activeTab, searchTerm, currentUserId, fixadas]);

  const showingRequests = filter === 'requests' || activeTab === 'messages';

  // No HiperChat, com a lista inteira à mostra, as fixadas sobem para uma seção própria no topo.
  const porSecao = useMemo(
    () => separarFixadas(visibleConversations, isHiperChat && filter === 'all' && !showingRequests ? fixadas : []),
    [visibleConversations, isHiperChat, filter, showingRequests, fixadas],
  );

  /** Fixar no teto desaloja a mais antiga; a pessoa precisa saber disso na hora, não descobrir pela lista. */
  const fixarConversa = (conversationId: string) => {
    const vaiEntrar = !estaFixada(fixadas, conversationId);
    alternarFixada(conversationId);
    if (vaiEntrar && fixadas.length >= MAX_FIXADAS) {
      toast({
        title: `Limite de ${MAX_FIXADAS} fixadas`,
        description: 'A fixada mais antiga saiu do topo.',
      });
    }
  };

  const renderConversa = (convo: Conversation) => {
    const otherParticipant = convo.participantsInfo.find((p) => p.id !== currentUserId);
    const isActive = Boolean(
      (activeConversationId && convo.id === activeConversationId) ||
        (activeOtherUserId && !convo.isGroup && otherParticipant?.id === activeOtherUserId)
    );

    return (
      <ConversationListItem
        key={convo.id}
        conversation={convo}
        isActive={isActive}
        isRequest={showingRequests}
        onAccept={() => handleRequestAction(convo.id, 'accept')}
        onDecline={() => handleRequestAction(convo.id, 'decline')}
        // Fixar e a prévia são do HiperChat: sem o modo, nenhuma prop nova chega e o item é o mesmo do HiperVerso.
        onTogglePin={isHiperChat && !showingRequests ? () => fixarConversa(convo.id) : undefined}
        isPinned={isHiperChat && estaFixada(fixadas, convo.id)}
        showPreview={!isHiperChat || preferencias.previa}
      />
    );
  };

  return (
    <>
      <NewConversationDialog open={isNewConvoDialogOpen} onOpenChange={setIsNewConvoDialogOpen} />

      <div className="flex h-full w-full flex-col bg-background">
        {/* Topo: Título + Filtro + Novo chat */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-lg font-bold tracking-tight text-foreground truncate">
              Mensagens
            </h1>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-full border-border bg-muted/30 px-2.5 text-xs font-medium text-foreground hover:bg-muted"
                >
                  <span>{FILTER_LABELS[filter]}</span>
                  <ChevronDown className="ml-1 h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                {((isHiperChat
                  ? ['all', 'pinned', 'unread', 'direct', 'groups', 'requests']
                  : ['all', 'unread', 'direct', 'groups', 'requests']) as FilterOption[]).map(
                  (opt) => (
                    <DropdownMenuItem
                      key={opt}
                      onSelect={() => handleSelectFilter(opt)}
                      className="flex items-center justify-between"
                    >
                      <span>{FILTER_LABELS[opt]}</span>
                      {filter === opt && <Check className="h-4 w-4 text-primary" />}
                    </DropdownMenuItem>
                  )
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => router.push(`/${locale}/settings`)}>
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Configurações</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleMarkAllAsRead} disabled={isMarkingAllRead}>
                  <CheckCheck className="mr-2 h-4 w-4" />
                  <span>Marcar todas como lidas</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <Button
            size="icon"
            variant="ghost"
            onClick={() => setIsNewConvoDialogOpen(true)}
            className="h-9 w-9 rounded-full text-primary hover:bg-primary/10 shrink-0"
            title="Novo chat"
            aria-label="Novo chat"
          >
            <MailPlus className="h-5 w-5" />
          </Button>
        </div>

        {/* Busca */}
        <div className="px-3 py-2.5 border-b border-border/70">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar Mensagens Diretas"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-9 rounded-full border-border bg-muted/30 pl-9 text-sm"
            />
          </div>
        </div>

        {/* Abas: Conversas / Mensagens (solicitações) */}
        <div className="grid grid-cols-2 border-b border-border">
          <button
            type="button"
            onClick={() => {
              setActiveTab('conversations');
              if (filter === 'requests') setFilter('all');
            }}
            className={cn(
              'relative py-2.5 text-sm font-medium transition-colors hover:bg-muted/30',
              activeTab === 'conversations' && filter !== 'requests'
                ? 'text-foreground font-semibold'
                : 'text-muted-foreground'
            )}
          >
            Conversas
            {activeTab === 'conversations' && filter !== 'requests' && (
              <span className="absolute bottom-0 left-1/2 h-0.5 w-14 -translate-x-1/2 rounded-full bg-primary" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('messages')}
            className={cn(
              'relative flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors hover:bg-muted/30',
              activeTab === 'messages' || filter === 'requests'
                ? 'text-foreground font-semibold'
                : 'text-muted-foreground'
            )}
          >
            <span>Mensagens</span>
            {requests.length > 0 && (
              <Badge variant="default" className="h-4 min-w-[1rem] rounded-full px-1 text-[10px]">
                {requests.length > 9 ? '9+' : requests.length}
              </Badge>
            )}
            {(activeTab === 'messages' || filter === 'requests') && (
              <span className="absolute bottom-0 left-1/2 h-0.5 w-14 -translate-x-1/2 rounded-full bg-primary" />
            )}
          </button>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {isLoading ? (
            <div className="space-y-px p-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-3">
                  <Skeleton className="h-11 w-11 rounded-full shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3.5 w-48" />
                  </div>
                </div>
              ))}
            </div>
          ) : visibleConversations.length > 0 ? (
            <div>
              {porSecao.fixadas.length > 0 && (
                <>
                  <p className="flex items-center gap-1.5 bg-muted/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Pin className="h-3 w-3 fill-current" />
                    Fixadas
                  </p>
                  {porSecao.fixadas.map((convo) => renderConversa(convo))}
                  {porSecao.demais.length > 0 && (
                    <p className="bg-muted/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Conversas
                    </p>
                  )}
                </>
              )}
              {porSecao.demais.map((convo) => renderConversa(convo))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted/50 text-muted-foreground">
                {showingRequests ? (
                  <Inbox className="h-6 w-6" />
                ) : filter === 'pinned' ? (
                  <Pin className="h-6 w-6" />
                ) : (
                  <MessageSquare className="h-6 w-6" />
                )}
              </div>
              <p className="text-sm font-medium text-foreground">
                {showingRequests
                  ? 'Nenhuma solicitação de mensagem'
                  : filter === 'unread'
                  ? 'Nenhuma conversa não lida'
                  : filter === 'groups'
                  ? 'Nenhum grupo ainda'
                  : filter === 'pinned'
                  ? 'Nenhuma conversa fixada'
                  : searchTerm.trim()
                  ? 'Nenhuma conversa encontrada'
                  : 'Nenhuma conversa ativa'}
              </p>
              {filter === 'pinned' && !showingRequests && (
                <p className="mt-1.5 max-w-[15rem] text-xs text-muted-foreground">
                  Toque no alfinete de uma conversa para deixá-la sempre no topo.
                </p>
              )}
              {!showingRequests && filter === 'all' && !searchTerm.trim() && (
                <Button
                  onClick={() => setIsNewConvoDialogOpen(true)}
                  size="sm"
                  className="mt-4 rounded-full px-5"
                >
                  Novo chat
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

