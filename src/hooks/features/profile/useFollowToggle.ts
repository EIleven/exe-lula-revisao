// src/hooks/features/profile/useFollowToggle.ts
'use client';

import { useEffect, useRef, useState } from 'react';
import { setFollowUser } from '@/lib/services/userService';
import { useOptimisticToggle } from '@/hooks/useOptimisticToggle';
import {
  dispatchFollowState,
  FOLLOW_STATE_EVENT,
  getCachedFollowState,
  type FollowStateEventDetail,
} from '@/lib/events/followState';

interface FollowView {
  isFollowing: boolean;
  followersCount: number;
}

interface UseFollowToggleOptions {
  /** Quem está logado (sem login, o botão leva ao login e não chega aqui). */
  activeUserId: string | null;
  targetUserId: string;
  /** O que a tela de origem sabe agora (muda quando a lista ou o perfil são recarregados). */
  isFollowing: boolean | undefined;
  followersCount: number | undefined;
  onFailure: (error: unknown) => void;
  /** A fila terminou de gravar: `view` é o estado que ficou (seguindo ou não, e o contador esperado). */
  onSettled?: (view: FollowView) => void;
}

/**
 * Seguir / deixar de seguir com resposta IMEDIATA, para os botões que mostram uma pessoa em lista ou cartão (o perfil usa
 * o mesmo motor direto sobre o usuário carregado, em useUserProfile). O toque muda o botão e o contador no mesmo instante;
 * a gravação segue em segundo plano, sempre do estado final; se o servidor recusar (bloqueio, sem rede), volta ao que era.
 * Antes o botão ficava desabilitado, com ícone de espera, durante 3 a 4 idas ao servidor.
 */
export function useFollowToggle({ activeUserId, targetUserId, isFollowing, followersCount, onFailure, onSettled }: UseFollowToggleOptions) {
  const cached = getCachedFollowState(activeUserId, targetUserId);
  const [view, setView] = useState<FollowView>({
    isFollowing: cached ? cached.isFollowing : !!isFollowing,
    followersCount: cached?.followersCount ?? followersCount ?? 0,
  });
  const viewRef = useRef(view);
  viewRef.current = view;
  const activeUserIdRef = useRef(activeUserId);
  activeUserIdRef.current = activeUserId;
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;

  const toggler = useOptimisticToggle<FollowView>(() => viewRef.current, setView, {
    read: (v) => ({ active: v.isFollowing, count: v.followersCount }),
    write: (_v, s) => ({ isFollowing: s.active, followersCount: s.count }),
    persist: (desired) => setFollowUser(activeUserIdRef.current as string, targetUserId, desired),
    assumeServerAfterWrite: true, // não há listener ao vivo: depois de gravar, o estado esperado vale como o do servidor
    onFailure,
    onSettled: (finalState) => {
      const current = viewRef.current;
      const next: FollowView = current.isFollowing === finalState
        ? current
        : {
            isFollowing: finalState,
            followersCount: Math.max(0, current.followersCount + (finalState ? 1 : -1)),
          };
      viewRef.current = next;
      setView((previous) => previous.isFollowing === next.isFollowing
        && previous.followersCount === next.followersCount ? previous : next);
      if (activeUserIdRef.current) {
        dispatchFollowState({
          activeUserId: activeUserIdRef.current,
          targetUserId,
          isFollowing: next.isFollowing,
          followersCount: next.followersCount,
        });
      }
      settledRef.current?.(next);
    },
  });

  const reconcile = toggler.reconcile;
  useEffect(() => {
    const latestCached = getCachedFollowState(activeUserId, targetUserId);
    const shown = reconcile({
      isFollowing: latestCached ? latestCached.isFollowing : !!isFollowing,
      followersCount: latestCached?.followersCount ?? followersCount ?? viewRef.current.followersCount,
    });
    setView((prev) => (shown.isFollowing === prev.isFollowing && shown.followersCount === prev.followersCount ? prev : shown));
  }, [activeUserId, targetUserId, isFollowing, followersCount, reconcile]);

  useEffect(() => {
    if (!activeUserId || !targetUserId) return;
    const onFollowEvent = (event: Event) => {
      const detail = (event as CustomEvent<FollowStateEventDetail>).detail;
      if (detail.activeUserId !== activeUserId || detail.targetUserId !== targetUserId) return;
      const shown = reconcile({
        isFollowing: detail.isFollowing,
        followersCount: detail.followersCount ?? viewRef.current.followersCount,
      });
      setView((prev) => (shown.isFollowing === prev.isFollowing && shown.followersCount === prev.followersCount ? prev : shown));
    };
    window.addEventListener(FOLLOW_STATE_EVENT, onFollowEvent);
    return () => window.removeEventListener(FOLLOW_STATE_EVENT, onFollowEvent);
  }, [activeUserId, targetUserId, reconcile]);

  return { isFollowing: view.isFollowing, followersCount: view.followersCount, toggle: toggler.toggle };
}
