// src/lib/i18n/detectLanguage.ts
import type { SupportedTranslationLangCode } from './translationPreferences';

export type DetectedLanguageCode = SupportedTranslationLangCode | 'other';

const LANG_KEYWORDS: Record<SupportedTranslationLangCode, readonly string[]> = {
  pt: [
    'não', 'nao', 'para', 'com', 'uma', 'você', 'voce', 'isso', 'mais', 'muito', 'como', 'aqui', 'também', 'tambem',
    'sobre', 'entre', 'porque', 'quando', 'ainda', 'mesmo', 'pode', 'está', 'esta', 'são', 'sao', 'tem', 'foi', 'ser',
    'fazer', 'agora', 'hoje', 'sempre', 'então', 'entao', 'gente', 'tudo', 'nada', 'cada', 'quem', 'onde', 'pelo', 'pela',
    'que', 'mas', 'dos', 'das', 'aos', 'nos', 'nas', 'desse', 'dessa', 'nesse', 'nessa', 'seu', 'sua', 'seus', 'suas',
    'ele', 'ela', 'eles', 'elas', 'estão', 'estao', 'estamos', 'gosto', 'tema', 'um',
  ],
  en: [
    'the', 'and', 'that', 'have', 'for', 'not', 'with', 'you', 'this', 'but', 'his', 'from', 'they', 'say', 'her', 'she',
    'will', 'one', 'all', 'would', 'there', 'their', 'what', 'about', 'which', 'when', 'make', 'can', 'like', 'just',
    'know', 'take', 'into', 'your', 'some', 'could', 'them', 'other', 'than', 'then', 'its', 'also', 'because', 'been',
  ],
  es: [
    'que', 'los', 'las', 'por', 'para', 'con', 'una', 'como', 'pero', 'más', 'mas', 'este', 'esta', 'eso', 'muy',
    'también', 'tambien', 'sobre', 'entre', 'porque', 'cuando', 'todo', 'esta', 'está', 'son', 'tiene', 'fue', 'hacer',
    'ahora', 'hoy', 'siempre', 'nada', 'quien', 'donde', 'desde', 'hasta', 'sin', 'puede', 'gracias', 'hola',
  ],
  fr: [
    'les', 'des', 'une', 'pour', 'dans', 'qui', 'que', 'est', 'pas', 'plus', 'avec', 'tout', 'faire', 'sur', 'vous',
    'nous', 'mais', 'comme', 'bien', 'aussi', 'être', 'etre', 'avoir', 'cette', 'sont', 'même', 'meme', 'très', 'tres',
    'donc', 'alors', 'depuis', 'sans', 'chez', 'encore', 'toujours', 'merci', 'bonjour',
  ],
  de: [
    'der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'ich', 'sie', 'mit', 'auf', 'für', 'fur', 'von', 'den',
    'zu', 'auch', 'als', 'noch', 'nach', 'wie', 'aber', 'wir', 'sind', 'hat', 'aus', 'bei', 'über', 'uber', 'wenn',
    'kann', 'schon', 'mehr', 'sehr', 'alle', 'dann', 'hier', 'danke', 'hallo',
  ],
  it: [
    'che', 'non', 'per', 'una', 'con', 'sono', 'come', 'più', 'piu', 'questo', 'questa', 'anche', 'molto', 'tutto',
    'fare', 'sul', 'sulla', 'della', 'delle', 'degli', 'perché', 'perche', 'quando', 'sempre', 'ciao', 'grazie',
    'bene', 'oggi', 'adesso', 'dove', 'cosa', 'alla', 'alle', 'nel', 'nella',
  ],
};

function stripNonLinguisticTokens(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/@[A-Za-z0-9_.-]+(?:@[A-Za-z0-9.-]+)?/g, ' ')
    .replace(/#[A-Za-z0-9_À-ÿ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Heurística rápida e determinística para detectar se o texto já está no idioma do usuário
 * ou se provavelmente está em outro idioma (e merece opção de tradução).
 */
export function detectLikelyLanguage(rawText: string | null | undefined): DetectedLanguageCode | null {
  if (!rawText) return null;
  const clean = stripNonLinguisticTokens(rawText);
  if (clean.length < 8) return null;

  // Scripts não-latinos (Cirílico, CJK, Árabe, Coreano, Hebraico, Grego, Devangari)
  if (/[\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\u0600-\u06FF\u0590-\u05FF\u0370-\u03FF]/.test(clean)) {
    return 'other';
  }

  const words = clean.toLowerCase().match(/[a-zà-ÿ]{2,}/gi);
  if (!words || words.length < 2) return null;

  const scores: Record<SupportedTranslationLangCode, number> = {
    pt: 0,
    en: 0,
    es: 0,
    fr: 0,
    de: 0,
    it: 0,
  };

  // Diacríticos fortemente característicos dão peso extra imediato
  if (/[ãõ]/i.test(clean) && !/[ñ¿¡]/i.test(clean)) scores.pt += 6;
  else if (/[ç]/i.test(clean) && !/[ñ¿¡]/i.test(clean)) scores.pt += 3;
  if (/[ñ¿¡]/i.test(clean)) scores.es += 3;
  if (/[ßäöü]/i.test(clean)) scores.de += 3;
  if (/[çœæ]/i.test(clean) && !/[ãõ]/i.test(clean)) scores.fr += 2;

  for (const w of words) {
    for (const lang of Object.keys(LANG_KEYWORDS) as SupportedTranslationLangCode[]) {
      if (LANG_KEYWORDS[lang].includes(w)) {
        scores[lang] += 1;
      }
    }
  }

  let bestLang: SupportedTranslationLangCode | null = null;
  let bestScore = 0;
  for (const [lang, score] of Object.entries(scores) as [SupportedTranslationLangCode, number][]) {
    if (score > bestScore) {
      bestScore = score;
      bestLang = lang;
    }
  }

  // Se nenhum idioma conhecido pontuou e o texto é longo o suficiente, trata como outro idioma
  if (!bestLang || bestScore === 0) {
    return words.length >= 4 ? 'other' : null;
  }

  return bestLang;
}

