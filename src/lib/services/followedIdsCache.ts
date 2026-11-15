// src/lib/services/followedIdsCache.ts
// Cache curto da lista de quem a pessoa segue. Sem ele, cada página do feed "Seguindo" (até três consultas por chamada) e cada
// reinício do aviso de "novos posts" liam a subcoleção `following` INTEIRA: 1.299 leituras para quem segue 1.299 contas, várias
// vezes por minuto. Aqui ela é lida uma vez e reaproveitada por 60 s; seguir ou deixar de seguir invalida na hora
// (`dispatchFollowState`), e o prazo curto cobre mudanças feitas em outro aparelho.
//
// Garantias: chamadas simultâneas dividem a MESMA leitura; uma leitura que falha NUNCA é guardada (um feed que falhou não pode
// ficar mudo por um minuto); e uma leitura que estava em andamento quando a pessoa seguiu alguém não grava o resultado velho.
//
// Sem imports: a suíte exercita a lógica sem Firebase.

const TTL_MS = 60_000;

type Entrada = { ids: string[]; em: number };
const cache = new Map<string, Entrada>();
const emVoo = new Map<string, Promise<string[]>>();
const versoes = new Map<string, number>();
let epoca = 0;
const versaoDe = (userId: string) => `${epoca}:${versoes.get(userId) ?? 0}`;

export async function followedIdsCached(userId: string, carregar: () => Promise<string[]>, agora: () => number = Date.now): Promise<string[]> {
  const guardado = cache.get(userId);
  if (guardado && agora() - guardado.em < TTL_MS) return [...guardado.ids];
  const pendente = emVoo.get(userId);
  if (pendente) return [...(await pendente)];

  const versao = versaoDe(userId);
  const leitura: Promise<string[]> = carregar()
    .then((ids) => {
      // Se alguém seguiu ou deixou de seguir enquanto líamos, este resultado já nasceu velho: devolve, mas não guarda.
      if (versaoDe(userId) === versao) cache.set(userId, { ids, em: agora() });
      return ids;
    })
    .finally(() => {
      if (emVoo.get(userId) === leitura) emVoo.delete(userId);
    });
  emVoo.set(userId, leitura);
  return [...(await leitura)];
}

/** Esquece a lista de uma pessoa (ou de todas, sem argumento): chamado quando ela segue ou deixa de seguir alguém. */
export function invalidateFollowedIds(userId?: string | null): void {
  if (userId) {
    cache.delete(userId);
    emVoo.delete(userId);
    versoes.set(userId, (versoes.get(userId) ?? 0) + 1);
  } else {
    cache.clear();
    emVoo.clear();
    epoca++;
  }
}
