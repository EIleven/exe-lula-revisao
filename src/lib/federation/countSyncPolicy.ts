// src/lib/federation/countSyncPolicy.ts
// Regras PURAS da revalidação, em segundo plano, dos contadores de posts remotos (`ap_*`). Sem Firebase, sem Next e sem
// relógio próprio (o "agora" entra por parâmetro): é o que a rota /api/ap/sync-counts e o servidor usam, e o que
// e2e/count-sync-check.mjs prova.
//
// Por que existe: a primeira versão da rota era aberta e sem freio, e cada chamada podia disparar até 15 buscas
// simultâneas a servidores ALHEIOS, de graça, para qualquer pessoa da internet (amplificação: nosso servidor, nosso IP e a
// nossa reputação como robô). Aqui ficam os freios:
//   - ids estritos e em número limitado (parseSyncIds);
//   - validade por post, em memória e no próprio documento (isFresh, createSyncMemo);
//   - freio POR SERVIDOR REMOTO: concorrência, ritmo por minuto e pausa quando ele pede calma (createDomainGate);
//   - concorrência limitada dentro de uma requisição (mapWithLimit).
//
// HONESTIDADE: tudo é por INSTÂNCIA do servidor (o App Hosting tem até 10), como o limitador de rateLimit.ts. O teto real é
// `limite × instâncias`; a validade gravada no documento (`remoteCountsAtMs`) é o que une as instâncias.
//
// (Sem "parameter properties" nem enums: o Node, ao rodar os testes, só remove tipos e não compila essa sintaxe.)

/** Ids por requisição. O cliente junta os cartões que entram na tela e manda de uma vez. */
export const SYNC_BATCH_MAX = 15;

/**
 * Post remoto materializado: `ap_` + 24 hex. O padrão é mais largo de propósito (não deixar de fora um id antigo), mas
 * fechado em alfabeto e tamanho: o id vira caminho de documento e chave de memória.
 */
export const SYNC_ID_PATTERN = /^ap_[A-Za-z0-9_-]{6,64}$/;

/** Sucesso: o post vale por 3 min, para qualquer pessoa e em qualquer aba. */
export const SYNC_TTL_MS = 3 * 60_000;
/** Falha passageira (rede, 5xx, 429): espera 1 min. */
export const SYNC_RETRY_MS = 60_000;
/** O post saiu de lá, o servidor não deixa ler ou não há endereço: não adianta insistir (30 min). */
export const SYNC_NEGATIVE_MS = 30 * 60_000;

/** Ids válidos, únicos e na ordem de chegada; o que não parece id de post remoto é descartado em silêncio. */
export function parseSyncIds(raw: unknown, max: number = SYNC_BATCH_MAX): string[] {
  if (!Array.isArray(raw)) return [];
  const vistos = new Set<string>();
  const ids: string[] = [];
  // Percorre só o começo: o corpo já é limitado, mas a rotina não deve depender disso para ser barata.
  for (const item of raw.slice(0, Math.max(1, max) * 4)) {
    if (typeof item !== 'string' || !SYNC_ID_PATTERN.test(item) || vistos.has(item)) continue;
    vistos.add(item);
    ids.push(item);
    if (ids.length >= max) break;
  }
  return ids;
}

/**
 * `lastMs` (instante da última leitura na origem) ainda vale? Um instante no FUTURO (relógio errado, dado corrompido) não
 * vale: senão um carimbo adiantado congelaria a revalidação do post para sempre. Tolera 1 min de diferença de relógio.
 */
export function isFresh(lastMs: unknown, now: number, ttlMs: number = SYNC_TTL_MS): boolean {
  if (typeof lastMs !== 'number' || !Number.isFinite(lastMs)) return false;
  if (lastMs > now + 60_000) return false;
  return now - lastMs < ttlMs;
}

const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 15 * 60_000;
const RETRY_DEFAULT_MS = 60_000;

/**
 * Quanto esperar quando um servidor remoto responde 429/503: o `Retry-After` (segundos ou data HTTP), limitado a
 * [5 s, 15 min] — um valor absurdo (ou malicioso) não pode nos calar por horas — e 60 s sem cabeçalho legível.
 */
export function retryAfterMs(header: unknown, now: number): number {
  const valor = Array.isArray(header) ? header[0] : header;
  if (typeof valor !== 'string' || !valor.trim()) return RETRY_DEFAULT_MS;
  const texto = valor.trim();
  let ms: number;
  if (/^\d{1,9}$/.test(texto)) {
    ms = Number(texto) * 1000;
  } else {
    const data = Date.parse(texto);
    if (!Number.isFinite(data)) return RETRY_DEFAULT_MS;
    ms = data - now;
  }
  return Math.min(RETRY_MAX_MS, Math.max(RETRY_MIN_MS, ms));
}

// ───────────────────────── memória de quem já foi revalidado ─────────────────────────

export type SyncMemo = {
  /** Este post está "de molho" (revalidado há pouco, em andamento, ou com falha que ainda não vale repetir)? */
  seen(id: string, now: number): boolean;
  /** Deixa o post de molho por `ttlMs`. Chamar de novo troca o prazo. */
  mark(id: string, now: number, ttlMs: number): void;
  /** Tira o post de molho (a busca não chegou a acontecer). */
  forget(id: string): void;
  readonly size: number;
};

