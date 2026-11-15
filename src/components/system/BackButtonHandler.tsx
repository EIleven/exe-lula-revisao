// src/components/system/BackButtonHandler.tsx
'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Capacitor } from '@capacitor/core';
import { handleBack, recordRouteVisit } from '@/lib/backNavigation';

/** Evento que roda o mesmo "voltar" no navegador (o computador e os testes não têm o botão do Android). */
export const HARDWARE_BACK_EVENT = 'exelula:hardware-back';

/**
 * Liga o botão/gesto de voltar do Android ao app, sem desenhar nada (veja src/lib/backNavigation.ts): o primeiro "voltar"
 * fecha o diálogo, a folha ou o menu aberto; depois volta no histórico; na primeira tela o app vai para segundo plano.
 */
export default function BackButtonHandler() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    const search = typeof window !== 'undefined' ? window.location.search : '';
    recordRouteVisit(`${pathname}${search}`);
  }, [pathname]);

  useEffect(() => {
    const onDomBack = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string }>).detail;
      const action = handleBack(window.history.length > 1);
      if (detail && typeof detail === 'object') detail.action = action;
    };
    window.addEventListener(HARDWARE_BACK_EVENT, onDomBack);

    let removeNative: (() => void) | undefined;
    let cancelled = false;
    if (Capacitor.isNativePlatform()) {
      void import('@capacitor/app').then(async ({ App }) => {
        const handle = await App.addListener('backButton', ({ canGoBack }) => {
          // Com um ouvinte registrado o Capacitor deixa de voltar sozinho: aqui se faz tudo.
          if (handleBack(canGoBack) === 'root') void App.minimizeApp();
        });
        if (cancelled) void handle.remove(); else removeNative = () => void handle.remove();
      }).catch(() => undefined); // APK antigo, sem o plugin: segue o comportamento padrão do Capacitor
    }

    return () => {
      cancelled = true;
      window.removeEventListener(HARDWARE_BACK_EVENT, onDomBack);
      removeNative?.();
    };
  }, []);

  return null;
}
