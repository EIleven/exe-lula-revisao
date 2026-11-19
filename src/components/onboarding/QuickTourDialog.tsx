// src/components/onboarding/QuickTourDialog.tsx
'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale } from 'next-intl';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Compass,
  Download,
  Fingerprint,
  Globe2,
  KeyRound,
  Lock,
  MessageSquare,
  QrCode,
  ShieldCheck,
  Sparkles,
  User as UserIcon,
  Users,
  X,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { User } from '@/lib/types';
import UniverseLensBar from '@/components/idp2p/UniverseLensBar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { haptics } from '@/lib/haptics';
import { cn } from '@/lib/utils';

interface TourStep {
  badge: string;
  title: string;
  description: string;
  highlights: string[];
  icon: React.ReactNode;
}

const VISITOR_STORAGE_KEY = 'exelula_visitor_tour_seen_v1';
const KEYS_STORAGE_KEY = 'exelula_keys_tour_seen_v1';

export function VisitorWelcomeTour({ isGuest }: { isGuest: boolean }) {
  const locale = useLocale();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [bannerVisible, setBannerVisible] = useState(false);
  const [step, setStep] = useState(0);

  const isAuthPage = Boolean(pathname && /\/(login|register|forgot-password)(\/|$)/.test(pathname));

  useEffect(() => {
    if (!isGuest || typeof window === 'undefined') {
      setBannerVisible(false);
      return;
    }
    try {
      const seen = localStorage.getItem(VISITOR_STORAGE_KEY) === '1';
      setBannerVisible(!seen);
    } catch {
      setBannerVisible(true);
    }
  }, [isGuest]);

  const dismissAll = () => {
    try {
      localStorage.setItem(VISITOR_STORAGE_KEY, '1');
    } catch {
      // ignore
    }
    setOpen(false);
    setBannerVisible(false);
  };

  if (!isGuest) return null;

  const steps: TourStep[] = [
    {
      badge: 'Sem algoritmo',
      title: 'Feed em ordem cronológica',
      description:
        'Diferente das redes tradicionais, a timeline mostra em ordem o que as contas que você segue publicam, sem algoritmo nem anúncios no meio.',
      highlights: ['Ordem cronológica', 'Sem anúncios', 'Simples de usar'],
      icon: <Compass className="h-3 w-3 text-primary" />,
    },
    {
      badge: 'Fediverso BR',
      title: 'Suas conexões em rede aberta',
      description:
        'Sem venda de dados e com bloqueio ativo a bots de coleta. Interaja com instâncias do Fediverso brasileiro (URSAL, Orgânica, Bolha) e Bluesky mantendo sua conta.',
      highlights: ['@voce@hiperverso.social', 'Sem venda de dados', 'Zero Bots & Anti-IA'],
      icon: <Globe2 className="h-3 w-3 text-primary" />,
    },
    {
      badge: 'HiperChat & Cofre',
      title: 'Mensagens diretas e grupos',
      description:
        'Grupos de até 1.000 pessoas, mensagens P2P entre aparelhos e Cofre 2FA TOTP no mesmo sistema, sem rastreamento publicitário.',
      highlights: ['App HiperChat', 'Modo P2P direto', 'Cofre 2FA TOTP'],
      icon: <Lock className="h-3 w-3 text-primary" />,
    },
    {
      badge: 'Web e Android',
      title: 'No navegador ou no App Android',
      description:
        'Use direto no navegador ou baixe o HiperVerso e o HiperChat na página de downloads. Código aberto, leve e com login por biometria.',
      highlights: ['Acesso com digital', 'Código aberto', 'HiperVerso e HiperChat'],
      icon: <ShieldCheck className="h-3 w-3 text-primary" />,
    },
  ];

  const current = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <>
      {bannerVisible && !open && !isAuthPage && (
        <div className="fixed bottom-16 left-3 right-3 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-full border border-primary/35 bg-card/95 px-3.5 py-2 shadow-2xl backdrop-blur-xl sm:bottom-5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-primary/15 ring-1 ring-primary/40 flex items-center justify-center">
              <span className="text-xs font-black tracking-tight text-primary">HV</span>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground truncate">
                Por que o HiperVerso?
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                Sem algoritmo, zero venda de dados (30s)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              type="button"
              size="sm"
              className="h-7 rounded-full px-3 text-xs font-semibold"
              onClick={() => {
                haptics.select();
                setStep(0);
                setOpen(true);
              }}
            >
              Ver tour
            </Button>
            <button
              type="button"
              onClick={dismissAll}
              aria-label="Fechar tour"
              className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={(next) => !next && dismissAll()}>
        <DialogContent className="w-[calc(100%-1.5rem)] sm:max-w-md max-h-[90dvh] flex flex-col rounded-2xl border-border/80 bg-card/95 backdrop-blur-xl p-0 overflow-hidden">
          <div className="shrink-0 bg-gradient-to-br from-primary/20 via-primary/5 to-transparent px-5 sm:px-6 pt-5 sm:pt-6 pb-4 border-b border-border/60">
            <DialogHeader className="space-y-3 text-left">
              <div className="flex items-center gap-3 pr-8">
                <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/15 ring-2 ring-primary/30">
                  <span className="text-sm font-black tracking-tight text-primary">HV</span>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground/90">HiperVerso</span>
                    <Badge className="bg-primary/15 text-primary border-primary/30 rounded-full text-[10px] px-2 py-0 font-medium inline-flex items-center gap-1">
                      {current.icon}
                      <span>{current.badge}</span>
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Passo {step + 1} de {steps.length}
                  </p>
                </div>
              </div>

              <DialogTitle className="text-lg font-bold leading-snug pt-1">
                {current.title}
              </DialogTitle>
            </DialogHeader>
          </div>

          <div className="p-6 space-y-5">
            <DialogDescription className="text-sm leading-relaxed text-foreground/90">
              {current.description}
            </DialogDescription>

            <div className="rounded-2xl border border-border/70 bg-secondary/25 p-3.5 space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Destaques
              </p>
              <div className="flex flex-wrap gap-1.5">
                {current.highlights.map((item) => (
                  <span
                    key={item}
                    className="inline-flex items-center gap-1 rounded-full border border-primary/35 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                  >
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-1.5">
                {steps.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    aria-label={`Ir para o passo ${idx + 1}`}
                    onClick={() => {
                      haptics.select();
                      setStep(idx);
                    }}
                    className={cn(
                      'h-1.5 rounded-full transition-all cursor-pointer',
                      idx === step
                        ? 'w-6 bg-primary'
                        : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60'
                    )}
                  />
                ))}
              </div>

              <div className="flex items-center gap-2">
                {step > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-full h-9 px-3 text-xs"
                    onClick={() => {
                      haptics.select();
                      setStep((s) => s - 1);
                    }}
                  >
                    <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Voltar
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-full h-9 px-3 text-xs text-muted-foreground"
                    onClick={dismissAll}
                  >
                    Pular
                  </Button>
                )}

                {!isLast ? (
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-full h-9 px-4 text-xs font-semibold"
                    onClick={() => {
                      haptics.select();
                      setStep((s) => s + 1);
                    }}
                  >
                    Próximo <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full h-9 px-3.5 text-xs"
                      asChild
                      onClick={dismissAll}
                    >
                      <Link href={`/${locale}/download`}>
                        <Download className="mr-1.5 h-3.5 w-3.5" /> App
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      className="rounded-full h-9 px-4 text-xs font-semibold"
                      asChild
                      onClick={dismissAll}
                    >
                      <Link href={`/${locale}/register`}>Criar conta</Link>
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function KeysQuickTour() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (localStorage.getItem(KEYS_STORAGE_KEY) !== '1') {
        setOpen(true);
      }
    } catch {
      // ignore
    }
  }, []);

  const closeAndRemember = () => {
    try {
      localStorage.setItem(KEYS_STORAGE_KEY, '1');
    } catch {
      // ignore
    }
    setOpen(false);
  };

  const steps: TourStep[] = [
    {
      badge: 'Cofre 2FA',
      title: 'Guarde seus códigos 2FA por QR Code',
      description:
        'Toque em "Ler QR Code" e aponte a câmera para o QR da Microsoft, Google, GitHub ou qualquer serviço compatível.',
      highlights: ['Leitura por câmera', 'Chave manual opcional', 'Códigos de 6 dígitos'],
      icon: <QrCode className="h-5 w-5 text-primary" />,
    },
    {
      badge: 'Acesso Rápido',
      title: 'Biometria e outros aparelhos',
      description:
        'Ative sua digital para entrar em 1 toque e aprove o login do seu computador ou de outro celular sem digitar senha.',
      highlights: ['Passkeys / Digital', 'Pareamento entre telas', 'Alerta imediato'],
      icon: <Fingerprint className="h-5 w-5 text-primary" />,
    },
    {
      badge: 'Backup Seguro',
      title: 'Exporte e importe quando trocar de aparelho',
      description:
        'Na aba "Avançado" você exporta seu cofre protegido por senha e restaura tudo em segundos no celular novo.',
      highlights: ['Criptografia por senha', 'Portabilidade total', 'Controle 100% seu'],
      icon: <ShieldCheck className="h-5 w-5 text-primary" />,
    },
  ];

  const current = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 rounded-full gap-1.5 px-3 text-xs border-primary/35 text-primary hover:bg-primary/10"
        onClick={() => {
          haptics.select();
          setStep(0);
          setOpen(true);
        }}
      >
        <KeyRound className="h-3.5 w-3.5" />
        Como usar
      </Button>

      <Dialog open={open} onOpenChange={(next) => !next && closeAndRemember()}>
        <DialogContent className="w-[calc(100%-1.5rem)] sm:max-w-md max-h-[90dvh] flex flex-col rounded-2xl border-border/80 bg-card/95 backdrop-blur-xl p-0 overflow-hidden">
          <div className="shrink-0 bg-gradient-to-br from-primary/20 via-primary/5 to-transparent px-5 sm:px-6 pt-5 sm:pt-6 pb-4 border-b border-border/60">
            <DialogHeader className="space-y-3 text-left">
              <div className="flex items-center gap-3 pr-8">
                <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/15 ring-2 ring-primary/30">
                  {current.icon}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground/90">Chaves e Segurança</span>
                    <Badge className="bg-primary/15 text-primary border-primary/30 rounded-full text-[10px] px-2 py-0 font-medium">
                      {current.badge}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Passo {step + 1} de {steps.length}
                  </p>
                </div>
              </div>

              <DialogTitle className="text-lg font-bold leading-snug pt-1">
                {current.title}
              </DialogTitle>
            </DialogHeader>
          </div>

          <div className="p-6 space-y-5">
            <DialogDescription className="text-sm leading-relaxed text-foreground/90">
              {current.description}
            </DialogDescription>

            <div className="rounded-2xl border border-border/70 bg-secondary/25 p-3.5 space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Na prática
              </p>
              <div className="flex flex-wrap gap-1.5">
                {current.highlights.map((item) => (
                  <span
                    key={item}
                    className="inline-flex items-center gap-1 rounded-full border border-primary/35 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                  >
                    <Sparkles className="h-3 w-3 shrink-0" />
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-1.5">
                {steps.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    aria-label={`Ir para o passo ${idx + 1}`}
                    onClick={() => {
                      haptics.select();
                      setStep(idx);
                    }}
                    className={cn(
                      'h-1.5 rounded-full transition-all cursor-pointer',
                      idx === step
                        ? 'w-6 bg-primary'
                        : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60'
                    )}
                  />
                ))}
              </div>

              <div className="flex items-center gap-2">
                {step > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-full h-9 px-3 text-xs"
                    onClick={() => {
                      haptics.select();
                      setStep((s) => s - 1);
                    }}
                  >
                    <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Voltar
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-full h-9 px-3 text-xs text-muted-foreground"
                    onClick={closeAndRemember}
                  >
                    Pular
                  </Button>
                )}

                {!isLast ? (
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-full h-9 px-4 text-xs font-semibold"
                    onClick={() => {
                      haptics.select();
                      setStep((s) => s + 1);
                    }}
                  >
                    Próximo <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-full h-9 px-4 text-xs font-semibold"
                    onClick={closeAndRemember}
                  >
                    Começar a usar
                  </Button>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

const MEMBER_WELCOME_KEY_PREFIX = 'exelula_member_welcome_v1:';

export function MemberWelcomeTour({ user }: { user: User | null | undefined }) {
  const locale = useLocale();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user?.id || typeof window === 'undefined') return;
    const isAuthPage = Boolean(pathname && /\/(login|register|auth)(\/|$)/.test(pathname));
    if (isAuthPage) return;

    const params = new URLSearchParams(window.location.search);
    const hasWelcomeParam = params.get('welcome') === '1';
    const seenKey = `${MEMBER_WELCOME_KEY_PREFIX}${user.id}`;
    const alreadySeen = window.localStorage.getItem(seenKey) === '1';

    if (hasWelcomeParam || !alreadySeen) {
      setOpen(true);
      if (hasWelcomeParam) {
        params.delete('welcome');
        const nextQuery = params.toString();
        const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`;
        window.history.replaceState({}, '', nextUrl);
      }
    }
  }, [user?.id, pathname]);

  const handleClose = () => {
    if (user?.id && typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(`${MEMBER_WELCOME_KEY_PREFIX}${user.id}`, '1');
      } catch {
        // ignore
      }
    }
    setOpen(false);
  };

  if (!user) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="w-[calc(100%-1.5rem)] max-w-[440px] max-h-[90dvh] flex flex-col gap-0 overflow-hidden rounded-3xl border border-border/80 bg-card p-0 shadow-2xl"
      >
        <div className="relative shrink-0 overflow-hidden border-b border-border/60 bg-[radial-gradient(120%_100%_at_0%_0%,hsl(var(--primary)/0.2),transparent_65%)] px-4 sm:px-5 pt-4 sm:pt-5 pb-3.5 sm:pb-4">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/35 bg-emerald-500/15 px-3 py-0.5 text-[11px] font-semibold text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Você está conectado(a)!
            </span>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Fechar boas-vindas"
              className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <Avatar className="h-12 w-12 shrink-0 overflow-hidden rounded-full ring-2 ring-primary/50">
              <AvatarImage
                src={user.avatarUrl}
                alt={user.name}
                className="h-full w-full object-cover"
              />
              <AvatarFallback className="text-lg font-bold">
                {user.name?.slice(0, 1) || '?'}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base sm:text-lg font-extrabold text-foreground truncate">
                Olá, {user.name}!
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground truncate">
                @{user.username}
                {(user as User & { federatedLoginHandle?: string }).federatedLoginHandle
                  ? ` · ${(user as User & { federatedLoginHandle?: string }).federatedLoginHandle}`
                  : ''}
              </DialogDescription>
            </div>
          </div>

          {/* Barra P2P para trocar ou conectar mais contas em 1 toque (inclusive no celular!) */}
          <div className="mt-3">
            <UniverseLensBar
              userId={user.id}
              name={user.name}
              avatarUrl={user.avatarUrl}
              username={user.username}
              federatedLoginProvider={
                (user as User & { federatedLoginProvider?: string }).federatedLoginProvider
              }
              federatedLoginHandle={
                (user as User & { federatedLoginHandle?: string }).federatedLoginHandle
              }
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-2.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Por onde começar em 1 toque:
          </p>

          <Link
            href={`/${locale}/explore`}
            onClick={handleClose}
            className="flex items-center justify-between gap-3 rounded-2xl border border-primary/35 bg-primary/10 p-3 transition-colors hover:border-primary hover:bg-primary/15"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-bold text-foreground truncate">
                  Explorar a Rede &amp; Assuntos
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  Descubra perfis, notícias e conversas em destaque
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-primary" />
          </Link>

          <Link
            href={`/${locale}/messages`}
            onClick={handleClose}
            className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-muted/25 p-3 transition-colors hover:border-primary/50 hover:bg-muted/40"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted border border-border">
                <MessageSquare className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-bold text-foreground truncate">
                  Suas Mensagens &amp; Chat P2P
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  Ver conversas diretas e grupos ativos
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>

          <Link
            href={`/${locale}/profile/${user.id}`}
            onClick={handleClose}
            className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-muted/25 p-3 transition-colors hover:border-primary/50 hover:bg-muted/40"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted border border-border">
                <UserIcon className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-bold text-foreground truncate">
                  Seu Perfil (@{user.username})
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  Personalizar bio, foto, pronome e chave Pix
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>

          <div className="pt-2">
            <Button
              type="button"
              onClick={handleClose}
              className="w-full rounded-full h-10 text-xs sm:text-sm font-bold"
            >
              Ir para o Feed agora
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


