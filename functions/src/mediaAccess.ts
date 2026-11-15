// functions/src/mediaAccess.ts
// Mantem o registro `media/{id}` e os tokens do Storage em sincronia com o que
// acontece no servidor: post apagado, perfil que vira privado, conta excluida.
//
// POR QUE PRECISA EXISTIR AQUI: esses tres eventos so acontecem no servidor.
// Deixa-los de fora significaria que a midia de um post apagado, ou de uma
// conta excluida, continuaria acessivel pelo token permanente do Storage — que
// e justamente a falha que a camada de midia veio corrigir.
//
// SOBRE A DUPLICACAO: extrair o id da URL tambem existe em
// src/lib/media/mediaId.ts. As Functions sao outro pacote, com outro tsconfig,
// e nao importam de src/. A duplicacao e deliberada e pequena; o formato do id
// (22 caracteres base64url) esta fixado nos dois lados, e o teste confere que
// os dois continuam concordando.

import {getStorage} from "firebase-admin/storage";
import {FieldValue, type Firestore} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

/** Mesmo formato do id em src/lib/media/mediaId.ts (22 base64url). */
const ID_NA_URL = /\/(?:m|mp)\/([A-Za-z0-9_-]{22})(?:[?#]|$)/;

/** Id da midia embutido numa URL nossa (/m/<id> ou /mp/<id>), ou null. */
export function mediaIdFromUrl(url: unknown): string | null {
  if (typeof url !== "string" || url === "") return null;
  const match = ID_NA_URL.exec(url);
  return match ? match[1] : null;
}

type Documento = Record<string, unknown> | undefined;

/**
 * Ids de midia citados por um post ou comentario: o array `media[]` e os campos
 * antigos `imageUrl` e `videoUrl`. Cobre as duas geracoes de dado sem precisar
 * migrar nada antes.
 */
export function mediaIdsFromContent(data: Documento): string[] {
  if (!data) return [];
  const ids = new Set<string>();
  const anotar = (valor: unknown) => {
    const id = mediaIdFromUrl(valor);
    if (id) ids.add(id);
  };

  anotar(data.imageUrl);
  anotar(data.videoUrl);
  anotar(data.fileUrl); // anexo de mensagem direta
  const media = data.media;
  if (Array.isArray(media)) {
    for (const item of media) {
      if (item && typeof item === "object") {
        anotar((item as Record<string, unknown>).url);
      }
    }
  }
  return [...ids];
}

/**
 * Apaga o token de download do objeto. E o passo que realmente corta o acesso:
 * mudar a visibilidade do registro so fecha a nossa rota, enquanto o token
 * continua valendo direto no Storage.
 *
 * Idempotente: apagar metadata que ja nao existe nao e erro.
 */
async function revogarToken(storagePath: string): Promise<boolean> {
  try {
    await getStorage()
      .bucket()
      .file(storagePath)
      .setMetadata({metadata: {firebaseStorageDownloadTokens: null}});
    return true;
  } catch (error) {
    logger.warn(`[media] falha ao revogar ${storagePath}`, error);
    return false;
  }
}

export interface ResultadoMedia {
  registros: number;
  tokensRevogados: number;
}

/** Aplica uma visibilidade a uma lista de ids; ao virar privado, revoga. */
export async function applyMediaVisibility(
  db: Firestore,
  mediaIds: string[],
  visibility: "public" | "private",
): Promise<ResultadoMedia> {
  let registros = 0;
  let tokensRevogados = 0;

  for (const id of mediaIds) {
    const ref = db.collection("media").doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) continue;
    const dados = snapshot.data() ?? {};

    if (dados.visibility !== visibility) {
      await ref.update({
        visibility,
        visibilityChangedAt: FieldValue.serverTimestamp(),
      });
      registros++;
    }
    const caminho = dados.storagePath;
    if (visibility === "private" && typeof caminho === "string") {
      if (await revogarToken(caminho)) tokensRevogados++;
    }
  }
  return {registros, tokensRevogados};
}

/**
 * Marca a midia como removida e revoga o token. O registro NAO e apagado de
 * proposito: sem ele a rota responderia 404 em vez de 410, e a diferenca entre
 * "nunca existiu" e "foi removido" e informacao util para quem guardou o link.
 */
export async function tombstoneMedia(
  db: Firestore,
  mediaIds: string[],
): Promise<ResultadoMedia> {
  let registros = 0;
  let tokensRevogados = 0;

  for (const id of mediaIds) {
    const ref = db.collection("media").doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) continue;
    const dados = snapshot.data() ?? {};

    if (!dados.deletedAt) {
      await ref.update({deletedAt: FieldValue.serverTimestamp()});
      registros++;
    }
    const caminho = dados.storagePath;
    if (typeof caminho === "string") {
      if (await revogarToken(caminho)) tokensRevogados++;
    }
  }
  return {registros, tokensRevogados};
}

export interface ResultadoPurga extends ResultadoMedia {
  objetosApagados: number;
  ignorados: number;
}

/**
 * Quantos objetos se apagam ao mesmo tempo: o teto de tempo da Function
 * manda, nao o custo de cada chamada.
 */
const CONCORRENCIA_DA_PURGA = 10;

/**
 * Estados de upload de video em que nada foi iniciado (ou ja falhou): da
 * para cancelar sem atrapalhar um worker.
 */
