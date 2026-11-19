// src/components/shared/SensitiveMediaCover.tsx
'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldAlert, Settings2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useCurrentUserId, useCurrentUserSelector } from '@/contexts/CurrentUserContext';
import { cn } from '@/lib/utils';

export function useSensitiveMediaVisibility(sensitive?: boolean, contentKey?: string | null) {
  const alwaysShowSensitive = useCurrentUserSelector((state) => state.currentUser?.displaySensitiveContent === true);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setRevealed(false);
  }, [contentKey]);

  const isSensitive = sensitive === true;
  const hidden = isSensitive && !alwaysShowSensitive && !revealed;

  return {
    isSensitive,
    alwaysShowSensitive,
    revealed,
    hidden,
    reveal: () => setRevealed(true),
  };
}

interface SensitiveMediaCoverProps {
  sensitive?: boolean;
  /** Aviso escrito pelo AUTOR (`summary`/CW). Quando existe, aparece no lugar do texto genérico. */
  warning?: string | null;
  contentKey?: string | null;
  compact?: boolean;
  className?: string;
  onRevealChange?: (revealed: boolean) => void;
  children: React.ReactNode | ((hidden: boolean) => React.ReactNode);
}

/**
 * Capa padronizada para mídias marcadas como conteúdo sensível (posts, comentários, citações e Fediverso).
 * Enquanto oculta, os componentes filhos não montam imagens nem vídeos quando passados como JSX direto
 * (ou recebem `hidden=true` no render prop para manter proporções sem baixar a mídia).
 */
export default function SensitiveMediaCover({
  sensitive,
  warning,
  contentKey,
  compact = false,
  className,
  onRevealChange,
  children,
}: SensitiveMediaCoverProps) {
  const locale = useLocale();
  const contentT = useTranslations('PostContent');
  const currentUserId = useCurrentUserId();
  const { hidden, reveal } = useSensitiveMediaVisibility(sensitive, contentKey);

  const handleReveal = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    reveal();
    onRevealChange?.(true);
  };

  if (!hidden) {
    return <>{typeof children === 'function' ? children(false) : children}</>;
  }

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border border-border bg-muted/40',
        typeof children !== 'function' && (compact ? 'min-h-[132px]' : 'min-h-[196px]'),
        className,
      )}
    >
      {typeof children === 'function' ? children(true) : null}
      <div
        className={cn(
          'absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/85 backdrop-blur-md text-center',
          compact ? 'gap-1.5 p-3' : 'gap-2.5 p-5',
        )}
        data-testid="sensitive-cover"
        onClick={(event) => event.stopPropagation()}
        data-interactive="true"
      >
        <div
          className={cn(
            'flex items-center justify-center rounded-full bg-destructive/15 text-destructive',
            compact ? 'h-8 w-8' : 'h-11 w-11',
          )}
        >
          <ShieldAlert className={compact ? 'h-4 w-4' : 'h-6 w-6'} aria-hidden="true" />
        </div>
        <p className={cn('max-w-sm break-words font-semibold text-foreground', compact ? 'text-xs' : 'text-sm')}>
          {/* O aviso do autor manda: só sem ele entra o texto genérico da casa. */}
          {typeof warning === 'string' && warning.trim() ? warning.trim() : contentT('sensitiveWarning')}
        </p>
        {!compact && (
          <p className="max-w-sm text-xs text-muted-foreground">{contentT('sensitiveHint')}</p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-2 pt-0.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className={compact ? 'h-7 px-2.5 text-xs' : undefined}
            onClick={handleReveal}
          >
            {contentT('showSensitive')}
          </Button>
          {!compact && currentUserId && (
            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 text-xs text-muted-foreground" asChild>
              <Link href={`/${locale}/settings/media`} onClick={(event) => event.stopPropagation()}>
                <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                {contentT('sensitiveSettingsLink')}
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

