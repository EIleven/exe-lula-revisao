
'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { auth } from '@/lib/firebase';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Card, CardContent } from '@/components/ui/card';
import type { User, Post, Comment } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import PostCardSkeleton from '@/components/feed/PostCardSkeleton';
import { ShieldAlert, ShieldOff, AlertTriangle, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import LoginOrRegisterPromptDialog from '@/components/auth/LoginOrRegisterPromptDialog';
import BackButton from '@/components/shared/BackButton';
import { getProfileAccentStyle, HIGH_CONTRAST_THEME } from '@/lib/utils/themeColor';
import { useTheme } from 'next-themes';

// Custom Hooks
import { useUserProfile } from '@/hooks/features/profile/useUserProfile';
import { useFeedActions } from '@/contexts/FeedContext';

// Imported Sub-components using alias path
import AdminDashboard from '@/components/profile/AdminDashboard';
import ProfileHeader from '@/components/profile/ProfileHeader';
import RelatedProfilesStrip from '@/components/profile/RelatedProfilesStrip';
import ProfileContentTabs from '@/components/profile/ProfileContentTabs';
import ProfilePageSkeleton from '@/components/profile/ProfilePageSkeleton';

function ProfilePageOverallSkeleton() {
  return <ProfilePageSkeleton />;
}

const REMOTE_SYNC_TTL_MS = 5 * 60 * 1000;
const remoteSyncCache = new Map<string, number>();

interface ProfileClientPageContentProps {
  profileUserIdParam: string;
}

export default function ProfileClientPageContent({ profileUserIdParam }: ProfileClientPageContentProps) {
  const [clientHasMounted, setClientHasMounted] = useState(false);
  const pathname = usePathname();
  const t = useTranslations('ProfilePage');
  const { getFeedState } = useFeedActions();
  const { theme } = useTheme();

  const { currentUser: activeUser, refreshCurrentUser, isLoading: isLoadingCurrentUser } = useCurrentUser();

  // Espera só a PRIMEIRA resolução da sessão. Antes o perfil era buscado como visitante e logo depois como o usuário
  // logado (o botão "Seguir" e o aviso de perfil privado piscavam); recarregamentos seguintes do usuário logado (por
  // exemplo, depois de editar o perfil) não voltam a mostrar o esqueleto nem fecham diálogos abertos.
  const [isSessionResolved, setIsSessionResolved] = useState(false);
  useEffect(() => {
    if (!isLoadingCurrentUser) setIsSessionResolved(true);
  }, [isLoadingCurrentUser]);

  const {
    profileUser,
    setProfileUser,
    isLoadingProfileUser,
    isMutualFollow,
    showLoginPrompt,
    loginPromptActionName,
    openLoginPrompt,
    closeLoginPrompt,
    handleFollowToggle,
    handleMuteToggle,
    handleBlockToggle,
    handleReport,
    handleMessageUser,
    isOwnProfile,
    handleUpdateNotificationSubscription,
  } = useUserProfile({
    profileUserId: profileUserIdParam,
    activeUser,
    refreshActiveUser: refreshCurrentUser,
    enabled: isSessionResolved,
  });

  const [newlyCreatedPostForFeed, setNewlyCreatedPostForFeed] = useState<Post | null>(null);
  const [isSyncingRemote, setIsSyncingRemote] = useState(false);
  const [remoteSyncNonce, setRemoteSyncNonce] = useState(0);
  const syncedRemoteIdRef = useRef<string | null>(null);

  const isViewingAdminProfile = profileUserIdParam === 'adminUserSoberan';
  const isAdminViewing = activeUser?.isAdmin === true;

  useEffect(() => {
    setClientHasMounted(true);
  }, []);

  useEffect(() => {
    if (!isSessionResolved) return;
    if (!profileUser?.id?.startsWith('ap_') || !profileUser.username?.includes('@')) return;
    if (syncedRemoteIdRef.current === profileUser.id) return;
    syncedRemoteIdRef.current = profileUser.id;

    const lastSyncedAt = remoteSyncCache.get(profileUser.id) ?? 0;
    const isFresh = Date.now() - lastSyncedAt < REMOTE_SYNC_TTL_MS;
    if (isFresh) return;

    const hasCachedFeed = getFeedState(`profile_posts_${profileUser.id}`).initialLoadDone;
    let cancelled = false;
    if (!hasCachedFeed) setIsSyncingRemote(true);

    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken().catch(() => null);
        const res = await fetch(
          `/api/ap/remote-profile?handle=${encodeURIComponent(profileUser.username)}`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          },
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          nativeUser?: Partial<User>;
          isFollowing?: boolean;
          followRequested?: boolean;
          manuallyApprovesFollowers?: boolean;
        };
        if (cancelled) return;
        remoteSyncCache.set(profileUser.id, Date.now());
        if (data.nativeUser) {
          setProfileUser((prev) =>
            prev
              ? {
                  ...prev,
                  ...data.nativeUser,
                  isFollowing:
                    typeof data.isFollowing === 'boolean' ? data.isFollowing : prev.isFollowing,
                  followRequested:
                    typeof data.followRequested === 'boolean' ? data.followRequested : prev.followRequested,
                  remoteManuallyApprovesFollowers:
                    typeof data.manuallyApprovesFollowers === 'boolean'
                      ? data.manuallyApprovesFollowers
                      : prev.remoteManuallyApprovesFollowers,
                }
              : prev,
          );
        }
        if (!hasCachedFeed) setRemoteSyncNonce((n) => n + 1);
      } catch {
        // ignora falha silenciosa de sincronização em segundo plano
      } finally {
        if (!cancelled) setIsSyncingRemote(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getFeedState, isSessionResolved, profileUser?.id, profileUser?.username, setProfileUser]);

  const handleProfileUpdated = (updatedUser: User) => {
    setProfileUser(updatedUser);
    if (updatedUser.id === activeUser?.id) {
      refreshCurrentUser();
    }
  };

  const handlePostCreatedFromCommentQuote = (newPost: Post) => {
    if (profileUser && newPost.userId === profileUser.id) {
      setNewlyCreatedPostForFeed(newPost);
    }
  };
  
  const handlePostPrependedInFeed = () => {
    setNewlyCreatedPostForFeed(null);
  };

  const handlePostUpdatedInProfileFeed = (updatedPost: Post) => {
    // console.log("Post updated in profile feed (from ProfileClientPageContent):", updatedPost);
  };

  const handleCommentUpdatedInProfile = (updatedComment: Comment) => {
    // console.log("Comment updated in profile (from ProfileClientPageContent):", updatedComment);
  };

  const isPageLoading = !clientHasMounted || !isSessionResolved || isLoadingProfileUser;

  if (isPageLoading) {
     return <ProfilePageOverallSkeleton />;
  }

  if (isViewingAdminProfile) {
    if (profileUser && isAdminViewing) {
        return <AdminDashboard adminUser={profileUser} activeUser={activeUser} />;
    } else if (!isAdminViewing) {
        return (
            <div className="container mx-auto max-w-3xl py-8 text-center">
                <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
                <h1 className="text-2xl font-bold text-destructive">{t('accessDeniedTitle')}</h1>
                <p className="text-muted-foreground">{t('accessDeniedDescription')}</p>
            </div>
        );
    }
    return <ProfilePageOverallSkeleton />;
  }

  if (!profileUser) {
    return (
        <div className="container mx-auto max-w-3xl py-8 text-center">
            <BackButton />
            <h1 className="text-2xl font-bold text-destructive">{t('notFoundTitle')}</h1>
            <p className="text-muted-foreground">{t('notFoundDescription')}</p>
            <Link href="/" className="mt-4 inline-block text-primary hover:underline">
            {t('backToFeed')}
            </Link>
        </div>
    );
  }

  // Perfil privado: quem não é dono nem seguidor vê só o cartão; posts, comentários e curtidas ficam fechados.
  const isPrivateLocked = profileUser.profileVisibility === 'private' && !isOwnProfile && !profileUser.isFollowing && !activeUser?.isAdmin;
  const isRemoteFresh = Boolean(
    profileUser.id?.startsWith('ap_') &&
    Date.now() - (remoteSyncCache.get(profileUser.id) ?? 0) < REMOTE_SYNC_TTL_MS,
  );
  const hasCachedRemoteFeed = Boolean(
    profileUser.id?.startsWith('ap_') &&
    getFeedState(`profile_posts_${profileUser.id}`).initialLoadDone,
  );
  const needsInitialRemoteSync = Boolean(
    profileUser.id?.startsWith('ap_') &&
    profileUser.username?.includes('@') &&
    !isRemoteFresh &&
    !hasCachedRemoteFeed &&
    syncedRemoteIdRef.current !== profileUser.id,
  );

  return (
    // `display: contents`: o elemento não entra no layout, mas a cor escolhida por QUEM É DONO do perfil vale para tudo dentro dele
    // (capa, botões, abas, links). Sem cor escolhida, não há estilo e herda a cor da rede de quem está olhando.
    <div style={{ display: 'contents', ...getProfileAccentStyle(profileUser.accentColor, { highContrast: theme === HIGH_CONTRAST_THEME }) }}>
      <LoginOrRegisterPromptDialog
        open={showLoginPrompt}
        onOpenChange={closeLoginPrompt}
        actionName={loginPromptActionName}
        currentPath={pathname}
      />

      <div className="relative h-48 bg-muted w-full">
         <BackButton className="absolute top-4 left-4 z-10 bg-black/50 hover:bg-black/70 text-white" />
        {profileUser.coverImageUrl ? (
          <>
            <Image
              src={profileUser.coverImageUrl}
              alt={profileUser.coverImageAlt?.trim() || t('coverAlt', { name: profileUser.name })}
              title={profileUser.coverImageAlt?.trim() || undefined}
              fill
              sizes="100vw"
              className="object-cover"
              priority
              data-ai-hint={profileUser["cover-image-ai-hint"] || "profile cover image"}
            />
            {profileUser.coverImageAlt?.trim() && (
              <span
                title={profileUser.coverImageAlt.trim()}
                aria-label={`Descrição da capa: ${profileUser.coverImageAlt.trim()}`}
                className="absolute bottom-3 right-3 z-10 rounded bg-black/75 px-2 py-0.5 text-[10px] font-bold tracking-wider text-white ring-1 ring-white/25"
              >
                ALT
              </span>
            )}
          </>
        ) : (
          <div className="h-full w-full bg-gradient-to-r from-primary to-accent" />
        )}
      </div>

      <div className="container mx-auto max-w-3xl pb-8 space-y-4">
        <div className="overflow-visible -mt-16">
          <ProfileHeader
            profileUser={profileUser}
            activeUser={activeUser}
            isOwnProfile={isOwnProfile}
            isMutualFollow={isMutualFollow}
            onFollowToggle={handleFollowToggle}
            onMuteToggle={handleMuteToggle}
            onBlockToggle={handleBlockToggle}
            onReport={handleReport}
            onMessageUser={handleMessageUser}
            onUpdateNotificationSubscription={handleUpdateNotificationSubscription}
            onProfileUpdated={handleProfileUpdated}
            requireLoginOrPrompt={openLoginPrompt}
          />
        </div>

        {!isOwnProfile && !isPrivateLocked && !profileUser.hasBlockedCurrentUser && !profileUser.isBlocked && (
          <RelatedProfilesStrip profileUser={profileUser} />
        )}

        {(!profileUser.hasBlockedCurrentUser || (activeUser?.isAdmin && isOwnProfile)) &&
         (!profileUser.isBlocked || (activeUser?.isAdmin && !isOwnProfile)) && isPrivateLocked && (
           <Card className="p-6 text-center">
              <Lock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h2 className="text-xl font-semibold">{t('privateTitle')}</h2>
              <p className="text-muted-foreground">
                {activeUser
                  ? t('privateDescription', { username: profileUser.username })
                  : t('privateGuestDescription', { username: profileUser.username })}
              </p>
          </Card>
        )}
        {(!profileUser.hasBlockedCurrentUser || (activeUser?.isAdmin && isOwnProfile)) &&
         (!profileUser.isBlocked || (activeUser?.isAdmin && !isOwnProfile)) && !isPrivateLocked && (
          isSyncingRemote || needsInitialRemoteSync ? (
            <div className="pt-2">
              <div className="grid grid-cols-6 gap-2 px-3 py-2 border-y border-border">
                <Skeleton className="h-4 w-12 mx-auto" />
                <Skeleton className="h-4 w-16 mx-auto" />
                <Skeleton className="h-4 w-14 mx-auto" />
                <Skeleton className="h-4 w-14 mx-auto" />
                <Skeleton className="h-4 w-10 mx-auto" />
                <Skeleton className="h-4 w-14 mx-auto" />
              </div>
              <PostCardSkeleton />
              <PostCardSkeleton />
            </div>
          ) : (
            <ProfileContentTabs
              key={`${profileUser.id}-${remoteSyncNonce}`}
              profileUser={profileUser}
              activeUser={activeUser}
              isOwnProfile={isOwnProfile}
              onCommentUpdated={handleCommentUpdatedInProfile}
              onPostCreatedFromCommentQuote={handlePostCreatedFromCommentQuote}
              onPostUpdatedInFeed={handlePostUpdatedInProfileFeed}
              newlyCreatedPostForFeed={newlyCreatedPostForFeed}
              onPostPrependedInFeed={handlePostPrependedInFeed}
              syncNonce={remoteSyncNonce}
            />
          )
        )}
        {profileUser.hasBlockedCurrentUser && !activeUser?.isAdmin && (
           <Card className="p-6 text-center">
              <ShieldAlert className="h-12 w-12 text-destructive mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-destructive">{t('blockedByTitle')}</h2>
              <p className="text-muted-foreground">{t('blockedByDescription', { username: profileUser.username })}</p>
          </Card>
        )}
        {profileUser.isBlocked && !isOwnProfile && !activeUser?.isAdmin && (
           <Card className="p-6 text-center">
              <ShieldOff className="h-12 w-12 text-destructive mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-destructive">{t('blockedTitle', { username: profileUser.username })}</h2>
              <p className="text-muted-foreground">{t('blockedDescription')}</p>
          </Card>
        )}
      </div>
    </div>
  );
}
