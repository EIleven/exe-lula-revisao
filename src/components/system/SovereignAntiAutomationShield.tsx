'use client';

// src/components/system/SovereignAntiAutomationShield.tsx
// Escudo silencioso e transparente: nunca interrompe humanos (mesmo em aba anônima),
// nunca bloqueia copiar/colar e limpa qualquer cookie de falso-positivo anterior.

import { useEffect } from 'react';

export function SovereignAntiAutomationShield() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Limpa eventual cookie antigo __hv_bot para nunca travar usuário real ou aba anônima
    if (document.cookie.includes('__hv_bot=')) {
      document.cookie = '__hv_bot=; path=/; max-age=0; SameSite=Lax';
    }

    let humanMarked = false;
    const markHumanTrusted = (e: Event) => {
      if (!e.isTrusted || humanMarked) return;
      humanMarked = true;
      document.cookie = '__hv_human=1; path=/; max-age=86400; SameSite=Lax';
    };

    window.addEventListener('pointermove', markHumanTrusted, { passive: true, once: true });
    window.addEventListener('touchstart', markHumanTrusted, { passive: true, once: true });
    window.addEventListener('keydown', markHumanTrusted, { passive: true, once: true });
    window.addEventListener('scroll', markHumanTrusted, { passive: true, once: true });

    return () => {
      window.removeEventListener('pointermove', markHumanTrusted);
      window.removeEventListener('touchstart', markHumanTrusted);
      window.removeEventListener('keydown', markHumanTrusted);
      window.removeEventListener('scroll', markHumanTrusted);
    };
  }, []);

  return null;
}
