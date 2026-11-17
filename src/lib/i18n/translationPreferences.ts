// src/lib/i18n/translationPreferences.ts
import type { TranslationPreferences, User } from '@/lib/types';

export const TRANSLATION_PREFS_STORAGE_KEY = 'hiperverso_translation_prefs';
export const TRANSLATION_PREFS_EVENT = 'hiperverso:translation-prefs-changed';

export const SUPPORTED_TRANSLATION_LANGUAGES = [
  { code: 'pt', label: 'Português' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
] as const;

export type SupportedTranslationLangCode = (typeof SUPPORTED_TRANSLATION_LANGUAGES)[number]['code'];

const SUPPORTED_CODE_SET = new Set<string>(SUPPORTED_TRANSLATION_LANGUAGES.map((l) => l.code));

export const DEFAULT_TRANSLATION_PREFERENCES: TranslationPreferences = {
  mode: 'button',
  targetLanguage: 'auto',
  allowAutoDetectBrowserLang: true,
};

export function normalizeTranslationPreferences(
  raw?: Partial<TranslationPreferences> | null,
): TranslationPreferences {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_TRANSLATION_PREFERENCES };
  }
  const mode =
    raw.mode === 'auto' || raw.mode === 'off' ? raw.mode : 'button';
  const targetLanguage =
    typeof raw.targetLanguage === 'string' && (raw.targetLanguage === 'auto' || SUPPORTED_CODE_SET.has(raw.targetLanguage))
      ? raw.targetLanguage
      : 'auto';
  return {
    mode,
    targetLanguage,
    allowAutoDetectBrowserLang: raw.allowAutoDetectBrowserLang !== false,
  };
}

export function readTranslationPreferences(user?: User | null): TranslationPreferences {
  if (user?.translationPreferences) {
    return normalizeTranslationPreferences(user.translationPreferences);
  }
  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem(TRANSLATION_PREFS_STORAGE_KEY);
      if (stored) {
        return normalizeTranslationPreferences(JSON.parse(stored));
      }
    } catch {
      // ignore storage errors
    }
  }
  return { ...DEFAULT_TRANSLATION_PREFERENCES };
}

export function persistLocalTranslationPreferences(prefs: TranslationPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TRANSLATION_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage errors
  }
  window.dispatchEvent(new CustomEvent<TranslationPreferences>(TRANSLATION_PREFS_EVENT, { detail: prefs }));
}

export function resolveUserTargetLanguage(
  prefs: TranslationPreferences,
  appLocale: string = 'pt-BR',
): SupportedTranslationLangCode {
  if (prefs.targetLanguage !== 'auto' && SUPPORTED_CODE_SET.has(prefs.targetLanguage)) {
    return prefs.targetLanguage as SupportedTranslationLangCode;
  }
  if (prefs.allowAutoDetectBrowserLang && typeof navigator !== 'undefined' && navigator.language) {
    const browserBase = navigator.language.split('-')[0].toLowerCase();
    if (SUPPORTED_CODE_SET.has(browserBase)) {
      return browserBase as SupportedTranslationLangCode;
    }
  }
  const localeBase = appLocale.split('-')[0].toLowerCase();
  return SUPPORTED_CODE_SET.has(localeBase)
    ? (localeBase as SupportedTranslationLangCode)
    : 'pt';
}

export function getTranslationLanguageLabel(code: string): string {
  const found = SUPPORTED_TRANSLATION_LANGUAGES.find((l) => l.code === code.toLowerCase());
  return found ? found.label : code.toUpperCase();
}
