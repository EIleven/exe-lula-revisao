// src/lib/activitypub/moderation.ts
// A moderação AUTÔNOMA de quem federa: ver e remover seguidores remotos, bloquear um ator ou um servidor inteiro.
// Tudo aqui vale por conta da pessoa; não depende de a plataforma ou de outro servidor concordar.
//
// O que cada ação faz, e o que NÃO garante:
// - Remover seguidor retira o vínculo daqui e avisa o servidor dele com um Reject (o que o Mastodon também faz).
//   Servidores que ignoram o aviso podem continuar mostrando o vínculo; deixam, porém, de receber qualquer coisa.
// - Bloquear ator faz o mesmo e passa a descartar tudo o que vier dele.
// - Bloquear servidor remove todos os seguidores daquele domínio (e subdomínios) SEM contatá-lo: quem foi bloqueado
//   não deve receber nem uma mensagem a mais. Daí em diante, nada entra nem sai para aquele domínio por esta conta.
import { buildFollowResponse } from './activity.ts';
import { deliveryId } from './delivery.ts';
import { isBlockedByUser, normalizeDomain } from './gate.ts';
import type { UserBlock } from './gate.ts';
import { actorUrl, activityUrl } from './identity.ts';
import type { DeliveryRecord, FederationStore, FollowerRecord } from './store.ts';

export type ModerationDeps = {
  store: FederationStore;
  now: () => number;
  /** Host público, ex.: exercitodolula.app. */
  ownHost: string;
  /** Origem pública, ex.: https://exercitodolula.app. */
  origin: string;
  randomId: () => string;
};

/**
 * Teto de bloqueios por pessoa. O conjunto inteiro é lido a cada atividade que chega, então o teto limita o custo de
 * cada leitura E precisa ficar abaixo do limite de leitura do adaptador (listUserBlocks lê até 1000): acima disso, os
 * bloqueios excedentes seriam ignorados na caixa de entrada sem ninguém perceber.
 */
export const MAX_BLOCKS = 500;
const PAGINA = 100;
/** Quantos seguidores uma varredura de bloqueio de domínio examina, no máximo. */
const MAX_VARREDURA = 20_000;

// ───────────────────────── seguidores ─────────────────────────

export type FollowerView = {
  actorId: string;
  /** usuario@servidor, se o ator remoto está no cache. */
  handle: string | null;
  name: string | null;
  domain: string;
  sinceMs: number;
};

export async function listFollowersForUser(
  deps: Pick<ModerationDeps, 'store'>,
  uid: string,
  limite = 50,
  depois: string | null = null,
): Promise<{ items: FollowerView[]; next: string | null }> {
  const teto = Math.max(1, Math.min(limite, 100));
  // Pede um a mais para saber se há outra página sem uma consulta extra.
  const lista = await deps.store.listFollowers(uid, teto + 1, depois);
  const pagina = lista.slice(0, teto);
  const atores = await Promise.all(pagina.map((f) => deps.store.getRemoteActor(f.actorId)));
  const items = pagina.map((f, i) => ({
    actorId: f.actorId,
    handle: atores[i]?.handle ?? null,
    name: atores[i]?.name || null,
    domain: f.domain,
    sinceMs: f.createdAtMs,
  }));
  return { items, next: lista.length > teto ? pagina[pagina.length - 1].actorId : null };
}

export type RemoveFollowerResult = 'removido' | 'inexistente';

/**
 * Remove um seguidor. avisar decide se o servidor dele recebe um Reject.
 *
 * Ordem: enfileira o aviso ANTES de apagar o vínculo. Se o processo cair no meio, sobra um aviso que o portão do
 * worker cancela (o seguidor ainda existe) e a pessoa repete o pedido; o contrário deixaria o vínculo apagado sem
 * ninguém avisado, sem como repetir.
 */
export async function removeFollower(deps: ModerationDeps, uid: string, actorId: string, avisar = true): Promise<RemoveFollowerResult> {
  const { store } = deps;
  const seguidor = await store.getFollower(uid, actorId);
  if (!seguidor) return 'inexistente';

  if (avisar) await enfileirarReject(deps, uid, seguidor);
  const apagou = await store.deleteFollower(uid, actorId);
  if (apagou) await store.bump('seguidores.removidos');
  await store.audit({ atMs: deps.now(), kind: 'account', decision: 'seguidor-removido', domain: seguidor.domain, uid });
  return 'removido';
}

