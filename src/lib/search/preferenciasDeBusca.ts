// src/lib/search/preferenciasDeBusca.ts
// As escolhas de busca de cada pessoa, neste aparelho. Módulo PURO: o armazenamento entra por parâmetro, para a
// suíte exercitar cada caminho torto sem navegador.
//
// Por que fica no APARELHO e não na conta: o histórico de busca é a coisa mais reveladora que uma rede guarda.
// "O que essa pessoa procurou" diz mais do que o que ela publicou — e numa rede política isso é material que não
// deveria existir em servidor nenhum, nem no nosso. Então o histórico nunca sai daqui, e a limpeza é um toque.
//
// As preferências seguem junto pelo mesmo motivo e por um segundo: elas mudam o que a pessoa VÊ. Guardar no
// servidor significaria que uma falha de permissão em algum lugar poderia alterar os resultados de outra pessoa.

export type Armazenamento = {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
  removeItem(chave: string): void;
};

export type IdiomaDeBusca = 'auto' | 'pt' | 'en' | 'es' | 'todos';

export interface PreferenciasDeBusca {
  /** Mostrar a aba Web (buscador próprio) nos resultados. */
  resultadosWeb: boolean;
  /** Esconder resultados marcados como conteúdo sensível. */
  filtrarSensivel: boolean;
  /** Idioma preferido dos resultados. `auto` segue o idioma da interface; `todos` não filtra. */
  idioma: IdiomaDeBusca;
  /** Guardar as buscas recentes neste aparelho. Desligando, o histórico é apagado na hora. */
  guardarHistorico: boolean;
}

export const PREFERENCIAS_PADRAO: PreferenciasDeBusca = {
  // A aba Web começa LIGADA, mas o buscador próprio só mostra o que ele mesmo indexou, com a origem visível.
  resultadosWeb: true,
  // Ligado por padrão: quem quiser ver conteúdo sensível na busca escolhe ver, não o contrário.
  filtrarSensivel: true,
  idioma: 'auto',
  guardarHistorico: true,
};

export const MAX_HISTORICO = 12;
const MAX_TAMANHO_BUSCA = 120;

const IDIOMAS: readonly IdiomaDeBusca[] = ['auto', 'pt', 'en', 'es', 'todos'];

export const chaveDasPreferencias = (uid: string | null | undefined) =>
  uid ? `hv_busca_prefs:${uid}` : 'hv_busca_prefs:anon';
export const chaveDoHistorico = (uid: string | null | undefined) =>
  uid ? `hv_busca_hist:${uid}` : 'hv_busca_hist:anon';

const booleano = (v: unknown, padrao: boolean): boolean => (typeof v === 'boolean' ? v : padrao);

/** Lê as preferências. Lixo no armazenamento vira o padrão — a busca nunca abre quebrada por causa disso. */
export function lerPreferencias(arm: Armazenamento | null | undefined, uid: string | null | undefined): PreferenciasDeBusca {
  if (!arm) return { ...PREFERENCIAS_PADRAO };
  try {
    const cru = arm.getItem(chaveDasPreferencias(uid));
    if (!cru) return { ...PREFERENCIAS_PADRAO };
    const o = JSON.parse(cru) as Record<string, unknown>;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { ...PREFERENCIAS_PADRAO };
    const idioma = typeof o.idioma === 'string' && (IDIOMAS as readonly string[]).includes(o.idioma)
      ? (o.idioma as IdiomaDeBusca)
      : PREFERENCIAS_PADRAO.idioma;
    return {
      resultadosWeb: booleano(o.resultadosWeb, PREFERENCIAS_PADRAO.resultadosWeb),
      filtrarSensivel: booleano(o.filtrarSensivel, PREFERENCIAS_PADRAO.filtrarSensivel),
      idioma,
      guardarHistorico: booleano(o.guardarHistorico, PREFERENCIAS_PADRAO.guardarHistorico),
    };
  } catch {
    return { ...PREFERENCIAS_PADRAO };
  }
}

/**
 * Grava uma mudança parcial e devolve como ficou.
 * Desligar `guardarHistorico` APAGA o histórico na mesma hora: deixar guardado o que a pessoa acabou de pedir para
 * não guardar seria a pior forma de respeitar a escolha.
 */
