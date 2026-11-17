// src/components/feed/FeedContainer.tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import PullToRefresh from './PullToRefresh';
import { Button } from '@/components/ui/button';
import { ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  registerFeedScrollTarget,
  scrollToTopSmoothly,
  unregisterFeedScrollTarget,
} from '@/lib/feedScrollTop';

interface FeedContainerProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  hasNewPosts?: boolean;
}

/** Depois de rolar isto (px) aparece o botão de voltar ao topo. */
const SHOW_SCROLL_TOP_AFTER = 300;

export default function FeedContainer({ onRefresh, children, hasNewPosts = false }: FeedContainerProps) {
  const scrollTopButtonRef = useRef<HTMLButtonElement>(null);
  const registrationKeyRef = useRef<symbol | null>(null);
  if (!registrationKeyRef.current) {
    registrationKeyRef.current = Symbol('feed-scroll-target');
  }
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

  const hasNewPostsRef = useRef(hasNewPosts);
  hasNewPostsRef.current = hasNewPosts;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const key = registrationKeyRef.current!;
    registerFeedScrollTarget(key, {
      hasNewPosts,
      onRefresh: () => refreshRef.current(),
    });
    return () => {
      unregisterFeedScrollTarget(key);
    };
  }, [hasNewPosts]);

  useEffect(() => {
    // A rolagem não passa pelo React e usa requestAnimationFrame para não disparar trabalho em excesso.
    let rafId = 0;
    const syncVisibility = () => {
      rafId = 0;
      const button = scrollTopButtonRef.current;
      if (!button) return;
      const shouldShow = window.scrollY > SHOW_SCROLL_TOP_AFTER;
      if ((button.dataset.visible === 'true') === shouldShow) return;
      button.dataset.visible = shouldShow ? 'true' : 'false';
      button.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
      button.tabIndex = shouldShow ? 0 : -1;
    };
    const handleScroll = () => {
      if (rafId !== 0) return;
      rafId = window.requestAnimationFrame(syncVisibility);
    };
    syncVisibility();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafId !== 0) window.cancelAnimationFrame(rafId);
    };
  }, []);

  const handleMobileScrollTop = () => {
    scrollToTopSmoothly({
      hasNewPosts: hasNewPostsRef.current,
      onRefresh: () => refreshRef.current(),
    });
  };

  const mobileLabel = hasNewPosts ? 'Voltar ao topo e ver novos posts' : 'Voltar ao topo';

  return (
    <div ref={containerRef} className="relative">
      {isSmallScreen && <PullToRefresh isRefreshing={isRefreshing} indicatorRef={indicatorRef} />}
      {children}

      {/* Mobile (< 800px): em telas médias e grandes (>= 800px) o botão fica ancorado dentro da barra lateral esquerda. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 min-[800px]:hidden">
        <div className="relative px-4">
          <Button
            ref={scrollTopButtonRef}
            type="button"
            variant={hasNewPosts ? 'default' : 'secondary'}
            size="icon"
            className={cn(
              'relative h-11 w-11 scale-90 rounded-full opacity-0 shadow-lg transition-all duration-200 pointer-events-none',
              hasNewPosts
                ? 'bg-primary text-primary-foreground ring-2 ring-primary/25'
                : 'bg-card/95 backdrop-blur-md text-foreground border border-border',
              // Escondido, o botão também deixa de receber toque: um toque perdido naquele canto da tela não pode
              // voltar ao topo sem querer.
              'data-[visible=true]:scale-100 data-[visible=true]:opacity-100 data-[visible=true]:pointer-events-auto',
            )}
            onClick={handleMobileScrollTop}
            aria-label={mobileLabel}
            title={mobileLabel}
            aria-hidden="true"
            data-visible="false"
            tabIndex={-1}
          >
            <ArrowUp className="h-5 w-5" aria-hidden="true" />
            {hasNewPosts && (
              <span
                className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-background"
                aria-hidden="true"
              />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
