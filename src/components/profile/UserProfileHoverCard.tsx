// src/components/profile/UserProfileHoverCard.tsx
'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { UserPlus, UserMinus, UserCheck, MessageSquare, MapPin, Link as LinkIcon } from 'lucide-react';
import PixSupportBadge from './PixSupportBadge';
import { useCurrentUser, useCurrentUserActions, useCurrentUserId } from '@/contexts/CurrentUserContext';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import type { User } from '@/lib/types';
import { compactCount, exactCountTitle } from '@/lib/media/videoQueue';
import { useLocale, useTranslations } from 'next-intl';
import TextWithMentions from '../shared/TextWithMentions';
import { Badge } from '@/components/ui/badge';
import { useFollowToggle } from '@/hooks/features/profile/useFollowToggle';
import RemoteFollowButton, { isRemoteFediverseUser } from '@/components/profile/RemoteFollowButton';
import { friendlyErrorMessage } from '@/lib/utils/friendlyError';
import { getUser } from '@/lib/services/userService';
import { dispatchFollowState } from '@/lib/events/followState';
import { getProfileAccentStyle, isHighContrastDocument } from '@/lib/utils/themeColor';

interface UserProfileHoverCardProps {
  user: User;
  children: React.ReactNode;
  onFollowStateChangeInCard?: (updatedUser: User) => void;
  remoteHandle?: string;
}

