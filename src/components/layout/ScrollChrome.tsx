// src/components/layout/ScrollChrome.tsx
'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { startScrollChrome, type ScrollChromeController } from '@/lib/scrollChrome';

/**
 * Liga o ouvinte único de rolagem que esconde e mostra as barras (cabeçalho, navegação inferior, abas fixas). Não desenha
 * nada e não guarda estado: só escreve `data-chrome` em <html>, e o CSS faz o resto (veja `.chrome-*` em globals.css).
 * Trocar de página mostra as barras de novo.
 */
export default function ScrollChrome() {
  const pathname = usePathname();
  const controller = useRef<ScrollChromeController | null>(null);

  useEffect(() => {
    controller.current = startScrollChrome();
    return () => {
      controller.current?.destroy();
      controller.current = null;
    };
  }, []);

  useEffect(() => {
    controller.current?.reset();
  }, [pathname]);

  return null;
}
