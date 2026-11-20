// src/components/profile/UserListClientPage.tsx
'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { navigateBack } from '@/lib/backNavigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import UserListItem from '@/components/profile/UserListItem';
import type { User } from '@/lib/types';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { ArrowLeft, Heart, Repeat2, Users, Edit3, List, UserX, Search, X } from 'lucide-react';
import { getFollowersOfUser, getUsersFollowedBy, getUser as serverGetUser } from '@/lib/services/userService';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';

type FollowRelationFilter = 'all' | 'mutual' | 'followingOnly' | 'followerOnly';

// Define a mapping from string names to icon components
const iconMap = {
  heart: Heart,
  repeat: Repeat2,
  users: Users,
  default: Users,
  edit3: Edit3,
  list: List,
};

type IconName = keyof typeof iconMap;

interface UserListClientPageProps {
  // Option 1: Pass users directly (for Server Components like Likes/Reposts)
  users?: User[];
  
  // Option 2: Fetch users on client (for client-side navigation like Followers/Following)
  listType?: 'followers' | 'following';
  profileUserId?: string;
  remoteInteractionsUrl?: string;

  // Display props (some may be dynamic if fetching on client)
  pageTitle: string;
  pageDescription?: string;
  backLink: string;
  backLabel?: string;
  emptyStateText: string;
  iconName: IconName;
}

const ListSkeleton = () => (
    <CardContent className="p-0">
        <div className="border-t border-border p-4 space-y-4">
            {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center space-x-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-1/3" />
                        <Skeleton className="h-3 w-3/4" />
                    </div>
                </div>
            ))}
        </div>
    </CardContent>
);

