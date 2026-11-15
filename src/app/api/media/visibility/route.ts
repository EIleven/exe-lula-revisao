// src/app/api/media/visibility/route.ts
// Fecha o caso que o token permanente deixava aberto: um post público que vira privado.
//
// O PROBLEMA: tornar o post privado mudava a visibilidade do POST, mas a mídia dele continuava acessível por dois
// caminhos — a rota pública `/m/<id>`, que lia `visibility: 'public'` do registro, e sobretudo a URL antiga do
// Storage, cujo token não se revoga ao editar nada. Quem tinha o link continuava vendo a imagem de um post que
// deixou de ser público.
//
// ESTA ROTA faz as duas coisas que faltavam, e nesta ordem: marca o registro como privado (a rota pública passa a
// responder 404) e **apaga o token** do objeto no Storage (a URL antiga deixa de conceder acesso). Sem o segundo
// passo o primeiro é decorativo.
//
// Usa o Admin SDK de propósito: apagar metadata de objeto e mudar visibilidade não são operações que o cliente deva
// poder fazer direto, e a regra do Firestore segue permitindo ao dono mexer apenas no tombstone.
import { NextResponse, type NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminBucket, adminFirestore } from '@/lib/server/firebaseAdmin';
import { requestIp, takeRateLimit, verifyRequestUser } from '@/lib/server/requestAuth';
import { isValidMediaId } from '@/lib/media/mediaId';

export const dynamic = 'force-dynamic';

const LIMITE = 60;
const JANELA_MS = 10 * 60 * 1000;
const MAX_IDS = 20;

type Visibilidade = 'public' | 'private';

export async function POST(request: NextRequest) {
  if (!takeRateLimit(`mediavis:${requestIp(request)}`, LIMITE, JANELA_MS)) {
    return NextResponse.json({ error: 'too-many-requests' }, { status: 429 });
  }

  const uid = await verifyRequestUser(request);
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const corpo = await request.json().catch(() => null);
  const visibility: Visibilidade = corpo?.visibility === 'public' ? 'public' : 'private';
  // `deleted: true` marca tombstone em vez de mudar visibilidade. Nos dois casos o token é revogado.
  const marcarRemovido = corpo?.deleted === true;
  const ids: unknown = corpo?.mediaIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) {
    return NextResponse.json({ error: 'invalid-request' }, { status: 400 });
  }
  const mediaIds = ids.filter((id): id is string => typeof id === 'string' && isValidMediaId(id));
  if (mediaIds.length === 0) return NextResponse.json({ error: 'invalid-request' }, { status: 400 });

  const db = adminFirestore();
  const bucket = adminBucket();
  let alterados = 0;
  let tokensRevogados = 0;
  const ignorados: string[] = [];

  for (const mediaId of mediaIds) {
    const ref = db.collection('media').doc(mediaId);
    const snapshot = await ref.get();
    if (!snapshot.exists) { ignorados.push(mediaId); continue; }
    const dados = snapshot.data() ?? {};

    // Só o dono mexe na própria mídia. Sem isto, qualquer conta tornaria privada a mídia de outra pessoa.
    if (dados.ownerUid !== uid) { ignorados.push(mediaId); continue; }

    if (marcarRemovido) {
      if (!dados.deletedAt) {
        await ref.update({ deletedAt: FieldValue.serverTimestamp() });
        alterados++;
      }
    } else if (dados.visibility !== visibility) {
      await ref.update({ visibility, visibilityChangedAt: FieldValue.serverTimestamp() });
      alterados++;
    }

    // Remover ou tornar privado exige revogar: é o token, e não o registro, que ainda concede acesso.
    // Idempotente: apagar metadata que já não existe não é erro.
    if ((marcarRemovido || visibility === 'private') && typeof dados.storagePath === 'string') {
      try {
        await bucket.file(dados.storagePath).setMetadata({
          metadata: { firebaseStorageDownloadTokens: null },
        });
        tokensRevogados++;
      } catch (error) {
        console.error('[media] falha ao revogar token de', dados.storagePath, error);
      }
    }
  }

  return NextResponse.json({ ok: true, alterados, tokensRevogados, ignorados: ignorados.length });
}
