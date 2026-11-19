// src/lib/hiperchat/badges.ts
// Os números da navegação do HiperChat: quantos grupos têm mensagem nova e quantas conversas estão fixadas.
//
// Quem sabe isso é a LISTA de conversas (ela já ouve o Firestore). Quem precisa mostrar é a barra de navegação, que está
// acima dela na árvore. Em vez de abrir um segundo ouvinte do Firestore só para contar — duas leituras pela mesma coisa —
// a lista deposita os números aqui e a navegação os lê.
//
// O último número continua valendo quando a lista sai da tela (ir para Configurações não zera os grupos). Nada é gravado:
// viveu nesta aba e morre com ela.

export type ChatBadges = {
  /** Grupos com pelo menos uma mensagem não lida. */
  grupos: number;
  /** Quantas conversas a pessoa fixou (as que ainda existem). */
  fixadas: number;
};

const VAZIO: ChatBadges = { grupos: 0, fixadas: 0 };

const saudavel = (valor: unknown): number =>
  typeof valor === 'number' && Number.isFinite(valor) && valor > 0 ? Math.min(999, Math.floor(valor)) : 0;

export function createBadgeStore() {
  let atual: ChatBadges = VAZIO;
  const ouvintes = new Set<() => void>();

  return {
    /** Mesma referência enquanto nada muda: `useSyncExternalStore` compara por identidade e não re-renderiza em vão. */
    get(): ChatBadges {
      return atual;
    },
    publish(proximo: Partial<ChatBadges>): void {
      const grupos = saudavel(proximo.grupos ?? atual.grupos);
      const fixadas = saudavel(proximo.fixadas ?? atual.fixadas);
      if (grupos === atual.grupos && fixadas === atual.fixadas) return;
      atual = { grupos, fixadas };
      for (const avisar of ouvintes) avisar();
    },
    subscribe(ouvinte: () => void): () => void {
      ouvintes.add(ouvinte);
      return () => {
        ouvintes.delete(ouvinte);
      };
    },
    reset(): void {
      if (atual === VAZIO) return;
      atual = VAZIO;
      for (const avisar of ouvintes) avisar();
    },
  };
}

export const chatBadges = createBadgeStore();

/** Conta os grupos com mensagem não lida para esta pessoa. */
export function contarGruposNaoLidos(
  conversas: readonly { isGroup?: boolean; participantIds?: readonly string[]; unreadCounts?: Record<string, number> | null }[] | null | undefined,
  uid: string | null | undefined,
): number {
  if (!Array.isArray(conversas) || !uid) return 0;
  let total = 0;
  for (const c of conversas) {
    const ehGrupo = c?.isGroup === true || (Array.isArray(c?.participantIds) && c.participantIds.length > 2);
    if (!ehGrupo) continue;
    if ((c?.unreadCounts?.[uid] ?? 0) > 0) total += 1;
  }
  return total;
}
