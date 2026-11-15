'use client';

// Escolha de alcance do post no Fediverso, no compositor. Só aparece para quem ativou a federação (e não pausou): quem
// não usa o Fediverso não vê nada novo. O padrão é SEMPRE "só aqui": federar é uma escolha a cada post.
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Check, ChevronDown, Globe, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { FEDERATION_REACHES, isFederatedReach } from '@/lib/federation/reach';
import type { FederationReach } from '@/lib/federation/reach';
import { useFederationAvailability } from '@/lib/federation/useFederationAvailability';

type Props = {
  value: FederationReach;
  onChange: (value: FederationReach) => void;
  /** Enquete e citação ainda não federam: o controle mostra o porquê em vez de esconder a escolha. */
  blockedReason?: 'poll' | 'quote' | null;
  disabled?: boolean;
};

export default function FederationReachControl({ value, onChange, blockedReason = null, disabled = false }: Props) {
  const t = useTranslations('Fediverse.reach');
  const locale = useLocale();
  const isMobile = useIsMobile();
  const { firebaseUser, currentUser } = useCurrentUser();
  const { available } = useFederationAvailability(firebaseUser);
  if (!available) return null;

  // Perfil privado: o alcance de fora nunca é maior que o de dentro (as regras do Firestore também exigem).
  const perfilPrivado = currentUser?.profileVisibility === 'private';
  const efetivo: FederationReach = blockedReason ? 'local' : value;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className={cn('h-9 gap-1 rounded-full px-2.5', isFederatedReach(efetivo) && 'text-primary')} aria-label={t('menuLabel')} disabled={disabled} data-testid="federation-reach-trigger">
          <Globe className="h-4 w-4" />
          {!isMobile && <span className="max-w-28 truncate text-xs">{t(`short.${efetivo}`)}</span>}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div>
          <p className="font-medium">{t('menuTitle')}</p>
          <p className="text-xs text-muted-foreground">{blockedReason ? t(`blocked.${blockedReason}`) : t('menuDescription')}</p>
        </div>
        <div role="radiogroup" aria-label={t('menuTitle')} className="space-y-1">
          {FEDERATION_REACHES.map((r) => {
            const indisponivel = Boolean(blockedReason) && r !== 'local' || (perfilPrivado && (r === 'public' || r === 'unlisted'));
            const marcado = efetivo === r;
            return (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={marcado}
                disabled={indisponivel}
                onClick={() => onChange(r)}
                data-testid={`federation-reach-${r}`}
                className={cn('flex w-full items-start gap-3 rounded-lg border p-2.5 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50', marcado && 'border-primary bg-accent')}
              >
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">{marcado ? <Check className="h-4 w-4 text-primary" /> : r === 'local' ? <Lock className="h-3.5 w-3.5 text-muted-foreground" /> : <Globe className="h-3.5 w-3.5 text-muted-foreground" />}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t(`option.${r}.title`)}</span>
                  <span className="block text-xs text-muted-foreground">{t(`option.${r}.description`)}</span>
                </span>
              </button>
            );
          })}
        </div>
        {perfilPrivado && <p className="text-xs text-muted-foreground">{t('privateProfile')}</p>}
        {isFederatedReach(efetivo) && <p className="text-xs text-muted-foreground">{t('copiesWarning')}</p>}
        <Link href={`/${locale}/settings/fediverse`} className="block text-xs underline">{t('manage')}</Link>
      </PopoverContent>
    </Popover>
  );
}
