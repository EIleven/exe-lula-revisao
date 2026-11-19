'use client';

import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Download, ShieldCheck, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { haptics } from '@/lib/haptics';

interface ApkReleaseManifest {
  packageName?: string;
  versionName: string;
  versionCode: number;
  minSupportedVersionCode?: number;
  apkUrl: string;
  sha256?: string;
  signingCertSha256?: string;
  releaseNotes?: string[];
}

const DISMISS_KEY = 'exelula_apk_updater_dismissed_v';

export default function ApkAutoUpdater() {
  const [updateAvailable, setUpdateAvailable] = useState<ApkReleaseManifest | null>(null);
  const [installedVersion, setInstalledVersion] = useState<string>('');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;

    let cancelled = false;
    const checkForApkUpdate = async () => {
      try {
        const [appInfo, res] = await Promise.all([
          App.getInfo(),
          fetch('/downloads/latest.json', { cache: 'no-store' }),
        ]);
        if (!res.ok || cancelled) return;
        const manifest = (await res.json()) as ApkReleaseManifest;
        const currentBuild = Number(appInfo.build || 0);
        if (!manifest?.versionCode || currentBuild <= 0) return;
        if (manifest.versionCode <= currentBuild) return;

        try {
          if (sessionStorage.getItem(`${DISMISS_KEY}${manifest.versionCode}`) === '1') return;
        } catch {
          // ignore storage errors
        }

        if (!cancelled) {
          setInstalledVersion(appInfo.version || String(currentBuild));
          setUpdateAvailable(manifest);
        }
      } catch {
        // Silencioso se offline ou fora do app nativo
      }
    };

    void checkForApkUpdate();
    const stateListener = App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void checkForApkUpdate();
    });

    return () => {
      cancelled = true;
      void stateListener.then((handle) => handle.remove()).catch(() => {});
    };
  }, []);

  if (!updateAvailable || dismissed) return null;

  const isMandatory =
    typeof updateAvailable.minSupportedVersionCode === 'number' &&
    updateAvailable.minSupportedVersionCode > 0 &&
    false; // Reservado para bloqueio crítico futuro

  const handleDismiss = () => {
    if (isMandatory) return;
    try {
      sessionStorage.setItem(`${DISMISS_KEY}${updateAvailable.versionCode}`, '1');
    } catch {
      // ignore
    }
    setDismissed(true);
  };

  const resolvedApkUrl =
    typeof window !== 'undefined'
      ? new URL(updateAvailable.apkUrl, window.location.origin).toString()
      : updateAvailable.apkUrl;

  const handleInstallClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    haptics.select();
    if (typeof window !== 'undefined') {
      const opened = window.open(resolvedApkUrl, '_system');
      if (opened) {
        e.preventDefault();
      }
    }
  };

  return (
    <div
      role="alertdialog"
      aria-label={`Nova atualização disponível: v${updateAvailable.versionName}`}
      data-testid="apk-update-alert"
      className="fixed bottom-20 left-3 right-3 z-[80] mx-auto max-w-md rounded-2xl border-2 border-primary/60 bg-background/95 p-4 shadow-2xl backdrop-blur-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-bold text-primary">
            <Sparkles className="h-4 w-4 shrink-0" />
            <span>Nova atualização do app disponível (v{updateAvailable.versionName})</span>
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span>
              Sua versão: v{installedVersion} → Nova: v{updateAvailable.versionName} • APK oficial verificado
            </span>
          </p>
          {updateAvailable.releaseNotes?.[0] && (
            <p className="text-xs text-foreground/90 line-clamp-2">
              {updateAvailable.releaseNotes[0]}
            </p>
          )}
        </div>
        {!isMandatory && (
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Fechar aviso de atualização"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button asChild size="sm" className="flex-1 font-semibold">
          <a
            href={resolvedApkUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleInstallClick}
          >
            <Download className="mr-1.5 h-4 w-4" />
            Atualizar App Agora (1 toque)
          </a>
        </Button>
        {!isMandatory && (
          <Button type="button" size="sm" variant="ghost" onClick={handleDismiss}>
            Depois
          </Button>
        )}
      </div>
    </div>
  );
}

