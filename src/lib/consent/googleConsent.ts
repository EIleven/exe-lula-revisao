// src/lib/consent/googleConsent.ts
// Ponte com as tags do Google. Tudo que fala com `window` está DENTRO de função (nada no topo do módulo), para o
// `npm run e2e:consent` poder importar este arquivo no Node e conferir o script de partida sem navegador.

// Só `import type`: o Node apaga tipos ao rodar o e2e, então este módulo também pode ser importado direto no teste.
import type { ConsentModeSignals } from './consentState';

/** Container do Google Tag Manager da rede. Só é baixado depois de aceite (ver GoogleTagManager.tsx). */
export const GTM_CONTAINER_ID = 'GTM-KPJ9MTNF';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Avisa o Google da decisão da pessoa. Silencioso de propósito: se o `gtag` não existe (script bloqueado, sem
 * JavaScript, navegação privada), não há tag nenhuma carregada para atualizar — e o padrão já é negado.
 */
export function updateGoogleConsent(signals: ConsentModeSignals): void {
  if (typeof window === 'undefined') return;
  try {
    window.gtag?.('consent', 'update', signals);
  } catch {
    // Nada a fazer: sem o gtag, nada opcional está rodando.
  }
}

/** Snippet do container, igual ao oficial. Só é renderizado quando há consentimento. */
export function gtmContainerScript(containerId: string): string {
  return `(function(w,d,s,l,i){
  w[l]=w[l]||[];
  w[l].push({'gtm.start': new Date().getTime(),event:'gtm.js'});
  var f=d.getElementsByTagName(s)[0],
      j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';
  j.async=true;
  j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;
  f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${containerId}');`;
}
