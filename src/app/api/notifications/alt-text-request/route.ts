// src/app/api/notifications/alt-text-request/route.ts
import { NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminFirestore } from '@/lib/server/firebaseAdmin';
import { requestIp, takeRateLimit, verifyRequestUser } from '@/lib/server/requestAuth';

export async function POST(request: Request) {
  const uid = await verifyRequestUser(request);
  if (!uid) {
    return NextResponse.json({ error: 'Autenticação necessária.' }, { status: 401 });
  }

  const ip = requestIp(request);
  if (!takeRateLimit(`alt-req:${uid}`, 20, 60_000) || !takeRateLimit(`alt-req-ip:${ip}`, 40, 60_000)) {
    return NextResponse.json({ error: 'Muitas solicitações em pouco tempo. Aguarde um instante.' }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as { postId?: unknown } | null;
  const postId = typeof body?.postId === 'string' ? body.postId.trim() : '';
  if (!postId || postId.length > 200 || postId.startsWith('ap_') || postId.includes('/')) {
    return NextResponse.json({ error: 'Publicação inválida ou externa.' }, { status: 400 });
  }

  const db = adminFirestore();
  const postRef = db.collection('posts').doc(postId);
  const postSnap = await postRef.get();
  if (!postSnap.exists) {
    return NextResponse.json({ error: 'Publicação não encontrada.' }, { status: 404 });
  }

  const post = postSnap.data() as Record<string, unknown>;
  if (post.isDeleted === true) {
    return NextResponse.json({ error: 'Esta publicação foi removida.' }, { status: 404 });
  }

  const recipientId = typeof post.userId === 'string' ? post.userId : '';
  if (!recipientId || recipientId.startsWith('ap_')) {
    return NextResponse.json({ error: 'Apenas publicações locais suportam esta notificação.' }, { status: 400 });
  }
  if (recipientId === uid) {
    return NextResponse.json({ error: 'Você pode adicionar o Alt Text diretamente no seu post.' }, { status: 400 });
  }

  // Confere bloqueio e visibilidade da publicação para quem solicita.
  const blockedSnap = await db.collection('users').doc(recipientId).collection('blocked').doc(uid).get();
  if (blockedSnap.exists) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 });
  }
  if (post.visibility === 'private') {
    const followerSnap = await db.collection('users').doc(recipientId).collection('followers').doc(uid).get();
    if (!followerSnap.exists) {
      return NextResponse.json({ error: 'Publicação restrita.' }, { status: 403 });
    }
  }

  const media = Array.isArray(post.media) ? (post.media as Array<Record<string, unknown>>) : [];
  const hasImageWithoutAlt = media.some(
    (item) => item?.type === 'image' && !(typeof item.alt === 'string' && item.alt.trim().length > 0)
  );
  if (!hasImageWithoutAlt) {
    return NextResponse.json({ error: 'As imagens deste post já possuem Alt Text.' }, { status: 400 });
  }

  const requesterSnap = await db.collection('users').doc(uid).get();
  if (!requesterSnap.exists) {
    return NextResponse.json({ error: 'Perfil do solicitante não encontrado.' }, { status: 403 });
  }
  const requesterData = requesterSnap.data() as Record<string, unknown>;
  const actor = {
    userId: uid,
    name: typeof requesterData.name === 'string' && requesterData.name.trim() ? requesterData.name.trim() : 'Alguém',
    username: typeof requesterData.username === 'string' && requesterData.username.trim() ? requesterData.username.trim() : 'usuario',
    avatarUrl: typeof requesterData.avatarUrl === 'string' ? requesterData.avatarUrl : '',
  };

  const rawText = typeof post.headline === 'string' && post.headline.trim()
    ? post.headline.trim()
    : typeof post.text === 'string'
      ? post.text.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim()
      : '';
  const previewText = rawText ? rawText.slice(0, 80) : null;

  const notifRef = db.collection('notifications').doc(`alt_text_request_${postId}`);
  const result = await db.runTransaction(async (tx) => {
    const existing = await tx.get(notifRef);
    const now = Timestamp.now();

    if (existing.exists) {
      const data = existing.data() as Record<string, unknown>;
      const isUnread = data.readAt == null;
      const existingActorIds = Array.isArray(data.actorIds) ? (data.actorIds as string[]) : [];
      if (isUnread && existingActorIds.includes(uid)) {
        return { alreadyRequested: true };
      }

      if (isUnread) {
        const currentActors = Array.isArray(data.actors) ? (data.actors as Array<Record<string, unknown>>) : [];
        const nextActors = [actor, ...currentActors.filter((a) => a?.userId !== uid)].slice(0, 10);
        const nextActorIds = Array.from(new Set([uid, ...existingActorIds])).slice(0, 50);
        tx.update(notifRef, {
          actors: nextActors,
          actorIds: nextActorIds,
          count: nextActorIds.length,
          previewText,
          createdAt: now,
          readAt: null,
        });
        return { alreadyRequested: false };
      }
    }

    tx.set(notifRef, {
      recipientId,
      type: 'alt_text_request',
      entityId: postId,
      entityParentId: null,
      entityType: 'post',
      actors: [actor],
      actorIds: [uid],
      count: 1,
      previewText,
      newPostId: null,
      createdAt: now,
      readAt: null,
    });
    return { alreadyRequested: false };
  });

  return NextResponse.json({ ok: true, ...result });
}

