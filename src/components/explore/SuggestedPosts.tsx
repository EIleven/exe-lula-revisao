// src/components/explore/SuggestedPosts.tsx
'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import type { Timestamp } from 'firebase/firestore';
import { fetchPaginatedPosts, searchPosts } from '@/lib/services/postReadService';
import type { Post } from '@/lib/types';
import { getFeedContentKey } from '@/lib/feedUtils';
import PostCard from '../feed/PostCard';
import PostCardSkeleton from '../feed/PostCardSkeleton';
import FeedContainer from '../feed/FeedContainer';
import { useCurrentUserId } from '@/contexts/CurrentUserContext';
import {
  BRAZIL_COMMUNITY_TYPES,
  BRAZIL_STATES,
  type ExplorePreferences,
} from '@/lib/constants/brazilLocations';

interface ActiveExploreTopic {
  id: string;
  label: string;
  keywords: string[];
}

interface SuggestedPostsProps {
  newsCategory?: string;
  preferences?: ExplorePreferences;
  communityFilterId?: string;
  activeTopic?: ActiveExploreTopic;
}

export default function SuggestedPosts({
  newsCategory,
  preferences,
  communityFilterId,
  activeTopic,
}: SuggestedPostsProps) {
  const [suggestedPosts, setSuggestedPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<Timestamp | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const requestIdRef = useRef(0);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const currentUserId = useCurrentUserId();

  const topicKeywords = useMemo(() => {
    if (activeTopic && activeTopic.keywords.length > 0) return activeTopic.keywords;
    if (communityFilterId && communityFilterId !== 'all') {
      return BRAZIL_COMMUNITY_TYPES.find((c) => c.id === communityFilterId)?.keywords || [];
    }
    return [];
  }, [activeTopic, communityFilterId]);

  const topicSearchKey = topicKeywords.join('|');

  const fetchPosts = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    // Atualizar enquanto uma página extra carrega invalida aquele pedido: ele não aplica o resultado e, por ter outro
    // `requestId`, também não desliga o indicador. Sem desligar aqui, `isLoadingMore` ficava preso em true e a rolagem
    // infinita parava de vez.
    setIsLoadingMore(false);
    setNextCursor(null);
    setHasMore(false);
    try {
      if (topicKeywords.length > 0) {
        // Busca referências reais do tema/hashtag selecionado + posts recentes do explorar
        const searchTerms = topicKeywords.slice(0, 2);
        const [searchBatches, exploreRes] = await Promise.all([
          Promise.all(
            searchTerms.map((term) => searchPosts(term, currentUserId, 'latest').catch(() => [] as Post[]))
          ),
          fetchPaginatedPosts(null, 30, currentUserId, { feedContext: 'explore' }),
        ]);

        // A chave é a do conteúdo (e não o id): o mesmo post do Fediverso pode existir com dois ids locais.
        const merged = new Map<string, Post>();
        for (const batch of searchBatches) {
          for (const item of batch) {
            if ('type' in item && !merged.has(getFeedContentKey(item))) {
              merged.set(getFeedContentKey(item), item);
            }
          }
        }
        for (const item of exploreRes.posts) {
          if ('type' in item && !merged.has(getFeedContentKey(item))) {
            merged.set(getFeedContentKey(item), item);
          }
        }

        if (requestId === requestIdRef.current) {
          setSuggestedPosts(Array.from(merged.values()));
          setNextCursor(null);
          setHasMore(false);
        }
        return;
      }

      const response = newsCategory
        ? await fetchPaginatedPosts(null, 15, currentUserId, {
            feedContext: 'articles',
            newsCategory,
          })
        : await fetchPaginatedPosts(null, 20, currentUserId, { feedContext: 'explore' });
      const posts = response.posts.filter((item): item is Post => 'type' in item);
      if (requestId === requestIdRef.current) {
        setSuggestedPosts(posts);
        setNextCursor((response.nextCursor as Timestamp | null) ?? null);
        setHasMore(response.hasMore);
      }
    } catch (error) {
      console.error('Failed to fetch suggested posts:', error);
      if (requestId === requestIdRef.current) setSuggestedPosts([]);
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [newsCategory, currentUserId, topicSearchKey]);

  const loadMorePosts = useCallback(async () => {
    if (isLoading || isLoadingMore || !hasMore || !nextCursor) return;
    const requestId = requestIdRef.current;
    setIsLoadingMore(true);
    try {
      const response = newsCategory
        ? await fetchPaginatedPosts(nextCursor, 15, currentUserId, {
            feedContext: 'articles',
            newsCategory,
          })
        : await fetchPaginatedPosts(nextCursor, 20, currentUserId, { feedContext: 'explore' });
      const more = response.posts.filter((item): item is Post => 'type' in item);
      if (requestId !== requestIdRef.current) return;
      setSuggestedPosts((prev) => {
        const seen = new Set(prev.map(getFeedContentKey));
        const unique = more.filter((p) => {
          const key = getFeedContentKey(p);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return [...prev, ...unique];
      });
      setNextCursor((response.nextCursor as Timestamp | null) ?? null);
      setHasMore(response.hasMore);
    } catch (error) {
      console.error('Failed to load more suggested posts:', error);
    } finally {
      if (requestId === requestIdRef.current) setIsLoadingMore(false);
    }
  }, [isLoading, isLoadingMore, hasMore, nextCursor, newsCategory, currentUserId]);

  useEffect(() => {
    void fetchPosts();
    return () => {
      requestIdRef.current += 1;
    };
  }, [fetchPosts]);

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadMorePosts();
        }
      },
      { rootMargin: '300px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadMorePosts]);

  const orderedPosts = useMemo(() => {
    const prefCommunityKeywords =
      topicKeywords.length > 0
        ? topicKeywords
        : preferences?.useLocalLocation && preferences.communityType !== 'all'
        ? BRAZIL_COMMUNITY_TYPES.find((c) => c.id === preferences.communityType)?.keywords || []
        : [];

    const stateObj =
      preferences?.useLocalLocation && preferences.stateCode !== 'BR'
        ? BRAZIL_STATES.find((s) => s.code === preferences.stateCode)
        : undefined;
    const stateName = stateObj ? stateObj.name.replace(/\s*\([A-Z]{2}\)$/, '').toLowerCase() : '';
    const city = preferences?.useLocalLocation ? preferences.city.trim().toLowerCase() : '';
    const communityName = preferences?.useLocalLocation
      ? preferences.communityName.trim().toLowerCase()
      : '';

    const hasAnyFilter =
      Boolean(stateName || city || communityName) || prefCommunityKeywords.length > 0;
    if (!hasAnyFilter) return suggestedPosts;

    const matchKeyword = (hay: string, hashtags: string[], kw: string) => {
      const normalized = kw.trim().toLowerCase();
      if (!normalized) return false;
      if (normalized.startsWith('#')) {
        const tag = normalized.slice(1);
        return hashtags.includes(tag) || hay.includes(normalized) || hay.includes(`#${tag}`);
      }
      return hay.includes(normalized) || hashtags.includes(normalized);
    };

    const scorePost = (post: Post) => {
      const hashtags = (post.hashtags || []).map((h) => h.toLowerCase());
      const hay = `${post.text || ''} ${post.headline || ''} ${post.newsCategory || ''} ${hashtags.join(' ')} ${post.location?.name || ''} ${post.location?.state || ''} ${post.user?.name || ''} ${post.user?.username || ''} ${post.user?.location || ''}`.toLowerCase();
      let score = 0;
      if (city && (hay.includes(city) || post.location?.name?.toLowerCase() === city)) score += 4;
      if (
        stateName &&
        (post.location?.state?.toLowerCase() === preferences!.stateCode.toLowerCase() ||
          hay.includes(stateName) ||
          hay.includes(preferences!.stateCode.toLowerCase()))
      ) {
        score += 3;
      }
      if (communityName && hay.includes(communityName)) score += 4;
      for (const kw of prefCommunityKeywords) {
        if (matchKeyword(hay, hashtags, kw)) score += 5;
      }
      return score;
    };

    if (topicKeywords.length > 0) {
      // Filtro estrito para balõezinhos: só mostra posts que realmente citam o tema, hashtag ou notícia.
      return suggestedPosts
        .filter((post) => {
          const hashtags = (post.hashtags || []).map((h) => h.toLowerCase());
          const hay = `${post.text || ''} ${post.headline || ''} ${post.newsCategory || ''} ${hashtags.join(' ')} ${post.location?.name || ''} ${post.user?.name || ''} ${post.user?.username || ''} ${post.user?.location || ''}`.toLowerCase();
          return topicKeywords.some((kw) => matchKeyword(hay, hashtags, kw));
        })
        .sort((a, b) => scorePost(b) - scorePost(a));
    }

    return [...suggestedPosts].sort((a, b) => scorePost(b) - scorePost(a));
  }, [suggestedPosts, preferences, topicKeywords]);

  return (
    <FeedContainer onRefresh={fetchPosts}>
      <section aria-label="Publicações sugeridas" className="pb-24 sm:pb-8">
        <div className="divide-y divide-border/60">
          {isLoading ? (
            <div>
              {[...Array(3)].map((_, i) => (
                <PostCardSkeleton key={i} />
              ))}
            </div>
          ) : orderedPosts.length > 0 ? (
            <>
              {orderedPosts.map((post) => <PostCard key={post.id} post={post} />)}
              <div ref={loadMoreRef} className="flex justify-center py-6">
                {isLoadingMore && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
              </div>
            </>
          ) : (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              {activeTopic
                ? `Nenhuma publicação encontrada sobre "${activeTopic.label}" no momento.`
                : 'Nenhuma publicação encontrada para este filtro no momento.'}
            </p>
          )}
        </div>
      </section>
    </FeedContainer>
  );
}
