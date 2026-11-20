// src/app/api/messages/group-members/route.ts
// Criação de grupo e adição de participantes no servidor, garantindo que bloqueios e dmPreference
// (incluindo valor legado 'nobody') não sejam contornados por chamadas diretas ao Firestore.
import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { adminAuth, adminFirestore } from '@/lib/server/firebaseAdmin';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';
import {
  MOTIVO_EM_PALAVRAS,
  triarEntradas,
  type SinaisDaRelacao,
} from '@/lib/messages/entradaEmGrupo';

export const dynamic = 'force-dynamic';

const MAX_GROUP_PARTICIPANTS = 1000;
const MAX_BATCH_ADD = 100;

async function readSinaisServidor(
  actorId: string,
  candidatos: string[],
): Promise<{
  sinais: Map<string, SinaisDaRelacao>;
  perfis: Map<string, { id: string; name?: string; username?: string }>;
}> {
  const db = adminFirestore();
  const sinais = new Map<string, SinaisDaRelacao>();
  const perfis = new Map<string, { id: string; name?: string; username?: string }>();

  await Promise.all(
    candidatos.map(async (candidatoId) => {
      const [userSnap, alvoBloqueouAtorSnap, atorBloqueouAlvoSnap, alvoSegueAtorSnap] =
        await Promise.all([
          db.collection('users').doc(candidatoId).get(),
          db.collection('users').doc(candidatoId).collection('blockedUsers').doc(actorId).get(),
          db.collection('users').doc(actorId).collection('blockedUsers').doc(candidatoId).get(),
          db.collection('users').doc(candidatoId).collection('following').doc(actorId).get(),
        ]);

      if (!userSnap.exists) {
        sinais.set(candidatoId, { dmPreference: 'none' });
        return;
      }

      const d = userSnap.data() as Record<string, unknown>;
      const username = typeof d.username === 'string' ? d.username : undefined;
      const name = typeof d.name === 'string' ? d.name : username;
      perfis.set(candidatoId, { id: candidatoId, name, username });

      const ehRemoto =
        candidatoId.startsWith('ap_') ||
        Boolean(d.isRemoteFediverse) ||
        Boolean(username?.includes('@'));

      sinais.set(candidatoId, {
        ehRemoto,
        dmPreference: typeof d.dmPreference === 'string' ? d.dmPreference : 'everyone',
        alvoBloqueouOAtor: alvoBloqueouAtorSnap.exists,
        atorBloqueouOAlvo: atorBloqueouAlvoSnap.exists,
        alvoSegueOAtor: alvoSegueAtorSnap.exists,
      });
    }),
  );

  return { sinais, perfis };
}

