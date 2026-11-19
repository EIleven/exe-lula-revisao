// src/lib/feed/portugueseText.ts
// Reconhecer português num texto, com tecnologia nossa: contagem de palavras-função. Sem modelo, sem treino, sem serviço de
// terceiro e sem rede — é contagem de palavras de uma lista fixa, determinística e auditável. PURO:
// e2e/public-visibility-check.mjs prova cada regra.
//
// Por que existe: a vitrine de quem não tem conta mostra só português (ver publicVisibility.ts), e a maioria dos posts que
// chegam do Fediverso NÃO declara idioma. Sem isto, "não declarou" viraria "não mostra", e a porta de entrada da rede ficaria
// quase vazia. Com isto, o que está escrito em português é reconhecido pelo que está escrito.
//
// A regra é CONSERVADORA de propósito: na dúvida, responde que não sabe. É melhor deixar de fora um post em português do que
// pôr na vitrine um post que ninguém garante que seja.

/** Palavras que praticamente só aparecem em português, e aparecem o tempo todo. */
const PORTUGUES = new Set([
  'que', 'não', 'nao', 'uma', 'para', 'com', 'dos', 'das', 'mais', 'como', 'mas', 'está', 'esta', 'são', 'sao', 'pelo',
  'pela', 'isso', 'você', 'voce', 'também', 'tambem', 'muito', 'quando', 'sobre', 'porque', 'já', 'ja', 'ser', 'tem',
  'foi', 'seu', 'sua', 'nós', 'nos', 'ele', 'ela', 'eles', 'elas', 'aqui', 'agora', 'ainda', 'sem', 'até', 'ate',
  'então', 'entao', 'gente', 'coisa', 'fazer', 'estão', 'estao', 'vai', 'pra', 'nada', 'tudo', 'bem', 'povo', 'nosso',
  'nossa', 'quem', 'onde', 'cada', 'outro', 'outra', 'todos', 'todas', 'depois', 'antes', 'hoje', 'ano', 'anos', 'dia',
]);

/** Palavras curtas que puxam para outras línguas e que o português não usa assim. */
const OUTRAS = new Set([
  // inglês
  'the', 'and', 'you', 'this', 'that', 'with', 'for', 'have', 'from', 'they', 'what', 'about', 'would', 'there',
  'their', 'been', 'will', 'your', 'just', 'like', 'people', 'because', 'which', 'when', 'some', 'more', 'other',
  // espanhol (o vizinho que mais confunde)
  'pero', 'porqué', 'esto', 'ustedes', 'ellos', 'hacia', 'desde', 'muy', 'está', 'años', 'también',
  // francês / alemão / italiano, os mais comuns no Fediverso
  'les', 'des', 'est', 'une', 'pour', 'dans', 'avec', 'nicht', 'und', 'der', 'die', 'das', 'ist', 'mit', 'auch',
  'che', 'non', 'per', 'sono', 'della',
]);

/** Palavras ambíguas entre português e espanhol: não contam para nenhum dos dois. */
const AMBIGUAS = new Set(['está', 'esta', 'también', 'tambem', 'anos', 'años', 'como', 'más', 'mas', 'sin', 'con', 'por', 'una', 'para', 'nos', 'ele', 'de', 'da', 'do', 'em', 'no', 'na', 'os', 'as', 'um']);

/** Mínimo de palavras para a contagem valer: num texto curto demais, qualquer palavra é coincidência. */
export const MIN_PALAVRAS = 6;
/** Mínimo de acertos em português para afirmar que é português. */
export const MIN_SINAIS = 2;

export type DeteccaoIdioma = 'pt' | 'outro' | 'indefinido';

function palavras(texto: string): string[] {
  return texto
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')   // endereço não é idioma
    .replace(/[@#][\p{L}\p{N}_.-]+/gu, ' ') // menção e hashtag também não
    .replace(/<[^>]*>/g, ' ')
    .split(/[^\p{L}]+/u)
    .filter((p) => p.length > 1);
}

/**
 * O texto está em português?
 *
 * - `'pt'`: há sinais claros de português e nenhum sinal mais forte de outra língua.
 * - `'outro'`: os sinais de outra língua ganham.
 * - `'indefinido'`: texto curto demais, ou sem sinal nenhum (só emoji, só link, só nomes próprios).
 */
export function detectarPortugues(texto: unknown): DeteccaoIdioma {
  if (typeof texto !== 'string' || !texto.trim()) return 'indefinido';
  const lista = palavras(texto);
  if (lista.length < MIN_PALAVRAS) return 'indefinido';

  let pt = 0;
  let outras = 0;
  for (const p of lista) {
    if (AMBIGUAS.has(p)) continue;
    if (PORTUGUES.has(p)) pt++;
    else if (OUTRAS.has(p)) outras++;
  }
  // Acento de uso português (ã, õ, ç) é sinal forte, mas sozinho não decide.
  if (/[ãõç]/i.test(texto)) pt++;

  if (pt >= MIN_SINAIS && pt > outras) return 'pt';
  if (outras >= MIN_SINAIS && outras > pt) return 'outro';
  return 'indefinido';
}
