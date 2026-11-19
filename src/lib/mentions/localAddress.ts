// src/lib/mentions/localAddress.ts
// Reconhece, no que a pessoa digita ao mencionar, um ENDEREÇO LOCAL: `usuario@exercitodolula.app` (com ou sem o `@` da frente,
// em qualquer caixa, com ou sem `www.`, e também a meio caminho: `usuario@` ou `usuario@exercito`). PURO (sem Firebase nem React):
// e2e/mention-query-check.mjs prova cada caso.
//
// Por que existe: digitar `@ExercitoDoLula@exercitodolula.app` mandava a string INTEIRA para a busca local (o campo `username` só
// guarda `ExercitoDoLula`) e, como o texto parece um endereço do Fediverso, depois ao resolvedor remoto, que responde
// `perfil-local` (não é remoto, é daqui) e era descartado: "Nenhum resultado encontrado" para uma conta que existe.

export type LocalMentionQuery = {
  /** O handle local, em minúsculas (é a chave do índice `usernames/{handle}`). */
  handle: string;
  /** O domínio já está completo (`exercitodolula.app`) e não só começado (`exerc`)? */
  complete: boolean;
};

const PARTE_LOCAL = /^[A-Za-z0-9_]{1,15}$/;

/**
 * `null` quando o texto não é (nem parece estar virando) um endereço local: aí a busca segue o caminho normal, incluindo o
 * Fediverso. Um domínio de OUTRO servidor (`fulano@mastodon.social`) nunca vira local.
 */
export function parseLocalMentionQuery(raw: unknown, localDomains: readonly string[]): LocalMentionQuery | null {
  if (typeof raw !== 'string') return null;
  const texto = raw.trim().replace(/^@/, '');
  const arroba = texto.indexOf('@');
  if (arroba < 0) return null;
  const parteLocal = texto.slice(0, arroba);
  const dominio = texto.slice(arroba + 1).toLowerCase();
  if (dominio.includes('@') || !PARTE_LOCAL.test(parteLocal)) return null;
  const dominios = localDomains.map((d) => d.toLowerCase()).filter(Boolean);
  // Vazio (`usuario@`) ou um começo do nosso domínio (`usuario@exerc`): ainda pode virar local.
  if (!dominios.some((d) => d.startsWith(dominio))) return null;
  return { handle: parteLocal.toLowerCase(), complete: dominios.includes(dominio) };
}

/** `usuario` puro (sem arroba) que serve de handle local para a busca exata, ou `null`. */
export function plainLocalHandle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const texto = raw.trim().replace(/^@/, '');
  return /^[A-Za-z0-9_]{3,15}$/.test(texto) ? texto.toLowerCase() : null;
}
