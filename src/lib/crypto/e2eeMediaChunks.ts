// src/lib/crypto/e2eeMediaChunks.ts
// Cifragem de arquivo GRANDE em pedaços, para conversa protegida. Módulo sem React, sem Firebase e sem DOM: só
// WebCrypto (que existe no navegador e no Node 22), para a suíte exercitar a criptografia de verdade, não um dublê.
//
// Por que existe: o caminho antigo lia o arquivo inteiro (`file.arrayBuffer()`) e cifrava de uma vez. Um vídeo de
// 200 MB virava 400 MB de memória entre texto claro e cifrado, e a WebView do celular morria antes disso. Aqui a
// memória presa é um pedaço de cada vez, nos dois sentidos.
//
// E por que o servidor não ajuda: o pipeline de vídeo do app transcodifica com FFmpeg, e para isso precisa LER os
// bytes. Em conversa protegida ele não pode. Então nada de transcodificação aqui — é escolha, não limitação.
//
// ───────────────────────── As três regras que não podem ser quebradas ─────────────────────────
//
// 1. UM IV POR PEDAÇO, nunca repetido. Repetir (chave, IV) no AES-GCM não "enfraquece um pouco": entrega o XOR dos
//    dois textos claros e destrói a autenticação daquela chave. O IV aqui é 8 bytes sorteados por arquivo + o índice
//    do pedaço em 4 bytes. Como a chave também é sorteada por arquivo, o par (chave, IV) é único no mundo.
//
// 2. O ÍNDICE E O TOTAL VÃO DENTRO DA AUTENTICAÇÃO (AAD). Sem isso, cada pedaço é válido sozinho e quem controla o
//    armazenamento pode reordenar, repetir ou CORTAR O FIM do vídeo sem que nada falhe — a selagem do GCM não vê o
//    que está em volta. Com o índice e o total selados, trocar a ordem ou mudar o tamanho quebra a abertura.
//
// 3. A CAPA USA UM ÍNDICE RESERVADO. Ela é cifrada com a mesma chave do vídeo (uma chave, um descritor, uma troca de
//    chaves), mas num índice que nenhum pedaço de dado alcança — senão seria o caso 1 de novo, por descuido.

/** Pedaço de 8 MB: memória presa baixa e poucas idas à rede. É o mesmo tamanho que o envio de vídeo comum usa. */
export const TAMANHO_DO_PEDACO = 8 * 1024 * 1024;

/** Teto do vídeo em conversa protegida. O limite de 5 MB continua valendo para o envio comum, sem cifragem. */
export const LIMITE_MIDIA_PROTEGIDA = 200 * 1024 * 1024;

/** Cada pedaço cresce 16 bytes: é a etiqueta de autenticação do AES-GCM. */
export const BYTES_DA_ETIQUETA = 16;

/** Índice reservado da capa. Nenhum pedaço de dado chega aqui (seriam 32 petabytes). */
export const INDICE_DA_CAPA = 0xffff_ffff;

/** O que viaja cifrado dentro da mensagem e abre o arquivo do outro lado. */
export interface DescritorDeMidiaV2 {
  v: 2;
  /** Chave AES-256 do arquivo, em base64. Sorteada por arquivo. */
  k: string;
  /** Os 8 bytes sorteados que formam a base do IV, em base64. */
  ivBase: string;
  /** Identificador do arquivo, selado junto de cada pedaço. */
  fileId: string;
  mime: string;
  name?: string;
  /** Tamanho do arquivo em CLARO (para a barra de progresso e para conferir o que chegou). */
  size: number;
  /** Tamanho do pedaço em claro. */
  chunk: number;
  /** Quantos pedaços. */
  count: number;
  /** Tem capa cifrada guardada à parte. */
  poster?: boolean;
}

export interface PlanoDePedacos {
  tamanhoDoPedaco: number;
  total: number;
}

/** Em quantos pedaços o arquivo é cortado. Arquivo vazio não tem pedaço nenhum. */
export function planoDePedacos(tamanho: number, tamanhoDoPedaco = TAMANHO_DO_PEDACO): PlanoDePedacos {
  if (!Number.isFinite(tamanho) || tamanho <= 0 || !Number.isFinite(tamanhoDoPedaco) || tamanhoDoPedaco <= 0) {
    return { tamanhoDoPedaco, total: 0 };
  }
  return { tamanhoDoPedaco, total: Math.ceil(tamanho / tamanhoDoPedaco) };
}

/** O tamanho que o arquivo cifrado terá: o claro mais uma etiqueta por pedaço. */
export function tamanhoCifrado(tamanho: number, tamanhoDoPedaco = TAMANHO_DO_PEDACO): number {
  const { total } = planoDePedacos(tamanho, tamanhoDoPedaco);
  return tamanho + total * BYTES_DA_ETIQUETA;
}

/** Onde o pedaço `indice` começa e termina DENTRO do arquivo cifrado (serve para o Range da Etapa 2). */
export function faixaCifradaDoPedaco(indice: number, tamanhoDoPedaco = TAMANHO_DO_PEDACO): { inicio: number; fim: number } {
  const cheio = tamanhoDoPedaco + BYTES_DA_ETIQUETA;
  const inicio = indice * cheio;
  return { inicio, fim: inicio + cheio - 1 };
}

