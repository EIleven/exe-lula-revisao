// src/app/api/ap/remote-post-interactions/route.ts
import type { NextRequest } from 'next/server';
import { identify, json } from '@/lib/server/federation';
import {
  fetchAndMaterializeRemoteCommentReactors,
  fetchAndMaterializeRemotePostReactors,
  syncRemotePostComments,
} from '@/lib/server/remotePostInteractions';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!takeRateLimit(`ap-remote-post-int:${requestIp(request)}`, 30, 60_000)) {
    return json(429, { error: 'muitas-requisicoes' }, { 'Retry-After': '30' });
  }

  const postId = request.nextUrl.searchParams.get('postId') ?? '';
  const commentId = request.nextUrl.searchParams.get('commentId') ?? '';
  const mode = request.nextUrl.searchParams.get('mode') ?? 'comments';
  if (!postId) return json(400, { error: 'postId-obrigatorio' });

  let callerUid: string | null = null;
  if (request.headers.get('authorization')?.startsWith('Bearer ')) {
    const caller = await identify(request);
    callerUid = caller?.uid ?? null;
  }

  if (mode === 'comments') {
    const added = await syncRemotePostComments(postId);
    return json(200, { ok: true, added });
  }

  if (mode === 'likes' || mode === 'reposts') {
    const result = commentId
      ? await fetchAndMaterializeRemoteCommentReactors(postId, commentId, mode, callerUid)
      : await fetchAndMaterializeRemotePostReactors(postId, mode, callerUid);
    return json(200, { users: result.users, restricted: result.restricted });
  }

  return json(400, { error: 'mode-invalido' });
}

