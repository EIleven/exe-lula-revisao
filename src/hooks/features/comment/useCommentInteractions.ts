// src/hooks/features/comment/useCommentInteractions.ts
import { useState, useCallback, useEffect, useRef } from 'react';
import type { Comment, Post, User } from '@/lib/types';
import { useToast } from "@/hooks/use-toast";
import {
  reportComment as serverReportComment,
  deleteComment as serverDeleteComment,
} from '@/lib/services/comments/commentWriteActions';
import {
  setCommentLike,
  setCommentRepost,
  setCommentBookmark,
  deletePost as serverDeletePost,
} from '@/lib/services/posts/interactPostActions';
import { useOptimisticToggle } from '@/hooks/useOptimisticToggle';
import { haptics } from '@/lib/haptics';
import { friendlyErrorMessage } from '@/lib/utils/friendlyError';
import {
  toggleMuteUser as serverToggleMuteUser,
  toggleBlockUser as serverToggleBlockUser,
} from '@/lib/services/userService';
import { uploadFileToStorage, postMediaPathFactory, isLikelyVideoFile } from '@/lib/services/mediaUploadService';
import { siteConfig } from '@/config/site';
import { useLocale } from 'next-intl';
import { getCommentById } from '@/lib/services/comments/commentReadService';
import { useFeedActions } from '@/contexts/FeedContext';
import {
  query,
  where,
  limit as firestoreLimit,
  getDocs,
  onSnapshot,
  doc,
} from 'firebase/firestore';
import { postsCollection } from '@/lib/services/postService';
import { db } from '@/lib/firebase';
import {
  COMMENT_INTERACTION_EVENT,
  dispatchCommentInteraction,
  getCachedCommentInteraction,
  type CommentInteractionEventDetail,
} from '@/lib/events/postInteractionState';

interface UseCommentInteractionsProps {
  initialComment: Comment;
  currentUserId: string | null;
  onPostCreated?: (newPost: Post) => void;
  onInteractionDeleted?: (contentId: string) => void; // For unbookmark/unlike on specific pages
}

