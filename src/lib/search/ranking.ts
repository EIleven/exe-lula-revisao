// src/lib/search/ranking.ts
// O ranking da busca do HiperVerso. Módulo PURO: sem React, sem Firebase, sem DOM, sem biblioteca de terceiros.
//
// ───────────────────────── O compromisso ─────────────────────────
// Este arquivo é a resposta inteira para "por que esse resultado veio antes daquele". Não existe aqui, e não pode
// passar a existir, nenhum termo de PATROCÍNIO, ANÚNCIO, IMPULSIONAMENTO PAGO ou acordo comercial. Não há campo de
// "parceiro", não há multiplicador por conta verificada, não há mão no peso. Se um dia alguém quiser vender posição
// na busca, vai ter de vir aqui e escrever isso em código — e o teste `e2e/busca-ranking-check.mjs` quebra.
//
// Os sinais são estes, todos orgânicos e todos legíveis:
//   1. BM25 sobre os tokens, com o TÍTULO/handle pesando mais que o corpo.
//   2. Acerto EXATO no título ou no @handle: quem procura "exercito do lula" quer a página, não uma citação.
//   3. FRASE EXATA entre aspas presente no texto.
//   4. Cobertura: quantos dos termos buscados o documento tem. Ter todos vale mais que ter um muitas vezes.
//   5. Engajamento ORGÂNICO (curtidas e respostas), em escala logarítmica, para não deixar um número grande atropelar
//      a relevância — é desempate, não é o critério.
//   6. Decaimento no tempo, com meia-vida longa: notícia velha perde, mas conteúdo bom não some.
//
// BM25 com uma ressalva honesta: o IDF é calculado sobre o CONJUNTO DE CANDIDATOS, não sobre a rede inteira. Manter
// estatística global exigiria um contador por termo atualizado a cada publicação — caro e frágil. Sobre centenas de
// candidatos a aproximação ordena bem, e está escrita aqui em vez de escondida.

export const K1 = 1.2;
export const B = 0.75;

/** Peso de cada campo no BM25. Título e handle valem mais porque são o que a pessoa costuma lembrar. */
export const PESO_TITULO = 3;
export const PESO_CORPO = 1;

/** Bônus somados depois do BM25. Mantidos como constantes para caberem num teste e numa conversa. */
export const BONUS_TITULO_EXATO = 12;
export const BONUS_HANDLE_EXATO = 14;
export const BONUS_FRASE_EXATA = 6;
export const BONUS_COBERTURA_TOTAL = 4;

/** Quanto o engajamento pode valer, no máximo. Teto baixo de propósito: é desempate. */
export const TETO_ENGAJAMENTO = 3;

/** Meia-vida do decaimento: em 45 dias um documento vale metade do impulso de recência. */
export const MEIA_VIDA_DIAS = 45;
export const PESO_RECENCIA = 2.5;

export interface DocumentoIndexado {
  id: string;
  /** Tokens do título/handle (já radicalizados). */
  tokensTitulo: readonly string[];
  /** Tokens do corpo (já radicalizados). */
  tokensCorpo: readonly string[];
  /** Título normalizado inteiro, para o acerto exato. */
  tituloNormalizado?: string;
  /** Handle normalizado, sem @, para o acerto exato. */
  handleNormalizado?: string;
  /** Texto inteiro normalizado numa linha, para procurar frase exata. */
  linha?: string;
  curtidas?: number;
  respostas?: number;
  /** Instante de criação em ms. */
  criadoEm?: number;
}

export interface Explicacao {
  bm25: number;
  tituloExato: number;
  handleExato: number;
  frase: number;
  cobertura: number;
  engajamento: number;
  recencia: number;
}

export interface Pontuado<T> {
  item: T;
  pontos: number;
  /** Por que esse resultado tem essa nota. Vai para o log e para o painel do admin, nunca para o patrocínio. */
  porque: Explicacao;
}

const contar = (lista: readonly string[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const t of lista) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
};

