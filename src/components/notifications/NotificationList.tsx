'use client';

import React, { useMemo } from 'react';
import type { Notification } from '@/lib/types';
import type { NotificationFilter } from '@/lib/services/notifications/notificationTypes';
import { NotificationListItem } from './NotificationListItem';
import { BellOff, Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface NotificationListProps {
  notifications: Notification[];
  onMarkAsRead: (notificationId: string) => void;
  onDismiss: (notificationId: string) => void;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  tab: NotificationFilter;
}

const EMPTY_LABELS: Record<NotificationFilter, string> = {
  all: 'Nenhuma notificação nova',
  replies: 'Nenhuma resposta nova',
  mentions: 'Nenhuma menção nova',
  followers: 'Nenhum novo seguidor por aqui',
  articles: 'Nenhum novo artigo ou publicação recente',
};

function getDateBucket(createdAt: string): 'Hoje' | 'Esta semana' | 'Anteriores' {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return 'Anteriores';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const ts = date.getTime();
  if (ts >= startOfToday) return 'Hoje';
  if (ts >= startOfToday - 6 * 24 * 60 * 60 * 1000) return 'Esta semana';
  return 'Anteriores';
}

export default function NotificationList({
  notifications,
  onMarkAsRead,
  onDismiss,
  isLoading,
  isLoadingMore,
  hasMore,
  tab,
}: NotificationListProps) {
  const grouped = useMemo(() => {
    const groups: { label: string; items: Notification[] }[] = [];
    const indexMap = new Map<string, number>();
    for (const notif of notifications) {
      const bucket = getDateBucket(notif.createdAt as string);
      const idx = indexMap.get(bucket);
      if (idx === undefined) {
        indexMap.set(bucket, groups.length);
        groups.push({ label: bucket, items: [notif] });
      } else {
        groups[idx].items.push(notif);
      }
    }
    return groups;
  }, [notifications]);

  if (isLoading) {
    return (
      <div className="space-y-2 p-2">
        {[...Array(8)].map((_, i) => (
          <div key={`notif-skel-${i}`} className="flex items-center space-x-4 p-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (notifications.length === 0) {
    return (
      <div className="p-8 text-center">
        <BellOff className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
        <p className="text-xl font-semibold text-foreground">
          {EMPTY_LABELS[tab]}
        </p>
        <p className="text-muted-foreground">Você está em dia!</p>
      </div>
    );
  }

  return (
    <div>
      {grouped.map((group) => (
        <div key={group.label}>
          <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-muted/20 border-b border-border/60">
            {group.label}
          </div>
          <div className="divide-y divide-border">
            {group.items.map((notification) => (
              <NotificationListItem
                key={notification.id}
                notification={notification}
                onMarkAsRead={onMarkAsRead}
                onDismiss={onDismiss}
              />
            ))}
          </div>
        </div>
      ))}
      {isLoadingMore && (
         <div className="flex justify-center items-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
         </div>
      )}
      {!hasMore && notifications.length > 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">Você chegou ao fim.</p>
      )}
    </div>
  );
}
