// src/app/api/ap/admin/route.ts
// O painel de quem administra a rede. Só administrador (users/{uid}.isAdmin, lido pelo servidor); para os demais a rota
// responde 404, como se não existisse.
import { adminOverview, adminSetInstanceRule, adminSetPlatform } from '@/lib/activitypub/admin';
import type { AdminFailure } from '@/lib/activitypub/admin';
import { runWorker } from '@/lib/activitypub/worker';
import { configError, federation, json, readJsonObject, requireAdmin } from '@/lib/server/federation';

export const dynamic = 'force-dynamic';

const STATUS_DA_FALHA: Record<AdminFailure, number> = {
  'nada-a-mudar': 400, 'valor-invalido': 422, 'dominio-invalido': 422, 'proprio-dominio': 422,
};

export async function GET(request: Request) {
  const quem = await requireAdmin(request, 'admin-get', 30);
  if (quem instanceof Response) return quem;
  return json(200, await adminOverview(federation().admin));
}

export async function POST(request: Request) {
  const quem = await requireAdmin(request, 'admin-post', 30);
  if (quem instanceof Response) return quem;
  const corpo = await readJsonObject(request);
  if (!corpo) return json(400, { error: 'corpo-invalido' });

  const deps = federation().admin;
  if (corpo.action === 'platform') {
    const r = await adminSetPlatform(deps, quem.uid, { enabled: corpo.enabled, killSwitch: corpo.killSwitch, mode: corpo.mode });
    if (!r.ok) return json(STATUS_DA_FALHA[r.reason], { error: r.reason });
    return json(200, { ok: true, platform: r.platform });
  }
  if (corpo.action === 'instance') {
    // A regra precisa vir EXPLÍCITA (null remove): campo omitido não pode apagar uma regra por engano.
    if (!('rule' in corpo)) return json(400, { error: 'corpo-invalido' });
    const r = await adminSetInstanceRule(deps, quem.uid, corpo.domain, corpo.rule);
    if (!r.ok) return json(STATUS_DA_FALHA[r.reason], { error: r.reason });
    return json(200, { ok: true });
  }
  if (corpo.action === 'run-worker') {
    let workerDeps;
    try {
      workerDeps = federation().worker();
    } catch {
      return configError();
    }
    const stats = await runWorker(workerDeps);
    return json(200, { ok: true, stats });
  }
  return json(400, { error: 'acao-invalida' });
}
