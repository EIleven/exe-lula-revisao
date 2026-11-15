// src/components/feed/post-card-utils.ts
import type { Comment as CommentType } from '@/lib/types';
import type { CommentSortOption, CommentViewOption } from '@/hooks/features/comment/useCommentSettings';

export const getCommentDepth = (commentId: string, allComments: CommentType[], depth = 0): number => {
    const comment = allComments.find(c => c.id === commentId);
    if (!comment || !comment.parentCommentId) {
      return depth;
    }
    const parentComment = allComments.find(c => c.id === comment.parentCommentId);
    if (!parentComment) return depth + 1;

    return getCommentDepth(parentComment.id, allComments, depth + 1);
  };


export const buildThreadedComments = (
    comments: CommentType[],
    sort: CommentSortOption,
    view: CommentViewOption
): Array<CommentType & { depth: number }> => {
    if (!comments || comments.length === 0) return [];

    const commentsById: { [key: string]: CommentType } = {};
    comments.forEach(comment => {
      commentsById[comment.id] = { ...comment };
    });

    const topLevelComments: CommentType[] = [];
    const nestedCommentsMap: { [key: string]: CommentType[] } = {};

    comments.forEach(comment => {
      if (comment.parentCommentId && commentsById[comment.parentCommentId]) {
        if (!nestedCommentsMap[comment.parentCommentId]) {
          nestedCommentsMap[comment.parentCommentId] = [];
        }
        nestedCommentsMap[comment.parentCommentId].push({ ...comment });
      } else {
        topLevelComments.push({ ...comment });
      }
    });

    // Sort only the top-level comments based on the selected criteria
    switch (sort) {
        case 'popular':
            topLevelComments.sort((a, b) => (b.likes || 0) - (a.likes || 0));
            break;
        case 'newest':
            topLevelComments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            break;
        case 'oldest':
            topLevelComments.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            break;
    }

    // Always sort replies chronologically to maintain conversational context
    for (const parentId in nestedCommentsMap) {
      nestedCommentsMap[parentId].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    }

    if (view === 'linear') {
        // For linear view, flatten everything and sort by the chosen criteria, ignoring nesting
        let flatList = [...comments];
        switch (sort) {
            case 'popular':
                flatList.sort((a, b) => (b.likes || 0) - (a.likes || 0));
                break;
            case 'newest':
                flatList.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                break;
            case 'oldest':
                flatList.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                break;
        }
        return flatList.map(c => ({ ...c, depth: 0 }));
    }

    // For nested view, build the threaded result from the sorted top-level comments
    const result: Array<CommentType & { depth: number }> = [];
    function addCommentsToResult(commentList: CommentType[], currentDepth: number) {
      commentList.forEach(comment => {
       result.push({ ...comment, depth: currentDepth });
       const replies = nestedCommentsMap[comment.id];
       if (replies) {
         addCommentsToResult(replies, currentDepth + 1);
       }
     });
   }

   addCommentsToResult(topLevelComments, 0);
   return result;
 };
