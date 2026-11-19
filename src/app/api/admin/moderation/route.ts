import { FieldValue } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
import { json, readJsonObject, requireCaller } from '@/lib/server/federation';
import { adminFirestore } from '@/lib/server/firebaseAdmin';

export const dynamic = 'force-dynamic';

async function requireModeratorOrAdmin(request: NextRequest, key: string) {
  const caller = await requireCaller(request, key, 60);
  if (caller instanceof Response) return caller;
  const db = adminFirestore();
  const userSnap = await db.collection('users').doc(caller.uid).get();
  const data = userSnap.data();
  if (!userSnap.exists || (data?.isAdmin !== true && data?.isModerator !== true)) {
    return json(403, { error: 'Apenas moderadores ou administradores podem executar esta ação.' });
  }
  return { uid: caller.uid, db };
}

export async function POST(request: NextRequest) {
  const auth = await requireModeratorOrAdmin(request, 'admin-moderation-post');
  if (auth instanceof Response) return auth;

  const body = await readJsonObject(request);
  if (!body) return json(400, { error: 'Corpo JSON inválido.' });

  const action = body.action === 'ignore' || body.action === 'remove' ? body.action : null;
  const reportId = typeof body.reportId === 'string' ? body.reportId.trim() : '';
  const contentType = body.contentType === 'post' || body.contentType === 'comment' ? body.contentType : null;
  const contentId = typeof body.contentId === 'string' ? body.contentId.trim() : '';
  const postId = typeof body.postId === 'string' ? body.postId.trim() : '';

  if (!action || !reportId) {
    return json(400, { error: 'Parâmetros action e reportId são obrigatórios.' });
  }

  try {
    if (action === 'remove') {
      if (!contentType || !contentId) {
        return json(400, { error: 'contentType e contentId são obrigatórios para remoção.' });
      }
      if (contentType === 'post') {
        const postRef = auth.db.collection('posts').doc(contentId);
        const postSnap = await postRef.get();
        if (postSnap.exists) {
          await postRef.update({
            isDeleted: true,
            text: '',
            media: [],
            deletedAt: FieldValue.serverTimestamp(),
            moderatedBy: auth.uid,
          });
        }
      } else if (contentType === 'comment') {
        if (!postId) {
          return json(400, { error: 'postId é obrigatório para remover comentário.' });
        }
        const commentRef = auth.db.collection('posts').doc(postId).collection('comments').doc(contentId);
        const commentSnap = await commentRef.get();
        if (commentSnap.exists) {
          await commentRef.delete();
        }
      }
    }

    await auth.db.collection('reports').doc(reportId).update({
      status: 'resolved',
      resolution: action,
      resolvedBy: auth.uid,
      resolvedAt: FieldValue.serverTimestamp(),
    });

    return json(200, { ok: true, reportId, action });
  } catch (err) {
    console.error('[api/admin/moderation POST]', err);
    return json(500, { error: 'Falha ao processar ação de moderação.' });
  }
}
