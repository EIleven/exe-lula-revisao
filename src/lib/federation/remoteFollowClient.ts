'use client';

// Cliente do navegador para seguir / pedir para seguir / cancelar / deixar de seguir um perfil do Fediverso (POST /api/ap/follow).
import { auth } from '@/lib/firebase';
import { invalidateAfterFollowChange } from '@/lib/services/userService';
import { dispatchFollowState } from '@/lib/events/followState';

export type RemoteFollowView = 'none' | 'requested' | 'following';

export type RemoteFollowResult = {
  view: RemoteFollowView;
  /** O perfil aprova seguidores manualmente. */
  closed: boolean;
  /** O bilhete cordial foi entregue (só existe em pedido a perfil fechado). */
  noteSent: boolean;
  /** Já estava neste estado: a rota não enviou nada de novo. */
  already: boolean;
  /** Ao sair: o aviso ao servidor remoto foi entregue, falhou ou nem foi tentado. */
  remote: 'sent' | 'failed' | 'skipped' | null;
};

/** Erro com o código estável da API (ex.: "federacao-nao-ativada"), que a tela traduz. */
export class RemoteFollowError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export type RemoteFollowInput = {
  targetUserId: string;
  handle?: string;
  action: 'follow' | 'unfollow' | 'cancel';
  /** Bilhete cordial privado (só vale em pedido a perfil fechado; o servidor ignora nos demais). */
  note?: string;
};

export function viewOfFlags(flags: { isFollowing?: boolean | null; followRequested?: boolean | null } | null | undefined): RemoteFollowView {
  if (flags?.isFollowing) return 'following';
  if (flags?.followRequested) return 'requested';
  return 'none';
}

/** Um clique de uma pessoa, uma chamada. Atualiza os caches e avisa os outros botões da mesma tela do novo estado. */
export async function callRemoteFollow(activeUserId: string, input: RemoteFollowInput): Promise<RemoteFollowResult> {
  const token = await auth.currentUser?.getIdToken().catch(() => null);
  if (!token) throw new RemoteFollowError('login-obrigatorio', 401);
  const res = await fetch('/api/ap/follow', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new RemoteFollowError(typeof data.error === 'string' ? data.error : 'erro-desconhecido', res.status);

  const view: RemoteFollowView = data.view === 'requested' || data.view === 'following' ? data.view : data.following === true ? 'following' : 'none';
  const result: RemoteFollowResult = {
    view,
    closed: data.closed === true,
    noteSent: data.noteSent === true,
    already: data.already === true,
    remote: data.remote === 'sent' || data.remote === 'failed' || data.remote === 'skipped' ? data.remote : null,
  };
  invalidateAfterFollowChange(activeUserId, input.targetUserId);
  dispatchFollowState({ activeUserId, targetUserId: input.targetUserId, isFollowing: view === 'following', followRequested: view === 'requested' });
  return result;
}
