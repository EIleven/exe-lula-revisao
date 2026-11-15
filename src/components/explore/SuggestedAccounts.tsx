// src/components/explore/SuggestedAccounts.tsx
'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getSuggestedUsers } from '@/lib/services/userService';
import type { User } from '@/lib/types';
import UserListItem from '../profile/UserListItem';
import { Skeleton } from '../ui/skeleton';
import { useCurrentUserId } from '@/contexts/CurrentUserContext';
import { FOLLOW_STATE_EVENT, type FollowStateEventDetail } from '@/lib/events/followState';
import { BRAZIL_COMMUNITY_TYPES, BRAZIL_STATES, type ExplorePreferences } from '@/lib/constants/brazilLocations';

interface SuggestedAccountsProps {
  preferences?: ExplorePreferences;
}

export default function SuggestedAccounts({ preferences }: SuggestedAccountsProps) {
  const [suggestedUsers, setSuggestedUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const requestIdRef = useRef(0);
  const currentUserId = useCurrentUserId();

  const fetchSuggestions = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    try {
      const users = await getSuggestedUsers(currentUserId, 15);
      const filteredUsers = users.filter(
        (user) =>
          (!currentUserId || user.id !== currentUserId) &&
          !user.username?.toLowerCase().endsWith('@instancia.org') &&
          user.name !== '@usuario@instancia.org',
      );
      if (requestId === requestIdRef.current) setSuggestedUsers(filteredUsers);
    } catch (error) {
      console.error('Failed to fetch suggested accounts:', error);
      if (requestId === requestIdRef.current) setSuggestedUsers([]);
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    setShowAll(false);
    void fetchSuggestions();
    return () => {
      requestIdRef.current += 1;
    };
  }, [fetchSuggestions]);

  useEffect(() => {
    const syncFollowState = (event: Event) => {
      const detail = (event as CustomEvent<FollowStateEventDetail>).detail;
      if (detail.activeUserId !== currentUserId || !detail.isFollowing) return;
      setSuggestedUsers((users) => users.filter((user) => user.id !== detail.targetUserId));
    };
    window.addEventListener(FOLLOW_STATE_EVENT, syncFollowState);
    return () => window.removeEventListener(FOLLOW_STATE_EVENT, syncFollowState);
  }, [currentUserId]);

  const prioritizedUsers = useMemo(() => {
    if (!preferences?.useLocalLocation) return suggestedUsers;
    const stateObj = BRAZIL_STATES.find((s) => s.code === preferences.stateCode);
    const stateName = stateObj && stateObj.code !== 'BR' ? stateObj.name.replace(/\s*\([A-Z]{2}\)$/, '').toLowerCase() : '';
    const city = preferences.city.trim().toLowerCase();
    const communityName = preferences.communityName.trim().toLowerCase();
    const communityKeywords =
      BRAZIL_COMMUNITY_TYPES.find((c) => c.id === preferences.communityType)?.keywords || [];

    const scoreUser = (u: User) => {
      const hay = `${u.location || ''} ${u.bio || ''} ${u.name || ''}`.toLowerCase();
      let score = 0;
      if (city && hay.includes(city)) score += 3;
      if (stateName && (hay.includes(stateName) || hay.includes(preferences.stateCode.toLowerCase()))) score += 2;
      if (communityName && hay.includes(communityName)) score += 3;
      if (communityKeywords.some((kw) => hay.includes(kw))) score += 2;
      return score;
    };

    return [...suggestedUsers].sort((a, b) => scoreUser(b) - scoreUser(a));
  }, [suggestedUsers, preferences]);

  const handleFollowStateChange = (updatedUser: User) => {
    setSuggestedUsers((prevUsers) =>
      updatedUser.isFollowing
        ? prevUsers.filter((user) => user.id !== updatedUser.id)
        : prevUsers.map((user) => (user.id === updatedUser.id ? { ...user, ...updatedUser } : user))
    );
  };

  const visibleUsers = showAll ? prioritizedUsers.slice(0, 10) : prioritizedUsers.slice(0, 3);

  return (
    <section aria-labelledby="who-to-follow-title">
      <div className="flex items-center justify-between px-4 pt-3.5 pb-1">
        <h2 id="who-to-follow-title" className="text-base font-bold text-foreground">
          Quem seguir
        </h2>
        {prioritizedUsers.length > 3 && (
          <button
            type="button"
            onClick={() => setShowAll((prev) => !prev)}
            className="text-xs font-medium text-primary hover:underline"
          >
            {showAll ? 'Mostrar menos' : 'Mostrar mais'}
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="divide-y divide-border/50">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex items-center space-x-3 px-4 py-3">
              <Skeleton className="h-10 w-10 rounded-full shrink-0" />
              <div className="space-y-2 flex-1 min-w-0">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-8 w-20 rounded-full shrink-0" />
            </div>
          ))}
        </div>
      ) : visibleUsers.length > 0 ? (
        <div className="divide-y divide-border/50">
          {visibleUsers.map((user) => (
            <div key={user.id} className="px-2">
              <UserListItem
                userToList={user}
                activeUserId={currentUserId}
                onFollowStateChange={handleFollowStateChange}
              />
            </div>
          ))}
        </div>
      ) : (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          Nenhuma sugestão no momento.
        </p>
      )}
    </section>
  );
}
