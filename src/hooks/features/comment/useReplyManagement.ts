// src/hooks/features/comment/useReplyManagement.ts
import { useState } from 'react';
import type { Post, User } from '@/lib/types';
import { replyToComment as serverReplyToComment } from '@/lib/services/comments/commentWriteActions';
import { useToast } from "@/hooks/use-toast";

export interface UseReplyManagementProps {
  postId: string | undefined;
  currentUserId: string | null;
  postAuthorId: string | undefined;
  canCurrentUserReplyToPost: boolean;
  onReplySubmitted?: () => void; // Optional callback
}

export function useReplyManagement({
  postId,
  currentUserId,
  postAuthorId,
  canCurrentUserReplyToPost,
  onReplySubmitted,
}: UseReplyManagementProps) {
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const { toast } = useToast();

  const handleSubmitReplyToComment = async (
    replyingToCommentId: string,
    data: { text?: string; imageUrl?: string; "data-ai-hint"?: string; fileType?: 'image' | 'video' | 'file'; }
  ) => {
    if (!postId || !replyingToCommentId || !currentUserId) {
      console.error("handleSubmitReplyToComment: Missing postId, replyingToCommentId, or currentUserId.");
      return;
    }
    if (!data.text?.trim() && !data.imageUrl) {
      toast({ title: "Reply cannot be empty", variant: "destructive" });
      return;
    }
    if (!canCurrentUserReplyToPost && currentUserId !== postAuthorId) {
      const errorMsg = "You do not have permission to reply to comments on this post.";
      toast({ title: "Cannot Reply", description: errorMsg, variant: "destructive" });
      return;
    }

    setIsSubmittingReply(true);
    try {
      const newReply = await serverReplyToComment(postId, replyingToCommentId, currentUserId, data);
      if (newReply) {
        toast({ title: "Reply sent successfully!" });
        if (onReplySubmitted) onReplySubmitted();
      } else {
        const errorMsg = "Error sending reply";
        console.error(`ReplyManagement Error: ${errorMsg} - Replying to: ${replyingToCommentId}`);
        toast({ title: errorMsg, description: "Please try again.", variant: "destructive" });
      }
    } catch (error: any) {
      const errorMsg = `Error sending reply: ${error.message || 'Unknown error'}`;
      console.error(`ReplyManagement Error: ${errorMsg}`);
      toast({ title: "Error sending reply", description: error.message, variant: "destructive" });
    } finally {
      setIsSubmittingReply(false);
    }
  };

  return {
    isSubmittingReply,
    handleSubmitReplyToComment,
  };
}