export function useCommentInteractions({
  initialComment,
  currentUserId,
  onPostCreated,
  onInteractionDeleted,
}: UseCommentInteractionsProps) {
  const { toast } = useToast();
  const locale = useLocale();
  const { hidePost } = useFeedActions();
  const [comment, setComment] = useState<Comment>(() => {
    const cached = getCachedCommentInteraction(currentUserId, initialComment.id);
    return cached ? { ...initialComment, ...cached } : initialComment;
  });
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [loginPromptActionName, setLoginPromptActionName] = useState('');
  const [isQuoteDialogOpen, setIsQuoteDialogOpen] = useState(false);

  // Curtir, repostar e salvar respondem NA HORA (motor em src/lib/interactions/optimisticToggle.ts): a tela muda no toque,
  // toques rápidos viram uma gravação só e o dado atrasado do servidor (o contador é somado por uma Function segundos
  // depois) não desfaz o toque. O botão nunca fica desabilitado esperando o servidor.
  const commentRef = useRef(comment);
  commentRef.current = comment;
  const userIdRef = useRef(currentUserId);
  userIdRef.current = currentUserId;

  const likeToggle = useOptimisticToggle<Comment>(() => commentRef.current, setComment, {
    read: (c) => ({ active: !!c.isLiked, count: c.likes || 0 }),
    write: (c, s) => {
      dispatchCommentInteraction(userIdRef.current, c.id, { isLiked: s.active, likes: s.count });
      return { ...c, isLiked: s.active, likes: s.count };
    },
    persist: (desired) => setCommentLike(commentRef.current.parentPostId, commentRef.current.id, userIdRef.current as string, desired),
    onFailure: (error) => {
      console.error('Erro ao curtir o comentário:', error);
      toast({ title: 'Não foi possível curtir', description: friendlyErrorMessage(error, 'Verifique a conexão e tente de novo.'), variant: 'destructive' });
    },
  });
  const repostToggle = useOptimisticToggle<Comment>(() => commentRef.current, setComment, {
    read: (c) => ({ active: !!c.isReposted, count: c.repostsCount || 0 }),
    write: (c, s) => {
      dispatchCommentInteraction(userIdRef.current, c.id, { isReposted: s.active, repostsCount: s.count });
      return { ...c, isReposted: s.active, repostsCount: s.count };
    },
    persist: (desired) => setCommentRepost(commentRef.current.parentPostId, commentRef.current.id, userIdRef.current as string, desired),
    onFailure: (error) => {
      console.error('Erro ao repostar o comentário:', error);
      toast({ title: 'Não foi possível repostar', description: friendlyErrorMessage(error, 'O autor pode ter limitado os reposts. Tente de novo.'), variant: 'destructive' });
    },
  });
  const bookmarkToggle = useOptimisticToggle<Comment>(() => commentRef.current, setComment, {
    read: (c) => ({ active: !!c.isBookmarked, count: 0 }),
    write: (c, s) => {
      dispatchCommentInteraction(userIdRef.current, c.id, { isBookmarked: s.active });
      return { ...c, isBookmarked: s.active };
    },
    persist: (desired) => setCommentBookmark(commentRef.current.parentPostId, commentRef.current.id, userIdRef.current as string, desired),
    onSettled: (saved) => {
      // Tirou dos Marcadores estando na página de Marcadores: o comentário sai da lista.
      if (!saved && onInteractionDeleted) onInteractionDeleted(commentRef.current.id);
    },
    onFailure: (error) => {
      console.error('Erro ao salvar o comentário:', error);
      toast({ title: 'Não foi possível atualizar os Marcadores', description: friendlyErrorMessage(error, 'Tente de novo.'), variant: 'destructive' });
    },
  });

  useEffect(() => {
    if (!currentUserId || !initialComment?.id) return;
    const onCommentInteraction = (event: Event) => {
      const detail = (event as CustomEvent<CommentInteractionEventDetail>).detail;
      if (detail.viewerId !== currentUserId || detail.commentId !== initialComment.id) return;
      setComment((prev) => ({ ...prev, ...detail.patch }));
    };
    window.addEventListener(COMMENT_INTERACTION_EVENT, onCommentInteraction);
    return () => window.removeEventListener(COMMENT_INTERACTION_EVENT, onCommentInteraction);
  }, [currentUserId, initialComment?.id]);

  const reconcileLike = likeToggle.reconcile;
  const reconcileRepost = repostToggle.reconcile;
  const reconcileBookmark = bookmarkToggle.reconcile;

  // Real-time listener for the comment itself
  useEffect(() => {
    // Only attach listener if a user is logged in, to prevent permission errors for guests
    if (!currentUserId || !initialComment?.id || !initialComment.parentPostId) return;

    const commentDocRef = doc(db, 'posts', initialComment.parentPostId, 'comments', initialComment.id);
    const unsubscribe = onSnapshot(commentDocRef, async (docSnap) => {
        if (docSnap.exists()) {
             const freshComment = await getCommentById(initialComment.parentPostId, initialComment.id, currentUserId);
             if(freshComment) {
                // O que a pessoa acabou de tocar continua valendo enquanto o servidor não o alcança.
                setComment(reconcileLike(reconcileRepost(reconcileBookmark(freshComment))));
             }
        } else {
            setComment(prev => ({...prev, isDeleted: true}));
        }
    }, (error) => {
        console.error(`Error listening to comment ${initialComment.id}:`, error);
    });

    return () => unsubscribe();
  }, [initialComment.id, initialComment.parentPostId, currentUserId, reconcileLike, reconcileRepost, reconcileBookmark]);


  const openLoginPrompt = (actionName: string) => {
    setLoginPromptActionName(actionName);
    setShowLoginPrompt(true);
  };

  const closeLoginPrompt = () => {
    setShowLoginPrompt(false);
  };

  const handleLike = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUserId) {
      openLoginPrompt("curtir este comentário");
      return;
    }
    if (!comment.id || !comment.parentPostId) {
      toast({ title: "Erro", description: "Não é possível curtir um comentário inválido.", variant: "destructive" });
      return;
    }
    // Vibra no toque: curtir é marcado; descurtir é um toque leve.
    if (comment.isLiked) haptics.tap(); else haptics.like();
    likeToggle.toggle();
  }, [comment.id, comment.parentPostId, comment.isLiked, currentUserId, openLoginPrompt, toast, likeToggle.toggle]);

  const handleBookmarkComment = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUserId) {
      openLoginPrompt("salvar este comentário");
      return;
    }
    if (!comment || !comment.id || !comment.parentPostId) {
      toast({ title: "Erro", description: "Não é possível marcar um comentário inválido.", variant: "destructive" });
      return;
    }
    haptics.tap();
    const saving = !comment.isBookmarked;
    bookmarkToggle.toggle();
    toast({
      title: saving ? "Comentário Salvo!" : "Marcador Removido",
      description: saving ? "Você pode encontrar isto nos seus Marcadores." : "O comentário foi removido dos seus Marcadores.",
    });
  }, [comment, currentUserId, toast, openLoginPrompt, bookmarkToggle.toggle]);


  const handleRepostToggle = useCallback(async (e: React.MouseEvent | Event) => {
    e.stopPropagation();
    if (!currentUserId) {
        openLoginPrompt("repostar este comentário");
        return;
    }
    if (!comment || !comment.id) {
      toast({ title: "Erro", description: "Não é possível repostar um comentário inválido.", variant: "destructive" });
      return;
    }
    haptics.like();
    toast({ title: !comment.isReposted ? "Comentário Repostado!" : "Repost desfeito." });
    repostToggle.toggle();
  }, [comment, currentUserId, toast, openLoginPrompt, repostToggle.toggle]);

  const handleQuote = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUserId) {
        openLoginPrompt("citar este comentário");
        return;
    }
    if (!comment || !comment.id) {
      toast({ title: "Error", description: "Cannot quote an invalid comment.", variant: "destructive" });
      return;
    }
    setIsQuoteDialogOpen(true);
  };
  
  const handleUndoQuote = async (e?: React.MouseEvent | Event) => {
    e?.stopPropagation();
    if (!comment || !comment.id || !currentUserId) {
        openLoginPrompt("interagir com este post");
        return;
    }
  
    if (window.confirm("Você tem certeza que quer deletar sua citação deste comentário? Esta ação não pode ser desfeita.")) {
      try {
        const q = query(
          postsCollection,
          where('type', '==', 'quote'),
          where('userId', '==', currentUserId),
          // A quoted comment's ID is stored as `{parentPostId}/{commentId}`
          where('quotedCommentId', '==', `${comment.parentPostId}/${comment.id}`),
          firestoreLimit(1)
        );
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          const quotePostId = snapshot.docs[0].id;
          const result = await serverDeletePost(quotePostId, currentUserId);
          if (result?.status === 'deleted') {
            toast({ title: "Citação deletada." });
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

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUserId) {
      openLoginPrompt("deletar este comentário");
      return;
    }
    
    if (!comment || !comment.id) return;

    if (window.confirm("Você tem certeza que quer deletar este comentário?")) {
      try {
        await serverDeleteComment(comment.parentPostId, comment.id, currentUserId);
        toast({ title: "Comentário Deletado" });
      } catch (error: any) {
        toast({ title: "Erro", description: error.message || "Falha ao deletar comentário.", variant: "destructive" });
      }
    }
  };
  
  const handleCopyText = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!comment || !comment.text) {
        toast({ title: "Nenhum texto para copiar", variant: "destructive" });
        return;
    };
    navigator.clipboard.writeText(comment.text)
        .then(() => toast({ title: "Texto do comentário copiado!" }))
        .catch(() => toast({ title: "Falha ao copiar texto", variant: "destructive" }));
  };

  const handleMuteAuthor = async (e: React.MouseEvent) => { 
    e.stopPropagation();
    if (!currentUserId || !comment.user) {
        openLoginPrompt("silenciar este usuário");
        return;
    }
    try {
        await serverToggleMuteUser(currentUserId, comment.userId);
        toast({ title: `Usuário ${comment.user.isMuted ? 'não silenciado' : 'silenciado'}` });
    } catch (error) {
        toast({ title: 'Erro', description: 'Não foi possível atualizar o status de silenciar', variant: 'destructive' });
    }
  };
  const handleBlockAuthor = async (e: React.MouseEvent) => { 
     e.stopPropagation();
    if (!currentUserId || !comment.user) {
        openLoginPrompt("bloquear este usuário");
        return;
    }
     if (window.confirm(`Você tem certeza que quer bloquear @${comment.user.username}?`)) {
        try {
            await serverToggleBlockUser(currentUserId, comment.userId);
            toast({ title: `Usuário ${comment.user.isBlocked ? 'desbloqueado' : 'bloqueado'}` });
        } catch (error) {
            toast({ title: 'Erro', description: 'Não foi possível atualizar o status de bloqueio', variant: 'destructive' });
        }
     }
  };
  const handleReport = async (e: React.MouseEvent) => { 
    e.stopPropagation();
    if (!currentUserId) {
        openLoginPrompt("reportar este comentário");
        return;
    }
    const reason = prompt("Por favor, forneça um motivo para reportar este comentário:");
    if (reason) {
        try {
            await serverReportComment(currentUserId, comment.parentPostId, comment.id, reason);
            toast({ title: 'Comentário Reportado', description: 'Obrigado pelo seu feedback.' });
        } catch (error) {
             toast({ title: 'Erro', description: 'Não foi possível enviar o reporte.', variant: 'destructive' });
        }
    }
  };
  const handleSendViaDirect = (e: React.MouseEvent) => {
    e.stopPropagation();
    toast({ title: "Funcionalidade Não Implementada" });
  };
  
  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!comment) return;
  
    const shareData: ShareData = {
      title: `Comentário de @${comment.user?.username || 'usuário'} no Exe. Lula`,
      text: comment.text?.substring(0, 100) || `Confira este comentário no Exe. Lula!`,
      url: `${siteConfig.baseUrl}/${locale}/post/${comment.parentPostId}#comment-${comment.id}`,
    };
  
    try {
      if (navigator.share && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(shareData.url);
        toast({ title: 'Link Copiado!', description: 'O link para o comentário foi copiado para sua área de transferência.' });
      }
    } catch (error) {
      console.error('Erro ao compartilhar comentário:', error);
      toast({ title: 'Falha ao Compartilhar', description: 'Não foi possível compartilhar o comentário.', variant: 'destructive' });
    }
  };
  
  const handleHideComment = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!comment || !comment.parentPostId) return;
    hidePost(comment.parentPostId);
    toast({ title: "Post oculto", description: "Este post não será mais exibido para você nesta sessão." });
  };

  const handleFileUpload = async (file: File) => {
    if (!currentUserId) {
      openLoginPrompt("enviar um arquivo");
      throw new Error("Usuário não logado");
    }
    const result = await uploadFileToStorage(currentUserId, file, postMediaPathFactory);
    const fileType: 'image' | 'video' | 'file' = file.type.startsWith('image/') ? 'image'
                   : isLikelyVideoFile(file) ? 'video'
                   : 'file';
    return { url: result.downloadURL, type: fileType };
  };


  return {
    comment,
    setComment,
    handleLike,
    // Os botões não ficam mais desabilitados esperando o servidor (a resposta é imediata): mantidos por compatibilidade.
    isProcessingLike: false,
    handleBookmarkComment,
    isProcessingBookmark: false,
    handleRepostToggle,
    handleQuote,
    handleUndoQuote,
    handleCopyText,
    handleDelete,
    handleMuteAuthor,
    handleBlockAuthor,
    handleReport,
    showLoginPrompt,
    loginPromptActionName,
    openLoginPrompt,
    closeLoginPrompt,
    handleSendViaDirect,
    handleShare,
    handleHideComment,
    isQuoteDialogOpen,
    setIsQuoteDialogOpen,
    handleFileUpload,
  };
}
