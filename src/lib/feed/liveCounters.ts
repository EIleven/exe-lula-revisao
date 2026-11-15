// src/lib/feed/liveCounters.ts
// Contadores do cartão (curtidas, reposts, comentários, citações) mantidos em tempo real, sem a "piscada" de voltar atrás.
// PURO (sem Firebase e sem React): a suíte (e2e/live-counters-check.mjs) exercita as corridas em Node.
//
// O problema que isto resolve: o cartão ouve o documento do post. Quando a pessoa curte, a tela mostra o número novo na hora
// (otimista), mas o servidor só atualiza o contador alguns segundos depois (quem soma é uma Function sobre o marcador de
// curtida). Nesse intervalo chega um snapshot com o número VELHO, e o cartão desfazia a curtida na tela para refazê-la logo
// depois. Aqui, a mudança que a pessoa acabou de fazer fica "pendente" e é somada ao que o servidor diz, até o servidor
// alcançá-la ou o prazo acabar.

export type CounterField = 'likes' | 'reposts' | 'commentsCount' | 'quotesCount';
/** Visualizações ficam de fora de propósito: mudam a cada pessoa que vê o post e só custariam leituras. */
export const COUNTER_FIELDS: readonly CounterField[] = ['likes', 'reposts', 'commentsCount', 'quotesCount'];
export type Counters = Record<CounterField, number>;

const DEFAULT_TTL_MS = 6_000;

type Pending = { baseline: number; delta: number; at: number };

export function createOptimisticTracker(ttlMs: number = DEFAULT_TTL_MS) {
  const pending = new Map<CounterField, Pending>();
  const lastServer = new Map<CounterField, number>();

  return {
    /** Último valor que o servidor informou para o campo (ou `undefined`). */
    lastServer: (field: CounterField): number | undefined => lastServer.get(field),
    noteServer(field: CounterField, value: number): void {
      lastServer.set(field, value);
    },
    /**
     * A pessoa mudou o campo: a tela mostrava `before` e passa a mostrar `after`. Mudanças seguidas dentro do prazo se somam
     * (curtir e descurtir logo em seguida se anulam).
     */
    track(field: CounterField, before: number, after: number, now: number): void {
      const delta = after - before;
      if (delta === 0 || !Number.isFinite(delta)) return;
      const atual = pending.get(field);
      if (atual && now - atual.at <= ttlMs) {
        const total = atual.delta + delta;
        if (total === 0) pending.delete(field);
        else pending.set(field, { baseline: atual.baseline, delta: total, at: now });
        return;
      }
      pending.set(field, { baseline: lastServer.get(field) ?? before, delta, at: now });
    },
    /** O valor a mostrar quando o servidor diz `server`. */
    resolve(field: CounterField, server: number, now: number): number {
      lastServer.set(field, server);
      const p = pending.get(field);
      if (!p) return server;
      if (now - p.at > ttlMs) {
        pending.delete(field);
        return server;
      }
      // O servidor "alcançou" quando já mostra a mudança (ou além dela).
      const alcancou = p.delta > 0 ? server >= p.baseline + p.delta : server <= p.baseline + p.delta;
      if (alcancou) {
        pending.delete(field);
        return server;
      }
      return Math.max(0, server + p.delta);
    },
    hasPending: (field?: CounterField): boolean => (field ? pending.has(field) : pending.size > 0),
  };
}

export type OptimisticTracker = ReturnType<typeof createOptimisticTracker>;

const validCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e12;

/** Só os campos de contador, e só os que são número válido. O resto do documento nunca atravessa. */
export function pickCounterFields(data: unknown): Partial<Counters> {
  const saida: Partial<Counters> = {};
  if (typeof data !== 'object' || data === null) return saida;
  const d = data as Record<string, unknown>;
  for (const campo of COUNTER_FIELDS) if (validCount(d[campo])) saida[campo] = Math.floor(d[campo] as number);
  return saida;
}

/**
 * Aplica um snapshot do servidor aos contadores da tela. Devolve os novos valores, ou `null` se nada mudou (o chamador não
 * redesenha o cartão à toa). Campo ausente ou inválido no snapshot mantém o da tela.
 */
export function mergeServerCounters(
  atual: Counters,
  data: unknown,
  tracker: OptimisticTracker,
  now: number,
): Counters | null {
  const servidor = pickCounterFields(data);
  const proximo: Counters = { ...atual };
  let mudou = false;
  for (const campo of COUNTER_FIELDS) {
    const bruto = servidor[campo];
    if (bruto === undefined) continue;
    const valor = Math.floor(tracker.resolve(campo, bruto, now));
    if (valor !== atual[campo]) {
      proximo[campo] = valor;
      mudou = true;
    }
  }
  return mudou ? proximo : null;
}

/** Os contadores de um post (ausente = 0). */
export function countersOf(post: Partial<Record<CounterField, unknown>> | null | undefined): Counters {
  const n = (v: unknown) => (validCount(v) ? Math.floor(v) : 0);
  return { likes: n(post?.likes), reposts: n(post?.reposts), commentsCount: n(post?.commentsCount), quotesCount: n(post?.quotesCount) };
}
