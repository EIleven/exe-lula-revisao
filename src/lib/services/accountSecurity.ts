// src/lib/services/accountSecurity.ts
// Segurança da conta: recuperação de senha, verificação de e-mail e verificação em duas etapas por app autenticador
// (TOTP: Google Authenticator, Microsoft Authenticator, Authy, 1Password...). Não há segundo fator por SMS.
// O TOTP exige o Firebase Authentication com Identity Platform e e-mail verificado.
import { auth } from '@/lib/firebase';
import { siteConfig } from '@/config/site';
import {
  EmailAuthProvider,
  TotpMultiFactorGenerator,
  getMultiFactorResolver,
  multiFactor,
  reauthenticateWithCredential,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  type MultiFactorError,
  type MultiFactorResolver,
  type TotpSecret,
  type User as FirebaseUser,
  type UserCredential,
} from 'firebase/auth';
import { reauthenticateWithGoogleAccount } from './googleSignIn';
import {
  buildActionCodeSettings,
  localeFromPath,
  normalizeLocale,
  type AuthorizedDestination,
} from '@/lib/auth/actionLinks';

/** Idioma do e-mail: o que a tela informar, ou o da navegação atual. */
const emailLocale = (locale?: string) => normalizeLocale(locale ?? localeFromPath());

/** Sempre a origem OFICIAL: `baseUrl` pode apontar para localhost em desenvolvimento, e link de e-mail não volta. */
const actionSettings = (locale: string | undefined, destination: AuthorizedDestination) =>
  buildActionCodeSettings(emailLocale(locale), destination, siteConfig.officialOrigin);

const ISSUER = 'Exe. Lula';

const requireUser = (): FirebaseUser => {
  const user = auth.currentUser;
  if (!user) throw new Error('Entre na sua conta para continuar.');
  return user;
};

/** Envia o link de nova senha. Não diz se o e-mail tem conta (a resposta é a mesma), para não revelar quem usa a rede. */
export async function requestPasswordReset(email: string, locale?: string): Promise<void> {
  try {
    auth.languageCode = emailLocale(locale);
    // O link volta para /{idioma}/auth/action no domínio oficial, e de lá para o login.
    await sendPasswordResetEmail(auth, email.trim(), actionSettings(locale, 'login'));
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'auth/user-not-found') return;
    if (code === 'auth/invalid-email') throw new Error('E-mail inválido.');
    if (code === 'auth/too-many-requests') throw new Error('Muitas tentativas. Tente de novo mais tarde.');
    throw new Error('Não foi possível enviar o e-mail agora. Tente de novo.');
  }
}

export async function sendAccountVerificationEmail(
  locale?: string,
  destination: AuthorizedDestination = 'home',
): Promise<void> {
  try {
    auth.languageCode = emailLocale(locale);
    await sendEmailVerification(requireUser(), actionSettings(locale, destination));
  } catch (error) {
    if ((error as { code?: string }).code === 'auth/too-many-requests') {
      throw new Error('Já enviamos um e-mail há pouco. Confira a caixa de entrada e o spam.');
    }
    throw error;
  }
}

/**
 * Relê a conta no servidor (depois de clicar no link do e-mail) e diz se o e-mail já está verificado.
 *
 * O `getIdToken(true)` não é enfeite: as regras do Firestore e do Storage leem `email_verified` **do token**, e o
 * token em memória continua dizendo `false` até ser renovado. Sem esta linha, a pessoa confirma o e-mail e as
 * escritas continuam sendo negadas — com a interface já mostrando "confirmado".
 */
export async function refreshEmailVerified(): Promise<boolean> {
  const user = requireUser();
  await reload(user);
  if (user.emailVerified) await user.getIdToken(true);
  return user.emailVerified;
}

// --- Verificação em duas etapas (TOTP) ---

export const isTotpEnrolled = (user: FirebaseUser | null): boolean =>
  !!user && multiFactor(user).enrolledFactors.some((factor) => factor.factorId === TotpMultiFactorGenerator.FACTOR_ID);

