// src/lib/activitypub/consentimentoDeDominio.ts
// Quando um servidor do Fediverso nos RECUSA, parar de insistir. Módulo PURO: sem Firebase, sem rede, sem DOM.
//
// ───────────────────────── Por que existe ─────────────────────────
// Já havia um disjuntor por domínio, mas ele media uma coisa só: se o servidor está DE PÉ. A regra era explícita —
// "só falha de infraestrutura conta; um 403 é recusa dele, não fora do ar". Correto para disponibilidade, e errado
// para consentimento: o 403 é justamente o servidor dizendo que não quer o que estamos mandando.
//
// O efeito disso aparecia de fora: uma instância nos desfedera e a nossa fila continua batendo na porta dela a cada
// post novo. Do lado de lá, isso não parece engenharia — parece desrespeito. E é.
//
// Aqui o 403 passa a ter consequência própria: recusas seguidas pausam a entrega para aquele domínio.
//
// ───────────────────────── Os dois cuidados ─────────────────────────
// 1. UMA PESSOA QUE BLOQUEIA NÃO PODE DERRUBAR O SERVIDOR INTEIRO. A entrega pode ir para a caixa pessoal de alguém,
//    e aí o 403 é daquela conta, não da instância. Por isso a contagem é de recusas CONSECUTIVAS: qualquer entrega
//    aceita naquele domínio zera o contador. Um único contato que nos bloqueia só derruba o domínio se for o único
//    contato que temos lá — que é exatamente o caso em que parar está certo.
//
// 2. PAUSA TEM PRAZO, E CRESCE. Nunca é definitiva: se foi engano nosso, ou se do outro lado mudaram de ideia, a
//    entrega volta sozinha. Banimento permanente decidido por heurística é o tipo de coisa que ninguém consegue
//    desfazer depois.

/** Recusas seguidas antes de pausar. Três é o bastante para não ser acidente e pouco para não ser insistência. */
export const LIMITE_DE_RECUSAS = 3;

/** A escada da pausa, em horas: 1 dia, 3 dias, 1 semana, 30 dias. Daí para a frente fica em 30 dias. */
export const ESCADA_DE_PAUSA_HORAS = [24, 72, 168, 720] as const;

export interface SaudeDoDominio {
  consecutiveRefusals?: number;
  refusedUntilMs?: number;
}

/** O 403 é a recusa: "eu sei quem você é e não quero". 401 é assinatura, 404 é rota, 5xx é queda — nenhum é recusa. */
export function ehRecusaDeConsentimento(status: number | null | undefined): boolean {
  return status === 403;
}

/** Quanto dura a pausa depois de `n` recusas seguidas (n ≥ LIMITE_DE_RECUSAS). */
export function horasDePausa(recusas: number): number {
  const degrau = Math.max(0, recusas - LIMITE_DE_RECUSAS);
  const i = Math.min(degrau, ESCADA_DE_PAUSA_HORAS.length - 1);
  return ESCADA_DE_PAUSA_HORAS[i];
}

/**
 * Uma entrega foi recusada (403). Devolve como fica a saúde do domínio.
 * Abaixo do limite não pausa nada: só conta.
 */
export function aposRecusa(saude: SaudeDoDominio | null | undefined, agora: number): Required<SaudeDoDominio> {
  const anteriores = Number.isFinite(saude?.consecutiveRefusals) ? Math.max(0, saude!.consecutiveRefusals!) : 0;
  const recusas = anteriores + 1;
  if (recusas < LIMITE_DE_RECUSAS) {
    return { consecutiveRefusals: recusas, refusedUntilMs: 0 };
  }
  return { consecutiveRefusals: recusas, refusedUntilMs: agora + horasDePausa(recusas) * 3_600_000 };
}

/** Uma entrega foi ACEITA naquele domínio: o que havia de recusa não vale mais. */
export function aposEntregaAceita(): Required<SaudeDoDominio> {
  return { consecutiveRefusals: 0, refusedUntilMs: 0 };
}

export type DecisaoDeConsentimento =
  | { pausado: false }
  | { pausado: true; ate: number; recusas: number };

/** Podemos entregar a este domínio agora? */
export function pausaDeConsentimento(
  saude: SaudeDoDominio | null | undefined,
  agora: number,
): DecisaoDeConsentimento {
  const ate = Number.isFinite(saude?.refusedUntilMs) ? saude!.refusedUntilMs! : 0;
  if (!ate || !Number.isFinite(agora) || ate <= agora) return { pausado: false };
  return { pausado: true, ate, recusas: Math.max(0, saude?.consecutiveRefusals ?? 0) };
}
