// src/lib/messages/recibos.ts
// As regras da CONFIRMAÇÃO DE LEITURA. Módulo PURO (sem React, sem Firebase, sem DOM): o armazenamento e o relógio
// entram por parâmetro, para a suíte exercitar cada caminho em Node.
//
// O que está em jogo: "fulano leu às 15:40" é prova de leitura. Numa rede política isso é material. Então a regra
// central aqui não é técnica, é um acordo: RECIPROCIDADE — quem desliga a confirmação não envia a sua E não vê a dos
// outros. Antes disso, o botão só escondia as marcas na própria tela enquanto a leitura continuava sendo entregue:
// uma escolha de mentira.
//
// A confirmação é uma MARCA D'ÁGUA por pessoa ("li tudo até este instante"), não um registro por mensagem. Isso
// custa um campo numa escrita que já acontece, em vez de uma escrita por mensagem, e vaza menos: o outro lado sabe
// que você abriu, não quanto tempo parou em cada linha.

/** O mínimo de `localStorage` de que precisamos. Entra por parâmetro para o teste não depender de navegador. */
export type Armazenamento = {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
  removeItem(chave: string): void;
};

/**
 * No máximo uma confirmação a cada 4s por conversa aberta. Sem isso, uma rajada de 20 mensagens viraria 20 escritas
 * no mesmo documento — e o Firestore cobra e serializa cada uma.
 */
export const INTERVALO_MINIMO_MS = 4_000;

/** Onde a marca do modo Zero DB fica neste aparelho (no Zero DB não há documento no servidor para guardá-la). */
export const chaveDaMarcaLocal = (uid: string, conversaId: string) => `hv_lida_ate:${uid}:${conversaId}`;

/** Instante mais antigo que aceitamos como marca de leitura (antes disso é lixo ou relógio quebrado). */
const MIN_INSTANTE = Date.UTC(2020, 0, 1);

/**
 * RECIPROCIDADE. Quem não envia, não vê — a mesma chave abre e fecha os dois lados.
 * Está como função (e não como `if` espalhado pelas telas) para existir um lugar só onde esse acordo pode ser quebrado.
 */
export function podeVerRecibos(ligado: boolean): boolean {
  return ligado === true;
}

/**
 * Vale avisar o outro lado de que você leu?
 *
 * `conversaAberta` é o que impede a armadilha do botão "marcar todas como lidas" da lista: ele zera os contadores de
 * N conversas de uma vez, e se o recibo pegasse carona ali você avisaria N pessoas que leu sem ter aberto nada.
 */
export function deveEnviarRecibo(ctx: {
  ligado: boolean;
  /** A conversa está ABERTA na tela agora (não é o botão de marcar todas como lidas). */
  conversaAberta: boolean;
  /** Grupo fica de fora nesta rodada: "lida por 7 de 12" é outra conversa de privacidade. */
  ehGrupo: boolean;
  /** Conversa consigo mesma: confirmar a própria leitura é só ruído. */
  ehComigo: boolean;
}): boolean {
  if (!podeVerRecibos(ctx.ligado)) return false;
  if (!ctx.conversaAberta) return false;
  if (ctx.ehGrupo || ctx.ehComigo) return false;
  return true;
}

/**
 * Qualquer coisa que o banco devolva vira um instante comparável — ou `null`.
 * O Firestore entrega `Timestamp` (com `toMillis`), o cache entrega `{seconds}`, o JSON entrega texto, o código
 * antigo entrega número. Nada disso pode derrubar a tela, e nada implausível pode virar "lida".
 */
export function instanteDe(valor: unknown): number | null {
  let ms: number | null = null;

  if (typeof valor === 'number') {
    ms = valor;
  } else if (typeof valor === 'string') {
    const t = Date.parse(valor);
    ms = Number.isFinite(t) ? t : null;
  } else if (valor && typeof valor === 'object') {
    const obj = valor as { toMillis?: unknown; seconds?: unknown; _seconds?: unknown };
    if (typeof obj.toMillis === 'function') {
      try {
        const t = (obj.toMillis as () => unknown)();
        ms = typeof t === 'number' ? t : null;
      } catch {
        ms = null;
      }
    } else if (typeof obj.seconds === 'number') {
      ms = obj.seconds * 1000;
    } else if (typeof obj._seconds === 'number') {
      ms = obj._seconds * 1000;
    }
  }

  if (ms === null || !Number.isFinite(ms) || ms < MIN_INSTANTE) return null;
  return ms;
}

