'use client';

import React, { useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useNotifications } from '@/hooks/features/notifications/useNotifications';
import { NotificationTabs } from '@/components/notifications/NotificationTabs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, Lock, Settings } from 'lucide-react';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import PushPrompt from '@/components/notifications/PushPrompt';
import type { NotificationFilter } from '@/lib/services/notifications/notificationTypes';
import { useLocale } from 'next-intl';

export default function NotificationsPage() {
  const [activeTab, setActiveTab] = useState<NotificationFilter>('all');
  const locale = useLocale();
  const { currentUser, isLoading: isLoadingUser } = useCurrentUser();
  const {
    notifications,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    markAllAsRead,
    markAsRead,
    dismissNotification,
    loadMore,
  } = useNotifications(currentUser?.id, activeTab);

  const observer = useRef<IntersectionObserver>();
  const lastElementRef = useCallback((node: HTMLDivElement | null) => {
    if (isLoading || isLoadingMore) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        loadMore();
      }
    });
    if (node) observer.current.observe(node);
  }, [isLoading, isLoadingMore, hasMore, loadMore]);
  
  const [isMarkingAll, setIsMarkingAll] = useState(false);

  const handleMarkAll = async () => {
    setIsMarkingAll(true);
    await markAllAsRead();
    setIsMarkingAll(false);
  }

  if (isLoadingUser) {
    return (
       <div className="space-y-4 container mx-auto max-w-3xl py-8">
          <div className="flex justify-between items-center mb-4">
             <Skeleton className="h-8 w-48" />
             <Skeleton className="h-9 w-32" />
          </div>
          <Skeleton className="h-10 w-full" />
          <div className="space-y-2 pt-4">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        </div>
    )
  }

  if (!currentUser) {
    return (
      <div className="container mx-auto max-w-xl py-8 px-4">
        <Card className="shadow-lg rounded-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl font-bold">
              <Lock className="h-5 w-5 text-primary" />
              Notificações
            </CardTitle>
            <CardDescription>
              Entre na sua conta para acompanhar suas notificações.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href={`/${locale}/login?redirect=/${locale}/notifications`}>Entrar</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/${locale}`}>Voltar ao Feed</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-3xl py-8">
      <div className="flex justify-between items-center mb-2 gap-2 px-2 sm:px-0">
        <h1 className="text-xl font-bold ml-2 sm:ml-4">Notificações</h1>
        <div className="flex items-center gap-2">
          <Button onClick={handleMarkAll} variant="outline" size="sm" className="border" disabled={isMarkingAll}>
             {isMarkingAll ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Marcar todas como lidas
          </Button>
          <Button variant="ghost" size="icon" asChild title="Configurações de notificação">
            <Link href={`/${locale}/settings/notifications`} aria-label="Configurações de notificação">
              <Settings className="h-5 w-5" />
            </Link>
          </Button>
        </div>
      </div>
      
      {currentUser?.id && <PushPrompt userId={currentUser.id} />}

      {error && <p className="text-destructive text-center mb-4">{error}</p>}

      <NotificationTabs
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        notifications={notifications}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        onMarkAsRead={markAsRead}
        onDismiss={dismissNotification}
      />
      {/* Sentinel for infinite scroll */}
      <div ref={lastElementRef} style={{ height: '1px' }} />
    </div>
  );
}
