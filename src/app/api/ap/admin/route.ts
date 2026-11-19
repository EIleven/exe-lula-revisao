// src/app/api/ap/admin/route.ts
// O painel de quem administra a rede. Só administrador (users/{uid}.isAdmin, lido pelo servidor); para os demais a rota
// responde 404, como se não existisse.
import { adminOverview, adminSetInstanceRule, adminSetPlatform } from '@/lib/activitypub/admin';
import type { AdminFailure } from '@/lib/activitypub/admin';
import { runWorker } from '@/lib/activitypub/worker';
import { configError, federation, json, readJsonObject, requireAdmin } from '@/lib/server/federation';
import { adminFirestore } from '@/lib/server/firebaseAdmin';
import { siteConfig } from '@/config/site';
import { normalizeHandle } from '@/lib/activitypub/identity';

export const dynamic = 'force-dynamic';

const STATUS_DA_FALHA: Record<AdminFailure, number> = {
  'nada-a-mudar': 400, 'valor-invalido': 422, 'dominio-invalido': 422, 'proprio-dominio': 422,
};

export async function GET(request: Request) {
  const quem = await requireAdmin(request, 'admin-get', 30);
  if (quem instanceof Response) return quem;

  const [overview, deadSnap] = await Promise.all([
    adminOverview(federation().admin),
    adminFirestore()
      .collection('ap_deliveries')
      .where('status', '==', 'dead')
      .limit(250)
      .get()
      .catch(() => null),
  ]);

  const byDomain = new Map<string, { domain: string; deadCount: number; lastError: string | null; likelyBlocked: boolean }>();
  if (deadSnap) {
    for (const docSnap of deadSnap.docs) {
      const d = docSnap.data();
      let domain = typeof d.domain === 'string' ? d.domain.trim().toLowerCase() : '';
      if (!domain && typeof d.inbox === 'string') {
        try {
          domain = new URL(d.inbox).hostname.toLowerCase();
        } catch {
          domain = '';
        }
      }
      if (!domain && typeof d.inboxUrl === 'string') {
        try {
          domain = new URL(d.inboxUrl).hostname.toLowerCase();
        } catch {
          domain = '';
        }
      }
      if (!domain) continue;

      const rawError =
        typeof d.lastError === 'string'
          ? d.lastError
          : typeof d.detail === 'string'
            ? d.detail
            : typeof d.statusCode === 'number'
              ? `HTTP ${d.statusCode}`
              : null;
      const likelyBlocked = Boolean(rawError && /\b(401|403|410|forbidden|blocked|suspended)\b/i.test(rawError));

      const existing = byDomain.get(domain);
      if (existing) {
        existing.deadCount += 1;
        if (!existing.lastError && rawError) existing.lastError = rawError;
        if (likelyBlocked) existing.likelyBlocked = true;
      } else {
        byDomain.set(domain, {
          domain,
          deadCount: 1,
          lastError: rawError,
          likelyBlocked,
        });
      }
    }
  }

  const blockedOrFailingDomains = Array.from(byDomain.values()).sort((a, b) => {
    if (a.likelyBlocked !== b.likelyBlocked) return a.likelyBlocked ? -1 : 1;
    return b.deadCount - a.deadCount;
  });

  return json(200, { ...overview, blockedOrFailingDomains });
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
  /**
   * Avisa quem segue uma conta pelo endereço ANTIGO que ela se mudou para o canônico (`Move`).
   *
   * UMA conta por chamada, de propósito: é um aviso que sai para a caixa de cada seguidor em outro servidor e não tem
   * como ser desfeito. Quem decide se move o follow é o servidor de lá, depois de conferir que o ator novo declara
   * `alsoKnownAs` apontando para o antigo (ver siteConfig.migrationAliasEnabled). Os vínculos daqui não são apagados.
   */
  if (corpo.action === 'migrate') {
    const handle = normalizeHandle(typeof corpo.handle === 'string' ? corpo.handle : '');
    if (!handle) return json(422, { error: 'handle-invalido' });

    const pedido = typeof corpo.legacyHost === 'string' ? corpo.legacyHost.trim().toLowerCase() : siteConfig.legacyFederationHosts[0];
    const antigo = siteConfig.legacyFederationHosts.find((h) => h === pedido);
    if (!antigo) return json(422, { error: 'host-antigo-desconhecido' });

    const f = federation();
    const reserva = await f.store.getHandle(handle);
    if (!reserva || reserva.state !== 'active') return json(404, { error: 'conta-nao-encontrada' });
    const conta = await f.store.getAccount(reserva.uid);
    if (!conta?.enabled) return json(409, { error: 'federacao-nao-ativada' });

    const agora = Date.now();
    await f.store.enqueueJob({
      id: `move-${reserva.uid}-${agora}`,
      op: 'move',
      uid: reserva.uid,
      postId: null,
      targets: null,
      createdAtMs: agora,
      nextAttemptAt: agora,
      attempts: 0,
      state: 'pending',
      // O worker lê daqui de QUAL endereço o Move fala (é o ator que quem segue conhece).
      note: `https://${antigo.replace(/^www\./, '')}`,
    });
    return json(200, { ok: true, handle: reserva.handle, de: `https://${antigo.replace(/^www\./, '')}`, para: f.origin });
  }
  return json(400, { error: 'acao-invalida' });
}
