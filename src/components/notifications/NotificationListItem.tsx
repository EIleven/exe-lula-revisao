'use client';

import React, { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import type { Notification } from '@/lib/types';
import { timeAgo } from '@/lib/utils/time';
import { cn } from '@/lib/utils';
import { Heart, Repeat2, MessageCircle, UserPlus, AtSign, FilePenLine, Send, Sparkles, Bell, X, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

interface NotificationListItemProps {
  notification: Notification;
  onMarkAsRead: (notificationId: string) => void;
  onDismiss?: (notificationId: string) => void;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

const getNotificationIcon = (type: Notification['type']) => {
  switch (type) {
    case 'like_post':
    case 'like_repost':
    case 'like_comment':
      return <Heart className="h-5 w-5 text-pink-500 fill-current" />;
    case 'repost':
    case 'repost_repost':
    case 'quote':
      return <Repeat2 className="h-5 w-5 text-green-500" />;
    case 'comment_on_post':
    case 'reply_to_comment':
      return <MessageCircle className="h-5 w-5 text-blue-500" />;
    case 'new_follower':
    case 'follow_back':
      return <UserPlus className="h-5 w-5 text-primary" />;
    case 'mention_in_post':
    case 'mention_in_comment':
      return <AtSign className="h-5 w-5 text-purple-500" />;
    case 'new_post_from_user':
      return <FilePenLine className="h-5 w-5 text-sky-500" />;
    case 'new_message':
    case 'new_conversation':
      return <Send className="h-5 w-5 text-indigo-500" />;
    case 'welcome':
      return <Sparkles className="h-5 w-5 text-yellow-400" />;
    default:
      return <Bell className="h-5 w-5 text-muted-foreground" />;
  }
};

/**
 * Para onde o toque leva. É o mesmo destino do aviso (push) que o servidor monta em functions/src/push.ts: quem toca no
 * aviso do celular e quem toca na lista chegam ao mesmo lugar.
 */
const getNotificationLink = (notification: Notification, locale: string): string => {
  const { type, entityId, entityParentId, entityType, newPostId, actors, recipientId } = notification;

  const buildUrl = (path: string) => `/${locale}${path}`;
  // Reposts, curtidas e respostas de COMENTÁRIO guardam o id do comentário em entityId e o do post em entityParentId:
  // abrir /post/{id do comentário} cairia numa página que não existe.
  const commentUrl = entityType === 'comment' && entityParentId && entityId
    ? buildUrl(`/post/${entityParentId}#comment-${entityId}`)
    : null;

  switch (type) {
    case 'like_post':
    case 'like_repost':
    case 'comment_on_post':
    case 'new_post_from_user':
    case 'mention_in_post':
      return entityId ? buildUrl(`/post/${entityId}`) : buildUrl('/');
    case 'repost':
    case 'repost_repost':
      return commentUrl ?? (entityId ? buildUrl(`/post/${entityId}`) : buildUrl('/'));
    case 'quote':
      // Abre a CITAÇÃO (o que a pessoa escreveu); documentos antigos sem ela caem no original.
      return newPostId ? buildUrl(`/post/${newPostId}`) : (commentUrl ?? (entityId ? buildUrl(`/post/${entityId}`) : buildUrl('/')));
    case 'like_comment':
    case 'reply_to_comment':
    case 'mention_in_comment':
      return commentUrl ?? (entityId ? buildUrl(`/post/${entityId}`) : buildUrl('/'));
    case 'new_follower':
    case 'follow_back':
      return actors[0]?.userId ? buildUrl(`/profile/${actors[0].userId}`) : buildUrl('/');
    case 'new_message':
    case 'new_conversation':
      return actors[0]?.userId ? buildUrl(`/messages/user/${actors[0].userId}`) : buildUrl('/messages');
    case 'welcome':
      return buildUrl(`/profile/${recipientId}`);
    default:
      return buildUrl('/');
  }
};

/** Verbo da ação ("curtiu sua publicação"...), já no idioma da pessoa. */
const getActionText = (notification: Notification, t: Translate): string => {
  const { type, entityType } = notification;
  const isComment = entityType === 'comment';
  switch (type) {
    case 'repost': return t(isComment ? 'actions.repostComment' : 'actions.repost');
    case 'quote': return t(isComment ? 'actions.quoteComment' : 'actions.quote');
    case 'like_post':
    case 'like_repost':
    case 'like_comment':
    case 'repost_repost':
    case 'comment_on_post':
    case 'reply_to_comment':
    case 'new_follower':
    case 'follow_back':
    case 'mention_in_post':
    case 'mention_in_comment':
    case 'new_post_from_user':
    case 'new_message':
    case 'new_conversation':
      return t(`actions.${type}`);
    default:
      return t('actions.default');
  }
};

const getNotificationText = (notification: Notification, t: Translate): React.ReactNode => {
  const { type, actors, count, previewText } = notification;

  if (!actors || actors.length === 0) {
    return t('fallback');
  }

  if (type === 'welcome') {
    return <>{previewText || t('welcome')}</>;
  }

  const firstActorName = <strong className="text-foreground">{actors[0].name || t('someone')}</strong>;
  const remainingCount = count - 1;
  // Nova conversa é só um aviso de que a pessoa abriu o chat: não há texto para mostrar entre aspas.
  const showPreview = previewText && type !== 'new_conversation';

  return (
    <>
      {firstActorName}
      {remainingCount > 1 && ` ${t('andOthers', { count: remainingCount })}`}
      {remainingCount === 1 && ` ${t('andOne')}`}
      {` `}{getActionText(notification, t)}
      {showPreview && <span className="text-muted-foreground ml-1 italic">"{previewText}"</span>}
    </>
  );
};

export function NotificationListItem({ notification, onMarkAsRead, onDismiss }: NotificationListItemProps) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('NotificationItem');
  const { id, actors, readAt, createdAt } = notification;

  const [dragOffsetX, setDragOffsetX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const isHorizontalSwipeRef = useRef<boolean | null>(null);
  const didSwipeRef = useRef(false);

  if (!actors || actors.length === 0) return null;

  const link = getNotificationLink(notification, locale);
  const text = getNotificationText(notification, t);
  const icon = getNotificationIcon(notification.type);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!onDismiss || e.touches.length !== 1) return;
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    isHorizontalSwipeRef.current = null;
    didSwipeRef.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!onDismiss || !touchStartRef.current || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - touchStartRef.current.x;
    const dy = e.touches[0].clientY - touchStartRef.current.y;

    if (isHorizontalSwipeRef.current === null) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        isHorizontalSwipeRef.current = Math.abs(dx) > Math.abs(dy);
      }
    }

    if (isHorizontalSwipeRef.current) {
      didSwipeRef.current = true;
      setIsSwiping(true);
      setDragOffsetX(dx);
    }
  };

  const handleTouchEnd = () => {
    if (!onDismiss || !touchStartRef.current) return;
    const threshold = 90;
    if (isHorizontalSwipeRef.current && Math.abs(dragOffsetX) >= threshold) {
      const direction = dragOffsetX > 0 ? 1 : -1;
      setIsSwiping(false);
      setDragOffsetX(direction * 360);
      setTimeout(() => {
        onDismiss(id);
      }, 150);
    } else {
      setIsSwiping(false);
      setDragOffsetX(0);
    }
    touchStartRef.current = null;
    isHorizontalSwipeRef.current = null;
  };

  const handleItemClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (didSwipeRef.current) {
      didSwipeRef.current = false;
      return;
    }
    const target = e.target as HTMLElement;

    // Do not navigate if an interactive element (like the avatar's link or dismiss button) was clicked
    if (target.closest('a') || target.closest('button')) {
      return;
    }

    onMarkAsRead(id);
    router.push(link);
  };

  const handleDismissClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    onDismiss?.(id);
  };

  return (
    <div className="relative overflow-hidden group">
      {onDismiss && Math.abs(dragOffsetX) > 4 && (
        <div
          className={cn(
            "absolute inset-0 flex items-center px-6 bg-destructive/90 text-destructive-foreground pointer-events-none",
            dragOffsetX > 0 ? "justify-start" : "justify-end"
          )}
          aria-hidden="true"
        >
          <div className="flex items-center gap-2 text-xs font-medium">
            <Trash2 className="h-4 w-4" />
            <span>Descartar</span>
          </div>
        </div>
      )}
      <div
        className={cn(
          "relative block w-full cursor-pointer touch-pan-y bg-background",
          !isSwiping && "transition-transform duration-200 ease-out"
        )}
        style={{
          transform: dragOffsetX !== 0 ? `translateX(${dragOffsetX}px)` : undefined,
          opacity: Math.abs(dragOffsetX) > 120 ? Math.max(0.25, 1 - Math.abs(dragOffsetX) / 360) : 1,
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onClick={handleItemClick}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleItemClick(e as any)}
        role="link"
        tabIndex={0}
        data-testid="notification-item"
        data-notification-type={notification.type}
        aria-label={t('aria', { text: notification.previewText || t('ariaFallback') })}
      >
        <div className={cn("p-4 flex items-start space-x-3 sm:space-x-4 w-full hover:bg-muted/50 transition-colors", !readAt && "bg-primary/5")}>
          <div className="relative mt-1 shrink-0">
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2 mb-1">
               <div className="flex -space-x-3">
                   {actors.slice(0, 2).map(actor => (
                       <Link
                         key={actor.userId}
                         href={actor.userId === 'soberan_system' ? `/${locale}/about` : `/${locale}/profile/${actor.userId}`}
                         onClick={(e) => {
                           e.stopPropagation(); // Prevent the div's onClick from firing
                           onMarkAsRead(id);   // Also mark as read when clicking the avatar
                         }}
                       >
                          <Avatar className="h-8 w-8 border-2 border-background">
                              <AvatarImage src={actor.avatarUrl} alt={actor.username} />
                              <AvatarFallback>{actor.name?.[0]}</AvatarFallback>
                          </Avatar>
                      </Link>
                   ))}
               </div>
            </div>
            <p className="text-sm text-muted-foreground break-words">{text}</p>
            <p className="text-xs text-muted-foreground/70 mt-1">{timeAgo(createdAt as string)}</p>
          </div>
          <div className="flex items-center gap-2 self-center shrink-0">
            {!readAt && (
               <div className="w-2.5 h-2.5 bg-primary rounded-full" title={t('unread')}></div>
            )}
            {onDismiss && (
              <button
                type="button"
                onClick={handleDismissClick}
                title="Descartar notificação"
                aria-label="Descartar notificação"
                className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-opacity md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
