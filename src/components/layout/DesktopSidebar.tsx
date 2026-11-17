// src/components/layout/DesktopSidebar.tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home, TrendingUp, User, Settings, MessageSquare, LogOut, 
  FilePlus2, MessageSquarePlus, Bell, Search as SearchIcon,
  LogIn, UserPlus, Newspaper, Edit, Bookmark, Folder, Shield, ListPlus, ArrowUp
} from 'lucide-react';
import Logo from '@/components/shared/Logo';
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar, // Import useSidebar hook
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { User as UserType, Post } from '@/lib/types';
import { compactCount, exactCountTitle } from '@/lib/media/videoQueue';
import { Badge as UiBadge } from '@/components/ui/badge';
import { useLocale, useTranslations } from 'next-intl';
import Image from 'next/image';
import CreatePostDialogContent from '@/components/feed/CreatePostDialogContent';
import CreateNewsDialogContent from '@/components/feed/CreateNewsDialogContent';
import UniverseLensBar from '@/components/idp2p/UniverseLensBar';
import {
  scrollToTopSmoothly,
  subscribeFeedScrollTarget,
  type FeedScrollTarget,
} from '@/lib/feedScrollTop';


interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  requiresAuth: boolean;
  authHref?: (userId: string) => string; 
  showBadge?: boolean;
}

interface DesktopSidebarProps {
  currentUser: UserType | null | undefined;
  canCreateContent: boolean;
  isLoadingCurrentUser: boolean;
  unreadNotifications: number;
  unreadMessages: number;
  pathname: string;
  navItems: NavItem[];
  handleLogout: () => Promise<void>;
  isCreatePostDialogOpen: boolean;
  setIsCreatePostDialogOpen: (open: boolean) => void;
  isCreateNewsDialogOpen: boolean;
  setIsCreateNewsDialogOpen: (open: boolean) => void;
  onPostCreated: (newPost: Post) => void; 
  clientHasMounted: boolean;
  onManageFeedsClick: () => void;
}

