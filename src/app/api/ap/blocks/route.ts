// src/app/api/ap/blocks/route.ts
// Bloqueios da PRÓPRIA pessoa: de um ator ou de um servidor inteiro. Valem por conta dela, sem depender de ninguém.
import { addBlock, listBlocks, removeBlock } from '@/lib/activitypub/moderation';
import type { BlockFailure } from '@/lib/activitypub/moderation';
import { federation, json, readJsonObject, requireCaller } from '@/lib/server/federation';

export const dynamic = 'force-dynamic';

const STATUS_DA_FALHA: Record<BlockFailure, number> = { 'valor-invalido': 422, 'proprio-dominio': 422, limite: 409 };

export async function GET(request: Request) {
  const quem = await requireCaller(request, 'blocks-get', 60);
  if (quem instanceof Response) return quem;
  return json(200, { items: await listBlocks({ store: federation().store }, quem.uid) });
}

export async function POST(request: Request) {
  const quem = await requireCaller(request, 'blocks-post', 30);
  if (quem instanceof Response) return quem;
  const corpo = await readJsonObject(request);
  if (!corpo || (corpo.action !== 'add' && corpo.action !== 'remove')) return json(400, { error: 'corpo-invalido' });

  const deps = federation().moderation;
  if (corpo.action === 'add') {
    const r = await addBlock(deps, quem.uid, { scope: corpo.scope, value: corpo.value });
    if (!r.ok) return json(STATUS_DA_FALHA[r.reason], { error: r.reason });
    return json(200, { ok: true, removedFollowers: r.removedFollowers });
  }
  const r = await removeBlock(deps, quem.uid, { scope: corpo.scope, value: corpo.value });
  if (!r.ok) return json(STATUS_DA_FALHA[r.reason], { error: r.reason });
  return json(200, { ok: true });
}
