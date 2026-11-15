// src/lib/server/remoteCounts.ts
// Grava os contadores de um post remoto (`ap_*`) aplicando a regra de counterPolicy.ts, SEM perder a escrita de ninguém.
//
// Por que existe: três pontos gravavam contador direto no documento do post (a sincronização de perfil, o `/statuses/{id}` do
// servidor de origem e a lista de quem reagiu), todos como "lê um número, calcula, grava". Entre a leitura e a escrita a
// Function que soma uma curtida DAQUI pode ter atualizado o mesmo campo, e a escrita por cima desfazia essa soma (escrita
// perdida). Aqui o cálculo roda dentro de uma transação, que o Firestore refaz se o documento mudou no meio do caminho.
//
// O PISO (nunca mostrar menos gente do que sabemos que reagiu) vem da contagem dos marcadores guardados (`likes`, `reposts`
// e `comments` do post). Só se consulta quando a origem faria o contador DESCER: no caso comum (subir ou ficar igual) não custa
// leitura extra.
import { COUNT_FIELDS, reconcileRemoteCount, type CountDecision, type CountField } from '@/lib/federation/counterPolicy';
import { adminFirestore } from '@/lib/server/firebaseAdmin';

export type RemoteCountsInput = {
  /** O que a origem informou nesta busca. Campo ausente = a origem não informou. */
  origin?: Partial<Record<CountField, unknown>>;
  /** Pisos que já temos (ex.: quantas pessoas a lista de quem reagiu trouxe). Só faz o número SUBIR. */
  lowerBound?: Partial<Record<CountField, number>>;
  /** Campos cuja lista de quem reagiu foi enumerada por completo e veio vazia (é o que confirma uma queda a zero). */
  confirmedZero?: Partial<Record<CountField, boolean>>;
  fetchedAtMs?: number;
};

const SUBCOLLECTION: Record<CountField, string> = { likes: 'likes', reposts: 'reposts', commentsCount: 'comments' };

/** Devolve a decisão por campo (para log e teste), ou `null` se o post não existe. */
export async function applyRemoteCounts(
  postId: string,
  input: RemoteCountsInput,
): Promise<Partial<Record<CountField, CountDecision>> | null> {
  const db = adminFirestore();
  const ref = db.collection('posts').doc(postId);
  const fetchedAtMs = input.fetchedAtMs ?? Date.now();

  const pre = await ref.get();
  if (!pre.exists) return null;
  const preData = pre.data() as Record<string, unknown>;

  // Piso: só nos campos em que a origem desceria o contador.
  const pisos: Partial<Record<CountField, number>> = {};
  const semPiso = new Set<CountField>();
  await Promise.all(
    COUNT_FIELDS.map(async (campo) => {
      const origem = input.origin?.[campo];
      if (typeof origem !== 'number' || !(origem < Number(preData[campo] ?? 0))) return;
      try {
        pisos[campo] = (await ref.collection(SUBCOLLECTION[campo]).count().get()).data().count;
      } catch {
        // Sem saber o piso não se desce: o campo fica como está nesta rodada (a próxima busca tenta de novo).
        semPiso.add(campo);
      }
    }),
  );

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const d = snap.data() as Record<string, unknown>;
    const storedAt = typeof d.remoteCountsAtMs === 'number' ? d.remoteCountsAtMs : null;
    const patch: Record<string, unknown> = {};
    const decisoes: Partial<Record<CountField, CountDecision>> = {};
    for (const campo of COUNT_FIELDS) {
      const origin = input.origin?.[campo];
      const limite = input.lowerBound?.[campo];
      if (origin === undefined && limite === undefined) continue;
      if (semPiso.has(campo)) continue;
      const decisao = reconcileRemoteCount({
        stored: Number(d[campo] ?? 0),
        origin,
        floor: Math.max(pisos[campo] ?? 0, limite ?? 0),
        confirmedZero: input.confirmedZero?.[campo] === true,
        fetchedAtMs,
        storedFetchedAtMs: storedAt,
      });
      decisoes[campo] = decisao;
      if (decisao.action !== 'keep') patch[campo] = decisao.value;
    }
    if (Object.keys(patch).length > 0) {
      // A hora da leitura só avança quando a origem de fato mexeu em algum número (cada escrita no post aciona Functions).
      if (Object.values(input.origin ?? {}).some((v) => typeof v === 'number')) patch.remoteCountsAtMs = fetchedAtMs;
      tx.update(ref, patch);
    }
    return decisoes;
  });
}

/**
 * Contadores de um COMENTÁRIO remoto: só sobem (a lista de quem reagiu traz, no máximo, a primeira página; é um piso, nunca
 * o total). Escreve no comentário e, desta vez, NÃO no post: o código anterior gravava aqui o tamanho da lista de reagentes
 * do comentário no contador do POST pai, o que inflava as curtidas e os reposts do post.
 */
export async function raiseRemoteCommentCount(
  postId: string,
  commentId: string,
  field: 'likes' | 'repostsCount',
  floor: number,
): Promise<boolean> {
  if (!Number.isFinite(floor) || floor <= 0) return false;
  const db = adminFirestore();
  const ref = db.collection('posts').doc(postId).collection('comments').doc(commentId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const atual = Number(snap.get(field) ?? 0);
    if (!(floor > atual)) return false;
    tx.update(ref, { [field]: Math.floor(floor) });
    return true;
  });
}
