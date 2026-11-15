// src/app/api/ap/followers/route.ts
// Os seguidores do Fediverso, só para a própria pessoa (a lista nunca é pública). Remover avisa o servidor do seguidor
// com um Reject; bloquear é na rota /api/ap/blocks.
import { listFollowersForUser, removeFollower } from '@/lib/activitypub/moderation';
import { federation, json, readJsonObject, requireCaller } from '@/lib/server/federation';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const quem = await requireCaller(request, 'followers-get', 60);
  if (quem instanceof Response) return quem;
  const params = new URL(request.url).searchParams;
  const depois = params.get('after');
  if (depois !== null && (depois.length === 0 || depois.length > 2048)) return json(400, { error: 'parametro-invalido' });
  const limite = Math.min(Math.max(Number(params.get('limit') ?? '50') || 50, 1), 100);
  return json(200, await listFollowersForUser({ store: federation().store }, quem.uid, limite, depois));
}

export async function POST(request: Request) {
  const quem = await requireCaller(request, 'followers-post', 30);
  if (quem instanceof Response) return quem;
  const corpo = await readJsonObject(request);
  const actorId = typeof corpo?.actorId === 'string' ? corpo.actorId : '';
  if (corpo?.action !== 'remove' || !actorId || actorId.length > 2048) return json(400, { error: 'corpo-invalido' });

  const r = await removeFollower(federation().moderation, quem.uid, actorId, true);
  if (r === 'inexistente') return json(404, { error: 'nao-encontrado' });
  return json(200, { ok: true });
}
