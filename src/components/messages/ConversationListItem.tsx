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
import { Check, Pin, Users, X } from 'lucide-react';
import { useLocale } from 'next-intl';
import { useUserPresence } from '@/hooks/use-user-presence';

interface ConversationListItemProps {
  conversation: Conversation;
  isActive?: boolean;
  isRequest?: boolean;
  onAccept?: () => void;
  onDecline?: () => void;
  /**
   * Fixar/desafixar. Só o HiperChat passa isto — sem a função, nenhum botão aparece e o item fica igual ao do HiperVerso.
   */
  onTogglePin?: () => void;
  isPinned?: boolean;
  /** Mostrar o trecho da última mensagem. Desligado pela pessoa em Configurações (só no HiperChat). */
  showPreview?: boolean;
}

export default function ConversationListItem({
  conversation,
  isActive = false,
  isRequest = false,
  onAccept,
  onDecline,
  onTogglePin,
  isPinned = false,
  showPreview = true,
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

  const safeOtherName = otherParticipant?.name || otherParticipant?.username || 'Usuário';
  const safeOtherUsername = otherParticipant?.username || 'usuario';

  const title = isGroup
    ? conversation.groupName || 'Grupo'
    : isSelf
    ? 'Mensagens Salvas'
    : safeOtherName;

  const subtitle = isGroup
    ? `${conversation.participantIds.length} participantes`
    : isSelf
    ? 'Suas anotações privadas'
    : `@${safeOtherUsername}`;

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

  let formattedTime = '';
  if (conversation.lastMessage?.createdAt) {
    const parsedDate = new Date(conversation.lastMessage.createdAt);
    if (Number.isFinite(parsedDate.getTime())) {
      try {
        formattedTime = formatDistanceToNowStrict(parsedDate, {
          addSuffix: false,
          locale: locale === 'pt-BR' ? ptBR : enUS,
        });
      } catch {
        formattedTime = '';
      }
    }
  }
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
      <div className="flex items-stretch">
        <Link href={href} className="block min-w-0 flex-1">
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
                      src={otherParticipant?.avatarUrl}
                      alt={safeOtherName}
                      data-ai-hint={otherParticipant?.['data-ai-hint'] || 'person avatar'}
                    />
                    <AvatarFallback>{safeOtherName.substring(0, 1).toUpperCase()}</AvatarFallback>
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
                {showPreview ? (
                  <p
                    className={cn(
                      'hv-escala text-sm truncate min-w-0 flex-1',
                      unreadCount > 0 ? 'text-foreground font-medium' : 'text-muted-foreground',
                      !conversation.lastMessage && 'italic'
                    )}
                  >
                    {lastMessagePrefix}
                    {lastMessageText}
                  </p>
                ) : (
                  <span className="min-w-0 flex-1" />
                )}
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
        {onTogglePin && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onTogglePin();
            }}
            aria-pressed={isPinned}
            title={isPinned ? 'Desafixar conversa' : 'Fixar no topo'}
            aria-label={isPinned ? `Desafixar ${title}` : `Fixar ${title} no topo`}
            className={cn(
              'flex w-11 shrink-0 items-center justify-center transition-colors',
              isPinned
                ? 'text-primary hover:text-primary/70'
                : 'text-muted-foreground/40 hover:text-foreground',
            )}
          >
            <Pin className={cn('h-4 w-4', isPinned && 'fill-current')} />
          </button>
        )}
      </div>
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
