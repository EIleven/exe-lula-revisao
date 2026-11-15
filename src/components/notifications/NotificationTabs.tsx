'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import NotificationList from './NotificationList';
import type { Notification } from '@/lib/types';
import type { NotificationFilter } from '@/lib/services/notifications/notificationTypes';
import React from 'react';
import { cn } from '@/lib/utils';

interface NotificationTabsProps {
  notifications: Notification[];
  activeTab: NotificationFilter;
  setActiveTab: (tab: NotificationFilter) => void;
  onMarkAsRead: (notificationId: string) => void;
  onDismiss: (notificationId: string) => void;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
}

const FILTER_TABS: { value: NotificationFilter; label: string }[] = [
  { value: 'all', label: 'Tudo' },
  { value: 'replies', label: 'Respostas' },
  { value: 'mentions', label: 'Menções' },
  { value: 'followers', label: 'Seguidores' },
  { value: 'articles', label: 'Artigos & Posts' },
];

export function NotificationTabs({
  notifications,
  activeTab,
  setActiveTab,
  onMarkAsRead,
  onDismiss,
  isLoading,
  isLoadingMore,
  hasMore,
}: NotificationTabsProps) {
  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as NotificationFilter)}
      className="w-full"
    >
      <div className="border-b border-border px-2 sm:px-4 overflow-x-auto no-scrollbar">
        <TabsList className={cn("inline-flex w-max min-w-full justify-start gap-1.5 bg-transparent py-2 h-auto")}>
          {FILTER_TABS.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="rounded-full px-3.5 py-1.5 text-xs sm:text-sm font-medium border border-border/60 data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:border-foreground"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {FILTER_TABS.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="m-0">
          <NotificationList
            notifications={notifications}
            onMarkAsRead={onMarkAsRead}
            onDismiss={onDismiss}
            isLoading={isLoading}
            isLoadingMore={isLoadingMore}
            hasMore={hasMore}
            tab={tab.value}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}
