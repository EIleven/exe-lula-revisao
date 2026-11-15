// src/components/consent/GoogleTagManager.tsx
'use client';

import Script from 'next/script';
import { useConsent } from '@/hooks/features/consent/useConsent';
import { shouldLoadGtm } from '@/lib/consent/consentState';
import { GTM_CONTAINER_ID, gtmContainerScript } from '@/lib/consent/googleConsent';
import { firebaseEnv } from '@/config/firebase';

/**
 * Carrega o Google Tag Manager SÓ depois de consentimento para alguma categoria opcional. Antes disso nada é pedido
 * ao googletagmanager.com — não é o caso de carregar a tag e mandar sinal negado: o pedido em si já expõe IP e
 * cabeçalhos do visitante a um terceiro, sem base legal (LGPD, art. 7º).
 *
 * Também não carrega em modo emulador: teste local não gera tráfego na conta real.
 *
 * Não existe mais o `<iframe>` de `<noscript>` que havia aqui: sem JavaScript não há como alguém consentir, então
 * não há como medir. O aviso some junto com a medição, e isso está certo.
 */
export default function GoogleTagManager() {
  const { decision, isReady } = useConsent();

  if (firebaseEnv.useEmulators) return null;
  if (!isReady || !shouldLoadGtm(decision)) return null;

  return (
    <Script id="google-tag-manager" strategy="afterInteractive">
      {gtmContainerScript(GTM_CONTAINER_ID)}
    </Script>
  );
}
