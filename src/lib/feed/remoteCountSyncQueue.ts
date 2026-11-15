// src/lib/feed/remoteCountSyncQueue.ts
// Fila, no navegador, dos posts remotos (`ap_*`) cujo contador precisa ser revalidado no servidor de origem. PURA: o envio, o
// relógio e os temporizadores entram por parâmetro (a ligação com `fetch` e `document` está em remoteCountSync.ts), e
// e2e/count-sync-check.mjs prova o comportamento com relógio e rede de mentira.
//
// O que ela garante, e por quê:
//  - UMA requisição para vários cartões (lote com espera curta): um feed com 40 posts do Fediverso não vira 40 requisições;
//  - o mesmo post não é pedido de novo dentro da validade (60 s por aba); a memória disso tem teto (abas ficam abertas dias);
//  - aba em segundo plano não pede nada (ninguém está vendo o número);
//  - se o servidor respondeu 429 (ou a rede falhou), a fila FICA QUIETA pelo prazo que ele pediu e os posts do lote voltam a
//    poder ser pedidos depois (antes ficavam "marcados como feitos" sem ter sido).
//
// (Sem "parameter properties" nem enums: o Node, ao rodar os testes, só remove tipos e não compila essa sintaxe.)

export type SyncSendResult = { ok: boolean; status: number; retryAfterSeconds?: number };

export type RemoteCountSyncDeps = {
  /** Envia um lote. Pode rejeitar (rede fora). */
  send(ids: string[]): Promise<SyncSendResult>;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** Aba em segundo plano? */
  isHidden?(): boolean;
};

export type RemoteCountSyncOptions = {
  /** Mesmo post: no mínimo isto entre dois pedidos (por aba). */
  cooldownMs?: number;
  batchSize?: number;
  /** Espera para juntar cartões que entram na tela quase juntos. */
  debounceMs?: number;
  /** Espera entre um lote e o seguinte quando há mais de um lote na fila. */
  chainMs?: number;
  /** Posts lembrados para o cooldown; acima disso saem os mais antigos. */
  maxTracked?: number;
  /** Quieta por tanto tempo depois de uma falha de rede. */
  failureBackoffMs?: number;
  /** Quieta por tanto tempo depois de um 429 sem `Retry-After`. */
  defaultRetryAfterMs?: number;
};

export type RemoteCountSyncQueue = {
  /** Põe o post na fila. `true` se entrou; `false` se foi ignorado (não é `ap_*`, aba escondida, em cooldown ou fila calada). */
  schedule(postId: string | null | undefined): boolean;
  /** Envia já o que está na fila (um lote). */
  flush(): void;
  readonly pending: number;
  readonly tracked: number;
  dispose(): void;
};

const ID_REMOTO = /^ap_[A-Za-z0-9_-]{6,64}$/;

export function createRemoteCountSyncQueue(deps: RemoteCountSyncDeps, options: RemoteCountSyncOptions = {}): RemoteCountSyncQueue {
  const cooldownMs = options.cooldownMs ?? 60_000;
  const batchSize = Math.max(1, options.batchSize ?? 15);
  const debounceMs = options.debounceMs ?? 200;
  const chainMs = options.chainMs ?? 250;
  const maxTracked = Math.max(1, options.maxTracked ?? 1000);
  const failureBackoffMs = options.failureBackoffMs ?? 15_000;
  const defaultRetryAfterMs = options.defaultRetryAfterMs ?? 30_000;

  const feitoEm = new Map<string, number>();
  const fila = new Set<string>();
  let timer: unknown = null;
  let caladoAte = 0;
  let encerrada = false;

  const armar = (ms: number) => {
    if (timer !== null || encerrada) return;
    timer = deps.setTimer(() => {
      timer = null;
      flush();
    }, ms);
  };

  const lembrar = (id: string, agora: number) => {
    feitoEm.delete(id);
    feitoEm.set(id, agora);
    while (feitoEm.size > maxTracked) {
      const maisAntigo = feitoEm.keys().next().value;
      if (maisAntigo === undefined) break;
      feitoEm.delete(maisAntigo);
    }
  };

  function flush(): void {
    if (encerrada || fila.size === 0) return;
    const agora = deps.now();
    // Calada (o servidor pediu calma) ou aba escondida: não manda agora, tenta quando o prazo passar.
    if (caladoAte > agora) {
      armar(caladoAte - agora);
      return;
    }
    if (deps.isHidden?.()) {
      // Ninguém está vendo: descarta, e esquece que "pediu", para que o post possa ser pedido quando a aba voltar.
      for (const id of fila) feitoEm.delete(id);
      fila.clear();
      return;
    }
    const lote = Array.from(fila).slice(0, batchSize);
    for (const id of lote) fila.delete(id);
    if (fila.size > 0) armar(chainMs);

    const desfazer = () => {
      // O pedido não chegou a valer: os posts podem ser pedidos de novo.
      for (const id of lote) feitoEm.delete(id);
    };
    deps.send(lote).then(
      (r) => {
        if (r.status === 429) {
          desfazer();
          caladoAte = deps.now() + (r.retryAfterSeconds && r.retryAfterSeconds > 0 ? r.retryAfterSeconds * 1000 : defaultRetryAfterMs);
        } else if (!r.ok && r.status >= 500) {
          desfazer();
          caladoAte = deps.now() + failureBackoffMs;
        }
      },
      () => {
        desfazer();
        caladoAte = deps.now() + failureBackoffMs;
      },
    );
  }

  return {
    schedule(postId) {
      if (encerrada || !postId || !ID_REMOTO.test(postId)) return false;
      if (deps.isHidden?.()) return false;
      const agora = deps.now();
      if (caladoAte > agora) return false;
      const ultimo = feitoEm.get(postId);
      if (ultimo !== undefined && agora - ultimo < cooldownMs) return false;
      lembrar(postId, agora);
      fila.add(postId);
      armar(debounceMs);
      return true;
    },
    flush,
    get pending() {
      return fila.size;
    },
    get tracked() {
      return feitoEm.size;
    },
    dispose() {
      encerrada = true;
      if (timer !== null) deps.clearTimer(timer);
      timer = null;
      fila.clear();
      feitoEm.clear();
    },
  };
}
