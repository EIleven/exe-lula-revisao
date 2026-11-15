// src/lib/scrollChrome.ts
// As barras que se escondem ao rolar (cabeçalho, navegação inferior, abas fixas, barra de comentar) SEM passar pelo React.
//
// Antes cada uma guardava "estou visível?" em estado e escutava a rolagem por conta própria (o layout, as abas do feed, UMA
// POR CARTÃO do feed...). Cada troca de direção redesenhava o feed inteiro: centenas de milhares de componentes por
// segundo de rolagem num celular lento. Agora um único ouvinte passivo decide a direção e só escreve um atributo em
// <html>; o CSS (globals.css, `.chrome-*`) move as barras com `transform`, que roda no compositor sem tocar na página.

export type ChromeState = 'shown' | 'hidden';

/** Até esta rolagem (px) as barras sempre aparecem: é o topo da página. */
const ALWAYS_SHOWN_ABOVE = 56;
/** Rolar isto (px) para baixo, sem voltar, esconde as barras. */
const HIDE_AFTER = 28;
/** Rolar isto (px) para cima, sem voltar, as revela. A folga evita piscar com a acomodação/inércia curta do toque. */
const SHOW_AFTER = 36;

export interface ScrollChromeController {
  /** Mostra as barras de novo (troca de página, por exemplo). */
  reset: () => void;
  destroy: () => void;
}

/**
 * Decide mostrar ou esconder pelo deslocamento ACUMULADO desde a última troca de direção, não pelo quadro anterior. Assim
 * uma rolagem lenta para cima também revela as barras (antes só um arremesso de mais de 50 px por quadro revelava) e uma
 * tremida de 1 px do dedo não esconde nada.
 */
export function startScrollChrome(root: HTMLElement = document.documentElement): ScrollChromeController {
  let state: ChromeState = 'shown';
  let lastY = Math.max(0, window.scrollY);
  let anchorY = lastY; // onde começou o movimento atual (para baixo ou para cima)
  let direction: 1 | -1 | 0 = 0;
  let frame = 0;

  const apply = (next: ChromeState) => {
    if (next === state) return;
    state = next;
    root.dataset.chrome = next;
  };

  const update = () => {
    frame = 0;
    const y = Math.max(0, window.scrollY); // o efeito elástico do iOS dá valores negativos
    if (y <= ALWAYS_SHOWN_ABOVE) {
      apply('shown');
      anchorY = y;
      direction = 0;
      lastY = y;
      return;
    }
    const delta = y - lastY;
    if (delta !== 0) {
      const next = delta > 0 ? 1 : -1;
      if (next !== direction) {
        direction = next;
        anchorY = lastY;
      }
      if (direction === 1 && y - anchorY >= HIDE_AFTER) apply('hidden');
      else if (direction === -1 && anchorY - y >= SHOW_AFTER) apply('shown');
    }
    lastY = y;
  };

  const onScroll = () => {
    if (frame === 0) frame = window.requestAnimationFrame(update);
  };

  root.dataset.chrome = state;
  window.addEventListener('scroll', onScroll, { passive: true });

  return {
    reset: () => {
      lastY = Math.max(0, window.scrollY);
      anchorY = lastY;
      direction = 0;
      apply('shown');
    },
    destroy: () => {
      window.removeEventListener('scroll', onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
      delete root.dataset.chrome;
    },
  };
}
