// src/hooks/features/notifications/useUnreadNotificationsCount.ts
'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';

/**
 * Quantas notificações não lidas a pessoa tem (o número da barra de navegação), ao vivo. O layout só precisa deste número:
 * antes ele usava `useNotifications`, que também baixava a primeira página de notificações e abria outro ouvinte só para
 * guardá-las num estado que o layout nunca mostrava (a lista de verdade é a da página de notificações).
 */
export function useUnreadNotificationsCount(userId: string | undefined): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!userId) {
      setCount(0);
      return;
    }
    const unreadQuery = query(
      collection(db, 'notifications'),
      where('recipientId', '==', userId),
      where('readAt', '==', null),
    );
    const unsubscribe = onSnapshot(
      unreadQuery,
      (snapshot) => setCount(snapshot.size),
      (error) => console.error('Erro ao acompanhar as notificações não lidas:', error),
    );
    return () => unsubscribe();
  }, [userId]);

  return count;
}
