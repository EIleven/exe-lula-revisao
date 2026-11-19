// src/lib/search/operadores.ts
// Os operadores da busca avançada. Módulo PURO: sem React, sem Firebase, sem DOM, sem biblioteca de terceiros.
//
// A barra de busca e o painel de Busca Avançada são a MESMA coisa escrita de dois jeitos. Quem digita
// `de:@breno #reforma periodo:7d` e quem preenche os campos do painel produzem o mesmo objeto, e o painel sabe
// escrever de volta na barra. Sem isso, as duas formas se desencontram e a pessoa deixa de confiar no que vê.
//
// Decisão de desenho: operador desconhecido NÃO vira erro nem filtro. Ele volta a ser texto comum de busca. Quem
// digita "preco: 10" está procurando por preço, não escrevendo um comando — tratar isso como sintaxe quebrada seria
// transformar um acerto em erro.

export type TipoDeConteudo = 'post' | 'artigo' | 'comentario' | 'pessoa' | 'web';
export type Periodo = '24h' | '7d' | '30d' | 'tudo';
export type ComFiltro = 'midia' | 'fonte';
export type Ordenacao = 'relevancia' | 'recentes' | 'curtidos';

export interface BuscaAvancada {
  /** O que sobrou depois de tirar os operadores: é isto que vira token. */
  texto: string;
  /** Frases entre aspas, normalizadas. */
  frases: string[];
  /** Termos que o resultado NÃO pode conter (prefixo `-`). */
  excluir: string[];
  /** `de:@alguem` — um ou mais autores. */
  de: string[];
  /** `instancia:ursal.zone` — domínio do Fediverso. */
  instancias: string[];
  /** `#tag` */
  tags: string[];
  /** `tipo:post|artigo|comentario|pessoa|web` */
  tipos: TipoDeConteudo[];
  periodo: Periodo;
  /** `com:midia|fonte` */
  com: ComFiltro[];
  ordenacao: Ordenacao;
}

export const PERIODOS: readonly Periodo[] = ['24h', '7d', '30d', 'tudo'];
export const TIPOS: readonly TipoDeConteudo[] = ['post', 'artigo', 'comentario', 'pessoa', 'web'];
export const COM: readonly ComFiltro[] = ['midia', 'fonte'];
export const ORDENACOES: readonly Ordenacao[] = ['relevancia', 'recentes', 'curtidos'];

export const BUSCA_VAZIA: BuscaAvancada = {
  texto: '',
  frases: [],
  excluir: [],
  de: [],
  instancias: [],
  tags: [],
  tipos: [],
  periodo: 'tudo',
  com: [],
  ordenacao: 'relevancia',
};

/** Quanto tempo cada período cobre, em ms. `tudo` não corta nada. */
export function janelaEmMs(periodo: Periodo): number | null {
  switch (periodo) {
    case '24h':
      return 86_400_000;
    case '7d':
      return 7 * 86_400_000;
    case '30d':
      return 30 * 86_400_000;
    default:
      return null;
  }
}

const semAcento = (v: string): string =>
  v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** Nomes aceitos para cada operador, em português e inglês, porque as duas formas aparecem. */
const APELIDOS: Record<string, string> = {
  de: 'de', from: 'de', autor: 'de',
  instancia: 'instancia', instance: 'instancia', servidor: 'instancia',
  tipo: 'tipo', type: 'tipo',
  periodo: 'periodo', period: 'periodo', quando: 'periodo',
  com: 'com', with: 'com', has: 'com',
  ordem: 'ordem', sort: 'ordem', ordenar: 'ordem',
};

const UM_ALVO = /^[A-Za-z0-9_.@-]{1,80}$/;

/**
 * Lê a barra de busca e devolve o objeto da busca avançada.
 * Tudo o que não for operador reconhecido permanece como texto — ver a decisão de desenho no topo do arquivo.
 */
