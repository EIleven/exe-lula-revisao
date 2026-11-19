// src/components/messages/GlobalP2pListener.tsx
'use client';

import React, { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { onChildAdded, onChildChanged, ref, remove } from 'firebase/database';
import type { User } from '@/lib/types';
import { getRtdb } from '@/lib/rtdbClient';
import { getUser } from '@/lib/services/userService';
import { createP2pSession, type P2pSessionController } from '@/lib/p2p/p2pChannel';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { haptics } from '@/lib/haptics';

interface P2pInboxKnock {
  conversationId?: string;
  fromId?: string;
  fromName?: string;
  fromUsername?: string;
  msgId?: string;
}

export default function GlobalP2pListener({ currentUser }: { currentUser: User | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const locale = useLocale();
  const { toast } = useToast();

  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const sessionsRef = useRef<Map<string, { controller: P2pSessionController; timer: number }>>(new Map());
  const notifiedMsgIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const uid = currentUser?.id;
    if (!uid) return;
    const db = getRtdb();
    if (!db) return;

    const inboxRef = ref(db, `p2pInbox/${uid}`);

    const handleKnock = async (raw: unknown, key: string | null) => {
      if (!raw || typeof raw !== 'object') return;
      const knock = raw as P2pInboxKnock;
      const fromId = typeof knock.fromId === 'string' ? knock.fromId : key;
      const conversationId = typeof knock.conversationId === 'string' ? knock.conversationId : '';
      if (!fromId || !conversationId || fromId === uid) return;

      // Limpa o aviso da caixa efêmera assim que lido.
      void remove(ref(db, `p2pInbox/${uid}/${fromId}`)).catch(() => {});

      const alreadyInChat = pathnameRef.current?.includes(`/messages/user/${fromId}`);
      if (alreadyInChat) return;

      try {
        const otherUser = await getUser(fromId, uid, { fresh: true });
        if (!otherUser) return;

        const dedupKey = knock.msgId || `${fromId}:${conversationId}`;
        const shouldNotifyKnock = !notifiedMsgIdsRef.current.has(dedupKey);
        if (shouldNotifyKnock) {
          notifiedMsgIdsRef.current.add(dedupKey);
          haptics.select();
          const senderLabel = otherUser.username ? `@${otherUser.username}` : otherUser.name || 'Contato';
          toast({
            title: `⚡ Mensagem P2P de ${senderLabel}`,
            description:
              'Padrão P2P (Zero DB): enviada direto entre dispositivos sem passar pelo servidor. Toque para abrir.',
            action: (
              <ToastAction
                altText="Abrir conversa P2P"
                onClick={() => router.push(`/${locale}/messages/user/${fromId}`)}
              >
                Abrir chat
              </ToastAction>
            ),
          });
        }

        // Abre sessão P2P em segundo plano para já receber e salvar a mensagem no aparelho mesmo fora da aba Mensagens.
        if (sessionsRef.current.has(conversationId)) return;
        const controller = createP2pSession({
          conversationId,
          currentUserId: uid,
          currentUser,
          otherUser,
          onStateChange: () => {},
          onMessage: (msg) => {
            if (notifiedMsgIdsRef.current.has(msg.id)) return;
            notifiedMsgIdsRef.current.add(msg.id);
            if (!pathnameRef.current?.includes(`/messages/user/${fromId}`)) {
              haptics.select();
              toast({
                title: `⚡ Nova mensagem P2P de @${otherUser.username}`,
                description:
                  'Recebida direto no seu aparelho via P2P (Zero DB). Suas mensagens ficam salvas localmente.',
                action: (
                  <ToastAction
                    altText="Abrir conversa P2P"
                    onClick={() => router.push(`/${locale}/messages/user/${fromId}`)}
                  >
                    Abrir chat
                  </ToastAction>
                ),
              });
            }
          },
        });
        const timer = window.setTimeout(() => {
          const entry = sessionsRef.current.get(conversationId);
          if (entry) {
            entry.controller.destroy();
            sessionsRef.current.delete(conversationId);
          }
        }, 45_000);
        sessionsRef.current.set(conversationId, { controller, timer });
      } catch {
        // Silencioso: usuário ainda pode abrir o chat pelo toast
      }
    };

    const unsubAdd = onChildAdded(inboxRef, (snap) => {
      void handleKnock(snap.val(), snap.key);
    });
    const unsubChange = onChildChanged(inboxRef, (snap) => {
      void handleKnock(snap.val(), snap.key);
    });

    const activeSessions = sessionsRef.current;
    return () => {
      unsubAdd();
      unsubChange();
      activeSessions.forEach(({ controller, timer }) => {
        window.clearTimeout(timer);
        controller.destroy();
      });
      activeSessions.clear();
    };
  }, [currentUser, locale, router, toast]);

  return null;
}

