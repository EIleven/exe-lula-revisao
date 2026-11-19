'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Globe } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { isFederatedReach } from '@/lib/federation/reach';
import type { FederationReach } from '@/lib/federation/reach';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { useFederationAvailability } from '@/lib/federation/useFederationAvailability';

interface FederationBadgeProps {
  reach?: FederationReach | null;
  isRemote?: boolean;
  remoteHandle?: string | null;
  remoteDomain?: string | null;
}

/** Selo interativo de que o post ou perfil participa do Fediverso (enviado ou vindo de fora). Não aparece em posts locais. */
export default function FederationBadge({
  reach,
  isRemote = false,
  remoteHandle,
  remoteDomain,
}: FederationBadgeProps) {
  const t = useTranslations('Fediverse.reach');
  const locale = useLocale();
  const { firebaseUser } = useCurrentUser();
  const { loaded, available, acct } = useFederationAvailability(firebaseUser);
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!isRemote && !isFederatedReach(reach)) return null;

  const cleanHandle = remoteHandle ? remoteHandle.replace(/^@/, '') : null;
  const resolvedDomain = remoteDomain || (cleanHandle?.includes('@') ? cleanHandle.split('@')[1] : null);
  const rotulo = isRemote
    ? (resolvedDomain ? `Vem do Fediverso (${resolvedDomain})` : 'Vem do Fediverso')
    : t(`badge.${reach!}`);
  const cancelarFechamento = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  const agendarFechamento = () => {
    cancelarFechamento();
    closeTimerRef.current = setTimeout(() => setOpen(false), 160);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-interactive="true"
          data-testid="federation-badge"
          aria-label={rotulo}
          title={rotulo}
          onMouseEnter={() => {
            cancelarFechamento();
            setOpen(true);
          }}
          onMouseLeave={agendarFechamento}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((prev) => !prev);
          }}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Globe className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={6}
        data-interactive="true"
        onMouseEnter={cancelarFechamento}
        onMouseLeave={agendarFechamento}
        onClick={(e) => e.stopPropagation()}
        className="w-72 space-y-2.5 p-3.5 text-xs shadow-lg"
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Globe className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <p className="font-semibold text-foreground leading-tight">{rotulo}</p>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          {isRemote ? (
            <>
              Conteúdo federado{cleanHandle ? <> de <strong className="text-foreground">@{cleanHandle}</strong></> : null} conectado ao HiperVerso via protocolo aberto ActivityPub.
            </>
          ) : (
            'Este post circula no Fediverso (Mastodon, Misskey e outros servidores abertos conectados ao HiperVerso).'
          )}
        </p>
        <div className="rounded-md bg-muted/60 px-2.5 py-2 text-[11px] leading-relaxed text-foreground">
          {loaded && available && acct ? (
            <span>
              Sua conta já está ativa no Fediverso como{' '}
              <strong className="font-mono text-primary">@{acct}</strong>.
            </span>
          ) : (
            <span>
              Você também pode ativar seu <strong className="text-primary">@usuario@hiperverso.social</strong> e escolher quando federar seus posts.
            </span>
          )}
        </div>
        <Link
          href={`/${locale}/settings/fediverse`}
          data-interactive="true"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
          }}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <span>{loaded && available ? 'Gerenciar meu Fediverso' : 'Entrar e configurar Fediverso'}</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </PopoverContent>
    </Popover>
  );
}
