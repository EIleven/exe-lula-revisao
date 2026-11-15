// src/hooks/use-user-presence.ts
'use client';

import { useEffect, useState } from 'react';
import { getDatabase, onValue, ref } from 'firebase/database';

/**
 * Se a pessoa está online agora, em tempo real: tem ao menos uma conexão em /status/{uid}/connections (Realtime
 * Database, a única fonte de presença; leitura só para quem está logado). Antes o ponto verde lia um campo do Firestore
 * que nunca era gravado e por isso nunca aparecia.
 */
export function useUserPresence(userId: string | null | undefined): boolean {
  const [isOnline, setIsOnline] = useState(false);

  useEffect(() => {
    if (!userId) {
      setIsOnline(false);
      return;
    }
    const stop = onValue(
      ref(getDatabase(), `status/${userId}/connections`),
      (snapshot) => setIsOnline(snapshot.exists()),
      () => setIsOnline(false),
    );
    return () => stop();
  }, [userId]);

  return isOnline;
}
