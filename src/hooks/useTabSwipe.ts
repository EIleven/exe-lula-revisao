// src/hooks/useTabSwipe.ts
'use client';

import { useCallback, useMemo, useRef } from 'react';
import type React from 'react';
import { isSwipeIgnored, startsInHorizontalScroller, tabSwipeDirection } from '@/lib/gestures/tabSwipe';

interface Options {
  /** Liga o gesto (só no celular). */
  enabled: boolean;
  /** O gesto levou à aba seguinte (dedo para a esquerda) ou à anterior (dedo para a direita). */
  onSwipe: (direction: 'next' | 'previous') => void;
}

/**
 * Arrastar de lado para trocar de aba, para espalhar (`{...props}`) na área das abas.
 *
 * Diferente da versão com eventos de ponteiro:
 *  - nada é impedido nem capturado durante o arrasto: sem `touch-action` e sem captura do ponteiro (que redirecionava o
 *    toque seguinte para a área das abas), então a rolagem vertical é inteira do navegador, começando onde começar
 *    (botão, imagem, texto, menu, espaço vazio), e um toque simples continua sendo um toque;
 *  - os ouvintes são só `touchstart`/`touchend` (o React os registra passivos): nada roda enquanto o dedo se move;
 *  - o gesto é avaliado ao soltar (`tabSwipeDirection`): precisa ser deliberado, bem mais horizontal que vertical, e a página
 *    não pode ter rolado no meio (rolou: era rolagem).
 */
export function useTabSwipe({ enabled, onSwipe }: Options) {
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;
  const start = useRef<{ x: number; y: number; at: number; scrollY: number } | null>(null);

  const onTouchStart = useCallback((event: React.TouchEvent<HTMLElement>) => {
    // Dois dedos (pinça) ou um campo que usa o arrasto de lado para si: não é troca de aba.
    if (event.touches.length !== 1 || isSwipeIgnored(event)) {
      start.current = null;
      return;
    }
    const touch = event.touches[0];
    start.current = { x: touch.clientX, y: touch.clientY, at: performance.now(), scrollY: window.scrollY };
  }, []);

  const onTouchEnd = useCallback((event: React.TouchEvent<HTMLElement>) => {
    const origin = start.current;
    start.current = null;
    if (!origin || event.touches.length > 0) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const direction = tabSwipeDirection({
      dx: touch.clientX - origin.x,
      dy: touch.clientY - origin.y,
      elapsed: performance.now() - origin.at,
      scrolled: window.scrollY - origin.scrollY,
    });
    if (!direction) return;
    // Selecionar texto (toque longo e arrastar) também é um arrasto de lado: não é troca de aba.
    if (window.getSelection()?.isCollapsed === false) return;
    // Só agora, com o gesto já parecendo uma troca de aba, olha se ele começou dentro de algo que rola de lado.
    if (startsInHorizontalScroller(event.target, event.currentTarget)) return;
    onSwipeRef.current(direction);
  }, []);

  const onTouchCancel = useCallback(() => {
    start.current = null;
  }, []);

  return useMemo(
    () => (enabled ? { onTouchStart, onTouchEnd, onTouchCancel } : {}),
    [enabled, onTouchStart, onTouchEnd, onTouchCancel],
  );
}
