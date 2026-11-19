// src/lib/activitypub/outboundFollow.ts
// Seguir (e deixar de seguir, e cancelar um pedido) um perfil de OUTRO servidor do Fediverso: as REGRAS, sem Firebase nem Next. Tudo o que
// toca o mundo (banco, rede, relógio) entra por parâmetro, e é o que deixa estas regras testáveis (e2e/ap-follow-check.mjs).
//
// Perfil ABERTO: o "Seguindo" é gravado por antecipação (as arestas users/{uid}/following e users/{ap_}/followers), e o `Accept` do servidor
// remoto só confirma. Perfil FECHADO (`manuallyApprovesFollowers`): o servidor NÃO responde até a pessoa de lá aprovar, então o que
// existe é um PEDIDO: `ap_following` fica com `status: 'pending'` e NENHUMA aresta é gravada (as arestas movem feeds e contadores, e
// seguir de verdade ainda não aconteceu). O `Accept` grava as arestas; o `Reject` apaga o pedido.
//
// Sair é sempre possível: deixar de seguir (ou cancelar o pedido) limpa o que é NOSSO primeiro e só depois tenta avisar o servidor remoto,
// que pode estar fora do ar ou ter apagado a conta. Antes, o aviso falhando impedia a pessoa de deixar de seguir.
import { buildDirectCreate, buildFollow, buildUndo } from './activity.ts';
import { activityUrl, actorUrl } from './identity.ts';
import { remoteFollowDocIdOf, remoteUserIdOf } from './remoteIdentity.ts';

export type FollowStatus = 'pending' | 'accepted';

/** `ap_following/{uid}/actors/{hash}`. Sem `status` = registro antigo (seguindo, sem resposta registrada). */
export type FollowRecord = {
  actorId: string;
  handle: string;
  domain: string;
  name: string;
  iconUrl: string | null;
  url: string;
  followActivityId: string;
  createdAtMs: number;
  status?: FollowStatus;
  requestedAtMs?: number;
  acceptedAtMs?: number;
  manuallyApprovesFollowers?: boolean;
  noteSentAtMs?: number;
};

/** O estado que a PESSOA vê no botão. */
export type FollowView = 'none' | 'requested' | 'following';

export function viewOfFollow(registro: { status?: FollowStatus } | null | undefined): FollowView {
  if (!registro) return 'none';
  return registro.status === 'pending' ? 'requested' : 'following';
}

export type RemoteFollowTarget = {
  actorId: string;
  handle: string;
  domain: string;
  name: string;
  iconUrl: string | null;
  url: string;
  inbox: string | null;
  sharedInbox: string | null;
  manuallyApprovesFollowers?: boolean;
};

export type DeliveryResult = { ok: boolean; status: number };

export type OutboundFollowDeps = {
  now: () => number;
  origin: string;
  /** Quem segue: o uid e o handle FEDERADO local (a conta já está ativada). */
  local: { uid: string; handle: string };
  getFollow: (uid: string, actorHash: string) => Promise<FollowRecord | null>;
  saveFollow: (uid: string, actorHash: string, registro: FollowRecord) => Promise<void>;
  deleteFollow: (uid: string, actorHash: string) => Promise<void>;
  /** `users/{uid}/following/{remoteUid}` + `users/{remoteUid}/followers/{uid}`. */
  saveEdges: (uid: string, remoteUid: string) => Promise<void>;
  deleteEdges: (uid: string, remoteUid: string) => Promise<void>;
  /** Assina e entrega a atividade na caixa de entrada. Pode lançar (rede). */
  deliver: (inbox: string, activity: Record<string, unknown>) => Promise<DeliveryResult>;
  /** Grava o perfil remoto como usuário `ap_…` (melhor esforço). */
  materialize?: (alvo: RemoteFollowTarget) => Promise<unknown>;
  /** Identificador único e curto para o id do bilhete (injetado para os testes serem determinísticos). */
  nonce?: () => string;
};

export type ServiceResult = { status: number; body: Record<string, unknown> };

const ok = (corpo: Record<string, unknown>): ServiceResult => ({ status: 200, body: { ok: true, ...corpo } });
const falha = (status: number, error: string, extra: Record<string, unknown> = {}): ServiceResult => ({ status, body: { error, ...extra } });

/** O recorte que a tela precisa, sempre no mesmo formato (também em respostas antigas: `following` continua existindo). */
export function shapeOf(view: FollowView, closed: boolean, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { view, following: view === 'following', requested: view === 'requested', closed, ...extra };
}

export const FOLLOW_NOTE_MAX = 450;

/**
 * O bilhete que acompanha o pedido: texto simples, sem caracteres de controle, sem linhas em branco em excesso, até 450 caracteres
 * (o limite de um post do Mastodon é 500 e a menção ocupa espaço). Vazio vira `null` (o pedido segue sem bilhete).
 */
export function normalizeFollowNote(bruto: unknown): string | null {
  if (typeof bruto !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const limpo = bruto.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!limpo) return null;
  return Array.from(limpo).slice(0, FOLLOW_NOTE_MAX).join('').trim() || null;
}