/**
 * Em quantos documentos cada termo aparece. É a estatística que faz termo comum pesar menos — sem ela, buscar
 * "governo lula" devolveria qualquer coisa que tenha "governo".
 */
export function frequenciaNosDocumentos(docs: readonly DocumentoIndexado[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const d of docs) {
    const presentes = new Set<string>([...d.tokensTitulo, ...d.tokensCorpo]);
    for (const t of presentes) df.set(t, (df.get(t) ?? 0) + 1);
  }
  return df;
}

/** IDF do BM25 (variante com +0.5), com piso em zero para termo presente em quase tudo não virar nota negativa. */
export function idf(totalDocs: number, docsComOTermo: number): number {
  if (totalDocs <= 0) return 0;
  const v = Math.log(1 + (totalDocs - docsComOTermo + 0.5) / (docsComOTermo + 0.5));
  return v > 0 ? v : 0;
}

/** Decaimento por meia-vida. Sem data conhecida, vale 0: não premiar nem punir o que não se sabe. */
export function recencia(criadoEm: number | undefined, agora: number, meiaVidaDias = MEIA_VIDA_DIAS): number {
  if (!criadoEm || !Number.isFinite(criadoEm) || !Number.isFinite(agora)) return 0;
  const dias = (agora - criadoEm) / 86_400_000;
  if (dias < 0) return 1; // data no futuro (relógio torto): trata como agora, sem bônus extra
  return Math.pow(0.5, dias / meiaVidaDias);
}

/** Engajamento em escala logarítmica e com teto: 10.000 curtidas não valem 100x mais que 100. */
export function engajamento(curtidas = 0, respostas = 0): number {
  const bruto = Math.max(0, curtidas) + Math.max(0, respostas) * 2;
  if (bruto <= 0) return 0;
  return Math.min(TETO_ENGAJAMENTO, Math.log10(1 + bruto));
}

/**
 * Pontua um conjunto de candidatos contra a consulta e devolve do mais relevante para o menos.
 * `termos` já vêm radicalizados (ver indiceDeTexto.ts); `frases` são as frases entre aspas, normalizadas.
 */
export function ordenarPorRelevancia<T extends DocumentoIndexado>(
  candidatos: readonly T[],
  consulta: { termos: readonly string[]; frases?: readonly string[]; textoNormalizado?: string },
  agora: number = Date.now(),
): Pontuado<T>[] {
  const termos = Array.from(new Set(consulta.termos.filter(Boolean)));
  const frases = consulta.frases ?? [];
  const alvoExato = (consulta.textoNormalizado ?? '').trim();

  const df = frequenciaNosDocumentos(candidatos);
  const n = candidatos.length;
  const mediaTitulo = n > 0 ? candidatos.reduce((s, d) => s + d.tokensTitulo.length, 0) / n : 0;
  const mediaCorpo = n > 0 ? candidatos.reduce((s, d) => s + d.tokensCorpo.length, 0) / n : 0;

  const parcial = (
    freq: number,
    tamanho: number,
    media: number,
    pesoCampo: number,
    idfTermo: number,
  ): number => {
    if (freq <= 0) return 0;
    const norma = media > 0 ? 1 - B + B * (tamanho / media) : 1;
    return idfTermo * ((freq * (K1 + 1)) / (freq + K1 * norma)) * pesoCampo;
  };

  const pontuados = candidatos.map((doc) => {
    const fTitulo = contar(doc.tokensTitulo);
    const fCorpo = contar(doc.tokensCorpo);

    let bm25 = 0;
    let encontrados = 0;
    for (const termo of termos) {
      const idfTermo = idf(n, df.get(termo) ?? 0);
      const t = fTitulo.get(termo) ?? 0;
      const c = fCorpo.get(termo) ?? 0;
      if (t > 0 || c > 0) encontrados++;
      bm25 += parcial(t, doc.tokensTitulo.length, mediaTitulo, PESO_TITULO, idfTermo);
      bm25 += parcial(c, doc.tokensCorpo.length, mediaCorpo, PESO_CORPO, idfTermo);
    }

    const tituloExato =
      alvoExato.length >= 2 && doc.tituloNormalizado && doc.tituloNormalizado === alvoExato ? BONUS_TITULO_EXATO : 0;
    const handleExato =
      alvoExato.length >= 2 && doc.handleNormalizado && doc.handleNormalizado === alvoExato.replace(/^@/, '')
        ? BONUS_HANDLE_EXATO
        : 0;

    let frase = 0;
    if (frases.length > 0 && doc.linha) {
      for (const f of frases) if (doc.linha.includes(f)) frase += BONUS_FRASE_EXATA;
    }

    const cobertura = termos.length > 0 && encontrados === termos.length && termos.length > 1 ? BONUS_COBERTURA_TOTAL : 0;
    const eng = engajamento(doc.curtidas, doc.respostas);
    const rec = recencia(doc.criadoEm, agora) * PESO_RECENCIA;

    const porque: Explicacao = {
      bm25,
      tituloExato,
      handleExato,
      frase,
      cobertura,
      engajamento: eng,
      recencia: rec,
    };
    const pontos = bm25 + tituloExato + handleExato + frase + cobertura + eng + rec;
    return { item: doc, pontos, porque };
  });

  // Empate desfeito pelo mais novo, e depois pelo id: a mesma busca devolve sempre a mesma ordem.
  pontuados.sort((a, b) => {
    if (b.pontos !== a.pontos) return b.pontos - a.pontos;
    const ta = a.item.criadoEm ?? 0;
    const tb = b.item.criadoEm ?? 0;
    if (tb !== ta) return tb - ta;
    return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
  });
  return pontuados as Pontuado<T>[];
}

