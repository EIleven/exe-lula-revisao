// src/app/[locale]/download/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Download,
  AlertTriangle,
  Share,
  Monitor,
  CheckCircle,
  ShieldCheck,
  Copy,
  Gamepad2,
  Smartphone,
  Terminal,
  RefreshCw,
} from 'lucide-react';
import { siteConfig } from '@/config/site';

// Enquanto não houver um APK novo e validado, nada do APK antigo é oferecido nem buscado.
const apkDownloadEnabled = siteConfig.apkDownloadEnabled;

type ReleaseInfo = {
  packageName?: string;
  versionName: string;
  versionCode: number;
  apkUrl: string;
  fileSizeBytes?: number;
  sha256: string;
  signingCertSha256?: string;
  releasedAt?: string;
  reproducibleBuild?: {
    command: string;
    gradleVersion: string;
    verifyCmd: string;
  };
  releaseNotes: string[];
};

type StoreItem = {
  id: string;
  kind: 'app' | 'game';
  title: string;
  developer: string;
  origin: string;
  summary: string;
  platform: string;
  version: string;
  license: string;
  sha256?: string;
  actionLabel: string;
  actionUrl: string;
  isDownload?: boolean;
  featured?: boolean;
};

type StoreCatalog = {
  storeName: string;
  tagline: string;
  items: StoreItem[];
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

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DownloadPage() {
  const t = useTranslations('DownloadPage');
  const [os, setOs] = useState<OperatingSystem>('Loading');
  const [releaseInfo, setReleaseInfo] = useState<ReleaseInfo | null>(null);
  const [catalog, setCatalog] = useState<StoreCatalog | null>(null);
  const [filter, setFilter] = useState<'all' | 'app' | 'game'>('all');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    if (/android/i.test(ua)) setOs('Android');
    else if (/iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream) setOs('iOS');
    else if (/Win/i.test(ua)) setOs('Windows');
    else if (/Mac/i.test(ua)) setOs('Mac');
    else setOs('Linux/Other');

    if (apkDownloadEnabled) {
      fetch('/downloads/latest.json', { cache: 'no-store' })
        .then((res) => res.json())
        .then((data) => setReleaseInfo(data))
        .catch((err) => console.error('Failed to fetch release info:', err));
    }

    fetch('/downloads/store-catalog.json', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.items) setCatalog(data);
      })
      .catch(() => {});
  }, []);

  const copyValue = async (field: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField((prev) => (prev === field ? null : prev)), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const openApkDownload = (rawUrl: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (typeof window === 'undefined') return;
    const resolved = new URL(rawUrl, window.location.origin).toString();
    const isCapacitorNative = Boolean(
      (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.(),
    );
    if (isCapacitorNative) {
      const opened = window.open(resolved, '_system');
      if (opened) e.preventDefault();
    }
  };

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
          <Card className="shadow-lg border-primary/30">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>{t('androidTitle')}</CardTitle>
                <Badge className="bg-emerald-600/20 text-emerald-400 border-emerald-500/40">
                  <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                  Assinado + Auto-Updater
                </Badge>
              </div>
              <CardDescription>
                Distribuição direta oficial fora da Play Store, assinada com chave própria e atualização automática embutida.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-wrap items-center gap-3">
                <Button asChild size="lg" className="w-full sm:w-auto">
                  <a
                    href={releaseInfo.apkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={openApkDownload(releaseInfo.apkUrl)}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    {t('downloadApkButton')} (v{releaseInfo.versionName}
                    {releaseInfo.fileSizeBytes ? ` • ${formatBytes(releaseInfo.fileSizeBytes)}` : ''})
                  </a>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Se você tinha uma versão antiga de teste e aparecer conflito de pacote ao atualizar, desinstale a versão antiga antes de instalar esta.
              </p>
              <div className="space-y-4 pt-2">
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
              <CardDescription>
                Instalação direta pelo Safari sem depender da App Store — com suporte a Face ID, Passkeys e Web Push.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <h3 className="font-semibold">{t('iosInstallTitle')}</h3>
              <ol className="list-decimal list-inside space-y-4 text-sm text-muted-foreground">
                <li>{t('iosStep1')}</li>
                <li>
                  {t('iosStep2')} <Share className="inline-block h-4 w-4 mx-1" />
                </li>
                <li>{t('iosStep3')}</li>
                <li>{t('iosStep4')}</li>
              </ol>
            </CardContent>
          </Card>
        );
      default:
        return (
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle>{t('desktopTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <h3 className="font-semibold">{t('desktopInstallTitle')}</h3>
              <p className="text-sm text-muted-foreground">{t('desktopInstallText')}</p>
              <div className="p-4 bg-muted rounded-md flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center">
                  <Monitor className="h-10 w-10 text-primary mr-4 shrink-0" />
                  <p className="font-medium">HiperVerso pode ser instalado como aplicativo de desktop ou baixado em APK para Android!</p>
                </div>
                {apkDownloadEnabled && releaseInfo && (
                  <Button asChild size="sm" variant="outline">
                    <a
                      href={releaseInfo.apkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={openApkDownload(releaseInfo.apkUrl)}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      APK Android v{releaseInfo.versionName}
                    </a>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
    }
  };

  const filteredItems =
    catalog?.items.filter((item) => (filter === 'all' ? true : item.kind === filter)) ?? [];

  return (
    <div className="container mx-auto max-w-4xl py-8 px-4 space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-primary/40 text-primary">
            Distribuição Soberana BR
          </Badge>
          <Badge variant="secondary">0% de taxa de loja estrangeira</Badge>
        </div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </header>

      {renderContent()}

      {releaseInfo && (
        <Card className="shadow-lg">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-400" />
                {t('releaseInfoTitle')} & Auditoria Criptográfica
              </CardTitle>
              <Badge variant="secondary">
                {releaseInfo.versionName} (build {releaseInfo.versionCode})
              </Badge>
            </div>
            <CardDescription>
              Conferência independente de integridade, chave de assinatura e build reproduzível de código aberto.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-foreground">
                  <RefreshCw className="h-3.5 w-3.5 text-primary" />
                  Auto-Updater Embutido
                </div>
                <p className="text-muted-foreground">
                  O app Android checa novas versões assinadas direto na fonte e atualiza em 1 toque.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-foreground">
                  <Terminal className="h-3.5 w-3.5 text-primary" />
                  Build Reproduzível
                </div>
                <p className="text-muted-foreground font-mono">
                  {releaseInfo.reproducibleBuild?.command || 'npm run apk:lancar'} (Gradle {releaseInfo.reproducibleBuild?.gradleVersion || '8.11.1'})
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-foreground">
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                  Pacote Verificado
                </div>
                <p className="text-muted-foreground font-mono">
                  {releaseInfo.packageName || 'com.soberan.app'}
                </p>
              </div>
            </div>

            <Separator />

            <div>
              <h4 className="font-semibold mb-2 text-sm">{t('releaseNotes')}:</h4>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                {releaseInfo.releaseNotes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </div>

            <Separator />

            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <h4 className="font-semibold text-sm">{t('checksum')} (APK)</h4>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => copyValue('apk', releaseInfo.sha256)}
                  >
                    <Copy className="mr-1 h-3 w-3" />
                    {copiedField === 'apk' ? 'Copiado' : 'Copiar'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground break-all font-mono bg-muted p-2.5 rounded-md">
                  {releaseInfo.sha256}
                </p>
              </div>

              {releaseInfo.signingCertSha256 && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="font-semibold text-sm">Certificado de Assinatura (SHA-256)</h4>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => copyValue('cert', releaseInfo.signingCertSha256!)}
                    >
                      <Copy className="mr-1 h-3 w-3" />
                      {copiedField === 'cert' ? 'Copiado' : 'Copiar'}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground break-all font-mono bg-muted p-2.5 rounded-md">
                    {releaseInfo.signingCertSha256}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1 font-mono">
                    Auditoria local: {releaseInfo.reproducibleBuild?.verifyCmd || 'apksigner verify --print-certs Soberan.apk'}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {catalog && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <Gamepad2 className="h-6 w-6 text-primary" />
                {catalog.storeName} — Apps & Games BR
              </h2>
              <p className="text-sm text-muted-foreground">{catalog.tagline}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={filter === 'all' ? 'default' : 'outline'}
                onClick={() => setFilter('all')}
              >
                Todos
              </Button>
              <Button
                type="button"
                size="sm"
                variant={filter === 'app' ? 'default' : 'outline'}
                onClick={() => setFilter('app')}
              >
                <Smartphone className="mr-1 h-3.5 w-3.5" />
                Apps BR
              </Button>
              <Button
                type="button"
                size="sm"
                variant={filter === 'game' ? 'default' : 'outline'}
                onClick={() => setFilter('game')}
              >
                <Gamepad2 className="mr-1 h-3.5 w-3.5" />
                Games BR
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredItems.map((item) => (
              <Card key={item.id} className="flex flex-col justify-between shadow-md">
                <CardHeader className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={item.kind === 'game' ? 'default' : 'secondary'}>
                      {item.kind === 'game' ? 'Game BR' : 'App BR'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{item.platform}</span>
                  </div>
                  <CardTitle className="text-lg">{item.title}</CardTitle>
                  <CardDescription className="text-xs">
                    {item.developer} • {item.origin} • {item.version}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-foreground/90">{item.summary}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border">
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {item.license}
                    </span>
                    {item.isDownload ? (
                      <Button asChild size="sm">
                        <a
                          href={item.actionUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={openApkDownload(item.actionUrl)}
                        >
                          <Download className="mr-1.5 h-3.5 w-3.5" />
                          {item.actionLabel}
                        </a>
                      </Button>
                    ) : (
                      <Button asChild size="sm" variant="outline">
                        <Link href={item.actionUrl}>{item.actionLabel}</Link>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
