// functions/src/federation.ts
// A parte da federacao que roda NAS FUNCTIONS: apenas ENFILEIRAR. Nao assina,
// nao entrega e nao fala com servidor remoto — isso e do worker, no site
// (src/lib/activitypub/worker.ts).
//
// POR QUE ESTA DIVISAO: o App Hosting exclui `functions/` do build e este
// pacote nao importa de `src/`. Duplicar assinatura e entrega aqui seria manter
// a parte mais sensivel da seguranca em dois lugares. Por isso a Function so
// registra "este post mudou" em `ap_outbound`, e o worker recalcula o portao
// de tres niveis NO MOMENTO DO ENVIO, com o estado de entao.
//
// O PRE-FILTRO daqui nao e o portao: e so para nao encher a fila. Ele tem uma
// funcao a mais, porem: se a plataforma esta desligada quando o post nasce, o
// post NUNCA e enfileirado — assim ligar a plataforma depois nao federa o que
// foi publicado antes (ADR-AP-6, religar nao federa o passado).

import type {Firestore} from "firebase-admin/firestore";

type Documento = Record<string, unknown> | undefined;
export type Operacao =
  | "create"
  | "update"
  | "delete"
  | "comment-create"
  | "comment-delete"
  | "remote-like"
  | "remote-unlike"
  | "remote-boost"
  | "remote-unboost"
  | "local-boost"
  | "local-unboost"
  | "remote-reply";

const ALCANCES = ["public", "unlisted", "followers"];
const TRES_DIAS_MS = 3 * 24 * 3600 * 1000;

/** `local` para qualquer coisa que nao seja um alcance conhecido. */
export function alcanceDe(d: Documento): string {
  const f = d?.federation;
  return typeof f === "string" && ALCANCES.includes(f) ? f : "local";
}

const estavel = (v: unknown) => JSON.stringify(v ?? null);

/**
 * O que sai para o Fediverso mudou? Contadores e metricas nao contam.
 *
 * A MANCHETE conta: num post de noticia (`category: "news"`) o corpo que sai e
 * manchete + resumo + link. Sem ela aqui, corrigir a manchete de um post ja
 * publicado nunca gerava o Update, e o Fediverso ficava com a errada.
 * `headline` ausente e `null` sao a mesma coisa (post comum), para uma escrita
 * qualquer que apenas acrescente o campo nao virar edicao.
 */
export function conteudoMudou(antes: Documento, depois: Documento): boolean {
  return antes?.text !== depois?.text ||
    (antes?.headline ?? null) !== (depois?.headline ?? null) ||
    (antes?.category ?? "echo") !== (depois?.category ?? "echo") ||
    antes?.sensitive !== depois?.sensitive ||
    antes?.youtubeVideoId !== depois?.youtubeVideoId ||
    estavel(antes?.media) !== estavel(depois?.media);
}

/**
 * O que fazer com uma escrita num post. Devolve `null` para o que nao interessa
 * a federacao — a imensa maioria das escritas, que sao so contadores (curtidas,
 * visualizacoes) gravados pelas outras Functions.
 */
export function decidirOperacao(
  antes: Documento,
  depois: Documento
): Operacao | null {
  const eraFederado = alcanceDe(antes) !== "local";
  const ehFederado = alcanceDe(depois) !== "local";

  // Documento removido de vez.
  if (antes && !depois) return eraFederado ? "delete" : null;
  // Documento novo.
  if (!antes && depois) {
    return ehFederado && depois.isDeleted !== true ? "create" : null;
  }
  if (!antes || !depois) return null;

  // Tombstone: a pessoa apagou (ou a conta foi excluida).
  if (depois.isDeleted === true) {
    return antes.isDeleted === true || !eraFederado ? null : "delete";
  }
  if (antes.isDeleted === true) return null;

  // O servidor retirou o post do Fediverso (alcance virou `local`).
  if (eraFederado && !ehFederado) return "delete";
  if (!ehFederado) return null;
  // Local -> federado depois de criado: as regras nao permitem a um cliente, e
  // um post nao entra no Fediverso por edicao. Ignora.
  if (!eraFederado) return null;

  return conteudoMudou(antes, depois) ? "update" : null;
}

export interface Tarefa {
  id: string;
  op: Operacao | "delete-actor";
  uid: string;
  postId: string | null;
  commentId?: string | null;
  targets: null;
  createdAtMs: number;
  nextAttemptAt: number;
  attempts: number;
  state: "pending";
  note: null;
}

/** Id determinístico: o MESMO evento entregue duas vezes gera UMA tarefa. */
export function montarTarefa(
  op: Tarefa["op"],
  uid: string,
  postId: string | null,
  idDoEvento: string,
  agora: number,
  commentId: string | null = null
): Tarefa {
  return {
    id: `${op}-${commentId ?? postId ?? uid}-${idDoEvento}`,
    op,
    uid,
    postId,
    ...(commentId ? {commentId} : {}),
    targets: null,
    createdAtMs: agora,
    nextAttemptAt: agora,
    attempts: 0,
    state: "pending",
    note: null,
  };
}