export function salvarPreferencias(
  arm: Armazenamento | null | undefined,
  uid: string | null | undefined,
  mudanca: Partial<PreferenciasDeBusca>,
): PreferenciasDeBusca {
  const atual = lerPreferencias(arm, uid);
  const novo: PreferenciasDeBusca = {
    resultadosWeb: booleano(mudanca.resultadosWeb, atual.resultadosWeb),
    filtrarSensivel: booleano(mudanca.filtrarSensivel, atual.filtrarSensivel),
    idioma:
      typeof mudanca.idioma === 'string' && (IDIOMAS as readonly string[]).includes(mudanca.idioma)
        ? mudanca.idioma
        : atual.idioma,
    guardarHistorico: booleano(mudanca.guardarHistorico, atual.guardarHistorico),
  };
  if (!arm) return novo;
  try {
    arm.setItem(chaveDasPreferencias(uid), JSON.stringify(novo));
    if (atual.guardarHistorico && !novo.guardarHistorico) limparHistorico(arm, uid);
  } catch {
    /* janela privada: a escolha vale só nesta sessão, e isso é melhor do que a tela quebrar */
  }
  return novo;
}

// ───────────────────────── Histórico recente (só neste aparelho) ─────────────────────────

export function lerHistorico(arm: Armazenamento | null | undefined, uid: string | null | undefined): string[] {
  if (!arm) return [];
  try {
    const cru = arm.getItem(chaveDoHistorico(uid));
    if (!cru) return [];
    const lista = JSON.parse(cru) as unknown;
    if (!Array.isArray(lista)) return [];
    const limpo: string[] = [];
    for (const item of lista) {
      if (typeof item !== 'string') continue;
      const t = item.trim();
      if (t.length < 2 || t.length > MAX_TAMANHO_BUSCA) continue;
      if (!limpo.includes(t)) limpo.push(t);
      if (limpo.length >= MAX_HISTORICO) break;
    }
    return limpo;
  } catch {
    return [];
  }
}

/**
 * Põe uma busca no topo do histórico. Repetir uma busca antiga a traz para cima em vez de duplicar.
 * Com `guardarHistorico` desligado não grava nada — a escolha vale no lugar onde a gravação acontece, não só na tela.
 */
export function registrarBusca(
  arm: Armazenamento | null | undefined,
  uid: string | null | undefined,
  consulta: string,
): string[] {
  const t = (consulta || '').trim().slice(0, MAX_TAMANHO_BUSCA);
  if (!arm || t.length < 2) return lerHistorico(arm, uid);
  if (!lerPreferencias(arm, uid).guardarHistorico) return [];

  const atual = lerHistorico(arm, uid).filter((x) => x.toLowerCase() !== t.toLowerCase());
  const novo = [t, ...atual].slice(0, MAX_HISTORICO);
  try {
    arm.setItem(chaveDoHistorico(uid), JSON.stringify(novo));
  } catch {
    return atual;
  }
  return novo;
}

/** Apaga o histórico inteiro. Um toque, sem confirmação em três etapas. */
export function limparHistorico(arm: Armazenamento | null | undefined, uid: string | null | undefined): void {
  if (!arm) return;
  try {
    arm.removeItem(chaveDoHistorico(uid));
  } catch {
    /* nada a fazer: já não há o que apagar */
  }
}

/** Tira UMA busca do histórico (o "x" ao lado do item). */
export function esquecerBusca(
  arm: Armazenamento | null | undefined,
  uid: string | null | undefined,
  consulta: string,
): string[] {
  const restante = lerHistorico(arm, uid).filter((x) => x.toLowerCase() !== (consulta || '').trim().toLowerCase());
  if (!arm) return restante;
  try {
    arm.setItem(chaveDoHistorico(uid), JSON.stringify(restante));
  } catch {
    /* janela privada */
  }
  return restante;
}

/** O idioma que vale na prática, resolvendo `auto` contra o idioma da interface. `null` = não filtrar. */
export function idiomaEfetivo(pref: IdiomaDeBusca, localeDaInterface: string): string | null {
  if (pref === 'todos') return null;
  if (pref === 'auto') return (localeDaInterface || 'pt-BR').split('-')[0].toLowerCase() || null;
  return pref;
}
