// src/lib/poll.ts
// Regras e contas da enquete do post, sem React nem Firebase (testadas em e2e/poll-check.mjs). O servidor confere o mesmo
// formato nas regras do Firestore (firestore.rules, "isValidPoll") e as Functions contam os votos.

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 4;
export const POLL_OPTION_MAX_LENGTH = 25;
/** Prazos oferecidos (minutos). O servidor aceita de 5 minutos a 7 dias. */
export const POLL_DURATIONS_MINUTES = [60, 360, 1440, 4320, 10080] as const;
export const POLL_DEFAULT_DURATION_MINUTES = 1440;
export const POLL_MIN_DURATION_MS = 5 * 60 * 1000;
export const POLL_MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
/** Ids fixos das opções: o servidor só aceita voto num deles. */
export const POLL_OPTION_IDS = ['a', 'b', 'c', 'd'] as const;

/** O que a pessoa preenche no compositor. */
export type PollInput = { options: string[]; durationMinutes: number };

export type PollError = 'tooFew' | 'tooMany' | 'tooLong' | 'duplicate' | 'duration';

/** Texto de uma opção como será gravado (sem espaços nas pontas nem repetidos). */
export const cleanOption = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * A enquete está pronta para publicar? Opções em branco são ignoradas (o formulário já mostra 2 a 4 campos); precisa de pelo
 * menos 2 preenchidas, nenhuma passando do limite, sem repetidas, e prazo de uma das opções oferecidas.
 */
export function validatePoll(input: PollInput): PollError | null {
  const options = input.options.map(cleanOption).filter(Boolean);
  if (options.length < POLL_MIN_OPTIONS) return 'tooFew';
  if (options.length > POLL_MAX_OPTIONS) return 'tooMany';
  if (options.some((o) => [...o].length > POLL_OPTION_MAX_LENGTH)) return 'tooLong';
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return 'duplicate';
  if (!(POLL_DURATIONS_MINUTES as readonly number[]).includes(input.durationMinutes)) return 'duration';
  return null;
}

export type BuiltPoll = {
  poll: { options: { id: string; text: string }[]; endsAt: Date };
  pollOptionIds: string[];
  pollCounts: Record<string, number>;
  pollTotal: number;
};

/** Os campos que o post leva no Firestore (contadores zerados: quem soma os votos são as Functions). */
export function buildPoll(input: PollInput, nowMs: number): BuiltPoll {
  const error = validatePoll(input);
  if (error) throw new Error(`Enquete inválida: ${error}`);
  const texts = input.options.map(cleanOption).filter(Boolean);
  const ids = POLL_OPTION_IDS.slice(0, texts.length) as unknown as string[];
  return {
    poll: { options: texts.map((text, index) => ({ id: ids[index], text })), endsAt: new Date(nowMs + input.durationMinutes * 60_000) },
    pollOptionIds: ids,
    pollCounts: Object.fromEntries(ids.map((id) => [id, 0])),
    pollTotal: 0,
  };
}

export type PollResultRow = { id: string; text: string; count: number; percent: number };

/**
 * Percentual de cada opção. Arredonda pelo maior resto para a soma dar sempre 100 (três opções iguais não viram 33+33+33 = 99);
 * sem votos, todas em 0.
 */
export function pollResults(options: { id: string; text: string }[], counts: Record<string, number> | null | undefined, total?: number | null): PollResultRow[] {
  const raw = options.map((o) => Math.max(0, Number(counts?.[o.id] ?? 0)));
  const sum = total != null && total > 0 ? Math.max(total, raw.reduce((a, b) => a + b, 0)) : raw.reduce((a, b) => a + b, 0);
  if (sum <= 0) return options.map((o) => ({ id: o.id, text: o.text, count: 0, percent: 0 }));
  const exact = raw.map((count) => (count * 100) / sum);
  const floors = exact.map(Math.floor);
  let rest = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (rest <= 0) break;
    floors[index] += 1;
    rest -= 1;
  }
  return options.map((o, index) => ({ id: o.id, text: o.text, count: raw[index], percent: floors[index] }));
}

export type PollTime = { ended: boolean; days: number; hours: number; minutes: number };

/** Quanto falta para a enquete encerrar (arredondado para cima: "1 min" até o último segundo). */
export function pollTimeLeft(endsAtMs: number, nowMs: number): PollTime {
  const left = endsAtMs - nowMs;
  if (left <= 0) return { ended: true, days: 0, hours: 0, minutes: 0 };
  const minutesTotal = Math.ceil(left / 60_000);
  return { ended: false, days: Math.floor(minutesTotal / 1440), hours: Math.floor((minutesTotal % 1440) / 60), minutes: minutesTotal % 60 };
}

/** A enquete aceita voto agora? (não encerrou e a pessoa ainda não votou). */
export const canVote = (endsAtMs: number, nowMs: number, myVote: string | null | undefined) => nowMs < endsAtMs && !myVote;
