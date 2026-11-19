'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'hv_app_mode';

function readInitialHiperChatFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('app') === 'hiperchat') {
      window.sessionStorage.setItem(STORAGE_KEY, 'hiperchat');
      return true;
    }
    return window.sessionStorage.getItem(STORAGE_KEY) === 'hiperchat';
  } catch {
    return false;
  }
}

export function useHiperChatMode(): boolean {
  const [isHiperChat, setIsHiperChat] = useState<boolean>(readInitialHiperChatFlag);

  useEffect(() => {
    if (readInitialHiperChatFlag()) {
      setIsHiperChat(true);
      return;
    }

    let cancelled = false;
    import('@capacitor/app')
      .then(({ App }) => App.getInfo())
      .then((info) => {
        if (cancelled) return;
        if (info?.id === 'app.hiperverso.chat') {
          try {
            window.sessionStorage.setItem(STORAGE_KEY, 'hiperchat');
          } catch {
            // ignore storage errors
          }
          setIsHiperChat(true);
        }
      })
      .catch(() => {
        // running in regular browser or non-Capacitor context
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return isHiperChat;
}
