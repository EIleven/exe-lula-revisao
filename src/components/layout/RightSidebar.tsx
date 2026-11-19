// src/components/layout/RightSidebar.tsx
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowUpRight, Newspaper, SlidersHorizontal, TrendingUp, Users } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import UserListItem from '@/components/profile/UserListItem';
import UserProfileHoverCard from '@/components/profile/UserProfileHoverCard';
import TopNewsItem from '@/components/trending/TopNewsItem';
import RecommendationSettingsDialog from '@/components/recommendations/RecommendationSettingsDialog';
import { useCurrentUserId } from '@/contexts/CurrentUserContext';
import { useMediaQuery } from '@/hooks/use-media-query';
import { fetchPaginatedPosts } from '@/lib/services/postReadService';
import { getTrendingTopics } from '@/lib/services/hashtagService';
import { getSuggestedUsers } from '@/lib/services/userService';
import type { Post, RecommendationPreferences, User } from '@/lib/types';
import { deepCopyPost } from '@/lib/utils/dataTransformers';
import { FOLLOW_STATE_EVENT, type FollowStateEventDetail } from '@/lib/events/followState';
import { readRecommendationPreferences, REC_PREFS_EVENT } from '@/lib/recommendations/preferences';

type SidebarTopic = { topic: string; count: number; topUsers: User[] };

function SectionHeading({
  icon: Icon,
  title,
  description,
  href,
  linkLabel,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <CardHeader className="px-0 pb-2 pt-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center text-base">
            <Icon className="mr-2 h-4 w-4 text-primary" aria-hidden="true" />
            {title}
          </CardTitle>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {linkLabel}
          <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
    </CardHeader>
  );
}

function SidebarContentSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <div className="space-y-3 border-b border-border/70 pb-5">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-3 w-52" />
        <div className="flex flex-wrap gap-2">
          {[36, 44, 32, 48, 40, 36].map((width, index) => (
            <Skeleton key={index} className="h-7 rounded-full" style={{ width: `${width * 2}px` }} />
          ))}
        </div>
      </div>
      <div className="space-y-3 border-b border-border/70 pb-5">
        <Skeleton className="h-5 w-36" />
        {[...Array(3)].map((_, index) => (
          <div key={index} className="flex items-center gap-3 py-1">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
        ))}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-5 w-32" />
        {[...Array(3)].map((_, index) => (
          <div key={index} className="flex gap-3 py-2">
            <Skeleton className="h-[76px] w-[76px] rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RightSidebar() {
  const [clientHasMounted, setClientHasMounted] = useState(false);
  const [trendingTopics, setTrendingTopics] = useState<SidebarTopic[]>([]);
  const [topNewsItems, setTopNewsItems] = useState<Post[]>([]);
  const [suggestedUsers, setSuggestedUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [recPrefs, setRecPrefs] = useState<RecommendationPreferences>(() => readRecommendationPreferences());
  const [recDialogOpen, setRecDialogOpen] = useState(false);
  const locale = useLocale();
  const t = useTranslations('RightSidebar');
  // Só o id: um seguidor novo ou uma mensagem não lida não pode refazer as três leituras da barra lateral.
  const currentUserId = useCurrentUserId();
  // A barra lateral só aparece a partir de 1100 px: no celular ela nem busca conteúdo.
  const isVisible = useMediaQuery('(min-width: 1100px)');

  useEffect(() => {
    setClientHasMounted(true);
  }, []);

  const fetchSidebarContent = useCallback(async () => {
    setIsLoading(true);
    try {
      const [topics, newsResponse, usersResponse] = await Promise.all([
        getTrendingTopics(8),
        fetchPaginatedPosts(null, 5, null, { feedContext: 'articles' }),
        recPrefs.enabled ? getSuggestedUsers(currentUserId, 3, recPrefs) : Promise.resolve([]),
      ]);
      setTrendingTopics(topics);
      setTopNewsItems(
        newsResponse.posts
          .filter((item): item is Post => 'type' in item)
          .slice(0, 5)
          .map((item) => deepCopyPost(item)!),
      );
      setSuggestedUsers(usersResponse);
    } catch (error) {
      console.error('RightSidebar: Failed to fetch content:', error);
      setTrendingTopics([]);
      setTopNewsItems([]);
      setSuggestedUsers([]);
    } finally {
      setIsLoading(false);
    }
  }, [currentUserId, recPrefs]);

  useEffect(() => {
    const onPrefsChanged = (event: Event) => {
      const detail = (event as CustomEvent<RecommendationPreferences>).detail;
      if (detail) setRecPrefs(detail);
    };
    window.addEventListener(REC_PREFS_EVENT, onPrefsChanged);
    return () => window.removeEventListener(REC_PREFS_EVENT, onPrefsChanged);
  }, []);

  useEffect(() => {
    if (clientHasMounted && isVisible) void fetchSidebarContent();
  }, [clientHasMounted, isVisible, fetchSidebarContent]);

  useEffect(() => {
    const syncFollowState = (event: Event) => {
      const detail = (event as CustomEvent<FollowStateEventDetail>).detail;
      if (detail.activeUserId !== currentUserId || !detail.isFollowing) return;
      setSuggestedUsers((users) => users.filter((user) => user.id !== detail.targetUserId));
    };
    window.addEventListener(FOLLOW_STATE_EVENT, syncFollowState);
    return () => window.removeEventListener(FOLLOW_STATE_EVENT, syncFollowState);
  }, [currentUserId]);

  // Seguir alguém atualiza apenas essa linha. Refazer tendências, artigos e sugestões inteiras tornava o toque mais caro.
  const handleFollowStateChange = (updatedUser: User) => {
    setSuggestedUsers((users) => updatedUser.isFollowing
      ? users.filter((user) => user.id !== updatedUser.id)
      : users.map((user) => user.id === updatedUser.id ? { ...user, ...updatedUser } : user));
  };

  const asideClassName = 'sticky top-0 hidden h-screen w-[var(--sidebar-right-width)] flex-shrink-0 overflow-y-auto border-l border-border px-4 py-5 min-[1100px]:block no-scrollbar';

  if (!clientHasMounted || isLoading) {
    return (
      <aside className={asideClassName} aria-label={t('sidebarLabel')}>
        <SidebarContentSkeleton />
      </aside>
    );
  }

  return (
    <aside className={asideClassName} aria-label={t('sidebarLabel')}>
      <div className="space-y-5">
        <Card className="rounded-none border-x-0 border-t-0 bg-transparent pb-5 shadow-none">
          <SectionHeading
            icon={TrendingUp}
            title={t('trendingTopics')}
            description={t('trendingDescription')}
            href={`/${locale}/explore#network-pulse-title`}
            linkLabel={t('seeAll')}
          />
          <CardContent className="p-0">
            {trendingTopics.length > 0 ? (
              <div className="grid grid-cols-2 gap-1.5" role="list">
                {trendingTopics.map(({ topic, count, topUsers }) => {
                  const isHashtag = topic.startsWith('#');
                  const url = isHashtag
                    ? `/${locale}/tag/${encodeURIComponent(topic.substring(1))}`
                    : `/${locale}/search?q=${encodeURIComponent(topic)}`;
                  const leadUser = topUsers[0];

                  return (
                    <div
                      key={topic}
                      role="listitem"
                      className="group flex min-w-0 items-center gap-1.5 rounded-full border border-border/70 bg-transparent px-2 py-1 text-xs transition-colors hover:border-primary/45 hover:bg-primary/5"
                    >
                      {leadUser && (
                        <UserProfileHoverCard user={leadUser}>
                          <Link
                            href={`/${locale}/profile/${leadUser.id}`}
                            data-interactive="true"
                            onClick={(e) => e.stopPropagation()}
                            className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Avatar className="h-5 w-5 shrink-0">
                              <AvatarImage src={leadUser.avatarUrl} alt={leadUser.name} />
                              <AvatarFallback>{leadUser.name?.[0] || '#'}</AvatarFallback>
                            </Avatar>
                          </Link>
                        </UserProfileHoverCard>
                      )}
                      <Link
                        href={url}
                        data-interactive="true"
                        title={`${topic} · ${t('mentionsCount', { count })}`}
                        className="flex min-w-0 flex-1 items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium text-primary group-hover:underline">
                          {topic}
                        </span>
                        <span className="shrink-0 text-muted-foreground">{count.toLocaleString(locale)}</span>
                      </Link>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="py-2 text-sm text-muted-foreground">{t('noTrendingTopics')}</p>
            )}
          </CardContent>
        </Card>

        {recPrefs.enabled && suggestedUsers.length > 0 && (
          <Card className="rounded-none border-x-0 border-t-0 bg-transparent pb-5 shadow-none">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <SectionHeading
                  icon={Users}
                  title={t('suggestedUsers')}
                  description={t('suggestedUsersDescription')}
                  href={`/${locale}/explore#suggested-accounts-title`}
                  linkLabel={t('seeAll')}
                />
              </div>
              {currentUserId && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 mt-0.5 text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => setRecDialogOpen(true)}
                  title="Configurar algoritmo de sugestões"
                  aria-label="Configurar algoritmo de sugestões"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <CardContent className="space-y-0.5 p-0">
              {suggestedUsers.map((user) => (
                <UserListItem
                  key={user.id}
                  userToList={user}
                  activeUserId={currentUserId}
                  onFollowStateChange={handleFollowStateChange}
                  variant="compact"
                />
              ))}
            </CardContent>
          </Card>
        )}
        <RecommendationSettingsDialog open={recDialogOpen} onOpenChange={setRecDialogOpen} />

        <Card className="border-none bg-transparent shadow-none">
          <SectionHeading
            icon={Newspaper}
            title={t('topArticles')}
            description={t('topArticlesDescription')}
            href={`/${locale}/trending`}
            linkLabel={t('seeAll')}
          />
          <CardContent className="p-0">
            {topNewsItems.length > 0 ? (
              <div className="divide-y divide-border/60">
                {topNewsItems.map((newsItem) => (
                  <TopNewsItem
                    key={newsItem.id}
                    newsItem={newsItem}
                    density="compact"
                    className="rounded-none border-0 px-0 py-2.5 hover:bg-muted/25"
                  />
                ))}
              </div>
            ) : (
              <p className="py-2 text-sm text-muted-foreground">{t('noTopArticles')}</p>
            )}
          </CardContent>
        </Card>

        <footer
          aria-label="Links institucionais e políticas"
          className="border-t border-border/60 pt-4 pb-6 text-xs text-muted-foreground"
        >
          <nav className="flex flex-wrap items-center gap-x-3 gap-y-1.5 leading-relaxed">
            <Link href={`/${locale}/manifesto`} className="font-medium text-foreground/80 hover:text-foreground hover:underline">
              Manifesto
            </Link>
            <Link href={`/${locale}/dev`} className="font-medium text-foreground/80 hover:text-foreground hover:underline">
              DEV
            </Link>
            <Link href={`/${locale}/about`} className="hover:text-foreground hover:underline">
              Sobre
            </Link>
            <Link href={`/${locale}/privacy`} className="hover:text-foreground hover:underline">
              Política de Privacidade
            </Link>
            <Link href={`/${locale}/terms`} className="hover:text-foreground hover:underline">
              Termos de Uso
            </Link>
            <Link
              href={`/${locale}/community-guidelines`}
              className="hover:text-foreground hover:underline"
            >
              Diretrizes da Comunidade
            </Link>
            <Link href={`/${locale}/cookies`} className="hover:text-foreground hover:underline">
              Cookies
            </Link>
            <Link
              href={`/${locale}/accessibility`}
              className="hover:text-foreground hover:underline"
            >
              Acessibilidade
            </Link>
            <Link href={`/${locale}/fediverse`} className="hover:text-foreground hover:underline">
              Fediverso
            </Link>
            <Link href={`/${locale}/help`} className="hover:text-foreground hover:underline">
              Ajuda
            </Link>
            <Link href={`/${locale}/download`} className="hover:text-foreground hover:underline">
              App
            </Link>
          </nav>
          <p className="mt-2.5 text-[11px] text-muted-foreground/80">
            © {new Date().getFullYear()} HiperVerso
          </p>
        </footer>
      </div>
    </aside>
  );
}
