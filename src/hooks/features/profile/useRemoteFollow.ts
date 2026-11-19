// src/hooks/features/profile/useRemoteFollow.ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FOLLOW_STATE_EVENT, getCachedFollowState, type FollowStateEventDetail } from '@/lib/events/followState';
import { callRemoteFollow, viewOfFlags, type RemoteFollowResult, type RemoteFollowView } from '@/lib/federation/remoteFollowClient';

type Options = {
  activeUserId: string | null;
  /** O id local do perfil remoto (`ap_…`). */
  targetUserId: string;
  handle?: string;
  isFollowing?: boolean | null;
  followRequested?: boolean | null;
  /** O perfil aprova seguidores manualmente? `null`/`undefined` = não se sabe (o servidor descobre ao seguir). */
  closed?: boolean | null;
  onChange?: (view: RemoteFollowView, result: RemoteFollowResult, anterior: RemoteFollowView) => void;
  onError?: (error: unknown) => void;
};

/**
 * Seguir um perfil do Fediverso com TRÊS estados (não seguindo · solicitação enviada · seguindo), porque perfil fechado só vira "seguindo"
 * quando a pessoa de lá aceita. Perfil sabidamente aberto responde na hora (otimista, e desfaz se o servidor recusar); perfil fechado, ou
 * que ainda não se sabe se é, espera o servidor dizer (com `busy` na tela) em vez de mostrar um "Seguindo" que pode não valer.
 * Os outros botões do mesmo perfil acompanham pelo evento de estado de follow.
 */
export function useRemoteFollow({ activeUserId, targetUserId, handle, isFollowing, followRequested, closed, onChange, onError }: Options) {
  const cached = getCachedFollowState(activeUserId, targetUserId);
  const [view, setView] = useState<RemoteFollowView>(() => (cached ? viewOfFlags(cached) : viewOfFlags({ isFollowing, followRequested })));
  const [fechado, setFechado] = useState<boolean | null>(closed ?? null);
  const [busy, setBusy] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const busyRef = useRef(false);
  const fechadoRef = useRef(fechado);
  fechadoRef.current = fechado;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // A tela de origem recarregou (lista, perfil): o que ela sabe agora vale, a não ser que haja uma chamada em andamento.
  useEffect(() => {
    if (busyRef.current) return;
    const recente = getCachedFollowState(activeUserId, targetUserId);
    setView(recente ? viewOfFlags(recente) : viewOfFlags({ isFollowing, followRequested }));
  }, [activeUserId, targetUserId, isFollowing, followRequested]);

  useEffect(() => {
    if (closed === true || closed === false) setFechado(closed);
  }, [closed]);

  // Outro botão do mesmo perfil mudou o estado (a lista e o balão do perfil acompanham o botão do cabeçalho).
  useEffect(() => {
    if (!activeUserId || !targetUserId) return;
    const aoMudar = (event: Event) => {
      const detalhe = (event as CustomEvent<FollowStateEventDetail>).detail;
      if (!detalhe || detalhe.activeUserId !== activeUserId || detalhe.targetUserId !== targetUserId) return;
      setView(viewOfFlags(detalhe));
    };
    window.addEventListener(FOLLOW_STATE_EVENT, aoMudar);
    return () => window.removeEventListener(FOLLOW_STATE_EVENT, aoMudar);
  }, [activeUserId, targetUserId]);

  const run = useCallback(
    async (action: 'follow' | 'unfollow' | 'cancel', note?: string, otimista?: RemoteFollowView): Promise<RemoteFollowResult | null> => {
      if (!activeUserId || busyRef.current) return null;
      busyRef.current = true;
      setBusy(true);
      const anterior = viewRef.current;
      if (otimista) setView(otimista);
      try {
        const resultado = await callRemoteFollow(activeUserId, { targetUserId, handle, action, ...(note ? { note } : {}) });
        setView(resultado.view);
        if (action === 'follow') setFechado(resultado.closed);
        onChangeRef.current?.(resultado.view, resultado, anterior);
        return resultado;
      } catch (error) {
        setView(anterior);
        onErrorRef.current?.(error);
        return null;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [activeUserId, targetUserId, handle],
  );

  /** Segue (perfil aberto) ou pede para seguir (fechado). `note` é o bilhete cordial, só vale em perfil fechado. */
  const follow = useCallback((note?: string) => run('follow', note, fechadoRef.current === false ? 'following' : undefined), [run]);
  /** Deixa de seguir, ou cancela o pedido pendente (o mesmo `Undo(Follow)`): a tela muda na hora. */
  const stop = useCallback(() => run(viewRef.current === 'requested' ? 'cancel' : 'unfollow', undefined, 'none'), [run]);

  return { view, closed: fechado, busy, follow, stop };
}
