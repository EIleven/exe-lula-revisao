// src/components/shared/TranslateActionLine.tsx
'use client';

import React from 'react';
import { Globe, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TranslateActionLineProps {
  canTranslate: boolean;
  isTranslating: boolean;
  isTranslated: boolean;
  targetLabel: string;
  detectedSource?: string | null;
  hasError?: boolean;
  onToggle: (e: React.MouseEvent) => void;
  className?: string;
}

export default function TranslateActionLine({
  canTranslate,
  isTranslating,
  isTranslated,
  targetLabel,
  detectedSource,
  hasError,
  onToggle,
  className,
}: TranslateActionLineProps) {
  if (!canTranslate) return null;

  return (
    <div className={cn('mt-1 mb-2 flex items-center gap-2 text-xs', className)} data-interactive="true">
      <button
        type="button"
        onClick={onToggle}
        disabled={isTranslating}
        className="inline-flex items-center gap-1.5 text-primary/90 hover:text-primary hover:underline transition-colors font-medium cursor-pointer disabled:opacity-60"
      >
        {isTranslating ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Traduzindo…</span>
          </>
        ) : isTranslated ? (
          <>
            <Globe className="h-3 w-3" />
            <span>
              Traduzido{detectedSource && detectedSource !== 'auto' && detectedSource !== 'other' ? ` de ${detectedSource.toUpperCase()}` : ''} · Ver original
            </span>
          </>
        ) : (
          <>
            <Globe className="h-3 w-3" />
            <span>Traduzir para {targetLabel}</span>
          </>
        )}
      </button>
      {hasError && !isTranslating && (
        <span className="text-[11px] text-muted-foreground">Falha ao traduzir</span>
      )}
    </div>
  );
}
