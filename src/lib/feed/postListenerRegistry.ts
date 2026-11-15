// src/lib/feed/postListenerRegistry.ts
// UM ouvinte do Firestore por post, compartilhado por todos os cartões que mostram esse post. PURO: quem assina (o Firestore) e o
// relógio entram por parâmetro; a suíte exercita tudo em Node.
//
// Por que existe: o cartão abria um `onSnapshot` próprio ao montar. Num feed com dezenas de cartões isso eram dezenas de
// ouvintes ao mesmo tempo, cada um já custando uma leitura só para repetir o que a consulta do feed acabou de trazer, mais uma
// leitura por mudança para cada ouvinte aberto; o mesmo post aparecendo em dois cartões (o original e o repost, a citação)
// abria dois. Aqui:
//  - o mesmo post tem um ouvinte só, não importa quantos cartões o observem;
//  - o último valor é entregue na hora ao cartão que chega depois (sem nova leitura);
//  - o ouvinte só fecha depois de uma folga sem observadores, para a rolagem de ida e volta não reabrir tudo;
//  - há um teto de ouvintes simultâneos: acima dele o cartão simplesmente fica com os números que já tem;
//  - um erro (post removido, sem permissão) encerra aquele ouvinte e não tenta de novo em laço.

export type PostSubscribe = (
  postId: string,
  onData: (data: Record<string, unknown>) => void,
  onError: (error: unknown) => void,
) => () => void;

export type RegistryOptions = {
  /** Quanto o ouvinte sobrevive sem observadores. */
  graceMs?: number;
  /** Teto de ouvintes abertos ao mesmo tempo. */
  maxListeners?: number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
};

type Entry = {
  listeners: Set<(data: Record<string, unknown>) => void>;
  unsubscribe: (() => void) | null;
  last: Record<string, unknown> | null;
  closeTimer: unknown;
  failed: boolean;
};

export function createPostListenerRegistry(subscribe: PostSubscribe, options: RegistryOptions = {}) {
  const graceMs = options.graceMs ?? 15_000;
  const maxListeners = options.maxListeners ?? 120;
  const setT = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = options.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const entries = new Map<string, Entry>();

  const close = (postId: string) => {
    const e = entries.get(postId);
    if (!e) return;
    if (e.closeTimer !== null) clearT(e.closeTimer);
    e.unsubscribe?.();
    entries.delete(postId);
  };

  /** Libera espaço fechando, já, ouvintes que estão só esperando a folga acabar. */
  const evictIdle = () => {
    for (const [id, e] of entries) {
      if (e.listeners.size === 0) {
        close(id);
        if (entries.size < maxListeners) return;
      }
    }
  };

  return {
    /** Passa a observar o post. Devolve o cancelamento (pode ser chamado mais de uma vez). */
    watch(postId: string, listener: (data: Record<string, unknown>) => void): () => void {
      let e = entries.get(postId);
      if (!e) {
        if (entries.size >= maxListeners) evictIdle();
        if (entries.size >= maxListeners) return () => {}; // sem espaço: o cartão fica com o que já tem
        e = { listeners: new Set(), unsubscribe: null, last: null, closeTimer: null, failed: false };
        entries.set(postId, e);
      }
      const entry = e;
      if (entry.closeTimer !== null) {
        clearT(entry.closeTimer);
        entry.closeTimer = null;
      }
      entry.listeners.add(listener);
      if (entry.last) listener(entry.last);
      if (!entry.unsubscribe && !entry.failed) {
        entry.unsubscribe = subscribe(
          postId,
          (data) => {
            entry.last = data;
            for (const l of [...entry.listeners]) l(data);
          },
          () => {
            // Sem permissão ou post removido: encerra este ouvinte e não insiste.
            entry.failed = true;
            entry.unsubscribe = null;
          },
        );
      }
      let cancelado = false;
      return () => {
        if (cancelado) return;
        cancelado = true;
        entry.listeners.delete(listener);
        if (entry.listeners.size === 0 && entry.closeTimer === null) {
          entry.closeTimer = setT(() => {
            entry.closeTimer = null;
            if (entry.listeners.size === 0) close(postId);
          }, graceMs);
        }
      };
    },
    /** Quantos posts têm ouvinte aberto (ou esperando a folga). */
    size: () => entries.size,
    /** Quantos têm algum cartão observando agora. */
    activeCount: () => [...entries.values()].filter((e) => e.listeners.size > 0).length,
    /** Fecha tudo (troca de conta, desmontar a aplicação). */
    closeAll: () => {
      for (const id of [...entries.keys()]) close(id);
    },
  };
}
