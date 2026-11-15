export type SocialProvider = 'bluesky';

export interface SocialConnectionSummary {
  connected: boolean;
  handle?: string;
  displayName?: string;
  avatarUrl?: string;
  connectedAt?: string;
}

export interface SocialConnectionsStatus {
  providers: Record<SocialProvider, {
    configured: boolean;
    connection: SocialConnectionSummary;
  }>;
}

export interface SocialPublishResult {
  provider: SocialProvider;
  ok: boolean;
  url?: string;
  alreadyPublished?: boolean;
  error?: string;
}

export const SOCIAL_PROVIDERS: SocialProvider[] = ['bluesky'];

export function isSocialProvider(value: unknown): value is SocialProvider {
  return value === 'bluesky';
}
