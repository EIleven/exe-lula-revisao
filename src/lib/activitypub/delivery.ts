// src/lib/activitypub/delivery.ts
// Regras da fila de entrega: quando tentar de novo, quando desistir, o que é idempotente. Módulo puro, sem imports
// além de `node:crypto`.
//
// A fila existe por uma razão (ADR-AP-4): publicar NUNCA pode depender de um servidor remoto lento ou fora do ar.
// A pessoa publica, o post já está pronto localmente, e a federação é assíncrona. O que sai desta fila precisa ser
// previsível: nem martelar um servidor que já disse não, nem desistir de um que só estava fora do ar.
import { createHash } from 'node:crypto';

/** 8 tentativas no total: a primeira imediata mais 7 reentregas. */
export const MAX_ATTEMPTS = 8;

/**
 * Espera depois da falha de número N (1-based), em segundos. Soma = 131 160 s ≈ 1,5 dia: cobre uma queda longa sem
 * insistir por semanas num destino que sumiu.
 */
export const RETRY_DELAYS_SECONDS = [60, 300, 1_200, 3_600, 10_800, 28_800, 86_400] as const;

const UM_DIA_MS = 86_400_000;
const JITTER = 0.15;

export type Outcome =
  /** 2xx: entregue. */
  | 'sent'
  /** Falha que pode passar: tenta de novo, com espera. */
  | 'retry'
  /** O destino recusou de um jeito que repetir não muda (400, 404, 405, 422…). Não repete. */
  | 'permanent'
  /** 410: o destino diz que isso não existe mais. O inbox deve ser desativado. */
  | 'gone'
  /** Destino proibido pela guarda de SSRF. Não repete e é registrado como tal. */
  | 'unsafe';

export type DeliveryResult = {
  outcome: Outcome;
  /** Para o painel: o que o destino disse, sem o corpo. */
  detail: string;
  /** Espera mínima pedida pelo destino (`Retry-After`), em segundos. */
  retryAfterSeconds: number | null;
  /** Tentativas máximas para ESTE tipo de falha (algumas valem menos). */
  maxAttempts: number;
};

/** Lê `Retry-After`: segundos ou data HTTP. Devolve segundos, limitado a um dia, ou `null`. */
export function parseRetryAfter(valor: string | string[] | undefined | null, agora: number): number | null {
  const bruto = Array.isArray(valor) ? valor[0] : valor;
  if (typeof bruto !== 'string' || !bruto.trim()) return null;
  const texto = bruto.trim();
  let segundos: number;
  if (/^\d+$/.test(texto)) {
    segundos = Number(texto);
  } else {
    const data = Date.parse(texto);
    if (!Number.isFinite(data)) return null;
    segundos = Math.ceil((data - agora) / 1000);
  }
  if (!Number.isFinite(segundos) || segundos <= 0) return null;
  return Math.min(segundos, UM_DIA_MS / 1000);
}

/**
 * Classifica a resposta de uma entrega.
 *
 * - 2xx → entregue.
 * - 408, 425, 429 e 5xx → passageiro. 429 respeita `Retry-After`.
 * - 401/403 → ambíguo: pode ser o destino sem conseguir buscar a NOSSA chave (passageiro) ou um bloqueio nosso
 *   (permanente). Tenta algumas vezes e desiste cedo, em vez de insistir oito vezes num bloqueio.
 * - 410 → o inbox sumiu.
 * - outros 4xx → permanente.
 * - 3xx → permanente: não seguimos redirecionamento de POST assinado.
 * - erro de rede (DNS, TLS, tempo esgotado) → passageiro.
 */
export function classifyDelivery(
  entrada: { status: number | null; unsafe?: boolean; errorDetail?: string; retryAfter?: string | string[] | undefined },
  agora: number,
): DeliveryResult {
  const retryAfterSeconds = parseRetryAfter(entrada.retryAfter, agora);
  if (entrada.unsafe) {
    return { outcome: 'unsafe', detail: 'destino recusado pela guarda de rede', retryAfterSeconds: null, maxAttempts: 1 };
  }
  const s = entrada.status;
  if (s === null) {
    return {
      outcome: 'retry',
      detail: entrada.errorDetail ?? 'sem resposta',
      retryAfterSeconds: null,
      maxAttempts: MAX_ATTEMPTS,
    };
  }
  if (s >= 200 && s < 300) return { outcome: 'sent', detail: `HTTP ${s}`, retryAfterSeconds: null, maxAttempts: MAX_ATTEMPTS };
  if (s === 410) return { outcome: 'gone', detail: 'HTTP 410', retryAfterSeconds: null, maxAttempts: 1 };
  if (s === 401 || s === 403) return { outcome: 'retry', detail: `HTTP ${s}`, retryAfterSeconds, maxAttempts: 3 };
  if (s === 408 || s === 425 || s === 429 || s >= 500) {
    return { outcome: 'retry', detail: `HTTP ${s}`, retryAfterSeconds, maxAttempts: MAX_ATTEMPTS };
  }
  return { outcome: 'permanent', detail: `HTTP ${s}`, retryAfterSeconds: null, maxAttempts: 1 };
}