export default function UserListClientPage({
  users: initialUsers,
  listType,
  profileUserId,
  pageTitle,
  pageDescription: initialPageDescription,
  backLink,
  backLabel: initialBackLabel,
  emptyStateText,
  iconName,
  remoteInteractionsUrl,
}: UserListClientPageProps) {
  const [userList, setUserList] = useState<User[]>(initialUsers || []);
  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(!initialUsers || Boolean(remoteInteractionsUrl));
  const [isRemoteRestricted, setIsRemoteRestricted] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [relationFilter, setRelationFilter] = useState<FollowRelationFilter>('all');
  const { currentUser, firebaseUser } = useCurrentUser();
  const router = useRouter();
  
  const tFollowers = useTranslations('FollowersPage');
  const tFollowing = useTranslations('FollowingPage');

  useEffect(() => {
    if (!remoteInteractionsUrl) return;
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        const headers: Record<string, string> = {};
        if (firebaseUser) {
          headers.Authorization = `Bearer ${await firebaseUser.getIdToken()}`;
        }
        const res = await fetch(remoteInteractionsUrl, { headers });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { users?: User[]; restricted?: boolean };
        if (cancelled) return;
        setIsRemoteRestricted(Boolean(data.restricted));
        if (!Array.isArray(data.users)) return;
        setUserList((prev) => {
          const map = new Map<string, User>();
          for (const u of prev) map.set(u.id, u);
          for (const u of data.users!) {
            if (!map.has(u.id)) map.set(u.id, u);
          }
          return Array.from(map.values());
        });
      } catch {
        // ignora falha silenciosa
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remoteInteractionsUrl, firebaseUser]);

  const fetchData = useCallback(async () => {
    if (initialUsers || !listType || !profileUserId) return;

    setIsLoading(true);
    try {
        const fetchedProfileUser = await serverGetUser(profileUserId, currentUser?.id || null);
        if (!fetchedProfileUser) {
            setProfileUser(null);
            setUserList([]);
            return;
        }
        setProfileUser(fetchedProfileUser);

        const isRemote =
          profileUserId.startsWith('ap_') ||
          Boolean((fetchedProfileUser as User & { isRemoteFediverse?: boolean }).isRemoteFediverse);

        const localPromise =
          listType === 'followers'
            ? getFollowersOfUser(profileUserId, currentUser?.id || null)
            : getUsersFollowedBy(profileUserId, currentUser?.id || null);

        const remotePromise: Promise<{ users: User[]; restricted: boolean }> = isRemote
          ? (async () => {
              try {
                const headers: Record<string, string> = {};
                if (firebaseUser) {
                  headers.Authorization = `Bearer ${await firebaseUser.getIdToken()}`;
                }
                const res = await fetch(
                  `/api/ap/remote-connections?userId=${encodeURIComponent(profileUserId)}&type=${listType}`,
                  { headers }
                );
                if (!res.ok) return { users: [], restricted: false };
                const data = (await res.json()) as { users?: User[]; restricted?: boolean };
                return {
                  users: Array.isArray(data.users) ? data.users : [],
                  restricted: Boolean(data.restricted),
                };
              } catch {
                return { users: [], restricted: false };
              }
            })()
          : Promise.resolve({ users: [], restricted: false });

        const [localUsers, remoteResult] = await Promise.all([localPromise, remotePromise]);
        setIsRemoteRestricted(remoteResult.restricted);
        const mergedMap = new Map<string, User>();
        for (const u of localUsers) {
          mergedMap.set(u.id, u);
        }
        for (const u of remoteResult.users) {
          if (!mergedMap.has(u.id)) {
            mergedMap.set(u.id, u);
          }
        }
        setUserList(Array.from(mergedMap.values()));
    } catch (error) {
        console.error(`Error fetching user list (${listType}):`, error);
    } finally {
        setIsLoading(false);
    }
  }, [initialUsers, profileUserId, currentUser?.id, listType]);
  
  useEffect(() => {
    if (!initialUsers) {
        fetchData();
    }
  }, [fetchData, initialUsers]);


  const handleFollowStateChangeInList = (updatedUser: User) => {
    setUserList(prevList =>
      prevList.map(user =>
        user.id === updatedUser.id ? { ...user, isFollowing: updatedUser.isFollowing } : user
      )
    );
  };
  
  const Icon = iconMap[iconName] || iconMap.default;

  const pageDescription = initialPageDescription ?? (profileUser 
    ? (listType === 'followers' ? tFollowers('description', { username: profileUser.username }) : tFollowing('description', { username: profileUser.username }))
    : '...');

  const showRelationFilters = Boolean(currentUser && (listType === 'followers' || listType === 'following'));

  const relationCounts = useMemo(() => {
    let mutual = 0;
    let followingOnly = 0;
    let followerOnly = 0;
    for (const u of userList) {
      const iFollow = Boolean(u.isFollowing);
      const followsMe = Boolean(u.isFollowedBy);
      if (iFollow && followsMe) mutual++;
      else if (iFollow && !followsMe) followingOnly++;
      else if (!iFollow && followsMe) followerOnly++;
    }
    return { all: userList.length, mutual, followingOnly, followerOnly };
  }, [userList]);

  const filteredUsers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return userList.filter((u) => {
      if (showRelationFilters && relationFilter !== 'all') {
        const iFollow = Boolean(u.isFollowing);
        const followsMe = Boolean(u.isFollowedBy);
        if (relationFilter === 'mutual' && !(iFollow && followsMe)) return false;
        if (relationFilter === 'followingOnly' && !(iFollow && !followsMe)) return false;
        if (relationFilter === 'followerOnly' && !(!iFollow && followsMe)) return false;
      }
      if (!q) return true;
      const name = (u.name || '').toLowerCase();
      const username = (u.username || '').toLowerCase();
      const bio = (u.bio || '').toLowerCase();
      return name.includes(q) || username.includes(q) || bio.includes(q);
    });
  }, [userList, searchTerm, showRelationFilters, relationFilter]);

  const finalEmptyStateText =
    userList.length === 0 && isRemoteRestricted
      ? (remoteInteractionsUrl
          ? 'A instância de origem no Fediverso não expôs publicamente a lista de quem interagiu.'
          : 'Este usuário do Fediverso mantém esta lista privada na instância de origem.')
      : !initialUsers && profileUser
        ? (listType === 'followers'
            ? tFollowers('emptyState', { username: profileUser.username })
            : tFollowing('emptyState', { username: profileUser.username }))
        : emptyStateText;

  const finalBackLabel = initialBackLabel ?? (profileUser
    ? (listType === 'followers' ? tFollowers('backLabel', { username: profileUser.username }) : tFollowing('backLabel', { username: profileUser.username }))
    : '...');

  return (
    <div className="container mx-auto max-w-xl py-8">
      <Button variant="ghost" onClick={() => navigateBack(router, { targetUrl: backLink })} className="mb-6 text-sm">
        <ArrowLeft className="mr-2 h-4 w-4" />
        {finalBackLabel}
      </Button>
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center text-xl">
            <Icon className="mr-3 h-6 w-6 text-primary" />
            {pageTitle}
          </CardTitle>
          <CardDescription>{pageDescription}</CardDescription>
          {!isLoading && userList.length > 0 && (
            <div className="relative pt-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 mt-1.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Pesquisar nesta lista por nome ou @usuário..."
                className="pl-9 pr-9"
                aria-label="Pesquisar usuários na lista"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 mt-1.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Limpar pesquisa"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
          {!isLoading && showRelationFilters && userList.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-3" role="group" aria-label="Filtrar por relação">
              {(
                [
                  { id: 'all', label: `Todos (${relationCounts.all})` },
                  { id: 'mutual', label: `Mútuos (${relationCounts.mutual})` },
                  { id: 'followingOnly', label: `Só você segue (${relationCounts.followingOnly})` },
                  { id: 'followerOnly', label: `Só te segue (${relationCounts.followerOnly})` },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setRelationFilter(opt.id)}
                  aria-pressed={relationFilter === opt.id}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-medium transition-colors border',
                    relationFilter === opt.id
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted hover:text-foreground',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </CardHeader>
        
        {isLoading ? <ListSkeleton /> : (
            <CardContent className="p-0">
                {filteredUsers.length > 0 ? (
                    <div className="border-t border-border divide-y divide-border">
                    {filteredUsers.map(user => (
                        <UserListItem
                          key={user.id}
                          userToList={user}
                          activeUserId={currentUser?.id || null}
                          onFollowStateChange={handleFollowStateChangeInList}
                        />
                    ))}
                    </div>
                ) : userList.length > 0 && (searchTerm.trim() || relationFilter !== 'all') ? (
                    <div className="p-6 text-center text-muted-foreground border-t">
                       <Search className="mx-auto h-10 w-10 mb-3 opacity-50" />
                       <p>
                         {searchTerm.trim()
                           ? <>Nenhuma pessoa encontrada para &ldquo;{searchTerm.trim()}&rdquo;.</>
                           : 'Nenhuma pessoa encontrada neste filtro.'}
                       </p>
                    </div>
                ) : (
                    <div className="p-6 text-center text-muted-foreground border-t">
                       <UserX className="mx-auto h-12 w-12 mb-4 opacity-50" />
                       <p>{finalEmptyStateText}</p>
                    </div>
                )}
            </CardContent>
        )}
      </Card>
    </div>
  );
}
