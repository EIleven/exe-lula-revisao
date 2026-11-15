// src/components/system/PushBridge.tsx
'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useLocale } from 'next-intl';
import { Capacitor } from '@capacitor/core';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { syncPushToken } from '@/lib/services/pushNotificationService';
import { ensureUserE2eeKeyPair } from '@/lib/crypto/e2ee';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';

/** Endereço do aviso -> caminho interno do app (só do nosso domínio; qualquer outro destino é ignorado). */
function internalPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/**
 * Liga o push ao app, sem desenhar nada:
 *  1. mantém o token do aparelho em dia a cada sessão (só se a permissão já foi dada);
 *  2. navegador: quando a pessoa toca num aviso e o app já está aberto, o service worker pede para a página navegar
 *     (sem recarregar) e a página confirma;
 *  3. app Android: o toque num aviso (com o app fechado ou aberto) leva ao destino certo.
 */
export default function PushBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const { toast } = useToast();
  const { currentUser } = useCurrentUser();
  const userId = currentUser?.id;

  useEffect(() => {
    if (!userId) return;
    void ensureUserE2eeKeyPair(userId).catch((error) => console.warn('[e2ee] falha ao garantir chave:', String(error)));
    void syncPushToken(userId, locale).catch((error) => console.warn('[push] não foi possível atualizar o token:', String(error)));
  }, [userId, locale]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'exelula:navigate') return;
      const path = internalPath(event.data.url);
      if (!path) return;
      event.ports?.[0]?.postMessage('ack'); // o service worker não precisa mais recarregar a página
      router.push(path);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [router]);

  useEffect(() => {
    if (Capacitor.isNativePlatform() || !userId || typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    void Promise.all([import('firebase/messaging'), import('@/lib/firebase')]).then(
      async ([{ getMessaging, isSupported, onMessage }, { app }]) => {
        if (cancelled || !(await isSupported().catch(() => false))) return;
        const messaging = getMessaging(app);
        const unsub = onMessage(messaging, (payload) => {
          const title = payload.notification?.title || (payload.data?.title as string | undefined) || 'Exe. Lula';
          const body = payload.notification?.body || (payload.data?.body as string | undefined) || '';
          const path = internalPath(payload.data?.url) ?? internalPath(payload.data?.path);
          if (path && pathname === path.split('#')[0]) return;
          toast({
            title,
            description: body || undefined,
            action: path ? (
              <ToastAction altText="Abrir" onClick={() => router.push(path)}>
                Abrir
              </ToastAction>
            ) : undefined,
          });
        });
        if (cancelled) unsub();
        else unsubscribe = unsub;
      },
    ).catch(() => {});

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [userId, pathname, router, toast]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let removeAction: (() => void) | undefined;
    let removeReceived: (() => void) | undefined;
    let cancelled = false;
    void import('@capacitor/push-notifications').then(async ({ PushNotifications }) => {
      const actionHandle = await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const data = action.notification?.data as Record<string, unknown> | undefined;
        const path = internalPath(data?.url) ?? (typeof data?.path === 'string' ? internalPath(data.path) : null);
        router.push(path ?? `/${locale}/notifications`);
      });
      const receivedHandle = await PushNotifications.addListener('pushNotificationReceived', (notification) => {
        const data = notification.data as Record<string, unknown> | undefined;
        const path = internalPath(data?.url) ?? (typeof data?.path === 'string' ? internalPath(data.path) : null);
        if (path && pathname === path.split('#')[0]) return;
        toast({
          title: notification.title || 'Exe. Lula',
          description: notification.body || undefined,
          action: path ? (
            <ToastAction altText="Abrir" onClick={() => router.push(path)}>
              Abrir
            </ToastAction>
          ) : undefined,
        });
      });
      if (cancelled) {
        void actionHandle.remove();
        void receivedHandle.remove();
      } else {
        removeAction = () => void actionHandle.remove();
        removeReceived = () => void receivedHandle.remove();
      }
    });
    return () => {
      cancelled = true;
      removeAction?.();
      removeReceived?.();
    };
  }, [router, locale, pathname, toast]);

  return null;
}
