// src/hooks/features/post/usePostMainInteractions.ts
import React from 'react';
import type { Post, DeletionResult } from '@/lib/types';
import {
  reportPost as serverReportPost,
  deletePost as serverDeletePost,
  setPostLike,
  setPostBookmark,
  setPostRepost,
  findInteractionPost,
} from '@/lib/services/posts/interactPostActions';
import { useOptimisticToggle } from '@/hooks/useOptimisticToggle';
import { haptics } from '@/lib/haptics';
import { friendlyErrorMessage } from '@/lib/utils/friendlyError';
import {
  toggleMuteUser as serverToggleMuteUser,
  toggleBlockUser as serverToggleBlockUser,
  updateUserSettings, // Import updateUserSettings
} from '@/lib/services/userService';
import { useToast } from "@/hooks/use-toast";
import { siteConfig } from '@/config/site';
import { useLocale } from 'next-intl';
import { useCurrentUserActions, useGetCurrentUser } from '@/contexts/CurrentUserContext';
import { useFeedActions } from '@/contexts/FeedContext';
import { dispatchPostInteraction } from '@/lib/events/postInteractionState';

export interface UsePostMainInteractionsProps {
  post: Post | null; 
  setPost: React.Dispatch<React.SetStateAction<Post | null>>;
  currentUserId: string | null;
  openLoginPrompt: (actionName: string) => void;
  onPostSuccessfullyDeleted?: (postId: string) => void; 
}