export async function POST(request: Request) {
  const ip = requestIp(request);
  if (!takeRateLimit(`group-members:${ip}`, 30, 60_000)) {
    return NextResponse.json({ message: 'Muitas requisições. Aguarde um momento.' }, { status: 429 });
  }

  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    return NextResponse.json({ message: 'Login obrigatório.' }, { status: 401 });
  }

  let actorUid: string;
  let isMemberClaim = false;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    actorUid = decoded.uid;
    isMemberClaim = decoded.member === true || decoded.admin === true;
  } catch {
    return NextResponse.json({ message: 'Sessão inválida ou expirada.' }, { status: 401 });
  }

  const db = adminFirestore();
  if (!isMemberClaim) {
    const callerSnap = await db.collection('users').doc(actorUid).get();
    const d = callerSnap.data() as Record<string, unknown> | undefined;
    if (!callerSnap.exists || d?.isSuspended === true) {
      return NextResponse.json({ message: 'Conta sem permissão para esta ação.' }, { status: 403 });
    }
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: unknown;
    groupName?: unknown;
    conversationId?: unknown;
    userIds?: unknown;
  };

  const action = body.action === 'create' || body.action === 'add' ? body.action : null;
  if (!action) {
    return NextResponse.json({ message: 'Ação inválida.' }, { status: 400 });
  }

  const rawIds = Array.isArray(body.userIds)
    ? body.userIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : [];
  const uniquePedidos = Array.from(new Set(rawIds)).filter((id) => id !== actorUid);
  if (uniquePedidos.length === 0) {
    return NextResponse.json({ message: 'Selecione pelo menos um participante.' }, { status: 400 });
  }
  if (uniquePedidos.length > MAX_BATCH_ADD) {
    return NextResponse.json(
      { message: `Máximo de ${MAX_BATCH_ADD} participantes por operação.` },
      { status: 400 },
    );
  }

  if (action === 'create') {
    const trimmedName = typeof body.groupName === 'string' ? body.groupName.trim() : '';
    if (!trimmedName || trimmedName.length > 80) {
      return NextResponse.json(
        { message: 'Informe um nome válido para o grupo (1 a 80 caracteres).' },
        { status: 400 },
      );
    }

    const { sinais, perfis } = await readSinaisServidor(actorUid, uniquePedidos);
    const triagem = triarEntradas(uniquePedidos, (id) => sinais.get(id) ?? { dmPreference: 'none' });
    if (triagem.aceitos.length < 1) {
      const nomes = triagem.recusados
        .map(({ candidato, motivo }) => {
          const p = perfis.get(candidato);
          return `${p?.name || p?.username || candidato} ${MOTIVO_EM_PALAVRAS[motivo]}`;
        })
        .join('; ');
      return NextResponse.json(
        { message: nomes ? `O grupo não foi criado: ${nomes}.` : 'O grupo não foi criado.' },
        { status: 403 },
      );
    }

    const participantIds = Array.from(new Set([actorUid, ...triagem.aceitos]));
    if (participantIds.length > MAX_GROUP_PARTICIPANTS) {
      return NextResponse.json(
        { message: `O grupo pode ter no máximo ${MAX_GROUP_PARTICIPANTS} participantes.` },
        { status: 400 },
      );
    }

    const conversationId = `grp_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const unreadCounts: Record<string, number> = {};
    for (const pid of participantIds) unreadCounts[pid] = 0;

    await db.collection('conversations').doc(conversationId).set({
      isGroup: true,
      groupName: trimmedName,
      groupAvatarUrl: null,
      participantIds,
      adminIds: [actorUid],
      createdBy: actorUid,
      createdAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessageId: null,
      lastMessageText: null,
      lastMessageSenderId: null,
      unreadCounts,
      userLeftAt: {},
    });

    return NextResponse.json({
      conversationId,
      addedIds: triagem.aceitos,
      recusados: triagem.recusados.map(({ candidato, motivo }) => ({
        userId: candidato,
        nome: perfis.get(candidato)?.name || perfis.get(candidato)?.username || candidato,
        motivo,
        emPalavras: MOTIVO_EM_PALAVRAS[motivo],
      })),
    });
  }

  // action === 'add'
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : '';
  if (!conversationId) {
    return NextResponse.json({ message: 'Conversa inválida.' }, { status: 400 });
  }

  const convRef = db.collection('conversations').doc(conversationId);
  const convSnap = await convRef.get();
  if (!convSnap.exists) {
    return NextResponse.json({ message: 'Grupo não encontrado.' }, { status: 404 });
  }
  const convData = convSnap.data() as {
    isGroup?: boolean;
    adminIds?: string[];
    participantIds?: string[];
  };
  if (convData.isGroup !== true) {
    return NextResponse.json({ message: 'A conversa informada não é um grupo.' }, { status: 400 });
  }
  if (!Array.isArray(convData.adminIds) || !convData.adminIds.includes(actorUid)) {
    return NextResponse.json(
      { message: 'Apenas administradores do grupo podem adicionar participantes.' },
      { status: 403 },
    );
  }

  const currentIds = Array.isArray(convData.participantIds) ? convData.participantIds : [];
  const pedidosNovos = uniquePedidos.filter((id) => !currentIds.includes(id));
  if (pedidosNovos.length === 0) {
    return NextResponse.json({ addedIds: [], recusados: [] });
  }

  const { sinais, perfis } = await readSinaisServidor(actorUid, pedidosNovos);
  const triagem = triarEntradas(pedidosNovos, (id) => sinais.get(id) ?? { dmPreference: 'none' });
  const recusados = triagem.recusados.map(({ candidato, motivo }) => ({
    userId: candidato,
    nome: perfis.get(candidato)?.name || perfis.get(candidato)?.username || candidato,
    motivo,
    emPalavras: MOTIVO_EM_PALAVRAS[motivo],
  }));

  if (triagem.aceitos.length === 0) {
    const nomes = recusados.map((r) => `${r.nome} ${r.emPalavras}`).join('; ');
    return NextResponse.json(
      { message: nomes ? `Ninguém foi adicionado: ${nomes}.` : 'Ninguém foi adicionado.' },
      { status: 403 },
    );
  }

  const nextIds = Array.from(new Set([...currentIds, ...triagem.aceitos]));
  if (nextIds.length > MAX_GROUP_PARTICIPANTS) {
    return NextResponse.json(
      { message: `O grupo pode ter no máximo ${MAX_GROUP_PARTICIPANTS} participantes.` },
      { status: 400 },
    );
  }

  await convRef.update({ participantIds: nextIds });

  return NextResponse.json({
    conversationId,
    addedIds: triagem.aceitos,
    recusados,
  });
}
