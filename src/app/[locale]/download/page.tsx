// src/app/[locale]/download/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Download, AlertTriangle, Share, Monitor, CheckCircle } from 'lucide-react';
import Image from 'next/image';
import { siteConfig } from '@/config/site';

// Enquanto não houver um APK novo e validado, nada do APK antigo é oferecido nem buscado.
const apkDownloadEnabled = siteConfig.apkDownloadEnabled;

type ReleaseInfo = {
  versionName: string;
  versionCode: number;
  apkUrl: string;
  sha256: string;
  releaseNotes: string[];
};

type OperatingSystem = 'iOS' | 'Android' | 'Windows' | 'Mac' | 'Linux/Other' | 'Loading';

const LoadingSkeleton = () => (
    <Card className="shadow-lg">
        <CardHeader>
            <Skeleton className="h-8 w-3/4 mb-2" />
            <Skeleton className="h-4 w-full" />
        </CardHeader>
        <CardContent className="space-y-4">
            <Skeleton className="h-12 w-1/2" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
        </CardContent>
    </Card>
);

export default function DownloadPage() {
  const t = useTranslations('DownloadPage');
  const [os, setOs] = useState<OperatingSystem>('Loading');
  const [releaseInfo, setReleaseInfo] = useState<ReleaseInfo | null>(null);

  useEffect(() => {
    // Detect OS
    const ua = navigator.userAgent;
    if (/android/i.test(ua)) setOs('Android');
    else if (/iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream) setOs('iOS');
    else if (/Win/i.test(ua)) setOs('Windows');
    else if (/Mac/i.test(ua)) setOs('Mac');
    else setOs('Linux/Other');

    // Fetch release info (somente quando a distribuição do APK está habilitada)
    if (apkDownloadEnabled) {
      fetch('/downloads/latest.json')
        .then(res => res.json())
        .then(data => setReleaseInfo(data))
        .catch(err => console.error("Failed to fetch release info:", err));
    }
  }, []);

  const renderContent = () => {
    if (os === 'Loading' || (apkDownloadEnabled && !releaseInfo)) {
      return <LoadingSkeleton />;
    }

    switch (os) {
      case 'Android':
        if (!apkDownloadEnabled || !releaseInfo) {
          return (
            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle>{t('androidSoonTitle')}</CardTitle>
                <CardDescription>{t('androidSoonText')}</CardDescription>
              </CardHeader>
            </Card>
          );
        }
        return (
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle>{t('androidTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <Button asChild className="w-full sm:w-auto">
                <a href={releaseInfo.apkUrl} download>
                  <Download className="mr-2 h-4 w-4" />
                  {t('downloadApkButton')} (v{releaseInfo.versionName})
                </a>
              </Button>
              <div className="space-y-4 pt-4">
                <h3 className="font-semibold">{t('apkInstallTitle')}</h3>
                <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                  <li>{t('apkStep1')}</li>
                  <li>{t('apkStep2')}</li>
                  <li>{t('apkStep3')}</li>
                </ol>
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>{t('apkSecurityWarningTitle')}</AlertTitle>
                  <AlertDescription>{t('apkSecurityWarningText')}</AlertDescription>
                </Alert>
              </div>
            </CardContent>
          </Card>
        );
      case 'iOS':
        return (
            <Card className="shadow-lg">
                <CardHeader>
                    <CardTitle>{t('iosTitle')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                     <h3 className="font-semibold">{t('iosInstallTitle')}</h3>
                    <ol className="list-decimal list-inside space-y-4 text-sm text-muted-foreground">
                        <li>{t('iosStep1')}</li>
                        <li>{t('iosStep2')} <Share className="inline-block h-4 w-4 mx-1" /></li>
                        <li>{t('iosStep3')}</li>
                        <li>{t('iosStep4')}</li>
                    </ol>
                </CardContent>
            </Card>
        );
      default: // Desktop
        return (
            <Card className="shadow-lg">
                <CardHeader>
                    <CardTitle>{t('desktopTitle')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <h3 className="font-semibold">{t('desktopInstallTitle')}</h3>
                    <p className="text-sm text-muted-foreground">{t('desktopInstallText')}</p>
                    <div className="p-4 bg-muted rounded-md flex items-center justify-center">
                        <Monitor className="h-10 w-10 text-primary mr-4" />
                        <p className="font-medium">Exe. Lula pode ser instalado como um aplicativo de desktop!</p>
                    </div>
                </CardContent>
            </Card>
        );
    }
  };

  return (
    <div className="container mx-auto max-w-3xl py-8 space-y-8">
        <header>
            <h1 className="text-3xl font-bold">{t('title')}</h1>
            <p className="text-muted-foreground">{t('description')}</p>
        </header>

        {renderContent()}

        {releaseInfo && (
            <Card className="shadow-lg">
                <CardHeader>
                    <CardTitle>{t('releaseInfoTitle')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">{t('version')}</span>
                        <Badge variant="secondary">{releaseInfo.versionName} (build {releaseInfo.versionCode})</Badge>
                    </div>
                    <Separator />
                    <div>
                        <h4 className="font-semibold mb-2">{t('releaseNotes')}:</h4>
                        <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                            {releaseInfo.releaseNotes.map((note, index) => (
                                <li key={index}>{note}</li>
                            ))}
                        </ul>
                    </div>
                    <Separator />
                     <div>
                        <h4 className="font-semibold mb-2">{t('checksum')}</h4>
                        <p className="text-xs text-muted-foreground break-all font-mono bg-muted p-2 rounded-md">{releaseInfo.sha256}</p>
                    </div>
                </CardContent>
            </Card>
        )}
    </div>
  );
}
