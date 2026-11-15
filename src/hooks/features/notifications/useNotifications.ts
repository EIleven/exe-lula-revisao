'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Notification, NotificationFilter } from '@/lib/services/notifications/notificationTypes';
import { fetchPaginatedNotifications } from '@/lib/services/notifications/notificationFetcher';
import {
  markNotificationAsRead,
  markAllNotificationsAsRead,
  dismissNotification as dismissNotificationService,
} from '@/lib/services/notifications/notificationMutator';
import { subscribeToNewNotifications } from '@/lib/services/notifications/notificationSubscriber';
import { query, collection, where, onSnapshot, Timestamp as FirestoreTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface UseNotificationsResult {
  notifications: Notification[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  unreadCount: number;
  markAllAsRead: () => Promise<void>;
  markAsRead: (notificationId: string) => Promise<void>;
  dismissNotification: (notificationId: string) => Promise<void>;
  loadMore: () => void;
}

const matchesFilter = (type: Notification['type'], filter: NotificationFilter): boolean => {
  switch (filter) {
    case 'all':
      return true;
    case 'mentions':
      return type === 'mention_in_post' || type === 'mention_in_comment';
    case 'replies':
      return type === 'comment_on_post' || type === 'reply_to_comment';
    case 'followers':
      return type === 'new_follower' || type === 'follow_back';
    case 'articles':
      return type === 'new_post_from_user';
    default:
      return true;
  }
};

export const useNotifications = (
  userId: string | undefined,
  filter: NotificationFilter
): UseNotificationsResult => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cursorRef = useRef<FirestoreTimestamp | null>(null);
  const isFetchingRef = useRef(false);

  const fetcher = useCallback(
    async (isInitialLoad: boolean) => {
      if (!userId || isFetchingRef.current) return;

      isFetchingRef.current = true;
      if (isInitialLoad) {
        setIsLoading(true);
        cursorRef.current = null;
      } else {
        setIsLoadingMore(true);
      }
      setError(null);

      try {
        const {
          notifications: fetched,
          nextCursor,
          hasMore: newHasMore,
        } = await fetchPaginatedNotifications(
          userId,
          cursorRef.current,
          filter
        );
        const filtered = fetched.filter(
          (n) => n.type !== 'new_message' && n.type !== 'new_conversation'
        );
        setNotifications((prev) =>
          isInitialLoad ? filtered : [...prev, ...filtered]
        );
        cursorRef.current = nextCursor;
        setHasMore(newHasMore);
      } catch (e: any) {
        setError(e.message || 'Failed to load notifications.');
      } finally {
        if (isInitialLoad) setIsLoading(false);
        else setIsLoadingMore(false);
        isFetchingRef.current = false;
      }
    },
    [userId, filter]
  );

  useEffect(() => {
    // Reset and fetch when userId or filter changes
    setNotifications([]);
    setHasMore(true);
    setError(null);
    cursorRef.current = null;
    if (userId) {
      fetcher(true);
    } else {
      setIsLoading(false);
    }
  }, [userId, filter, fetcher]);

  // Real-time listener for NEW notifications, prepends to the list
  useEffect(() => {
    if (!userId) return;

    const unsubscribe = subscribeToNewNotifications(userId, (newNotification) => {
      if (
        newNotification.type === 'new_message' ||
        newNotification.type === 'new_conversation'
      ) {
        return;
      }
      if (matchesFilter(newNotification.type, filter)) {
        setNotifications((prev) =>
          prev.some((n) => n.id === newNotification.id) ? prev : [newNotification, ...prev]
        );
      }
    });

    return () => unsubscribe();
  }, [userId, filter]);

  // Real-time listener for the UNREAD COUNT badge
  useEffect(() => {
    if (!userId) {
      setUnreadCount(0);
      return;
    }
    const q = query(
      collection(db, 'notifications'),
      where('recipientId', '==', userId),
      where('readAt', '==', null)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const count = snapshot.docs.filter((d) => {
        const type = d.data()?.type;
        return type !== 'new_message' && type !== 'new_conversation';
      }).length;
      setUnreadCount(count);
    });
    return () => unsubscribe();
  }, [userId]);

  const loadMore = () => {
    if (hasMore && !isFetchingRef.current) {
      fetcher(false);
    }
  };

  const handleMarkAsRead = async (notificationId: string) => {
    if (!userId) return;
    try {
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notificationId && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n
        )
      );
      await markNotificationAsRead(notificationId);
    } catch (e) {
      console.error('Failed to mark notification as read:', e);
      // Optional: revert optimistic update
    }
  };

  const handleMarkAllAsRead = async () => {
    if (!userId || notifications.every(n => n.readAt)) return;
    try {
      const unreadIds = notifications.filter(n => !n.readAt).map(n => n.id);
      if (unreadIds.length === 0) return;

      // Optimistic update
      setNotifications((prev) =>
        prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() }))
      );
      
      await markAllNotificationsAsRead(userId);
    } catch (e) {
      console.error('Failed to mark all as read:', e);
      // Optional: revert optimistic update
    }
  };

  const handleDismissNotification = async (notificationId: string) => {
    if (!userId) return;
    let removedIndex = -1;
    let removedItem: Notification | undefined;
    setNotifications((prev) => {
      removedIndex = prev.findIndex((n) => n.id === notificationId);
      if (removedIndex === -1) return prev;
      removedItem = prev[removedIndex];
      return prev.filter((n) => n.id !== notificationId);
    });
    try {
      await dismissNotificationService(notificationId);
    } catch (e) {
      console.error('Failed to dismiss notification:', e);
      if (removedItem) {
        const restore = removedItem;
        const idx = removedIndex;
        setNotifications((prev) => {
          if (prev.some((n) => n.id === restore.id)) return prev;
          const next = [...prev];
          next.splice(Math.min(idx, next.length), 0, restore);
          return next;
        });
      }
    }
  };

  return {
    notifications,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    unreadCount,
    markAsRead: handleMarkAsRead,
    dismissNotification: handleDismissNotification,
    markAllAsRead: handleMarkAllAsRead,
    loadMore,
  };
};