/** Memória limitada: acima de `maxEntries`, saem primeiro os já vencidos e depois os mais antigos. */
export function createSyncMemo(maxEntries: number = 2000): SyncMemo {
  const ate = new Map<string, number>();
  return {
    seen(id, now) {
      const prazo = ate.get(id);
      if (prazo === undefined) return false;
      if (prazo > now) return true;
      ate.delete(id);
      return false;
    },
    mark(id, now, ttlMs) {
      ate.delete(id); // reinsere no fim: a ordem do Map é a ordem de "mais antigo primeiro"
      ate.set(id, now + ttlMs);
      if (ate.size <= maxEntries) return;
      for (const [chave, prazo] of ate) if (prazo <= now) ate.delete(chave);
      for (const chave of ate.keys()) {
        if (ate.size <= maxEntries) break;
        ate.delete(chave);
      }
    },
    forget(id) {
      ate.delete(id);
    },
    get size() {
      return ate.size;
    },
  };
}

// ───────────────────────── freio por servidor remoto ─────────────────────────

export type DomainGateOptions = {
  /** Buscas ao mesmo tempo ao mesmo servidor (por instância). */
  maxConcurrent?: number;
  /** Buscas por janela ao mesmo servidor (por instância). */
  perWindow?: number;
  windowMs?: number;
  /** Servidores rastreados na memória; acima disso saem os ociosos e depois os mais antigos. */
  maxDomains?: number;
};

export type DomainGate = {
  /** Pede uma vaga para falar com `domain`. Devolve a função que a libera (idempotente), ou `null` se não há vaga. */
  enter(domain: string, now: number): (() => void) | null;
  /** O servidor pediu calma (429/503): nenhuma busca a ele até `untilMs`. Só prolonga, nunca encurta. */
  cooldown(domain: string, untilMs: number): void;
  inspect(domain: string, now: number): { inflight: number; inWindow: number; coolingUntilMs: number };
  readonly tracked: number;
};

type DomainState = { inflight: number; stamps: number[]; coolUntil: number };

export function createDomainGate(options: DomainGateOptions = {}): DomainGate {
  const maxConcurrent = Math.max(1, options.maxConcurrent ?? 2);
  const perWindow = Math.max(1, options.perWindow ?? 20);
  const windowMs = options.windowMs ?? 60_000;
  const maxDomains = Math.max(1, options.maxDomains ?? 500);
  const estados = new Map<string, DomainState>();

  const chaveDe = (domain: string) => domain.trim().toLowerCase();
  const estadoDe = (chave: string): DomainState => {
    let e = estados.get(chave);
    if (!e) {
      e = { inflight: 0, stamps: [], coolUntil: 0 };
      estados.set(chave, e);
    }
    return e;
  };
  const podar = (now: number) => {
    if (estados.size <= maxDomains) return;
    for (const [chave, e] of estados) {
      const ocioso = e.inflight === 0 && e.coolUntil <= now && !e.stamps.some((t) => now - t < windowMs);
      if (ocioso) estados.delete(chave);
    }
    // Ainda acima do teto (todos ativos): sai o mais antigo que não tem busca em andamento.
    for (const [chave, e] of estados) {
      if (estados.size <= maxDomains) break;
      if (e.inflight === 0) estados.delete(chave);
    }
  };

  return {
    enter(domain, now) {
      const chave = chaveDe(domain);
      if (!chave) return null;
      const e = estadoDe(chave);
      e.stamps = e.stamps.filter((t) => now - t < windowMs);
      if (e.coolUntil > now) return null;
      if (e.inflight >= maxConcurrent) return null;
      if (e.stamps.length >= perWindow) return null;
      e.stamps.push(now);
      e.inflight++;
      podar(now);
      let liberada = false;
      return () => {
        if (liberada) return;
        liberada = true;
        e.inflight = Math.max(0, e.inflight - 1);
      };
    },
    cooldown(domain, untilMs) {
      const chave = chaveDe(domain);
      if (!chave) return;
      const e = estadoDe(chave);
      e.coolUntil = Math.max(e.coolUntil, untilMs);
    },
    inspect(domain, now) {
      const e = estados.get(chaveDe(domain));
      if (!e) return { inflight: 0, inWindow: 0, coolingUntilMs: 0 };
      return { inflight: e.inflight, inWindow: e.stamps.filter((t) => now - t < windowMs).length, coolingUntilMs: e.coolUntil };
    },
    get tracked() {
      return estados.size;
    },
  };
}

// ───────────────────────── concorrência limitada ─────────────────────────

/**
 * `Promise.all` com no máximo `limit` em andamento, resultados NA ORDEM de `items`. `fn` não deve lançar (aqui ela devolve um
 * resultado e trata o próprio erro); se lançar, a rejeição sobe e o resto das tarefas em andamento termina sozinho.
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const resultados = new Array<R>(items.length);
  let proximo = 0;
  const trabalhador = async () => {
    for (;;) {
      const i = proximo++;
      if (i >= items.length) return;
      resultados[i] = await fn(items[i], i);
    }
  };
  const quantos = Math.min(Math.max(1, Math.floor(limit) || 1), items.length);
  await Promise.all(Array.from({ length: quantos }, trabalhador));
  return resultados;
}