const UPLOAD_CANCELAVEL = ["uploading", "queued", "dispatching", "failed"];

/**
 * Remocao DEFINITIVA da midia de um conteudo que foi apagado (post,
 * comentario, mensagem, conta).
 *
 * Faz o que realmente fecha o acesso, e nesta ordem:
 *  1. tombstone no registro (`deletedAt`): /m responde 410 e /mp responde 404
 *     na hora;
 *  2. APAGA o objeto do bucket. Sem isto o arquivo continua guardado (e
 *     pagando armazenamento) depois de a pessoa ter apagado o conteudo, e
 *     apagar deixa de ser apagar;
 *  3. se o objeto nao puder ser apagado, revoga o token como ultimo recurso,
 *     para o acesso direto nao sobreviver.
 * O registro media/<id> NAO e apagado, de proposito: sem ele a rota
 * responderia 404 em vez de 410.
 *
 * `ownerUid` e a autoria do conteudo apagado: so se remove midia que e DELA.
 * Conteudo que cite midia de outra pessoa (modelo antigo de repost) nao pode
 * apagar o arquivo alheio. Idempotente: repetir nao e erro.
 *
 * Video ainda nao processado: o upload vira "cancelled" e a fonte transitoria
 * sai. Video em processamento: o worker confere `deletedAt` no comeco e no
 * fim e apaga o que produziu.
 */
export async function purgeMedia(
  db: Firestore,
  mediaIds: string[],
  ownerUid: string,
): Promise<ResultadoPurga> {
  const resultado: ResultadoPurga = {
    registros: 0, tokensRevogados: 0, objetosApagados: 0, ignorados: 0,
  };
  if (!ownerUid) return resultado;

  const purgarUma = async (id: string) => {
    const ref = db.collection("media").doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) return;
    const dados = snapshot.data() ?? {};
    if (dados.ownerUid !== ownerUid) {
      resultado.ignorados++;
      return;
    }

    if (!dados.deletedAt) {
      await ref.update({deletedAt: FieldValue.serverTimestamp()});
      resultado.registros++;
    }

    const caminho = dados.storagePath;
    if (typeof caminho === "string" && caminho) {
      try {
        await getStorage()
          .bucket()
          .file(caminho)
          .delete({ignoreNotFound: true});
        resultado.objetosApagados++;
      } catch (error) {
        logger.warn(
          `[media] nao apaguei ${caminho}; revogando o token`,
          error
        );
        if (await revogarToken(caminho)) resultado.tokensRevogados++;
      }
    }

    const envioRef = db.collection("videoUploads").doc(id);
    const envio = await envioRef.get();
    if (envio.exists) {
      const e = envio.data() ?? {};
      if (UPLOAD_CANCELAVEL.includes(String(e.status))) {
        await envioRef.update({
          status: "cancelled",
          updatedAt: FieldValue.serverTimestamp(),
        });
        const fonte = e.sourcePath;
        if (typeof fonte === "string" && fonte.startsWith("video_staging/")) {
          await getStorage()
            .bucket()
            .file(fonte)
            .delete({ignoreNotFound: true})
            .catch((error) =>
              logger.warn(`[media] fonte ${fonte} nao apagada`, error)
            );
        }
      }
    }
  };

  const unicos = [...new Set(mediaIds)];
  for (let i = 0; i < unicos.length; i += CONCORRENCIA_DA_PURGA) {
    const lote = unicos.slice(i, i + CONCORRENCIA_DA_PURGA);
    const resultados = await Promise.allSettled(lote.map(purgarUma));
    resultados.forEach((r, j) => {
      if (r.status === "rejected") {
        logger.error(`[media] falha ao purgar ${lote[j]}:`, r.reason);
      }
    });
  }
  return resultado;
}

/**
 * Toda a midia de uma pessoa, para a exclusao de conta: tombstone E objeto
 * apagado do bucket (ver purgeMedia). Busca por `ownerUid` em
 * vez de depender das referencias: quando a conta e excluida os posts sao
 * apagados junto, e procurar pela referencia ja nao encontraria nada.
 */
export async function tombstoneMediaByOwner(
  db: Firestore,
  uid: string,
): Promise<ResultadoMedia> {
  const snapshot = await db
    .collection("media")
    .where("ownerUid", "==", uid)
    .get();
  const ids = snapshot.docs.map((doc) => doc.id);
  if (ids.length === 0) return {registros: 0, tokensRevogados: 0};
  logger.info(`[media] conta ${uid}: ${ids.length} midias a remover`);
  return purgeMedia(db, ids, uid);
}

/**
 * Midia dos posts de uma pessoa, usada quando o perfil troca entre publico e
 * privado. Le apenas os campos de midia, nao os posts inteiros.
 */
export async function applyMediaVisibilityByOwnerPosts(
  db: Firestore,
  uid: string,
  visibility: "public" | "private",
): Promise<ResultadoMedia> {
  const posts = await db
    .collection("posts")
    .where("userId", "==", uid)
    .select("media", "imageUrl", "videoUrl")
    .get();

  const ids = new Set<string>();
  for (const doc of posts.docs) {
    for (const id of mediaIdsFromContent(doc.data())) ids.add(id);
  }
  if (ids.size === 0) return {registros: 0, tokensRevogados: 0};
  logger.info(`[media] perfil ${uid} -> ${visibility}: ${ids.size} midias`);
  return applyMediaVisibility(db, [...ids], visibility);
}
