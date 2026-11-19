// src/lib/system/provenance.ts
/**
 * Marca interna de proveniência e verificação de domínio autorizado.
 * Software proprietário — HiperVerso (Copyright (c) 2026 Breno César).
 */

export const SYSTEM_PROVENANCE = {
  product: 'HiperVerso',
  owner: 'Breno César',
  provenanceId: 'echo-core-v1-2026',
  channel: 'production-core',
  buildTag: '2026.11.14',
  reportEndpoint: 'https://exercitodolula.app/api/system/provenance-alert',
} as const;

export const OFFICIAL_ALLOWED_HOSTS = [
  'exercitodolula.app',
  'www.exercitodolula.app',
  'media.exercitodolula.app',
  'hiperverso.app',
  'www.hiperverso.app',
  'media.hiperverso.app',
  'hiperverso.social',
  'www.hiperverso.social',
  'media.hiperverso.social',
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
  if (normalized.endsWith('.exercitodolula.app')) return true;
  if (normalized.endsWith('.hiperverso.app')) return true;
  if (normalized.endsWith('.hiperverso.social')) return true;
  if (normalized.endsWith('.localhost')) return true;
  return false;
}

