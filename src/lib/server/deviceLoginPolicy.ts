// src/lib/server/deviceLoginPolicy.ts
// Regras PURAS do login por dispositivo conectado (sem Firebase nem Next): quantos pedidos uma conta aguenta ao mesmo tempo e
// quando um pedido novo substitui o antigo. Testadas em e2e/device-login-check.mjs.
//
// Por que existe: `startDeviceLoginChallenge` é público (quem quer entrar ainda não tem sessão) e cada pedido faz o aparelho da
// conta alvo tocar e mostrar um aviso. Sem teto por conta, qualquer pessoa podia lotar os aparelhos de alguém de pedidos de
// aprovação ("fadiga de aprovação": o dono, cansado, aprova o errado). O teto por IP existente (15/min) não protege a CONTA: são
// 900 pedidos por hora de um IP só, e mais de vários.

/** Pedidos pendentes de aparelhos DIFERENTES que uma conta aceita ao mesmo tempo. */
export const MAX_PENDING_PER_ACCOUNT = 3;
/** Pedidos por conta por hora (contando os que já foram respondidos ou venceram). */
export const MAX_STARTS_PER_ACCOUNT_PER_HOUR = 12;

export type PendingChallengeLite = {
  challengeId: string;
  requesterDeviceId: string;
  /** Resumo do IP de quem pediu (não é o IP): dois pedidos da mesma origem não somam dois "aparelhos". */
  requesterIpHash: string;
  createdAt: number;
  expiresAt: number;
};

export type NewChallengePlan =
  | { allow: true; supersede: string[] }
  | { allow: false; supersede: []; reason: 'too-many-pending' };

/**
 * O que fazer com os pedidos pendentes de uma conta quando chega um novo.
 *  - o MESMO aparelho (ou a mesma origem) pedindo de novo SUBSTITUI o anterior: quem fecha a aba e tenta outra vez não se
 *    bloqueia sozinho nem deixa dois avisos na tela de quem vai aprovar;
 *  - aparelhos/origens DIFERENTES somam, até o teto; passou dele, o pedido é recusado.
 */
export function planNewChallenge(
  pending: readonly PendingChallengeLite[],
  requester: { deviceId: string; ipHash: string },
  now: number,
): NewChallengePlan {
  const vivos = pending.filter((p) => p.expiresAt > now);
  const mesmaOrigem = (p: PendingChallengeLite) => p.requesterDeviceId === requester.deviceId || (requester.ipHash !== '' && p.requesterIpHash === requester.ipHash);
  const substituidos = vivos.filter(mesmaOrigem);
  const outros = vivos.filter((p) => !mesmaOrigem(p));
  if (outros.length >= MAX_PENDING_PER_ACCOUNT) return { allow: false, supersede: [], reason: 'too-many-pending' };
  return { allow: true, supersede: substituidos.map((p) => p.challengeId) };
}

/** A pessoa digitou o código certo? Só dígitos contam (o código aparece como "123 456"); qualquer outra coisa não casa. */
export function verificationCodeMatches(expected: string, typed: unknown): boolean {
  if (typeof typed !== 'string') return false;
  const a = expected.replace(/\D/g, '');
  const b = typed.replace(/\D/g, '');
  if (a.length !== 6 || b.length !== 6) return false;
  let diff = 0;
  for (let i = 0; i < 6; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
