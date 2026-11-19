'use client';

import React, { useState, useEffect } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Download, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { siteConfig } from '@/config/site';
import { isNativeApp } from '@/lib/nativeApp';
import { isAppAlreadyInstalled } from '@/lib/pwa/detectInstalledApp';

const PWA_INSTALL_BANNER_DISMISSED_KEY = 'pwa_install_banner_dismissed';

export default function PwaInstallBanner() {
  const [isVisible, setIsVisible] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const isMobile = useIsMobile();
  const router = useRouter();
  const locale = useLocale();

  useEffect(() => {
    // Quem já está dentro do app Android (WebView) não precisa ser convidado a instalar o app.
    if (isNativeApp()) return;

    // Check if the banner has been dismissed during this session
    const dismissedInSession = sessionStorage.getItem(PWA_INSTALL_BANNER_DISMISSED_KEY);
    if (dismissedInSession === 'true') {
      setIsDismissed(true);
      return;
    }

    // Sem APK novo e validado, não promover "instalar o aplicativo" no Android.
    if (/android/i.test(navigator.userAgent) && !siteConfig.apkDownloadEnabled) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    void isAppAlreadyInstalled().then((installed) => {
      if (cancelled || installed) return;
      timer = setTimeout(() => {
        if (!cancelled && isMobile && !isDismissed) {
          setIsVisible(true);
        }
      }, 5000);
    });

    // Cleanup timer on component unmount
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isMobile, isDismissed]);

  const handleDismiss = () => {
    setIsVisible(false);
    setIsDismissed(true);
    // Remember the dismissal for the current session
    sessionStorage.setItem(PWA_INSTALL_BANNER_DISMISSED_KEY, 'true');
  };

  const handleInstallClick = () => {
    router.push(`/${locale}/download`);
    handleDismiss(); // Also dismiss the banner when the user proceeds to install
  };

  if (!isVisible) {
    return null;
  }

  return (
    // Sem `backdrop-blur`: um desfoque do fundo sobre a TELA INTEIRA era refeito a cada quadro enquanto o feed rolava por baixo
    // do convite (ele aparece 5 s depois de abrir o site no celular e fica até a pessoa fechar).
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 animate-in fade-in-0">
      <Card className="w-[calc(100%-2rem)] max-w-sm m-4 shadow-2xl animate-in zoom-in-95">
        <CardHeader className="relative items-center text-center p-4">
            <span
              aria-hidden="true"
              className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary border border-primary/30 font-black text-lg tracking-tight shrink-0"
            >
              HV
            </span>
            <CardTitle className="mt-2">Tenha a Melhor Experiência</CardTitle>
            <CardDescription>Instale o aplicativo do HiperVerso no seu dispositivo.</CardDescription>
            <Button
                variant="ghost"
                size="icon"
                onClick={handleDismiss}
                className="absolute top-2 right-2 h-7 w-7 rounded-full"
                aria-label="Fechar banner de instalação"
            >
                <X className="h-5 w-5" />
            </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 p-4 pt-0">
            <p className="text-sm text-muted-foreground text-center">
            Acesse mais rápido, receba notificações e tenha uma experiência otimizada.
            </p>
          <Button onClick={handleInstallClick} className="w-full">
            <Download className="mr-2 h-4 w-4" />
            Instalar Agora
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
