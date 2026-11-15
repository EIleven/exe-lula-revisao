// src/hooks/features/profile/useUserProfile.ts
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation'; // For handleMessageUser
import type { User } from '@/lib/types';
import {
  getUser as serverGetUser,
  setFollowUser,
  toggleMuteUser as serverToggleMuteUser,
  toggleBlockUser as serverToggleBlockUser,
  reportUser as serverReportUser,
  checkMutualFollow,
  updateNotificationSubscription,
  updateUserSettings,
} from '@/lib/services/userService';
import { useToast } from "@/hooks/use-toast";
import { useLocale } from 'next-intl';
import { useOptimisticToggle } from '@/hooks/useOptimisticToggle';
import { friendlyErrorMessage } from '@/lib/utils/friendlyError';

export interface UseUserProfileReturn {
  profileUser: User | null;
  setProfileUser: React.Dispatch<React.SetStateAction<User | null>>; // To allow updates from EditProfileDialog
  isLoadingProfileUser: boolean;
  isMutualFollow: boolean;
  showLoginPrompt: boolean;
  loginPromptActionName: string;
  openLoginPrompt: (actionName: string) => void;
  closeLoginPrompt: () => void;
  handleFollowToggle: () => Promise<void>;
  handleMuteToggle: () => Promise<void>;
  handleBlockToggle: () => Promise<void>;
  handleReport: () => Promise<void>;
  handleMessageUser: () => void;
  isOwnProfile: boolean;
  handleUpdateNotificationSubscription: (preference: 'all' | 'news_only' | 'none') => Promise<void>;
}

