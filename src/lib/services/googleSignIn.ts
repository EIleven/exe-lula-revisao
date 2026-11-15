// src/lib/services/googleSignIn.ts
// Login com Google. No navegador usa o popup do Firebase. Dentro do app Android (WebView do Capacitor) o popup não
// funciona: o Google bloqueia OAuth em WebView e o window.open do Firebase é cancelado (auth/cancelled-popup-request).
// Por isso, no app, o seletor de contas é o NATIVO do Android (plugin @capacitor-firebase/authentication, com
// skipNativeAuth) e o JavaScript entra no Firebase com o idToken, via signInWithCredential.
import { auth } from '../firebase';
import { isNativeApp } from '../nativeApp';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential,
  reauthenticateWithPopup,
  reauthenticateWithCredential,
  type AuthCredential,
  type User as FirebaseUser,
} from 'firebase/auth';

/** Cancelamento pelo usuário, tanto do popup (web) quanto do seletor nativo. */
export const isGoogleSignInCancelled = (error: unknown): boolean => {
  const e = (error ?? {}) as { code?: string; message?: string };
  return (
    e.code === 'auth/popup-closed-by-user' ||
    e.code === 'auth/cancelled-popup-request' ||
    /cancel/i.test(String(e.message ?? ''))
  );
};

async function nativeGoogleCredential(): Promise<AuthCredential> {
  // Importado só no app: o navegador nunca baixa o plugin.
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
  const result = await FirebaseAuthentication.signInWithGoogle();
  const idToken = result.credential?.idToken;
  if (!idToken) throw new Error('O Google não devolveu a credencial de login.');
  // Encerra a conta no Google Sign-In nativo para que o próximo login volte a mostrar o seletor de contas.
  await FirebaseAuthentication.signOut().catch(() => undefined);
  return GoogleAuthProvider.credential(idToken, result.credential?.accessToken);
}

export async function signInWithGoogleAccount(): Promise<FirebaseUser> {
  if (isNativeApp()) {
    const credential = await nativeGoogleCredential();
    return (await signInWithCredential(auth, credential)).user;
  }
  return (await signInWithPopup(auth, new GoogleAuthProvider())).user;
}

export async function reauthenticateWithGoogleAccount(user: FirebaseUser): Promise<void> {
  if (isNativeApp()) {
    await reauthenticateWithCredential(user, await nativeGoogleCredential());
    return;
  }
  await reauthenticateWithPopup(user, new GoogleAuthProvider());
}
