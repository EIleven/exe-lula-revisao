// src/lib/media/videoControls.ts
// As contas e os atalhos do player autoral (HiperVerso). PURO (sem React nem DOM): e2e/video-playback-check.mjs prova cada regra.

const finito = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** `m:ss`, ou `h:mm:ss` a partir de uma hora. Qualquer valor inválido (NaN, Infinity, negativo) vira `0:00`. */
export function formatClock(segundos: unknown): string {
  const total = finito(segundos) && segundos > 0 ? Math.floor(segundos) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const dois = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${dois(m)}:${dois(s)}` : `${m}:${dois(s)}`;
}

/** Quanto do vídeo já passou, de 0 a 1. Duração desconhecida (0, NaN, Infinity: transmissão ao vivo) dá 0. */
export function fractionOf(atual: unknown, duracao: unknown): number {
  if (!finito(atual) || !finito(duracao) || duracao <= 0) return 0;
  return clamp(atual / duracao, 0, 1);
}

/** O segundo para onde pular `delta` a partir de `atual`, sempre dentro do vídeo. */
export function seekTarget(atual: number, delta: number, duracao: number): number {
  const fim = finito(duracao) && duracao > 0 ? duracao : Number.MAX_SAFE_INTEGER;
  return clamp((finito(atual) ? atual : 0) + (finito(delta) ? delta : 0), 0, fim);
}

/** O segundo apontado por um clique/toque na barra: `clientX` dentro de [esquerda, esquerda + largura]. */
export function timeFromPointer(clientX: number, esquerda: number, largura: number, duracao: number): number {
  if (!finito(clientX) || !finito(esquerda) || !finito(largura) || largura <= 0 || !finito(duracao) || duracao <= 0) return 0;
  return clamp((clientX - esquerda) / largura, 0, 1) * duracao;
}

export type KeyAction =
  | { type: 'toggle' }
  | { type: 'seek'; delta: number }
  | { type: 'seek-fraction'; fraction: number }
  | { type: 'volume'; delta: number }
  | { type: 'mute' }
  | { type: 'fullscreen' };

/**
 * Atalhos como no YouTube: espaço/K pausa, ←/→ pulam 5 s, J/L pulam 10 s, ↑/↓ mudam o volume, M silencia, F tela cheia, 0–9
 * vão a 0–90%. Com Ctrl, Alt ou Meta apertados devolve `null` (é atalho do navegador, não do player).
 */
export function keyAction(tecla: string, opcoes: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean } = {}): KeyAction | null {
  if (opcoes.ctrlKey || opcoes.altKey || opcoes.metaKey) return null;
  switch (tecla) {
    case ' ':
    case 'k':
    case 'K':
      return { type: 'toggle' };
    case 'ArrowLeft':
      return { type: 'seek', delta: -5 };
    case 'ArrowRight':
      return { type: 'seek', delta: 5 };
    case 'j':
    case 'J':
      return { type: 'seek', delta: -10 };
    case 'l':
    case 'L':
      return { type: 'seek', delta: 10 };
    case 'ArrowUp':
      return { type: 'volume', delta: 0.05 };
    case 'ArrowDown':
      return { type: 'volume', delta: -0.05 };
    case 'm':
    case 'M':
      return { type: 'mute' };
    case 'f':
    case 'F':
      return { type: 'fullscreen' };
    case 'Home':
      return { type: 'seek-fraction', fraction: 0 };
    default:
      return /^[0-9]$/.test(tecla) ? { type: 'seek-fraction', fraction: Number(tecla) / 10 } : null;
  }
}

/** O novo volume depois de somar `delta` (arredondado a 2 casas, para ↑↑↑ não acumular 0.15000000000000002). */
export function nextVolume(atual: number, delta: number): number {
  return Math.round(clamp((finito(atual) ? atual : 1) + (finito(delta) ? delta : 0), 0, 1) * 100) / 100;
}
