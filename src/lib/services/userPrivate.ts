// src/lib/services/userPrivate.ts
// Dados pessoais ficam FORA do perfil público. O perfil público (users/{uid}) é o "cartão" que qualquer pessoa vê:
// nome, @, foto, bio, contadores e as preferências que os outros precisam conhecer (dmPreference, allowTagging,
// profileVisibility). E-mail, data de nascimento e preferências pessoais ficam em users/{uid}/private/account,
// que só o dono (e as Cloud Functions) lê e grava. Antes tudo morava no mesmo documento e qualquer pessoa listava
// e-mail e data de nascimento de todos os usuários.
import { auth, db } from '@/lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

export const PRIVATE_USER_FIELDS = [
  'email',
  'dateOfBirth',
  'notificationPreferences',
  'mutedWords',
  'displaySensitiveContent',
  'tabPreferences',
  'totalUnreadMessages',
  'translationPreferences',
  'recommendationPreferences',
] as const;

export type PrivateUserField = (typeof PRIVATE_USER_FIELDS)[number];

const PRIVATE_SET = new Set<string>(PRIVATE_USER_FIELDS);

export const privateAccountRef = (uid: string) => doc(db, 'users', uid, 'private', 'account');

/** Separa um objeto de campos do usuário em parte pública e parte privada. */
export function splitUserFields(data: Record<string, unknown>): {
  publicData: Record<string, unknown>;
  privateData: Record<string, unknown>;
} {
  const publicData: Record<string, unknown> = {};
  const privateData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (PRIVATE_SET.has(key)) privateData[key] = value;
    else publicData[key] = value;
  }
  return { publicData, privateData };
}

/** Remove campos privados de um perfil (documentos antigos ainda podem tê-los até a migração). */
export function stripPrivateFields<T extends object>(user: T): T {
  const copy = { ...user } as Record<string, unknown>;
  for (const key of PRIVATE_USER_FIELDS) delete copy[key];
  return copy as T;
}

/** Lê os dados privados do próprio usuário (vazio se o documento ainda não existe). */
export async function getPrivateAccount(uid: string): Promise<Record<string, unknown>> {
  try {
    const snap = await getDoc(privateAccountRef(uid));
    return snap.exists() ? snap.data() : {};
  } catch (error) {
    console.error(`[userPrivate] Não foi possível ler os dados privados de ${uid}:`, String(error));
    return {};
  }
}

/** Grava (mescla) campos privados do próprio usuário. */
export async function savePrivateAccount(uid: string, data: Record<string, unknown>): Promise<void> {
  if (Object.keys(data).length === 0) return;
  await setDoc(privateAccountRef(uid), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

/**
 * Alinha o e-mail privado com o Firebase Auth depois de uma troca confirmada.
 *
 * O link de `verifyBeforeUpdateEmail` pode ser aberto em outro aparelho. Nesse caso o Auth passa a conhecer o endereço
 * novo e esta sessão só descobre no próximo login. A regra do Firestore aceita exclusivamente o e-mail presente no ID
 * token; portanto esta função não consegue gravar um endereço arbitrário.
 */
export async function reconcilePrivateEmail(): Promise<void> {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser?.email) return;
  try {
    const snapshot = await getDoc(privateAccountRef(firebaseUser.uid));
    if (!snapshot.exists() || snapshot.data()?.email === firebaseUser.email) return;
    await firebaseUser.getIdToken(true);
    await savePrivateAccount(firebaseUser.uid, { email: firebaseUser.email });
  } catch {
    // Offline, registro ausente ou regra ainda não atualizada: não bloqueia o login; a próxima sessão tenta de novo.
  }
}
