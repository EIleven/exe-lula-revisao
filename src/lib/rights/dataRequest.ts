// src/lib/rights/dataRequest.ts
// Núcleo do canal de atendimento ao titular. Lógica pura: sem navegador, sem React, sem Firestore — o
// `npm run e2e:direitos` exercita tudo isto sem app nem emuladores.
//
// Princípio que manda aqui: **nenhuma coleta a mais para "parecer seguro"**. O canal pede o tipo de pedido e, se a
// pessoa quiser, uma descrição. Nada de CPF, documento, selfie ou KYC.

/** Prazo de resposta ao titular (LGPD, art. 19). */
export const DATA_REQUEST_DEADLINE_DAYS = 15;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Os três níveis de garantia que existem — e a diferença entre eles é o ponto desta seção.
 *
 * - `conta-autenticada`: a pessoa está logada. Prova que **controla a conta**, nada além disso.
 * - `email-confirmado`: o endereço foi confirmado por link. Prova que **controla a caixa de e-mail**.
 * - `senha-reconfirmada`: a senha foi pedida de novo na hora da ação. Protege contra sessão esquecida aberta.
 *
 * O que NÃO existe nesta plataforma: verificação de **identidade civil**. Não pedimos documento, não conferimos
 * nome contra registro público e não fazemos biometria. Por isso nenhum texto da rede pode afirmar que "verificamos
 * sua identidade": verificamos controle de conta e de e-mail, que é o proporcional ao risco de um pedido de dados.
 * Confundir as três coisas é o erro que esta constante existe para impedir.
 */
export type IdentityAssurance = 'conta-autenticada' | 'email-confirmado' | 'senha-reconfirmada';

/** A plataforma nunca exige identidade civil para exercer direito de titular. */
export const CIVIL_IDENTITY_NEVER_REQUIRED = true;

export type DataRequestKind =
  | 'confirmacao-e-acesso'
  | 'correcao'
  | 'exclusao'
  | 'portabilidade'
  | 'compartilhamento'
  | 'revogacao-consentimento'
  | 'oposicao';

export const DATA_REQUEST_KINDS: readonly DataRequestKind[] = [
  'confirmacao-e-acesso',
  'correcao',
  'exclusao',
  'portabilidade',
  'compartilhamento',
  'revogacao-consentimento',
  'oposicao',
];

export type DataRequestStatus = 'recebido' | 'em-analise' | 'respondido' | 'recusado';

export const DATA_REQUEST_STATUSES: readonly DataRequestStatus[] = [
  'recebido',
  'em-analise',
  'respondido',
  'recusado',
];

/**
 * Alguns direitos a pessoa já exerce sozinha, na própria interface, sem abrir pedido nenhum. Mandar essas pessoas
 * para uma fila de atendimento seria burocracia inventada — então o canal avisa e oferece o atalho.
 */
export const SELF_SERVICE_HINT: Partial<Record<DataRequestKind, 'exportar' | 'excluir-conta' | 'preferencias'>> = {
  portabilidade: 'exportar',
  'confirmacao-e-acesso': 'exportar',
  exclusao: 'excluir-conta',
  'revogacao-consentimento': 'preferencias',
};

/** O que basta para aceitar cada tipo de pedido. Nunca inclui identidade civil. */
export function assuranceRequiredFor(kind: DataRequestKind): IdentityAssurance {
  // Exclusão e correção mudam ou apagam dado: vale pedir a senha de novo, contra sessão esquecida aberta.
  if (kind === 'exclusao' || kind === 'correcao') return 'senha-reconfirmada';
  return 'conta-autenticada';
}

/** Quando a resposta é devida. */
export function dueDateMillis(createdAtMs: number): number {
  return createdAtMs + DATA_REQUEST_DEADLINE_DAYS * DAY_MS;
}

/** Dias restantes (negativo = atrasado). Arredonda para baixo: 1,9 dia restante é "1 dia". */
export function daysRemaining(createdAtMs: number, nowMs: number): number {
  return Math.floor((dueDateMillis(createdAtMs) - nowMs) / DAY_MS);
}

export function isOverdue(createdAtMs: number, nowMs: number): boolean {
  return nowMs > dueDateMillis(createdAtMs);
}

/** Status que ainda esperam ação do controlador. */
export function isOpen(status: DataRequestStatus): boolean {
  return status === 'recebido' || status === 'em-analise';
}

const PROTOCOL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem I, O, 0 e 1: evita erro ao ditar por telefone

/**
 * Protocolo legível, derivado do id do documento. Determinístico de propósito: o mesmo pedido sempre mostra o mesmo
 * protocolo, sem precisar de um campo a mais no banco nem de uma Function para gerar número sequencial.
 *
 * Não é segredo e não autoriza nada — serve para a pessoa falar "meu pedido SOB-XXXXXX" e para o atendimento achar.
 */
export function protocolFor(requestId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < requestId.length; i++) {
    hash ^= requestId.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += PROTOCOL_ALPHABET[hash % PROTOCOL_ALPHABET.length];
    hash = Math.floor(hash / PROTOCOL_ALPHABET.length) || (hash ^ (i + 1) * 2654435761) >>> 0;
  }
  return `SOB-${code}`;
}

export const DATA_REQUEST_MESSAGE_MAX = 2000;

export interface DataRequestDraft {
  kind: string;
  message?: string;
}

export type DataRequestValidation =
  | { ok: true; kind: DataRequestKind; message: string }
  | { ok: false; reason: 'tipo-invalido' | 'mensagem-longa' };

/**
 * Valida o que a pessoa escreveu. A mensagem é **opcional**: exigir justificativa para exercer um direito seria
 * criar obstáculo onde a lei não criou.
 */
export function validateDataRequest(draft: DataRequestDraft): DataRequestValidation {
  if (!DATA_REQUEST_KINDS.includes(draft.kind as DataRequestKind)) {
    return { ok: false, reason: 'tipo-invalido' };
  }
  const message = (draft.message ?? '').trim();
  if (message.length > DATA_REQUEST_MESSAGE_MAX) return { ok: false, reason: 'mensagem-longa' };
  return { ok: true, kind: draft.kind as DataRequestKind, message };
}

/**
 * O registro mínimo que vai ao banco. Deliberadamente curto: quem pediu (uid, que já temos), o que pediu, quando, o
 * estado e, se a pessoa quis, o texto dela. Não guarda IP, navegador, nem documento nenhum.
 */
export interface DataRequestRecord {
  userId: string;
  kind: DataRequestKind;
  message: string;
  status: DataRequestStatus;
  /** Em que nível de garantia o pedido foi aceito — para o registro poder ser auditado depois. */
  assurance: IdentityAssurance;
}

export function buildDataRequestRecord(
  userId: string,
  kind: DataRequestKind,
  message: string,
): DataRequestRecord {
  return {
    userId,
    kind,
    message,
    status: 'recebido',
    assurance: assuranceRequiredFor(kind),
  };
}
