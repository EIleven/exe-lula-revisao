// Conexão da conta com o protocolo Matrix: salva @usuario:servidor.org no perfil e credenciais opcionais de sala.
import { FieldValue } from 'firebase-admin/firestore';
import type { NextRequest } from 'next/server';
import {
  isValidMatrixHandle,
  isValidMatrixRoomId,
  normalizeMatrixHandle,
  normalizeMatrixHomeserver,
  sendMatrixRoomMessage,
} from '@/lib/matrix/client';
import { identify, json, readJsonObject } from '@/lib/server/federation';
import { adminFirestore } from '@/lib/server/firebaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const caller = await identify(request);
  if (!caller) return json(401, { error: 'nao-autenticado' });

  const db = adminFirestore();
  const [userSnap, bridgeSnap] = await Promise.all([
    db.collection('users').doc(caller.uid).get(),
    db.collection('users').doc(caller.uid).collection('private').doc('matrix').get(),
  ]);

  const matrixHandle = (userSnap.data()?.matrixHandle as string | undefined) || null;
  const bridge = bridgeSnap.data() as
    | { homeserverUrl?: string; roomId?: string; accessToken?: string }
    | undefined;

  return json(200, {
    connected: Boolean(matrixHandle),
    matrixHandle,
    homeserverUrl: bridge?.homeserverUrl || 'https://matrix.org',
    roomId: bridge?.roomId || '',
    hasBridgeToken: Boolean(bridge?.accessToken),
  });
}

export async function POST(request: NextRequest) {
  const caller = await identify(request);
  if (!caller) return json(401, { error: 'nao-autenticado' });

  const body = await readJsonObject(request);
  if (!body) return json(400, { error: 'json-invalido' });

  const rawHandle = typeof body.matrixHandle === 'string' ? body.matrixHandle : '';
  const matrixHandle = normalizeMatrixHandle(rawHandle);
  if (!isValidMatrixHandle(matrixHandle)) {
    return json(400, { error: 'Informe um Matrix ID válido no formato @usuario:matrix.org.' });
  }

  const rawHomeserver = typeof body.homeserverUrl === 'string' ? body.homeserverUrl : 'https://matrix.org';
  let homeserverUrl = 'https://matrix.org';
  try {
    homeserverUrl = normalizeMatrixHomeserver(rawHomeserver);
  } catch (err) {
    return json(400, { error: err instanceof Error ? err.message : 'Homeserver inválido.' });
  }

  const roomId = typeof body.roomId === 'string' ? body.roomId.trim() : '';
  if (roomId && !isValidMatrixRoomId(roomId)) {
    return json(400, { error: 'Room ID Matrix inválido (ex.: !abc123:matrix.org ou #sala:matrix.org).' });
  }

  const accessToken = typeof body.accessToken === 'string' ? body.accessToken.trim() : '';
  const testMessage = body.testMessage === true;

  const db = adminFirestore();
  await db.collection('users').doc(caller.uid).set(
    {
      matrixHandle,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const bridgeRef = db.collection('users').doc(caller.uid).collection('private').doc('matrix');
  const existingBridge = await bridgeRef.get();
  const effectiveToken = accessToken || (existingBridge.data()?.accessToken as string | undefined) || '';

  if (roomId || effectiveToken) {
    await bridgeRef.set(
      {
        homeserverUrl,
        roomId,
        ...(accessToken ? { accessToken } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  let testEventId: string | undefined;
  if (testMessage) {
    if (!roomId || !effectiveToken) {
      return json(400, { error: 'Para testar o envio para uma sala, informe o Room ID e o Access Token.' });
    }
    try {
      const result = await sendMatrixRoomMessage({
        homeserverUrl,
        accessToken: effectiveToken,
        roomId,
        text: `Conexão Matrix ativada no Exe. Lula para ${matrixHandle}.`,
      });
      testEventId = result.eventId;
    } catch (err) {
      return json(400, { error: err instanceof Error ? err.message : 'Falha ao enviar para a sala Matrix.' });
    }
  }

  return json(200, {
    connected: true,
    matrixHandle,
    homeserverUrl,
    roomId,
    hasBridgeToken: Boolean(effectiveToken),
    testEventId,
  });
}

export async function DELETE(request: NextRequest) {
  const caller = await identify(request);
  if (!caller) return json(401, { error: 'nao-autenticado' });

  const db = adminFirestore();
  await Promise.all([
    db.collection('users').doc(caller.uid).set(
      {
        matrixHandle: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    ),
    db.collection('users').doc(caller.uid).collection('private').doc('matrix').delete().catch(() => null),
  ]);

  return json(200, { connected: false });
}

