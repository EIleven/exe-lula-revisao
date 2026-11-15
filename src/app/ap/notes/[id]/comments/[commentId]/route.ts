// src/app/ap/notes/[id]/comments/[commentId]/route.ts
import type { NextRequest } from 'next/server';
import { AP_CONTEXT } from '@/lib/activitypub/activity';
import { isValidPostId, postPageUrl, wantsActivityJson } from '@/lib/activitypub/identity';
import { commentNoteFor, commentNoteUrl, DEFAULT_LOCALE } from '@/lib/activitypub/render';
import { apResponse, federation } from '@/lib/server/federation';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; commentId: string }> },
) {
  if (!takeRateLimit(`ap-note:${requestIp(request)}`, 240, 60_000)) {
    return new Response(null, { status: 429, headers: { 'Retry-After': '60' } });
  }
  const { id, commentId } = await context.params;
  if (!isValidPostId(id) || !isValidPostId(commentId)) return new Response(null, { status: 404 });

  const f = federation();
  const { store } = f.render;
  const plataforma = await store.getPlatform();
  if (!plataforma.enabled || plataforma.killSwitch) return apResponse(404, null);

  const objeto = await store.getObject(id);
  if (!objeto || objeto.scope === 'followers') return apResponse(404, null);

  const noteId = commentNoteUrl(f.origin, id, commentId);
  if (objeto.state === 'deleted') {
    return apResponse(410, { '@context': 'https://www.w3.org/ns/activitystreams', id: noteId, type: 'Tombstone', formerType: 'Note' });
  }

  const comentario = await store.getComment?.(id, commentId);
  if (!comentario || comentario.isDeleted || comentario.isRemoteFediverse) {
    return apResponse(410, { '@context': 'https://www.w3.org/ns/activitystreams', id: noteId, type: 'Tombstone', formerType: 'Note' });
  }

  const [reserva, conta] = await Promise.all([
    store.findHandleByUid(comentario.userId),
    store.getAccount(comentario.userId),
  ]);
  if (!reserva || reserva.state !== 'active' || !conta?.enabled) return apResponse(404, null);

  if (!wantsActivityJson(request.headers.get('accept'))) {
    return new Response(null, {
      status: 302,
      headers: { Location: postPageUrl(f.origin, DEFAULT_LOCALE, id), Vary: 'Accept' },
    });
  }

  const nota = commentNoteFor(f.render, reserva.handle, comentario, objeto.scope);
  return apResponse(200, { '@context': AP_CONTEXT, ...nota }, { 'Cache-Control': 'public, max-age=60' });
}