/**
 * O IV deste pedaço: 8 bytes de base (do arquivo) + 4 bytes do índice, big-endian.
 * Recusa base de tamanho errado em vez de completar com zeros — completar silenciosamente é como se repete IV.
 */
export function ivDoPedaco(base: Uint8Array, indice: number): Uint8Array {
  if (base.length !== 8) throw new Error('base do IV precisa ter 8 bytes');
  if (!Number.isInteger(indice) || indice < 0 || indice > 0xffff_ffff) throw new Error('índice de pedaço inválido');
  const iv = new Uint8Array(12);
  iv.set(base, 0);
  iv[8] = (indice >>> 24) & 0xff;
  iv[9] = (indice >>> 16) & 0xff;
  iv[10] = (indice >>> 8) & 0xff;
  iv[11] = indice & 0xff;
  return iv;
}

/**
 * O que é selado junto do pedaço, além do conteúdo: versão, arquivo, posição e total.
 * É isto que impede reordenar, repetir e cortar o fim do vídeo.
 */
export function aadDoPedaco(fileId: string, indice: number, total: number): Uint8Array {
  return new TextEncoder().encode(`e2ee-v2|${fileId}|${indice}|${total}`);
}

/** Sorteia a chave e a base do IV de um arquivo novo. */
export function novoSegredoDeArquivo(cripto: Crypto = globalThis.crypto): { chave: Uint8Array; base: Uint8Array; fileId: string } {
  const chave = cripto.getRandomValues(new Uint8Array(32));
  const base = cripto.getRandomValues(new Uint8Array(8));
  const idBytes = cripto.getRandomValues(new Uint8Array(12));
  let fileId = '';
  for (const b of idBytes) fileId += 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36];
  return { chave, base, fileId };
}

const subtle = (): SubtleCrypto => globalThis.crypto.subtle;

export async function importarChave(chave: Uint8Array, usos: KeyUsage[]): Promise<CryptoKey> {
  return subtle().importKey('raw', chave as BufferSource, { name: 'AES-GCM' }, false, usos);
}

/** Cifra UM pedaço. `indice` é a posição real (ou INDICE_DA_CAPA para a capa). */
export async function cifrarPedaco(
  aesKey: CryptoKey,
  base: Uint8Array,
  bytes: ArrayBuffer | Uint8Array,
  ctx: { fileId: string; indice: number; total: number },
): Promise<ArrayBuffer> {
  return subtle().encrypt(
    {
      name: 'AES-GCM',
      iv: ivDoPedaco(base, ctx.indice) as BufferSource,
      additionalData: aadDoPedaco(ctx.fileId, ctx.indice, ctx.total) as BufferSource,
    },
    aesKey,
    bytes as BufferSource,
  );
}

/** Abre UM pedaço. Lança se a selagem não bater — ou seja, se mexeram no conteúdo, na ordem ou no total. */
export async function decifrarPedaco(
  aesKey: CryptoKey,
  base: Uint8Array,
  bytes: ArrayBuffer | Uint8Array,
  ctx: { fileId: string; indice: number; total: number },
): Promise<ArrayBuffer> {
  return subtle().decrypt(
    {
      name: 'AES-GCM',
      iv: ivDoPedaco(base, ctx.indice) as BufferSource,
      additionalData: aadDoPedaco(ctx.fileId, ctx.indice, ctx.total) as BufferSource,
    },
    aesKey,
    bytes as BufferSource,
  );
}

/** Um descritor que chegou do outro lado é dado de fora: cada campo é conferido antes de virar instrução. */
export function lerDescritorV2(bruto: unknown): DescritorDeMidiaV2 | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;
  const d = bruto as Record<string, unknown>;
  if (d.v !== 2) return null;
  if (typeof d.k !== 'string' || d.k.length < 40 || d.k.length > 64) return null;
  if (typeof d.ivBase !== 'string' || d.ivBase.length < 8 || d.ivBase.length > 24) return null;
  if (typeof d.fileId !== 'string' || !/^[a-z0-9]{6,32}$/.test(d.fileId)) return null;
  if (typeof d.mime !== 'string' || d.mime.length > 120) return null;
  if (typeof d.size !== 'number' || !Number.isSafeInteger(d.size) || d.size <= 0 || d.size > LIMITE_MIDIA_PROTEGIDA) return null;
  if (typeof d.chunk !== 'number' || !Number.isSafeInteger(d.chunk) || d.chunk <= 0 || d.chunk > LIMITE_MIDIA_PROTEGIDA) return null;
  if (typeof d.count !== 'number' || !Number.isSafeInteger(d.count) || d.count <= 0 || d.count > 100_000) return null;
  // O total precisa combinar com tamanho e pedaço: um `count` solto seria o atalho para cortar o fim do arquivo.
  if (planoDePedacos(d.size, d.chunk).total !== d.count) return null;
  return {
    v: 2,
    k: d.k,
    ivBase: d.ivBase,
    fileId: d.fileId,
    mime: d.mime,
    size: d.size,
    chunk: d.chunk,
    count: d.count,
    ...(typeof d.name === 'string' ? { name: d.name.slice(0, 120) } : {}),
    ...(d.poster === true ? { poster: true as const } : {}),
  };
}