export type TotpEnrollment = { secret: TotpSecret; otpauthUri: string; secretKey: string };

/** Primeiro passo: gera o segredo que o app autenticador vai guardar (por QR code ou digitando a chave). */
export async function startTotpEnrollment(): Promise<TotpEnrollment> {
  const user = requireUser();
  if (!user.emailVerified) throw new Error('Verifique o seu e-mail antes de ativar a verificação em duas etapas.');
  const session = await multiFactor(user).getSession();
  const secret = await TotpMultiFactorGenerator.generateSecret(session);
  return { secret, otpauthUri: secret.generateQrCodeUrl(user.email ?? user.uid, ISSUER), secretKey: secret.secretKey };
}

/** Segundo passo: o código de 6 dígitos que o app mostra prova que ele guardou o segredo. */
export async function finishTotpEnrollment(enrollment: TotpEnrollment, code: string): Promise<void> {
  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(enrollment.secret, code.replace(/\s/g, ''));
  await multiFactor(requireUser()).enroll(assertion, 'App autenticador');
}

export async function disableTotp(): Promise<void> {
  const user = requireUser();
  const factor = multiFactor(user).enrolledFactors.find((f) => f.factorId === TotpMultiFactorGenerator.FACTOR_ID);
  if (factor) await multiFactor(user).unenroll(factor);
}

// --- Entrar com o segundo fator ---

export const isMultiFactorRequired = (error: unknown): boolean =>
  (error as { code?: string })?.code === 'auth/multi-factor-auth-required';

export const getTotpResolver = (error: unknown): MultiFactorResolver =>
  getMultiFactorResolver(auth, error as MultiFactorError);

/** Conclui a entrada (ou a reautenticação) com o código do app autenticador. */
export async function resolveTotpSignIn(resolver: MultiFactorResolver, code: string): Promise<UserCredential> {
  const hint = resolver.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
  if (!hint) throw new Error('Esta conta não tem app autenticador cadastrado.');
  const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code.replace(/\s/g, ''));
  return resolver.resolveSignIn(assertion);
}

/** Mensagem clara para os erros comuns do segundo fator. */
export function describeSecondFactorError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code === 'auth/invalid-verification-code') return 'Código incorreto. Confira o app autenticador e tente de novo.';
  if (code === 'auth/code-expired' || code === 'auth/totp-challenge-timeout') return 'O tempo acabou. Comece de novo.';
  if (code === 'auth/too-many-requests') return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
  if (code === 'auth/unverified-email') return 'Verifique o seu e-mail antes de ativar a verificação em duas etapas.';
  if (code === 'auth/operation-not-allowed') return 'A verificação em duas etapas ainda não está disponível.';
  return (error as Error)?.message || 'Não foi possível concluir. Tente de novo.';
}

// --- Confirmar a identidade antes de mudar a segurança (o Firebase exige login recente) ---

export const requiresRecentLogin = (error: unknown): boolean =>
  (error as { code?: string })?.code === 'auth/requires-recent-login';

/** Como a pessoa entra: com senha ou com o Google. */
export const signInMethodOf = (user: FirebaseUser | null): 'password' | 'google' | null => {
  const providers = user?.providerData.map((p) => p.providerId) ?? [];
  if (providers.includes('password')) return 'password';
  if (providers.includes('google.com')) return 'google';
  return null;
};

/**
 * Confirma a identidade de novo (senha ou Google). Se a conta tem app autenticador, o Firebase pede o código em
 * seguida: o erro auth/multi-factor-auth-required sobe e a tela resolve com resolveTotpSignIn.
 */
export async function reauthenticate(password?: string): Promise<void> {
  const user = requireUser();
  if (signInMethodOf(user) === 'password') {
    if (!password) throw new Error('Digite a sua senha.');
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email ?? '', password));
    return;
  }
  await reauthenticateWithGoogleAccount(user);
}
