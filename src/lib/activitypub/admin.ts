// src/lib/activitypub/admin.ts
// O painel de quem administra a rede: ligar e desligar a federação da casa, o botão de emergência, as regras por
// servidor e o que a fila está fazendo. Quem pode chamar é decidido pela ROTA (users/{uid}.isAdmin); aqui só se valida
// o que entra e se deixa rastro: toda mudança de política vira uma linha em ap_audit.
import { normalizeDomain } from './gate.ts';
import type { InstanceAction, PlatformFlags } from './gate.ts';
import type { FederationStore } from './store.ts';

export type AdminDeps = { store: FederationStore; now: () => number; ownHost: string };

export type AdminOverview = {
  platform: PlatformFlags;
  rules: { domain: string; action: InstanceAction }[];
  queue: { jobs: number; deliveries: number; dead: number };
  counts: { accounts: number; publicObjects: number };
  /** Contadores do dia atual e do anterior (UTC). */
  counters: { today: Record<string, number>; yesterday: Record<string, number> };
};

export const diaUtc = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
};

export async function adminOverview(deps: AdminDeps): Promise<AdminOverview> {
  const { store } = deps;
  const agora = deps.now();
  const [platform, policy, queue, counts, hoje, ontem] = await Promise.all([
    store.getPlatform(),
    store.getInstancePolicy(),
    store.queueDepth(),
    store.federationCounts(),
    store.readCounters(diaUtc(agora)),
    store.readCounters(diaUtc(agora - 86_400_000)),
  ]);
  const rules = Object.entries(policy.rules)
    .map(([domain, r]) => ({ domain, action: r.action }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
  return { platform, rules, queue, counts, counters: { today: hoje, yesterday: ontem } };
}

export type PlatformPatch = { enabled?: unknown; killSwitch?: unknown; mode?: unknown };
export type AdminFailure = 'nada-a-mudar' | 'valor-invalido' | 'dominio-invalido' | 'proprio-dominio';

/** Aceita só os três campos conhecidos, com o tipo certo. Qualquer outra coisa no corpo é ignorada. */
export async function adminSetPlatform(deps: AdminDeps, adminUid: string, patch: PlatformPatch): Promise<{ ok: true; platform: PlatformFlags } | { ok: false; reason: AdminFailure }> {
  const limpo: Partial<PlatformFlags> = {};
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') return { ok: false, reason: 'valor-invalido' };
    limpo.enabled = patch.enabled;
  }
  if (patch.killSwitch !== undefined) {
    if (typeof patch.killSwitch !== 'boolean') return { ok: false, reason: 'valor-invalido' };
    limpo.killSwitch = patch.killSwitch;
  }
  if (patch.mode !== undefined) {
    if (patch.mode !== 'open' && patch.mode !== 'allowlist') return { ok: false, reason: 'valor-invalido' };
    limpo.mode = patch.mode;
  }
  if (Object.keys(limpo).length === 0) return { ok: false, reason: 'nada-a-mudar' };

  await deps.store.setPlatform(limpo);
  await deps.store.audit({
    atMs: deps.now(), kind: 'policy', decision: 'plataforma-alterada',
    reason: Object.entries(limpo).map(([k, v]) => `${k}=${String(v)}`).join(','), uid: adminUid,
  });
  await deps.store.bump('admin.plataforma');
  return { ok: true, platform: await deps.store.getPlatform() };
}

export async function adminSetInstanceRule(
  deps: AdminDeps, adminUid: string, dominioBruto: unknown, acao: unknown,
): Promise<{ ok: true } | { ok: false; reason: AdminFailure }> {
  const dominio = normalizeDomain(typeof dominioBruto === 'string' ? dominioBruto : null);
  if (!dominio) return { ok: false, reason: 'dominio-invalido' };
  const proprio = deps.ownHost.toLowerCase();
  if (dominio === proprio || dominio.endsWith(`.${proprio}`)) return { ok: false, reason: 'proprio-dominio' };
  if (acao !== null && acao !== 'allow' && acao !== 'silence' && acao !== 'suspend') return { ok: false, reason: 'valor-invalido' };

  await deps.store.setInstanceRule(dominio, acao);
  await deps.store.audit({
    atMs: deps.now(), kind: 'policy', domain: dominio, decision: acao === null ? 'regra-removida' : `regra-${acao}`, uid: adminUid,
  });
  await deps.store.bump('admin.regra-de-instancia');
  return { ok: true };
}
