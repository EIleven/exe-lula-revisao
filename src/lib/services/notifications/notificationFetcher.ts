// src/lib/services/notifications/notificationFetcher.ts
import { db } from '@/lib/firebase';
import type { Notification, NotificationFilter, NotificationType } from './notificationTypes';
import {
  collection,
  query,
  where,
  orderBy,
  limit as firestoreLimit,
  startAfter,
  getDocs,
  Timestamp,
} from 'firebase/firestore';
import { transformNotificationTimestamps } from './notificationUtils';

export const notificationsCollection = collection(db, 'notifications');

const FILTER_TYPE_MAP: Record<Exclude<NotificationFilter, 'all'>, NotificationType[]> = {
  mentions: ['mention_in_post', 'mention_in_comment'],
  replies: ['comment_on_post', 'reply_to_comment'],
  followers: ['new_follower', 'follow_back'],
  articles: ['new_post_from_user'],
};

export const fetchPaginatedNotifications = async (
  userId: string,
  cursor: Timestamp | null,
  filter: NotificationFilter
): Promise<{
  notifications: Notification[];
  nextCursor: Timestamp | null;
  hasMore: boolean;
}> => {
  const BATCH_SIZE = 15;
  let q = query(
    notificationsCollection,
    where('recipientId', '==', userId)
  );

  if (filter !== 'all') {
    q = query(q, where('type', 'in', FILTER_TYPE_MAP[filter]));
  }
  
  q = query(q, orderBy('createdAt', 'desc'));

  if (cursor) {
    q = query(q, startAfter(cursor));
  }

  q = query(q, firestoreLimit(BATCH_SIZE + 1));

  try {
    const snapshot = await getDocs(q);
    const fetchedNotifications: Notification[] = snapshot.docs.map(doc => 
      transformNotificationTimestamps(doc.data(), doc.id)
    );

    const hasMore = fetchedNotifications.length > BATCH_SIZE;
    if (hasMore) {
      fetchedNotifications.pop();
    }
    
    const nextCursor = fetchedNotifications.length > 0 && hasMore
        ? snapshot.docs[fetchedNotifications.length - 1].data().createdAt as Timestamp
        : null;

    return {
      notifications: fetchedNotifications,
      nextCursor,
      hasMore,
    };

  } catch (error) {
    console.error("Error fetching paginated notifications:", error);
    throw error;
  }
};
