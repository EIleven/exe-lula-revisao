// src/lib/search/indiceDeTexto.ts
// Tokenização e normalização para a busca do HiperVerso. Módulo PURO: sem React, sem Firebase, sem DOM, sem
// dependência de terceiros — roda igual no navegador, no servidor e na suíte em Node.
//
// Por que tecnologia própria aqui: um índice de busca decide o que as pessoas encontram. Entregar isso a um serviço
// de fora significaria mandar para terceiros o que cada pessoa procura, e aceitar a ordenação de outra pessoa. A
// conta é simples o bastante para ser nossa, e sendo nossa dá para ler, auditar e explicar por que um resultado veio
// antes do outro.
//
// O que a tokenização precisa acertar em português:
//   - ACENTO não pode separar palavras: quem digita "eleicao" tem de achar "eleição".
//   - PLURAL e flexão comum também não: "eleições" e "eleição" são a mesma busca para quem procura.
//   - Mas o corte precisa ser CONSERVADOR. Radicalizar demais junta palavras diferentes ("casa" e "casar"), e aí a
//     busca devolve lixo com cara de acerto — pior que não achar, porque parece que funcionou.

/** Tamanhos: abaixo de 2 letras não distingue nada; acima de 32 é lixo colado ou base64. */
export const MIN_TAMANHO_TOKEN = 2;
export const MAX_TAMANHO_TOKEN = 32;

/** Teto de tokens guardados por documento. Protege o tamanho do documento e o custo do índice. */
export const MAX_TOKENS_POR_DOC = 150;

/**
 * Palavras que aparecem em quase tudo e por isso não ajudam a distinguir nada. Lista curta de propósito: cortar
 * demais apaga buscas legítimas ("a gente", "o povo"), e o BM25 já reduz sozinho o peso do que é comum.
 */
export const PALAVRAS_VAZIAS = new Set([
  // português
  'a', 'as', 'o', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
  'por', 'pelo', 'pela', 'para', 'pra', 'com', 'sem', 'sob', 'ao', 'aos', 'e', 'ou', 'que', 'se', 'eh',
  'ja', 'nao', 'sim', 'mais', 'mas', 'como', 'quando', 'onde', 'isso', 'isto', 'esse', 'essa', 'este', 'esta',
  'ser', 'foi', 'sao', 'era', 'tem', 'ter', 'teve', 'esta', 'estao', 'muito', 'muita', 'pelos', 'pelas',
  // inglês
  'the', 'of', 'and', 'or', 'to', 'in', 'on', 'at', 'for', 'with', 'is', 'are', 'was', 'were', 'be', 'been',
  'this', 'that', 'these', 'those', 'it', 'its', 'as', 'by', 'from', 'an',
]);

/** Minúsculas e sem acento. É o mesmo tratamento dos dois lados: do texto guardado e do que a pessoa digita. */
export function normalizar(valor: string): string {
  return (valor || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/**
 * Corte conservador de flexão (PT-BR e inglês). A regra que vale aqui: na dúvida, NÃO cortar.
 * Juntar "casa" com "casar" devolveria resultados errados com aparência de certos, o que é pior do que devolver
 * menos. Por isso só plurais regulares e dois ou três finais de alta frequência, com piso de tamanho.
 */
export function radical(token: string): string {
  let t = token;
  if (t.length <= 3) return t;

  // Plurais do português que mudam o miolo.
  if (t.endsWith('oes') && t.length > 4) return `${t.slice(0, -3)}ao`; // eleicoes -> eleicao
  if (t.endsWith('aes') && t.length > 4) return `${t.slice(0, -3)}ao`; // paes -> pao
  if (t.endsWith('ais') && t.length > 4) return `${t.slice(0, -3)}al`; // jornais -> jornal
  if (t.endsWith('eis') && t.length > 4) return `${t.slice(0, -3)}el`; // papeis -> papel
  if (t.endsWith('ois') && t.length > 4) return `${t.slice(0, -3)}ol`;
  if (t.endsWith('uis') && t.length > 4) return `${t.slice(0, -3)}ul`;
  if (t.endsWith('ns') && t.length > 3) return `${t.slice(0, -2)}m`; // homens -> homem

  // Inglês, antes do plural simples (senão "running" perderia só o "g").
  if (t.endsWith('ing') && t.length > 6) t = t.slice(0, -3);
  else if (t.endsWith('ed') && t.length > 5) t = t.slice(0, -2);

  // Plural regular. `-es` só depois de consoante em que ele é mesmo plural.
  if (t.endsWith('es') && t.length > 4 && /[rszx]es$/.test(t)) t = t.slice(0, -2);
  else if (t.endsWith('s') && !t.endsWith('ss') && t.length > 3) t = t.slice(0, -1);

  return t;
}

/** Quebra um texto em palavras normalizadas, sem radicalizar. Hashtag e arroba perdem o símbolo mas não o corpo. */
export function palavras(texto: string): string[] {
  const limpo = normalizar(texto).replace(/[#@]/g, ' ');
  const brutas = limpo.split(/[^a-z0-9]+/);
  const saida: string[] = [];
  for (const p of brutas) {
    if (p.length < MIN_TAMANHO_TOKEN || p.length > MAX_TAMANHO_TOKEN) continue;
    saida.push(p);
  }
  return saida;
}

/**
 * Os tokens que vão para o índice (ou para a consulta). Sem palavras vazias, radicalizados, sem repetição e com
 * teto. A ordem é a de aparição, para o corte pelo teto manter o começo do texto, que costuma ser o título.
 */
export function tokens(texto: string, limite = MAX_TOKENS_POR_DOC): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const p of palavras(texto)) {
    if (PALAVRAS_VAZIAS.has(p)) continue;
    const r = radical(p);
    if (r.length < MIN_TAMANHO_TOKEN || vistos.has(r)) continue;
    vistos.add(r);
    saida.push(r);
    if (saida.length >= limite) break;
  }
  return saida;
}

/**
 * Tokens de um documento da rede, juntando os campos que valem busca.
 * O título entra também inteiro e normalizado (campo `exato`), para o ranking premiar quem acertou o título em cheio.
 */
export function tokensDoDocumento(campos: {
  titulo?: string | null;
  texto?: string | null;
  autorNome?: string | null;
  autorHandle?: string | null;
  hashtags?: readonly string[] | null;
}): string[] {
  const partes = [
    campos.titulo ?? '',
    campos.autorNome ?? '',
    campos.autorHandle ?? '',
    (campos.hashtags ?? []).join(' '),
    campos.texto ?? '',
  ];
  return tokens(partes.join(' \n '));
}

/** Frase exata pedida com aspas: `"reforma agraria"` → `reforma agraria` (já normalizada). */
export function frasesExatas(consulta: string): string[] {
  const saida: string[] = [];
  const re = /"([^"]{2,120})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(consulta)) !== null) {
    const frase = normalizar(m[1]).replace(/\s+/g, ' ').trim();
    if (frase.length >= 2) saida.push(frase);
  }
  return saida;
}

/** O texto de um documento como uma linha normalizada, para procurar frase exata e montar o trecho. */
export function linhaNormalizada(texto: string): string {
  return normalizar(texto).replace(/\s+/g, ' ').trim();
}
