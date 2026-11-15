// src/components/feed/CommentSection.tsx
import React, { useMemo, useEffect } from 'react';
import type { Comment as CommentType, Post } from '@/lib/types';
import type { ViewerSummary } from '@/contexts/CurrentUserContext';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import CommentCard from './CommentCard'; // Corrected import
import { Skeleton } from "@/components/ui/skeleton"; // For loading state
import { DialogTrigger } from '@/components/ui/dialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { triggerHapticFeedback } from '@/lib/utils';

interface CommentSectionProps {
  post: Post; // Still needed for context like post.id, post.userId, post.allowReposts, post.commentsCount
  commentsToDisplay: (CommentType & { depth?: number })[]; // Use the new type with depth
  allComments?: (CommentType & { depth?: number })[];
  isLoadingComments: boolean; // Loading state for these comments
  loggedInUser: ViewerSummary | null | undefined;
  currentUserId: string | null;
  canCurrentUserReplyToPost: boolean;
  isSinglePostView: boolean; // Add this prop
  showCommentsState: boolean;
  onCommentAdded: (newComment: CommentType) => void;
  onPostCreated?: (newPost: Post) => void;
  openLoginPrompt: (actionName: string) => void;
  isMobile: boolean;
  commentDisplaySettingsControl: React.ReactNode | null; // Pass the settings component as a prop
  focusedCommentId?: string | null;
  onClearFocusedComment?: () => void;
}

export default function CommentSection({
  post,
  commentsToDisplay,
  allComments,
  isLoadingComments,
  loggedInUser,
  currentUserId,
  canCurrentUserReplyToPost,
  isSinglePostView, // Use this prop
  showCommentsState,
  onCommentAdded,
  onPostCreated,
  openLoginPrompt,
  isMobile,
  commentDisplaySettingsControl,
  focusedCommentId,
  onClearFocusedComment,
}: CommentSectionProps) {
  const focusedThread = useMemo(() => {
    if (!focusedCommentId) return null;
    const pool = allComments && allComments.length > 0 ? allComments : commentsToDisplay;
    const byId = new Map<string, CommentType & { depth?: number }>();
    for (const c of pool) {
      byId.set(c.id, c);
    }
    const focused = byId.get(focusedCommentId);
    if (!focused) return null;

    const ancestors: (CommentType & { depth?: number })[] = [];
    const visited = new Set<string>([focused.id]);
    let currParentId = focused.parentCommentId;
    while (currParentId && !visited.has(currParentId)) {
      visited.add(currParentId);
      const parent = byId.get(currParentId);
      if (!parent) break;
      ancestors.unshift(parent);
      currParentId = parent.parentCommentId;
    }

    const childrenByParent = new Map<string, (CommentType & { depth?: number })[]>();
    for (const c of pool) {
      if (c.parentCommentId) {
        const list = childrenByParent.get(c.parentCommentId) ?? [];
        list.push(c);
        childrenByParent.set(c.parentCommentId, list);
      }
    }

    const descendants: (CommentType & { depth?: number })[] = [];
    const collectDescendants = (parentId: string, depth: number) => {
      const children = childrenByParent.get(parentId) ?? [];
      for (const child of children) {
        if (visited.has(child.id)) continue;
        visited.add(child.id);
        descendants.push({ ...child, depth });
        collectDescendants(child.id, depth + 1);
      }
    };
    collectDescendants(focused.id, 1);

    return { ancestors, focused, descendants };
  }, [focusedCommentId, allComments, commentsToDisplay]);

  if (!showCommentsState) return null;

  return (
    <div className="bg-card/50" onClick={(e) => e.stopPropagation()} data-interactive="true">
      <div className="flex justify-between items-center mb-3 px-4 pt-4">
        <h4 className="text-xs font-semibold text-muted-foreground">Comentários ({post.commentsCount || commentsToDisplay.length || 0})</h4>
        {isSinglePostView && commentDisplaySettingsControl}
      </div>
      
      {isLoadingComments && (
        <div className="space-y-4 py-2 px-4">
            {[...Array(2)].map((_, i) => (
                <div key={`comment-section-skeleton-${i}`} className="flex items-start space-x-3 p-2">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-full" />
                    </div>
                </div>
            ))}
        </div>
      )}

      {!isLoadingComments && focusedThread ? (
        <div className="space-y-0">
          {onClearFocusedComment && (
            <div className="flex items-center justify-between px-4 py-2 border-y border-border/70 bg-muted/30 text-xs">
              <span className="text-muted-foreground font-medium">Comentário em foco</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClearFocusedComment();
                }}
                className="text-primary hover:underline font-medium"
                data-interactive="true"
              >
                Ver conversa completa
              </button>
            </div>
          )}
          {focusedThread.ancestors.map((ancestor) => (
            <div key={ancestor.id} className="border-l-2 border-primary/30">
              <CommentCard
                comment={{ ...ancestor, depth: 0 }}
                onPostCreated={onPostCreated}
                parentPostAuthorId={post.userId}
              />
            </div>
          ))}
          <CommentCard
            key={focusedThread.focused.id}
            comment={{ ...focusedThread.focused, depth: 0 }}
            onPostCreated={onPostCreated}
            parentPostAuthorId={post.userId}
            isFocused={true}
          />
          {focusedThread.descendants.map((reply) => (
            <CommentCard
              key={reply.id}
              comment={reply}
              onPostCreated={onPostCreated}
              parentPostAuthorId={post.userId}
            />
          ))}
        </div>
      ) : !isLoadingComments && commentsToDisplay.length > 0 && (
        <div className="space-y-0">
          {commentsToDisplay.map((comment) => (
            <CommentCard
              key={comment.id}
              comment={comment}
              onPostCreated={onPostCreated}
              parentPostAuthorId={post.userId}
            />
          ))}
        </div>
      )}

      {/* Renders the non-floating comment input for desktop or non-single-post views */}
      {!isMobile && loggedInUser && canCurrentUserReplyToPost && (
        <DialogTrigger asChild>
            <div
              className="flex items-center space-x-3 border-b border-t border-border cursor-pointer group py-2 px-2"
              data-interactive="true"
              onClick={triggerHapticFeedback}
            >
                <Avatar className="h-8 w-8">
                <AvatarImage src={loggedInUser.avatarUrl} alt={loggedInUser.name} data-ai-hint={loggedInUser["data-ai-hint"] || "person avatar"} />
                <AvatarFallback>{loggedInUser.name?.substring(0,1) || 'Me'}</AvatarFallback>
                </Avatar>
                <div className="flex-1">
                    <p className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">Escreva um comentário...</p>
                </div>
            </div>
        </DialogTrigger>
      )}

      {!currentUserId && (
        <p className="text-xs text-muted-foreground text-center py-2 mt-2 border-t border-border px-4">
          <button 
            onClick={(e) => { 
              e.stopPropagation(); 
              openLoginPrompt("comentar neste post"); 
            }}
            className="underline hover:text-primary" 
            data-interactive="true"
          >
            Login
          </button> para comentar.
        </p>
      )}
      {currentUserId && !canCurrentUserReplyToPost && post.userId !== currentUserId && (
          <p className="text-xs text-muted-foreground text-center py-2 mt-2 border-t border-border px-4">
              O autor limitou quem pode responder a este post.
          </p>
      )}
    </div>
  );
}