const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  currentUser,
  canCreateContent,
  isLoadingCurrentUser,
  unreadNotifications,
  unreadMessages,
  pathname,
  navItems,
  handleLogout,
  isCreatePostDialogOpen,
  setIsCreatePostDialogOpen,
  isCreateNewsDialogOpen,
  setIsCreateNewsDialogOpen,
  onPostCreated,
  clientHasMounted,
  onManageFeedsClick,
}) => {
  const t = useTranslations('DesktopSidebar');
  const locale = useLocale();
  const { state: sidebarState } = useSidebar(); // Get the sidebar state

  const isCompact = sidebarState === 'collapsed';

  return (
    <Sidebar
      variant="sidebar"
      collapsible="icon"
      className="hidden md:flex relative border-r border-sidebar-border h-screen sticky top-0 transition-[width] duration-200"
      style={{ width: isCompact ? '80px' : 'var(--sidebar-left-width)' }}
    >
      <SidebarHeader className="p-4 border-b border-sidebar-border text-center">
        {(!clientHasMounted || isLoadingCurrentUser) ? (
          <div className="flex flex-col items-center space-y-2">
            <Skeleton className="h-16 w-16 rounded-full" />
            <div className={cn("space-y-1 mt-2", isCompact && "hidden")}><Skeleton className="h-4 w-24 mx-auto" /><Skeleton className="h-3 w-20 mx-auto" /></div>
            <div className={cn("flex space-x-4 pt-1 justify-center", isCompact && "hidden")}><Skeleton className="h-3 w-16" /><Skeleton className="h-3 w-16" /></div>
          </div>
        ) : currentUser ? (
          <div className="flex flex-col items-center space-y-2">
              <Link href={`/${locale}/profile/${currentUser.id}`} className="block group hover:bg-sidebar-accent/10 p-2 rounded-md transition-colors -m-2" data-interactive="true">
              <Avatar className={cn("h-16 w-16 ring-2 ring-sidebar-primary mx-auto group-hover:ring-sidebar-accent transition-colors", isCompact && "h-12 w-12")}>
                <AvatarImage src={currentUser.avatarUrl} alt={currentUser.name} data-ai-hint={currentUser['data-ai-hint'] || "person avatar"}/>
                <AvatarFallback className="text-2xl">{currentUser.name?.substring(0, 1) || '?'}</AvatarFallback>
              </Avatar>
              <div className={cn("mt-2", isCompact && "hidden")}><p className="font-semibold text-md text-sidebar-foreground">{currentUser.name}</p><p className="text-sm text-sidebar-foreground/70">@{currentUser.username}</p></div>
            </Link>
            <div className={cn("flex space-x-4 text-xs text-sidebar-foreground/70 pt-1", isCompact && "hidden")}>
              <Link href={`/${locale}/profile/${currentUser.id}/following`} className="hover:underline" onClick={(e)=> e.stopPropagation()} data-interactive="true" title={exactCountTitle(currentUser.followingCount)}>
                <span className="font-bold text-sidebar-foreground">{compactCount(currentUser.followingCount)}</span> {t('following')}
              </Link>
              <Link href={`/${locale}/profile/${currentUser.id}/followers`} className="hover:underline" onClick={(e)=> e.stopPropagation()} data-interactive="true" title={exactCountTitle(currentUser.followersCount)}>
                <span className="font-bold text-sidebar-foreground">{compactCount(currentUser.followersCount)}</span> {t('followers')}
              </Link>
            </div>
            <UniverseLensBar
              userId={currentUser.id}
              name={currentUser.name}
              avatarUrl={currentUser.avatarUrl}
              username={currentUser.username}
              federatedLoginProvider={currentUser.federatedLoginProvider}
              federatedLoginHandle={currentUser.federatedLoginHandle}
              compact={isCompact}
            />
          </div>
        ) : (
          <Link href={`/${locale}`} aria-label="HiperVerso.App Home" className="flex flex-col items-center justify-center py-8 group">
            <Image
              src="/brand/lula-logo.svg"
              alt="HiperVerso.App Logo"
              width={isCompact ? 40 : 48}
              height={isCompact ? 40 : 48}
              className="group-hover:opacity-80 transition-all"
            />
            <span
              className={cn(
                "text-xl font-bold text-foreground group-hover:text-primary transition-colors mt-2",
                isCompact && "hidden"
              )}
            >
              HiperVerso.App
            </span>
          </Link>
        )}
      </SidebarHeader>
      <SidebarContent className="p-2">
        <SidebarMenu>
          {navItems.map((item) => {
            if (item.requiresAuth && !currentUser && clientHasMounted) {
              return null; // Don't render auth-required items for logged-out users
            }
            
            let actualHref = item.href;
            let isActive = false;
            const tooltipText = item.label;
            
            if (!clientHasMounted || (item.requiresAuth && isLoadingCurrentUser)) {
                return (
                    <SidebarMenuItem key={`${item.label}-loading-desktop`}>
                        <SidebarMenuButton asChild tooltip={item.label} className="pointer-events-none opacity-50">
                            <Link href="#" aria-disabled={true} tabIndex={-1} style={{pointerEvents: 'none'}}>
                                <Skeleton className="h-5 w-5 rounded-sm" /><Skeleton className={cn("h-4 w-20 ml-2 rounded-sm", isCompact && "hidden")} />
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                );
            } else if (item.requiresAuth && currentUser && item.authHref) {
                actualHref = item.authHref(currentUser.id);
            }

            // Correct isActive check for i18n routes
            const pathnameWithoutLocale = pathname.replace(`/${locale}`, '') || '/';
            const itemHrefWithoutLocale = item.href.replace(`/${locale}`, '') || '/';

            if (item.label === t('nav.profile') && currentUser) isActive = pathnameWithoutLocale.startsWith(`/profile/${currentUser.id}`);
            else if (item.href.includes('/messages')) isActive = pathnameWithoutLocale.startsWith("/messages");
            else if (item.href.includes('/notifications')) isActive = pathnameWithoutLocale.startsWith("/notifications");
            else isActive = pathnameWithoutLocale === itemHrefWithoutLocale;
            
            const isNotificationsItem = item.href.includes('/notifications');
            const isMessagesItem = item.href.includes('/messages');
            const count = isNotificationsItem ? unreadNotifications : isMessagesItem ? unreadMessages : 0;
            
            return (
              <React.Fragment key={`${item.label}-desktop`}>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip={tooltipText} isActive={isActive} className="relative">
                    <Link href={actualHref}>
                      <div className="relative">
                          <item.icon />
                          {item.showBadge && clientHasMounted && currentUser && !isLoadingCurrentUser && count > 0 && (
                              <UiBadge variant="default" className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px]">
                                  {count > 9 ? '9+' : count}
                              </UiBadge>
                          )}
                      </div>
                      <span className={cn(isCompact && "hidden")}>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {itemHrefWithoutLocale === '/explore' && currentUser && (
                  <SidebarMenuItem key="feeds-desktop">
                    <SidebarMenuButton onClick={onManageFeedsClick} tooltip={t('feeds')}>
                      <ListPlus /><span className={cn(isCompact && "hidden")}>{t('feeds')}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </React.Fragment>
            );
        })}

        {currentUser && (
          <>
            <SidebarMenuItem key="drafts-desktop">
              <SidebarMenuButton asChild tooltip={t('drafts')} isActive={pathname.endsWith('/drafts')}>
                <Link href={`/${locale}/drafts`}><Edit /><span className={cn(isCompact && "hidden")}>{t('drafts')}</span></Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem key="bookmarks-desktop">
              <SidebarMenuButton asChild tooltip={t('bookmarks')} isActive={pathname.endsWith('/bookmarks')}>
                <Link href={`/${locale}/bookmarks`}><Bookmark /><span className={cn(isCompact && "hidden")}>{t('bookmarks')}</span></Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem key="files-desktop">
              <SidebarMenuButton asChild tooltip={t('files')} isActive={pathname.endsWith('/files')}>
                <Link href={`/${locale}/files`}><Folder /><span className={cn(isCompact && "hidden")}>{t('files')}</span></Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </>
        )}
        
        {(!clientHasMounted || isLoadingCurrentUser) ? (
          <>
             {currentUser?.isAdmin && (
                <SidebarMenuItem key="admin-skeleton-desktop">
                    <SidebarMenuButton asChild tooltip={t('adminPanel')} className="pointer-events-none opacity-50">
                        <Link href="#" aria-disabled={true} tabIndex={-1} style={{pointerEvents:'none'}}>
                            <Skeleton className="h-5 w-5 rounded-sm" /><Skeleton className={cn("h-4 w-20 ml-2 rounded-sm", isCompact && "hidden")} />
                        </Link>
                    </SidebarMenuButton>
                </SidebarMenuItem>
             )}
            <SidebarMenuItem key="settings-skeleton-desktop">
                <SidebarMenuButton asChild tooltip={t('settings')} className="pointer-events-none opacity-50">
                  <Link href="#" aria-disabled={true} tabIndex={-1} style={{pointerEvents:'none'}}>
                      <Skeleton className="h-5 w-5 rounded-sm" /><Skeleton className={cn("h-4 w-20 ml-2 rounded-sm", isCompact && "hidden")} />
                  </Link>
                </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem key="logout-skeleton-desktop">
              <SidebarMenuButton tooltip={t('logout')} className="pointer-events-none opacity-50" disabled>
                <Skeleton className="h-5 w-5 rounded-sm" /><Skeleton className={cn("h-4 w-20 ml-2 rounded-sm", isCompact && "hidden")} />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </>
        ) : currentUser ? (
          <>
            {currentUser.isAdmin && (
              <SidebarMenuItem key="admin-panel-desktop">
                <SidebarMenuButton asChild tooltip={t('adminPanel')} isActive={pathname.startsWith(`/${locale}/admin`)}>
                  <Link href={`/${locale}/admin`}>
                    <Shield />
                    <span className={cn(isCompact && "hidden")}>{t('adminPanel')}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            <SidebarMenuItem key="settings-desktop">
              <SidebarMenuButton asChild tooltip={t('settings')} isActive={pathname.endsWith('/settings')}>
                <Link href={`/${locale}/settings`}><Settings /><span className={cn(isCompact && "hidden")}>{t('settings')}</span></Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem key="logout-desktop">
              <SidebarMenuButton onClick={handleLogout} tooltip={t('logout')}>
                <LogOut /><span className={cn(isCompact && "hidden")}>{t('logout')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </>
        ) : null }
      </SidebarMenu>
    </SidebarContent>
    <SidebarFooter
      className={cn(
        "p-4 space-y-2",
        isCompact && "px-2 pb-16",
        !isCompact && (!currentUser || !canCreateContent) && "pb-16",
      )}
    >
      {(!clientHasMounted || isLoadingCurrentUser) ? (
        <><Skeleton className="h-10 w-full rounded-md" /><Skeleton className="h-10 w-full rounded-md" /></>
      ) : currentUser && canCreateContent ? (
        <>
          <Dialog open={isCreatePostDialogOpen} onOpenChange={setIsCreatePostDialogOpen}>
            <DialogTrigger asChild>
              <Button className={cn("self-center rounded-full", isCompact ? "h-10 w-10 p-0" : "px-8")} aria-label={t('post')}>
                <MessageSquarePlus className={cn("h-5 w-5", !isCompact && "mr-2")} />
                <span className={cn(isCompact && "hidden")}>{t('post')}</span>
              </Button>
            </DialogTrigger>
            <CreatePostDialogContent onPostCreated={onPostCreated} dialogClose={() => setIsCreatePostDialogOpen(false)} />
          </Dialog>
          <Dialog open={isCreateNewsDialogOpen} onOpenChange={setIsCreateNewsDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="secondary" className={cn("self-center rounded-full", isCompact ? "h-10 w-10 p-0" : "px-8")} aria-label={t('article')}>
                <FilePlus2 className={cn("h-5 w-5", !isCompact && "mr-2")} />
                <span className={cn(isCompact && "hidden")}>{t('article')}</span>
              </Button>
            </DialogTrigger>
            <CreateNewsDialogContent onPostCreated={onPostCreated} dialogClose={() => setIsCreateNewsDialogOpen(false)} />
          </Dialog>
        </>
      ) : currentUser ? (
        <Button variant="outline" className="w-full" asChild>
          <Link href={`/${locale}/auth/verify-email`}>Confirmar e-mail</Link>
        </Button>
      ) : (
          <div className={cn(isCompact && "hidden")}>
            <Button variant="outline" className="w-full" asChild>
              <Link href={`/${locale}/login`}><LogIn className="mr-2 h-4 w-4" /> {t('login')}</Link>
            </Button>
            <Button className="w-full mt-2" asChild>
              <Link href={`/${locale}/register`}><UserPlus className="mr-2 h-4 w-4" /> {t('register')}</Link>
            </Button>
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 pt-2 text-center text-xs text-sidebar-foreground/60">
              <Link href={`/${locale}/terms`} className="hover:underline">{t('terms')}</Link>
              <span>&middot;</span>
              <Link href={`/${locale}/privacy`} className="hover:underline">{t('privacy')}</Link>
              <span>&middot;</span>
              {/* Os Termos citam as Diretrizes: o caminho para elas precisa existir em lugar fixo. */}
              <Link href={`/${locale}/community-guidelines`} className="hover:underline">{t('guidelines')}</Link>
              <span>&middot;</span>
              <Link href={`/${locale}/cookies`} className="hover:underline">{t('cookies')}</Link>
            </div>
          </div>
      )}
    </SidebarFooter>
    <DesktopScrollTopButton isCompact={isCompact} />
  </Sidebar>
  );
};

const SHOW_DESKTOP_SCROLL_TOP_AFTER = 300;

function DesktopScrollTopButton({ isCompact }: { isCompact: boolean }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [feedTarget, setFeedTarget] = useState<FeedScrollTarget | null>(null);

  useEffect(() => subscribeFeedScrollTarget(setFeedTarget), []);

  useEffect(() => {
    let rafId = 0;
    const syncVisibility = () => {
      rafId = 0;
      const button = buttonRef.current;
      if (!button) return;
      const shouldShow = window.scrollY > SHOW_DESKTOP_SCROLL_TOP_AFTER;
      if ((button.dataset.visible === 'true') === shouldShow) return;
      button.dataset.visible = shouldShow ? 'true' : 'false';
      button.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
      button.tabIndex = shouldShow ? 0 : -1;
    };
    const onScroll = () => {
      if (rafId !== 0) return;
      rafId = window.requestAnimationFrame(syncVisibility);
    };
    syncVisibility();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafId !== 0) window.cancelAnimationFrame(rafId);
    };
  }, []);

  const hasNewPosts = feedTarget?.hasNewPosts === true;
  const label = hasNewPosts ? 'Voltar ao topo e ver novos posts' : 'Voltar ao topo';

  return (
    <div
      className={cn(
        "pointer-events-none absolute z-30",
        isCompact ? "bottom-3 left-1/2 -translate-x-1/2" : "bottom-4 right-3.5",
      )}
    >
      <Button
        ref={buttonRef}
        type="button"
        variant={hasNewPosts ? "default" : "secondary"}
        size="icon"
        onClick={() => scrollToTopSmoothly(feedTarget)}
        aria-label={label}
        title={label}
        aria-hidden="true"
        data-visible="false"
        tabIndex={-1}
        className={cn(
          "relative h-10 w-10 rounded-full shadow-lg transition-all duration-200 pointer-events-none scale-90 opacity-0",
          "data-[visible=true]:scale-100 data-[visible=true]:opacity-100 data-[visible=true]:pointer-events-auto",
          "hover:scale-105 active:scale-95",
          hasNewPosts
            ? "bg-primary text-primary-foreground hover:bg-primary/90 ring-2 ring-primary/25"
            : "bg-card/95 text-foreground border border-border hover:border-primary/60 hover:bg-primary hover:text-primary-foreground",
        )}
      >
        <ArrowUp className="h-5 w-5" aria-hidden="true" />
        {hasNewPosts && (
          <span
            className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-background"
            aria-hidden="true"
          />
        )}
      </Button>
    </div>
  );
}

export default DesktopSidebar;
