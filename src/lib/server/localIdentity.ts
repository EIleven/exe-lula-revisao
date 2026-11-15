// src/lib/server/localIdentity.ts
// Do handle do NOSSO domínio ao UID local. @Breno@exercitodolula.app e @Breno são a mesma pessoa: uma só conta, um só UID.
// Nunca importar em código do navegador.
import { normalizeHandle } from '@/lib/activitypub/identity';
import { adminFirestore } from '@/lib/server/firebaseAdmin';

/**
 * UID local de um handle do nosso domínio. O handle federado (`ap_handles/{handle}`) vale primeiro, porque é imutável e
 * reservado: se a pessoa trocar o @ daqui, `breno@exercitodolula.app` continua sendo ELA. Só sem handle federado cai no @
 * atual (`usernames/{handle}`), que é como o app já resolve uma menção a alguém daqui.
 */
export async function localUserIdOfHandle(handle: string | null | undefined): Promise<string | null> {
  const limpo = normalizeHandle(handle);
  if (!limpo) return null;
  const db = adminFirestore();
  const federado = await db.collection('ap_handles').doc(limpo).get();
  const uid = federado.data()?.uid;
  if (federado.exists && typeof uid === 'string' && uid) return uid;
  const usuario = await db.collection('usernames').doc(limpo).get();
  const dono = usuario.data()?.userId;
  return usuario.exists && typeof dono === 'string' && dono ? dono : null;
}
