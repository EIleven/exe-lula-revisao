// src/app/messages/user/[otherUserId]/page.tsx
'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { navigateBack } from '@/lib/backNavigation';
import Link from 'next/link';
import { getCurrentUserId } from '@/lib/services/authService';
import { getOrCreateConversation, sendDirectMessage, declineOrLeaveConversation, conversationsCollection, markConversationAsRead, confirmarLeituraDaConversa, deleteDirectMessage } from '@/lib/services/conversationService';
import { getUser as serverGetUser } from '@/lib/services/userService';
import { collection, doc as docRef, query, orderBy, onSnapshot, Timestamp, where } from 'firebase/firestore'; 
import type { Conversation, DirectMessage, User } from '@/lib/types';
import MessageBubble from '@/components/messages/MessageBubble';
import { useHiperChatPreferences } from '@/hooks/useHiperChatPreferences';
import {
  deveEnviarRecibo,
  foiLida,
  instanteDe,
  lidaAteDe,
  lerMarcaLocal,
  precisaConfirmar,
} from '@/lib/messages/recibos';
import MessageInputArea from '@/components/messages/MessageInputArea';
import P2pNoticeBanner from '@/components/messages/P2pNoticeBanner';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ArrowLeft, AlertCircle, Clock, MessageSquareOff, LogIn, MoreVertical, LogOut, Loader2, Lock, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { encryptDirectMessage, decryptDirectMessage, getE2eeStatus, type IdentityStatus } from '@/lib/crypto/e2ee';
import {
  createP2pSession,
  deleteLocalP2pMessage,
  ENCRYPTED_PLACEHOLDER,
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
  const otherUserIdParam = typeof params?.otherUserId === 'string' ? params.otherUserId : '';
  const isSelfChat = Boolean(currentUserId && otherUserIdParam && otherUserIdParam === currentUserId);

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
  // Ate quando o outro lado leu. Duas fontes da MESMA marca: o documento da conversa (normal) e o tunel (Zero DB,
  // onde nao existe documento). `null` = sem marca -- ou voce desligou a confirmacao: quem nao envia, nao ve.
  const [lidaAteServidor, setLidaAteServidor] = useState<number | null>(null);
  const [lidaAteP2p, setLidaAteP2p] = useState<number | null>(null);
  const [telaVisivel, setTelaVisivel] = useState(true);
  const confirmadoAteRef = useRef<number | null>(null);
  const ultimaConfirmacaoRef = useRef<number | null>(null);

  // A escolha e deste APARELHO (localStorage por conta), e vale nos dois apps: HiperVerso e HiperChat.
  const { preferencias: prefsDoChat } = useHiperChatPreferences(currentUserId);
  const reciboLigado = prefsDoChat.confirmacaoDeLeitura;
  const lidaAtePeer = useMemo(() => {
    if (!reciboLigado) return null;
    if (lidaAteServidor === null) return lidaAteP2p;
    if (lidaAteP2p === null) return lidaAteServidor;
    return Math.max(lidaAteServidor, lidaAteP2p);
  }, [reciboLigado, lidaAteServidor, lidaAteP2p]);

  const p2pSessionRef = useRef<P2pSessionController | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottom = useRef(true);

  const mergedMessages = useMemo(() => {
    const lista =
      p2pMessages.length === 0
        ? messages
        : [...messages, ...p2pMessages].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          );

    // A marca d'agua vira o `readAt` de cada mensagem SUA que ela cobre. Uma comparacao por balao, sem ouvinte por
    // mensagem. O carimbo e o mesmo para todas as cobertas, entao a identidade dos objetos nao muda a cada render.
    if (lidaAtePeer === null || !currentUserId) {
      return lista.some((m) => m.readAt) ? lista.map((m) => (m.readAt ? { ...m, readAt: null } : m)) : lista;
    }
    const carimbo = new Date(lidaAtePeer).toISOString();
    return lista.map((m) => {
      const lida = m.senderId === currentUserId && foiLida({ criadaEm: m.createdAt, lidaAte: lidaAtePeer });
      const novo = lida ? carimbo : null;
      return (m.readAt ?? null) === novo ? m : { ...m, readAt: novo };
    });
  }, [messages, p2pMessages, lidaAtePeer, currentUserId]);

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
            
            // Zera o contador de nao lidas e, se a pessoa deixou a confirmacao ligada, avisa o outro lado na MESMA
            // escrita (um campo a mais, nenhuma ida extra ao banco).
            if (conv.unreadCounts?.[currentUserId] > 0) {
              const confirmar = deveEnviarRecibo({
                ligado: reciboLigado,
                conversaAberta: true,
                ehGrupo: Boolean(conv.isGroup),
                ehComigo: Boolean(conv.isSelf) || fetchedOtherUser.id === currentUserId,
              });
              if (confirmar) {
                confirmadoAteRef.current = Date.now();
                ultimaConfirmacaoRef.current = Date.now();
              }
              await markConversationAsRead(conv.id, currentUserId, { confirmarLeitura: confirmar });
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
                            try {
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
                            } catch {
                                resolvedText = '🔒 Mensagem criptografada que não pôde ser aberta neste aparelho.';
                            }
                        }
                        const toIsoSafe = (val: unknown, fallbackNow: boolean): string | null => {
                            if (!val) return fallbackNow ? new Date().toISOString() : null;
                            if (typeof (val as { toDate?: () => Date }).toDate === 'function') {
                                return (val as { toDate: () => Date }).toDate().toISOString();
                            }
                            if (val instanceof Date) return val.toISOString();
                            const parsed = new Date(val as string | number);
                            return Number.isNaN(parsed.getTime()) ? (fallbackNow ? new Date().toISOString() : null) : parsed.toISOString();
                        };
                        fetchedMessages.push({
                            ...data,
                            text: resolvedText,
                            id: doc.id,
                            // O documento da mensagem não guarda o id da conversa (ele está no caminho). Sem isto, apagar a mensagem estourava
                            // "Cannot read properties of undefined (reading 'indexOf')" ao montar a referência do Firestore.
                            conversationId: conv.id,
                            sender: sender,
                            createdAt: toIsoSafe(data.createdAt, true) || new Date().toISOString(),
                            readAt: toIsoSafe(data.readAt, false),
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
      onPeerRead: (ate) => setLidaAteP2p((anterior) => (anterior === null || ate > anterior ? ate : anterior)),
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

  // ───── A fila do Zero DB ─────
  // Com o Zero DB ligado, a mensagem não é gravada em lugar nenhum: fica guardada NESTE aparelho esperando o contato
  // abrir o app. Se ele nunca abre, nada chega — e, até aqui, o único sinal disso era um selo repetido em cada balão.
  // Agora a conversa diz quantas estão esperando, e oferece a saída: mandar pelo servidor, com E2EE.
  // Um ouvinte de UM documento (a tela ja escutava so as mensagens). Desligou a confirmacao? Nem ouvinte existe:
  // quem nao envia, nao ve -- e a economia e real, nao so visual.
  useEffect(() => {
    const convId = conversation?.id;
    const peerId = otherUser?.id;
    if (!convId || !peerId || !currentUserId || !reciboLigado || isSelfChat) {
      setLidaAteServidor(null);
      return;
    }
    const unsub = onSnapshot(
      docRef(conversationsCollection, convId),
      (snap) => setLidaAteServidor(lidaAteDe(snap.data()?.lastReadAt, peerId)),
      () => setLidaAteServidor(null),
    );
    return () => unsub();
  }, [conversation?.id, otherUser?.id, currentUserId, reciboLigado, isSelfChat]);

  // O que o contato ja confirmou pelo tunel ficou guardado aqui: sem isto, reabrir o app apagaria as marcas do Zero DB.
  useEffect(() => {
    const convId = conversation?.id;
    if (!convId || !currentUserId || !reciboLigado || typeof window === 'undefined') {
      setLidaAteP2p(null);
      return;
    }
    setLidaAteP2p(lerMarcaLocal(window.localStorage, currentUserId, convId));
  }, [conversation?.id, currentUserId, reciboLigado]);

  // Voltar para a frente conta como ler: a conversa ja estava montada, so estava escondida.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const aoMudar = () => setTelaVisivel(document.visibilityState === 'visible');
    aoMudar();
    document.addEventListener('visibilitychange', aoMudar);
    return () => document.removeEventListener('visibilitychange', aoMudar);
  }, []);

  // Mensagem nova com a conversa ABERTA na frente: a marca precisa avancar. Com teto de uma escrita por rajada.
  useEffect(() => {
    const convId = conversation?.id;
    if (!convId || !currentUserId || !telaVisivel) return;
    if (!deveEnviarRecibo({
      ligado: reciboLigado,
      conversaAberta: true,
      ehGrupo: Boolean(conversation?.isGroup),
      ehComigo: isSelfChat,
    })) return;

    let maior: number | null = null;
    for (const lista of [messages, p2pMessages]) {
      for (const m of lista) {
        if (m.senderId === currentUserId) continue;
        const t = instanteDe(m.createdAt);
        if (t !== null && (maior === null || t > maior)) maior = t;
      }
    }
    if (maior === null) return; // nada recebido: nao ha o que confirmar

    const agora = Date.now();
    if (!precisaConfirmar({
      maiorRecebidaEm: maior,
      confirmadoAte: confirmadoAteRef.current,
      ultimaEscritaEm: ultimaConfirmacaoRef.current,
      agora,
    })) return;

    confirmadoAteRef.current = maior;
    ultimaConfirmacaoRef.current = agora;
    // Pelo tunel (unico caminho no Zero DB) e pelo servidor. No Zero DB estrito nada vai ao banco.
    p2pSessionRef.current?.confirmarLeitura(maior);
    if (!zeroDbOnly) void confirmarLeituraDaConversa(convId, currentUserId);
  }, [messages, p2pMessages, conversation?.id, conversation?.isGroup, currentUserId, reciboLigado, isSelfChat, telaVisivel, zeroDbOnly]);

  const filaPendente = useMemo(
    () => p2pMessages.filter((m) => m.senderId === currentUserId && m.p2pStatus === 'queued'),
    [p2pMessages, currentUserId],
  );
  const [enviandoFila, setEnviandoFila] = useState(false);

  const enviarFilaPeloServidor = async () => {
    if (!conversation || !currentUserId || enviandoFila || filaPendente.length === 0) return;
    const fila = [...filaPendente].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    setEnviandoFila(true);
    let enviadas = 0;
    let puladas = 0;
    try {
      for (const pendente of fila) {
        const texto = pendente.text?.trim();
        // Sem texto legível (a chave não está neste aparelho) não há o que reenviar: mandar o aviso seria mandar lixo.
        if (!texto || texto === ENCRYPTED_PLACEHOLDER) {
          puladas += 1;
          continue;
        }

        let cifrado = null;
        if (otherUser && !otherUser.id.startsWith('ap_') && otherUser.e2eePublicKey) {
          const identidade = await getE2eeStatus(currentUserId);
          if (identidade.status === 'ready') {
            cifrado = await encryptDirectMessage(texto, currentUserId, otherUser.e2eePublicKey);
            if (!cifrado) throw new UserFacingSendError('Não foi possível proteger uma das mensagens, então ela não foi enviada.');
          }
        }

        const nova = await sendDirectMessage(conversation.id, currentUserId, {
          text: texto,
          ...(cifrado ? { e2ee: cifrado } : {}),
        });
        if (!nova) throw new Error('O servidor não confirmou o envio.');

        // Só apaga a cópia local DEPOIS da confirmação do servidor. Se cair no meio, o que sobrou continua na fila.
        deleteLocalP2pMessage(currentUserId, conversation.id, pendente.id);
        setP2pMessages((prev) => prev.filter((m) => m.id !== pendente.id));
        enviadas += 1;
      }

      setZeroDbOnly(false);
      toast({
        title: enviadas === 1 ? '1 mensagem enviada' : `${enviadas} mensagens enviadas`,
        description: puladas > 0
          ? `O modo Zero DB foi desligado. ${puladas} ficaram na fila por falta da chave neste aparelho.`
          : 'Foram pelo servidor, protegidas, e o modo Zero DB foi desligado.',
      });
    } catch (e) {
      const motivo = e instanceof Error ? e.message : 'Erro inesperado.';
      toast({
        title: enviadas > 0 ? `${enviadas} enviadas, o resto ficou na fila` : 'Não deu para enviar',
        description: motivo,
        variant: 'destructive',
      });
    } finally {
      setEnviandoFila(false);
    }
  };

  const handleSendMessage = async (data: { text?: string; fileUrl?: string; fileType?: DirectMessage['fileType']; mediaE2ee?: import('@/lib/types').E2eeMessagePayload | null }) => {
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
        // Sem aviso em bolha por mensagem: quem manda sete seguidas levava sete avisos iguais. O estado da fila
        // agora mora na barra acima do compositor, que diz quantas estão esperando e oferece a saída.
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
  
  const handleFileUpload = async (file: File, aoProgredir?: (p: number) => void) => {
    if (!currentUserId) {
      toast({ title: "Login obrigatório", description: "Você deve estar logado para enviar arquivos.", variant: "destructive" });
      throw new Error("Usuário não logado");
    }
    const { uploadFileToStorage, directMessageMediaPathFactory, isLikelyVideoFile } = await import('@/lib/services/mediaUploadService');
    const fileType: DirectMessage['fileType'] = file.type.startsWith('image/') ? 'image'
                   : isLikelyVideoFile(file) ? 'video'
                   : file.type.startsWith('audio/') ? 'audio'
                   : 'file';

    let fileToUpload = file;
    let mediaE2ee = null;
    if (otherUser && !otherUser.id.startsWith('ap_') && (isSelfChat || otherUser.e2eePublicKey)) {
      const { encryptMediaFileForDm } = await import('@/lib/crypto/e2eeMedia');
      const recipientKey = isSelfChat ? (e2eeStatus?.status === 'ready' ? e2eeStatus.publicKeyJson : null) : otherUser.e2eePublicKey;

      // Acima do teto da rota comum, o arquivo vai CIFRADO EM PEDAÇOS por um caminho próprio (até 200 MB). Cifrar
      // tudo de uma vez poria o arquivo duas vezes na memória, e o bloco cifrado — que é opaco — perderia o caminho
      // de vídeo e morreria nos 5 MB da rota comum. Era exatamente por isso que vídeo aqui nunca saía.
      const { avaliarAnexo } = await import('@/lib/messages/anexoPolitica');
      const veredito = avaliarAnexo(file, { cifrada: true });
      if (veredito.ok && veredito.caminho === 'protegido-grande') {
        if (!recipientKey) {
          throw new UserFacingSendError(
            'Este aparelho não tem a chave desta conversa. Restaure o backup em Configurações para enviar arquivos aqui.',
          );
        }
        const { enviarMidiaProtegida, ErroDeMidiaProtegida } = await import('@/lib/services/encryptedMediaService');
        try {
          const envio = await enviarMidiaProtegida({
            arquivo: file,
            remetenteId: currentUserId,
            chavePublicaDoDestinatario: recipientKey,
            aoProgredir: aoProgredir,
          });
          return {
            url: envio.fileUrl,
            type: fileType,
            mediaE2ee: envio.mediaE2ee,
            ...(envio.posterUrl ? { posterUrl: envio.posterUrl } : {}),
          };
        } catch (e) {
          // O motivo vai para a tela como está: "passa de 200 MB", "a conexão caiu", e não um código.
          throw new UserFacingSendError(
            e instanceof ErroDeMidiaProtegida ? e.message : 'Não deu para enviar este arquivo protegido. Tente de novo.',
          );
        }
      }

      const encrypted = await encryptMediaFileForDm(file, currentUserId, recipientKey);
      // NUNCA cair para texto claro em silêncio. Esta conversa é protegida; se a proteção do arquivo falhar e a
      // gente subisse assim mesmo, a foto ficaria legível no servidor enquanto a tela segue mostrando o cadeado.
      // O texto já se recusa a sair sem proteção — o anexo passa a se recusar também, dizendo o motivo.
      if (!encrypted) {
        throw new UserFacingSendError(
          recipientKey
            ? 'Não deu para proteger este arquivo neste aparelho, e aqui nada sai sem proteção. Tente de novo.'
            : 'Este aparelho não tem a chave desta conversa. Restaure o backup em Configurações para enviar arquivos aqui.',
        );
      }
      fileToUpload = encrypted.encryptedFile;
      mediaE2ee = encrypted.mediaE2ee;
    }

    const result = await uploadFileToStorage(currentUserId, fileToUpload, directMessageMediaPathFactory, aoProgredir);
    return { url: result.downloadURL, type: fileType, ...(mediaE2ee ? { mediaE2ee } : {}) };
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

  const conversaCifrada = Boolean(otherUser && !otherUser.id.startsWith('ap_') && (otherUser.e2eePublicKey || otherUser.id === currentUserId));

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
        {/* Conta remota (ap_) não tem E2EE: nada de prometer sigilo onde ele não existe. */}
        <header className="flex min-w-0 items-center p-3 sm:p-4 border-b border-border sticky top-0 bg-background z-10">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/${locale}/messages`)} className="mr-2 min-[800px]:hidden">
            <ArrowLeft className="h-5 w-5" />
            <span className="sr-only">Voltar para Mensagens</span>
          </Button>
          <Link href={`/${locale}/profile/${otherUser.id}`} className="group flex min-w-0 flex-1 items-center space-x-3">
              <Avatar className="h-9 w-9 sm:h-10 sm:w-10">
                <AvatarImage src={otherUser.avatarUrl} alt={otherUser.name || otherUser.username || 'Usuário'} data-ai-hint={otherUser["data-ai-hint"] || "person avatar"}/>
                <AvatarFallback>{(otherUser.name || otherUser.username || 'U').substring(0, 1).toUpperCase()}</AvatarFallback>
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
                        Conectando
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
              variant="outline"
              size="sm"
              onClick={() => setZeroDbOnly((v) => !v)}
              aria-pressed={zeroDbOnly}
              title={zeroDbOnly ? 'Somente P2P (Zero DB): nunca grava mensagens no banco' : 'Ativar modo estrito Zero DB (somente P2P)'}
              className={cn(
                'mr-1 h-7 rounded-full px-2.5 text-[11px] font-medium shrink-0',
                zeroDbOnly
                  ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400'
                  : 'text-muted-foreground'
              )}
            >
              {zeroDbOnly ? <Wifi className="sm:mr-1 h-3 w-3" /> : <WifiOff className="sm:mr-1 h-3 w-3" />}
              <span className="hidden sm:inline">Zero DB</span>
              <span className="sr-only">{zeroDbOnly ? 'Zero DB ligado' : 'Zero DB desligado'}</span>
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
                peerPublicKey={otherUser.e2eePublicKey}
                onDeleteMessage={handleDeleteMessage}
                onReply={handleReply}
              />
            ))}
             {mergedMessages.length === 0 && !isLoading && (
                <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      {conversaCifrada ? <Lock className="h-5 w-5" /> : <Wifi className="h-5 w-5" />}
                    </span>
                    <p className="text-sm font-medium text-foreground">Conversa nova</p>
                    <p className="max-w-[17rem] text-xs text-muted-foreground">
                      {conversaCifrada
                        ? 'Escreva a primeira mensagem. Só vocês dois leem.'
                        : 'Escreva a primeira mensagem. Ela sai daqui pelo Fediverso.'}
                    </p>
                </div>
            )}
          </div>
        </div>

        {filaPendente.length > 0 && (
          <div className="shrink-0 border-t border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
            <div className="flex items-start gap-2.5">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {filaPendente.length === 1
                    ? '1 mensagem ainda não chegou'
                    : `${filaPendente.length} mensagens ainda não chegaram`}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  No modo Zero DB nada fica no servidor: elas esperam @{otherUser.username} abrir o app. Pelo servidor
                  chegam agora, protegidas.
                </p>
                <Button
                  type="button"
                  size="sm"
                  onClick={enviarFilaPeloServidor}
                  disabled={enviandoFila}
                  className="mt-2 h-8 rounded-full text-xs"
                >
                  {enviandoFila && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Mandar pelo servidor
                </Button>
              </div>
            </div>
          </div>
        )}

        <MessageInputArea 
            onSendMessage={handleSendMessage} 
            onFileUpload={handleFileUpload}
            conversaCifrada={conversaCifrada}
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