const jaExiste = (e: unknown) => {
  const code = (e as {code?: number | string})?.code;
  return code === 6 || code === "already-exists";
};

/** `false` se a tarefa ja existia (evento repetido). */
type IdTokenClient = import("google-auth-library").IdTokenClient;
let workerClientPromise: Promise<IdTokenClient> | null = null;
const WORKER_URL = "https://exercitodolula.app/api/ap/worker";

async function wakeWorker(): Promise<void> {
  try {
    if (!workerClientPromise) {
      const {GoogleAuth} = await import("google-auth-library");
      workerClientPromise = new GoogleAuth().getIdTokenClient(WORKER_URL);
    }
    const client = await workerClientPromise;
    await client.request({url: WORKER_URL, method: "POST", timeout: 2500});
  } catch {
    // O apWorkerTick agendado garante a entrega se o disparo falhar.
  }
}

export async function gravarTarefa(
  db: Firestore,
  tarefa: Tarefa
): Promise<boolean> {
  try {
    await db.collection("ap_outbound").doc(tarefa.id).create({...tarefa});
    await wakeWorker();
    return true;
  } catch (e) {
    if (jaExiste(e)) return false;
    throw e;
  }
}

export interface EventoDePost {
  idDoEvento: string;
  postId: string;
  antes: Documento;
  depois: Documento;
  agora: number;
}

/** Devolve o que fez, para o log. */
export async function aoEscreverPost(
  db: Firestore,
  ev: EventoDePost
): Promise<string> {
  const op = decidirOperacao(ev.antes, ev.depois);
  if (!op) return "ignorado";

  const dono = (ev.depois ?? ev.antes)?.userId;
  if (typeof dono !== "string" || !dono) return "sem-dono";
  // Post materializado do Fediverso (dono ap_): nunca sai daqui. Sem isto,
  // apagar um post remoto que o autor retirou na origem enfileirava um Delete
  // que o worker so descartava.
  if (
    dono.startsWith("ap_") ||
    ev.antes?.isRemoteFediverse === true ||
    ev.depois?.isRemoteFediverse === true
  ) {
    return "remoto";
  }

  // Apagar vale sempre (retirar o que ja saiu): quem decide e o worker, com o
  // registro do que foi entregue. Criar e editar passam pelo pre-filtro.
  if (op !== "delete") {
    const plataforma = (
      await db.collection("config").doc("federation").get()
    ).data();
    if (plataforma?.enabled !== true || plataforma?.killSwitch === true) {
      return "plataforma-desligada";
    }
    const conta = (
      await db.collection("users").doc(dono)
        .collection("private").doc("federation").get()
    ).data();
    if (conta?.enabled !== true || conta?.paused === true) {
      return "conta-inativa";
    }
  }

  const criada = await gravarTarefa(
    db,
    montarTarefa(op, dono, ev.postId, ev.idDoEvento, ev.agora)
  );
  return criada ? `enfileirado:${op}` : "evento-repetido";
}

/**
 * Conta excluida: marca o handle como `deleting` (nunca mais reativavel), da
 * prazo para destruir a chave e enfileira o Delete do ator. O worker entrega o
 * Delete, remove os seguidores e apaga o resto da federacao dessa pessoa.
 */
export async function aoExcluirConta(
  db: Firestore,
  uid: string,
  agora: number
): Promise<string> {
  const achou = await db.collection("ap_handles")
    .where("uid", "==", uid).limit(1).get();
  if (achou.empty) return "sem-federacao";

  // A chave precisa viver o bastante para o Delete ser entregue e retentado
  // (~1,5 dia de tentativas), e nao mais que isso.
  await achou.docs[0].ref.update({
    state: "deleting",
    keyDeleteAfterMs: agora + TRES_DIAS_MS,
  });
  await gravarTarefa(
    db,
    montarTarefa("delete-actor", uid, null, `${agora}`, agora)
  );
  // O estado de federacao da conta: o `onUserDeletedCleanup` so apagava
  // `private/account`.
  await db.collection("users").doc(uid)
    .collection("private").doc("federation").delete();
  return "enfileirado:delete-actor";
}

export interface EventoDeComentario {
  idDoEvento: string;
  postId: string;
  commentId: string;
  antes: Documento;
  depois: Documento;
  agora: number;
}

