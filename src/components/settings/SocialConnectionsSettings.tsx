'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AtSign, CheckCircle2, Loader2, LockKeyhole, MessageCircle, Unplug } from 'lucide-react';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  disconnectSocialConnection,
  getSocialConnections,
  startSocialConnection,
} from '@/lib/social/client';
import type { SocialConnectionsStatus, SocialProvider } from '@/lib/social/types';

const providerName = (_provider: SocialProvider) => 'Bluesky';

export default function SocialConnectionsSettings() {
  const t = useTranslations('SocialConnections');
  const locale = useLocale();
  const { firebaseUser } = useCurrentUser();
  const { toast } = useToast();
  const [status, setStatus] = useState<SocialConnectionsStatus | null>(null);
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Estado da conexão com o protocolo Matrix
  const [matrixHandle, setMatrixHandle] = useState('');
  const [matrixHomeserver, setMatrixHomeserver] = useState('https://matrix.org');
  const [matrixRoomId, setMatrixRoomId] = useState('');
  const [matrixAccessToken, setMatrixAccessToken] = useState('');
  const [matrixConnected, setMatrixConnected] = useState(false);
  const [matrixSavedHandle, setMatrixSavedHandle] = useState<string | null>(null);
  const [matrixHasToken, setMatrixHasToken] = useState(false);
  const [matrixShowBridge, setMatrixShowBridge] = useState(false);
  const [matrixBusy, setMatrixBusy] = useState(false);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoadError(false);
    try {
      const [socialData, token] = await Promise.all([
        getSocialConnections(firebaseUser),
        firebaseUser.getIdToken(),
      ]);
      setStatus(socialData);
      const matrixRes = await fetch('/api/matrix/connection', {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => null);
      if (matrixRes?.ok) {
        const m = await matrixRes.json() as {
          connected?: boolean;
          matrixHandle?: string | null;
          homeserverUrl?: string;
          roomId?: string;
          hasBridgeToken?: boolean;
        };
        setMatrixConnected(Boolean(m.connected));
        setMatrixSavedHandle(m.matrixHandle ?? null);
        if (m.matrixHandle) setMatrixHandle(m.matrixHandle);
        if (m.homeserverUrl) setMatrixHomeserver(m.homeserverUrl);
        if (m.roomId) setMatrixRoomId(m.roomId);
        setMatrixHasToken(Boolean(m.hasBridgeToken));
      }
    } catch {
      setLoadError(true);
    }
  }, [firebaseUser]);

  const saveMatrix = async (testMessage = false) => {
    if (!firebaseUser || !matrixHandle.trim()) return;
    setMatrixBusy(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/matrix/connection', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          matrixHandle: matrixHandle.trim(),
          homeserverUrl: matrixHomeserver.trim() || 'https://matrix.org',
          roomId: matrixRoomId.trim(),
          accessToken: matrixAccessToken.trim() || undefined,
          testMessage,
        }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; matrixHandle?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Não foi possível salvar a conexão Matrix.');
      }
      setMatrixConnected(true);
      setMatrixSavedHandle(data.matrixHandle ?? matrixHandle.trim());
      if (matrixAccessToken.trim()) setMatrixHasToken(true);
      setMatrixAccessToken('');
      toast({
        title: testMessage ? 'Matrix conectado e mensagem de teste enviada!' : 'Matrix conectado ao seu perfil!',
      });
    } catch (error) {
      toast({
        title: 'Erro ao configurar Matrix',
        description: error instanceof Error ? error.message : 'Verifique os dados informados.',
        variant: 'destructive',
      });
    } finally {
      setMatrixBusy(false);
    }
  };

  const disconnectMatrix = async () => {
    if (!firebaseUser) return;
    setMatrixBusy(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/matrix/connection', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Falha ao desconectar Matrix.');
      setMatrixConnected(false);
      setMatrixSavedHandle(null);
      setMatrixHandle('');
      setMatrixRoomId('');
      setMatrixAccessToken('');
      setMatrixHasToken(false);
      toast({ title: 'Matrix desconectado.' });
    } catch (error) {
      toast({
        title: 'Erro ao desconectar Matrix',
        description: error instanceof Error ? error.message : 'Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setMatrixBusy(false);
    }
  };

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const parameters = new URL(window.location.href).searchParams;
    const result = parameters.get('social');
    const provider = parameters.get('provider') as SocialProvider | null;
    if (result && provider && provider === 'bluesky') {
      toast({
        title: result === 'connected' ? t('connectedTitle', { provider: providerName(provider) }) : t('errorTitle'),
        description: result === 'connected' ? t('connectedDescription') : t('errorDescription', { provider: providerName(provider) }),
        variant: result === 'connected' ? 'default' : 'destructive',
      });
      window.history.replaceState({}, '', window.location.pathname);
      void load();
    }
  }, [load, t, toast]);

  const connect = async (provider: SocialProvider) => {
    if (!firebaseUser) return;
    setBusy(provider);
    try {
      const url = await startSocialConnection(firebaseUser, provider, provider === 'bluesky' ? handle : undefined, locale);
      window.location.assign(url);
    } catch (error) {
      toast({ title: t('errorTitle'), description: error instanceof Error ? error.message : t('genericError'), variant: 'destructive' });
      setBusy(null);
    }
  };

  const disconnect = async (provider: SocialProvider) => {
    if (!firebaseUser) return;
    setBusy(provider);
    try {
      await disconnectSocialConnection(firebaseUser, provider);
      await load();
      toast({ title: t('disconnectedTitle', { provider: providerName(provider) }) });
    } catch (error) {
      toast({ title: t('errorTitle'), description: error instanceof Error ? error.message : t('genericError'), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  if (!status && !loadError) {
    return <div className="flex min-h-72 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (loadError || !status) {
    return (
      <Alert variant="destructive" className="m-6">
        <AlertTitle>{t('loadErrorTitle')}</AlertTitle>
        <AlertDescription className="mt-3"><Button variant="outline" size="sm" onClick={() => void load()}>{t('tryAgain')}</Button></AlertDescription>
      </Alert>
    );
  }

  const bluesky = status.providers.bluesky;

  return (
    <div className="divide-y">
      <div className="space-y-2 p-6">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <section className="space-y-4 p-6" data-testid="social-connection-bluesky">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500 text-lg font-black text-white">B</div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">Bluesky</h2>
                {bluesky.connection.connected && <Badge variant="secondary"><CheckCircle2 className="mr-1 h-3 w-3" />{t('connected')}</Badge>}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {bluesky.connection.connected ? `@${bluesky.connection.handle}` : t('blueskyDescription')}
              </p>
            </div>
          </div>
          {bluesky.connection.connected && (
            <Button variant="outline" size="sm" disabled={busy === 'bluesky'} onClick={() => void disconnect('bluesky')}>
              {busy === 'bluesky' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="mr-2 h-4 w-4" />}{t('disconnect')}
            </Button>
          )}
        </div>
        {!bluesky.connection.connected && (
          <div className="space-y-2">
            <Label htmlFor="bluesky-handle">{t('blueskyHandle')}</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <AtSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="bluesky-handle" className="pl-9" value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="nome.bsky.social" autoCapitalize="none" autoCorrect="off" />
              </div>
              <Button disabled={!bluesky.configured || !handle.trim() || busy === 'bluesky'} onClick={() => void connect('bluesky')}>
                {busy === 'bluesky' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('connect')}
              </Button>
            </div>
            {!bluesky.configured && <p className="text-xs text-amber-600 dark:text-amber-400">{t('serverSetupPending')}</p>}
          </div>
        )}
      </section>

      <section className="space-y-4 p-6" data-testid="social-connection-matrix">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-lg font-black text-white">
              <MessageCircle className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">Matrix (Protocolo Aberto)</h2>
                {matrixConnected && (
                  <Badge variant="secondary">
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    Conectado
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {matrixConnected && matrixSavedHandle
                  ? `${matrixSavedHandle} · visível no seu perfil via matrix.to`
                  : 'Conecte seu Matrix ID (@voce:matrix.org ou outro servidor) para exibir no perfil e integrar salas com criptografia.'}
              </p>
            </div>
          </div>
          {matrixConnected && (
            <Button variant="outline" size="sm" disabled={matrixBusy} onClick={() => void disconnectMatrix()}>
              {matrixBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="mr-2 h-4 w-4" />}
              Desconectar
            </Button>
          )}
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="matrix-handle">Seu Matrix ID</Label>
            <div className="flex gap-2">
              <Input
                id="matrix-handle"
                value={matrixHandle}
                onChange={(event) => setMatrixHandle(event.target.value)}
                placeholder="@usuario:matrix.org"
                autoCapitalize="none"
                autoCorrect="off"
              />
              <Button disabled={!matrixHandle.trim() || matrixBusy} onClick={() => void saveMatrix(false)}>
                {matrixBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {matrixConnected ? 'Atualizar' : 'Conectar'}
              </Button>
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setMatrixShowBridge((prev) => !prev)}
              className="text-xs font-medium text-primary hover:underline"
            >
              {matrixShowBridge ? 'Ocultar configuração de sala Matrix' : 'Configurar ponte para sala Matrix (opcional)'}
            </button>
          </div>

          {matrixShowBridge && (
            <div className="space-y-3 rounded-lg border border-border/70 bg-muted/25 p-3.5 text-xs">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="matrix-homeserver">Homeserver</Label>
                  <Input
                    id="matrix-homeserver"
                    value={matrixHomeserver}
                    onChange={(event) => setMatrixHomeserver(event.target.value)}
                    placeholder="https://matrix.org"
                    autoCapitalize="none"
                    autoCorrect="off"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="matrix-room">Room ID da sala</Label>
                  <Input
                    id="matrix-room"
                    value={matrixRoomId}
                    onChange={(event) => setMatrixRoomId(event.target.value)}
                    placeholder="!sala:matrix.org"
                    autoCapitalize="none"
                    autoCorrect="off"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="matrix-token">
                  Access Token {matrixHasToken ? '(já configurado — preencha só para trocar)' : ''}
                </Label>
                <Input
                  id="matrix-token"
                  type="password"
                  value={matrixAccessToken}
                  onChange={(event) => setMatrixAccessToken(event.target.value)}
                  placeholder="syt_..."
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!matrixHandle.trim() || !matrixRoomId.trim() || matrixBusy}
                  onClick={() => void saveMatrix(true)}
                >
                  Salvar e enviar teste na sala
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="p-6">
        <Alert>
          <LockKeyhole className="h-4 w-4" />
          <AlertTitle>{t('securityTitle')}</AlertTitle>
          <AlertDescription>{t('securityDescription')}</AlertDescription>
        </Alert>
      </div>
    </div>
  );
}
