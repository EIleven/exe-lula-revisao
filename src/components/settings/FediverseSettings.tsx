'use client';

// Configurações do Fediverso: ativar, pausar, retomar e desligar a federação da própria conta, ver o que foi entregue
// (e tentar de novo o que falhou) e moderar os seguidores de fora. Tudo o que muda estado passa pela API /api/ap/*.
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { Check, Copy, Globe, Loader2, Pause, Play, Power, ShieldAlert } from 'lucide-react';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { FederationApiError, changeFederation, getFederationStatus } from '@/lib/federation/client';
import { invalidateFederationAvailability } from '@/lib/federation/useFederationAvailability';
import type { FederationStatus } from '@/lib/federation/client';
import FediverseDeliveries from '@/components/settings/FediverseDeliveries';
import FediverseModeration from '@/components/settings/FediverseModeration';

type Acao = 'enable' | 'pause' | 'resume' | 'disable';

export default function FediverseSettings() {
  const t = useTranslations('Fediverse');
  const locale = useLocale();
  const { firebaseUser, currentUser } = useCurrentUser();
  const { toast } = useToast();
  const [status, setStatus] = useState<FederationStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<Acao | null>(null);
  const [confirmando, setConfirmando] = useState<'enable' | 'disable' | null>(null);
  const [copiado, setCopiado] = useState(false);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoadError(false);
    try {
      setStatus(await getFederationStatus(firebaseUser));
    } catch {
      setLoadError(true);
    }
  }, [firebaseUser]);

  useEffect(() => { void load(); }, [load]);

  const executar = async (acao: Acao) => {
    if (!firebaseUser) return;
    setBusy(acao);
    try {
      setStatus(await changeFederation(firebaseUser, acao));
      invalidateFederationAvailability(); // o compositor precisa ver o estado novo já na próxima abertura
      toast({ title: t(`done.${acao}`) });
    } catch (erro) {
      const codigo = erro instanceof FederationApiError ? erro.code : 'erro-desconhecido';
      toast({ title: t('errorTitle'), description: t.has(`errors.${codigo}`) ? t(`errors.${codigo}`) : t('errors.erro-desconhecido'), variant: 'destructive' });
    } finally {
      setBusy(null);
      setConfirmando(null);
    }
  };

  const copiar = async () => {
    if (!status?.acct) return;
    try {
      await navigator.clipboard.writeText(`@${status.acct}`);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch { /* sem permissão da área de transferência: o endereço continua visível */ }
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

  // ── A plataforma ainda não liga a federação: não há o que configurar ──
  if (!status.platformEnabled && !status.enabled) {
    return (
      <div className="space-y-4 p-6">
        <div className="flex items-center gap-2"><Globe className="h-5 w-5 text-muted-foreground" /><h1 className="text-xl font-semibold">{t('title')}</h1></div>
        <p className="text-sm text-muted-foreground">{t('platformOff')}</p>
        {currentUser?.isAdmin && (
          <Button asChild size="sm">
            <Link href={`/${locale}/admin`}>Abrir Painel Admin → Fediverso</Link>
          </Button>
        )}
      </div>
    );
  }

  const cabecalho = (
    <div className="space-y-2 p-6">
      <div className="flex items-center gap-2"><Globe className="h-5 w-5 text-primary" /><h1 className="text-xl font-semibold">{t('title')}</h1></div>
      <p className="text-sm text-muted-foreground">{t('description')}</p>
    </div>
  );

  const guiaComoUsar = (
    <section className="space-y-3 p-6 bg-muted/20">
      <h2 className="text-sm font-semibold text-foreground">Como saber se já tenho, como entrar e como usar</h2>
      <div className="grid gap-3 sm:grid-cols-3 text-xs text-muted-foreground">
        <div className="rounded-lg border border-border/70 bg-background/80 p-3 space-y-1">
          <p className="font-semibold text-foreground">1. Seu status aqui</p>
          {status.enabled ? (
            <p>
              Você <strong className="text-primary">{status.paused ? 'já tem (pausado)' : 'já está no Fediverso'}</strong> com o endereço{' '}
              <span className="font-mono text-foreground">@{status.acct}</span>.
            </p>
          ) : (
            <p>
              Sua conta ainda é só local. Clique no botão <strong className="text-foreground">{t('enable')}</strong> abaixo para criar seu{' '}
              <span className="font-mono text-foreground">@usuario@exercitodolula.app</span> em 1 clique.
            </p>
          )}
        </div>
        <div className="rounded-lg border border-border/70 bg-background/80 p-3 space-y-1">
          <p className="font-semibold text-foreground">2. Ao postar ou citar</p>
          <p>
            Em qualquer modal de postagem ou citação, use o seletor com o ícone <strong className="text-primary">🌐</strong> para decidir se o post fica só aqui, vai para o Fediverso ou também para o Bluesky.
          </p>
        </div>
        <div className="rounded-lg border border-border/70 bg-background/80 p-3 space-y-1">
          <p className="font-semibold text-foreground">3. Seguir e ser seguido</p>
          <p>
            Pessoas no Mastodon, Misskey ou Pixelfed podem buscar seu <span className="font-mono text-foreground">@usuario@exercitodolula.app</span>, e você pode buscar qualquer <span className="font-mono text-foreground">@pessoa@instancia</span> na aba Explorar.
          </p>
        </div>
      </div>
    </section>
  );

  // ── Desligada: explica ANTES de pedir o consentimento ──
  if (!status.enabled) {
    return (
      <div className="divide-y">
        {cabecalho}
        {guiaComoUsar}
        <section className="space-y-4 p-6">
          <h2 className="font-semibold">{t('beforeTitle')}</h2>
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            {(['scope', 'past', 'copies', 'control', 'identity'] as const).map((k) => <li key={k}>{t(`before.${k}`)}</li>)}
          </ul>
          <p className="text-sm text-muted-foreground">
            {t('policyPrefix')} <Link className="underline" href={`/${locale}/privacy`}>{t('policyLink')}</Link>.
          </p>
          {!firebaseUser?.emailVerified && (
            <Alert><ShieldAlert className="h-4 w-4" /><AlertTitle>{t('verifyEmailTitle')}</AlertTitle><AlertDescription>{t('verifyEmailDescription')}</AlertDescription></Alert>
          )}
          <Button disabled={busy !== null || !status.platformEnabled || !firebaseUser?.emailVerified} onClick={() => setConfirmando('enable')}>
            {busy === 'enable' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('enable')}
          </Button>
        </section>
        <AlertDialog open={confirmando === 'enable'} onOpenChange={(aberto) => !aberto && setConfirmando(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('confirmEnableTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('confirmEnableDescription')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void executar('enable')}>{t('confirmEnable')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // ── Ligada (ativa ou pausada) ──
  const pausada = status.paused;
  return (
    <div className="divide-y">
      {cabecalho}
      {guiaComoUsar}
      {!status.platformEnabled && (
        <div className="p-6"><Alert variant="destructive"><ShieldAlert className="h-4 w-4" /><AlertTitle>{t('platformPausedTitle')}</AlertTitle><AlertDescription>{t('platformPausedDescription')}</AlertDescription></Alert></div>
      )}
      <section className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('yourAddress')}</p>
            <p className="break-all font-mono text-base" data-testid="fediverse-acct">@{status.acct}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={pausada ? 'outline' : 'secondary'}>{pausada ? t('paused') : t('active')}</Badge>
            <Button variant="outline" size="sm" onClick={() => void copiar()}>
              {copiado ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}{copiado ? t('copied') : t('copy')}
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{t('followersCount', { count: status.followers })}</p>
        <p className="text-sm text-muted-foreground">{pausada ? t('pausedExplain') : t('activeExplain')}</p>
        <div className="flex flex-wrap gap-2">
          {pausada ? (
            <Button disabled={busy !== null} onClick={() => void executar('resume')}>
              {busy === 'resume' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}{t('resume')}
            </Button>
          ) : (
            <Button variant="outline" disabled={busy !== null} onClick={() => void executar('pause')}>
              {busy === 'pause' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pause className="mr-2 h-4 w-4" />}{t('pause')}
            </Button>
          )}
          <Button variant="destructive" disabled={busy !== null} onClick={() => setConfirmando('disable')}>
            <Power className="mr-2 h-4 w-4" />{t('disable')}
          </Button>
        </div>
      </section>

      <section className="p-6">
        <Tabs defaultValue="deliveries">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="deliveries">{t('tabs.deliveries')}</TabsTrigger>
            <TabsTrigger value="moderation">{t('tabs.moderation')}</TabsTrigger>
          </TabsList>
          <TabsContent value="deliveries" className="mt-4"><FediverseDeliveries /></TabsContent>
          <TabsContent value="moderation" className="mt-4"><FediverseModeration onChanged={() => void load()} /></TabsContent>
        </Tabs>
      </section>

      <AlertDialog open={confirmando === 'disable'} onOpenChange={(aberto) => !aberto && setConfirmando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmDisableTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('confirmDisableDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void executar('disable')}>{t('confirmDisable')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
