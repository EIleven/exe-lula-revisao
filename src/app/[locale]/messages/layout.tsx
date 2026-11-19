// src/app/[locale]/messages/layout.tsx
'use client';

import React, { useEffect } from 'react';
import { useParams } from 'next/navigation';
import MessagesSidebar from '@/components/messages/MessagesSidebar';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { prewarmP2pIceConfig } from '@/lib/p2p/p2pChannel';
import { cn } from '@/lib/utils';
import TravaDeMensagens from '@/components/seguranca/TravaDeMensagens';

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const otherUserId =
    typeof params?.otherUserId === 'string' ? params.otherUserId : undefined;
  const conversationId =
    typeof params?.conversationId === 'string' ? params.conversationId : undefined;
  const hasActiveChat = Boolean(otherUserId || conversationId);
  const { currentUser } = useCurrentUser();
  const currentUserId = currentUser?.id;

  useEffect(() => {
    if (currentUserId) {
      prewarmP2pIceConfig();
    }
  }, [currentUserId]);

  if (!currentUserId) {
    return <div className="w-full">{children}</div>;
  }

  return (
    <TravaDeMensagens>
    <div
      className={cn(
        'flex w-full min-w-0 overflow-hidden border-x border-border bg-background',
        // A conta da altura mora no CSS (.altura-da-conversa em globals.css): quem monta a moldura declara o que ela
        // ocupa, aqui só se desconta. Descontar à mão era o que deixava a faixa vazia embaixo do compositor.
        'altura-da-conversa'
      )}
    >
      <aside
        className={cn(
          'w-full min-[800px]:w-[340px] lg:w-[380px] shrink-0 border-r border-border flex-col bg-background',
          hasActiveChat ? 'hidden min-[800px]:flex' : 'flex'
        )}
      >
        <MessagesSidebar
          activeOtherUserId={otherUserId}
          activeConversationId={conversationId}
        />
      </aside>

      <section
        className={cn(
          'flex-1 min-w-0 flex-col bg-background',
          hasActiveChat ? 'flex' : 'hidden min-[800px]:flex'
        )}
      >
        {children}
      </section>
    </div>
    </TravaDeMensagens>
  );
}
