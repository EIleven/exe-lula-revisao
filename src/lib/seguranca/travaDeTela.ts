/**
 * Trava das mensagens: quem já tem chave e digital cadastradas precisa confirmar a digital para abrir a conversa.
 *
 * O que isto resolve: a criptografia protege a mensagem no caminho, não na mesa do bar. Quem pega o celular
 * destravado lê tudo. Numa rede política isso é o furo mais barato que existe — não precisa quebrar nada, basta
 * pegar o aparelho na mão.
 *
 * Duas decisões que estão aqui e não na tela, porque são as que erram fácil:
 *
 * 1. QUANDO A TRAVA EXISTE. Só para quem tem chave E2EE neste aparelho E digital cadastrada. Sem digital
 *    cadastrada a trava não pode ser aberta — ligá-la seria trancar a pessoa do lado de fora das próprias
 *    mensagens. Quem nunca escolheu e tem as duas coisas começa COM a trava: proteção que depende de alguém
 *    procurar um botão não protege ninguém.
 * 2. QUANDO ELA PEDE DE NOVO. Ao entrar, sempre. Depois, quando o app passou tempo demais em segundo plano —
 *    é esse o momento em que o aparelho trocou de mão.
 *
 * Módulo puro, sem importar nada: a suíte prova as regras sem navegador.
 */

/** Tempo em segundo plano a partir do qual a digital é pedida outra vez. */
export const MINUTOS_ATE_PEDIR_DE_NOVO = 1;

export type Armazenamento = {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
  removeItem(chave: string): void;
};

/** A escolha da pessoa, neste aparelho. */
export const chaveDaTrava = (uid: string) => `hv_trava_mensagens:${uid}`;
/** Onde a tela de Chaves já grava a digital/passkey deste aparelho. Lido, nunca escrito aqui. */
export const chaveDaPasskey = (uid: string) => `idp2p_passkey_${uid}`;

const ler = (armazenamento: Armazenamento | null | undefined, chave: string): string | null => {
  try {
    return armazenamento?.getItem(chave) ?? null;
  } catch {
    // Janela privada ou armazenamento bloqueado.
    return null;
  }
};

/** Esta pessoa cadastrou digital neste aparelho? */
export function temDigitalCadastrada(armazenamento: Armazenamento | null | undefined, uid: string | null | undefined): boolean {
  if (!uid) return false;
  const valor = ler(armazenamento, chaveDaPasskey(uid));
  return typeof valor === 'string' && valor.trim().length > 0;
}

/** `null` = nunca escolheu. */
export function lerEscolha(armazenamento: Armazenamento | null | undefined, uid: string | null | undefined): boolean | null {
  if (!uid) return null;
  const valor = ler(armazenamento, chaveDaTrava(uid));
  if (valor === 'on') return true;
  if (valor === 'off') return false;
  return null;
}

export function salvarEscolha(
  armazenamento: Armazenamento | null | undefined,
  uid: string | null | undefined,
  ligada: boolean,
): void {
  if (!uid) return;
  try {
    armazenamento?.setItem(chaveDaTrava(uid), ligada ? 'on' : 'off');
  } catch {
    // Sem onde guardar: a trava vale só nesta sessão, e isso é melhor que quebrar a tela.
  }
}

/** A trava pode ser oferecida? (Sem digital cadastrada, não — ninguém conseguiria abrir.) */
export function podeTravar(params: { temChaveE2ee: boolean; temDigital: boolean }): boolean {
  return Boolean(params.temChaveE2ee && params.temDigital);
}

/** A trava está valendo agora? */
export function travaAtiva(params: { temChaveE2ee: boolean; temDigital: boolean; escolha: boolean | null }): boolean {
  if (!podeTravar(params)) return false;
  // Nunca escolheu: começa ligada.
  return params.escolha !== false;
}

/**
 * Voltou do segundo plano depois de tempo demais? `escondidoDesde` é o instante em que o app saiu da frente;
 * `null` significa que ele não saiu.
 */
export function precisaPedirDeNovo(params: {
  escondidoDesde: number | null;
  agora: number;
  minutos?: number;
}): boolean {
  const { escondidoDesde, agora } = params;
  if (escondidoDesde === null) return false;
  if (!Number.isFinite(escondidoDesde) || !Number.isFinite(agora)) return false;
  const minutos = typeof params.minutos === 'number' && params.minutos >= 0 ? params.minutos : MINUTOS_ATE_PEDIR_DE_NOVO;
  return agora - escondidoDesde >= minutos * 60_000;
}
