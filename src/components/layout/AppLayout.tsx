// src/components/layout/AppLayout.tsx
'use client';

import React, { useState, useEffect, useCallback, useMemo, cloneElement } from 'react';
import type { ReactElement } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { SidebarProvider } from '@/components/ui/sidebar';
import { useToast } from '@/hooks/use-toast';
import PostCardSkeleton from '@/components/feed/PostCardSkeleton';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import LoginOrRegisterPromptDialog from '@/components/auth/LoginOrRegisterPromptDialog';
import { logoutUser as serverLogoutUser } from '@/lib/services/authService';
import type { Post } from '@/lib/types';
import { useUnreadNotificationsCount } from '@/hooks/features/notifications/useUnreadNotificationsCount';
import { ToastAction } from '@/components/ui/toast';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Home, TrendingUp, Bell, MessageSquare, Search, Newspaper } from 'lucide-react';

import DesktopSidebar from './DesktopSidebar';
import MobileBottomNavigationBar from './MobileBottomNavigationBar';
import MobileFloatingActionButtons from './MobileFloatingActionButtons';
import GlobalSearch from './GlobalSearch';
import RightSidebar from './RightSidebar';
import AppHeader from './AppHeader';
import ScrollChrome from './ScrollChrome';
import PwaInstallBanner from '@/components/pwa/PwaInstallBanner';
import ManageFeedsDialog from '@/components/feed/ManageFeedsDialog';
import { applyDocumentAccentColor } from '@/lib/utils/themeColor';

const AppLayoutContentSkeleton: React.FC = () => (
  <div className="w-full min-w-0">
    <PostCardSkeleton />
    <PostCardSkeleton />
    <PostCardSkeleton />
  </div>
);

interface AppLayoutProps {
  children: ReactElement;
}