async function enfileirarReject(deps: ModerationDeps, uid: string, seguidor: FollowerRecord): Promise<void> {
  const reserva = await deps.store.findHandleByUid(uid);
  if (!reserva || reserva.state !== 'active') return; // sem identidade ativa não há quem assine
  const destino = seguidor.sharedInbox ?? seguidor.inbox;
  const followId = typeof seguidor.followActivity.id === 'string' ? seguidor.followActivity.id : seguidor.actorId;
  const idAtividade = activityUrl(deps.origin, reserva.handle, `reject-${deps.randomId()}`);
  const corpo = JSON.stringify(buildFollowResponse('Reject', idAtividade, actorUrl(deps.origin, reserva.handle), seguidor.followActivity));
  const registro: DeliveryRecord = {
    id: deliveryId({ uid, op: 'reject', objectId: followId, targetInbox: destino }),
    uid, op: 'reject', objectId: followId, activityId: idAtividade, targetInbox: destino, domain: seguidor.domain,
    body: corpo, status: 'pending', attempts: 0, nextAttemptAt: deps.now(), lastDetail: null, lastOutcome: null,
    createdAtMs: deps.now(), sentAtMs: null,
  };
  await deps.store.putDeliveryIfAbsent(registro);
}

// ───────────────────────── bloqueios ─────────────────────────

export type BlockInput = { scope: unknown; value: unknown };
export type BlockFailure = 'valor-invalido' | 'proprio-dominio' | 'limite';

/** Valida e normaliza. O ator é identificado pelo id EXATO que o servidor dele usa (é com esse texto que casamos). */
export function normalizeBlock(entrada: BlockInput, ownHost: string): { ok: true; block: UserBlock } | { ok: false; reason: BlockFailure } {
  const valor = typeof entrada.value === 'string' ? entrada.value.trim() : '';
  const proprio = ownHost.toLowerCase();
  if (entrada.scope === 'domain') {
    const dominio = normalizeDomain(valor);
    if (!dominio) return { ok: false, reason: 'valor-invalido' };
    if (dominio === proprio || dominio.endsWith(`.${proprio}`)) return { ok: false, reason: 'proprio-dominio' };
    return { ok: true, block: { scope: 'domain', value: dominio } };
  }
  if (entrada.scope === 'actor') {
    if (!valor || valor.length > 2048) return { ok: false, reason: 'valor-invalido' };
    let u: URL;
    try { u = new URL(valor); } catch { return { ok: false, reason: 'valor-invalido' }; }
    if (u.protocol !== 'https:' || u.username || u.password) return { ok: false, reason: 'valor-invalido' };
    const host = u.hostname.toLowerCase();
    if (host === proprio || host.endsWith(`.${proprio}`)) return { ok: false, reason: 'proprio-dominio' };
    return { ok: true, block: { scope: 'actor', value: valor } };
  }
  return { ok: false, reason: 'valor-invalido' };
}

export type AddBlockResult = { ok: true; removedFollowers: number } | { ok: false; reason: BlockFailure };

export async function addBlock(deps: ModerationDeps, uid: string, entrada: BlockInput): Promise<AddBlockResult> {
  const v = normalizeBlock(entrada, deps.ownHost);
  if (!v.ok) return v;
  const { store } = deps;

  const atuais = await store.listUserBlocks(uid);
  const jaTem = atuais.some((b) => b.scope === v.block.scope && b.value === v.block.value);
  if (!jaTem && atuais.length >= MAX_BLOCKS) return { ok: false, reason: 'limite' };
  await store.addUserBlock(uid, v.block); // idempotente

  // Quem já seguia e agora está bloqueado sai do vínculo. Ator: com aviso. Domínio: sem contatar o servidor.
  let removidos = 0;
  if (v.block.scope === 'actor') {
    if ((await removeFollower(deps, uid, v.block.value, true)) === 'removido') removidos++;
  } else {
    let depois: string | null = null;
    let examinados = 0;
    for (;;) {
      const lote = await store.listFollowers(uid, PAGINA, depois);
      if (lote.length === 0) break;
      for (const f of lote) {
        if (isBlockedByUser([v.block], f.actorId, f.domain) && (await removeFollower(deps, uid, f.actorId, false)) === 'removido') removidos++;
      }
      examinados += lote.length;
      depois = lote[lote.length - 1].actorId;
      if (lote.length < PAGINA || examinados >= MAX_VARREDURA) break;
    }
  }
  await store.bump(`bloqueios.${v.block.scope}`);
  await store.audit({ atMs: deps.now(), kind: 'account', decision: `bloqueio-${v.block.scope}`, uid });
  return { ok: true, removedFollowers: removidos };
}

export async function removeBlock(deps: ModerationDeps, uid: string, entrada: BlockInput): Promise<{ ok: true } | { ok: false; reason: BlockFailure }> {
  const v = normalizeBlock(entrada, deps.ownHost);
  if (!v.ok) return v;
  await deps.store.removeUserBlock(uid, v.block);
  await deps.store.audit({ atMs: deps.now(), kind: 'account', decision: `desbloqueio-${v.block.scope}`, uid });
  return { ok: true };
}

export function listBlocks(deps: Pick<ModerationDeps, 'store'>, uid: string): Promise<UserBlock[]> {
  return deps.store.listUserBlocks(uid);
}