/** A marca d'água de uma pessoa dentro do mapa `lastReadAt` do documento da conversa. */
export function lidaAteDe(mapa: unknown, uid: string | null | undefined): number | null {
  if (!uid || !mapa || typeof mapa !== 'object' || Array.isArray(mapa)) return null;
  return instanteDe((mapa as Record<string, unknown>)[uid]);
}

/**
 * Esta mensagem já foi lida pelo outro lado?
 *
 * A comparação é ESTRITA de propósito: sem folga de relógio. Errar para menos atrasa uma marca; errar para mais diz
 * que a pessoa leu algo que ela não viu — e é isso que ninguém pode fazer.
 */
export function foiLida(args: { criadaEm: unknown; lidaAte: number | null }): boolean {
  if (args.lidaAte === null || !Number.isFinite(args.lidaAte)) return false;
  const criada = instanteDe(args.criadaEm);
  if (criada === null) return false;
  return criada <= args.lidaAte;
}

/**
 * Vale escrever a confirmação agora?
 *
 * Só quando há mensagem nova do outro lado DEPOIS do que já foi confirmado, e respeitando o intervalo mínimo — numa
 * conversa ativa o que chega é rajada, e uma escrita por mensagem seria desperdício puro.
 */
export function precisaConfirmar(args: {
  /** Instante da mensagem mais recente recebida do outro lado. */
  maiorRecebidaEm: number | null;
  /** Até onde já foi confirmado (o que o servidor/o túnel já sabe). */
  confirmadoAte: number | null;
  /** Quando foi a última escrita de confirmação (para o intervalo mínimo). */
  ultimaEscritaEm: number | null;
  agora: number;
  intervaloMs?: number;
}): boolean {
  const { maiorRecebidaEm, confirmadoAte, ultimaEscritaEm, agora } = args;
  if (maiorRecebidaEm === null || !Number.isFinite(maiorRecebidaEm)) return false;
  if (!Number.isFinite(agora)) return false;
  if (confirmadoAte !== null && Number.isFinite(confirmadoAte) && maiorRecebidaEm <= confirmadoAte) return false;

  const intervalo = args.intervaloMs ?? INTERVALO_MINIMO_MS;
  if (ultimaEscritaEm === null || !Number.isFinite(ultimaEscritaEm)) return true;
  return agora - ultimaEscritaEm >= intervalo;
}

// ───────────────────────── Marca do Zero DB (só neste aparelho) ─────────────────────────

/** No Zero DB não existe documento no servidor: a marca que o contato mandou pelo túnel fica aqui. */
export function lerMarcaLocal(arm: Armazenamento | null | undefined, uid: string, conversaId: string): number | null {
  if (!arm || !uid || !conversaId) return null;
  try {
    return instanteDe(arm.getItem(chaveDaMarcaLocal(uid, conversaId)));
  } catch {
    return null;
  }
}

/** Guarda a marca do contato. Nunca retrocede: uma marca mais velha chegando atrasada não desmarca o que já foi lido. */
export function salvarMarcaLocal(
  arm: Armazenamento | null | undefined,
  uid: string,
  conversaId: string,
  instante: unknown,
): number | null {
  const novo = instanteDe(instante);
  if (!arm || !uid || !conversaId || novo === null) return lerMarcaLocal(arm, uid, conversaId);
  const atual = lerMarcaLocal(arm, uid, conversaId);
  if (atual !== null && atual >= novo) return atual;
  try {
    arm.setItem(chaveDaMarcaLocal(uid, conversaId), new Date(novo).toISOString());
  } catch {
    return atual;
  }
  return novo;
}
