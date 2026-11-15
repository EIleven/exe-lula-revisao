// src/hooks/features/comment/useCommentActions.ts
import { useState, useCallback, useEffect } from 'react';
import type { Comment, Post, User } from '@/lib/types';
import { useToast } from "@/hooks/use-toast";
import {
  reportComment as serverReportComment,
  deleteComment as serverDeleteComment,
  toggleCommentBookmark,
} from '@/lib/services/comments/commentWriteActions';
import {
  toggleCommentLike, findInteractionPost, deletePost as serverDeletePost, toggleCommentRepost
} from '@/lib/services/posts/interactPostActions';
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
} from 'firebase/firestore';
import { postsCollection } from '@/lib/services/postService';

// This is a simplified version for use inside CommentCard, which doesn't manage its own dialogs
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
  const [comment, setComment] = useState(initialComment);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [loginPromptActionName, setLoginPromptActionName] = useState('');
  const [isQuoteDialogOpen, setIsQuoteDialogOpen] = useState(false);
  const [isProcessingLike, setIsProcessingLike] = useState(false);
  const [isProcessingBookmark, setIsProcessingBookmark] = useState(false);

  useEffect(() => {
    setComment(initialComment);
  }, [initialComment]);

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
    
    const postId = comment.parentPostId;
    if (!comment.id || !postId) {
      toast({ title: "Erro", description: "Não é possível curtir um comentário inválido.", variant: "destructive" });
      return;
    }

    setIsProcessingLike(true);

    const newLikedState = !comment.isLiked;
    const newLikesCount = comment.isLiked ? (comment.likes || 1) - 1 : (comment.likes || 0) + 1;
    
    // Optimistic update
    const updatedComment = { ...comment, isLiked: newLikedState, likes: newLikesCount };
    setComment(updatedComment);
    
    try {
      await toggleCommentLike(postId, comment.id, currentUserId);
    } catch (error) {
      // Revert on error
       setComment(comment);
       toast({ title: "Erro", description: "Não foi possível atualizar o status de curtida.", variant: "destructive" });
    } finally {
        setIsProcessingLike(false);
    }
  }, [comment, currentUserId, toast, setComment]);
  
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

    setIsProcessingBookmark(true);
    const originalCommentState = { ...comment };
    const newBookmarkedState = !comment.isBookmarked;

    const optimisticallyUpdatedComment = { 
      ...comment, 
      isBookmarked: newBookmarkedState,
    };
    
    setComment(optimisticallyUpdatedComment);
    
    try {
      const success = await toggleCommentBookmark(comment.parentPostId, comment.id, currentUserId);
      toast({
        title: success ? "Comentário Salvo!" : "Marcador Removido",
        description: success ? "Você pode encontrar isto nos seus Marcadores." : "O comentário foi removido dos seus Marcadores.",
      });
      // Optionally trigger a deletion callback if un-bookmarking from bookmarks page
      if (!success && onInteractionDeleted) {
        onInteractionDeleted(comment.id);
      }
    } catch (error) {
       // Rollback on error
       setComment(originalCommentState);
       toast({ title: "Erro", description: "Não foi possível atualizar o status do marcador.", variant: "destructive" });
    } finally {
        setIsProcessingBookmark(false);
    }
  }, [comment, currentUserId, onInteractionDeleted, toast, setComment, openLoginPrompt]);


  const handleRepostToggle = useCallback(async (e: React.MouseEvent | Event) => {
    e.stopPropagation();
    if (!currentUserId) {
        openLoginPrompt("repostar este comentário");
        return;
    }
    
    if (!comment || !comment.id) {
      toast({ title: "Error", description: "Cannot repost an invalid comment.", variant: "destructive" });
      return;
    }

    const originalComment = { ...comment };
    const newRepostedState = !comment.isReposted;
    const newRepostsCount = comment.isReposted ? (comment.repostsCount || 1) - 1 : (comment.repostsCount || 0) + 1;
    
    setComment({ 
      ...comment, 
      isReposted: newRepostedState, 
      repostsCount: newRepostsCount 
    });


    try {
        await toggleCommentRepost(comment.parentPostId, comment.id, currentUserId);
        toast({ title: newRepostedState ? "Comentário Repostado!" : "Repost desfeito." });

        const freshComment = await getCommentById(comment.parentPostId, comment.id, currentUserId);
        if (freshComment) {
          setComment(freshComment);
        }

    } catch (error: any) {
        setComment(originalComment);
        toast({ title: "Erro ao Repostar", description: error.message || "Não foi possível completar a ação.", variant: "destructive" });
    }
  }, [comment, currentUserId, onPostCreated, toast, setComment, openLoginPrompt]);

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
          where('quotedCommentId', '==', `${comment.parentPostId}/${comment.id}`),
          firestoreLimit(1)
        );
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          const quotePostId = snapshot.docs[0].id;
          const result = await serverDeletePost(quotePostId, currentUserId);
          if (result?.status === 'deleted') {
            toast({ title: "Citação deletada." });
            // Refresh the original comment state
            const freshComment = await getCommentById(comment.parentPostId, comment.id, currentUserId);
            if (freshComment) {
              setComment(freshComment);
            }
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
        setComment({ ...comment, isDeleted: true, text: '[Comentário deletado]' });
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
        setComment({...comment, user: {...comment.user, isMuted: !comment.user.isMuted }});
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
            setComment({...comment, user: {...comment.user, isBlocked: !comment.user.isBlocked }});
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
    isProcessingLike,
    handleBookmarkComment,
    isProcessingBookmark,
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
