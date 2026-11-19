// src/components/shared/ContentWarningGate.tsx
'use client';

import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useSensitiveMediaVisibility } from '@/components/shared/SensitiveMediaCover';
import { cn } from '@/lib/utils';

interface ContentWarningGateProps {
  /** O aviso escrito pelo AUTOR (`summary`/CW do Fediverso). Sem ele o conteúdo passa direto. */
  warning?: string | null;
  /** Reinicia o estado ao trocar de post. */
  contentKey?: string | null;
  className?: string;
  children: React.ReactNode;
}

/**
 * O aviso de conteúdo (CW) do Fediverso aplicado ao TEXTO.
 *
 * A diferença entre os dois sinais importa e é a convenção que o Mastodon, o Pleroma e o Misskey seguem:
 * `sensitive` sozinho cobre só a MÍDIA (ver SensitiveMediaCover); um `summary` escrito é um aviso sobre o CONTEÚDO
 * inteiro, e aí o texto também fica coberto até a pessoa escolher ler. Mostrar o texto de um relato que veio com aviso
 * é desrespeitar quem escreveu e quem lê.
 *
 * Sem aviso, não há capa nenhuma: o conteúdo é renderizado como sempre, sem nó extra na árvore.
 */
export default function ContentWarningGate({ warning, contentKey, className, children }: ContentWarningGateProps) {
  const t = useTranslations('PostContent');
  const aviso = typeof warning === 'string' ? warning.trim() : '';
  const { hidden, reveal } = useSensitiveMediaVisibility(aviso.length > 0, contentKey);

  if (!aviso || !hidden) return <>{children}</>;

  return (
    <div
      className={cn('my-1.5 rounded-lg border border-border bg-muted/40 p-3', className)}
      data-testid="content-warning-gate"
      data-interactive="true"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        <p className="min-w-0 flex-1 break-words text-sm font-medium text-foreground">{aviso}</p>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-2 h-7 px-2.5 text-xs"
        onClick={(event) => {
          event.stopPropagation();
          reveal();
        }}
      >
        {t('showSensitive')}
      </Button>
    </div>
  );
}
