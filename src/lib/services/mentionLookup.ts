// src/lib/services/mentionLookup.ts
// Resolve @usuario -> cartão público pelo índice usernames/{nome em minúsculas} (leitura pública, documento a documento).
// Listar a coleção users exige login, então este é o caminho que funciona também para quem lê sem conta.
import { db } from '@/lib/firebase';
import { doc, getDoc, Timestamp } from 'firebase/firestore';
import type { User } from '@/lib/types';
import { stripPrivateFields } from './userPrivate';

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const MAX_LOOKUPS_PER_CALL = 30;
const cache = new Map<string, { at: number; user: Promise<User | null> }>();

async function fetchByUsername(usernameLower: string): Promise<User | null> {
  const indexSnap = await getDoc(doc(db, 'usernames', usernameLower));
  const userId = indexSnap.exists() ? indexSnap.data().userId : null;
  if (typeof userId !== 'string' || !userId) return null;
  const userSnap = await getDoc(doc(db, 'users', userId));
  if (!userSnap.exists()) return null;
  const data = userSnap.data();
  for (const key of ['createdAt', 'updatedAt']) {
    if (data[key] instanceof Timestamp) data[key] = data[key].toDate().toISOString();
  }
  return stripPrivateFields({ id: userSnap.id, ...data } as User);
}

/** Devolve os perfis encontrados, indexados pelo @ em minúsculas. Nomes inexistentes simplesmente não aparecem. */
export async function lookupUsersByUsername(usernames: string[]): Promise<Map<string, User>> {
  const unique = [...new Set(usernames.map((name) => name.toLowerCase()))].slice(0, MAX_LOOKUPS_PER_CALL);
  const now = Date.now();
  if (cache.size > CACHE_MAX_ENTRIES) cache.clear();

  const found = await Promise.all(unique.map(async (name) => {
    const hit = cache.get(name);
    if (hit && now - hit.at < CACHE_TTL_MS) return [name, await hit.user] as const;
    const user = fetchByUsername(name).catch(() => {
      cache.delete(name); // falha de rede não fica guardada como "não existe"
      return null;
    });
    cache.set(name, { at: now, user });
    return [name, await user] as const;
  }));

  const result = new Map<string, User>();
  for (const [name, user] of found) {
    if (user) result.set(name, user);
  }
  return result;
}
