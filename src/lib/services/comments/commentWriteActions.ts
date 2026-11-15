// src/lib/services/comments/commentWriteActions.ts
import { db } from '@/lib/firebase';
import type { Comment, Post, User, EmbeddedUserDetails, ReplyPermission, PostType, OriginalPostDetails, DeletionResult, Media } from '@/lib/types';
import { ECHO_COMMENT_MAX_LENGTH, NEWS_HEADLINE_MAX_LENGTH, NEWS_BODY_MAX_LENGTH } from '@/lib/constants/domain';
import {
  doc,
  getDoc,
  collection,
  addDoc,
  updateDoc,
  writeBatch,
  increment,
  serverTimestamp,
  Timestamp,
  FieldValue,
  deleteDoc,
  setDoc,
  runTransaction,
} from 'firebase/firestore';

import { deepCopyComment, deepCopyPost } from '@/lib/utils/dataTransformers';
import { removeUndefinedDeep, toStoredMedia } from '@/lib/utils/firestoreData';
import { getUser } from '@/lib/services/userService';
// createNotification is now handled by Cloud Functions, so we remove the import and calls.
import { postsCollection, getPostById } from '@/lib/services/postService';
import { extractYoutubeVideoInfo, extractHashtagsFromString } from '@/lib/utils/textUtils';
import { getCommentById } from './commentReadService';
import { markViewerAction } from '@/lib/services/viewerActions';

const createEmbeddedUserDetails = (user: User): EmbeddedUserDetails => {
  let avatarToEmbed = user.avatarUrl;
  if (user.avatarUrl && user.avatarUrl.startsWith('data:image')) {
    console.warn(`[EmbedWarning] User ${user.id} has base64 avatar in commentWriteActions. Using placeholder for embedding.`);
    avatarToEmbed = ''; // Placeholder or a default URL
  }
  return {
    userId: user.id,
    name: user.name,
    username: user.username,
    avatarUrl: avatarToEmbed,
    "data-ai-hint": user["data-ai-hint"] || null,
  };
};

export const addCommentToPost = async (postId: string, commentUserId: string | null, data: { text?: string; media?: Media[] | null; youtubeVideoId?: string; quotedPostObject?: Post | null; }, parentCommentId?: string): Promise<Comment | undefined> => {
    if (!commentUserId) return undefined;
    const post = await getPostById(postId, commentUserId);
    if (!post || !post.user) return undefined;

    const commenter = await getUser(commentUserId, commentUserId);
    if (!commenter) return undefined;

    let textForComment = data.text || '';
    let detectedYoutubeVideoId = data.youtubeVideoId;
    let finalMedia = toStoredMedia(data.media);

    const youtubeInfo = extractYoutubeVideoInfo(textForComment);
    if (youtubeInfo.videoId) {
      detectedYoutubeVideoId = youtubeInfo.videoId;
      textForComment = youtubeInfo.cleanedText || '';
      finalMedia = [];
    }

    const truncatedText = textForComment.substring(0, ECHO_COMMENT_MAX_LENGTH);
    const hashtags = extractHashtagsFromString(truncatedText);
    const commentsColRef = collection(db, 'posts', postId, 'comments');
    
    // Sanitize the quoted post object to only store essential details
    let quotedPostData: Partial<Post> | null = null;
    if (data.quotedPostObject) {
        const op = data.quotedPostObject;
        if (!op.user) {
            console.error("Quoted post object is missing user details.", op);
            quotedPostData = null;
        } else {
             quotedPostData = {
                id: op.id,
                userId: op.user.id,
                // Do not embed the full user object here. authorDetails is sufficient.
                // user: op.user,
                authorDetails: op.authorDetails || createEmbeddedUserDetails(op.user),
                type: op.type,
                text: op.text || null,
                createdAt: op.createdAt,
                category: op.category,
                headline: op.headline || null,
                media: op.media || null,
                youtubeVideoId: op.youtubeVideoId || null,
                hasMedia: op.hasMedia || false,
                sourceUrl: op.sourceUrl || null,
                newsCategory: op.newsCategory || null,
                postFormat: op.postFormat || 'standard',
                visibility: op.visibility || 'public',
                allowReposts: op.allowReposts,
                replyPermission: op.replyPermission,
                likes: op.likes || 0,
                reposts: op.reposts || 0,
                quotesCount: op.quotesCount || 0,
                commentsCount: op.commentsCount || 0,
            };
        }
    }


    const newCommentDataForFirestore: any = {
        userId: commentUserId,
        parentPostId: postId,
        postVisibility: post.visibility || 'public', // Denormalize post visibility
        postAuthorId: post.userId, // Denormalize post author ID
        text: truncatedText,
        hashtags: hashtags.length > 0 ? hashtags : null,
        createdAt: serverTimestamp(),
        likes: 0,
        repliesCount: 0,
        repostsCount: 0,
        isDeleted: false,
        media: finalMedia && finalMedia.length > 0 ? finalMedia : null,
        youtubeVideoId: detectedYoutubeVideoId || null,
        hasMedia: !!(finalMedia && finalMedia.length > 0) || !!detectedYoutubeVideoId || !!quotedPostData,
        ...(parentCommentId && { parentCommentId }),
        quotedPostObject: quotedPostData || null, // Store the sanitized quoted post
    };

    // commentsCount do post e repliesCount do comentário-pai são gravados pela Function onCommentCreated.
    // removeUndefinedDeep: o Firestore recusa `undefined` em qualquer campo (por exemplo, `allowReposts` de um post antigo
    // citado dentro do comentário); sem isso um único campo opcional vazio derrubava o envio inteiro.
    const newCommentRef = await addDoc(commentsColRef, removeUndefinedDeep(newCommentDataForFirestore));

    // Optimistically construct the comment object instead of re-fetching.
    const optimisticComment: Comment = {
      id: newCommentRef.id,
      userId: commentUserId,
      user: commenter,
      authorDetails: createEmbeddedUserDetails(commenter),
      parentPostId: postId,
      postAuthorId: post.userId,
      postVisibility: post.visibility || 'public',
      parentPostUser: post,
      parentPostAuthorDetails: post.authorDetails,
      parentCommentId: parentCommentId,
      text: truncatedText,
      likes: 0,
      repostsCount: 0,
      repliesCount: 0,
      isLiked: false,
      createdAt: new Date().toISOString(), // Optimistic client time
      isDeleted: false,
      media: finalMedia || undefined,
      youtubeVideoId: detectedYoutubeVideoId || undefined,
      hasMedia: newCommentDataForFirestore.hasMedia,
      quotedPostObject: data.quotedPostObject || undefined,
      hashtags: hashtags.length > 0 ? hashtags : null,
    };
    
    // If it's a reply, we need parent comment author details
    if(parentCommentId) {
        const parentComment = await getCommentById(postId, parentCommentId, commentUserId);
        if (parentComment?.user) {
            optimisticComment.parentCommentAuthorDetails = createEmbeddedUserDetails(parentComment.user);
        }
    }
    
    return deepCopyComment(optimisticComment);
};


