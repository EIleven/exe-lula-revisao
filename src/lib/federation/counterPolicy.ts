// src/lib/federation/counterPolicy.ts
// A REGRA de quando confiar no contador que a instância de ORIGEM informa para um post remoto, em vez de manter o que temos.
// PURA (sem Firebase): a suíte (e2e/counter-policy-check.mjs) exercita cada caso em Node.
//
// O problema: o contador de um post `ap_*` recebe números de várias fontes (a busca de perfil, o `/statuses/{id}` do
// servidor de origem, a lista de quem reagiu, os eventos que chegam no inbox, e as curtidas DAQUI). O código usava
// `Math.max(guardado, origem)`, que evita voltar a 0 por uma leitura ruim, mas tem dois defeitos: nunca desce (quem descurte
// no Fediverso continua contado para sempre) e perpetua QUALQUER valor inflado já gravado por engano. Aqui:
//
//  - o servidor de origem é a fonte da verdade do número PÚBLICO quando responde com um número válido e recente;
//  - mas nunca mostramos MENOS gente do que sabemos que reagiu (o piso: marcadores que existem aqui, e a lista de quem
//    reagiu que acabamos de enumerar);
//  - uma queda para ZERO é suspeita (instâncias que escondem contagens devolvem 0): só vale se a lista enumerada confirma, ou
//    se o número guardado já era pequeno;
//  - uma leitura mais antiga que a já aplicada nunca vence (as buscas voltam fora de ordem).

export type CountDecision = {
  value: number;
  action: 'keep' | 'raise' | 'lower';
  reason:
    | 'origem-sem-numero'
    | 'leitura-antiga'
    | 'igual'
    | 'origem-maior'
    | 'piso-maior'
    | 'queda-aceita'
    | 'queda-a-zero-suspeita'
    | 'zero-confirmado';
};

export type CountInput = {
  /** O que está guardado no documento. */
  stored: number;
  /** O que a origem informou nesta busca (qualquer coisa: só número válido conta). */
  origin?: unknown;
  /** Quantas pessoas sabemos que reagiram (marcadores guardados aqui): o número nunca fica abaixo disto. */
  floor?: number;
  /** A lista de quem reagiu foi enumerada por completo e tem este tamanho (confirma o zero). */
  confirmedZero?: boolean;
  /** Quando esta leitura foi feita, e quando foi a leitura já aplicada ao documento. */
  fetchedAtMs?: number;
  storedFetchedAtMs?: number | null;
};

const validCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e12;
/** Acima disto um número guardado que cai a zero deixa de ser "pequeno demais para desconfiar". */
export const SMALL_STORED = 3;

export function reconcileRemoteCount(input: CountInput): CountDecision {
  const stored = validCount(input.stored) ? Math.floor(input.stored) : 0;
  const floor = validCount(input.floor) ? Math.floor(input.floor) : 0;
  const keep = (reason: CountDecision['reason']): CountDecision => ({ value: stored, action: 'keep', reason });

  const origemValida = validCount(input.origin);

  if (
    origemValida &&
    typeof input.fetchedAtMs === 'number' &&
    typeof input.storedFetchedAtMs === 'number' &&
    input.fetchedAtMs < input.storedFetchedAtMs
  ) {
    return keep('leitura-antiga');
  }

  if (!origemValida) {
    // Sem número da origem, só o piso pode subir o contador (nunca descer).
    return floor > stored ? { value: floor, action: 'raise', reason: 'piso-maior' } : keep('origem-sem-numero');
  }

  const origem = Math.floor(input.origin as number);
  const alvo = Math.max(origem, floor);
  if (alvo === stored) return keep('igual');
  if (alvo > stored) return { value: alvo, action: 'raise', reason: origem >= floor ? 'origem-maior' : 'piso-maior' };

  // Queda. Para ZERO, só com confirmação (ou se o número já era pequeno).
  if (alvo === 0 && stored > SMALL_STORED && !input.confirmedZero) return keep('queda-a-zero-suspeita');
  return { value: alvo, action: 'lower', reason: alvo === 0 ? 'zero-confirmado' : 'queda-aceita' };
}

export type CountField = 'likes' | 'reposts' | 'commentsCount';
export const COUNT_FIELDS: readonly CountField[] = ['likes', 'reposts', 'commentsCount'];
