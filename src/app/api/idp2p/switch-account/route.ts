// src/app/api/idp2p/switch-account/route.ts
// Gerencia o vínculo criptográfico de múltiplas contas no mesmo dispositivo P2P:
// 1) register-device: emite um segredo de dispositivo (256 bits) para permitir troca rápida em 1 toque.
// 2) switch: valida o segredo do dispositivo e emite um customToken para alternar de conta em 1 toque.
// 3) unify-into-primary: quando o usuário entra com uma conta federada (Fediverso/Bluesky) num aparelho
//    que já tem uma conta principal validada, permite fundir o vínculo federado na conta principal.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
import { json, readJsonObject, requireCaller } from '@/lib/server/federation';
import { adminAuth, adminFirestore } from '@/lib/server/firebaseAdmin';
import { mintClientAuthCredential } from '@/lib/server/clientCredential';
import { evaluateRequestSecurity } from '@/lib/security/antiBotGuard';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');

function safeCompareHex(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const ip = requestIp(request);
  const guard = evaluateRequestSecurity({
    ip,
    path: '/api/idp2p/switch-account',
    method: 'POST',
    userAgent: request.headers.get('user-agent'),
    acceptLanguage: request.headers.get('accept-language'),
    isAuthenticated: Boolean(request.headers.get('authorization')),
  });
  if (!guard.allowed && guard.action === 'block') {
    return json(429, { error: 'bloqueio-anti-bot' }, { 'Retry-After': String(guard.retryAfterSec || 30) });
  }

  const body = await readJsonObject(request);
  if (!body) return json(400, { error: 'json-invalido' });

  const action = typeof body.action === 'string' ? body.action : '';
  const deviceId =
    typeof body.deviceId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(body.deviceId)
      ? body.deviceId
      : '';

  if (!deviceId) {
    return json(400, { error: 'device-id-invalido' });
  }

  const db = adminFirestore();

  if (action === 'register-device') {
    const caller = await requireCaller(request, 'idp2p-register-device', 60);
    if (caller instanceof Response) return caller;

    const existingSecret =
      typeof body.existingSecret === 'string' && body.existingSecret.length >= 32
        ? body.existingSecret
        : '';
    const switchSecret = existingSecret || randomBytes(32).toString('base64url');
    const secretHash = sha256Hex(switchSecret);
    const deviceLabel =
      typeof body.deviceLabel === 'string' ? body.deviceLabel.slice(0, 80) : 'Dispositivo';

    await db
      .collection('users')
      .doc(caller.uid)
      .collection('private')
      .doc('deviceSwitchTokens')
      .set(
        {
          [deviceId]: {
            secretHash,
            label: deviceLabel,
            updatedAt: FieldValue.serverTimestamp(),
          },
        },
        { merge: true }
      );

    return json(200, { ok: true, switchSecret });
  }

  if (action === 'switch') {
    if (!takeRateLimit(`idp2p-switch-ip:${ip}`, 20, 60_000)) {
      return json(429, { error: 'muitas-requisicoes' }, { 'Retry-After': '30' });
    }
    const targetUid = typeof body.targetUid === 'string' ? body.targetUid.trim() : '';
    const switchSecret = typeof body.switchSecret === 'string' ? body.switchSecret.trim() : '';
    if (
      !targetUid ||
      !/^[A-Za-z0-9_-]{4,128}$/.test(targetUid) ||
      switchSecret.length < 32 ||
      switchSecret.length > 256
    ) {
      return json(400, { error: 'parametros-obrigatorios' });
    }
    if (!takeRateLimit(`idp2p-switch-target:${targetUid}`, 10, 60_000)) {
      return json(429, { error: 'muitas-requisicoes' }, { 'Retry-After': '30' });
    }

    const tokenDoc = await db
      .collection('users')
      .doc(targetUid)
      .collection('private')
      .doc('deviceSwitchTokens')
      .get();

    const entry = tokenDoc.exists
      ? (tokenDoc.data()?.[deviceId] as { secretHash?: string } | undefined)
      : undefined;

    if (!entry?.secretHash || !safeCompareHex(entry.secretHash, sha256Hex(switchSecret))) {
      return json(403, { error: 'dispositivo-nao-autorizado' });
    }

    const [authUser, userDoc] = await Promise.all([
      adminAuth().getUser(targetUid).catch(() => null),
      db.collection('users').doc(targetUid).get(),
    ]);
    if (!authUser || authUser.disabled || !userDoc.exists) {
      return json(403, { error: 'conta-indisponivel' });
    }
    const userData = userDoc.data() as { federatedLoginProvider?: string } | undefined;
    const isFederated = Boolean(userData?.federatedLoginProvider);
    const isMember = Boolean(authUser.emailVerified || isFederated);

    const cred = await mintClientAuthCredential(targetUid, {
      member: isMember,
      ...(isFederated ? { federatedVerified: true } : {}),
    });
    return json(200, { ok: true, ...cred });
  }

  if (action === 'unify-into-primary') {
    const caller = await requireCaller(request, 'idp2p-unify', 30);
    if (caller instanceof Response) return caller;

    const secondaryUid = caller.uid;
    const primaryUid = typeof body.primaryUid === 'string' ? body.primaryUid.trim() : '';
    const primarySwitchSecret =
      typeof body.primarySwitchSecret === 'string' ? body.primarySwitchSecret.trim() : '';

    if (!primaryUid || !primarySwitchSecret || primaryUid === secondaryUid) {
      return json(400, { error: 'contas-invalidas' });
    }

    // Confere se o aparelho realmente detém a chave da conta principal
    const primaryTokenDoc = await db
      .collection('users')
      .doc(primaryUid)
      .collection('private')
      .doc('deviceSwitchTokens')
      .get();
    const primaryEntry = primaryTokenDoc.exists
      ? (primaryTokenDoc.data()?.[deviceId] as { secretHash?: string } | undefined)
      : undefined;

    if (
      !primaryEntry?.secretHash ||
      !safeCompareHex(primaryEntry.secretHash, sha256Hex(primarySwitchSecret))
    ) {
      return json(403, { error: 'chave-conta-principal-invalida' });
    }

    const [primaryUserSnap, secondaryUserSnap] = await Promise.all([
      db.collection('users').doc(primaryUid).get(),
      db.collection('users').doc(secondaryUid).get(),
    ]);

    if (!primaryUserSnap.exists || !secondaryUserSnap.exists) {
      return json(404, { error: 'conta-nao-encontrada' });
    }

    const secData = secondaryUserSnap.data() || {};
    const fedProvider = secData.federatedLoginProvider as string | undefined;
    const fedHandle = secData.federatedLoginHandle as string | undefined;

    // 1. Transfere quaisquer federated_identities da conta secundária para a principal
    const fedIdentitiesSnap = await db
      .collection('federated_identities')
      .where('uid', '==', secondaryUid)
      .get();

    const batch = db.batch();
    for (const doc of fedIdentitiesSnap.docs) {
      batch.update(doc.ref, {
        uid: primaryUid,
        unifiedAt: FieldValue.serverTimestamp(),
      });
    }

    // 2. Registra o vínculo também em users/{primaryUid}/idp2p_links
    if (fedHandle) {
      const linkId = `${fedProvider || 'mastodon'}_${sha256Hex(fedHandle).slice(0, 16)}`;
      batch.set(
        db.collection('users').doc(primaryUid).collection('idp2p_links').doc(linkId),
        {
          id: linkId,
          provider: fedProvider === 'bluesky' ? 'bluesky' : 'mastodon',
          handle: fedHandle,
          trustLevel: 'verified_oauth',
          linkedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }

    await batch.commit();

    // Se a conta secundária tinha 0 posts e foi criada há pouco só pelo login OAuth, remove o cartão duplicado
    const secPosts = typeof secData.postsCount === 'number' ? secData.postsCount : 0;
    let removedUid: string | undefined;
    if (secPosts === 0 && fedProvider) {
      if (typeof secData.username === 'string' && secData.username) {
        await db
          .collection('usernames')
          .doc(secData.username.toLowerCase())
          .delete()
          .catch(() => null);
      }
      await db.collection('users').doc(secondaryUid).delete().catch(() => null);
      removedUid = secondaryUid;
    }

    const cred = await mintClientAuthCredential(primaryUid, {
      member: true,
      federatedVerified: true,
    });

    return json(200, { ok: true, removedUid, ...cred });
  }

  return json(400, { error: 'acao-invalida' });
}

