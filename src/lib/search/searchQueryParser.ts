// src/lib/search/searchQueryParser.ts

const FEDIVERSE_HANDLE_RE = /^@?([A-Za-z0-9_.-]{1,64})@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$/;

const LOCAL_APP_HOSTS = new Set([
  'exercitodolula.app',
  'www.exercitodolula.app',
  'hiperverso.app',
  'www.hiperverso.app',
  'hiperverso.social',
  'www.hiperverso.social',
]);

const PRIVATE_OR_LOCAL_HOST_RE =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[::1\]|\[fc|\[fd|\[fe80)|172\.(1[6-9]|2\d|3[01])\.|\.(local|internal|localhost|lan)$/i;

export type ClassifiedSearchQuery =
  | { kind: 'local-url'; path: string; url: string }
  | { kind: 'fediverse-profile-url'; handle: string; domain: string; url: string }
  | { kind: 'fediverse-handle'; handle: string; domain: string }
  | { kind: 'external-url'; url: string; domain: string }
  | { kind: 'unsafe-url'; reason: string }
  | { kind: 'hashtag'; tag: string }
  | { kind: 'text'; text: string };

export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function isPublicSafeUrlHostname(hostname: string): boolean {
  const clean = hostname.trim().toLowerCase();
  if (!clean || !clean.includes('.')) return false;
  if (PRIVATE_OR_LOCAL_HOST_RE.test(clean)) return false;
  // Rejeita IPv4 literal
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(clean)) return false;
  return true;
}

export function classifySearchQuery(raw: string): ClassifiedSearchQuery {
  const trimmed = (raw || '').trim();
  if (!trimmed) return { kind: 'text', text: '' };

  if (/^(javascript|data|vbscript|file|blob):/i.test(trimmed)) {
    return { kind: 'unsafe-url', reason: 'protocolo-bloqueado' };
  }

  // 1. Handle direto do Fediverso (@user@domain ou user@domain)
  const handleMatch = trimmed.match(FEDIVERSE_HANDLE_RE);
  if (handleMatch) {
    const user = handleMatch[1];
    const domain = handleMatch[2].toLowerCase();
    if (!isPublicSafeUrlHostname(domain)) {
      return { kind: 'unsafe-url', reason: 'host-privado' };
    }
    return {
      kind: 'fediverse-handle',
      handle: `${user}@${domain}`,
      domain,
    };
  }

  // 2. URL com protocolo http(s):// ou domínio/caminho (ex.: ursal.zone/@Bruiserzinha)
  const looksLikeUrl =
    /^https?:\/\//i.test(trimmed) ||
    /^[a-z0-9-]+(?:\.[a-z0-9-]+)+\/(?:@|users\/|u\/|profile\/|post\/|tag\/)/i.test(trimmed);

  if (looksLikeUrl) {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      const parsed = new URL(withProto);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return { kind: 'unsafe-url', reason: 'protocolo-invalido' };
      }

      const host = parsed.hostname.toLowerCase();

      // URL do próprio HiperVerso / Exe. Lula
      if (LOCAL_APP_HOSTS.has(host)) {
        const safePath = `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
        return {
          kind: 'local-url',
          path: safePath.startsWith('/') ? safePath : `/${safePath}`,
          url: parsed.toString(),
        };
      }

      if (!isPublicSafeUrlHostname(host)) {
        return { kind: 'unsafe-url', reason: 'host-privado' };
      }

      // Padrões comuns de perfil do Fediverso:
      // - https://mastodon.social/@gargron
      // - https://ursal.zone/@Bruiserzinha
      // - https://instancia.tld/users/fulano
      // - https://instancia.tld/u/fulano
      const atUserMatch = parsed.pathname.match(/^\/@([A-Za-z0-9_.-]{1,64})\/?$/);
      const usersPathMatch = parsed.pathname.match(/^\/(?:users|u)\/([A-Za-z0-9_.-]{1,64})\/?$/);
      const userSegment = atUserMatch?.[1] || usersPathMatch?.[1];
      if (userSegment) {
        return {
          kind: 'fediverse-profile-url',
          handle: `${userSegment}@${host}`,
          domain: host,
          url: parsed.toString(),
        };
      }

      // Qualquer outra URL pública (post remoto, nota ActivityPub, perfil customizado)
      return {
        kind: 'external-url',
        url: parsed.toString(),
        domain: host,
      };
    } catch {
      return { kind: 'unsafe-url', reason: 'url-invalida' };
    }
  }

  // 3. Hashtag
  if (trimmed.startsWith('#') && trimmed.length > 1 && !/\s/.test(trimmed)) {
    return { kind: 'hashtag', tag: trimmed.slice(1) };
  }

  return { kind: 'text', text: trimmed };
}
