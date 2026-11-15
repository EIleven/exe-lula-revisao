
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import PullToRefresh from './PullToRefresh';
import { Button } from '@/components/ui/button';
import { ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FeedContainerProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  hasNewPosts?: boolean;
}

/** Depois de rolar isto (px) aparece o botão de voltar ao topo. */
const SHOW_SCROLL_TOP_AFTER = 300;

export default function FeedContainer({ onRefresh, children, hasNewPosts = false }: FeedContainerProps) {
  const scrollTopButtonRef = useRef<HTMLButtonElement>(null);
  const isMobile = useIsMobile();
  const [isSmallScreen, setIsSmallScreen] = useState(isMobile);

  useEffect(() => {
    const update = () => {
      setIsSmallScreen(isMobile || window.innerWidth < 1024);
    };
    update();
    window.addEventListener('resize', update, { passive: true });
    return () => window.removeEventListener('resize', update);
  }, [isMobile]);

  // Puxar para atualizar em telas pequenas (veja usePullToRefresh: passivo, sem touch-action, resistência, limiar único, tique ao
  // armar e toque cancelado). O contêiner não muda mais conforme a posição da página: a rolagem vertical é sempre nativa.
  const { containerRef, indicatorRef, isRefreshing, refresh } = usePullToRefresh<HTMLDivElement>({
    onRefresh,
    enabled: isSmallScreen,
  });

  useEffect(() => {
    // A rolagem não passa pelo React. Alternar estado aqui redesenhava sete componentes
    // toda vez que o dedo cruzava 300 px (40 commits no teste de inversões).
    const handleScroll = () => {
      const button = scrollTopButtonRef.current;
      if (!button) return;
      const shouldShow = window.scrollY > SHOW_SCROLL_TOP_AFTER;
      if ((button.dataset.visible === 'true') === shouldShow) return;
      button.dataset.visible = shouldShow ? 'true' : 'false';
      button.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
      button.tabIndex = shouldShow ? 0 : -1;
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTopAndRefresh = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    void refresh();
  };

  return (
    <div ref={containerRef} className="relative">
      {isSmallScreen && <PullToRefresh isRefreshing={isRefreshing} indicatorRef={indicatorRef} />}
      {children}

      <div className={cn(
        "fixed inset-0 top-auto z-50 pointer-events-none",
        "md:group-data-[state=closed]/sidebarlayout:pl-20 md:group-data-[state=open]/sidebarlayout:pl-72 transition-all duration-150 ease-in-out"
      )}>
        <div className="relative h-full w-full">
            <Button
              ref={scrollTopButtonRef}
              variant="default"
              size="icon"
              className={cn(
                "absolute bottom-20 scale-90 rounded-full opacity-0 shadow-lg transition-all duration-150 pointer-events-none",
                "left-4 md:left-auto md:right-8",
                hasNewPosts ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground border',
                // Escondido, o botão também deixa de receber toque: um toque perdido naquele canto da tela não pode
                // voltar ao topo e atualizar o feed sem querer.
                "data-[visible=true]:scale-100 data-[visible=true]:opacity-100 data-[visible=true]:pointer-events-auto"
              )}
              onClick={scrollToTopAndRefresh}
              aria-label="Scroll to top and refresh"
              aria-hidden="true"
              data-visible="false"
              tabIndex={-1}
            >
              <ArrowUp className="h-6 w-6" />
            </Button>
        </div>
      </div>
    </div>
  );
}
