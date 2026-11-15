// src/lib/analytics/markerExpiry.ts
// Prazo de vida do marcador individual de visualização e de clique no perfil.
//
// Por que existe: `posts/{id}/views/{uid}` e `posts/{id}/profileClicks/{uid}` guardam QUEM viu e QUEM clicou, pessoa
// por pessoa. O marcador serve para contar cada pessoa uma única vez — mas, guardado para sempre, virava um registro
// de quem leu o quê, o que numa rede política é informação sensível. Decisão do responsável em 2026-11-11: manter a
// contagem agregada (que é o que o autor do post vê) e apagar o marcador individual em 90 dias.
//
// Consequência que precisa estar dita ao titular: como o marcador morre, a contagem NÃO é de pessoas distintas para
// sempre. Repetições são evitadas apenas dentro da janela de 90 dias; depois dela a mesma pessoa pode ser contada
// outra vez. Por isso a interface e a política falam em "visualizações estimadas".
//
// Quem apaga é uma política de TTL do Firestore sobre o campo `expireAt` (ver firestore.indexes.json). O valor é
// calculado aqui, no cliente, porque `createdAt` usa `serverTimestamp()` e não dá para fazer aritmética com ele antes
// de o servidor resolvê-lo. A regra do Firestore confere o valor dentro de uma janela — ver `isExpiringMarker` em
// firestore.rules — para ninguém escolher por quanto tempo o próprio rastro fica guardado.
//
// Módulo puro de propósito: `npm run e2e:marcadores` importa isto e as regras, e reprova se os dois discordarem.

/** Dias que o marcador individual sobrevive antes de o TTL apagá-lo. */
export const MARKER_TTL_DAYS = 90;

/**
 * Folga, em dias, que a regra aceita para cima e para baixo. Existe só para tolerar diferença de relógio entre o
 * aparelho e o servidor: sem ela, alguns minutos de defasagem reprovariam a gravação.
 */
export const MARKER_TTL_SKEW_DAYS = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Quando o marcador criado agora deve expirar. */
export function markerExpiryMillis(nowMs: number = Date.now()): number {
  return nowMs + MARKER_TTL_DAYS * DAY_MS;
}

/** Os limites que a regra do Firestore impõe, em dias. Devem bater com `isExpiringMarker` em firestore.rules. */
export const MARKER_TTL_MIN_DAYS = MARKER_TTL_DAYS - MARKER_TTL_SKEW_DAYS;
export const MARKER_TTL_MAX_DAYS = MARKER_TTL_DAYS + MARKER_TTL_SKEW_DAYS;

/** O mesmo juízo que a regra faz, para o teste poder exercitá-lo sem emulador. */
export function markerExpiryIsAcceptable(expiryMs: number, serverNowMs: number): boolean {
  return (
    expiryMs > serverNowMs + MARKER_TTL_MIN_DAYS * DAY_MS &&
    expiryMs < serverNowMs + MARKER_TTL_MAX_DAYS * DAY_MS
  );
}

/* ─────────────── Migração dos marcadores antigos ───────────────
 *
 * Os marcadores gravados ANTES desta mudança só têm `createdAt`. Sem `expireAt`, a política de TTL não os enxerga e
 * eles ficam para sempre — ou seja, o problema que a mudança resolve continuaria valendo para todo o passado. E as
 * regras só permitem `create` nessas coleções, então o cliente não consegue consertar: precisa ser migração
 * administrativa.
 *
 * A decisão de cada documento mora aqui, em função pura, para o teste exercitar todos os casos sem tocar no banco.
 */

export type MarkerMigrationAction = 'ja-tem' | 'atualizar' | 'invalido';

export interface MarkerMigrationDecision {
  action: MarkerMigrationAction;
  /** Só em 'atualizar': o valor a gravar, em milissegundos. */
  expireAtMs?: number;
  /** Só em 'atualizar': o valor já está no passado, então o TTL apaga o documento na próxima varredura. */
  alreadyExpired?: boolean;
  /** Só em 'invalido': por quê. */
  reason?: string;
}

/**
 * O que fazer com um marcador antigo. Idempotente por construção: quem já tem `expireAt` é deixado em paz, então
 * rodar a migração de novo não grava nada.
 *
 * `createdAt` ausente ou de tipo errado NÃO é adivinhado — vira 'invalido' e é relatado. Chutar uma data aqui seria
 * inventar quando a pessoa viu o post, e errar para mais guardaria o rastro além do prazo.
 */
export function decideMarkerMigration(
  campos: { createdAtMs?: number | null; hasExpireAt: boolean },
  nowMs: number = Date.now(),
): MarkerMigrationDecision {
  if (campos.hasExpireAt) return { action: 'ja-tem' };

  const criadoEm = campos.createdAtMs;
  if (typeof criadoEm !== 'number' || !Number.isFinite(criadoEm) || criadoEm <= 0) {
    return { action: 'invalido', reason: 'sem createdAt utilizável' };
  }

  const expireAtMs = criadoEm + MARKER_TTL_DAYS * DAY_MS;
  return { action: 'atualizar', expireAtMs, alreadyExpired: expireAtMs <= nowMs };
}
