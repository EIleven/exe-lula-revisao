// src/components/messages/ConversationListItem.tsx
'use client';

import type { Conversation } from '@/lib/types';
import Link from 'next/link';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { formatDistanceToNowStrict } from 'date-fns';
import { ptBR, enUS } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { getCurrentUserId } from '@/lib/services/authService';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Check, Users, X } from 'lucide-react';
import { useLocale } from 'next-intl';
import { useUserPresence } from '@/hooks/use-user-presence';

interface ConversationListItemProps {
  conversation: Conversation;
  isActive?: boolean;
  isRequest?: boolean;
  onAccept?: () => void;
  onDecline?: () => void;
}

export default function ConversationListItem({
  conversation,
  isActive = false,
  isRequest = false,
  onAccept,
  onDecline,
}: ConversationListItemProps) {
  const currentUserId = getCurrentUserId();
  const locale = useLocale();
  const isGroup = Boolean(conversation.isGroup);
  const isSelf =
    Boolean(conversation.isSelf) ||
    (!isGroup &&
      conversation.participantIds.length === 1 &&
      conversation.participantIds[0] === currentUserId);
  const otherParticipant = isGroup
    ? undefined
    : isSelf
    ? conversation.participantsInfo.find((p) => p.id === currentUserId) || conversation.participantsInfo[0]
    : conversation.participantsInfo.find((p) => p.id !== currentUserId);
  const unreadCount = conversation.unreadCounts?.[currentUserId || ''] || 0;
  const isOtherOnline = useUserPresence(isSelf ? undefined : otherParticipant?.id);

  if (!isGroup && !otherParticipant) {
    return null;
  }

  const href = isGroup
    ? `/${locale}/messages/group/${conversation.id}`
    : `/${locale}/messages/user/${otherParticipant!.id}`;

  const title = isGroup
    ? conversation.groupName || 'Grupo'
    : isSelf
    ? 'Mensagens Salvas'
    : otherParticipant!.name;

  const subtitle = isGroup
    ? `${conversation.participantIds.length} participantes`
    : isSelf
    ? 'Suas anotações privadas'
    : `@${otherParticipant!.username}`;

  const lastMessageText = conversation.lastMessage?.text
    ? conversation.lastMessage.text
    : conversation.lastMessage?.e2ee
    ? '🔒 Mensagem criptografada'
    : 'Sem mensagens ainda.';

  const lastMessageSender =
    conversation.lastMessage?.senderId === currentUserId
      ? 'Você'
      : isGroup
      ? conversation.lastMessage?.sender?.name?.split(' ')[0]
      : undefined;

  const lastMessagePrefix =
    lastMessageSender && conversation.lastMessage?.text ? `${lastMessageSender}: ` : '';

  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

  const formattedTime = conversation.lastMessage
    ? formatDistanceToNowStrict(new Date(conversation.lastMessage.createdAt), {
        addSuffix: false,
        locale: locale === 'pt-BR' ? ptBR : enUS,
      })
    : '';
  const timeAgo = formattedTime
    .replace(' minutos', 'min')
    .replace(' minuto', 'min')
    .replace(' horas', 'h')
    .replace(' hora', 'h')
    .replace(' segundos', 's')
    .replace(' segundo', 's')
    .replace(' dias', 'd')
    .replace(' dia', 'd');

  return (
    <div
      className={cn(
        'border-b border-border/80 last:border-b-0 transition-colors',
        isActive
          ? 'bg-primary/10 border-l-2 border-l-primary'
          : 'hover:bg-muted/40'
      )}
    >
      <Link href={href} className="block">
        <div className="flex items-start gap-3 px-4 py-3.5">
          <div className="relative shrink-0">
            {isGroup ? (
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/30">
                <Users className="h-5 w-5" />
              </div>
            ) : (
              <>
                <Avatar className="h-11 w-11">
                  <AvatarImage
                    src={otherParticipant!.avatarUrl}
                    alt={otherParticipant!.name}
                    data-ai-hint={otherParticipant!['data-ai-hint'] || 'person avatar'}
                  />
                  <AvatarFallback>{otherParticipant!.name.substring(0, 1)}</AvatarFallback>
                </Avatar>
                {isOtherOnline && (
                  <span
                    className="absolute bottom-0 right-0 block h-3 w-3 rounded-full bg-green-500 ring-2 ring-background"
                    title="Online"
                  />
                )}
              </>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-baseline gap-1.5 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{title}</p>
                <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
              </div>
              {conversation.lastMessage && (
                <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">
                  {timeAgo}
                </span>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 mt-1">
              <p
                className={cn(
                  'text-sm truncate min-w-0 flex-1',
                  unreadCount > 0 ? 'text-foreground font-medium' : 'text-muted-foreground',
                  !conversation.lastMessage && 'italic'
                )}
              >
                {lastMessagePrefix}
                {lastMessageText}
              </p>
              {unreadCount > 0 && (
                <Badge
                  variant="default"
                  className="h-5 min-w-[1.25rem] px-1.5 text-[11px] rounded-full shrink-0"
                >
                  {unreadCount > 9 ? '9+' : unreadCount}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </Link>
      {isRequest && (
        <div className="flex justify-end gap-2 px-4 pb-3 pt-0" onClick={stopPropagation}>
          <Button variant="outline" size="sm" onClick={onDecline} className="h-8 rounded-full">
            <X className="h-3.5 w-3.5 mr-1" />
            Recusar
          </Button>
          <Button size="sm" onClick={onAccept} className="h-8 rounded-full">
            <Check className="h-3.5 w-3.5 mr-1" />
            Aceitar
          </Button>
        </div>
      )}
    </div>
  );
}