const AppLayout = ({ children }: AppLayoutProps) => {
  const t = useTranslations('AppLayout');
  const { currentUser, firebaseUser, isLoading: isLoadingCurrentUser, refreshCurrentUser, logout } = useCurrentUser();
  const unreadNotificationsCount = useUnreadNotificationsCount(currentUser?.id);
  const unreadMessagesCount = currentUser?.totalUnreadMessages || 0;
  const locale = useLocale();

  const [isCreatePostDialogOpen, setIsCreatePostDialogOpen] = useState(false);
  const [isCreateNewsDialogOpen, setIsCreateNewsDialogOpen] = useState(false);
  const [isManageFeedsDialogOpen, setIsManageFeedsDialogOpen] = useState(false);
  const [clientHasMounted, setClientHasMounted] = useState(false);

  useEffect(() => {
    applyDocumentAccentColor(currentUser?.accentColor);
  }, [currentUser?.accentColor]);

  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [promptActionName, setPromptActionName] = useState('');

  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  
  useEffect(() => {
    setClientHasMounted(true);
  }, []);

  const navItems = [
    { href: `/${locale}`, label: t('nav.feed'), icon: Home, requiresAuth: false, showBadge: false },
    { href: `/${locale}/explore`, label: t('nav.explore'), icon: Search, requiresAuth: false, showBadge: false },
    { href: `/${locale}/messages`, label: t('nav.messages'), icon: MessageSquare, requiresAuth: true, authHref: () => `/${locale}/messages`, showBadge: true },
    { href: `/${locale}/notifications`, label: t('nav.notifications'), icon: Bell, requiresAuth: true, authHref: () => `/${locale}/notifications`, showBadge: true },
    { href: `/${locale}/breaknews`, label: 'BreakNews', icon: Newspaper, requiresAuth: true, showBadge: false },
  ];

  const handleLogout = async () => {
    try {
      await serverLogoutUser();
      logout(); // This synchronously clears the state
      toast({ title: t('logoutSuccessTitle'), description: t('logoutSuccessDescription') });
      router.push(`/${locale}/login`);
    } catch (error: any) {
      toast({
        title: t('logoutErrorTitle'),
        description: error.message || t('logoutErrorDescription'),
        variant: 'destructive',
      });
    }
  };

  // Identidade fixa: o elemento da página abaixo só muda quando a página muda. Antes cada renderização do layout (uma
  // notificação nova, um contador de mensagens, a rolagem) recriava a função e o elemento e redesenhava a página inteira.
  const handlePostCreated = useCallback((newPost: Post) => {
    toast({
      title: newPost.category === 'news' ? t('articlePublished') : t('postSent'),
      action: (
        <ToastAction altText={t('viewPost')} asChild>
          <Link href={`/${locale}/post/${newPost.id}`}>{t('viewPost')}</Link>
        </ToastAction>
      ),
    });
    setIsCreatePostDialogOpen(false);
    setIsCreateNewsDialogOpen(false);

    if (typeof (window as any).handleGlobalPostCreation === 'function') {
      (window as any).handleGlobalPostCreation(newPost);
    }
  }, [locale, t, toast]);

  const childrenWithProps = useMemo(
    () => (React.isValidElement(children)
      ? cloneElement(children, { onPostCreated: handlePostCreated } as any)
      : children),
    [children, handlePostCreated],
  );

  const fabHiddenPaths = [
    `/${locale}/post`,
    `/${locale}/notifications`,
    `/${locale}/explore`,
    `/${locale}/settings`,
    `/${locale}/messages`,
    `/${locale}/about`,
    `/${locale}/privacy`,
    `/${locale}/terms`,
    `/${locale}/cookies`,
    `/${locale}/community-guidelines`,
    `/${locale}/login`,
    `/${locale}/register`,
    `/${locale}/auth`,
  ];
  const canCreateContent = firebaseUser?.emailVerified === true;
  const shouldShowFab = clientHasMounted && isMobile && currentUser && canCreateContent
    && !fabHiddenPaths.some((path) => pathname.startsWith(path));
  
  const showMobileNav = clientHasMounted && isMobile;
  // Mensagens são uma tarefa focada: no desktop a conversa usa a área central inteira, sem tendências e artigos ao lado.
  const isMessagesRoute = pathname.startsWith(`/${locale}/messages`);

  return (
    <>
      <ScrollChrome />
      <LoginOrRegisterPromptDialog
        open={showLoginPrompt}
        onOpenChange={setShowLoginPrompt}
        actionName={promptActionName}
        currentPath={pathname}
      />
       {currentUser && (
        <ManageFeedsDialog
          open={isManageFeedsDialogOpen}
          onOpenChange={setIsManageFeedsDialogOpen}
          user={currentUser}
          onPreferencesChanged={refreshCurrentUser}
        />
      )}
      <div className="min-h-screen bg-background">
        <SidebarProvider forceCollapsed={isMessagesRoute}>
          <div className="flex w-full max-w-[1400px] mx-auto justify-center px-0 min-[801px]:px-4">
            <DesktopSidebar
              currentUser={currentUser}
              canCreateContent={canCreateContent}
              isLoadingCurrentUser={isLoadingCurrentUser}
              unreadNotifications={unreadNotificationsCount}
              unreadMessages={unreadMessagesCount}
              pathname={pathname}
              navItems={navItems}
              handleLogout={handleLogout}
              isCreatePostDialogOpen={isCreatePostDialogOpen}
              setIsCreatePostDialogOpen={setIsCreatePostDialogOpen}
              isCreateNewsDialogOpen={isCreateNewsDialogOpen}
              setIsCreateNewsDialogOpen={setIsCreateNewsDialogOpen}
              onPostCreated={handlePostCreated}
              clientHasMounted={clientHasMounted}
              onManageFeedsClick={() => setIsManageFeedsDialogOpen(true)}
            />
            
            <main className={cn('w-full min-w-0', isMessagesRoute ? 'flex-1 max-w-[1200px]' : 'max-w-[600px]')}>
              <AppHeader />
              {clientHasMounted && firebaseUser && !firebaseUser.emailVerified
                && !pathname.startsWith(`/${locale}/auth/verify-email`) && (
                <div className="border-b border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                  Confirme seu e-mail para publicar e interagir.{' '}
                  <Link className="font-medium underline" href={`/${locale}/auth/verify-email`}>Confirmar agora</Link>
                </div>
              )}
              {!clientHasMounted || (isLoadingCurrentUser && !currentUser) ? (
                <AppLayoutContentSkeleton />
              ) : (
                childrenWithProps
              )}
            </main>

            {!isMessagesRoute && <RightSidebar />}
          </div>
          
          {showMobileNav && (
            <MobileBottomNavigationBar
              currentUser={currentUser}
              isLoadingCurrentUser={isLoadingCurrentUser}
              navItems={navItems}
              unreadNotifications={unreadNotificationsCount}
              unreadMessages={unreadMessagesCount}
              pathname={pathname}
              setShowLoginPrompt={setShowLoginPrompt}
              setPromptActionName={setPromptActionName}
            />
          )}
          
          {shouldShowFab && (
            <MobileFloatingActionButtons
              currentUser={currentUser}
              isLoadingCurrentUser={isLoadingCurrentUser}
              isCreatePostDialogOpen={isCreatePostDialogOpen}
              setIsCreatePostDialogOpen={setIsCreatePostDialogOpen}
              isCreateNewsDialogOpen={isCreateNewsDialogOpen}
              setIsCreateNewsDialogOpen={setIsCreateNewsDialogOpen}
              onPostCreated={handlePostCreated}
              setShowLoginPrompt={setShowLoginPrompt}
              setPromptActionName={setPromptActionName}
              clientHasMounted={clientHasMounted}
            />
          )}
        </SidebarProvider>
      </div>
      <PwaInstallBanner />
    </>
  );
};

export default AppLayout;
