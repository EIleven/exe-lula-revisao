
// src/components/shared/AdClientComponent.tsx
'use client';

import { useEffect } from 'react';
import { siteConfig } from '@/config/site';

declare global {
  interface Window {
    adsbygoogle?: { [key: string]: unknown, push: (p: object) => void };
  }
}

interface AdClientComponentProps {
  adSlot: string; // To make it reusable for different ad slots
  className?: string;
  style?: React.CSSProperties;
}

const AdClientComponent = ({ adSlot, className, style }: AdClientComponentProps) => {
  useEffect(() => {
    if (!siteConfig.adsEnabled) return; // publicidade desligada: nada é pedido ao AdSense
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (err) {
      console.error("AdSense error:", err);
    }
  }, [adSlot]); // Re-run if adSlot changes, though unlikely in this app structure

  // Desligada: não ocupa espaço nenhum na tela (o componente segue aqui para voltar a ser usado depois).
  if (!siteConfig.adsEnabled) return null;

  return (
    <div className={className} style={{ minHeight: '100px', ...style }}>
        <ins
          className="adsbygoogle"
          style={{ display: 'block' }}
          data-ad-client="ca-pub-1387310071978485"
          data-ad-slot={adSlot}
          data-ad-format="auto"
          data-full-width-responsive="true"
        ></ins>
    </div>
  );
};

export default AdClientComponent;
