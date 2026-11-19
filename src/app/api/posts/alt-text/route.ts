// src/app/api/posts/alt-text/route.ts
import { NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminFirestore } from '@/lib/server/firebaseAdmin';
import { requestIp, takeRateLimit, verifyRequestUser } from '@/lib/server/requestAuth';

const MAX_ALT_LENGTH = 300;

export async function POST(request: Request) {
  const uid = await verifyRequestUser(request);
  if (!uid) {
    return NextResponse.json({ error: 'Autenticação necessária.' }, { status: 401 });
  }

  const ip = requestIp(request);
  if (!takeRateLimit(`post-alt:${uid}`, 30, 60_000) || !takeRateLimit(`post-alt-ip:${ip}`, 50, 60_000)) {
    return NextResponse.json({ error: 'Muitas atualizações seguidas. Aguarde um momento.' }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as {
    postId?: unknown;
    alts?: Array<{ index?: unknown; alt?: unknown }>;
  } | null;

  const postId = typeof body?.postId === 'string' ? body.postId.trim() : '';
  if (!postId || postId.length > 200 || postId.startsWith('ap_') || postId.includes('/')) {
    return NextResponse.json({ error: 'Publicação inválida.' }, { status: 400 });
  }

  if (!Array.isArray(body?.alts)) {
    return NextResponse.json({ error: 'Lista de descrições inválida.' }, { status: 400 });
  }

  const db = adminFirestore();
  const postRef = db.collection('posts').doc(postId);
  const postSnap = await postRef.get();
  if (!postSnap.exists) {
    return NextResponse.json({ error: 'Publicação não encontrada.' }, { status: 404 });
  }

  const post = postSnap.data() as Record<string, unknown>;
  if (post.userId !== uid) {
    return NextResponse.json({ error: 'Apenas o autor pode adicionar ou editar o Alt Text.' }, { status: 403 });
  }
  if (post.isDeleted === true) {
    return NextResponse.json({ error: 'Esta publicação foi removida.' }, { status: 404 });
  }

  const currentMedia = Array.isArray(post.media)
    ? (post.media as Array<Record<string, unknown>>)
    : [];
  if (currentMedia.length === 0) {
    return NextResponse.json({ error: 'Este post não possui mídias.' }, { status: 400 });
  }

  const altMap = new Map<number, string>();
  for (const entry of body.alts) {
    if (typeof entry?.index !== 'number' || !Number.isInteger(entry.index)) continue;
    if (entry.index < 0 || entry.index >= currentMedia.length) continue;
    const rawAlt = typeof entry.alt === 'string' ? entry.alt.replace(/[\r\n]+/g, ' ').trim() : '';
    altMap.set(entry.index, rawAlt.slice(0, MAX_ALT_LENGTH));
  }

  const updatedMedia = currentMedia.map((item, idx) => {
    if (!altMap.has(idx) || item?.type !== 'image') return item;
    const nextAlt = altMap.get(idx) ?? '';
    const clone: Record<string, unknown> = { ...item };
    if (nextAlt) {
      clone.alt = nextAlt;
    } else {
      delete clone.alt;
    }
    return clone;
  });

  await postRef.update({
    media: updatedMedia,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const allImagesHaveAlt = updatedMedia
    .filter((m) => m?.type === 'image')
    .every((m) => typeof m.alt === 'string' && m.alt.trim().length > 0);

  if (allImagesHaveAlt) {
    await db
      .collection('notifications')
      .doc(`alt_text_request_${postId}`)
      .update({ readAt: Timestamp.now() })
      .catch(() => undefined);
  }

  return NextResponse.json({ ok: true, media: updatedMedia });
}