export default function UserProfileHoverCard({ user, children, onFollowStateChangeInCard, remoteHandle }: UserProfileHoverCardProps) {
  const t = useTranslations('UserProfileHoverCard');
  // Só o id e as ações: cada cartão do feed tem um destes, e um seguidor novo não pode redesenhar todos.
  const activeUserId = useCurrentUserId();
  const { firebaseUser } = useCurrentUser();
  const { refreshCurrentUser } = useCurrentUserActions();
  const { toast } = useToast();
  const router = useRouter();
  const locale = useLocale();
  const targetUserId = user.id || (user as { userId?: string }).userId || '';
  const [isOpen, setIsOpen] = React.useState(false);
  const [followMenuOpen, setFollowMenuOpen] = React.useState(false);
  const followContainerRef = React.useRef<HTMLDivElement | null>(null);
  const closeMenuTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [liveUser, setLiveUser] = React.useState<User>(() =>
    user.id ? user : { ...user, id: targetUserId }
  );
  const hasFetchedRef = React.useRef(false);

  React.useEffect(() => {
    setLiveUser(user.id ? user : { ...user, id: targetUserId });
    hasFetchedRef.current = false;
  }, [user, targetUserId]);

  React.useEffect(() => {
    if (!isOpen || hasFetchedRef.current) return;
    if (!targetUserId && !remoteHandle) return;
    let cancelled = false;
    hasFetchedRef.current = true;

    const load = async () => {
      try {
        if (targetUserId) {
          const fresh = await getUser(targetUserId, activeUserId);
          if (cancelled || !fresh) return;
          setLiveUser(fresh);
          if (activeUserId && typeof fresh.isFollowing === 'boolean') {
            dispatchFollowState({
              activeUserId,
              targetUserId: fresh.id,
              isFollowing: fresh.isFollowing,
              followersCount: fresh.followersCount,
            });
          }
          return;
        }
        if (remoteHandle) {
          const headers: Record<string, string> = {};
          if (firebaseUser) {
            headers.Authorization = `Bearer ${await firebaseUser.getIdToken()}`;
          }
          const res = await fetch(`/api/ap/remote-profile?handle=${encodeURIComponent(remoteHandle)}`, { headers });
          if (!res.ok || cancelled) return;
          const data = (await res.json()) as { nativeUser?: User };
          if (cancelled || !data.nativeUser) return;
          setLiveUser(data.nativeUser);
          if (activeUserId && typeof data.nativeUser.isFollowing === 'boolean') {
            dispatchFollowState({
              activeUserId,
              targetUserId: data.nativeUser.id,
              isFollowing: data.nativeUser.isFollowing,
              followRequested: data.nativeUser.followRequested,
              followersCount: data.nativeUser.followersCount,
            });
          }
        }
      } catch {
        hasFetchedRef.current = false;
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [isOpen, targetUserId, remoteHandle, activeUserId, firebaseUser]);

  const profileId = liveUser.id || targetUserId;
  const isOwnProfile = activeUserId === profileId;

  // Seguir responde NA HORA (veja useFollowToggle): o botão e o contador mudam no toque; o servidor grava em segundo plano.
  const follow = useFollowToggle({
    activeUserId,
    targetUserId: profileId,
    isFollowing: liveUser.isFollowing,
    followersCount: liveUser.followersCount,
    onFailure: (error) => {
      console.error('Erro ao seguir:', error);
      toast({ title: t('error'), description: friendlyErrorMessage(error, t('unexpectedError')), variant: "destructive" });
    },
    onSettled: (view) => {
      onFollowStateChangeInCard?.({ ...liveUser, isFollowing: view.isFollowing, followersCount: view.followersCount });
      void refreshCurrentUser(); // atualiza os contadores da barra lateral
    },
  });

  const handleFollowToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (!activeUserId) {
      toast({ title: t('loginRequiredTitle'), description: t('loginRequiredDescription') });
      router.push(`/${locale}/login`);
      return;
    }

    toast({ title: follow.isFollowing ? t('unfollowSuccess', { username: liveUser.username }) : t('followSuccess', { username: liveUser.username }) });
    follow.toggle();
  };


  React.useEffect(() => {
    if (!isOpen) setFollowMenuOpen(false);
  }, [isOpen]);

  const openFollowMenu = () => {
    if (closeMenuTimeoutRef.current) {
      clearTimeout(closeMenuTimeoutRef.current);
      closeMenuTimeoutRef.current = null;
    }
    setFollowMenuOpen(true);
  };

  const scheduleCloseFollowMenu = () => {
    if (closeMenuTimeoutRef.current) clearTimeout(closeMenuTimeoutRef.current);
    closeMenuTimeoutRef.current = setTimeout(() => setFollowMenuOpen(false), 160);
  };

  return (
    <HoverCard open={isOpen} onOpenChange={setIsOpen} openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        className="w-80 p-0 rounded-2xl overflow-hidden border border-border/80 bg-popover/95 backdrop-blur-md shadow-2xl"
        // Só aplica a cor de QUEM está no balão se essa pessoa escolheu uma. Sem escolha, não há estilo nenhum e o balão HERDA a cor
        // da rede de quem está logado (`--primary` no :root). Antes, `fallbackToDefault: true` injetava o azul padrão e o balão
        // ficava azul mesmo para quem escolheu vermelho.
        style={getProfileAccentStyle(liveUser.accentColor, { highContrast: isHighContrastDocument() })}
        onClick={(e) => e.stopPropagation()}
        data-interactive="true"
      >
        <div className="flex flex-col">
          <div className="relative h-20 bg-gradient-to-br from-primary/25 via-muted to-background">
            {liveUser.coverImageUrl && (
              <Image
                src={liveUser.coverImageUrl}
                alt={t('coverImageAlt', { name: liveUser.name })}
                fill
                className="object-cover"
                sizes="320px"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-popover/60 via-transparent to-transparent" />
            <Link href={`/${locale}/profile/${profileId}`} className="absolute -bottom-8 left-4 z-10">
              <Avatar className="h-16 w-16 border-4 border-popover bg-background ring-2 ring-primary">
                <AvatarImage src={liveUser.avatarUrl} alt={liveUser.name} data-ai-hint={liveUser["data-ai-hint"] || "person avatar"} />
                <AvatarFallback>{liveUser.name?.substring(0, 1) || 'U'}</AvatarFallback>
              </Avatar>
            </Link>
          </div>
          <div className="pt-2.5 px-4 pb-4">
            <div className="flex justify-end items-center gap-2 min-h-[36px]">
              {!isOwnProfile && activeUserId && profileId && (
                <>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 rounded-full border-border/70 bg-background/60 hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setIsOpen(false);
                      router.push(`/${locale}/messages/user/${profileId}`);
                    }}
                    title="Enviar mensagem"
                    aria-label="Enviar mensagem"
                  >
                    <MessageSquare className="h-4 w-4" />
                  </Button>
                  {isRemoteFediverseUser(liveUser) ? (
                    <RemoteFollowButton
                      targetUser={liveUser}
                      activeUserId={activeUserId ?? null}
                      variant="hover"
                      onStateChange={(updated) => {
                        setLiveUser(updated);
                        onFollowStateChangeInCard?.(updated);
                      }}
                    />
                  ) : follow.isFollowing ? (
                    <div
                      ref={followContainerRef}
                      className="relative"
                      onMouseEnter={openFollowMenu}
                      onMouseLeave={scheduleCloseFollowMenu}
                    >
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setFollowMenuOpen((prev) => !prev);
                        }}
                        aria-pressed={true}
                        aria-expanded={followMenuOpen}
                        className={`relative h-9 w-9 rounded-full border transition-all [touch-action:manipulation] ${
                          liveUser.isFollowedBy
                            ? 'border-primary/50 bg-primary/15 text-primary hover:bg-primary/25'
                            : 'border-border/70 bg-secondary/90 hover:bg-secondary'
                        }`}
                        title={liveUser.isFollowedBy ? 'Segue você · Seguindo' : t('following')}
                        data-testid="hover-follow-button"
                      >
                        <UserCheck className="h-4 w-4" />
                        {liveUser.isFollowedBy && (
                          <span
                            className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-popover"
                            aria-hidden="true"
                          />
                        )}
                      </Button>
                      {followMenuOpen && (
                        <div
                          className="absolute right-0 top-full mt-1.5 w-48 rounded-2xl border border-border/80 bg-popover/95 backdrop-blur-md p-1.5 shadow-xl z-40"
                          role="menu"
                        >
                          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
                            <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                              <UserCheck className="h-3.5 w-3.5 text-primary" />
                              {t('following')}
                            </span>
                            {liveUser.isFollowedBy && (
                              <Badge variant="secondary" className="text-[10px] font-medium rounded-full px-2 py-0">
                                Segue você
                              </Badge>
                            )}
                          </div>
                          <div className="my-1 h-px bg-border/60" />
                          <button
                            type="button"
                            role="menuitem"
                            onClick={(e) => {
                              setFollowMenuOpen(false);
                              handleFollowToggle(e);
                            }}
                            className="w-full flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors text-left"
                          >
                            <UserMinus className="h-3.5 w-3.5 shrink-0" />
                            <span>Deixar de seguir</span>
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleFollowToggle}
                      aria-pressed={false}
                      className="h-9 px-4 rounded-full font-medium [touch-action:manipulation]"
                      data-testid="hover-follow-button"
                    >
                      <UserPlus className="mr-1.5 h-4 w-4" />
                      {liveUser.isFollowedBy ? 'Seguir de volta' : t('follow')}
                    </Button>
                  )}
                </>
              )}
            </div>
            <div className="mt-2">
              <Link href={`/${locale}/profile/${profileId}`} className="hover:underline">
                <h3 className="text-base font-bold leading-tight">{liveUser.name}</h3>
                <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                  <p className="text-xs text-muted-foreground">@{liveUser.username}</p>
                  {liveUser.pronouns && (
                    <span className="text-[11px] font-medium text-primary border border-primary/70 bg-transparent rounded-full px-2 py-0.5">
                      {liveUser.pronouns}
                    </span>
                  )}
                  {liveUser.isFollowedBy && (
                    <Badge variant="secondary" className="text-[10px] font-medium rounded-full px-2 py-0">
                      Segue você
                    </Badge>
                  )}
                </div>
              </Link>
              {liveUser.pixKey && (
                <div className="mt-2">
                  <PixSupportBadge user={liveUser} compact />
                </div>
              )}
              {liveUser.bio && (
                <p className="mt-2 text-sm whitespace-pre-wrap leading-relaxed">
                  <TextWithMentions text={liveUser.bio} />
                </p>
              )}
              {(liveUser.location || liveUser.website) && (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {liveUser.location && (
                    <span className="flex items-center">
                      <MapPin className="h-3.5 w-3.5 mr-1 shrink-0" />
                      <span className="truncate max-w-[140px]">{liveUser.location}</span>
                    </span>
                  )}
                  {liveUser.website && (
                    <a
                      href={liveUser.website.startsWith('http') ? liveUser.website : `https://${liveUser.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center text-primary hover:underline truncate max-w-[180px]"
                    >
                      <LinkIcon className="h-3.5 w-3.5 mr-1 shrink-0" />
                      <span className="truncate">{liveUser.website.replace(/^https?:\/\//, '')}</span>
                    </a>
                  )}
                </div>
              )}
            </div>
            <div className="mt-4 flex space-x-4 text-sm text-muted-foreground">
              <Link href={`/${locale}/profile/${profileId}/following`} className="hover:underline" title={exactCountTitle(liveUser.followingCount)}>
                <span className="font-bold text-foreground">{compactCount(liveUser.followingCount)}</span> {t('following')}
              </Link>
              <Link href={`/${locale}/profile/${profileId}/followers`} className="hover:underline" title={exactCountTitle(follow.followersCount)}>
                <span className="font-bold text-foreground">{compactCount(follow.followersCount)}</span> {t('followers')}
              </Link>
            </div>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
