// src/lib/services/mediaVisibility.ts
// Mantém o registro `media/{id}` alinhado quando o conteúdo muda de visibilidade ou é removido pelo cliente.
//
// Duas operações, com mecanismos diferentes de propósito:
//
// - `tombstoneMediaDoc`: grava `deletedAt` direto pelo SDK. A regra do Firestore permite ao dono mexer **apenas**
//   nesse campo, e por isso não precisa de servidor. Usado quando o objeto já foi apagado do Storage — aí não há
//   token para revogar, porque não há objeto.
// - `setMediaVisibility`: passa pela rota de servidor, porque tornar privado exige **revogar o token** no Storage, e
//   isso só o Admin SDK faz. Sem revogar, fechar a nossa rota seria decorativo: a URL antiga continuaria abrindo.
'use client';

import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { isValidMediaId } from '@/lib/media/mediaId';

/** Marca a mídia como removida. Silencioso: é manutenção de consistência, não ação da pessoa. */
export async function tombstoneMediaDoc(mediaId: string | null | undefined): Promise<void> {
  if (!isValidMediaId(mediaId ?? '')) return;
  try {
    await updateDoc(doc(db, 'media', mediaId as string), { deletedAt: serverTimestamp() });
  } catch {
    // Registro já removido, sem permissão ou offline: o acesso já caiu porque o objeto foi apagado do Storage.
  }
}

/**
 * Troca a visibilidade e, ao virar privado, revoga o token do objeto. Devolve `true` se o servidor confirmou.
 *
 * Falhar aqui é relevante: significa que a mídia pode continuar acessível pela URL antiga. Quem chama deve avisar a
 * pessoa, e não engolir o erro.
 */
export async function setMediaVisibility(
  mediaIds: string[],
  visibility: 'public' | 'private',
): Promise<boolean> {
  const validos = mediaIds.filter((id) => isValidMediaId(id));
  if (validos.length === 0) return true;

  const user = auth.currentUser;
  if (!user) return false;

  try {
    const resposta = await fetch('/api/media/visibility', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: JSON.stringify({ mediaIds: validos, visibility }),
    });
    return resposta.ok;
  } catch {
    return false;
  }
}

/** Marca removida e revoga o token, pelo servidor. Para quando o objeto AINDA existe no Storage. */
export async function deleteMediaWithRevocation(mediaIds: string[]): Promise<boolean> {
  const validos = mediaIds.filter((id) => isValidMediaId(id));
  if (validos.length === 0) return true;

  const user = auth.currentUser;
  if (!user) return false;

  try {
    const resposta = await fetch('/api/media/visibility', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: JSON.stringify({ mediaIds: validos, deleted: true }),
    });
    return resposta.ok;
  } catch {
    return false;
  }
}
