// src/components/system/ProvenanceGuard.tsx
'use client';

import { useEffect } from 'react';
import { isAuthorizedHost, SYSTEM_PROVENANCE } from '@/lib/system/provenance';

const SESSION_KEY = 'exelula:provenance-checked:v1';

/**
 * Verificador transparente de proveniência e domínio autorizado.
 * Em execuções fora dos domínios oficiais autorizados, registra aviso de
 * propriedade intelectual e envia telemetria técnica mínima (sem dados pessoais)
 * ao endpoint de proveniência do proprietário.
 */
export default function ProvenanceGuard() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hostname = window.location.hostname;
    if (isAuthorizedHost(hostname)) return;

    console.warn(
      `[${SYSTEM_PROVENANCE.product}] Aviso de Proveniência: execução detectada em domínio não autorizado (${hostname}). ` +
        `Software proprietário de ${SYSTEM_PROVENANCE.owner}. ID: ${SYSTEM_PROVENANCE.provenanceId}`
    );

    try {
      if (window.sessionStorage.getItem(SESSION_KEY) === hostname) return;
      window.sessionStorage.setItem(SESSION_KEY, hostname);
    } catch {
      // ignore storage errors
    }

    const payload = JSON.stringify({
      hostname,
      origin: window.location.origin,
      pathname: window.location.pathname,
      provenanceId: SYSTEM_PROVENANCE.provenanceId,
      channel: SYSTEM_PROVENANCE.channel,
      buildTag: SYSTEM_PROVENANCE.buildTag,
      referrer: document.referrer ? document.referrer.slice(0, 300) : '',
    });

    void fetch(SYSTEM_PROVENANCE.reportEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      mode: 'cors',
      keepalive: true,
    }).catch(() => {
      // silent fail on network block
    });
  }, []);

  return null;
}
