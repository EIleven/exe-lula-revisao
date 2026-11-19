// src/app/[locale]/settings/page.tsx
'use client';

import React from 'react';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { Skeleton } from '@/components/ui/skeleton';
import {
  User, Shield, ShieldQuestion, Bell, Film, Palette, Accessibility, Languages, HelpCircle, Info, LogOut, ChevronRight, MessageCircleMore
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { logoutUser as serverLogoutUser } from '@/lib/services/authService';
import { Separator } from '@/components/ui/separator';
import { useLocale } from 'next-intl';
import { Card } from '@/components/ui/card';
import Link from 'next/link';
import { useHiperChatMode } from '@/hooks/useHiperChatMode';
import HiperChatSettingsView from './HiperChatSettingsView';

type SettingsSection = 'account' | 'privacy' | 'moderation' | 'notifications' | 'media' | 'appearance' | 'accessibility' | 'languages' | 'help' | 'about' | 'interaction';

const SETTINGS_SECTIONS: { id: SettingsSection; labelKey: string; icon: React.ElementType; adminOnly?: boolean }[] = [
  { id: 'account', labelKey: 'sections.account', icon: User },
  { id: 'privacy', labelKey: 'sections.privacy', icon: Shield },
  { id: 'moderation', labelKey: 'sections.moderation', icon: ShieldQuestion, adminOnly: false },
  { id: 'interaction', labelKey: 'sections.interaction', icon: MessageCircleMore },
  { id: 'notifications', labelKey: 'sections.notifications', icon: Bell },
  { id: 'media', labelKey: 'sections.media', icon: Film },
  { id: 'appearance', labelKey: 'sections.appearance', icon: Palette },
  { id: 'accessibility', labelKey: 'sections.accessibility', icon: Accessibility },
  { id: 'languages', labelKey: 'sections.languages', icon: Languages },
  { id: 'help', labelKey: 'sections.help', icon: HelpCircle },
  { id: 'about', labelKey: 'sections.about', icon: Info },
];

const SettingsPageSkeleton = () => (
  <div className="container mx-auto max-w-xl py-8 space-y-8">
    <div className="flex flex-col items-center space-y-3">
        <Skeleton className="h-24 w-24 rounded-full" />
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-5 w-32" />
    </div>
    <div className="space-y-2">
        {[...Array(11)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
        ))}
    </div>
  </div>
);

export default function SettingsPage() {
  const t = useTranslations('SettingsPage');
  const { currentUser, isLoading, refreshCurrentUser } = useCurrentUser();
  const router = useRouter();
  const { toast } = useToast();
  const locale = useLocale();
  const isHiperChat = useHiperChatMode();

  const handleLogout = async () => {
    try {
      await serverLogoutUser();
      await refreshCurrentUser();
      toast({ title: "Sessão Encerrada", description: "Você foi desconectado com sucesso." });
      router.push(`/${locale}/login`);
      router.refresh();
    } catch (error: any) {
      toast({
        title: "Erro ao Sair",
        description: error.message || "Não foi possível encerrar a sessão.",
        variant: 'destructive',
      });
    }
  };

  if (isLoading || !currentUser) {
    return <SettingsPageSkeleton />;
  }

  if (isHiperChat) {
    return (
      <HiperChatSettingsView
        user={currentUser}
        onUpdated={refreshCurrentUser}
        onLogout={handleLogout}
      />
    );
  }
  
  const availableSections = SETTINGS_SECTIONS.filter(section => 
    !section.adminOnly || (section.adminOnly && (currentUser.isAdmin || currentUser.isModerator))
  );

  return (
    <div className="container mx-auto max-w-xl py-8">
        <header className="flex flex-col items-center space-y-3 mb-10 text-center">
            <Avatar className="h-24 w-24 ring-4 ring-primary/20">
            <AvatarImage src={currentUser.avatarUrl} alt={currentUser.name} data-ai-hint={currentUser['data-ai-hint'] || 'person avatar'} />
            <AvatarFallback className="text-4xl">{currentUser.name?.substring(0, 1)}</AvatarFallback>
            </Avatar>
            <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
                {currentUser.name}
            </h1>
            <p className="text-muted-foreground">@{currentUser.username}</p>
            </div>
        </header>
        
        <nav className="space-y-2">
            {availableSections.map(({ id, labelKey, icon: Icon }) => (
                <Button
                    key={id}
                    variant="ghost"
                    className="w-full justify-between text-base py-8 px-4"
                    asChild
                >
                    <Link href={`/${locale}/settings/${id}`}>
                        <div className="flex items-center">
                            <Icon className="mr-4 h-5 w-5 text-muted-foreground" />
                            <span>{t(labelKey as any)}</span>
                        </div>
                        <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </Link>
                </Button>
            ))}
            <Separator className="my-2 !mt-4" />
            <AlertDialog>
            <AlertDialogTrigger asChild>
                <Button
                variant="ghost"
                className="w-full justify-start text-base py-6 px-4 text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                <LogOut className="mr-4 h-5 w-5" />
                <span>{t('logout')}</span>
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                <AlertDialogTitle>{t('logoutConfirmTitle')}</AlertDialogTitle>
                <AlertDialogDescription>
                    {t('logoutConfirmDescription')}
                </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleLogout}>{t('logout')}</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
            </AlertDialog>
        </nav>
    </div>
  );
}
