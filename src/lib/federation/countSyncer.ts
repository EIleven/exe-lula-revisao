// src/lib/federation/countSyncer.ts
// O orquestrador da revalidação de UM post remoto: decide, na ordem certa, se vale buscar o número na origem e o que fazer
// com a resposta. PURO: o documento, a rede, a gravação, o relógio e o registro entram por parâmetro (a ligação com o
// Firestore e com safeFetchText está em src/lib/server/remotePostInteractions.ts), e e2e/count-sync-check.mjs percorre todos
// os caminhos com tudo de mentira.
//
// A ordem importa e é o que impede esta rota de virar um canhão apontado para servidores alheios:
//   1. id estrito;   2. de molho na memória?   3. reserva já (duas chamadas ao mesmo tempo viram uma só);
//   4. o documento existe e já foi conferido há pouco (vale entre instâncias)?   5. tem servidor de origem?
//   6. vaga POR SERVIDOR (concorrência e ritmo; pausa se ele pediu calma);   7. só então endereço e busca;
//   8. a vaga é devolvida SEMPRE (finally), mesmo se a gravação falhar.
import {
  SYNC_ID_PATTERN,
  SYNC_NEGATIVE_MS,
  SYNC_RETRY_MS,
  SYNC_TTL_MS,
  isFresh,
  retryAfterMs,
  type DomainGate,
  type SyncMemo,
} from './countSyncPolicy.ts';

export type CountSyncOutcome = 'updated' | 'unchanged' | 'fresh' | 'throttled' | 'unavailable' | 'missing' | 'invalid';

export type StatusLocation = { domain: string; statusId: string };

/** O que a origem informou (campo ausente ou inválido = não informou; a regra de counterPolicy.ts decide o resto). */
export type OriginCounts = { likes?: unknown; reposts?: unknown; commentsCount?: unknown };

export type FetchedStatus =
  | { kind: 'ok'; origin: OriginCounts }
  /** 429/503: o servidor pediu calma. `retryAfter` é o cabeçalho cru. */
  | { kind: 'rate-limited'; status: number; retryAfter?: unknown }
  /** 401/403/404/410: saiu de lá ou só responde a quem está autorizado. */
  | { kind: 'gone'; status: number }
  /** Rede, tempo esgotado, 5xx, corpo ilegível. */
  | { kind: 'error'; status?: number };

export type CountSyncDeps<P> = {
  now(): number;
  /** O post como está gravado, ou `null` se não existe. */
  readPost(id: string): Promise<P | null>;
  /** Servidor de origem lido do próprio post (sem rede), ou `null`. */
  hostOf(post: P): string | null;
  /** Instante da última leitura na origem, gravado no post (`remoteCountsAtMs`). */
  checkedAtMsOf(post: P): unknown;
  /** Endereço do status na origem (pode usar a rede). */
  locate(post: P): Promise<StatusLocation | null>;
  fetchStatus(location: StatusLocation): Promise<FetchedStatus>;
  /** Grava pela regra de counterPolicy.ts, em transação. */
  apply(postId: string, origin: OriginCounts, fetchedAtMs: number): Promise<'updated' | 'unchanged' | 'missing'>;
  gate: DomainGate;
  memo: SyncMemo;
  warn(message: string): void;
};

export function createCountSyncer<P>(deps: CountSyncDeps<P>): (postId: string, now?: number) => Promise<CountSyncOutcome> {
  const { gate, memo } = deps;

  async function syncOne(postId: string, now: number): Promise<CountSyncOutcome> {
    const post = await deps.readPost(postId);
    if (!post) {
      memo.mark(postId, now, SYNC_NEGATIVE_MS);
      return 'missing';
    }
    // Conferido há pouco, por outra instância ou por outro caminho (o documento é a memória que as une).
    if (isFresh(deps.checkedAtMsOf(post), now)) {
      memo.mark(postId, now, SYNC_TTL_MS);
      return 'fresh';
    }
    const host = deps.hostOf(post);
    if (!host) {
      memo.mark(postId, now, SYNC_NEGATIVE_MS);
      return 'unavailable';
    }

    // A vaga vale para TODA a conversa com o servidor (resolver o endereço do post e buscar o status).
    const release = gate.enter(host, now);
    if (!release) {
      memo.forget(postId); // a busca não aconteceu: o post pode tentar de novo quando houver vaga
      return 'throttled';
    }
    try {
      const location = await deps.locate(post);
      if (!location) {
        memo.mark(postId, now, SYNC_NEGATIVE_MS);
        return 'unavailable';
      }
      const res = await deps.fetchStatus(location);
      if (res.kind === 'rate-limited') {
        const agora = deps.now();
        const esperaMs = retryAfterMs(res.retryAfter, agora);
        gate.cooldown(host, agora + esperaMs);
        deps.warn(`[ap-sync-counts] ${host} pediu calma (HTTP ${res.status}): sem buscas a ele por ${Math.round(esperaMs / 1000)} s`);
        memo.mark(postId, now, SYNC_RETRY_MS);
        return 'throttled';
      }
      if (res.kind === 'gone') {
        memo.mark(postId, now, SYNC_NEGATIVE_MS);
        return 'unavailable';
      }
      if (res.kind === 'error') {
        memo.mark(postId, now, SYNC_RETRY_MS);
        return 'unavailable';
      }
      const lidoEm = deps.now();
      const applied = await deps.apply(postId, res.origin, lidoEm);
      memo.mark(postId, lidoEm, SYNC_TTL_MS);
      return applied;
    } finally {
      release();
    }
  }

  return async function sync(postId: string, now: number = deps.now()): Promise<CountSyncOutcome> {
    if (typeof postId !== 'string' || !SYNC_ID_PATTERN.test(postId)) return 'invalid';
    if (memo.seen(postId, now)) return 'fresh';
    // Reserva já, antes de qualquer espera: duas chamadas ao mesmo tempo (duas abas, dois cartões) viram uma busca só.
    memo.mark(postId, now, SYNC_RETRY_MS);
    try {
      return await syncOne(postId, now);
    } catch (error) {
      deps.warn(`[ap-sync-counts] falha ao revalidar ${postId}: ${error instanceof Error ? error.message : String(error)}`);
      memo.mark(postId, now, SYNC_RETRY_MS);
      return 'unavailable';
    }
  };
}
