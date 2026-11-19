// src/hooks/features/comment/useCommentManagement.ts
import { useState, useEffect, useCallback } from 'react';
import type { Comment as CommentType } from '@/lib/types';
import { getCommentsForPost } from '@/lib/services/comments/commentReadService';
import { useToast } from "@/hooks/use-toast";

interface UseCommentManagementProps {
  postId: string | undefined;
  currentUserId: string | null;
  showComments: boolean; // Control fetching based on visibility
}

export function useCommentManagement({ postId, currentUserId, showComments }: UseCommentManagementProps) {
  const [loadedComments, setLoadedComments] = useState<CommentType[]>([]);
  const [areCommentsLoading, setAreCommentsLoading] = useState(false);
  const { toast } = useToast();

  const fetchComments = useCallback(async () => {
    if (!postId || !showComments || loadedComments.length > 0) return; // Only fetch if visible and not already loaded

    setAreCommentsLoading(true);
    try {
      const comments = await getCommentsForPost(postId, currentUserId);
      setLoadedComments(comments);
    } catch (error: any) {
      console.error(`CommentManagement Error: Failed to fetch comments for post ${postId}`, error);
      toast({ title: "Erro ao carregar comentários", description: error.message, variant: "destructive" });
    } finally {
      setAreCommentsLoading(false);
    }
  }, [postId, showComments, currentUserId, toast, loadedComments.length]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);
  
  // This function is now used to ADD a new comment to the top of the list optimistically
  const handleCommentAdded = useCallback((newComment: CommentType) => {
    setLoadedComments((prevComments) =>
      prevComments.some((c) => c.id === newComment.id) ? prevComments : [newComment, ...prevComments],
    );
  }, []);

  return {
    loadedComments,
    areCommentsLoading,
    handleCommentAdded,
  };
}