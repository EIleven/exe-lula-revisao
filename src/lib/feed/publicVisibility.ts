// src/lib/feed/publicVisibility.ts
// O que um VISITANTE (sem conta) pode ver. Módulo puro: e2e/public-visibility-check.mjs prova cada regra.
//
// Duas promessas, e as duas valem na LISTAGEM, não só na hora de desenhar:
//
// 1. **Nada de conteúdo sensível.** Para quem está logado, conteúdo com aviso fica coberto e a pessoa escolhe abrir.
//    Quem chega de fora não escolheu nada e pode ser qualquer pessoa, de qualquer idade: o item não entra na lista.
//    Borrar a mídia não basta — o texto, o aviso e a própria existência do item ficam fora.
// 2. **Só português.** A porta de entrada da rede é brasileira. O Fediverso traz muito conteúdo em outras línguas, e
//    uma primeira página em inglês e japonês não é a rede que a pessoa veio ver. Quem entra escolhe o resto.
//
// Nada disto é moderação nem julgamento de conteúdo: é o recorte do que a casa mostra na vitrine.

import { detectarPortugues } from './portugueseText.ts';

/** Post ou comentário, no mínimo que estas regras precisam ler. */
export type PublicVisibilityItem = {
  id?: string | null;
  sensitive?: boolean | null;
  contentWarning?: string | null;
  /** Etiqueta de idioma declarada pela origem (`pt`, `pt-BR`, `en`...). Ausente em post nosso. */
  language?: string | null;
  isRemoteFediverse?: boolean | null;
  userId?: string | null;
  /** Usado só quando a origem não declarou idioma: o texto é lido por contagem de palavras (lib/feed/portugueseText.ts). */
  text?: string | null;
  headline?: string | null;
};

const PREFIXO_REMOTO = 'ap_';

/** O item veio de outro servidor do Fediverso? */
export function isRemoteItem(item: PublicVisibilityItem): boolean {
  if (item.isRemoteFediverse === true) return true;
  return typeof item.id === 'string' && item.id.startsWith(PREFIXO_REMOTO)
    || typeof item.userId === 'string' && item.userId.startsWith(PREFIXO_REMOTO);
}

/** A etiqueta de idioma é português? Aceita `pt`, `pt-BR`, `PT_br`; recusa `pts`, `en`, vazio e qualquer não-texto. */
export function isPortuguese(valor: unknown): boolean {
  if (typeof valor !== 'string') return false;
  const limpo = valor.trim().toLowerCase().replace('_', '-');
  return limpo === 'pt' || limpo.startsWith('pt-');
}

/** Tem aviso de conteúdo (texto do autor) ou marca de sensível? */
export function hasContentWarning(item: PublicVisibilityItem): boolean {
  if (item.sensitive === true) return true;
  return typeof item.contentWarning === 'string' && item.contentWarning.trim().length > 0;
}

/**
 * O item pode aparecer para quem NÃO está logado?
 *
 * Post nosso sem idioma declarado conta como português: é uma rede brasileira e nós não etiquetamos idioma na criação.
 * Post de outro servidor que DECLARA o idioma é decidido pela etiqueta. Quando não declara (o caso mais comum no
 * Fediverso), o texto é lido por contagem de palavras (lib/feed/portugueseText.ts): sem isso, "não declarou" viraria
 * "não mostra" e a porta de entrada ficaria vazia — 299 dos 300 posts mais recentes são de fora e nenhum declara idioma.
 */
export function isPublicSafe(item: PublicVisibilityItem | null | undefined): boolean {
  if (!item) return false;
  if (hasContentWarning(item)) return false;
  if (!isRemoteItem(item)) return item.language == null || isPortuguese(item.language);
  // Declarou: a etiqueta manda.
  if (item.language != null) return isPortuguese(item.language);
  // Não declarou (o caso mais comum no Fediverso): lê o texto. Só entra quando o texto DIZ que é português.
  return detectarPortugues([item.headline, item.text].filter(Boolean).join(' ')) === 'pt';
}

/** A lista como um visitante a vê. Com alguém logado (`activeUserId`), devolve a lista inteira, sem cópia. */
export function filterForVisitor<T extends PublicVisibilityItem>(itens: readonly T[], activeUserId: string | null | undefined): readonly T[] {
  if (activeUserId) return itens;
  return itens.filter((item) => isPublicSafe(item));
}
