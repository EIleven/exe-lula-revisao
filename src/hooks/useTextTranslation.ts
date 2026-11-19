// src/hooks/useTextTranslation.ts
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocale } from 'next-intl';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { auth } from '@/lib/firebase';
import { detectLikelyLanguage } from '@/lib/i18n/detectLanguage';
import {
  getTranslationLanguageLabel,
  readTranslationPreferences,
  resolveUserTargetLanguage,
  TRANSLATION_PREFS_EVENT,
} from '@/lib/i18n/translationPreferences';
import type { TranslationPreferences } from '@/lib/types';

interface ClientTranslationEntry {
  translatedText: string;
  detectedSource: string;
}

const clientTranslationCache = new Map<string, ClientTranslationEntry>();

function buildClientCacheKey(text: string, target: string): string {
  return `${target}:${text}`;
}

export function useTextTranslation(rawText: string | null | undefined) {
  const { currentUser } = useCurrentUser();
  const locale = useLocale();
  const [prefs, setPrefs] = useState<TranslationPreferences>(() =>
    readTranslationPreferences(currentUser),
  );
  const [isTranslating, setIsTranslating] = useState(false);
  const [showTranslated, setShowTranslated] = useState(false);
  const [translatedEntry, setTranslatedEntry] = useState<ClientTranslationEntry | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setPrefs(readTranslationPreferences(currentUser));
  }, [currentUser]);

  useEffect(() => {
    const onPrefsChanged = (event: Event) => {
      const detail = (event as CustomEvent<TranslationPreferences>).detail;
      if (detail) setPrefs(detail);
    };
    window.addEventListener(TRANSLATION_PREFS_EVENT, onPrefsChanged);
    return () => window.removeEventListener(TRANSLATION_PREFS_EVENT, onPrefsChanged);
  }, []);

  const isLoggedIn = Boolean(currentUser?.id);
  const targetLang = useMemo(
    () => resolveUserTargetLanguage(prefs, locale),
    [prefs, locale],
  );
  const targetLabel = useMemo(
    () => getTranslationLanguageLabel(targetLang),
    [targetLang],
  );

  const normalizedText = (rawText ?? '').trim();
  const detectedLang = useMemo(
    () => (isLoggedIn && prefs.mode !== 'off' ? detectLikelyLanguage(normalizedText) : null),
    [isLoggedIn, prefs.mode, normalizedText],
  );

  // Só oferece tradução para usuários logados quando o texto parece estar em outro idioma
  const canTranslate = Boolean(
    isLoggedIn &&
      prefs.mode !== 'off' &&
      normalizedText.length >= 8 &&
      detectedLang !== null &&
      detectedLang !== targetLang,
  );

  const runTranslate = useCallback(async () => {
    if (!canTranslate || !normalizedText) return;
    const cacheKey = buildClientCacheKey(normalizedText, targetLang);
    const hit = clientTranslationCache.get(cacheKey);
    if (hit) {
      setTranslatedEntry(hit);
      setShowTranslated(true);
      setHasError(false);
      return;
    }

    setIsTranslating(true);
    setHasError(false);
    try {
      const token = await auth.currentUser?.getIdToken().catch(() => null);
      if (!token) return;
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          text: normalizedText,
          target: targetLang,
          source: detectedLang && detectedLang !== 'other' ? detectedLang : 'auto',
        }),
      });
      if (!res.ok) {
        setHasError(true);
        return;
      }
      const data = (await res.json()) as {
        translatedText?: string;
        detectedSource?: string;
      };
      if (typeof data.translatedText === 'string' && data.translatedText.trim()) {
        const entry: ClientTranslationEntry = {
          translatedText: data.translatedText.trim(),
          detectedSource: data.detectedSource || detectedLang || 'auto',
        };
        clientTranslationCache.set(cacheKey, entry);
        setTranslatedEntry(entry);
        setShowTranslated(true);
      } else {
        setHasError(true);
      }
    } catch {
      setHasError(true);
    } finally {
      setIsTranslating(false);
    }
  }, [canTranslate, normalizedText, targetLang, detectedLang]);

  // Modo automático: traduz automaticamente quando o post entra na tela
  useEffect(() => {
    if (canTranslate && prefs.mode === 'auto' && !translatedEntry && !isTranslating && !hasError) {
      void runTranslate();
    }
  }, [canTranslate, prefs.mode, translatedEntry, isTranslating, hasError, runTranslate]);

  // Reseta estado se o texto ou idioma mudar
  useEffect(() => {
    const cacheKey = buildClientCacheKey(normalizedText, targetLang);
    const hit = clientTranslationCache.get(cacheKey);
    if (hit && prefs.mode === 'auto') {
      setTranslatedEntry(hit);
      setShowTranslated(true);
    } else {
      setTranslatedEntry(hit ?? null);
      setShowTranslated(false);
    }
    setHasError(false);
  }, [normalizedText, targetLang, prefs.mode]);

  const toggleTranslation = useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (translatedEntry) {
        setShowTranslated((prev) => !prev);
      } else {
        void runTranslate();
      }
    },
    [translatedEntry, runTranslate],
  );

  return {
    canTranslate,
    isTranslating,
    isTranslated: showTranslated && Boolean(translatedEntry),
    translatedText: showTranslated && translatedEntry ? translatedEntry.translatedText : null,
    detectedSource: translatedEntry?.detectedSource || detectedLang || null,
    targetLabel,
    hasError,
    toggleTranslation,
  };
}

