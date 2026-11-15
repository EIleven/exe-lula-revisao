import type { User as FirebaseUser } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

const refreshMembership = httpsCallable<unknown, { status: 'ok' }>(functions, 'refreshMembershipClaim');

/**
 * Repara a claim de contas antigas e renova o token que Firestore/Storage
 * leem. O servidor so concede a claim quando perfil e vaga existem.
 */
export async function ensureMembershipToken(user: FirebaseUser): Promise<void> {
  const token = await user.getIdTokenResult();
  if (token.claims.member !== true) {
    await refreshMembership();
    await user.getIdToken(true);
  }
}