/**
 * Um trecho do texto em volta do primeiro termo encontrado, com as posições a destacar.
 * O destaque sai como PARES DE ÍNDICES, não como HTML: quem desenha é a tela, e assim nunca existe string de marcação
 * vinda de conteúdo de terceiro passando por `dangerouslySetInnerHTML`.
 */
export function trechoComDestaque(
  textoOriginal: string,
  termosNormalizados: readonly string[],
  tamanho = 180,
): { trecho: string; marcas: Array<[number, number]> } {
  const texto = (textoOriginal || '').replace(/\s+/g, ' ').trim();
  if (!texto) return { trecho: '', marcas: [] };

  const linha = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  let primeiro = -1;
  for (const t of termosNormalizados) {
    if (t.length < 2) continue;
    const p = linha.indexOf(t);
    if (p >= 0 && (primeiro < 0 || p < primeiro)) primeiro = p;
  }

  let inicio = 0;
  if (primeiro > tamanho / 2) {
    inicio = Math.max(0, primeiro - Math.floor(tamanho / 3));
    const espaco = texto.indexOf(' ', inicio);
    if (espaco > 0 && espaco - inicio < 20) inicio = espaco + 1;
  }
  const fim = Math.min(texto.length, inicio + tamanho);
  const trecho = (inicio > 0 ? '…' : '') + texto.slice(inicio, fim).trim() + (fim < texto.length ? '…' : '');

  const deslocamento = inicio > 0 ? 1 : 0; // o '…' do começo empurra os índices
  const linhaTrecho = trecho
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  const marcas: Array<[number, number]> = [];
  for (const t of termosNormalizados) {
    if (t.length < 2) continue;
    let de = 0;
    for (;;) {
      const p = linhaTrecho.indexOf(t, de);
      if (p < 0) break;
      marcas.push([p, p + t.length]);
      de = p + t.length;
      if (marcas.length > 40) break;
    }
  }
  marcas.sort((a, b) => a[0] - b[0]);

  // Junta marcas que se sobrepõem, senão a tela desenharia destaque dentro de destaque.
  const juntas: Array<[number, number]> = [];
  for (const [a, b] of marcas) {
    const ultima = juntas[juntas.length - 1];
    if (ultima && a <= ultima[1]) ultima[1] = Math.max(ultima[1], b);
    else juntas.push([a, b]);
  }
  void deslocamento;
  return { trecho, marcas: juntas };
}
