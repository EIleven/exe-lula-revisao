// src/app/[locale]/keys/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { ArrowLeft, BellRing, Camera, CheckCircle2, Fingerprint, HelpCircle, Laptop, Link2, Loader2, QrCode, RefreshCw, Settings2, ShieldCheck, SlidersHorizontal, Smartphone } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import Idp2pAuthenticatorCard from '@/components/idp2p/Idp2pAuthenticatorCard';
import Idp2pUnifiedAccountsCard from '@/components/idp2p/Idp2pUnifiedAccountsCard';
import SovereignKeyringPanel from '@/components/settings/SovereignKeyringPanel';
import { KeysQuickTour } from '@/components/onboarding/QuickTourDialog';
import { getE2eeStatus } from '@/lib/crypto/e2ee';
import { Capacitor } from '@capacitor/core';
import { enablePush, getPushPermission, isPushActive, openNativeNotificationSettings, syncPushToken } from '@/lib/services/pushNotificationService';
import {
  getDeviceFriendlyLabel,
  getOrCreateDeviceId,
  registerDeviceAndWatch,
  type PairedDeviceInfo,
} from '@/lib/p2p/p2pDevicePairing';

export default function SovereignKeysPage() {
  const { currentUser, isLoading } = useCurrentUser();
  const locale = useLocale();
  const { toast } = useToast();
  const [devices, setDevices] = useState<PairedDeviceInfo[]>([]);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [pushActive, setPushActive] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [biometricActive, setBiometricActive] = useState(false);
  const isNativeApp = typeof window !== 'undefined' && Capacitor.isNativePlatform();
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [passkeyDevices, setPasskeyDevices] = useState<Array<{ deviceId: string; deviceLabel: string; updatedAt: string }>>([]);
  const [cameraPermission, setCameraPermission] = useState<'granted' | 'denied' | 'prompt' | 'unknown'>('unknown');

  const myDeviceId = useMemo(() => getOrCreateDeviceId(), []);
  const myDeviceLabel = useMemo(() => getDeviceFriendlyLabel(), []);

  useEffect(() => {
    if (typeof window !== 'undefined' && currentUser?.id) {
      setBiometricActive(Boolean(localStorage.getItem(`idp2p_passkey_${currentUser.id}`)));
    }
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'camera' as PermissionName })
        .then((res) => setCameraPermission(res.state))
        .catch(() => setCameraPermission('unknown'));
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser?.id) return;
    let cancelled = false;
    (async () => {
      const token = await auth.currentUser?.getIdToken().catch(() => null);
      if (!token || cancelled) return;
      const res = await fetch('/api/idp2p/passkeys', { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
      if (!res?.ok || cancelled) return;
      const data = (await res.json()) as { passkeys?: Array<{ deviceId: string; deviceLabel: string; updatedAt: string }> };
      if (!cancelled && Array.isArray(data.passkeys)) {
        setPasskeyDevices(data.passkeys);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id]);

  const syncPasskeyToServer = async (credentialId: string) => {
    const token = await auth.currentUser?.getIdToken().catch(() => null);
    if (!token) return;
    const res = await fetch('/api/idp2p/passkeys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ deviceId: myDeviceId, deviceLabel: myDeviceLabel, credentialId }),
    }).catch(() => null);
    if (res?.ok) {
      setPasskeyDevices((prev) => [
        { deviceId: myDeviceId, deviceLabel: myDeviceLabel, updatedAt: new Date().toISOString() },
        ...prev.filter((p) => p.deviceId !== myDeviceId),
      ]);
    }
  };

  const pulseHaptic = async () => {
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) {
        const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
        await Haptics.impact({ style: ImpactStyle.Light });
      }
    } catch {
      // Silencioso na web
    }
  };

  const handleRegisterBiometric = async (forceReconfigure = false) => {
    if (biometricBusy) return;

    // 1. Caminho nativo no App Android (Capacitor BiometricBridge)
    try {
      const { Capacitor, registerPlugin } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) {
        const hasNativePlugin = Capacitor.isPluginAvailable('BiometricBridge');
        if (hasNativePlugin) {
          setBiometricBusy(true);
          try {
            const BiometricBridge = registerPlugin<{
              isAvailable: () => Promise<{ available: boolean }>;
              authenticate: (opts?: { title?: string; subtitle?: string }) => Promise<{ authenticated: boolean }>;
            }>('BiometricBridge');
            const avail = await BiometricBridge.isAvailable();
            if (!avail?.available) {
              toast({
                title: 'Ative uma digital, rosto ou PIN nas configurações do Android primeiro.',
                variant: 'destructive',
              });
              return;
            }
            const res = await BiometricBridge.authenticate({
              title: biometricActive && !forceReconfigure ? 'Confirmar biometria · HiperVerso' : 'Ativar biometria · HiperVerso',
              subtitle: 'Use sua digital, rosto ou senha do aparelho',
            });
            if (res?.authenticated && currentUser?.id) {
              const credId = `android-biometric:${myDeviceId}`;
              localStorage.setItem(`idp2p_passkey_${currentUser.id}`, credId);
              setBiometricActive(true);
              await syncPasskeyToServer(credId);
              await pulseHaptic();
              toast({
                title: biometricActive && !forceReconfigure
                  ? 'Biometria confirmada neste aparelho!'
                  : 'Biometria nativa ativada neste aparelho!',
              });
            }
          } catch {
            toast({ title: 'Autenticação biométrica cancelada ou não autorizada.', variant: 'destructive' });
          } finally {
            setBiometricBusy(false);
          }
          return;
        }
      }
    } catch {
      // Segue para WebAuthn padrão no navegador
    }

    if (typeof window === 'undefined' || !window.PublicKeyCredential || !navigator.credentials) {
      const { Capacitor } = await import('@capacitor/core').catch(() => ({ Capacitor: { isNativePlatform: () => false } }));
      toast({
        title: Capacitor.isNativePlatform()
          ? 'Atualize o app para o APK v1.4.0 (em /download) para liberar a biometria nativa do Android.'
          : 'Biometria indisponível neste navegador',
        variant: 'destructive',
      });
      return;
    }
    setBiometricBusy(true);
    try {
      const savedCredId = currentUser?.id ? localStorage.getItem(`idp2p_passkey_${currentUser.id}`) : null;
      if (biometricActive && savedCredId && !forceReconfigure && navigator.credentials.get) {
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const assertion = await navigator.credentials.get({
          publicKey: {
            challenge,
            rpId: window.location.hostname,
            userVerification: 'preferred',
            timeout: 60_000,
          },
        });
        if (assertion) {
          await pulseHaptic();
          toast({ title: 'Biometria confirmada com sucesso!' });
        }
        return;
      }

      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const userIdBytes = new TextEncoder().encode(currentUser?.id || myDeviceId);
      const basePublicKey: PublicKeyCredentialCreationOptions = {
        challenge,
        rp: { name: 'HiperVerso · IDP2P', id: window.location.hostname },
        user: {
          id: userIdBytes,
          name: `@${currentUser?.username || 'user'}@${window.location.hostname}`,
          displayName: currentUser?.name || currentUser?.username || 'HiperVerso',
        },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
        timeout: 60_000,
      };

      let cred: PublicKeyCredential | null = null;
      try {
        cred = (await navigator.credentials.create({
          publicKey: {
            ...basePublicKey,
            authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'preferred' },
          },
        })) as PublicKeyCredential | null;
      } catch (firstErr: unknown) {
        const name = firstErr instanceof DOMException ? firstErr.name : '';
        if (name === 'InvalidStateError' && currentUser?.id) {
          localStorage.setItem(`idp2p_passkey_${currentUser.id}`, savedCredId || 'registered');
          setBiometricActive(true);
          await syncPasskeyToServer(savedCredId || 'registered');
          toast({ title: 'Biometria / Passkey já estava ativa neste aparelho!' });
          return;
        }
        // Fallback sem prender em 'platform' (resolve rejeição inicial no Android Firefox / provedores externos)
        cred = (await navigator.credentials.create({
          publicKey: {
            ...basePublicKey,
            authenticatorSelection: { userVerification: 'preferred' },
          },
        })) as PublicKeyCredential | null;
      }

      if (cred && currentUser?.id) {
        localStorage.setItem(`idp2p_passkey_${currentUser.id}`, cred.id);
        setBiometricActive(true);
        await syncPasskeyToServer(cred.id);
        await pulseHaptic();
        toast({ title: 'Biometria / Passkey ativada neste aparelho!' });
      }
    } catch (err: unknown) {
      const msg =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Permissão negada ou tempo esgotado. Toque novamente para autorizar no sistema.'
          : 'Não foi possível concluir a biometria agora.';
      toast({ title: msg, variant: 'destructive' });
    } finally {
      setBiometricBusy(false);
    }
  };

  const handleRequestCameraHardware = async () => {
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) {
        const { Camera: CapCamera } = await import('@capacitor/camera');
        const perm = await CapCamera.requestPermissions({ permissions: ['camera', 'photos'] });
        const granted = perm.camera === 'granted';
        setCameraPermission(granted ? 'granted' : 'denied');
        await pulseHaptic();
        toast({ title: granted ? 'Câmera e galeria autorizadas no app!' : 'Permissão de câmera recusada.' });
        return;
      }
      const stream = await navigator.mediaDevices?.getUserMedia?.({ video: true });
      stream?.getTracks().forEach((t) => t.stop());
      setCameraPermission('granted');
      toast({ title: 'Câmera autorizada para leitura de Passe QR!' });
    } catch {
      setCameraPermission('denied');
      toast({ title: 'Não foi possível acessar a câmera.', variant: 'destructive' });
    }
  };

  useEffect(() => {
    let cancelled = false;
    const refreshPushState = async () => {
      const perm = await getPushPermission();
      if (cancelled) return;
      if (perm === 'granted') {
        setNotifPermission('granted');
        if (currentUser?.id) {
          const activeNow = await isPushActive(currentUser.id).catch(() => false);
          if (!cancelled) setPushActive(activeNow);
          if (!activeNow) {
            await syncPushToken(currentUser.id, locale).catch(() => undefined);
            const activeAfterSync = await isPushActive(currentUser.id).catch(() => false);
            if (!cancelled) setPushActive(activeAfterSync);
          }
        }
      } else {
        setPushActive(false);
        if (perm === 'denied') setNotifPermission('denied');
        else if (perm === 'unsupported') setNotifPermission('unsupported');
        else setNotifPermission('default');
      }
    };

    void refreshPushState();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshPushState();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [currentUser?.id, locale]);

  useEffect(() => {
    if (!currentUser?.id) {
      setDevices([]);
      return;
    }
    let cancelled = false;
    let unsub: (() => void) | null = null;
    (async () => {
      try {
        const status = await getE2eeStatus(currentUser.id).catch(() => null);
        if (cancelled) return;
        const hasE2eeKey = status?.status === 'ready';
        const keyId = status?.status === 'ready' ? status.keyId : null;
        unsub = registerDeviceAndWatch({
          userId: currentUser.id,
          hasE2eeKey,
          keyId,
          onDevicesChange: (list) => setDevices(list),
          onRemoteUnlinked: () => {},
        });
      } catch {
        setDevices([]);
      }
    })();
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [currentUser?.id]);

  const handleEnableBrowserAlerts = async () => {
    if (!currentUser?.id || pushBusy) return;
    setPushBusy(true);
    try {
      if (notifPermission === 'denied' && isNativeApp) {
        const opened = await openNativeNotificationSettings();
        if (opened) {
          toast({
            title: 'Permissão bloqueada no Android',
            description: 'Ative as notificações nas configurações do app que acabaram de abrir e volte para cá.',
          });
          return;
        }
      }
      await enablePush(currentUser.id, locale);
      const activeNow = await isPushActive(currentUser.id).catch(() => true);
      setNotifPermission('granted');
      setPushActive(activeNow);
      await pulseHaptic();
      toast({
        title: 'Alertas ativados!',
        description: 'Você receberá notificações neste aparelho quando houver pedido de login, DMs ou menções.',
      });
    } catch (err) {
      const perm = await getPushPermission().catch(() => 'denied' as const);
      setNotifPermission(perm === 'granted' ? 'granted' : perm === 'denied' ? 'denied' : perm === 'unsupported' ? 'unsupported' : 'default');
      setPushActive(false);
      if (perm === 'denied' && isNativeApp) {
        const opened = await openNativeNotificationSettings();
        if (opened) {
          toast({
            title: 'Libere as notificações no Android',
            description: 'Ative a chave "Permitir notificações" na tela do sistema e retorne ao app.',
          });
          return;
        }
      }
      toast({
        title: 'Não foi possível ativar alertas',
        description: err instanceof Error ? err.message : 'Verifique as permissões de notificação do aparelho.',
        variant: 'destructive',
      });
    } finally {
      setPushBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="max-w-xl mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Identidade P2P (IDP2P)
            </CardTitle>
            <CardDescription>
              Entre na sua conta para usar seu passaporte IDP2P, biometria e aprovações por QR.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-3">
            <Button asChild>
              <Link href={`/${locale}/login?redirect=/${locale}/keys`}>Entrar</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/${locale}`}>Voltar ao Feed</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/${locale}`} aria-label="Voltar">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Cofre &amp; Acesso
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Como funciona"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 text-xs leading-relaxed">
                  Guarde seus códigos de verificação (2FA) por QR Code, ative a biometria do aparelho e aprove logins sem depender de outro aplicativo.
                </PopoverContent>
              </Popover>
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              @{currentUser.username} · {myDeviceLabel}
            </p>
            <p className="text-[11px] text-emerald-500 font-medium mt-0.5">
              {biometricActive
                ? `Biometria ativa · ${Math.max(1, passkeyDevices.length)} aparelho(s)`
                : passkeyDevices.length > 0
                  ? `Ativa em ${passkeyDevices.map((d) => d.deviceLabel).join(', ')} · Falta neste`
                  : 'Ative a biometria em 1 toque abaixo'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <KeysQuickTour />
          <Button variant="outline" size="sm" asChild>
            <Link href={`/${locale}/settings/p2p`}>
              <Laptop className="mr-1.5 h-4 w-4" />
              Aparelhos ({devices.length})
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex gap-1.5">
          <Button
            type="button"
            variant={biometricActive ? 'secondary' : 'default'}
            disabled={biometricBusy}
            className="h-12 flex-1 justify-start gap-3 px-4"
            onClick={() => void handleRegisterBiometric(false)}
          >
            <Fingerprint className="h-5 w-5 shrink-0" />
            <div className="text-left">
              <div className="text-sm font-semibold">
                {biometricBusy
                  ? 'Aguardando biometria...'
                  : biometricActive
                    ? 'Biometria ativa (Testar)'
                    : 'Ativar Biometria'}
              </div>
              <div className="text-[11px] opacity-80">Digital, rosto ou senha do aparelho</div>
            </div>
          </Button>
          {biometricActive && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={biometricBusy}
              title="Reconfigurar Passkey"
              aria-label="Reconfigurar Passkey"
              className="h-12 w-12 shrink-0"
              onClick={() => void handleRegisterBiometric(true)}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
        </div>

        {!(notifPermission === 'granted' && pushActive) ? (
          <Button
            type="button"
            variant="outline"
            disabled={pushBusy}
            className="h-12 justify-start gap-3 px-4"
            onClick={() => void handleEnableBrowserAlerts()}
          >
            {pushBusy ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" /> : <BellRing className="h-5 w-5 shrink-0 text-primary" />}
            <div className="text-left">
              <div className="text-sm font-semibold">
                {pushBusy
                  ? 'Ativando alertas...'
                  : notifPermission === 'denied' && isNativeApp
                    ? 'Liberar Alertas no Android'
                    : 'Ativar Alertas de Login'}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {notifPermission === 'denied' ? 'Permissão bloqueada no sistema — toque para ajustar' : 'Aprovar novos aparelhos na hora'}
              </div>
            </div>
          </Button>
        ) : (
          <Button variant="outline" className="h-12 justify-start gap-3 px-4" asChild>
            <Link href={`/${locale}/settings/p2p`}>
              <QrCode className="h-5 w-5 shrink-0 text-primary" />
              <div className="text-left">
                <div className="text-sm font-semibold">Conectar Outro Aparelho</div>
                <div className="text-[11px] text-muted-foreground">Ler QR em outro dispositivo</div>
              </div>
            </Link>
          </Button>
        )}
      </div>

      <Tabs defaultValue="actions" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="actions" className="gap-1.5">
            <QrCode className="h-4 w-4" /> Códigos &amp; QR
          </TabsTrigger>
          <TabsTrigger value="accounts" className="gap-1.5">
            <Link2 className="h-4 w-4" /> Contas
          </TabsTrigger>
          <TabsTrigger value="advanced" className="gap-1.5">
            <SlidersHorizontal className="h-4 w-4" /> Avançado
          </TabsTrigger>
        </TabsList>

        <TabsContent value="actions" className="space-y-4">
          <Idp2pAuthenticatorCard userId={currentUser.id} username={currentUser.username} />
        </TabsContent>

        <TabsContent value="accounts" className="space-y-4">
          <Idp2pUnifiedAccountsCard
            userId={currentUser.id}
            federatedLoginProvider={currentUser.federatedLoginProvider}
            federatedLoginHandle={currentUser.federatedLoginHandle}
          />
        </TabsContent>

        <TabsContent value="advanced" className="space-y-4">
          <SovereignKeyringPanel
            userId={currentUser.id}
            deviceId={myDeviceId}
            linkedDevices={devices}
          />
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-primary" />
                Controle de Hardware &amp; Permissões do Aparelho
              </CardTitle>
              <CardDescription className="text-xs">
                Gerencie em 1 toque o que o app HiperVerso pode usar no seu dispositivo.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5">
              <div className="flex items-center justify-between rounded-lg border p-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <Fingerprint className="h-4 w-4 text-primary" />
                  <span>Biometria / Passkey</span>
                </div>
                <Button size="sm" variant={biometricActive ? 'secondary' : 'outline'} onClick={() => void handleRegisterBiometric(false)}>
                  {biometricActive ? <><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Testar</> : 'Ativar'}
                </Button>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <Camera className="h-4 w-4 text-primary" />
                  <span>Câmera (Passe QR &amp; Mídia)</span>
                </div>
                <Button size="sm" variant={cameraPermission === 'granted' ? 'secondary' : 'outline'} onClick={() => void handleRequestCameraHardware()}>
                  {cameraPermission === 'granted' ? <><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Autorizada</> : 'Autorizar'}
                </Button>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <BellRing className="h-4 w-4 text-primary" />
                  <div>
                    <span>Alertas de Login &amp; Push</span>
                    {notifPermission === 'denied' && (
                      <p className="text-[11px] text-destructive">Bloqueado nas configurações do aparelho</p>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={pushBusy}
                  variant={notifPermission === 'granted' && pushActive ? 'secondary' : 'outline'}
                  onClick={() => void handleEnableBrowserAlerts()}
                >
                  {pushBusy ? (
                    <><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Ativando...</>
                  ) : notifPermission === 'granted' && pushActive ? (
                    <><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Ativos</>
                  ) : notifPermission === 'denied' && isNativeApp ? (
                    <><Settings2 className="mr-1 h-3.5 w-3.5" /> Ajustes</>
                  ) : (
                    'Ativar'
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Padrão Aberto IDP2P</CardTitle>
              <CardDescription className="text-xs">
                Gerencie múltiplas contas vinculadas em Configurações e acompanhe o protocolo P2P aberto na seção DEV.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/${locale}/settings`}>Configurações</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/${locale}/dev`}>Portal DEV / Protocolo</Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

