// src/lib/gestures/tabSwipe.ts
// Arrastar de lado para trocar de aba (Para você / Seguindo..., Posts / Comentários / Mídia / Curtidas), no celular.

/**
 * Um gesto deliberado, não um esbarrão nem uma rolagem levemente diagonal: no mínimo 70 px de lado, em até 0,7 s, e bem mais
 * de lado do que na vertical. A rolagem vertical NUNCA é do app: o gesto só é avaliado quando o dedo sai da tela, nada é
 * impedido durante o arrasto (veja `useTabSwipe`), então a página rola com o navegador sem esperar por JavaScript.
 */
export const TAB_SWIPE = {
  /** Deslocamento horizontal mínimo, em px. */
  delta: 70,
  /** Duração máxima do gesto, em ms. */
  swipeDuration: 700,
  /** O deslocamento horizontal precisa ser pelo menos isto vezes o vertical (cerca de 34° do eixo horizontal). */
  horizontalRatio: 1.5,
  /** Se a página rolou mais que isto (px) durante o gesto, foi rolagem e não troca de aba. */
  maxScroll: 8,
} as const;

/** Campos de texto, controles deslizantes e vídeos usam o arrasto de lado para outra coisa (mover o cursor, o volume). */
const OWN_HORIZONTAL_GESTURE = 'input, textarea, select, [contenteditable="true"], [role="slider"], video, [data-no-swipe]';

/** O arrasto começou num elemento que usa o gesto horizontal para si: não troca de aba. */
export function isSwipeIgnored(event: { target: EventTarget | null } | undefined): boolean {
  return event?.target instanceof Element && event.target.closest(OWN_HORIZONTAL_GESTURE) !== null;
}

/**
 * O arrasto começou dentro de algo que rola de lado (um bloco de código largo, uma tabela, um carrossel): o arrasto é
 * daquele elemento. Só é medido quando o gesto já parece uma troca de aba, para não custar nada em cada toque.
 */
export function startsInHorizontalScroller(target: EventTarget | null, stopAt: Element): boolean {
  let element = target instanceof Element ? target : null;
  while (element && element !== stopAt) {
    if (element.scrollWidth > element.clientWidth + 1) {
      const { overflowX } = getComputedStyle(element);
      if (overflowX === 'auto' || overflowX === 'scroll') return true;
    }
    element = element.parentElement;
  }
  return false;
}

export interface TabSwipeSample {
  /** Deslocamento horizontal do dedo (negativo = para a esquerda). */
  dx: number;
  /** Deslocamento vertical do dedo. */
  dy: number;
  /** Duração do gesto, em ms. */
  elapsed: number;
  /** Quanto a página rolou na vertical durante o gesto (px). */
  scrolled: number;
}

/** Para onde o gesto leva: a aba seguinte (dedo para a esquerda), a anterior (dedo para a direita) ou nenhuma. */
export function tabSwipeDirection({ dx, dy, elapsed, scrolled }: TabSwipeSample): 'next' | 'previous' | null {
  if (elapsed > TAB_SWIPE.swipeDuration) return null;
  if (Math.abs(dx) < TAB_SWIPE.delta) return null;
  if (Math.abs(dx) < Math.abs(dy) * TAB_SWIPE.horizontalRatio) return null;
  if (Math.abs(scrolled) > TAB_SWIPE.maxScroll) return null;
  return dx < 0 ? 'next' : 'previous';
}
