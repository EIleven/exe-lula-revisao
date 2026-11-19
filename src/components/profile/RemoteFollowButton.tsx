'use client';

import React, { useState } from 'react';
import { Clock, Loader2, Lock, UserCheck, UserMinus, UserPlus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { siteConfig } from '@/config/site';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { useRemoteFollow } from '@/hooks/features/profile/useRemoteFollow';
import { useToast } from '@/hooks/use-toast';
import { RemoteFollowError, type RemoteFollowResult, type RemoteFollowView } from '@/lib/federation/remoteFollowClient';
import type { User } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import FollowRequestDialog from '@/components/profile/FollowRequestDialog';

type Props = {
  targetUser: User;
  activeUserId: string | null;
  variant?: 'profile' | 'list' | 'hover';
  compact?: boolean;
  onStateChange?: (updatedUser: User) => void;
  testId?: string;
};

export function isRemoteFediverseUser(
  user: (Pick<User, 'id' | 'username'> & { isRemoteFediverse?: boolean }) | null | undefined,
): boolean {
  if (!user) return false;
  return user.id.startsWith('ap_') || Boolean(user.isRemoteFediverse);
}

export default function RemoteFollowButton({
  targetUser,
  activeUserId,
  variant = 'list',
  compact = false,
  onStateChange,
  testId,
}: Props) {
  const t = useTranslations('RemoteFollow');
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, refreshCurrentUser } = useCurrentUser();

  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const handleDisplay = targetUser.username.startsWith('@') ? targetUser.username : `@${targetUser.username}`;
  const cleanHandle = targetUser.username.replace(/^@/, '');
  const me = currentUser?.username ? `@${currentUser.username}@${siteConfig.federationHost}` : `@${siteConfig.federationHost}`;

  const translateError = (err: unknown): string => {
    if (err instanceof RemoteFollowError) {
      const key = err.code as Parameters<typeof t>[0];
      try {
        const msg = t(`errors.${key}` as Parameters<typeof t>[0]);
        if (msg && !msg.startsWith('RemoteFollow.errors.')) return msg;
      } catch {
        // fallback below
      }
    }
    return t('errors.generic');
  };

  const notifyChange = (nextView: RemoteFollowView, res: RemoteFollowResult, previousView: RemoteFollowView) => {
    const wasFollowing = previousView === 'following';
    const isNowFollowing = nextView === 'following';
    const delta = isNowFollowing === wasFollowing ? 0 : isNowFollowing ? 1 : -1;
    const nextCount = Math.max(0, (targetUser.followersCount || 0) + delta);

    onStateChange?.({
      ...targetUser,
      isFollowing: isNowFollowing,
      followRequested: nextView === 'requested',
      remoteManuallyApprovesFollowers: res.closed,
      followersCount: nextCount,
    });
    void refreshCurrentUser();

    if (nextView === 'requested') {
      toast({
        title: t('requestSentTitle'),
        description: res.noteSent
          ? t('requestSentNoteDescription', { handle: handleDisplay })
          : t('requestSentDescription', { handle: handleDisplay }),
      });
    } else if (nextView === 'following') {
      toast({ title: t('followedTitle', { handle: handleDisplay }) });
    } else if (previousView === 'requested') {
      toast({ title: t('requestCancelledTitle') });
    } else if (previousView === 'following') {
      toast({
        title: t('unfollowedTitle', { handle: handleDisplay }),
        ...(res.remote === 'failed' ? { description: t('unfollowRemoteNote') } : {}),
      });
    }
  };

  const { view, closed, busy, follow, stop } = useRemoteFollow({
    activeUserId,
    targetUserId: targetUser.id,
    handle: cleanHandle,
    isFollowing: targetUser.isFollowing,
    followRequested: targetUser.followRequested,
    closed: targetUser.remoteManuallyApprovesFollowers,
    onChange: notifyChange,
    onError: (err) => {
      toast({ title: t('errorTitle'), description: translateError(err), variant: 'destructive' });
    },
  });

  const requireAuth = (): boolean => {
    if (activeUserId) return true;
    toast({ title: t('loginTitle'), description: t('loginDescription'), variant: 'destructive' });
    router.push(`/${locale}/login`);
    return false;
  };

  const handlePrimaryClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!requireAuth() || busy) return;
    if (view === 'following') {
      if (variant === 'list') {
        void stop();
      } else {
        setMenuOpen((prev) => !prev);
      }
      return;
    }
    if (view === 'requested') {
      setCancelDialogOpen(true);
      return;
    }
    if (closed === true) {
      setRequestDialogOpen(true);
      return;
    }
    void follow();
  };

  const handleDialogSend = async (note: string | null) => {
    const res = await follow(note ?? undefined);
    if (res) {
      setRequestDialogOpen(false);
    }
  };

  const handleConfirmCancel = async () => {
    setCancelDialogOpen(false);
    await stop();
  };

  const effectiveTestId = testId || (variant === 'profile' ? 'profile-follow-button' : variant === 'hover' ? 'hover-follow-button' : 'follow-button');

  const dialogs = (
    <>
      <FollowRequestDialog
        open={requestDialogOpen}
        onOpenChange={setRequestDialogOpen}
        handle={cleanHandle}
        me={me}
        busy={busy}
        onSend={handleDialogSend}
      />
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cancelTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('cancelDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('keepRequest')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleConfirmCancel()} data-testid="confirm-cancel-follow-request">
              {t('cancelRequest')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  if (variant === 'profile' || variant === 'hover') {
    if (view === 'following') {
      const iconSize = variant === 'hover' ? 'h-8 w-8' : 'h-9 w-9';
      return (
        <>
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <Button
              type="button"
              onClick={handlePrimaryClick}
              variant="secondary"
              size="icon"
              disabled={busy}
              className={cn(
                'relative rounded-full border transition-all [touch-action:manipulation]',
                iconSize,
                targetUser.isFollowedBy
                  ? 'border-primary/50 bg-primary/15 text-primary hover:bg-primary/25'
                  : 'border-border/70 bg-secondary/90 hover:bg-secondary',
              )}
              aria-pressed={true}
              aria-expanded={menuOpen}
              title={targetUser.isFollowedBy ? 'Segue você · Seguindo' : t('unfollow')}
              data-testid={effectiveTestId}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
            </Button>
            {menuOpen && (
              <div
                className="absolute right-0 top-full mt-1.5 w-52 rounded-2xl border border-border/80 bg-popover/95 backdrop-blur-md p-1.5 shadow-xl z-30"
                role="menu"
              >
                <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                    <UserCheck className="h-3.5 w-3.5 text-primary" />
                    Seguindo
                  </span>
                  {targetUser.isFollowedBy && (
                    <Badge variant="secondary" className="text-[10px] font-medium rounded-full px-2 py-0">
                      Segue você
                    </Badge>
                  )}
                </div>
                <div className="my-1 h-px bg-border/60" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    void stop();
                  }}
                  className="w-full flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors text-left"
                  data-testid="profile-unfollow-action"
                >
                  <UserMinus className="h-4 w-4 shrink-0" />
                  <span>{t('unfollow')}</span>
                </button>
              </div>
            )}
          </div>
          {dialogs}
        </>
      );
    }

    if (view === 'requested') {
      return (
        <>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={handlePrimaryClick}
            className={cn('rounded-full font-semibold [touch-action:manipulation]', variant === 'hover' ? 'h-8 px-3 text-xs' : 'h-9 px-4')}
            aria-pressed={true}
            data-testid={effectiveTestId}
          >
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Clock className="mr-1.5 h-3.5 w-3.5" />}
            <span>{t('requested')}</span>
          </Button>
          {dialogs}
        </>
      );
    }

    return (
      <>
        <Button
          type="button"
          variant="default"
          size="sm"
          disabled={busy}
          onClick={handlePrimaryClick}
          className={cn('rounded-full font-semibold [touch-action:manipulation]', variant === 'hover' ? 'h-8 px-3 text-xs' : 'h-9 px-4')}
          aria-pressed={false}
          data-testid={effectiveTestId}
        >
          {busy ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : closed === true ? (
            <Lock className="mr-1.5 h-3.5 w-3.5" />
          ) : (
            <UserPlus className="mr-1.5 h-3.5 w-3.5" />
          )}
          <span>{closed === true ? t('requestToFollow') : targetUser.isFollowedBy ? 'Seguir de volta' : t('follow')}</span>
        </Button>
        {dialogs}
      </>
    );
  }

  // variant === 'list'
  return (
    <>
      <Button
        type="button"
        variant={view === 'none' ? 'default' : 'secondary'}
        size="sm"
        disabled={busy}
        onClick={handlePrimaryClick}
        aria-pressed={view !== 'none'}
        className={cn('shrink-0 [touch-action:manipulation]', compact && 'h-8 px-2.5 text-xs')}
        data-testid={effectiveTestId}
      >
        {busy ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : view === 'following' ? (
          <UserMinus className="mr-1.5 h-3.5 w-3.5" />
        ) : view === 'requested' ? (
          <Clock className="mr-1.5 h-3.5 w-3.5" />
        ) : closed === true ? (
          <Lock className="mr-1.5 h-3.5 w-3.5" />
        ) : (
          <UserPlus className="mr-1.5 h-3.5 w-3.5" />
        )}
        {view === 'following'
          ? t('unfollow')
          : view === 'requested'
            ? t('requested')
            : closed === true
              ? t('requestToFollow')
              : t('follow')}
      </Button>
      {dialogs}
    </>
  );
}

