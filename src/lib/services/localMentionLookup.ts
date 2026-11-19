// src/lib/services/localMentionLookup.ts
// Acha uma pessoa DAQUI pelo @ exato, sem depender da caixa em que o `username` foi gravado.
//
// `searchUsers` compara o `username` com a consulta em MINÚSCULAS, e no Firestore as maiúsculas ordenam ANTES das minúsculas:
// `ExercitoDoLula` fica fora do intervalo ["exercitodolula", "exercitodolula"]. Quem tem maiúscula no @ (a conta oficial,
// as contas federadas) nunca aparecia. O índice `usernames/{minúsculas}` é o mesmo que o resto do app usa para resolver um @,
// e a regra libera `get` (um documento por vez, nunca listar).
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getUser } from '@/lib/services/userService';
import type { User } from '@/lib/types';

export async function findLocalUserByHandle(handle: string, activeUserId: string | null): Promise<User | null> {
  const chave = handle.trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{3,15}$/.test(chave)) return null;
  try {
    const snap = await getDoc(doc(db, 'usernames', chave));
    // Contas criadas por caminhos diferentes gravam o dono em `userId` (cadastro, conta oficial) ou em `uid` (login federado).
    const dados = snap.data() as { userId?: unknown; uid?: unknown } | undefined;
    const uid = typeof dados?.userId === 'string' && dados.userId ? dados.userId : typeof dados?.uid === 'string' ? dados.uid : '';
    if (!uid) return null;
    const user = await getUser(uid, activeUserId);
    return user && !user.isBlocked && !user.hasBlockedCurrentUser ? user : null;
  } catch {
    // Digitando, um erro passageiro não pode derrubar a lista: sem resultado exato, a busca por prefixo continua valendo.
    return null;
  }
}
