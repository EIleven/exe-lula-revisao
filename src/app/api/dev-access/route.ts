// src/app/api/dev-access/route.ts
// Solicitações de acesso ao repositório privado de revisão (echo-review) + notificação in-app para admins.
import { FieldValue } from 'firebase-admin/firestore';
import type { NextRequest } from 'next/server';
import { adminFirestore } from '@/lib/server/firebaseAdmin';
import { identify, json, readJsonObject } from '@/lib/server/federation';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';
import { evaluateRequestSecurity } from '@/lib/security/antiBotGuard';

export const dynamic = 'force-dynamic';

const COLLECTION = 'dev_access_requests';
const GITHUB_HANDLE_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

interface DevAccessRequestDoc {
  id?: string;
  uid?: string | null;
  requesterUsername?: string;
  requesterName?: string;
  githubHandle: string;
  contactEmail?: string;
  focusArea: string;
  reason: string;
  acceptedTerms: boolean;
  termsVersion: string;
  status: 'pending' | 'approved' | 'rejected';
  adminNote?: string;
  reviewedBy?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

function serializeTimestamp(val: unknown): string {
  if (!val) return new Date(0).toISOString();
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val !== null && 'toDate' in val && typeof (val as { toDate?: unknown }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  return new Date().toISOString();
}

async function isAdminUid(uid: string): Promise<boolean> {
  const snap = await adminFirestore().collection('users').doc(uid).get();
  if (!snap.exists) return false;
  return Boolean((snap.data() as { isAdmin?: boolean } | undefined)?.isAdmin);
}

export async function GET(request: NextRequest) {
  const caller = await identify(request);
  if (!caller) return json(401, { error: 'nao-autenticado' });

  const db = adminFirestore();
  const admin = await isAdminUid(caller.uid);

  const snap = admin
    ? await db.collection(COLLECTION).orderBy('createdAt', 'desc').limit(50).get()
    : await db.collection(COLLECTION).where('uid', '==', caller.uid).limit(10).get();

  const items = snap.docs
    .map((d) => {
      const data = d.data() as DevAccessRequestDoc;
      return {
        id: d.id,
        uid: data.uid ?? null,
        requesterUsername: data.requesterUsername || '',
        requesterName: data.requesterName || '',
        githubHandle: data.githubHandle || '',
        contactEmail: data.contactEmail || '',
        focusArea: data.focusArea || '',
        reason: data.reason || '',
        status: data.status || 'pending',
        adminNote: data.adminNote || '',
        createdAt: serializeTimestamp(data.createdAt),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return json(200, { isAdmin: admin, items });
}

export async function POST(request: NextRequest) {
  const ip = requestIp(request);
  const guard = evaluateRequestSecurity({
    ip,
    path: '/api/dev-access',
    userAgent: request.headers.get('user-agent'),
    acceptLanguage: request.headers.get('accept-language'),
  });
  if (!guard.allowed && guard.action === 'block') {
    return json(429, { error: 'bloqueio-anti-bot', message: 'Acesso temporariamente bloqueado.' }, { 'Retry-After': String(guard.retryAfterSec || 30) });
  }
  if (!takeRateLimit(`dev-access:${ip}`, 8, 15 * 60_000)) {
    return json(429, { error: 'rate-limit', message: 'Muitas solicitações. Aguarde alguns minutos.' });
  }

  const caller = await identify(request);
  const body = await readJsonObject(request);
  if (!body) return json(400, { error: 'json-invalido', message: 'Corpo da requisição inválido.' });

  const githubHandle = String(body.githubHandle ?? '').trim().replace(/^@/, '');
  const contactEmail = String(body.contactEmail ?? '').trim().slice(0, 120);
  const focusArea = String(body.focusArea ?? 'Geral / Auditoria').trim().slice(0, 80);
  const reason = String(body.reason ?? '').trim().slice(0, 800);
  const acceptedTerms = body.acceptedTerms === true;

  if (!acceptedTerms) {
    return json(400, {
      error: 'termo-obrigatorio',
      message: 'Você precisa aceitar o Termo de Confidencialidade e Licença Restrita antes de solicitar acesso.',
    });
  }
  if (!GITHUB_HANDLE_RE.test(githubHandle)) {
    return json(400, {
      error: 'github-invalido',
      message: 'Informe um @usuario válido do GitHub (sem espaços ou URL).',
    });
  }
  if (reason.length < 15) {
    return json(400, {
      error: 'motivo-curto',
      message: 'Descreva brevemente o que pretende analisar ou contribuir (mínimo 15 caracteres).',
    });
  }

  const db = adminFirestore();
  let requesterUsername = '';
  let requesterName = githubHandle;
  let requesterAvatar = '';

  if (caller?.uid) {
    const userSnap = await db.collection('users').doc(caller.uid).get();
    if (userSnap.exists) {
      const u = userSnap.data() as { username?: string; name?: string; avatarUrl?: string };
      requesterUsername = u.username || '';
      requesterName = u.name || u.username || githubHandle;
      requesterAvatar = u.avatarUrl || '';
    }
  }

  const docRef = db.collection(COLLECTION).doc();
  await docRef.set({
    uid: caller?.uid ?? null,
    requesterUsername,
    requesterName,
    githubHandle,
    contactEmail,
    focusArea,
    reason,
    acceptedTerms: true,
    termsVersion: '2026-11-15',
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Notifica os administradores dentro do próprio HiperVerso
  const adminsSnap = await db.collection('users').where('isAdmin', '==', true).limit(10).get();
  if (!adminsSnap.empty) {
    const batch = db.batch();
    const who = requesterUsername ? `@${requesterUsername} (GitHub @${githubHandle})` : `GitHub @${githubHandle}`;
    const previewText = `[DEV] ${who} solicitou acesso ao repositório hiperverso (${focusArea}).`;

    for (const adminDoc of adminsSnap.docs) {
      const notifRef = db.collection('notifications').doc();
      batch.set(notifRef, {
        recipientId: adminDoc.id,
        type: 'welcome',
        actors: [
          {
            id: caller?.uid || `dev_${docRef.id}`,
            name: requesterName,
            username: requesterUsername || githubHandle,
            avatarUrl: requesterAvatar,
          },
        ],
        count: 1,
        entityId: docRef.id,
        entityType: 'user',
        previewText,
        createdAt: FieldValue.serverTimestamp(),
        readAt: null,
      });
    }
    await batch.commit();
  }

  return json(201, {
    ok: true,
    id: docRef.id,
    status: 'pending',
    message: 'Solicitação enviada! Os administradores foram notificados no HiperVerso.',
  });
}

export async function PATCH(request: NextRequest) {
  const caller = await identify(request);
  if (!caller) return json(401, { error: 'nao-autenticado' });
  if (!(await isAdminUid(caller.uid))) {
    return json(403, { error: 'proibido', message: 'Apenas administradores podem revisar solicitações.' });
  }

  const body = await readJsonObject(request);
  if (!body) return json(400, { error: 'json-invalido' });

  const id = String(body.id ?? '').trim();
  const status = body.status === 'approved' ? 'approved' : body.status === 'rejected' ? 'rejected' : '';
  const adminNote = String(body.adminNote ?? '').trim().slice(0, 300);
  if (!id || !status) {
    return json(400, { error: 'parametros-invalidos' });
  }

  const db = adminFirestore();
  const ref = db.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return json(404, { error: 'nao-encontrado' });

  const data = snap.data() as DevAccessRequestDoc;
  await ref.update({
    status,
    adminNote,
    reviewedBy: caller.uid,
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (data.uid) {
    await db.collection('notifications').add({
      recipientId: data.uid,
      type: 'welcome',
      actors: [{ id: caller.uid, name: 'HiperVerso DEV', username: 'dev' }],
      count: 1,
      entityId: id,
      entityType: 'user',
      previewText:
        status === 'approved'
          ? `[DEV] Seu acesso ao repositório hiperverso (@${data.githubHandle}) foi aprovado!`
          : `[DEV] Sua solicitação ao repositório hiperverso foi recusada.${adminNote ? ` Motivo: ${adminNote}` : ''}`,
      createdAt: FieldValue.serverTimestamp(),
      readAt: null,
    });
  }

  return json(200, { ok: true, id, status });
}