/** Pede para seguir (perfil fechado) ou segue (perfil aberto). Idempotente: se já segue, ou já pediu, não envia nada de novo. */
export async function followRemote(deps: OutboundFollowDeps, alvo: RemoteFollowTarget, opcoes: { note?: unknown } = {}): Promise<ServiceResult> {
  const { uid, handle } = deps.local;
  const hash = remoteFollowDocIdOf(alvo.actorId);
  const remoteUid = remoteUserIdOf(alvo.actorId);
  const fechado = alvo.manuallyApprovesFollowers === true;

  const existente = await deps.getFollow(uid, hash);
  const jaEsta = viewOfFollow(existente);
  if (jaEsta !== 'none') {
    return ok(shapeOf(jaEsta, existente?.manuallyApprovesFollowers === true || fechado, { already: true, noteSent: false }));
  }

  const inbox = alvo.inbox || alvo.sharedInbox;
  if (!inbox) return falha(422, 'inbox-remoto-indisponivel');

  try {
    await deps.materialize?.(alvo);
  } catch {
    // melhor esforço: o perfil aparece na lista mesmo sem materializar agora
  }

  const agora = deps.now();
  const local = actorUrl(deps.origin, handle);
  const followId = activityUrl(deps.origin, handle, `follow-${hash}-${agora}`);
  const entrega = await deps.deliver(inbox, buildFollow(followId, local, alvo.actorId));
  if (!entrega.ok) return falha(502, 'falha-entrega-remota', { status: entrega.status });

  const registro: FollowRecord = {
    actorId: alvo.actorId,
    handle: alvo.handle,
    domain: alvo.domain,
    name: alvo.name,
    iconUrl: alvo.iconUrl,
    url: alvo.url,
    followActivityId: followId,
    createdAtMs: agora,
    manuallyApprovesFollowers: fechado,
    ...(fechado ? { status: 'pending' as const, requestedAtMs: agora } : {}),
  };
  await deps.saveFollow(uid, hash, registro);
  // Perfil aberto: "Seguindo" por antecipação. Fechado: pedido pendente, sem aresta alguma até o Accept.
  if (!fechado) await deps.saveEdges(uid, remoteUid);

  // O bilhete cordial só faz sentido num pedido (perfil fechado) e é melhor esforço: se falhar, o pedido já foi.
  let noteSent = false;
  const texto = fechado ? normalizeFollowNote(opcoes.note) : null;
  if (texto) {
    try {
      const sufixo = deps.nonce ? deps.nonce() : String(agora);
      const bilhete = buildDirectCreate({
        id: activityUrl(deps.origin, handle, `create-pedido-${hash}-${sufixo}`),
        noteId: activityUrl(deps.origin, handle, `note-pedido-${hash}-${sufixo}`),
        actorId: local,
        targetActorId: alvo.actorId,
        mentionHandle: alvo.handle,
        text: texto,
        publishedIso: new Date(agora).toISOString(),
      });
      const envio = await deps.deliver(inbox, bilhete);
      noteSent = envio.ok;
      if (noteSent) await deps.saveFollow(uid, hash, { ...registro, noteSentAtMs: deps.now() });
    } catch {
      noteSent = false;
    }
  }

  return ok(shapeOf(fechado ? 'requested' : 'following', fechado, { noteSent }));
}

/**
 * Deixa de seguir OU cancela o pedido (é o mesmo `Undo(Follow)`). O que é NOSSO sai primeiro e sempre; o aviso ao servidor remoto é melhor
 * esforço (`remote`: 'sent' | 'failed' | 'skipped'), então um servidor fora do ar não prende ninguém num "Seguindo" que não sai.
 */
export async function unfollowRemote(
  deps: OutboundFollowDeps,
  ref: { actorId: string; handle?: string; inbox: string | null },
): Promise<ServiceResult> {
  const { uid, handle } = deps.local;
  const hash = remoteFollowDocIdOf(ref.actorId);
  const remoteUid = remoteUserIdOf(ref.actorId);
  const existente = await deps.getFollow(uid, hash);

  await Promise.all([deps.deleteFollow(uid, hash), deps.deleteEdges(uid, remoteUid)]);

  let remote: 'sent' | 'failed' | 'skipped' = 'skipped';
  if (ref.inbox) {
    try {
      const agora = deps.now();
      const local = actorUrl(deps.origin, handle);
      const anterior = existente?.followActivityId || activityUrl(deps.origin, handle, `follow-${hash}`);
      const desfazer = buildUndo(activityUrl(deps.origin, handle, `undo-follow-${hash}-${agora}`), local, {
        id: anterior,
        type: 'Follow',
        actor: local,
        object: ref.actorId,
      });
      const entrega = await deps.deliver(ref.inbox, desfazer);
      remote = entrega.ok ? 'sent' : 'failed';
    } catch {
      remote = 'failed';
    }
  }
  return ok(shapeOf('none', existente?.manuallyApprovesFollowers === true, { remote }));
}
