// src/lib/hiperchat/preferences.ts
// O que o HiperChat guarda NESTE APARELHO: conversas fixadas e as preferências de uso do app.
//
// Por que aqui e não no Firestore: nada disto muda o que a conta é na rede. Som, prévia, tamanho do texto e quais
// conversas você fixou são conforto de quem está neste aparelho — gravar no servidor exigiria regra nova, migração e
// sincronização, e ainda assim seria a escolha errada (o celular do trabalho e o de casa não precisam fixar as mesmas
// conversas). O que É da conta — quem pode te mandar mensagem, quem você bloqueou, as chaves — continua no Firestore,
// pelos caminhos que já existem, e a tela de Configurações diz qual é qual.
//
// Tudo por usuário: a chave carrega o uid, então duas contas no mesmo aparelho não se misturam.
// PURO (sem React): e2e/hiperchat-check.mjs prova cada regra. O armazenamento entra por parâmetro.

/** O filtro que o HiperChat abre por padrão. */
export type HiperChatFilter = 'todas' | 'grupos' | 'fixadas';
export const HIPERCHAT_FILTERS: readonly HiperChatFilter[] = ['todas', 'grupos', 'fixadas'];

/** Conforto de leitura no chat. */
export type HiperChatTextSize = 'pequeno' | 'normal' | 'grande';
export const HIPERCHAT_TEXT_SIZES: readonly HiperChatTextSize[] = ['pequeno', 'normal', 'grande'];

export type HiperChatPreferences = {
  /** Tocar um som ao receber mensagem. */
  som: boolean;
  /** Mostrar um trecho da última mensagem na lista. */
  previa: boolean;
  /** Avisar ao outro lado que você leu. */
  confirmacaoDeLeitura: boolean;
  /** Em qual aba o app abre. */
  filtroInicial: HiperChatFilter;
  tamanhoDoTexto: HiperChatTextSize;
};

export const PREFERENCIAS_PADRAO: HiperChatPreferences = {
  som: true,
  previa: true,
  confirmacaoDeLeitura: true,
  filtroInicial: 'todas',
  tamanhoDoTexto: 'normal',
};

/** Teto de conversas fixadas: a seção do topo existe para dar acesso rápido, não para virar a lista inteira. */
export const MAX_FIXADAS = 12;

/** O mínimo de `localStorage` de que precisamos. Entra por parâmetro para o teste não depender de navegador. */
export type Armazenamento = {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
  removeItem(chave: string): void;
};

const chavePreferencias = (uid: string) => `hv_hiperchat_prefs:${uid}`;
const chaveFixadas = (uid: string) => `hv_hiperchat_fixadas:${uid}`;

const umDos = <T extends string>(valor: unknown, opcoes: readonly T[], padrao: T): T =>
  (typeof valor === 'string' && (opcoes as readonly string[]).includes(valor) ? (valor as T) : padrao);

const booleano = (valor: unknown, padrao: boolean): boolean => (typeof valor === 'boolean' ? valor : padrao);

/** Lê as preferências. Qualquer coisa estranha no armazenamento vira o padrão, campo a campo — nunca uma tela quebrada. */
export function lerPreferencias(armazenamento: Armazenamento | null | undefined, uid: string | null | undefined): HiperChatPreferences {
  if (!armazenamento || !uid) return { ...PREFERENCIAS_PADRAO };
  let bruto: unknown = null;
  try {
    const texto = armazenamento.getItem(chavePreferencias(uid));
    bruto = texto ? JSON.parse(texto) : null;
  } catch {
    bruto = null;
  }
  const r = (bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {}) as Record<string, unknown>;
  return {
    som: booleano(r.som, PREFERENCIAS_PADRAO.som),
    previa: booleano(r.previa, PREFERENCIAS_PADRAO.previa),
    confirmacaoDeLeitura: booleano(r.confirmacaoDeLeitura, PREFERENCIAS_PADRAO.confirmacaoDeLeitura),
    filtroInicial: umDos(r.filtroInicial, HIPERCHAT_FILTERS, PREFERENCIAS_PADRAO.filtroInicial),
    tamanhoDoTexto: umDos(r.tamanhoDoTexto, HIPERCHAT_TEXT_SIZES, PREFERENCIAS_PADRAO.tamanhoDoTexto),
  };
}

/** Grava o que mudou por cima do que já estava. Sem armazenamento (modo privado), devolve o resultado sem gravar. */
export function salvarPreferencias(
  armazenamento: Armazenamento | null | undefined,
  uid: string | null | undefined,
  mudanca: Partial<HiperChatPreferences>,
): HiperChatPreferences {
  const atual = lerPreferencias(armazenamento, uid);
  const proximo: HiperChatPreferences = {
    som: booleano(mudanca.som, atual.som),
    previa: booleano(mudanca.previa, atual.previa),
    confirmacaoDeLeitura: booleano(mudanca.confirmacaoDeLeitura, atual.confirmacaoDeLeitura),
    filtroInicial: umDos(mudanca.filtroInicial, HIPERCHAT_FILTERS, atual.filtroInicial),
    tamanhoDoTexto: umDos(mudanca.tamanhoDoTexto, HIPERCHAT_TEXT_SIZES, atual.tamanhoDoTexto),
  };
  if (armazenamento && uid) {
    try {
      armazenamento.setItem(chavePreferencias(uid), JSON.stringify(proximo));
    } catch {
      // modo privado ou armazenamento cheio: a tela continua funcionando com o valor em memória
    }
  }
  return proximo;
}

// ───────────────────────── conversas fixadas ─────────────────────────