export function interpretar(entrada: string, padrao?: Partial<BuscaAvancada>): BuscaAvancada {
  const resultado: BuscaAvancada = { ...BUSCA_VAZIA, ...padrao, frases: [], excluir: [], de: [], instancias: [], tags: [], tipos: [], com: [] };
  const bruto = (entrada || '').slice(0, 500);

  // As frases saem primeiro: dentro de aspas, `de:` e `-` são texto, não operador.
  const semFrases = bruto.replace(/"([^"]{1,200})"/g, (_todo, frase: string) => {
    const limpa = semAcento(frase).replace(/\s+/g, ' ').trim();
    if (limpa.length >= 2) resultado.frases.push(limpa);
    return ' ';
  });

  const livres: string[] = [];
  for (const parte of semFrases.split(/\s+/)) {
    if (!parte) continue;

    if (parte.startsWith('#') && parte.length > 1) {
      const tag = semAcento(parte.slice(1)).replace(/[^a-z0-9_]/g, '');
      if (tag) resultado.tags.push(tag);
      continue;
    }

    if (parte.startsWith('-') && parte.length > 1 && !parte.includes(':')) {
      const termo = semAcento(parte.slice(1));
      if (termo.length >= 2) resultado.excluir.push(termo);
      continue;
    }

    const doisPontos = parte.indexOf(':');
    if (doisPontos > 0) {
      const chave = APELIDOS[semAcento(parte.slice(0, doisPontos))];
      const valorBruto = parte.slice(doisPontos + 1);
      const valor = semAcento(valorBruto);

      if (chave && valor) {
        if (chave === 'de' && UM_ALVO.test(valorBruto)) {
          resultado.de.push(valor.replace(/^@/, ''));
          continue;
        }
        if (chave === 'instancia' && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(valor)) {
          resultado.instancias.push(valor);
          continue;
        }
        if (chave === 'tipo' && (TIPOS as readonly string[]).includes(valor)) {
          resultado.tipos.push(valor as TipoDeConteudo);
          continue;
        }
        if (chave === 'periodo' && (PERIODOS as readonly string[]).includes(valor)) {
          resultado.periodo = valor as Periodo;
          continue;
        }
        if (chave === 'com' && (COM as readonly string[]).includes(valor)) {
          resultado.com.push(valor as ComFiltro);
          continue;
        }
        if (chave === 'ordem' && (ORDENACOES as readonly string[]).includes(valor)) {
          resultado.ordenacao = valor as Ordenacao;
          continue;
        }
      }
      // Operador que não existe, ou valor fora do esperado: volta a ser texto de busca.
      livres.push(parte);
      continue;
    }

    livres.push(parte);
  }

  resultado.texto = livres.join(' ').trim();
  // Sem repetição: `de:@a de:@a` é um autor só.
  resultado.de = Array.from(new Set(resultado.de));
  resultado.instancias = Array.from(new Set(resultado.instancias));
  resultado.tags = Array.from(new Set(resultado.tags));
  resultado.tipos = Array.from(new Set(resultado.tipos));
  resultado.com = Array.from(new Set(resultado.com));
  resultado.excluir = Array.from(new Set(resultado.excluir));
  return resultado;
}

/**
 * Escreve de volta na barra o que o painel montou.
 * Tem de valer a volta: `interpretar(escrever(x))` precisa dar `x` outra vez, senão o painel e a barra divergem e
 * a pessoa perde um filtro sem perceber.
 */
export function escrever(b: BuscaAvancada): string {
  const partes: string[] = [];
  if (b.texto.trim()) partes.push(b.texto.trim());
  for (const f of b.frases) partes.push(`"${f}"`);
  for (const t of b.tags) partes.push(`#${t}`);
  for (const d of b.de) partes.push(`de:@${d}`);
  for (const i of b.instancias) partes.push(`instancia:${i}`);
  for (const t of b.tipos) partes.push(`tipo:${t}`);
  for (const c of b.com) partes.push(`com:${c}`);
  if (b.periodo !== 'tudo') partes.push(`periodo:${b.periodo}`);
  if (b.ordenacao !== 'relevancia') partes.push(`ordem:${b.ordenacao}`);
  for (const e of b.excluir) partes.push(`-${e}`);
  return partes.join(' ');
}

/** Tem algum filtro ligado além do texto? Serve para a tela mostrar que a Busca Avançada está em uso. */
export function temFiltro(b: BuscaAvancada): boolean {
  return (
    b.frases.length > 0 ||
    b.excluir.length > 0 ||
    b.de.length > 0 ||
    b.instancias.length > 0 ||
    b.tags.length > 0 ||
    b.tipos.length > 0 ||
    b.com.length > 0 ||
    b.periodo !== 'tudo' ||
    b.ordenacao !== 'relevancia'
  );
}

export interface ItemFiltravel {
  tipo?: string;
  autorHandle?: string | null;
  /** Domínio da instância, quando o item vem do Fediverso. */
  instancia?: string | null;
  tags?: readonly string[] | null;
  criadoEm?: number;
  temMidia?: boolean;
  temFonte?: boolean;
  /** Texto inteiro normalizado, para a exclusão com `-`. */
  linha?: string | null;
}

/**
 * Aplica os filtros a um item. Separado do ranking de propósito: filtro diz SE o item entra, ranking diz em que
 * ordem. Misturar os dois é como se acaba com "filtro" que na verdade só empurra o item para baixo.
 */
export function passaNoFiltro(item: ItemFiltravel, b: BuscaAvancada, agora: number = Date.now()): boolean {
  if (b.tipos.length > 0 && item.tipo && !b.tipos.includes(item.tipo as TipoDeConteudo)) return false;

  if (b.de.length > 0) {
    const handle = semAcento(item.autorHandle || '');
    if (!handle || !b.de.includes(handle)) return false;
  }

  if (b.instancias.length > 0) {
    const inst = semAcento(item.instancia || '');
    if (!inst || !b.instancias.includes(inst)) return false;
  }

  if (b.tags.length > 0) {
    const tags = (item.tags || []).map((t) => semAcento(t).replace(/^#/, ''));
    if (!b.tags.every((t) => tags.includes(t))) return false;
  }

  const janela = janelaEmMs(b.periodo);
  if (janela !== null) {
    if (!item.criadoEm || !Number.isFinite(item.criadoEm)) return false;
    if (agora - item.criadoEm > janela) return false;
  }

  if (b.com.includes('midia') && !item.temMidia) return false;
  if (b.com.includes('fonte') && !item.temFonte) return false;

  if (b.excluir.length > 0) {
    const linha = item.linha || '';
    for (const termo of b.excluir) if (linha.includes(termo)) return false;
  }

  return true;
}
