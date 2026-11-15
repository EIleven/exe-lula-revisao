// src/lib/system/provenance.ts
/**
 * Marca interna de proveniência e verificação de domínio autorizado.
 * Software proprietário — Exe. Lula / Echo (Copyright (c) 2026 Breno César).
 */

export const SYSTEM_PROVENANCE = {
  product: 'Exe. Lula / Echo',
  owner: 'Breno César',
  provenanceId: 'echo-review-juan-mrjc01-2026',
  channel: 'review-juan-mrjc01',
  buildTag: '2026.11.14',
  reportEndpoint: 'https://exercitodolula.app/api/system/provenance-alert',
} as const;

export const OFFICIAL_ALLOWED_HOSTS = [
  'exercitodolula.app',
  'www.exercitodolula.app',
  'echo-b5aw9.web.app',
  'echo-b5aw9.firebaseapp.com',
  'studio--echo-b5aw9.us-central1.hosted.app',
  'localhost',
  '127.0.0.1',
  '::1',
] as const;

export function isAuthorizedHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return true;
  if ((OFFICIAL_ALLOWED_HOSTS as readonly string[]).includes(normalized)) {
    return true;
  }
  if (normalized.endsWith('.localhost')) return true;
  return false;
}
