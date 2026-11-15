// src/app/api/ap/deliveries/route.ts
// O que a pessoa vê da própria saída: destino, estado e motivo. Nunca o corpo da atividade nem a URL completa da caixa
// de entrada do destino. "Tentar de novo" só vale para a entrega dela, e só se falhou ou morreu.
import { listDeliveriesForUser, retryDeliveryForUser } from '@/lib/activitypub/worker';
import { federation, json, readJsonObject, requireCaller } from '@/lib/server/federation';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const quem = await requireCaller(request, 'deliveries-get', 60);
  if (quem instanceof Response) return quem;
  const itens = await listDeliveriesForUser({ store: federation().store }, quem.uid, 50);
  return json(200, { items: itens });
}

export async function POST(request: Request) {
  const quem = await requireCaller(request, 'deliveries-post', 20);
  if (quem instanceof Response) return quem;
  const corpo = await readJsonObject(request);
  const id = typeof corpo?.id === 'string' ? corpo.id : '';
  if (corpo?.action !== 'retry' || !/^[A-Za-z0-9_-]{8,128}$/.test(id)) return json(400, { error: 'corpo-invalido' });

  const f = federation();
  const r = await retryDeliveryForUser({ store: f.store, now: () => Date.now() }, quem.uid, id);
  if (r === 'inexistente') return json(404, { error: 'nao-encontrada' });
  if (r === 'nao-permitido') return json(409, { error: 'nao-pode-repetir' });
  return json(200, { ok: true });
}
