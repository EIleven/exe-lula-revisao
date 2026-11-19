
// src/components/profile/ProfileHeader.tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import PixSupportBadge from './PixSupportBadge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import EditProfileDialog from '@/components/profile/EditProfileDialog';
import RemoteFollowButton, { isRemoteFediverseUser } from '@/components/profile/RemoteFollowButton';
import type { User } from '@/lib/types';
import { compactCount, exactCountTitle } from '@/lib/media/videoQueue';
import {
  Edit3, MoreHorizontal, UserPlus, UserMinus, UserCheck, VolumeX, Volume2,
  ShieldOff, ShieldAlert, AlertTriangle, MessageSquare, LogIn,
  Bell, BellRing, Check, Newspaper, MessageSquareText, MapPin, Link as LinkIcon,
  Share2, ExternalLink, MessageCircle
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import Image from 'next/image';
import { useTranslations, useLocale } from 'next-intl';
import TextWithMentions from '../shared/TextWithMentions';
import FediverseHandleExplainer from '../shared/FediverseHandleExplainer';
import FederationBadge from '@/components/federation/FederationBadge';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { usePostMainInteractions } from '@/hooks/features/post/usePostMainInteractions'; // Import the hook

interface ProfileHeaderProps {
  profileUser: User;
  activeUser: User | null; // Currently logged-in user
  isOwnProfile: boolean;
  isMutualFollow: boolean;
  externalProfileUrl?: string;
  externalDomain?: string;
  onFollowToggle: () => Promise<void>;
  onMuteToggle: () => Promise<void>;
  onBlockToggle: () => Promise<void>;
  onReport: () => Promise<void>;
  onMessageUser: () => void;
  onUpdateNotificationSubscription: (preference: 'all' | 'news_only' | 'none') => Promise<void>;
  onProfileUpdated: (updatedUser: User) => void; // For EditProfileDialog
  requireLoginOrPrompt: (actionName: string) => boolean; // To prompt login for guests
}

export default function ProfileHeader({
  profileUser,
  activeUser,
  isOwnProfile,
  isMutualFollow,
  externalProfileUrl,
  externalDomain,
  onFollowToggle,
  onMuteToggle,
  onBlockToggle,
  onReport,
  onMessageUser,
  onUpdateNotificationSubscription,
  onProfileUpdated,
  requireLoginOrPrompt,
}: ProfileHeaderProps) {
  const t = useTranslations('ProfileHeader');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const isPixOpen = searchParams?.get('pix') === '1';
  const { toast } = useToast();

  const [followMenuOpen, setFollowMenuOpen] = useState(false);
  const followContainerRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!profileUser.isFollowing) {
      setFollowMenuOpen(false);
    }
  }, [profileUser.isFollowing]);

  useEffect(() => {
    if (!followMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (followContainerRef.current && !followContainerRef.current.contains(event.target as Node)) {
        setFollowMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFollowMenuOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [followMenuOpen]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const openFollowMenu = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setFollowMenuOpen(true);
  };

  const scheduleCloseFollowMenu = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setFollowMenuOpen(false);
    }, 150);
  };

  const isRemoteFediverse =
    Boolean((profileUser as User & { isRemoteFediverse?: boolean }).isRemoteFediverse) ||
    Boolean(externalProfileUrl) ||
    String(profileUser.id || '').startsWith('ap_') ||
    String(profileUser.username || '').includes('@');
  const resolvedExternalDomain =
    externalDomain || (profileUser.username?.includes('@') ? profileUser.username.split('@')[1] : undefined);

  const handleShareProfile = async () => {
    const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
    if (!shareUrl) return;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `${profileUser.name} (@${profileUser.username})`,
          url: shareUrl,
        });
        return;
      } catch {
        // Fallback para copiar link se o usuário cancelar ou o navegador bloquear
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast({ title: 'Link do perfil copiado!' });
    } catch {
      toast({ title: 'Não foi possível copiar o link.', variant: 'destructive' });
    }
  };

  // Use the hook to get the handlePinPost function
  const { handlePinPost } = usePostMainInteractions({
    post: null, // This hook is used here only for the pinning action, not for post data
    setPost: () => {},
    currentUserId: activeUser?.id || null,
    openLoginPrompt: requireLoginOrPrompt,
    refreshPost: async () => null, // Provide a dummy refresh function
  });

  // If profileUser has blocked the activeUser, don't show most interactive elements
  if (profileUser.hasBlockedCurrentUser && !isOwnProfile && !activeUser?.isAdmin) {
    // Still show basic info, but limited actions
    return (
      <div className="p-6 pb-4 relative">
         <div className="relative -mt-14" style={{ width: '7rem' }}> 
            <Avatar className="h-28 w-28 rounded-full border-4 border-background ring-2 ring-destructive">
            <AvatarImage
              src={profileUser.avatarUrl}
              alt={profileUser.avatarAlt?.trim() || profileUser.name}
              title={profileUser.avatarAlt?.trim() || undefined}
              data-ai-hint={profileUser["data-ai-hint"] || "person avatar"}
            />
            <AvatarFallback className="text-4xl">{profileUser.name?.substring(0, 1) || '?'}</AvatarFallback>
            </Avatar>
        </div>
        <div className="mt-4 space-y-3 min-w-0">
            <div>
              <h1 className="text-2xl font-bold text-foreground truncate">{profileUser.name}</h1>
              <div className="flex items-center space-x-2">
                <p className="text-sm text-muted-foreground truncate">@{profileUser.username}</p>
                {profileUser.isFollowedBy && <Badge variant="secondary" className="text-xs font-normal">Segue você</Badge>}
              </div>
            </div>
            
            {/* Stats Section - Moved and restyled */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 text-sm text-muted-foreground">
              <span title={exactCountTitle(profileUser.followingCount)}>
                <span className="font-bold text-foreground">{compactCount(profileUser.followingCount)}</span> {t('following')}
              </span>
              <span title={exactCountTitle(profileUser.followersCount)}>
                <span className="font-bold text-foreground">{compactCount(profileUser.followersCount)}</span> {t('followers')}
              </span>
              <span title={exactCountTitle(profileUser.postsCount)}>
                <span className="font-bold text-foreground">{compactCount(profileUser.postsCount)}</span> {t('posts')}
              </span>
            </div>

            {profileUser.bio && <p className="text-sm text-foreground whitespace-pre-wrap pt-1">{profileUser.bio}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 pt-6 pb-4 relative">
      {/* Linha superior: Avatar à esquerda (sobrepondo a capa) e ações na parte preta abaixo da capa à direita */}
      <div className="flex items-end justify-between gap-2 sm:gap-3">
        <div className="relative -mt-14 shrink-0" style={{ width: '7rem' }}>
          <Avatar className="h-28 w-28 rounded-full border-4 border-background ring-2 ring-primary">
            <AvatarImage
              src={profileUser.avatarUrl}
              alt={profileUser.avatarAlt?.trim() || profileUser.name}
              title={profileUser.avatarAlt?.trim() || undefined}
              data-ai-hint={profileUser["data-ai-hint"] || "person avatar"}
            />
            <AvatarFallback className="text-4xl">{profileUser.name?.substring(0, 1) || '?'}</AvatarFallback>
          </Avatar>
          {profileUser.avatarAlt?.trim() && (
            <span
              title={profileUser.avatarAlt.trim()}
              aria-label={`Descrição da foto de perfil: ${profileUser.avatarAlt.trim()}`}
              className="absolute bottom-1 right-1 rounded bg-black/75 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-white ring-1 ring-white/25"
            >
              ALT
            </span>
          )}
        </div>

        <div className="relative z-20 flex items-center justify-end flex-wrap gap-1.5 sm:gap-2 pt-11 min-w-0">
          {isRemoteFediverse && (
            <FederationBadge
              isRemote={true}
              remoteHandle={profileUser.username}
              remoteDomain={resolvedExternalDomain}
            />
          )}
          {isOwnProfile ? (
            <>
              <EditProfileDialog user={profileUser} onProfileUpdated={onProfileUpdated}>
                <span className="inline-flex">
                  <Button variant="outline" size="sm" className="h-9 px-4 rounded-full hidden md:inline-flex">
                    <Edit3 className="mr-2 h-4 w-4" /> {t('editProfile')}
                  </Button>
                  <Button variant="outline" size="icon" className="h-9 w-9 rounded-full md:hidden">
                    <Edit3 className="h-4 w-4" /> <span className="sr-only">{t('editProfile')}</span>
                  </Button>
                </span>
              </EditProfileDialog>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-9 w-9 rounded-full border-border/70 hover:bg-muted/80">
                    <MoreHorizontal className="h-5 w-5" />
                    <span className="sr-only">{t('moreOptions')}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => void handleShareProfile()}>
                    <Share2 className="mr-2 h-4 w-4" />
                    Compartilhar perfil
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : profileUser.isBlocked ? (
            activeUser && !activeUser.isAdmin && ( // Non-admin active users see Unblock button if they blocked this profile
              <>
                <Button onClick={onBlockToggle} variant="destructive" size="sm" className="h-9 px-4 rounded-full hidden md:inline-flex">
                  <ShieldOff className="mr-2 h-4 w-4" /> {t('unblock')}
                </Button>
                <Button onClick={onBlockToggle} variant="destructive" size="icon" className="h-9 w-9 rounded-full md:hidden">
                  <ShieldOff className="h-4 w-4" /> <span className="sr-only">{t('unblock')}</span>
                </Button>
              </>
            )
          ) : (
            <>
              {activeUser && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 rounded-full border-border/70 bg-background/80 hover:bg-muted/80"
                      title={t('postNotifications')}
                    >
                      {profileUser.notificationSubscriptionStatus && profileUser.notificationSubscriptionStatus !== 'none'
                        ? <BellRing className="h-4 w-4 text-primary" />
                        : <Bell className="h-4 w-4" />
                      }
                      <span className="sr-only">{t('postNotifications')}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>{t('notifyMeAbout')}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onUpdateNotificationSubscription('all')}>
                      <MessageSquareText className="mr-2 h-4 w-4" />
                      <span>{t('allPosts')}</span>
                      {profileUser.notificationSubscriptionStatus === 'all' && <Check className="ml-auto h-4 w-4" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onUpdateNotificationSubscription('news_only')}>
                      <Newspaper className="mr-2 h-4 w-4" />
                      <span>{t('onlyNews')}</span>
                      {profileUser.notificationSubscriptionStatus === 'news_only' && <Check className="ml-auto h-4 w-4" />}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onUpdateNotificationSubscription('none')} className="text-destructive focus:text-destructive">
                      {t('disableNotifications')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {activeUser && !isOwnProfile && (
                <Button
                  onClick={onMessageUser}
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 rounded-full border-border/70 bg-background/80 hover:bg-muted/80"
                  title={t('message')}
                >
                  <MessageSquare className="h-4 w-4" />
                  <span className="sr-only">{t('message')}</span>
                </Button>
              )}

              {activeUser && isRemoteFediverseUser(profileUser) ? (
                <RemoteFollowButton
                  targetUser={profileUser}
                  activeUserId={activeUser.id}
                  variant="profile"
                />
              ) : profileUser.isFollowing ? (
                <div
                  ref={followContainerRef}
                  className="relative"
                  onMouseEnter={openFollowMenu}
                  onMouseLeave={scheduleCloseFollowMenu}
                >
                  <Button
                    type="button"
                    onClick={() => setFollowMenuOpen((prev) => !prev)}
                    variant="secondary"
                    size="icon"
                    className={`relative h-9 w-9 rounded-full border transition-all [touch-action:manipulation] ${
                      profileUser.isFollowedBy
                        ? 'border-primary/50 bg-primary/15 text-primary hover:bg-primary/25'
                        : 'border-border/70 bg-secondary/90 hover:bg-secondary'
                    }`}
                    disabled={!activeUser && !isOwnProfile}
                    aria-pressed={true}
                    aria-expanded={followMenuOpen}
                    aria-label={
                      profileUser.isFollowedBy
                        ? 'Segue você · Seguindo (opções)'
                        : `${t('following')} (opções)`
                    }
                    title={profileUser.isFollowedBy ? 'Segue você · Seguindo' : t('following')}
                    data-testid="profile-follow-button"
                  >
                    <UserCheck className="h-4 w-4" />
                    {profileUser.isFollowedBy && (
                      <span
                        className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background"
                        aria-hidden="true"
                      />
                    )}
                  </Button>

                  {followMenuOpen && (
                    <div
                      className="absolute right-0 top-full mt-1.5 w-52 rounded-2xl border border-border/80 bg-popover/95 backdrop-blur-md p-1.5 shadow-xl z-30 animate-in fade-in-0 zoom-in-95 duration-150"
                      role="menu"
                    >
                      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
                        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                          <UserCheck className="h-3.5 w-3.5 text-primary" />
                          {t('following')}
                        </span>
                        {profileUser.isFollowedBy && (
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
                          setFollowMenuOpen(false);
                          void onFollowToggle();
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
              ) : (
                <Button
                  onClick={onFollowToggle}
                  variant="default"
                  size="sm"
                  className="h-9 px-4 rounded-full font-semibold [touch-action:manipulation]"
                  disabled={!activeUser && !isOwnProfile}
                  aria-pressed={false}
                  data-testid="profile-follow-button"
                >
                  <UserPlus className="mr-1.5 h-4 w-4" />
                  <span>{profileUser.isFollowedBy ? 'Seguir de volta' : t('follow')}</span>
                </Button>
              )}

              {!activeUser && !isOwnProfile && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 px-3.5 rounded-full border-border/70"
                  onClick={() => requireLoginOrPrompt(t('interactWith', { username: profileUser.username }))}
                >
                  <LogIn className="mr-2 h-4 w-4" /> {t('loginToInteract')}
                </Button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 rounded-full border-border/70 bg-background/80 hover:bg-muted/80"
                    title={t('moreOptions')}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">{t('moreOptions')}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => void handleShareProfile()}>
                    <Share2 className="mr-2 h-4 w-4" />
                    Compartilhar perfil
                  </DropdownMenuItem>
                  {externalProfileUrl && (
                    <DropdownMenuItem asChild>
                      <a href={externalProfileUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Abrir em {resolvedExternalDomain || 'origem'}
                      </a>
                    </DropdownMenuItem>
                  )}
                  {activeUser && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={onMuteToggle}>
                        {profileUser.isMuted ? <Volume2 className="mr-2 h-4 w-4" /> : <VolumeX className="mr-2 h-4 w-4" />}
                        {profileUser.isMuted ? t('unmute') : t('mute')} @{profileUser.username}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={onBlockToggle} className="text-destructive focus:text-destructive focus:bg-destructive/10">
                        <ShieldAlert className="mr-2 h-4 w-4" /> {t('block')} @{profileUser.username}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={onReport} className="text-destructive focus:text-destructive focus:bg-destructive/10">
                        <AlertTriangle className="mr-2 h-4 w-4" /> {t('report')} @{profileUser.username}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      {/* Name, Username, Stats, and Bio below avatar */}
      <div className="mt-4 space-y-3 min-w-0">
        <div>
          <h1 className="text-2xl font-bold text-foreground truncate">{profileUser.name}</h1>
          <div className="flex flex-wrap items-center gap-2 min-w-0">
             <FediverseHandleExplainer
               username={profileUser.username}
               userId={profileUser.id}
               isRemoteFediverse={(profileUser as User & { isRemoteFediverse?: boolean }).isRemoteFediverse}
               federatedLoginProvider={profileUser.federatedLoginProvider}
               federatedLoginHandle={profileUser.federatedLoginHandle}
               matrixHandle={profileUser.matrixHandle}
             />
             {profileUser.federatedLoginHandle && (
               <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground">
                 Conectado via @{profileUser.federatedLoginHandle.replace(/^@/, '')}
               </Badge>
             )}
             {profileUser.pronouns && (
               <span className="text-xs font-medium text-primary border border-primary/70 bg-transparent rounded-full px-2.5 py-0.5 shrink-0">
                 {profileUser.pronouns}
               </span>
             )}
             {profileUser.isFollowedBy && <Badge variant="secondary" className="text-xs font-normal shrink-0">Segue você</Badge>}
             {profileUser.pixKey && (
               <PixSupportBadge user={profileUser} defaultOpen={isPixOpen} />
             )}
          </div>
        </div>
        
        {profileUser.bio && (
          <p className="text-sm text-foreground whitespace-pre-wrap pt-1">
            <TextWithMentions text={profileUser.bio} />
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {profileUser.location && (
                <div className="flex items-center">
                    <MapPin className="h-4 w-4 mr-1.5" />
                    <span>{profileUser.location}</span>
                </div>
            )}
            {profileUser.website && (
                 <a href={profileUser.website.startsWith('http') ? profileUser.website : `https://${profileUser.website}`} target="_blank" rel="noopener noreferrer" className="flex items-center text-primary hover:underline">
                    <LinkIcon className="h-4 w-4 mr-1.5" />
                    <span>{profileUser.website.replace(/^https?:\/\//, '')}</span>
                </a>
            )}
            {profileUser.links?.map((item, idx) => (
              <a
                key={`${item.url}-${idx}`}
                href={item.url.startsWith('http') ? item.url : `https://${item.url}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center text-primary hover:underline"
              >
                <LinkIcon className="h-4 w-4 mr-1.5" />
                <span>{item.label || item.url.replace(/^https?:\/\//, '')}</span>
              </a>
            ))}
            {profileUser.matrixHandle && (
              <a
                href={`https://matrix.to/#/${encodeURIComponent(profileUser.matrixHandle)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center text-primary hover:underline"
              >
                <MessageCircle className="h-4 w-4 mr-1.5" />
                <span>{profileUser.matrixHandle}</span>
              </a>
            )}
        </div>

        {/* Stats Section - Moved here */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 text-sm text-muted-foreground">
          <Link href={`/${locale}/profile/${profileUser.id}/following`} className="hover:underline" data-interactive="true" title={exactCountTitle(profileUser.followingCount)}>
            <span className="font-bold text-foreground">{compactCount(profileUser.followingCount)}</span> {t('following')}
          </Link>
          <Link href={`/${locale}/profile/${profileUser.id}/followers`} className="hover:underline" data-interactive="true" title={exactCountTitle(profileUser.followersCount)}>
            <span className="font-bold text-foreground">{compactCount(profileUser.followersCount)}</span> {t('followers')}
          </Link>
          <span title={exactCountTitle(profileUser.postsCount)}>
            <span className="font-bold text-foreground">{compactCount(profileUser.postsCount)}</span> {t('posts')}
          </span>
        </div>
      </div>
    </div>
  );
}
