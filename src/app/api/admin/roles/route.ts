import { FieldValue } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
import { json, readJsonObject, requireCaller } from '@/lib/server/federation';
import { adminFirestore } from '@/lib/server/firebaseAdmin';

export const dynamic = 'force-dynamic';

async function requireAdmin(request: NextRequest, key: string) {
  const caller = await requireCaller(request, key, 60);
  if (caller instanceof Response) return caller;
  const db = adminFirestore();
  const userSnap = await db.collection('users').doc(caller.uid).get();
  if (!userSnap.exists || userSnap.data()?.isAdmin !== true) {
    return json(403, { error: 'Apenas administradores podem gerenciar funções.' });
  }
  return { uid: caller.uid, db };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request, 'admin-roles-get');
  if (auth instanceof Response) return auth;

  try {
    const [adminsSnap, modsSnap] = await Promise.all([
      auth.db.collection('users').where('isAdmin', '==', true).limit(50).get(),
      auth.db.collection('users').where('isModerator', '==', true).limit(100).get(),
    ]);

    const byId = new Map<string, Record<string, unknown>>();
    for (const docSnap of [...adminsSnap.docs, ...modsSnap.docs]) {
      if (docSnap.id === 'adminUserSoberan') continue;
      if (byId.has(docSnap.id)) continue;
      const d = docSnap.data();
      byId.set(docSnap.id, {
        id: docSnap.id,
        name: typeof d.name === 'string' ? d.name : 'Usuário',
        username: typeof d.username === 'string' ? d.username : '',
        avatarUrl: typeof d.avatarUrl === 'string' ? d.avatarUrl : '',
        isAdmin: d.isAdmin === true,
        isModerator: d.isModerator === true,
        federatedHandle: typeof d.federatedHandle === 'string' ? d.federatedHandle : null,
      });
    }

    const staff = Array.from(byId.values()).sort((a, b) => {
      if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
      return String(a.name).localeCompare(String(b.name));
    });

    return json(200, { staff });
  } catch (err) {
    console.error('[api/admin/roles GET]', err);
    return json(500, { error: 'Falha ao carregar equipe de administração e moderação.' });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin(request, 'admin-roles-patch');
  if (auth instanceof Response) return auth;

  const body = await readJsonObject(request);
  if (!body) return json(400, { error: 'Corpo JSON inválido.' });

  const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId.trim() : '';
  const isAdmin = body.isAdmin === true;
  const isModerator = body.isModerator === true;

  if (!targetUserId) {
    return json(400, { error: 'targetUserId é obrigatório.' });
  }
  if (targetUserId.startsWith('ap_') || targetUserId.startsWith('bsky_')) {
    return json(400, { error: 'Contas externas federadas não podem receber funções internas da instância.' });
  }
  if (targetUserId === auth.uid && !isAdmin) {
    return json(400, { error: 'Você não pode remover seu próprio privilégio de administrador.' });
  }

  try {
    const targetRef = auth.db.collection('users').doc(targetUserId);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) {
      return json(404, { error: 'Usuário não encontrado.' });
    }

    await targetRef.update({
      isAdmin,
      isModerator,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return json(200, {
      ok: true,
      user: {
        id: targetUserId,
        isAdmin,
        isModerator,
      },
    });
  } catch (err) {
    console.error('[api/admin/roles PATCH]', err);
    return json(500, { error: 'Não foi possível atualizar as funções do usuário.' });
  }
}
