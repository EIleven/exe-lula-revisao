import { siteConfig } from '@/config/site';

export function socialOrigin(): string {
  const requested = process.env.SOCIAL_OAUTH_ORIGIN?.trim();
  if (!requested) return siteConfig.officialOrigin;
  const url = new URL(requested);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('SOCIAL_OAUTH_ORIGIN inválida.');
  return url.origin;
}

export const blueskyConfigured = () => Boolean(process.env.ATPROTO_PRIVATE_JWK?.trim());

export const socialProviderLabel = (_provider: 'bluesky') => 'Bluesky';

export function socialSettingsUrl(locale: string, result?: string, provider?: string): string {
  const safeLocale = locale === 'en' ? 'en' : 'pt-BR';
  const url = new URL(`/${safeLocale}/settings/connections`, socialOrigin());
  if (result) url.searchParams.set('social', result);
  if (provider) url.searchParams.set('provider', provider);
  return url.href;
}
