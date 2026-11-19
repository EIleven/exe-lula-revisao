import { invalidateFollowedIds } from '../services/followedIdsCache';

export const FOLLOW_STATE_EVENT = 'soberan:follow-state';

export interface FollowStateEventDetail {
  activeUserId: string;
  targetUserId: string;
  isFollowing: boolean;
  /** Perfil do Fediverso fechado: o pedido de seguir foi enviado e ainda não foi aceito (`isFollowing` segue false). */
  followRequested?: boolean;
  followersCount?: number;
}

const followCache = new Map<string, { isFollowing: boolean; followRequested?: boolean; followersCount?: number }>();

export function getCachedFollowState(
  activeUserId: string | null | undefined,
  targetUserId: string | null | undefined
): { isFollowing: boolean; followRequested?: boolean; followersCount?: number } | undefined {
  if (!activeUserId || !targetUserId) return undefined;
  return followCache.get(`${activeUserId}:${targetUserId}`);
}

/** Sincroniza listas e cartões abertos nesta aba somente depois de o Firestore confirmar a relação. */
export function dispatchFollowState(detail: FollowStateEventDetail): void {
  // Seguir ou deixar de seguir muda quem aparece no feed "Seguindo": a lista guardada deixa de valer.
  invalidateFollowedIds(detail.activeUserId);
  if (typeof window === 'undefined') return;
  followCache.set(`${detail.activeUserId}:${detail.targetUserId}`, {
    isFollowing: detail.isFollowing,
    followRequested: detail.followRequested,
    followersCount: detail.followersCount,
  });
  window.dispatchEvent(new CustomEvent<FollowStateEventDetail>(FOLLOW_STATE_EVENT, { detail }));
}
