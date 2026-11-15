// src/lib/backNavigation.ts
// O botão (ou gesto) de VOLTAR do Android. Sem tratamento, o app só volta no histórico: com um diálogo, uma folha ou um menu
// aberto, "voltar" saía da página e deixava o diálogo para trás, ao contrário de todo app nativo, em que o primeiro "voltar"
// fecha o que está por cima. A lógica fica aqui, sem Capacitor, para o teste poder acionar o mesmo caminho no navegador.

/** O que está aberto por cima da página: diálogos, folhas, avisos de confirmação, menus e listas (componentes do Radix). */
const OVERLAY_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
].join(',');

export type BackAction = 'overlay' | 'history' | 'root';

/** Há algo aberto por cima da página? */
export function hasOpenOverlay(): boolean {
  return typeof document !== 'undefined' && document.querySelector(OVERLAY_SELECTOR) !== null;
}

/**
 * Fecha o que está por cima do mesmo jeito que a tecla Esc (cada componente fecha do seu jeito e devolve o foco ao lugar
 * certo). Devolve false se não havia nada aberto.
 */
export function closeTopOverlay(): boolean {
  if (!hasOpenOverlay()) return false;
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
  return true;
}

const NAV_STACK_KEY = 'echo_nav_stack_v1';
const MAX_STACK_SIZE = 50;
let memoryStack: string[] = [];
let stackLoaded = false;

function loadStack(): string[] {
  if (stackLoaded) return memoryStack;
  stackLoaded = true;
  if (typeof window === 'undefined') return memoryStack;
  try {
    const raw = window.sessionStorage.getItem(NAV_STACK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        memoryStack = parsed.filter((item): item is string => typeof item === 'string').slice(-MAX_STACK_SIZE);
      }
    }
  } catch {
    // ignore storage errors
  }
  return memoryStack;
}

function saveStack(stack: string[]) {
  memoryStack = stack.slice(-MAX_STACK_SIZE);
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(NAV_STACK_KEY, JSON.stringify(memoryStack));
  } catch {
    // ignore storage errors
  }
}

function normalizePath(url: string): string {
  const idx = url.indexOf('?');
  const hashIdx = url.indexOf('#');
  const end = idx === -1 ? hashIdx : hashIdx === -1 ? idx : Math.min(idx, hashIdx);
  const path = (end === -1 ? url : url.slice(0, end)).replace(/\/+$/, '');
  return path || '/';
}

function isSubLoopOf(candidateUrl: string, currentUrl: string): boolean {
  const candPath = normalizePath(candidateUrl);
  const currPath = normalizePath(currentUrl);
  if (candPath === currPath) return true;
  if (/\/post\/[^/]+$/.test(currPath) && candPath.startsWith(`${currPath}/`)) {
    return /^\/(likes|reposts|quotes)$/.test(candPath.slice(currPath.length));
  }
  if (/\/profile\/[^/]+$/.test(currPath) && candPath.startsWith(`${currPath}/`)) {
    return /^\/(followers|following)$/.test(candPath.slice(currPath.length));
  }
  return false;
}

export function getLocaleFeedFallback(currentPath?: string): string {
  const path = currentPath || (typeof window !== 'undefined' ? window.location.pathname : '/pt-BR');
  const match = path.match(/^\/(pt-BR|en)(\/|$)/);
  const locale = match ? match[1] : 'pt-BR';
  return `/${locale}/feed`;
}

/** Registra cada visita de rota no app evitando duplicatas consecutivas e loops ao voltar. */
export function recordRouteVisit(url: string): void {
  if (!url) return;
  const stack = [...loadStack()];
  if (stack.length > 0 && stack[stack.length - 1] === url) return;
  if (stack.length >= 2 && stack[stack.length - 2] === url) {
    stack.pop();
    saveStack(stack);
    return;
  }
  stack.push(url);
  saveStack(stack);
}

export interface RouterLike {
  back: () => void;
  replace: (href: string) => void;
  push: (href: string) => void;
}

export function navigateBack(
  router: RouterLike,
  options?: { targetUrl?: string; fallbackUrl?: string },
): void {
  const currentUrl =
    typeof window !== 'undefined'
      ? `${window.location.pathname}${window.location.search}`
      : '';
  const stack = [...loadStack()];
  const currentTop = stack[stack.length - 1] || currentUrl;
  const targetUrl = options?.targetUrl;

  if (targetUrl) {
    const targetNorm = normalizePath(targetUrl);
    if (stack.length >= 2 && normalizePath(stack[stack.length - 2]) === targetNorm) {
      stack.pop();
      saveStack(stack);
      router.back();
      return;
    }
    if (stack.length > 0 && normalizePath(stack[stack.length - 1]) === normalizePath(currentTop)) {
      stack.pop();
    }
    if (stack.length === 0 || normalizePath(stack[stack.length - 1]) !== targetNorm) {
      stack.push(targetUrl);
    }
    saveStack(stack);
    router.replace(targetUrl);
    return;
  }

  let prevIdx = stack.length - 2;
  while (prevIdx >= 0 && isSubLoopOf(stack[prevIdx], currentTop)) {
    prevIdx -= 1;
  }

  if (prevIdx >= 0) {
    const targetPrev = stack[prevIdx];
    const isImmediatePrev = prevIdx === stack.length - 2;
    saveStack(stack.slice(0, prevIdx + 1));
    if (isImmediatePrev) {
      router.back();
    } else {
      router.replace(targetPrev);
    }
    return;
  }

  const fallback = options?.fallbackUrl || getLocaleFeedFallback(currentTop);
  saveStack([fallback]);
  router.replace(fallback);
}

/**
 * Um "voltar": 1) fecha o que está por cima; 2) senão volta no histórico; 3) senão (primeira tela) devolve 'root' e quem
 * chamou decide (no app, vai para segundo plano em vez de fechar e perder o estado).
 */
export function handleBack(canGoBack: boolean): BackAction {
  if (closeTopOverlay()) return 'overlay';
  if (canGoBack) {
    window.history.back();
    return 'history';
  }
  return 'root';
}