export function useUserProfile({
  profileUserId,
  activeUser,
  refreshActiveUser,
  enabled = true,
}: {
  profileUserId: string | null; // The ID of the user whose profile is being viewed
  activeUser: User | null; // The currently logged-in user
  refreshActiveUser: () => void; // Function to refresh the activeUser state
  enabled?: boolean; // false enquanto a sessão não foi resolvida: não busca o perfil como visitante à toa
}): UseUserProfileReturn {
  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [isLoadingProfileUser, setIsLoadingProfileUser] = useState(true);
  const [isMutualFollow, setIsMutualFollow] = useState(false);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [loginPromptActionName, setLoginPromptActionName] = useState('');
  const locale = useLocale();
  
  const router = useRouter();
  const { toast } = useToast();

  const isOwnProfile = profileUser?.id === activeUser?.id;

  // Depende só do ID de quem está logado: o objeto do usuário logado é recriado a cada mudança no documento dele
  // (por exemplo, os contadores que as Functions gravam alguns instantes depois de seguir ou publicar). Antes isso
  // recarregava o perfil inteiro com a tela de carregamento e fechava qualquer diálogo aberto, como "Editar Perfil".
  const activeUserId = activeUser?.id ?? null;
  const loadedProfileIdRef = useRef<string | null>(null);

  // Seguir responde NA HORA (motor de src/lib/interactions/optimisticToggle.ts): o botão e o contador mudam no toque e a
  // gravação segue em segundo plano, sempre do estado final. Antes eram 3 a 4 idas ao servidor em sequência antes de qualquer
  // mudança na tela. Não há listener ao vivo do perfil de OUTRA pessoa: o estado gravado passa a valer como o do servidor.
  const profileUserRef = useRef(profileUser);
  profileUserRef.current = profileUser;
  const activeUserIdRef = useRef(activeUserId);
  activeUserIdRef.current = activeUserId;
  // Quem está sendo seguido, fixado no TOQUE: se a página trocar de perfil antes da gravação, ela não vai para outra pessoa.
  const followTargetRef = useRef<string | null>(null);
  const followToggle = useOptimisticToggle<User | null>(() => profileUserRef.current, setProfileUser, {
    read: (u) => ({ active: !!u?.isFollowing, count: u?.followersCount ?? 0 }),
    write: (u, s) => (u ? { ...u, isFollowing: s.active, followersCount: s.count } : u),
    persist: async (desired) => {
      const target = followTargetRef.current;
      if (target) await setFollowUser(activeUserIdRef.current as string, target, desired);
    },
    assumeServerAfterWrite: true,
    onFailure: (error) => {
      console.error('Erro ao seguir:', error);
      toast({ title: 'Não foi possível atualizar o seguir', description: friendlyErrorMessage(error, 'Verifique a conexão e tente de novo.'), variant: 'destructive' });
    },
    onSettled: () => {
      const target = profileUserRef.current;
      const me = activeUserIdRef.current;
      if (target && me && target.id !== me) void checkMutualFollow(me, target.id).then(setIsMutualFollow).catch(() => undefined);
      refreshActiveUser();
    },
  });
  const reconcileFollow = followToggle.reconcile;
  const resetFollow = followToggle.reset;
  // Outro perfil aberto no mesmo componente: o toque pendente no anterior não vale para este.
  useEffect(() => {
    followTargetRef.current = null;
    resetFollow();
  }, [profileUserId, resetFollow]);

  const fetchProfileUserData = useCallback(async () => {
    if (!profileUserId) {
      setProfileUser(null);
      setIsLoadingProfileUser(false);
      return;
    }
    // Só o primeiro carregamento de um perfil mostra o esqueleto; as atualizações seguintes trocam os dados no lugar.
    const isFirstLoad = loadedProfileIdRef.current !== profileUserId;
    if (isFirstLoad) setIsLoadingProfileUser(true);
    try {
      const fetchedUser = await serverGetUser(profileUserId, activeUserId);
      // O que a pessoa acabou de tocar em "Seguir" continua valendo até a gravação ser alcançada.
      setProfileUser(fetchedUser ? reconcileFollow(fetchedUser) : null);
      loadedProfileIdRef.current = profileUserId;
      if (fetchedUser && activeUserId && profileUserId !== activeUserId) {
        const mutual = await checkMutualFollow(activeUserId, fetchedUser.id);
        setIsMutualFollow(mutual);
      } else {
        setIsMutualFollow(false);
      }
    } catch (error) {
      console.error("Failed to fetch profile user data:", error);
      toast({ title: "Erro", description: "Não foi possível carregar o perfil do usuário.", variant: "destructive" });
      if (isFirstLoad) setProfileUser(null);
    } finally {
      if (isFirstLoad) setIsLoadingProfileUser(false);
    }
  }, [profileUserId, activeUserId, toast, reconcileFollow]);

  useEffect(() => {
    if (!enabled) return;
    fetchProfileUserData();
  }, [fetchProfileUserData, enabled]);

  // No próprio perfil, os contadores acompanham o documento do usuário logado (escutado em tempo real), que as
  // Functions atualizam logo depois de seguir, ser seguido ou publicar: só os números mudam, sem recarregar a página.
  const liveFollowers = activeUser?.followersCount;
  const liveFollowing = activeUser?.followingCount;
  const livePosts = activeUser?.postsCount;
  useEffect(() => {
    if (!activeUserId || profileUserId !== activeUserId) return;
    setProfileUser(prev => prev && prev.id === activeUserId
      ? { ...prev, followersCount: liveFollowers ?? prev.followersCount, followingCount: liveFollowing ?? prev.followingCount, postsCount: livePosts ?? prev.postsCount }
      : prev);
  }, [activeUserId, profileUserId, liveFollowers, liveFollowing, livePosts]);

  // Listener for profile update events
  useEffect(() => {
    const handleProfileUpdate = (event: Event) => {
      const updatedUser = (event as CustomEvent).detail as User;
      // If the updated user is the one being viewed on this profile page, refetch data
      if (updatedUser.id === profileUserId) {
        fetchProfileUserData();
      }
    };

    window.addEventListener('profileUpdated', handleProfileUpdate);
    return () => {
      window.removeEventListener('profileUpdated', handleProfileUpdate);
    };
  }, [profileUserId, fetchProfileUserData]);

  const openLoginPrompt = (actionName: string) => {
    setLoginPromptActionName(actionName);
    setShowLoginPrompt(true);
  };

  const closeLoginPrompt = () => {
    setShowLoginPrompt(false);
    setLoginPromptActionName('');
  };

  const requireLoginOrPrompt = (actionName: string): boolean => {
    if (!activeUser) {
      openLoginPrompt(actionName);
      return false;
    }
    return true;
  };

  const handleFollowToggle = async () => {
    if (!profileUser || isOwnProfile || !requireLoginOrPrompt(`seguir @${profileUser.username}`) || !activeUser) return;
    toast({ title: profileUser.isFollowing ? `Deixou de seguir @${profileUser.username}` : `Seguindo @${profileUser.username}` });
    followTargetRef.current = profileUser.id;
    followToggle.toggle();
  };

  const handleMuteToggle = async () => {
    if (!profileUser || isOwnProfile || !requireLoginOrPrompt(`silenciar @${profileUser.username}`) || !activeUser) return;
    try {
      const updatedUser = await serverToggleMuteUser(activeUser.id, profileUser.id);
      if (updatedUser) {
        setProfileUser(prev => prev ? { ...prev, ...updatedUser, isMuted: updatedUser.isMuted } : null);
        toast({ title: `Usuário ${updatedUser.isMuted ? 'silenciado' : 'não silenciado'}` });
      } else {
        toast({ title: "Ação falhou", description: "Não foi possível atualizar o status de silenciar.", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Erro", description: error.message || "Não foi possível atualizar o status de silenciar.", variant: "destructive" });
    }
  };

  const handleBlockToggle = async () => {
    if (!profileUser || isOwnProfile || !requireLoginOrPrompt(`bloquear @${profileUser.username}`) || !activeUser) return;
    const confirmBlock = profileUser.isBlocked ? true : window.confirm(`Tem certeza que deseja bloquear @${profileUser.username}? Isso também fará com que você deixe de segui-lo, se for o caso.`);
    if (confirmBlock) {
      try {
        const updatedUser = await serverToggleBlockUser(activeUser.id, profileUser.id);
        if (updatedUser) {
          setProfileUser(prev => prev ? { ...prev, ...updatedUser, isBlocked: updatedUser.isBlocked, isFollowing: updatedUser.isFollowing, hasBlockedCurrentUser: updatedUser.hasBlockedCurrentUser } : null);
          const mutual = await checkMutualFollow(activeUser.id, updatedUser.id);
          setIsMutualFollow(mutual);
          await refreshActiveUser();
          toast({ title: updatedUser.isBlocked ? `Bloqueado @${profileUser.username}` : `Desbloqueado @${profileUser.username}` });
        } else {
          toast({ title: "Ação falhou", description: "Não foi possível atualizar o status de bloqueio.", variant: "destructive" });
        }
      } catch (error: any) {
        toast({ title: "Erro", description: error.message || "Não foi possível atualizar o status de bloqueio.", variant: "destructive" });
      }
    }
  };

  const handleReport = async () => {
    if (!profileUser || isOwnProfile || !requireLoginOrPrompt(`reportar @${profileUser.username}`) || !activeUser) return;
    const reason = prompt(`Por favor, forneça um motivo para reportar @${profileUser.username}:`);
    if (reason && reason.trim()) {
      try {
        const success = await serverReportUser(activeUser.id, profileUser.id, reason.trim());
        if (success) {
          toast({ title: `Reportado @${profileUser.username}`, description: "Obrigado pelo seu feedback." });
        } else {
          toast({ title: "Falha ao enviar o reporte", variant: "destructive" });
        }
      } catch (error: any) {
        toast({ title: "Erro", description: error.message || "Não foi possível enviar o reporte.", variant: "destructive" });
      }
    }
  };

  const handleMessageUser = () => {
    if (!profileUser || isOwnProfile || !requireLoginOrPrompt(`enviar mensagem para @${profileUser.username}`)) return;
    router.push(`/${locale}/messages/user/${profileUser.id}`);
  };

  const handleUpdateNotificationSubscription = async (preference: 'all' | 'news_only' | 'none') => {
    if (!profileUser || isOwnProfile || !requireLoginOrPrompt(`se inscrever nas notificações de @${profileUser.username}`) || !activeUser) return;

    const originalStatus = profileUser.notificationSubscriptionStatus || 'none';
    
    // Optimistic update
    setProfileUser(prev => prev ? { ...prev, notificationSubscriptionStatus: preference } : null);

    try {
      const success = await updateNotificationSubscription(activeUser.id, profileUser.id, preference);
      if (success) {
        toast({ title: `Notificações de @${profileUser.username} estão agora ${preference === 'none' ? 'DESLIGADAS' : 'LIGADAS'}.` });
        // The local state is already updated optimistically. No need to refetch.
      } else {
        throw new Error("Falha ao atualizar a inscrição no servidor.");
      }
    } catch (error: any) {
      // Revert optimistic update
      setProfileUser(prev => prev ? { ...prev, notificationSubscriptionStatus: originalStatus } : null);
      toast({ title: "Erro", description: error.message || "Não foi possível atualizar as preferências de notificação.", variant: "destructive" });
    }
  };

  return {
    profileUser,
    setProfileUser, // Expose setProfileUser to allow direct update after profile edit
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
  };
}
