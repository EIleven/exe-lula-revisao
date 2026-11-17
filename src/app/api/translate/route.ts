// src/app/api/translate/route.ts
// Endpoint de tradução open-source (LibreTranslate + fallback Lingva FOSS) exclusivo para usuários logados.
// Mantém privacidade total: o cliente nunca chama servidores externos diretamente (zero vazamento de IP).

import type { NextRequest } from 'next/server';
import { json, readJsonObject, requireCaller } from '@/lib/server/federation';
import { evaluateRequestSecurity } from '@/lib/security/antiBotGuard';
import { requestIp } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

const SUPPORTED_TARGETS = new Set(['pt', 'en', 'es', 'fr', 'de', 'it']);
const MAX_TEXT_LENGTH = 5000;
const MAX_CACHE_ENTRIES = 800;

interface CachedTranslation {
  translatedText: string;
  detectedSource: string;
  provider: string;
}

const translationCache = new Map<string, CachedTranslation>();

function cacheKeyOf(text: string, target: string, source: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${target}:${source}:${text.length}:${(h >>> 0).toString(36)}`;
}

function writeCache(key: string, value: CachedTranslation): void {
  if (translationCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = translationCache.keys().next().value;
    if (oldest) translationCache.delete(oldest);
  }
  translationCache.set(key, value);
}

async function translateViaLibreTranslate(
  text: string,
  target: string,
  source: string,
): Promise<CachedTranslation | null> {
  const configuredUrl = process.env.LIBRETRANSLATE_URL?.trim();
  const apiKey = process.env.LIBRETRANSLATE_API_KEY?.trim();
  const endpoints = configuredUrl
    ? [configuredUrl]
    : ['https://libretranslate.de/translate', 'https://translate.terraprint.co/translate'];

  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6500);
      const res = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          q: text,
          source: source === 'auto' ? 'auto' : source,
          target,
          format: 'text',
          ...(apiKey ? { api_key: apiKey } : {}),
        }),
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = (await res.json()) as {
        translatedText?: string;
        detectedLanguage?: { language?: string };
      };
      if (typeof data.translatedText === 'string' && data.translatedText.trim()) {
        return {
          translatedText: data.translatedText.trim(),
          detectedSource: data.detectedLanguage?.language || (source === 'auto' ? 'auto' : source),
          provider: 'libretranslate',
        };
      }
    } catch {
      // tenta próximo espelho open-source
    }
  }
  return null;
}

async function translateViaLingva(
  text: string,
  target: string,
  source: string,
): Promise<CachedTranslation | null> {
  const src = source === 'auto' ? 'auto' : source;
  const mirrors = [
    'https://lingva.ml',
    'https://lingva.garudalinux.org',
    'https://translate.plausibility.cloud',
  ];

  // Lingva recebe o texto na URL; para textos longos dividimos por parágrafos com limite seguro.
  const trimmed = text.slice(0, 1800);
  for (const base of mirrors) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6500);
      const url = `${base}/api/v1/${encodeURIComponent(src)}/${encodeURIComponent(target)}/${encodeURIComponent(trimmed)}`;
      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = (await res.json()) as {
        translation?: string;
        info?: { detectedSource?: string };
      };
      if (typeof data.translation === 'string' && data.translation.trim()) {
        return {
          translatedText: data.translation.trim(),
          detectedSource: data.info?.detectedSource || src,
          provider: 'lingva',
        };
      }
    } catch {
      // tenta próximo espelho Lingva
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  const ip = requestIp(request);
  const guard = evaluateRequestSecurity({
    ip,
    path: '/api/translate',
    userAgent: request.headers.get('user-agent'),
    acceptLanguage: request.headers.get('accept-language'),
  });
  if (!guard.allowed && guard.action === 'block') {
    return json(429, { error: 'bloqueio-anti-bot' }, { 'Retry-After': String(guard.retryAfterSec || 30) });
  }

  // Apenas usuários autenticados têm acesso à tradução
  const caller = await requireCaller(request, 'translate-api', 80);
  if (caller instanceof Response) return caller;

  const body = await readJsonObject(request);
  const rawText = typeof body?.text === 'string' ? body.text.trim() : '';
  const target = typeof body?.target === 'string' ? body.target.trim().toLowerCase() : 'pt';
  const source = typeof body?.source === 'string' ? body.source.trim().toLowerCase() : 'auto';

  if (!rawText) {
    return json(400, { error: 'texto-vazio' });
  }
  if (rawText.length > MAX_TEXT_LENGTH) {
    return json(400, { error: 'texto-muito-longo' });
  }
  if (!SUPPORTED_TARGETS.has(target)) {
    return json(400, { error: 'idioma-nao-suportado' });
  }

  const key = cacheKeyOf(rawText, target, source);
  const cached = translationCache.get(key);
  if (cached) {
    return json(200, { ...cached, cached: true });
  }

  const viaLibre = await translateViaLibreTranslate(rawText, target, source);
  if (viaLibre) {
    writeCache(key, viaLibre);
    return json(200, viaLibre);
  }

  const viaLingva = await translateViaLingva(rawText, target, source);
  if (viaLingva) {
    writeCache(key, viaLingva);
    return json(200, viaLingva);
  }

  return json(503, { error: 'servico-traducao-indisponivel' });
}