/** Os ids fixados, do mais recente para o mais antigo, sem repetição e sem lixo. */
export function lerFixadas(armazenamento: Armazenamento | null | undefined, uid: string | null | undefined): string[] {
  if (!armazenamento || !uid) return [];
  let bruto: unknown = null;
  try {
    const texto = armazenamento.getItem(chaveFixadas(uid));
    bruto = texto ? JSON.parse(texto) : null;
  } catch {
    return [];
  }
  if (!Array.isArray(bruto)) return [];
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const item of bruto) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || id.length > 200 || vistos.has(id)) continue;
    vistos.add(id);
    saida.push(id);
    if (saida.length >= MAX_FIXADAS) break;
  }
  return saida;
}

export function estaFixada(fixadas: readonly string[], conversationId: string | null | undefined): boolean {
  return Boolean(conversationId) && fixadas.includes(conversationId as string);
}

/**
 * Fixa ou desafixa, e devolve a lista nova. A conversa recém-fixada vai para o TOPO (é o que a pessoa acabou de dizer que
 * importa) e, no teto, a mais antiga sai — fixar nunca falha em silêncio por lista cheia.
 */
export function alternarFixada(
  armazenamento: Armazenamento | null | undefined,
  uid: string | null | undefined,
  conversationId: string,
): string[] {
  const id = (conversationId ?? '').trim();
  if (!id) return lerFixadas(armazenamento, uid);
  const atuais = lerFixadas(armazenamento, uid);
  const proximas = atuais.includes(id) ? atuais.filter((x) => x !== id) : [id, ...atuais].slice(0, MAX_FIXADAS);
  if (armazenamento && uid) {
    try {
      armazenamento.setItem(chaveFixadas(uid), JSON.stringify(proximas));
    } catch {
      // sem armazenamento, a mudança vale só nesta tela
    }
  }
  return proximas;
}

/**
 * Separa a lista em fixadas (na ordem em que foram fixadas) e o resto (na ordem que já vinha).
 * Id fixado que não está mais na lista — conversa apagada ou de que a pessoa saiu — é simplesmente ignorado.
 */
export function separarFixadas<T extends { id: string }>(
  conversas: readonly T[],
  fixadas: readonly string[],
): { fixadas: T[]; demais: T[] } {
  if (fixadas.length === 0) return { fixadas: [], demais: [...conversas] };
  const porId = new Map(conversas.map((c) => [c.id, c]));
  const noTopo: T[] = [];
  for (const id of fixadas) {
    const achada = porId.get(id);
    if (achada) noTopo.push(achada);
  }
  const fixados = new Set(noTopo.map((c) => c.id));
  return { fixadas: noTopo, demais: conversas.filter((c) => !fixados.has(c.id)) };
}

// ───────────────────────── vindo da versão anterior ─────────────────────────

/** As chaves da primeira versão do HiperChat: três booleanos soltos, iguais para todas as contas do aparelho. */
const CHAVES_ANTIGAS = {
  som: 'hv_hiperchat_sound',
  previa: 'hv_hiperchat_preview',
  confirmacaoDeLeitura: 'hv_hiperchat_read_receipts',
} as const;

/**
 * Quem já usava o HiperChat não pode ver as escolhas voltarem ao padrão: na primeira leitura por usuário, as três chaves
 * antigas viram as preferências novas (e as antigas ficam onde estão, para uma versão mais velha do app não se perder).
 * Roda uma vez por conta — depois disso a chave nova existe e manda.
 */
export function migrarPreferenciasAntigas(
  armazenamento: Armazenamento | null | undefined,
  uid: string | null | undefined,
): HiperChatPreferences {
  if (!armazenamento || !uid) return { ...PREFERENCIAS_PADRAO };
  let jaTem = false;
  try {
    jaTem = armazenamento.getItem(chavePreferencias(uid)) !== null;
  } catch {
    return { ...PREFERENCIAS_PADRAO };
  }
  if (jaTem) return lerPreferencias(armazenamento, uid);

  const antiga = (chave: string): boolean | undefined => {
    let valor: string | null = null;
    try {
      valor = armazenamento.getItem(chave);
    } catch {
      return undefined;
    }
    if (valor === '1') return true;
    if (valor === '0') return false;
    return undefined;
  };
  return salvarPreferencias(armazenamento, uid, {
    som: antiga(CHAVES_ANTIGAS.som),
    previa: antiga(CHAVES_ANTIGAS.previa),
    confirmacaoDeLeitura: antiga(CHAVES_ANTIGAS.confirmacaoDeLeitura),
  });
}

// ───────────────────────── de qual casa é esta conta ─────────────────────────

export type ContaParaExibir = {
  username?: string | null;
  federatedLoginProvider?: 'fediverse' | 'bluesky' | null;
  federatedLoginHandle?: string | null;
};

/**
 * Como o HiperChat escreve a identidade de quem entrou. Quem entrou pelo Fediverso ou pelo Bluesky continua sendo de LÁ:
 * mostrar `@pessoa@hiperverso.social` para quem é `@pessoa@mastodon.social` é dizer uma identidade que não existe.
 */
export function handleDeExibicao(conta: ContaParaExibir | null | undefined, hostPadrao: string): { handle: string; origem: string } {
  const username = (conta?.username ?? '').trim();
  const bruto = (conta?.federatedLoginHandle ?? '').trim().replace(/^@+/, '');
  const provedor = conta?.federatedLoginProvider ?? null;

  if (provedor === 'fediverse' && bruto.includes('@')) {
    const host = bruto.slice(bruto.lastIndexOf('@') + 1);
    return { handle: `@${bruto}`, origem: host };
  }
  if (provedor === 'bluesky' && bruto !== '') {
    return { handle: `@${bruto}`, origem: 'Bluesky' };
  }
  return { handle: username ? `@${username}@${hostPadrao}` : `@${hostPadrao}`, origem: hostPadrao };
}
