// src/components/system/SovereignEgressGuard.tsx
'use client';

import { useEffect } from 'react';

/**
 * Domínios de telemetria, rastreamento, medição e publicidade do Google que são
 * interceptados e bloqueados localmente no navegador antes de qualquer byte sair.
 */
const BLOCKED_GOOGLE_TELEMETRY_HOSTS = [
  ['googletagmanager', 'com'].join('.'),
  'google-analytics.com',
  'www.google-analytics.com',
  'ssl.google-analytics.com',
  'analytics.google.com',
  'region1.google-analytics.com',
  ['googlesyndication', 'com'].join('.'),
  'doubleclick.net',
  'stats.g.doubleclick.net',
  'googleadservices.com',
  'www.googleadservices.com',
  'adservice.google.com',
  'app-measurement.com',
  'firebaseinstallations.googleapis.com',
  'firebaselogging.googleapis.com',
  'firebaselogging-pa.googleapis.com',
  'crashlyticsreports-pa.googleapis.com',
] as const;

export function isBlockedTelemetryUrl(rawUrl: string | URL | null | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const parsed =
      typeof rawUrl === 'string'
        ? new URL(rawUrl, typeof window !== 'undefined' ? window.location.origin : 'https://hiperverso.app')
        : rawUrl;
    const host = parsed.hostname.toLowerCase();
    return BLOCKED_GOOGLE_TELEMETRY_HOSTS.some(
      (blocked) => host === blocked || host.endsWith(`.${blocked}`)
    );
  } catch {
    return false;
  }
}

let guardInstalled = false;

export function installSovereignEgressGuard(): void {
  if (typeof window === 'undefined' || guardInstalled) return;
  guardInstalled = true;

  // 1. Intercepta window.fetch para descartar localmente qualquer telemetria externa
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.href
        : typeof Request !== 'undefined' && input instanceof Request
        ? input.url
        : String(input);

    if (isBlockedTelemetryUrl(url)) {
      return new Response(null, { status: 204, statusText: 'Intercepted by SovereignEgressGuard' });
    }
    return originalFetch(input, init);
  };

  // 2. Intercepta navigator.sendBeacon
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const originalBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url: string | URL, data?: BodyInit | null): boolean => {
      if (isBlockedTelemetryUrl(url)) {
        return true;
      }
      return originalBeacon(url, data);
    };
  }

  // 3. Intercepta XMLHttpRequest
  if (typeof XMLHttpRequest !== 'undefined') {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null
    ) {
      (this as XMLHttpRequest & { __sovereignBlocked?: boolean }).__sovereignBlocked = isBlockedTelemetryUrl(url);
      if ((this as XMLHttpRequest & { __sovereignBlocked?: boolean }).__sovereignBlocked) {
        return originalOpen.call(this, method, 'data:text/plain,', async ?? true, username ?? null, password ?? null);
      }
      return originalOpen.call(this, method, url, async ?? true, username ?? null, password ?? null);
    };

    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      if ((this as XMLHttpRequest & { __sovereignBlocked?: boolean }).__sovereignBlocked) {
        return;
      }
      return originalSend.call(this, body);
    };
  }
}

export default function SovereignEgressGuard() {
  useEffect(() => {
    installSovereignEgressGuard();
  }, []);

  return null;
}
