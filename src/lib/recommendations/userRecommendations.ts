import type { RecommendationPreferences, User, UserRecommendationReason } from '@/lib/types';
import { DEFAULT_RECOMMENDATION_PREFERENCES } from './preferences';

export interface UserRecommendationSignals {
  userId: string;
  followsViewer: boolean;
  mutualCount: number;
  affinityByTopic: Record<string, number>;
  recentPosts: number;
  followersCount: number;
  postsCount: number;
  profileComplete: boolean;
}

export interface RankedUserRecommendation extends UserRecommendationSignals {
  score: number;
  reason: UserRecommendationReason;
}

const bestAffinity = (affinityByTopic: Record<string, number>) =>
  Object.entries(affinityByTopic)
    .filter(([topic, weight]) => topic.trim().length > 0 && Number.isFinite(weight) && weight > 0)
    .sort(([topicA, weightA], [topicB, weightB]) => weightB - weightA || topicA.localeCompare(topicB))[0];

/**
 * Ordena sugestões com sinais que a própria rede produz, respeitando as preferências configuradas pelo usuário.
 * Relações diretas pesam mais que popularidade, evitando que a descoberta vire apenas um ranking das maiores contas.
 * O desempate é estável para a lista não "pular" a cada render.
 */
export function rankUserRecommendations(
  signals: UserRecommendationSignals[],
  limit: number,
  prefs: RecommendationPreferences = DEFAULT_RECOMMENDATION_PREFERENCES,
): RankedUserRecommendation[] {
  if (!prefs.enabled || limit <= 0) return [];

  const allowGraph = prefs.useFollowingSignals !== false;
  const allowInterests = prefs.useInterestSignals !== false;
  const allowActivity = prefs.useActivitySignals !== false;
  const similarBoost = prefs.mode === 'similar' ? 1.5 : prefs.mode === 'discovery' ? 0.75 : 1;
  const popularityWeight = prefs.mode === 'discovery' ? 1 : 3;
  const activityWeight = prefs.mode === 'discovery' ? 4 : 2;

  return signals
    .map((candidate) => {
      const affinity = allowInterests ? bestAffinity(candidate.affinityByTopic) : undefined;
      const affinityWeight = affinity?.[1] ?? 0;
      const effectiveFollowsViewer = allowGraph && candidate.followsViewer;
      const effectiveMutualCount = allowGraph ? candidate.mutualCount : 0;
      const effectiveRecentPosts = allowActivity ? candidate.recentPosts : 0;

      const score =
        (effectiveFollowsViewer ? 56 : 0)
        + Math.min(effectiveMutualCount, 5) * 30 * similarBoost
        + Math.min(affinityWeight, 50) * similarBoost
        + Math.min(effectiveRecentPosts, 6) * activityWeight
        + Math.min(Math.log2(Math.max(0, candidate.followersCount) + 1) * popularityWeight, 18)
        + Math.min(Math.log2(Math.max(0, candidate.postsCount) + 1), 4)
        + (candidate.profileComplete ? 2 : 0);

      let reason: UserRecommendationReason;
      if (effectiveFollowsViewer) reason = { kind: 'follows-you' };
      else if (effectiveMutualCount > 0) reason = { kind: 'mutual', count: effectiveMutualCount };
      else if (affinity) reason = { kind: 'interest', topic: affinity[0] };
      else if (effectiveRecentPosts > 0) reason = { kind: 'active' };
      else reason = { kind: 'popular' };

      return { ...candidate, score, reason };
    })
    .sort((a, b) =>
      b.score - a.score
      || Number(b.followsViewer) - Number(a.followsViewer)
      || b.mutualCount - a.mutualCount
      || b.recentPosts - a.recentPosts
      || b.followersCount - a.followersCount
      || a.userId.localeCompare(b.userId),
    )
    .slice(0, Math.max(0, limit));
}

const STOP_WORDS = new Set([
  'para', 'como', 'mais', 'sobre', 'entre', 'com', 'sem', 'por', 'que', 'dos', 'das', 'uma', 'uns', 'umas',
  'from', 'with', 'that', 'this', 'have', 'here', 'meu', 'minha', 'seu', 'sua', 'aqui', 'tudo', 'cada',
]);