export function usePostMainInteractions({
  post,
  setPost,
  currentUserId,
  openLoginPrompt,
  onPostSuccessfullyDeleted,
}: UsePostMainInteractionsProps) {
  const { toast } = useToast();
  const locale = useLocale();
  // Sem assinar o perfil: o cartão não é redesenhado por um seguidor novo; o usuário é lido na hora do toque.
  const { refreshCurrentUser } = useCurrentUserActions();
  const getCurrentUser = useGetCurrentUser();
  const { hidePost: contextHidePost } = useFeedActions();
  const [isSendViaDirectOpen, setIsSendViaDirectOpen] = React.useState(false);

  // Curtir, repostar e salvar respondem NA HORA (veja src/lib/interactions/optimisticToggle.ts): a tela muda no toque,
  // toques rápidos viram uma gravação só e o botão nunca fica desabilitado esperando o servidor.
  const postRef = React.useRef(post);
  postRef.current = post;
  const userIdRef = React.useRef(currentUserId);
  userIdRef.current = currentUserId;

  const likeToggle = useOptimisticToggle<Post | null>(() => postRef.current, setPost, {
    read: (p) => ({ active: !!p?.isLiked, count: p?.likes || 0 }),
    write: (p, s) => {
      if (p) {
        dispatchPostInteraction(userIdRef.current, p.id, { isLiked: s.active, likes: s.count });
      }
      return p ? { ...p, isLiked: s.active, likes: s.count } : p;
    },
    persist: (desired) => setPostLike((postRef.current as Post).id, userIdRef.current as string, desired),
    // O card de post não mantém um listener do documento aberto. Depois que a
    // gravação termina, o estado confirmado é o que acabamos de persistir.
    assumeServerAfterWrite: true,
    onFailure: (error) => {
      console.error('Erro ao curtir o post:', error);
      toast({ title: 'Não foi possível curtir', description: friendlyErrorMessage(error, 'Verifique a conexão e tente de novo.'), variant: 'destructive' });
    },
  });
  const repostToggle = useOptimisticToggle<Post | null>(() => postRef.current, setPost, {
    read: (p) => ({ active: !!p?.isReposted, count: p?.reposts || 0 }),
    write: (p, s) => {
      if (p) {
        dispatchPostInteraction(userIdRef.current, p.id, { isReposted: s.active, reposts: s.count });
      }
      return p ? { ...p, isReposted: s.active, reposts: s.count } : p;
    },
    persist: (desired) => setPostRepost((postRef.current as Post).id, userIdRef.current as string, desired),
    assumeServerAfterWrite: true,
    onFailure: (error) => {
      console.error('Erro ao repostar o post:', error);
      toast({ title: 'Não foi possível repostar', description: friendlyErrorMessage(error, 'O autor pode ter limitado os reposts. Tente de novo.'), variant: 'destructive' });
    },
  });
  const bookmarkToggle = useOptimisticToggle<Post | null>(() => postRef.current, setPost, {
    read: (p) => ({ active: !!p?.isBookmarked, count: 0 }),
    write: (p, s) => {
      if (p) {
        dispatchPostInteraction(userIdRef.current, p.id, { isBookmarked: s.active });
      }
      return p ? { ...p, isBookmarked: s.active } : p;
    },
    persist: (desired) => setPostBookmark((postRef.current as Post).id, userIdRef.current as string, desired),
    assumeServerAfterWrite: true,
    onFailure: (error) => {
      console.error('Erro ao salvar o post:', error);
      toast({ title: 'Não foi possível atualizar os Marcadores', description: friendlyErrorMessage(error, 'Tente de novo.'), variant: 'destructive' });
    },
  });

  const handlePinPost = async (e?: React.MouseEvent | Event) => {
    e?.stopPropagation();
    const currentUser = getCurrentUser();
    if (!post || !currentUserId || !currentUser) {
      openLoginPrompt("fixar este post");
      return;
    }
    if (post.userId !== currentUserId) {
      toast({ title: "Apenas os seus próprios posts podem ser fixados.", variant: "destructive" });
      return;
    }

    const isCurrentlyPinned = currentUser.pinnedPostId === post.id;
    const newPinnedId = isCurrentlyPinned ? null : post.id;

    try {
      await updateUserSettings(currentUserId, { pinnedPostId: newPinnedId });
      toast({
        title: "Sucesso!",
        description: isCurrentlyPinned ? "Post desafixado do seu perfil." : "Post fixado no seu perfil.",
      });
      // Refresh the current user's data, which will trigger updates on profile pages
      await refreshCurrentUser();
    } catch (error: any) {
      toast({
        title: "Erro",
        description: error.message || "Não foi possível atualizar o post fixado.",
        variant: "destructive",
      });
    }
  };


  const handleLikePost = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!post || !post.id) {
      return;
    }
    if (!currentUserId) {
      openLoginPrompt("curtir este post");
      return;
    }
    // Vibra no toque: curtir é marcado; descurtir é um toque leve.
    if (post.isLiked) haptics.tap(); else haptics.like();
    likeToggle.toggle();
  };

  const handleBookmarkPost = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!post || !post.id) return;
    if (!currentUserId) {
      openLoginPrompt("salvar este post");
      return;
    }
    haptics.tap();
    const saving = !post.isBookmarked;
    bookmarkToggle.toggle();
    toast({
      title: saving ? "Post Salvo!" : "Post Removido",
      description: saving ? "Você pode encontrar seus posts salvos em seus Marcadores." : "O post foi removido dos seus Marcadores.",
    });
  };

  const handleRepostToggle = async (e?: React.MouseEvent | Event) => {
    e?.stopPropagation();
    if (!post || !post.id || !currentUserId) {
      openLoginPrompt("repostar isto");
      return;
    }
    haptics.like();
    toast({ title: !post.isReposted ? "Repostado!" : "Repost desfeito." });
    repostToggle.toggle();
  };

  const handleUndoQuote = async (e?: React.MouseEvent | Event) => {
    e?.stopPropagation();
    if (!post || !post.id || !currentUserId) {
      openLoginPrompt("interagir com este post");
      return;
    }
  
    if (window.confirm("Você tem certeza que quer deletar sua citação deste post? Esta ação não pode ser desfeita.")) {
      try {
        const quoteId = await findInteractionPost(post.id, currentUserId, 'quote');
        if (quoteId) {
          const result = await serverDeletePost(quoteId, currentUserId);
          if (result) {
            toast({ title: "Citação deletada." });
            // The listener on the original post will update the quote count
          } else {
            throw new Error("O servidor falhou em deletar sua citação.");
          }
        } else {
          throw new Error("Não foi possível encontrar seu post de citação para deletar.");
        }
      } catch (error: any) {
        toast({ title: "Erro ao deletar citação", description: error.message, variant: "destructive" });
      }
    }
  };

  const handleMutePostAuthor = async (e?: React.MouseEvent | Event) => {
    e?.stopPropagation();
    if (!post || !post.id || !post.user) {
        console.error("handleMutePostAuthor: Dados do post ou autor do post estão faltando.");
        return;
    }
    if (!currentUserId || currentUserId === post.userId) {
      openLoginPrompt(`silenciar @${post.user.username}`);
      return;
    }
    
    const originalUser = { ...post.user };
    const newIsMuted = !post.user.isMuted;
    setPost({ ...post, user: { ...post.user, isMuted: newIsMuted } });

    try {
      const updatedUser = await serverToggleMuteUser(currentUserId, post.userId);
      if (updatedUser) {
        setPost({ ...post, user: { ...post.user, isMuted: updatedUser.isMuted } });
        toast({ title: updatedUser.isMuted ? `Silenciado @${post.user.username}` : `Não silenciado @${post.user.username}` });
      } else {
        throw new Error("O servidor não retornou o usuário atualizado.");
      }
    } catch (error: any) {
        setPost({ ...post, user: originalUser });
        const errorMsg = "Erro ao silenciar conta";
        console.error(`PostMainInteractions Error: ${errorMsg} for User ID: ${post.userId}`);
        toast({ title: errorMsg, variant: "destructive"});
    }
  };

  const handleBlockPostAuthor = async (e?: React.MouseEvent | Event) => {
    e?.stopPropagation();
    if (!post || !post.id || !post.user) {
        console.error("handleBlockPostAuthor: Dados do post ou autor do post estão faltando.");
        return;
    }
    if (!currentUserId || currentUserId === post.userId) {
      openLoginPrompt(`bloquear @${post.user.username}`);
      return;
    }
    
    if (window.confirm(`Você tem certeza que quer bloquear @${post.user.username}? Eles não poderão seguir ou enviar mensagens para você, e você não verá as notificações deles.`)) {
        const originalUser = { ...post.user };
        const newIsBlocked = !post.user.isBlocked;
        setPost({ ...post, user: { ...post.user, isBlocked: newIsBlocked } });

        try {
            const updatedUser = await serverToggleBlockUser(currentUserId, post.userId);
            if (updatedUser) {
              setPost({ ...post, user: { ...post.user, isBlocked: updatedUser.isBlocked } });
              toast({ title: updatedUser.isBlocked ? `Bloqueado @${post.user.username}` : `Desbloqueado @${post.user.username}` });
            } else {
                throw new Error("O servidor não retornou o usuário atualizado.");
            }
        } catch(error: any) {
            setPost({ ...post, user: originalUser });
            const errorMsg = "Erro ao bloquear conta";
            console.error(`PostMainInteractions Error: ${errorMsg} for User ID: ${post.userId}`);
            toast({ title: errorMsg, variant: "destructive"});
        }
    }
  };

  const handleReportPostAction = async (e?: React.MouseEvent | Event) => {
    e?.stopPropagation();
    if (!post || !post.id || !post.user) {
        console.error("handleReportPostAction: Dados do post ou autor do post estão faltando.");
        return;
    }
    if (!currentUserId) {
      openLoginPrompt("reportar este post");
      return;
    }
    const reason = prompt(`Por favor, forneça um motivo para reportar este post por @${post.user.username}:`);
    if (reason?.trim()) {
      const success = await serverReportPost(currentUserId, post.id, reason.trim());
      if (success) {
        toast({ title: "Post Reportado", description: "Obrigado pelo seu reporte. Nós o analisaremos em breve." });
      } else {
        const errorMsg = "Falha ao reportar post";
        console.error(`PostMainInteractions Error: ${errorMsg} - Post ID: ${post.id}`);
        toast({ title: errorMsg, variant: "destructive" });
      }
    }
  };

  const handleCopyText = (e?: React.MouseEvent | Event, textToCopy?: string | null) => {
    e?.stopPropagation();
    const content = textToCopy || post?.text || post?.originalPostDetails?.text || '';
    if (content) {
      navigator.clipboard.writeText(content)
        .then(() => toast({ title: "Texto copiado para a área de transferência!" }))
        .catch(err => {
            const errorMsg = `Falha ao copiar texto: ${err.message}`;
            console.error(`PostMainInteractions Error: ${errorMsg}`);
            toast({ title: "Falha ao copiar", description: err.message, variant: "destructive" });
        });
    } else {
      const errorMsg = "Nenhum texto para copiar";
      console.warn(`PostMainInteractions Error: ${errorMsg}`);
      toast({ title: errorMsg, variant: "destructive" });
    }
  };

  const handleSendViaDirect = (e?: React.MouseEvent | Event) => {
    e?.stopPropagation();
    if (!currentUserId) {
      openLoginPrompt("enviar isto via mensagem direta");
      return;
    }
    setIsSendViaDirectOpen(true);
  };
  
  const handleShareInternal = async (e?: React.MouseEvent | Event) => {
    e?.stopPropagation();
    if (!post) return;

    const shareData: ShareData = {
      title: `Post de @${post.user?.username || 'usuário'} no Exe. Lula`,
      text: post.headline || post.text?.substring(0, 100) || `Confira este post no Exe. Lula!`,
      url: `${siteConfig.baseUrl}/${locale}/post/${post.id}`,
    };

    try {
      if (navigator.share && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(shareData.url);
        toast({ title: 'Link Copiado!', description: 'O link para o post foi copiado para sua área de transferência.' });
      }
    } catch (error) {
      console.error('Erro ao compartilhar post:', error);
      toast({ title: 'Falha ao Compartilhar', description: 'Não foi possível compartilhar o post.', variant: 'destructive' });
    }
  };

  const handleDeletePost = async () => {
    if (!post || !post.id) {
        console.error("handleDeletePost: Post ou post.id está indefinido.");
        toast({ title: "Erro", description: "Dados do post estão faltando para a exclusão.", variant: "destructive" });
        return;
    }
    if (!currentUserId || post.userId !== currentUserId) {
        openLoginPrompt("deletar este post");
        return;
    }
    if (!window.confirm("Você tem certeza que quer deletar permanentemente este post? Esta ação não pode ser desfeita.")) {
        return;
    }
    const originalPost = { ...post };
    const tempTombstonedPost = { ...post, isDeleted: true };
    setPost(tempTombstonedPost);

    try {
        const result: DeletionResult | null = await serverDeletePost(post.id, currentUserId);

        if (result?.status === 'tombstoned' && result.updatedPost) {
            setPost(result.updatedPost); 
            toast({ title: "Post Deletado", description: "Seu post foi removido." });
        } else if (result?.status === 'deleted') {
            if (onPostSuccessfullyDeleted) {
                onPostSuccessfullyDeleted(post.id);
            }
            toast({ title: "Post Deletado", description: "Seu post foi deletado com sucesso." });
        } else {
            throw new Error("A exclusão falhou no servidor.");
        }
    } catch (error: any) {
        setPost(originalPost);
        console.error(`PostMainInteractions Error: Erro ao deletar post ${post.id}:`, error);
        toast({ title: "Erro ao Deletar Post", description: error.message || "Ocorreu um erro inesperado.", variant: "destructive" });
    }
  };

  const handleHidePost = async (e?: React.MouseEvent | Event) => {
    e?.stopPropagation();
    if (!post) return;
    contextHidePost(post.id);
    toast({ title: "Post Oculto", description: "Este post não será mais exibido para você nesta sessão." });
  };

  return {
    handleLikePost,
    // Os botões não ficam mais desabilitados esperando o servidor (a resposta é imediata): mantidos por compatibilidade.
    isProcessingLike: false,
    handleBookmarkPost,
    isProcessingBookmark: false,
    handleRepostToggle,
    handleUndoQuote,
    handleMutePostAuthor,
    handleBlockPostAuthor,
    handleReportPostAction,
    handleCopyText,
    handleSendViaDirect,
    isSendViaDirectOpen,
    setIsSendViaDirectOpen,
    handleShareInternal,
    handleDeletePost, 
    handlePinPost,
    handleHidePost,
  };
}
