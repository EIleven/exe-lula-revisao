// src/hooks/usePullToRefresh.ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { haptics } from '@/lib/haptics';

/** Distância (px de tela, já com a resistência aplicada) que a pessoa precisa puxar para atualizar. */
export const PULL_THRESHOLD = 80;
/** O indicador nunca desce além disto, por mais que o dedo vá longe. */
const MAX_PULL = 130;
/** Resistência: o indicador anda a metade do dedo, como nos apps nativos (puxar "pesa"). */
const RESISTANCE = 0.5;
/** Movimento do dedo, em px, antes de decidir se é um puxar (vertical) ou um arrasto de lado (trocar de aba). */
const INTENT_SLOP = 10;
/** "No topo" com a folga de 1 px: nos celulares com densidade fracionária a posição de repouso pode ser 0,38 px, não 0. */
const TOP_TOLERANCE = 1;
/** Dentro destes elementos o puxar não vale: o dedo está numa janela, menu ou lista que rola por conta própria. */
const OWN_VERTICAL_GESTURE = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [data-no-ptr]';

interface Options {
  onRefresh: () => Promise<void>;
  /** Liga o gesto (só no celular). */
  enabled: boolean;
}

/**
 * Puxar para atualizar, no topo da página, no celular. Pontos que importam para a rolagem:
 *  - NADA é impedido: os ouvintes de toque são passivos e não há `preventDefault` nem `touch-action` (antes o feed trocava o
 *    `touch-action` pelo estado "estou no topo" e ouvia `pointermove` não passivo). A rolagem é sempre do navegador; no
 *    topo ela simplesmente não tem para onde ir (e `overscroll-behavior` desliga o puxar nativo), então o app só acompanha
 *    o dedo;
 *  - só vale se a página está NO TOPO quando o dedo encosta e o movimento é mais vertical que horizontal (um arrasto de lado,
 *    que troca de aba, não vira "puxar") e o dedo não começou numa janela ou menu;
 *  - o indicador anda por escrita direta de estilo (um quadro por vez): nenhum estado do React muda a cada movimento do dedo;
 *  - resistência e teto: o indicador acompanha o dedo pela metade e para em MAX_PULL;
 *  - o mesmo limiar no indicador e na ação, um tique de vibração ao cruzá-lo e outro ao soltar e atualizar;
 *  - o toque cancelado (a ligação do telefone, o gesto de voltar do sistema) desfaz o puxar em vez de deixá-lo preso;
 *  - abas escondidas (display: none) não respondem ao gesto.
 */
export function usePullToRefresh<T extends HTMLElement>({ onRefresh, enabled }: Options) {
  const containerRef = useRef<T>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const refreshingRef = useRef(false);

  /** Posiciona o indicador direto no elemento (sem passar pelo React). */
  const paint = useCallback((distance: number, refreshing: boolean) => {
    const indicator = indicatorRef.current;
    if (!indicator) return;
    const armed = distance >= PULL_THRESHOLD;
    indicator.style.opacity = refreshing ? '1' : distance > 0 ? String(Math.min(distance / PULL_THRESHOLD, 1)) : '';
    indicator.style.transform = refreshing
      ? `translateY(${PULL_THRESHOLD}px)`
      : distance > 0 ? `translateY(${Math.max(0, distance)}px)` : '';
    indicator.dataset.armed = armed ? 'true' : 'false';
  }, []);

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setIsRefreshing(true);
    paint(0, true);
    try {
      await onRefreshRef.current();
    } finally {
      refreshingRef.current = false;
      setIsRefreshing(false);
      paint(0, false);
    }
  }, [paint]);

  useEffect(() => {
    const element = containerRef.current;
    if (!enabled || !element) return;
    // O início do gesto pode ficar alguns pixels acima da lista (na barra de abas/compositor), embora ainda seja um puxão
    // da página. Escutar na janela mantém uma única superfície de rolagem e evita uma faixa morta no topo.
    let startX = 0;
    let startY = 0;
    let touchId: number | null = null;
    let tracking = false; // o dedo encostou no topo da página
    let pulling = false; // já se decidiu que é um puxar
    let armed = false; // passou do limiar nesta puxada
    let distance = 0;
    let frame = 0;

    const schedulePaint = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        paint(distance, false);
      });
    };

    const reset = () => {
      tracking = false;
      pulling = false;
      armed = false;
      distance = 0;
      touchId = null;
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      if (!refreshingRef.current) paint(0, false);
    };

    const findTouch = (list: TouchList): Touch | null => {
      for (let index = 0; index < list.length; index += 1) {
        if (list[index].identifier === touchId) return list[index];
      }
      return null;
    };

    const onTouchStart = (event: TouchEvent) => {
      if (
        refreshingRef.current ||
        event.touches.length !== 1 ||
        window.scrollY > TOP_TOLERANCE ||
        element.getClientRects().length === 0 || // aba escondida
        (event.target instanceof Element && event.target.closest(OWN_VERTICAL_GESTURE) !== null)
      ) {
        if (tracking) reset(); // um segundo dedo desfaz o puxar em andamento
        return;
      }
      tracking = true;
      pulling = false;
      armed = false;
      touchId = event.touches[0].identifier;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!tracking) return;
      const touch = findTouch(event.touches);
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (!pulling) {
        if (Math.abs(dx) < INTENT_SLOP && Math.abs(dy) < INTENT_SLOP) return;
        // Para cima, ou mais de lado do que para baixo: não é um puxar (a página rola ou a aba troca).
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || window.scrollY > TOP_TOLERANCE) {
          tracking = false;
          return;
        }
        pulling = true;
      }
      if (dy <= 0) {
        distance = 0;
        schedulePaint();
        return;
      }
      distance = Math.min(MAX_PULL, dy * RESISTANCE);
      schedulePaint();
      if (!armed && distance >= PULL_THRESHOLD) {
        armed = true;
        haptics.select();
      } else if (armed && distance < PULL_THRESHOLD) {
        armed = false;
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (!tracking) return;
      if (findTouch(event.changedTouches) === null) return;
      const shouldRefresh = pulling && distance >= PULL_THRESHOLD;
      reset();
      if (shouldRefresh) {
        haptics.tap();
        void refresh();
      }
    };

    const onTouchCancel = () => {
      if (tracking) reset();
    };

    // Toque (e não ponteiro): durante uma rolagem do navegador os eventos de toque continuam chegando sem cancelar nada.
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchCancel, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchCancel);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [enabled, paint, refresh]);

  return { containerRef, indicatorRef, isRefreshing, refresh };
}
