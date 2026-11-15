import type { UserRecommendationReason } from '@/lib/types';

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
 * Ordena sugestões com sinais que a própria rede produz. Relações diretas pesam mais que popularidade, evitando que a
 * descoberta vire apenas um ranking das maiores contas. O desempate é estável para a lista não "pular" a cada render.
 */
export function rankUserRecommendations(
  signals: UserRecommendationSignals[],
  limit: number,
): RankedUserRecommendation[] {
  return signals
    .map((candidate) => {
      const affinity = bestAffinity(candidate.affinityByTopic);
      const affinityWeight = affinity?.[1] ?? 0;
      const score =
        (candidate.followsViewer ? 56 : 0)
        + Math.min(candidate.mutualCount, 5) * 30
        + Math.min(affinityWeight, 50)
        + Math.min(candidate.recentPosts, 6) * 2
        + Math.min(Math.log2(Math.max(0, candidate.followersCount) + 1) * 3, 18)
        + Math.min(Math.log2(Math.max(0, candidate.postsCount) + 1), 4)
        + (candidate.profileComplete ? 2 : 0);

      let reason: UserRecommendationReason;
      if (candidate.followsViewer) reason = { kind: 'follows-you' };
      else if (candidate.mutualCount > 0) reason = { kind: 'mutual', count: candidate.mutualCount };
      else if (affinity) reason = { kind: 'interest', topic: affinity[0] };
      else if (candidate.recentPosts > 0) reason = { kind: 'active' };
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