export const deleteComment = async (postId: string, commentId: string, userId: string): Promise<DeletionResult | null> => {
    if (!userId || !postId || !commentId) throw new Error("Missing required IDs for comment deletion.");

    const commentRef = doc(db, 'posts', postId, 'comments', commentId);
    const postRef = doc(db, 'posts', postId);

    try {
        let finalStatus: 'deleted' | 'tombstoned' | null = null;

        await runTransaction(db, async (transaction) => {
            // --- READ PHASE ---
            const commentSnap = await transaction.get(commentRef);
            if (!commentSnap.exists()) throw new Error("Comment not found or already deleted.");
            
            const postSnap = await transaction.get(postRef);
            const commentData = commentSnap.data() as Comment;

            // --- VALIDATION & LOGIC PHASE ---
            // commentsCount e repliesCount são devolvidos pela Function onCommentDeleted.
            const postData = postSnap.exists() ? postSnap.data() as Post : null;
            const isCommentOwner = commentData.userId === userId;
            const isPostOwner = postData?.userId === userId;
            if (!isCommentOwner && !isPostOwner) {
                throw new Error("Not authorized to delete this comment.");
            }
            const hasReplies = (commentData.repliesCount || 0) > 0;

            // --- WRITE PHASE ---
            if (hasReplies) {
                transaction.update(commentRef, {
                    text: "[Comment deleted]",
                    media: null,
                    youtubeVideoId: null,
                    isDeleted: true,
                    hasMedia: false,
                    quotedPostObject: null,
                });
                finalStatus = 'tombstoned';
            } else {
                transaction.delete(commentRef);
                finalStatus = 'deleted';
            }
        });

        if (finalStatus === 'tombstoned') {
            const updatedComment = await getCommentById(postId, commentId, userId);
            return { status: 'tombstoned', updatedComment };
        }
        if (finalStatus === 'deleted') {
            return { status: 'deleted' };
        }

        return null;
    } catch (error) {
        console.error(`Error deleting comment ${commentId}:`, error);
        throw error;
    }
};

export const replyToComment = async (postId: string, parentCommentId: string, replyUserId: string | null, data: { text?: string; media?: Media[] | null; youtubeVideoId?: string; quotedPostObject?: Post | null; }): Promise<Comment | undefined> => {
    return addCommentToPost(postId, replyUserId, data, parentCommentId);
};

export const toggleCommentBookmark = async (
  parentPostId: string,
  commentId: string,
  userId: string
): Promise<boolean> => {
  if (!userId || !parentPostId || !commentId) {
    throw new Error("Informações insuficientes para marcar o comentário.");
  }
  const bookmarkRef = doc(db, `users/${userId}/bookmarks/${commentId}`);

  try {
    const bookmarkDoc = await getDoc(bookmarkRef);
    if (bookmarkDoc.exists()) {
      await deleteDoc(bookmarkRef);
      markViewerAction(userId, 'bookmark', commentId, false);
      return false; // Bookmark removed
    } else {
      // Store info needed to retrieve and display the bookmarked comment
      await setDoc(bookmarkRef, {
        contentType: 'comment',
        parentPostId: parentPostId,
        createdAt: serverTimestamp(),
      });
      markViewerAction(userId, 'bookmark', commentId, true);
      return true; // Bookmark added
    }
  } catch (error) {
    console.error(`Error toggling bookmark for comment ${commentId}:`, error);
    throw new Error("Não foi possível atualizar o status do marcador para o comentário.");
  }
};

export const reportComment = async (reporterId: string | null, postId:string, commentId: string, reason: string): Promise<boolean> => {
    if (!reporterId) return false;
    const reportsColRef = collection(db, 'reports');
    try {
        await addDoc(reportsColRef, {
            type: 'comment', reporterId, postId, commentId, reason, createdAt: serverTimestamp(), status: 'pending'
        });
        return true;
    } catch (error: any) { console.error(`Error reporting comment (ID: ${commentId}, PostID: ${postId}, Reporter: ${reporterId}):`, String(error)); return false; }
};
