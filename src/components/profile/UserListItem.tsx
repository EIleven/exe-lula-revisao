// src/components/profile/UserListItem.tsx
'use client';

import Link from 'next/link';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { UserPlus, UserMinus, Edit3, Shield, Sparkles } from 'lucide-react';
import type { User } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import UserProfileHoverCard from './UserProfileHoverCard';
import RemoteFollowButton, { isRemoteFediverseUser } from './RemoteFollowButton';
import { useLocale } from 'next-intl';
import { useTranslations } from 'next-intl';
import { useFollowToggle } from '@/hooks/features/profile/useFollowToggle';
import { friendlyErrorMessage } from '@/lib/utils/friendlyError';
import { cn } from '@/lib/utils';

interface UserListItemProps {
  userToList: User;
  activeUserId: string | null;
  onFollowStateChange?: (updatedUser: User) => void;
  isAdminView?: boolean;
  onManageRoles?: (user: User) => void;
  /** Apresentação mais densa na barra lateral ou em cartão na descoberta. */
  variant?: 'default' | 'compact' | 'card';
}

export default function UserListItem({
  userToList,
  activeUserId,
  onFollowStateChange,
  isAdminView = false,
  onManageRoles,
  variant = 'default',
}: UserListItemProps) {
  const t = useTranslations('UserListItem');
  const { refreshCurrentUser } = useCurrentUser();
  const locale = useLocale();

  const { toast } = useToast();
  const router = useRouter();

  // Seguir responde NA HORA (o botão muda no toque e a gravação segue em segundo plano); se o servidor recusar, volta ao que
  // era e avisa. Antes o botão ficava desabilitado, com ícone de espera, durante 3 a 4 idas ao servidor.
  const follow = useFollowToggle({
    activeUserId,
    targetUserId: userToList.id,
    isFollowing: userToList.isFollowing,
    followersCount: userToList.followersCount,
    onFailure: (error) => {
      console.error('Erro ao seguir:', error);
      toast({ title: t('error'), description: friendlyErrorMessage(error, t('updateError')), variant: 'destructive' });
    },
    onSettled: (view) => {
      onFollowStateChange?.({ ...userToList, isFollowing: view.isFollowing, followersCount: view.followersCount });
      void refreshCurrentUser();
    },
  });

  const handleFollowToggle = () => {
    if (!activeUserId) {
      toast({ title: t('loginRequiredTitle'), description: t('loginRequiredDescription'), variant: "destructive" });
      router.push(`/${locale}/login`);
      return;
    }
    if (activeUserId === userToList.id) return;

    toast({ title: follow.isFollowing ? t('unfollowSuccess', { username: userToList.username }) : t('followSuccess', { username: userToList.username }) });
    follow.toggle();
  };

  const isCompact = variant === 'compact';
  const isCard = variant === 'card';
  const recommendationReason = userToList.recommendationReason;
  const recommendationText = recommendationReason
    ? recommendationReason.kind === 'follows-you'
      ? t('recommendationFollowsYou')
      : recommendationReason.kind === 'mutual'
        ? t('recommendationMutual', { count: recommendationReason.count })
        : recommendationReason.kind === 'interest'
          ? t('recommendationInterest', { topic: recommendationReason.topic })
          : recommendationReason.kind === 'active'
            ? t('recommendationActive')
            : t('recommendationPopular')
    : null;

  return (
    <div
      className={cn(
        'rounded-lg transition-colors',
        isCompact && 'px-1 py-2 hover:bg-muted/35',
        isCard && 'border border-border/70 bg-card/20 p-3 hover:border-primary/30 hover:bg-muted/25',
        variant === 'default' && 'p-3 hover:bg-muted/50',
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <UserProfileHoverCard
            user={userToList}
            onFollowStateChangeInCard={onFollowStateChange}
        >
            <Link href={`/${locale}/profile/${userToList.id}`} className="group flex min-w-0 flex-1 items-center gap-3">
                <Avatar className={cn('shrink-0', isCompact ? 'h-9 w-9' : 'h-10 w-10')}>
                    <AvatarImage src={userToList.avatarUrl} alt={userToList.name} data-ai-hint={userToList['data-ai-hint'] || 'person avatar'} />
                    <AvatarFallback>{userToList.name?.substring(0, 1) || '?'}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                    <p className={cn('truncate font-medium text-foreground group-hover:underline', isCompact && 'text-sm')}>{userToList.name}</p>
                    <p className="text-xs text-muted-foreground truncate">@{userToList.username}</p>
                    {isCompact && recommendationText && (
                      <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-primary/90" title={recommendationText}>
                        <Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span className="truncate">{recommendationText}</span>
                      </p>
                    )}
                </div>
            </Link>
        </UserProfileHoverCard>

      {activeUserId && activeUserId === userToList.id && (
        <Button variant="outline" size="sm" asChild>
          <Link href={`/${locale}/profile/${activeUserId}`}>
            <Edit3 className="mr-2 h-4 w-4" /> {t('editProfile')}
          </Link>
        </Button>
      )}

      {isAdminView && activeUserId && activeUserId !== userToList.id ? (
        <Button variant="outline" size="sm" onClick={() => onManageRoles?.(userToList)}>
          <Shield className="mr-2 h-4 w-4" /> Gerenciar
        </Button>
      ) : activeUserId && activeUserId !== userToList.id && isRemoteFediverseUser(userToList) ? (
        <RemoteFollowButton
          targetUser={userToList}
          activeUserId={activeUserId}
          variant="list"
          compact={isCompact}
          onStateChange={onFollowStateChange}
        />
      ) : activeUserId && activeUserId !== userToList.id ? (
        <Button
          variant={follow.isFollowing ? "secondary" : "default"}
          size="sm"
          onClick={handleFollowToggle}
          aria-pressed={follow.isFollowing}
          className={cn('shrink-0 [touch-action:manipulation]', isCompact && 'h-8 px-2.5 text-xs')}
          data-testid="follow-button"
        >
          {follow.isFollowing ? (
            <UserMinus className="mr-2 h-4 w-4" />
          ) : (
            <UserPlus className="mr-2 h-4 w-4" />
          )}
          {follow.isFollowing ? t('unfollow') : t('follow')}
        </Button>
      ) : null}

      {!activeUserId && !isAdminView && (
         <Button
           variant="default"
           size="sm"
           className={cn('shrink-0', isCompact && 'h-8 px-2.5 text-xs')}
           onClick={() => router.push(`/${locale}/login?redirect=/${locale}/profile/` + userToList.id + '/followers')}
         >
            {t('follow')}
        </Button>
      )}
      </div>

      {isCard && (
        <div className="mt-2 min-w-0 pl-[52px]">
          {recommendationText && (
            <p className="mb-1.5 flex items-center gap-1 text-xs font-medium text-primary/90">
              <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="line-clamp-1">{recommendationText}</span>
            </p>
          )}
          {userToList.bio && (
            <p className="mb-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {userToList.bio}
            </p>
          )}
          <p className="text-xs text-muted-foreground/80">
            {t('followersCount', { count: follow.followersCount })}
          </p>
        </div>
      )}
    </div>
  );
}
