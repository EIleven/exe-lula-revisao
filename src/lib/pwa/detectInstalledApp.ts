// src/lib/pwa/detectInstalledApp.ts
// Detecção local e anônima (W3C getInstalledRelatedApps + display-mode) para saber se o app já está instalado
// no dispositivo sem enviar identificadores ou dados do usuário ao servidor.
'use client';

import { isNativeApp } from '@/lib/nativeApp';

interface RelatedAppEntry {
  id?: string;
  platform?: string;
  url?: string;
}

type NavigatorWithRelatedApps = Navigator & {
  getInstalledRelatedApps?: () => Promise<RelatedAppEntry[]>;
};

export async function isAppAlreadyInstalled(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (isNativeApp()) return true;

  if (window.matchMedia('(display-mode: standalone)').matches) {
    return true;
  }

  const nav = navigator as NavigatorWithRelatedApps;
  if (typeof nav.getInstalledRelatedApps === 'function') {
    try {
      const related = await nav.getInstalledRelatedApps();
      if (Array.isArray(related) && related.length > 0) {
        return true;
      }
    } catch {
      // Alguns navegadores ou WebViews restringem getInstalledRelatedApps; falha silenciosa.
    }
  }

  return false;
}
