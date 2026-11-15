// src/lib/services/signupLimit.ts
// Limite dos primeiros usuários, do lado do cliente. Quem IMPÕE o limite é o servidor (as Functions createUserProfile e
// claimGoogleProfile reservam a vaga numa transação, e as regras do Firestore fecham a criação direta de perfil): aqui
// nada conta vagas nem decide nada, só traduz a resposta do servidor para a tela.
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

/** Só para o texto, quando o servidor não informou o limite (é o número anunciado do programa, não um contador). */
export const DEFAULT_SIGNUP_LIMIT = 500;

/** O cadastro foi recusado porque as vagas iniciais acabaram. */
export class SignupClosedError extends Error {
  readonly code = 'signup-closed';
  readonly limit?: number;

  constructor(limit?: number) {
    super('Signup is closed: the initial spots have been filled.');
    this.name = 'SignupClosedError';
    this.limit = limit;
  }
}

/** O cadastro foi recusado porque o reCAPTCHA (App Check) não confirmou que é uma pessoa. */
export class HumanCheckError extends Error {
  readonly code = 'app-check';

  constructor() {
    super('Human check failed: the App Check token is missing.');
    this.name = 'HumanCheckError';
  }
}

type FunctionsErrorLike = { code?: unknown; details?: { reason?: unknown; limit?: unknown } } | null;

/** O erro é o de "vagas preenchidas" (da Function, ou já convertido em SignupClosedError)? */
export function isSignupClosed(error: unknown): boolean {
  if (error instanceof SignupClosedError) return true;
  const e = error as FunctionsErrorLike;
  return e?.code === 'functions/resource-exhausted' || e?.details?.reason === 'signup-closed';
}

/**
 * O servidor recusou porque o navegador não trouxe o token anti-robô (App Check): o reCAPTCHA não conseguiu confirmar que
 * é uma pessoa (script bloqueado por extensão, rede que filtra o Google, ou um robô).
 */
export function isAppCheckRequired(error: unknown): boolean {
  return error instanceof HumanCheckError || (error as FunctionsErrorLike)?.details?.reason === 'app-check';
}

/** Limite de vagas informado no erro do servidor (é a regra pública do programa, não um contador). */
export function signupClosedLimit(error: unknown): number | undefined {
  if (error instanceof SignupClosedError) return error.limit;
  const limit = (error as FunctionsErrorLike)?.details?.limit;
  return typeof limit === 'number' ? limit : undefined;
}

export type SignupStatus = { open: boolean; limit: number };

const signupStatusCallable = httpsCallable<unknown, SignupStatus>(functions, 'getSignupStatus');

/**
 * Situação do cadastro (aberto ou lotado), para a tela de cadastro avisar ANTES de a pessoa preencher o formulário.
 * Só informativo: o servidor confere de novo no envio. Devolve null se não deu para saber (não bloqueia a tela).
 */
export async function fetchSignupStatus(): Promise<SignupStatus | null> {
  try {
    return (await signupStatusCallable()).data;
  } catch {
    return null;
  }
}
