import { FieldValue } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
import { json, readJsonObject, requireCaller } from '@/lib/server/federation';
import { adminFirestore } from '@/lib/server/firebaseAdmin';

export const dynamic = 'force-dynamic';

interface HiperChatConfig {
  enabled: boolean;
  allowFederatedDms: boolean;
  allowGroupCreation: boolean;
  maxGroupParticipants: number;
  notice: string;
}

const DEFAULT_CONFIG: HiperChatConfig = {
  enabled: true,
  allowFederatedDms: true,
  allowGroupCreation: true,
  maxGroupParticipants: 1000,
  notice: '',
};

async function requireAdmin(request: NextRequest, key: string) {
  const caller = await requireCaller(request, key, 60);
  if (caller instanceof Response) return caller;
  const db = adminFirestore();
  const userSnap = await db.collection('users').doc(caller.uid).get();
  if (!userSnap.exists || userSnap.data()?.isAdmin !== true) {
    return json(403, { error: 'Apenas administradores.' });
  }
  return { uid: caller.uid, db };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request, 'admin-hiperchat-get');
  if (auth instanceof Response) return auth;

  try {
    const [
      configSnap,
      sysConfigSnap,
      totalConvosAgg,
      groupConvosAgg,
      dmEveryoneAgg,
      dmFollowingAgg,
      dmNoneAgg,
      recentConvosSnap,
    ] = await Promise.all([
      auth.db.collection('_system').doc('hiperchat').get(),
      auth.db.collection('_system').doc('config').get(),
      auth.db.collection('conversations').count().get(),
      auth.db.collection('conversations').where('isGroup', '==', true).count().get(),
      auth.db.collection('users').where('dmPreference', '==', 'everyone').count().get(),
      auth.db.collection('users').where('dmPreference', '==', 'following').count().get(),
      auth.db.collection('users').where('dmPreference', '==', 'none').count().get(),
      auth.db.collection('conversations').orderBy('updatedAt', 'desc').limit(8).get(),
    ]);

    const rawCfg = (configSnap.exists ? configSnap.data() : {}) || {};
    const sysCfg = (sysConfigSnap.exists ? sysConfigSnap.data() : {}) || {};
    const config: HiperChatConfig = {
      enabled: rawCfg.enabled !== false,
      allowFederatedDms: rawCfg.allowFederatedDms !== false,
      allowGroupCreation: rawCfg.allowGroupCreation !== false,
      maxGroupParticipants:
        typeof rawCfg.maxGroupParticipants === 'number'
          ? rawCfg.maxGroupParticipants
          : typeof sysCfg.maxGroupParticipants === 'number'
            ? sysCfg.maxGroupParticipants
            : DEFAULT_CONFIG.maxGroupParticipants,
      notice: typeof rawCfg.notice === 'string' ? rawCfg.notice : '',
    };

    const totalConversations = totalConvosAgg.data().count;
    const groupConversations = groupConvosAgg.data().count;
    const directConversations = Math.max(0, totalConversations - groupConversations);

    const recentConversations = recentConvosSnap.docs.map((docSnap) => {
      const d = docSnap.data();
      return {
        id: docSnap.id,
        isGroup: d.isGroup === true,
        groupName: typeof d.groupName === 'string' ? d.groupName : null,
        participantsCount: Array.isArray(d.participantIds) ? d.participantIds.length : 0,
        isEncrypted: d.isEncrypted === true || d.p2pEnabled === true,
        updatedAt:
          d.updatedAt && typeof d.updatedAt.toDate === 'function'
            ? d.updatedAt.toDate().toISOString()
            : null,
      };
    });

    return json(200, {
      config,
      metrics: {
        totalConversations,
        directConversations,
        groupConversations,
        dmPreferences: {
          everyone: dmEveryoneAgg.data().count,
          following: dmFollowingAgg.data().count,
          none: dmNoneAgg.data().count,
        },
      },
      appRelease: {
        packageName: 'app.hiperverso.chat',
        versionName: '1.5.0',
        apkUrl: '/downloads/HiperChat-1.5.0.apk',
        sha256: '1418de06fdb047f6ab0c0293ddf6a1ed365d5f44cd7a34475e23ec0874fbe5f2',
      },
      recentConversations,
    });
  } catch (err) {
    console.error('[api/admin/hiperchat GET]', err);
    return json(500, { error: 'Falha ao carregar painel do HiperChat.' });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin(request, 'admin-hiperchat-patch');
  if (auth instanceof Response) return auth;

  const body = await readJsonObject(request);
  if (!body) return json(400, { error: 'Corpo JSON inválido.' });

  const enabled = body.enabled !== false;
  const allowFederatedDms = body.allowFederatedDms !== false;
  const allowGroupCreation = body.allowGroupCreation !== false;
  const maxGroupParticipants = Math.max(
    2,
    Math.min(5000, Number(body.maxGroupParticipants) || DEFAULT_CONFIG.maxGroupParticipants),
  );
  const notice = typeof body.notice === 'string' ? body.notice.trim().slice(0, 280) : '';

  try {
    await Promise.all([
      auth.db.collection('_system').doc('hiperchat').set(
        {
          enabled,
          allowFederatedDms,
          allowGroupCreation,
          maxGroupParticipants,
          notice,
          updatedBy: auth.uid,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      ),
      auth.db.collection('_system').doc('config').set(
        {
          maxGroupParticipants,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      ),
    ]);

    return json(200, {
      ok: true,
      config: { enabled, allowFederatedDms, allowGroupCreation, maxGroupParticipants, notice },
    });
  } catch (err) {
    console.error('[api/admin/hiperchat PATCH]', err);
    return json(500, { error: 'Falha ao salvar configurações do HiperChat.' });
  }
}
