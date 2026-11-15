// src/app/api/ap/worker/route.ts
// O motor de entrega. Quem aciona é o Cloud Scheduler (a cada minuto), com um token OIDC de uma conta de serviço NOSSA;
// ninguém mais. Cada execução tem orçamento de tempo e retoma de onde a anterior parou.
import { runWorker } from '@/lib/activitypub/worker';
import { configError, federation, isScheduler, json } from '@/lib/server/federation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  // 404 e não 401: quem não é o agendador não precisa saber que a rota existe.
  if (!(await isScheduler(request))) return new Response(null, { status: 404 });
  let deps;
  try {
    deps = federation().worker();
  } catch {
    return configError();
  }
  try {
    const stats = await runWorker(deps);
    return json(200, stats);
  } catch (erro) {
    // Falha inesperada: registra sem expor detalhes ao chamador. O agendador tenta de novo no minuto seguinte.
    console.error('[ap-worker] falha', erro instanceof Error ? erro.message : 'desconhecida');
    return json(500, { error: 'falha-no-worker' });
  }
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
