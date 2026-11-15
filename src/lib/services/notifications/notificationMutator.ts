// src/lib/services/notifications/notificationMutator.ts
import { db } from '@/lib/firebase';
import {
  doc,
  updateDoc,
  deleteDoc,
  writeBatch,
  Timestamp,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { notificationsCollection } from './notificationFetcher';

export const markNotificationAsRead = async (notificationId: string): Promise<void> => {
  const notifRef = doc(notificationsCollection, notificationId);
  await updateDoc(notifRef, { readAt: Timestamp.now() });
};

export const dismissNotification = async (notificationId: string): Promise<void> => {
  const notifRef = doc(notificationsCollection, notificationId);
  await deleteDoc(notifRef);
};

export const markAllNotificationsAsRead = async (userId: string): Promise<void> => {
  const q = query(
    notificationsCollection,
    where('recipientId', '==', userId),
    where('readAt', '==', null)
  );

  const snapshot = await getDocs(q);
  if (snapshot.empty) return;

  const batch = writeBatch(db);
  snapshot.docs.forEach(doc => {
    batch.update(doc.ref, { readAt: Timestamp.now() });
  });

  await batch.commit();
};