/** Enfileira criação/remoção de comentário local em post federado. */
export async function aoEscreverComentario(
  db: Firestore,
  ev: EventoDeComentario
): Promise<string> {
  const {antes, depois} = ev;
  if (antes?.isRemoteFediverse === true || depois?.isRemoteFediverse === true) {
    return "ignorado";
  }

  let op: "comment-create" | "comment-delete" | null = null;
  if (!antes && depois && depois.isDeleted !== true) {
    op = "comment-create";
  } else if (
    (antes && !depois) ||
    (antes && depois && antes.isDeleted !== true && depois.isDeleted === true)
  ) {
    op = "comment-delete";
  }
  if (!op) return "ignorado";

  const dono = (depois ?? antes)?.userId;
  if (typeof dono !== "string" || !dono || dono.startsWith("ap:")) {
    return "sem-dono";
  }

  const postSnap = await db.collection("posts").doc(ev.postId).get();
  const ehPostRemoto = postSnap.exists &&
    postSnap.data()?.isRemoteFediverse === true &&
    typeof postSnap.data()?.remoteInbox === "string";

  if (!ehPostRemoto) {
    const objSnap = await db.collection("ap_objects").doc(ev.postId).get();
    if (!objSnap.exists || objSnap.data()?.state !== "federated") {
      return "post-nao-federado";
    }
  } else if (op === "comment-delete") {
    return "ignorado";
  }

  if (op === "comment-create") {
    const plataforma = (
      await db.collection("config").doc("federation").get()
    ).data();
    if (plataforma?.enabled !== true || plataforma?.killSwitch === true) {
      return "plataforma-desligada";
    }
    const conta = (
      await db.collection("users").doc(dono)
        .collection("private").doc("federation").get()
    ).data();
    if (conta?.enabled !== true || conta?.paused === true) {
      return "conta-inativa";
    }
  }

  const jobOp: Operacao = ehPostRemoto ? "remote-reply" : op;
  const criada = await gravarTarefa(
    db,
    montarTarefa(jobOp, dono, ev.postId, ev.idDoEvento, ev.agora, ev.commentId)
  );
  return criada ? `enfileirado:${jobOp}` : "evento-repetido";
}

/** Enfileira Like/Unlike/Boost/Unboost em post remoto do Fediverso. */
export async function aoInteragirPostRemoto(
  db: Firestore,
  ev: {
    idDoEvento: string;
    op: "remote-like" | "remote-unlike" | "remote-boost" | "remote-unboost";
    uid: string;
    postId: string;
    agora: number;
  }
): Promise<string> {
  if (!ev.uid || ev.uid.startsWith("ap_") || ev.uid.startsWith("ap:")) {
    return "ignorado";
  }
  if (!ev.postId.startsWith("ap_")) return "ignorado";

  const [postSnap, platSnap, contaSnap] = await Promise.all([
    db.collection("posts").doc(ev.postId).get(),
    db.collection("config").doc("federation").get(),
    db.collection("users").doc(ev.uid)
      .collection("private").doc("federation").get(),
  ]);
  const postData = postSnap.data();
  if (
    !postSnap.exists ||
    postData?.isRemoteFediverse !== true ||
    typeof postData?.remoteInbox !== "string"
  ) {
    return "nao-remoto";
  }
  const plat = platSnap.data();
  if (plat?.enabled !== true || plat?.killSwitch === true) {
    return "plataforma-desligada";
  }
  const conta = contaSnap.data();
  if (conta?.enabled !== true || conta?.paused === true) {
    return "conta-inativa";
  }
  const criada = await gravarTarefa(
    db,
    montarTarefa(ev.op, ev.uid, ev.postId, ev.idDoEvento, ev.agora)
  );
  return criada ? `enfileirado:${ev.op}` : "evento-repetido";
}

/**
 * Enfileira Boost/Unboost de um post local federado para os seguidores
 * do Fediverso do autor do repost.
 */
export async function aoBoostPostLocal(
  db: Firestore,
  ev: {
    idDoEvento: string;
    op: "local-boost" | "local-unboost";
    uid: string;
    postId: string;
    agora: number;
  }
): Promise<string> {
  if (!ev.uid || ev.uid.startsWith("ap_") || ev.uid.startsWith("ap:")) {
    return "ignorado";
  }
  if (!ev.postId || ev.postId.startsWith("ap_")) return "ignorado";

  const [postSnap, objSnap, platSnap, contaSnap] = await Promise.all([
    db.collection("posts").doc(ev.postId).get(),
    db.collection("ap_objects").doc(ev.postId).get(),
    db.collection("config").doc("federation").get(),
    db.collection("users").doc(ev.uid)
      .collection("private").doc("federation").get(),
  ]);

  const postData = postSnap.data();
  const ehFederado =
    (objSnap.exists && objSnap.data()?.state === "federated") ||
    alcanceDe(postData) !== "local";
  if (
    !postSnap.exists ||
    postData?.isDeleted === true ||
    postData?.visibility !== "public" ||
    !ehFederado
  ) {
    return "post-nao-federado";
  }

  const plat = platSnap.data();
  if (plat?.enabled !== true || plat?.killSwitch === true) {
    return "plataforma-desligada";
  }
  const conta = contaSnap.data();
  if (
    conta?.enabled !== true ||
    (ev.op === "local-boost" && conta?.paused === true)
  ) {
    return "conta-inativa";
  }

  const criada = await gravarTarefa(
    db,
    montarTarefa(ev.op, ev.uid, ev.postId, ev.idDoEvento, ev.agora)
  );
  return criada ? `enfileirado:${ev.op}` : "evento-repetido";
}

