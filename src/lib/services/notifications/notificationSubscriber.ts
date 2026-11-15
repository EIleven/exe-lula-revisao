// src/lib/services/notifications/notificationSubscriber.ts
import {
  query,
  where,
  Timestamp,
  onSnapshot,
} from 'firebase/firestore';
import type { Notification } from './notificationTypes';
import { notificationsCollection } from './notificationFetcher';
import { deepCopyNotification, transformNotificationTimestamps } from './notificationUtils';

export const subscribeToNewNotifications = (
  userId: string,
  callback: (notification: Notification) => void
): (() => void) => {
  const q = query(
    notificationsCollection,
    where('recipientId', '==', userId),
    where('createdAt', '>', Timestamp.now()) // Only listen for new ones
  );

  const unsubscribe = onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const notification = transformNotificationTimestamps(change.doc.data(), change.doc.id);
        callback(deepCopyNotification(notification)!);
      }
    });
  });

  return unsubscribe;
};
