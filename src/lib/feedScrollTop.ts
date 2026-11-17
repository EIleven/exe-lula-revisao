// src/lib/feedScrollTop.ts
/**
 * Coordena o botão "Voltar ao topo" da barra lateral desktop com o FeedContainer ativo na tela:
 * evita botões duplicados entre abas ocultas e permite avisar/atualizar quando chegam novos posts.
 */

export interface FeedScrollTarget {
  hasNewPosts: boolean;
  onRefresh: () => Promise<void>;
}

type Listener = (target: FeedScrollTarget | null) => void;

const registrations = new Map<symbol, FeedScrollTarget>();
const listeners = new Set<Listener>();

function currentTarget(): FeedScrollTarget | null {
  let latest: FeedScrollTarget | null = null;
  for (const entry of registrations.values()) {
    latest = entry;
  }
  return latest;
}

function emit() {
  const target = currentTarget();
  listeners.forEach((listener) => listener(target));
}

export function registerFeedScrollTarget(key: symbol, target: FeedScrollTarget): void {
  registrations.set(key, target);
  emit();
}

export function unregisterFeedScrollTarget(key: symbol): void {
  if (registrations.delete(key)) {
    emit();
  }
}

export function getActiveFeedScrollTarget(): FeedScrollTarget | null {
  return currentTarget();
}

export function subscribeFeedScrollTarget(listener: Listener): () => void {
  listeners.add(listener);
  listener(currentTarget());
  return () => {
    listeners.delete(listener);
  };
}

/** Rola suavemente até o topo (respeitando `prefers-reduced-motion`) e só atualiza o feed se houver posts novos. */
export function scrollToTopSmoothly(target?: FeedScrollTarget | null): void {
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });

  if (!target?.hasNewPosts) return;

  let settled = false;
  const triggerRefresh = () => {
    if (settled) return;
    settled = true;
    window.removeEventListener('scroll', onScroll);
    void target.onRefresh();
  };

  const onScroll = () => {
    if (window.scrollY <= 40) {
      triggerRefresh();
    }
  };

  if (window.scrollY <= 40) {
    triggerRefresh();
    return;
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.setTimeout(triggerRefresh, 450);
}