/**
 * O que uma falha de entrega SIGNIFICA para quem opera. Existe para o registro e os contadores (`entrega.falha.<classe>`):
 * "HTTP 401" e "HTTP 503" pedem providências opostas, e antes ficavam todos num "reagendada" sem dizer qual era qual.
 *
 * - `assinatura`: 401. O servidor não validou a assinatura (não achou a nossa chave, `Digest` ou `Date` fora do aceito...).
 *   É o sinal de um problema NOSSO (chave, relógio, ator fora do ar) quando aparece em vários domínios ao mesmo tempo.
 * - `bloqueio`: 403. O servidor nos conhece e recusou: instância ou conta bloqueada/silenciada, ou só aceita quem ele autoriza.
 * - `rede`: sem resposta (DNS, TLS, tempo esgotado). `limite`: 408/425/429. `servidor`: 5xx.
 * - `recusada`: outro 4xx permanente (a atividade foi entendida e rejeitada). `removida`: 410. `insegura`: a guarda de rede.
 */
export type FailureClass = 'assinatura' | 'bloqueio' | 'rede' | 'limite' | 'servidor' | 'recusada' | 'removida' | 'insegura';

export function failureClassOf(status: number | null, outcome: Outcome): FailureClass {
  if (outcome === 'unsafe') return 'insegura';
  if (status === null) return 'rede';
  if (status === 401) return 'assinatura';
  if (status === 403) return 'bloqueio';
  if (status === 410) return 'removida';
  if (status === 408 || status === 425 || status === 429) return 'limite';
  if (status >= 500) return 'servidor';
  return 'recusada';
}

export type NextStep =
  | { kind: 'retry'; at: number; delaySeconds: number }
  | { kind: 'dead'; reason: 'tentativas-esgotadas' | 'recusado-permanentemente' };

/**
 * O que fazer depois de uma tentativa que NÃO entregou. `attemptsSoFar` já conta a que acabou de falhar.
 * `random` é injetável para o teste ser determinístico (devolve [0,1)).
 */
export function nextStep(
  resultado: DeliveryResult,
  attemptsSoFar: number,
  agora: number,
  random: () => number = Math.random,
): NextStep {
  if (resultado.outcome === 'permanent' || resultado.outcome === 'gone' || resultado.outcome === 'unsafe') {
    return { kind: 'dead', reason: 'recusado-permanentemente' };
  }
  if (attemptsSoFar >= Math.min(resultado.maxAttempts, MAX_ATTEMPTS)) {
    return { kind: 'dead', reason: 'tentativas-esgotadas' };
  }
  const base = RETRY_DELAYS_SECONDS[Math.min(attemptsSoFar, RETRY_DELAYS_SECONDS.length) - 1] ?? 86_400;
  // Jitter simétrico: evita que centenas de entregas falhas voltem juntas no mesmo segundo.
  const comJitter = base * (1 + (random() * 2 - 1) * JITTER);
  // O destino pode pedir mais tempo; nunca menos que isso.
  const espera = Math.max(comJitter, resultado.retryAfterSeconds ?? 0);
  const delaySeconds = Math.round(Math.min(espera, UM_DIA_MS / 1000));
  return { kind: 'retry', at: agora + delaySeconds * 1000, delaySeconds };
}

/**
 * Id determinístico de uma entrega. Mesmo (operação, objeto, destino) → mesmo id, então enfileirar duas vezes —
 * retomada depois de falha, gatilho disparado em duplicidade — não entrega duas vezes. `uid` entra porque o mesmo
 * inbox compartilhado serve pessoas diferentes.
 */
export function deliveryId(parts: { uid: string; op: string; objectId: string; targetInbox: string }): string {
  return createHash('sha256')
    .update([parts.uid, parts.op, parts.objectId, parts.targetInbox].join('\n'))
    .digest('hex');
}

export type FollowerTarget = { inbox: string; sharedInbox?: string | null; domain: string };
export type Target = { inbox: string; domain: string; followers: number };

/**
 * Agrupa seguidores por destino: um POST para o inbox COMPARTILHADO serve todos os seguidores daquele servidor.
 * Mil seguidores em `mastodon.social` viram uma entrega, não mil.
 */
export function groupTargets(seguidores: readonly FollowerTarget[]): Target[] {
  const mapa = new Map<string, Target>();
  for (const s of seguidores) {
    const destino = s.sharedInbox || s.inbox;
    const atual = mapa.get(destino);
    if (atual) atual.followers++;
    else mapa.set(destino, { inbox: destino, domain: s.domain, followers: 1 });
  }
  return [...mapa.values()];
}

// ───────────────────────── Saúde por domínio ─────────────────────────

/**
 * Disjuntor por domínio. Depois de falhas SEGUIDAS em um domínio, as demais entregas para ele esperam em vez de
 * cada uma gastar suas tentativas contra um servidor que está fora do ar. Zera no primeiro sucesso.
 */
export function domainCooldownSeconds(consecutiveFailures: number): number {
  if (consecutiveFailures < 3) return 0;
  const passos = Math.min(consecutiveFailures - 2, 8);
  return Math.min(60 * 2 ** (passos - 1), 6 * 3600);
}
