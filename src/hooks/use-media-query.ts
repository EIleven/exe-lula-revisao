'use client';

import { useCallback, useSyncExternalStore } from 'react';

// Um único `MediaQueryList` e um único ouvinte por consulta para o app inteiro. Antes cada componente que perguntava "é
// celular?" (cada cartão do feed, a barra inferior, o layout...) registrava o seu próprio ouvinte de `resize` e guardava o
// seu próprio estado.
interface Entry {
  list: MediaQueryList;
  listeners: Set<() => void>;
  onChange: () => void;
}
const entries = new Map<string, Entry>();

function entryFor(query: string): Entry {
  let entry = entries.get(query);
  if (!entry) {
    const listeners = new Set<() => void>();
    entry = { list: window.matchMedia(query), listeners, onChange: () => listeners.forEach((listener) => listener()) };
    entries.set(query, entry);
  }
  return entry;
}

/** Se a consulta de mídia vale agora (por exemplo, `(min-width: 1100px)`). No servidor e na hidratação é sempre `false`. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((listener: () => void) => {
    const entry = entryFor(query);
    if (entry.listeners.size === 0) entry.list.addEventListener('change', entry.onChange);
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
      if (entry.listeners.size === 0) entry.list.removeEventListener('change', entry.onChange);
    };
  }, [query]);
  return useSyncExternalStore(subscribe, () => entryFor(query).list.matches, () => false);
}
