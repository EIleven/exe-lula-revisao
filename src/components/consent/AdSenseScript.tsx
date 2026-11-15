// src/components/consent/AdSenseScript.tsx
'use client';

import React from 'react';
import Script from 'next/script';
import { useConsent } from '@/hooks/features/consent/useConsent';
import { siteConfig } from '@/config/site';
import { firebaseEnv } from '@/config/firebase';

const ADSENSE_CLIENT = 'ca-pub-1387310071978485';

/**
 * AdSense. Hoje a publicidade está desligada por decisão de produto (`siteConfig.adsEnabled`), mas este componente
 * existe para que religar os anúncios NÃO reabra o vazamento: além da flag, exige consentimento para a categoria de
 * publicidade.
 *
 * Os `preconnect` também entram aqui, e não no layout: abrir conexão com o servidor de anúncios já entrega o IP do
 * visitante a um terceiro, antes de qualquer anúncio aparecer.
 */
export default function AdSenseScript() {
  const { marketing, isReady } = useConsent();

  if (firebaseEnv.useEmulators) return null;
  if (!siteConfig.adsEnabled) return null;
  if (!isReady || !marketing) return null;

  return (
    <>
      <link rel="preconnect" href="https://pagead2.googlesyndication.com" crossOrigin="anonymous" />
      <link rel="preconnect" href="https://tpc.googlesyndication.com" crossOrigin="anonymous" />
      <link rel="dns-prefetch" href="https://pagead2.googlesyndication.com" />
      <link rel="dns-prefetch" href="https://tpc.googlesyndication.com" />
      <meta name="google-adsense-account" content={ADSENSE_CLIENT} />
      <Script
        id="google-adsense"
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
        crossOrigin="anonymous"
        strategy="afterInteractive"
      />
    </>
  );
}
