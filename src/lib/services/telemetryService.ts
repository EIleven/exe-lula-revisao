// src/lib/services/telemetryService.ts
'use client';

/**
 * Registra a visita a uma página (contagens do painel do administrador). Envia só o caminho e se a pessoa está logada:
 * o servidor deduz a região aproximada e não guarda IP, navegador, sessão nem usuário (minimização de dados, LGPD).
 * "Dispara e esquece" com sendBeacon, que sobrevive à troca de página.
 */
export const logAccessEvent = (payload: { path: string; audienceType: 'auth' | 'guest' }): void => {
  if (typeof window === 'undefined') return;

  const body = JSON.stringify({ path: payload.path, audienceType: payload.audienceType });
  const endpoint = '/api/log-access';

  try {
    if (!navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }))) {
      fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  } catch {
    // Telemetria nunca atrapalha a navegação.
  }
};
