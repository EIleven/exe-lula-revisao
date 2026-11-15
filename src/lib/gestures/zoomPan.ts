// src/lib/gestures/zoomPan.ts
// Matemática pura (sem React nem DOM) do visualizador de imagem: pinça, arrastar, toque duplo e puxar para fechar. Fica à
// parte para ser testada sozinha (e2e/zoom-pan-check.mjs) e para a tela só cuidar de ligar os dedos a estas funções.
//
// Convenção: a imagem é desenhada com `translate(x, y) scale(scale)` em torno do CENTRO do quadro; todos os pontos são
// relativos a esse centro (clientX - centroX), em pixels de tela.

export type ZoomState = { scale: number; x: number; y: number };
export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

export const MIN_SCALE = 1;
export const MAX_SCALE = 5;
/** Quanto o toque duplo amplia. */
export const DOUBLE_TAP_SCALE = 2.5;
/** Abaixo disto a imagem volta ao tamanho original ao soltar a pinça (ficar em 1,03x parece um defeito). */
export const SNAP_TO_FIT = 1.08;
/** Puxar para fechar: distância (px) ou velocidade (px/ms) que decide fechar ao soltar. */
export const DISMISS_DISTANCE = 120;
export const DISMISS_VELOCITY = 0.6;

export const IDENTITY: ZoomState = { scale: 1, x: 0, y: 0 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const clampScale = (scale: number) => clamp(scale, MIN_SCALE, MAX_SCALE);

/** Quanto a imagem ampliada pode andar para cada lado sem mostrar o vazio de fora dela. */
export function panLimits(scale: number, size: Size): { x: number; y: number } {
  return { x: Math.max(0, (scale * size.width - size.width) / 2), y: Math.max(0, (scale * size.height - size.height) / 2) };
}

/** Mantém a imagem dentro dos limites do quadro. */
export function clampState(state: ZoomState, size: Size): ZoomState {
  const scale = clampScale(state.scale);
  if (scale <= MIN_SCALE) return { scale: MIN_SCALE, x: 0, y: 0 };
  const limit = panLimits(scale, size);
  return { scale, x: clamp(state.x, -limit.x, limit.x), y: clamp(state.y, -limit.y, limit.y) };
}

export const distanceBetween = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Pinça: o ponto da imagem que estava sob o meio dos dedos no começo continua sob o meio dos dedos agora, na nova escala
 * (por isso o zoom "vai para onde os dedos estão" e acompanha o arrastar dos dois dedos juntos).
 */
export function pinch(start: ZoomState, startMid: Point, startDistance: number, mid: Point, distance: number, size: Size): ZoomState {
  if (startDistance <= 0) return clampState(start, size);
  const scale = clampScale((start.scale * distance) / startDistance);
  const ratio = scale / start.scale;
  return clampState({ scale, x: mid.x - (startMid.x - start.x) * ratio, y: mid.y - (startMid.y - start.y) * ratio }, size);
}

/** Arrastar com um dedo (só tem efeito ampliado). */
export function pan(start: ZoomState, dx: number, dy: number, size: Size): ZoomState {
  return clampState({ scale: start.scale, x: start.x + dx, y: start.y + dy }, size);
}

/** Toque duplo: se já está ampliada volta ao tamanho original; senão amplia centrando no ponto tocado. */
export function doubleTap(state: ZoomState, point: Point, size: Size): ZoomState {
  if (state.scale > SNAP_TO_FIT) return IDENTITY;
  const scale = DOUBLE_TAP_SCALE;
  return clampState({ scale, x: point.x * (1 - scale), y: point.y * (1 - scale) }, size);
}

/** Ao soltar a pinça: perto do tamanho original, encaixa nele. */
export function settle(state: ZoomState, size: Size): ZoomState {
  return state.scale < SNAP_TO_FIT ? IDENTITY : clampState(state, size);
}

/** Puxar para fechar (só com a imagem no tamanho original): fecha pela distância ou por um arremesso rápido para baixo ou para cima. */
export function shouldDismiss(dy: number, velocityY: number): boolean {
  return Math.abs(dy) >= DISMISS_DISTANCE || (Math.abs(dy) > 30 && Math.abs(velocityY) >= DISMISS_VELOCITY);
}

/** Opacidade do fundo enquanto se puxa para fechar: some aos poucos, nunca totalmente (para dar para voltar atrás). */
export function dismissOpacity(dy: number, height: number): number {
  return 1 - Math.min(Math.abs(dy) / Math.max(1, height * 0.5), 0.65);
}