function extractProfileTokens(user: Pick<User, 'bio' | 'name' | 'username' | 'location'>): Set<string> {
  const raw = `${user.bio || ''} ${user.location || ''} ${user.name || ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const tokens = new Set<string>();
  const matches = raw.match(/#?[a-z0-9_]{3,32}/g) ?? [];
  for (const token of matches) {
    const clean = token.startsWith('#') ? token.slice(1) : token;
    if (clean.length >= 3 && !STOP_WORDS.has(clean) && !/^\d+$/.test(clean)) {
      tokens.add(clean);
    }
  }
  return tokens;
}

function fediverseDomainOf(user: Pick<User, 'id' | 'username'>): string | null {
  const atIdx = (user.username || '').lastIndexOf('@');
  if (atIdx > 0) return user.username.slice(atIdx + 1).toLowerCase();
  return null;
}

export function matchesNetworkScope(
  user: Pick<User, 'id' | 'username'>,
  scope: RecommendationPreferences['networkScope'],
): boolean {
  const isRemote = user.id.startsWith('ap_') || (user.username || '').includes('@');
  if (scope === 'local') return !isRemote;
  if (scope === 'fediverse') return isRemote;
  return true;
}

/**
 * Classifica perfis relacionados ao perfil visitado (`targetUser`), respeitando estritamente
 * as permissões de análise do usuário que está navegando (`prefs`).
 */
export function rankRelatedProfiles(
  targetUser: User,
  candidates: User[],
  prefs: RecommendationPreferences = DEFAULT_RECOMMENDATION_PREFERENCES,
  limit = 6,
): User[] {
  if (!prefs.enabled || !prefs.showOnProfiles || limit <= 0) return [];

  const targetTokens = prefs.useInterestSignals ? extractProfileTokens(targetUser) : new Set<string>();
  const targetDomain = fediverseDomainOf(targetUser);
  const allowActivity = prefs.useActivitySignals !== false;
  const allowInterests = prefs.useInterestSignals !== false;

  const scored = candidates
    .filter((candidate) => {
      if (!candidate || candidate.id === targetUser.id) return false;
      if (candidate.recommendationPreferences?.optOutFromSuggestions) return false;
      if (candidate.isBlocked || candidate.hasBlockedCurrentUser || candidate.isMuted || candidate.isFollowing) return false;
      if (!matchesNetworkScope(candidate, prefs.networkScope)) return false;
      return true;
    })
    .map((candidate) => {
      let score = 0;
      let sharedTopic: string | undefined;

      if (allowInterests && targetTokens.size > 0) {
        const candidateTokens = extractProfileTokens(candidate);
        let sharedCount = 0;
        for (const t of targetTokens) {
          if (candidateTokens.has(t)) {
            sharedCount++;
            if (!sharedTopic) sharedTopic = t;
          }
        }
        score += Math.min(sharedCount, 6) * (prefs.mode === 'similar' ? 22 : 15);
      }

      const candidateDomain = fediverseDomainOf(candidate);
      const sameDomain = Boolean(targetDomain && candidateDomain && targetDomain === candidateDomain);
      if (sameDomain) {
        score += prefs.mode === 'discovery' ? 8 : 18;
      } else if (!targetDomain && !candidateDomain) {
        score += 6;
      }

      if (prefs.useFollowingSignals && candidate.isFollowedBy) {
        score += 24;
      }

      if (allowActivity) {
        score += Math.min(Math.log2(Math.max(0, candidate.postsCount || 0) + 1) * 2, 10);
      }

      if (prefs.mode === 'discovery') {
        // Valoriza vozes menos saturadas no modo descoberta
        const followers = Math.max(0, candidate.followersCount || 0);
        if (followers < 2000) score += 10;
      } else {
        score += Math.min(Math.log2(Math.max(0, candidate.followersCount || 0) + 1) * 1.5, 8);
      }

      if (candidate.avatarUrl && candidate.bio) score += 4;

      const reason: UserRecommendationReason = sharedTopic
        ? { kind: 'related-profile', label: `#${sharedTopic}` }
        : sameDomain && candidateDomain
          ? { kind: 'related-profile', label: candidateDomain }
          : candidate.isFollowedBy
            ? { kind: 'follows-you' }
            : { kind: 'active' };

      return {
        user: { ...candidate, recommendationReason: reason },
        score,
      };
    })
    .sort((a, b) => b.score - a.score || a.user.id.localeCompare(b.user.id))
    .slice(0, limit)
    .map((entry) => entry.user);

  return scored;
}
