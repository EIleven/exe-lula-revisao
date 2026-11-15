
'use client';

import React from 'react';
import { ArrowDown, Loader2 } from 'lucide-react';

interface PullToRefreshProps {
  isRefreshing: boolean;
  /**
   * O elemento do indicador. A posição e a opacidade são escritas direto nele por `usePullToRefresh` (um quadro por vez,
   * sem estado do React a cada movimento do dedo); aqui só ficam a aparência e o que muda quando o gesto "arma".
   */
  indicatorRef: React.Ref<HTMLDivElement>;
}

export default function PullToRefresh({ isRefreshing, indicatorRef }: PullToRefreshProps) {
  return (
    <div
      ref={indicatorRef}
      className="group absolute -top-12 left-0 right-0 z-40 flex h-12 items-center justify-center opacity-0 pointer-events-none"
      data-testid="pull-to-refresh"
      data-armed="false"
      data-refreshing={isRefreshing ? 'true' : 'false'}
      aria-hidden="true"
    >
      <div className="bg-card p-2 rounded-full shadow-lg border border-border">
        {isRefreshing ? (
          <Loader2 className="h-6 w-6 text-primary animate-spin" />
        ) : (
          <ArrowDown className="h-6 w-6 text-muted-foreground transition-transform duration-150 group-data-[armed=true]:rotate-180" />
        )}
      </div>
    </div>
  );
}
