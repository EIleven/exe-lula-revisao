// src/app/[locale]/messages/layout.tsx
'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import MessagesSidebar from '@/components/messages/MessagesSidebar';
import { getCurrentUserId } from '@/lib/services/authService';
import { cn } from '@/lib/utils';

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const otherUserId =
    typeof params?.otherUserId === 'string' ? params.otherUserId : undefined;
  const conversationId =
    typeof params?.conversationId === 'string' ? params.conversationId : undefined;
  const hasActiveChat = Boolean(otherUserId || conversationId);
  const currentUserId = getCurrentUserId();

  if (!currentUserId) {
    return <div className="w-full">{children}</div>;
  }

  return (
    <div
      className={cn(
        'flex w-full min-w-0 overflow-hidden border-x border-border bg-background',
        'h-[calc(100svh-var(--header-height,3rem)-3.5rem)] min-[800px]:h-[calc(100vh-var(--header-height,3.5rem))]'
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
  );
}
