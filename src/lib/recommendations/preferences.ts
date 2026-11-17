// src/lib/recommendations/preferences.ts
import type { RecommendationPreferences, User } from '@/lib/types';

export const REC_PREFS_STORAGE_KEY = 'hiperverso_rec_prefs';
export const REC_PREFS_EVENT = 'hiperverso:rec-prefs-changed';

export const DEFAULT_RECOMMENDATION_PREFERENCES: RecommendationPreferences = {
  enabled: true,
  showOnProfiles: true,
  useFollowingSignals: true,
  useInterestSignals: true,
  useActivitySignals: true,
  networkScope: 'all',
  mode: 'balanced',
  optOutFromSuggestions: false,
};

export function normalizeRecommendationPreferences(
  raw?: Partial<RecommendationPreferences> | null,
): RecommendationPreferences {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_RECOMMENDATION_PREFERENCES };
  }
  return {
    enabled: raw.enabled !== false,
    showOnProfiles: raw.showOnProfiles !== false,
    useFollowingSignals: raw.useFollowingSignals !== false,
    useInterestSignals: raw.useInterestSignals !== false,
    useActivitySignals: raw.useActivitySignals !== false,
    networkScope:
      raw.networkScope === 'local' || raw.networkScope === 'fediverse' ? raw.networkScope : 'all',
    mode:
      raw.mode === 'similar' || raw.mode === 'discovery' ? raw.mode : 'balanced',
    optOutFromSuggestions: raw.optOutFromSuggestions === true,
  };
}

export function readRecommendationPreferences(user?: User | null): RecommendationPreferences {
  if (user?.recommendationPreferences) {
    return normalizeRecommendationPreferences(user.recommendationPreferences);
  }
  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem(REC_PREFS_STORAGE_KEY);
      if (stored) {
        return normalizeRecommendationPreferences(JSON.parse(stored));
      }
    } catch {
      // ignore malformed localStorage
    }
  }
  return { ...DEFAULT_RECOMMENDATION_PREFERENCES };
}

export function persistLocalRecommendationPreferences(prefs: RecommendationPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REC_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage errors
  }
  window.dispatchEvent(new CustomEvent<RecommendationPreferences>(REC_PREFS_EVENT, { detail: prefs }));
}
