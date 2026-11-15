// src/lib/services/comments/commentReadService.ts
import { db } from '@/lib/firebase';
import type { Comment, EmbeddedUserDetails, Post, User } from '@/lib/types'; 
import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  orderBy,
  limit as firestoreLimit,
  collectionGroup,
  startAfter,
  Timestamp,
} from 'firebase/firestore';

import { deepCopyComment } from '@/lib/utils/dataTransformers';
import { getUser } from '@/lib/services/userService';
import { getCurrentUserId } from '@/lib/services/authService';
import { getPostById, PaginatedPostsResponse, PaginatedPostsOptions } from '@/lib/services/postService';
import { getViewerActions } from '@/lib/services/viewerActions';

const createEmbeddedUserDetails = (user: User): EmbeddedUserDetails => {
  let avatarToEmbed = user.avatarUrl;
  if (user.avatarUrl && user.avatarUrl.startsWith('data:image')) {
    console.warn(`[EmbedWarning] User ${user.id} has base64 avatar in commentReadService. Using placeholder for embedding.`);
    avatarToEmbed = ''; 
  }
  return {
    userId: user.id,
    name: user.name,
    username: user.username,
    avatarUrl: avatarToEmbed,
    "data-ai-hint": user["data-ai-hint"] || null,
  };
};

const getComparableTime = (timestamp: Timestamp | string | Date | undefined): number => {
  if (!timestamp) return 0; 
  if (typeof (timestamp as any).toMillis === 'function') { 
    return (timestamp as Timestamp).toMillis();
  }
  if (timestamp instanceof Date) { 
    return timestamp.getTime();
  }
  if (typeof timestamp === 'string') { 
    const date = new Date(timestamp);
    return isNaN(date.getTime()) ? 0 : date.getTime(); 
  }
  if (typeof timestamp === 'number') { // Handle plain numbers
    return timestamp;
  }
  console.warn("Unexpected timestamp type in getComparableTime (commentReadService):", timestamp);
  return 0;
};


export const getCommentById = async (postId: string, commentId: string, activeUserId: string | null = getCurrentUserId()): Promise<Comment | undefined> => {
    if (!postId || !commentId) return undefined;

    const commentRef = doc(db, 'posts', postId, 'comments', commentId);
    try {
        const commentSnap = await getDoc(commentRef);
        if (!commentSnap.exists()) return undefined;

        const rawCommentData = commentSnap.data() as any;

        const commentAuthor = await getUser(rawCommentData.userId, activeUserId);
        if (!commentAuthor) {
            console.warn(`[getCommentById] Could not resolve author for comment ${commentId}.`);
            return undefined;
        }

        if (activeUserId && commentAuthor.id !== activeUserId) {
            if(commentAuthor.isBlocked || commentAuthor.hasBlockedCurrentUser) return undefined;
        }

        let isLikedForClient = false;
        let isQuotedByCurrentUser = false;
        let isRepostedByCurrentUser = false;
        let isBookmarkedByViewer = false;

        if (activeUserId) {
            // Uma consulta por sessão em vez de 4 leituras por comentário (veja viewerActions.ts).
            const actions = await getViewerActions(activeUserId);
            const key = `${postId}/${commentId}`;
            isLikedForClient = actions.like.has(key);
            isBookmarkedByViewer = actions.bookmark.has(commentId);
            isQuotedByCurrentUser = actions.quote.has(key);
            isRepostedByCurrentUser = actions.repost.has(key);
        }

        const parentPost = await getPostById(postId, activeUserId);
        
        // Fetch full quoted post object if it exists
        let fullQuotedPost: Post | undefined | null = null;
        if (rawCommentData.quotedPostObject?.id) {
            fullQuotedPost = await getPostById(rawCommentData.quotedPostObject.id, activeUserId);
        }

        const commentToReturn: Comment = {
            id: commentSnap.id,
            userId: rawCommentData.userId,
            user: commentAuthor,
            authorDetails: createEmbeddedUserDetails(commentAuthor),
            text: rawCommentData.text,
            likes: rawCommentData.likes || 0,
            repostsCount: rawCommentData.repostsCount || 0,
            repliesCount: rawCommentData.repliesCount || 0,
            isLiked: isLikedForClient,
            isBookmarked: isBookmarkedByViewer,
            isReposted: isRepostedByCurrentUser,
            isQuotedByCurrentUser: isQuotedByCurrentUser,
            parentPostId: postId,
            postAuthorId: rawCommentData.postAuthorId,
            postVisibility: rawCommentData.postVisibility || 'public',
            parentPostUser: parentPost,
            parentCommentId: rawCommentData.parentCommentId,
            createdAt: new Date(getComparableTime(rawCommentData.createdAt)).toISOString(),
            parentPostText: parentPost?.text?.substring(0, 100) || parentPost?.headline?.substring(0, 100),
            imageUrl: rawCommentData.imageUrl, media: rawCommentData.media ?? undefined,
            youtubeVideoId: rawCommentData.youtubeVideoId,
            "data-ai-hint": rawCommentData["data-ai-hint"],
            isDeleted: rawCommentData.isDeleted || false,
            hasMedia: rawCommentData.hasMedia || false,
            quotedPostObject: fullQuotedPost,
        };
        return deepCopyComment(commentToReturn);

    } catch (error) {
        console.error(`Error fetching comment ${commentId}:`, error);
        return undefined;
    }
};

// Fetches all comments for a specific post - used by PostCard to load comments on demand
export const getCommentsForPost = async (postId: string, activeUserId: string | null = getCurrentUserId()): Promise<Comment[]> => {
  if (!postId) return [];

  const commentsResult: Comment[] = [];
  const commentsColRef = collection(db, 'posts', postId, 'comments');
  const commentsQuery = query(commentsColRef, orderBy('createdAt', 'asc'));

  try {
    const commentsSnapshot = await getDocs(commentsQuery);
    if (commentsSnapshot.empty) return [];

    const parentPost = await getPostById(postId, activeUserId); 
    const fetchedUsersCache = new Map<string, User | undefined>();

    const getCachedUser = async (userId: string) => {
      if (fetchedUsersCache.has(userId)) {
        return fetchedUsersCache.get(userId);
      }
      const user = await getUser(userId, activeUserId);
      fetchedUsersCache.set(userId, user);
      return user;
    };

    for (const commentDoc of commentsSnapshot.docs) {
      const rawCommentData = commentDoc.data() as any;

      const commentAuthor = await getCachedUser(rawCommentData.userId);
      if (!commentAuthor) {
        console.warn(`[getCommentsForPost] Could not resolve author for comment ${commentDoc.id}. Skipping.`);
        continue;
      }
      if (activeUserId && commentAuthor.id !== activeUserId) {
        if(commentAuthor.isBlocked || commentAuthor.hasBlockedCurrentUser) continue;
      }
      
      let commentParentPostAuthorDetails: EmbeddedUserDetails | undefined;
      let commentParentPostText: string | undefined;
      let commentParentCommentAuthorDetails: EmbeddedUserDetails | undefined; // For replies

      if (parentPost) {
        commentParentPostAuthorDetails = parentPost.authorDetails || (parentPost.user ? createEmbeddedUserDetails(parentPost.user) : undefined);
        commentParentPostText = parentPost.text?.substring(0,100) + (parentPost.text && parentPost.text.length > 100 ? "..." : "") || parentPost.headline?.substring(0,100) + (parentPost.headline && parentPost.headline.length > 100 ? "..." : "");
      }

      // If it's a reply, get the parent comment's author details
      if (rawCommentData.parentCommentId) {
        const parentCommentRef = doc(db, 'posts', postId, 'comments', rawCommentData.parentCommentId);
        const parentCommentSnap = await getDoc(parentCommentRef);
        if (parentCommentSnap.exists()) {
            const parentCommentData = parentCommentSnap.data() as any;
            if (parentCommentData.userId) {
                const parentCommentAuthor = await getCachedUser(parentCommentData.userId);
                if (parentCommentAuthor) {
                    commentParentCommentAuthorDetails = createEmbeddedUserDetails(parentCommentAuthor);
                }
            }
        }
      }
      
      let isLikedForClient = false;
      let isQuotedByCurrentUser = false;
      let isRepostedByCurrentUser = false;
      let isBookmarkedByViewer = false;

      if (activeUserId) {
          const actions = await getViewerActions(activeUserId);
          const key = `${postId}/${commentDoc.id}`;
          isLikedForClient = actions.like.has(key);
          isBookmarkedByViewer = actions.bookmark.has(commentDoc.id);
          isQuotedByCurrentUser = actions.quote.has(key);
          isRepostedByCurrentUser = actions.repost.has(key);
      }

      // Fetch full quoted post object if it exists
      let fullQuotedPost: Post | undefined | null = null;
      if (rawCommentData.quotedPostObject?.id) {
          fullQuotedPost = await getPostById(rawCommentData.quotedPostObject.id, activeUserId);
      }

      const commentToReturn: Comment = {
        id: commentDoc.id,
        userId: rawCommentData.userId,
        user: commentAuthor, // Now includes the full, up-to-date user object
        authorDetails: createEmbeddedUserDetails(commentAuthor), // Always create fresh embedded details
        text: rawCommentData.text,
        likes: rawCommentData.likes || 0,
        repostsCount: rawCommentData.repostsCount || 0,
        repliesCount: rawCommentData.repliesCount || 0,
        isLiked: isLikedForClient,
        isBookmarked: isBookmarkedByViewer,
        isReposted: isRepostedByCurrentUser,
        isQuotedByCurrentUser: isQuotedByCurrentUser,
        parentPostId: postId,
        postAuthorId: rawCommentData.postAuthorId,
        postVisibility: rawCommentData.postVisibility || 'public',
        parentPostAuthorDetails: commentParentPostAuthorDetails,
        parentPostUser: parentPost, 
        parentCommentId: rawCommentData.parentCommentId,
        parentCommentAuthorDetails: commentParentCommentAuthorDetails,
        createdAt: new Date(getComparableTime(rawCommentData.createdAt)).toISOString(),
        parentPostText: commentParentPostText || (parentPost ? "Post text snippet unavailable" : "Original post context unavailable"),
        imageUrl: rawCommentData.imageUrl, media: rawCommentData.media ?? undefined,
        youtubeVideoId: rawCommentData.youtubeVideoId,
        "data-ai-hint": rawCommentData["data-ai-hint"],
        isDeleted: rawCommentData.isDeleted || false,
        hasMedia: rawCommentData.hasMedia || false,
        quotedPostObject: fullQuotedPost,
      };
      commentsResult.push(deepCopyComment(commentToReturn));
    }
    return commentsResult;
  } catch (error) {
    console.error(`Error fetching comments for post ${postId}:`, error);
    return [];
  }
};

/**
 * Adapter function to make fetchPaginatedUserComments compatible with useInfiniteFeed.
 * It fetches comments but returns them typed as `Post` since useInfiniteFeed is typed for posts.
 * The rendering component (PaginatedCommentList) will cast them back to `Comment`.
 */
export async function fetchPaginatedComments(
  cursor: Timestamp | null,
  limit: number,
  activeUserId: string | null = getCurrentUserId(),
  options: PaginatedPostsOptions = {}
): Promise<PaginatedPostsResponse> {
  const { profileUserId } = options;

  if (!profileUserId) {
    // This function is specifically for fetching a user's comments, so profileUserId is required.
    return { posts: [], nextCursor: null, hasMore: false };
  }

  // Use the existing logic for fetching comments
  const { comments, nextCursor, hasMore } = await fetchPaginatedUserComments(
    profileUserId,
    cursor,
    limit,
    activeUserId
  );

  // Adapt the response to the PaginatedPostsResponse structure
  return {
    posts: comments as unknown as Post[], // Cast comments to Post[]
    nextCursor,
    hasMore,
  };
}


export const getUserComments = async (userId: string): Promise<Comment[]> => {
    console.warn("getUserComments is deprecated for UI lists. Use fetchPaginatedUserComments instead.");
    const { comments } = await fetchPaginatedUserComments(userId, null, 50);
    return comments;
};

export interface PaginatedCommentsResponse {
  comments: Comment[];
  nextCursor: Timestamp | null;
  hasMore: boolean;
}

export async function fetchPaginatedUserComments(
  userId: string,
  cursor: Timestamp | null,
  limit: number,
  activeUserId: string | null = getCurrentUserId()
): Promise<PaginatedCommentsResponse> {
  if (!userId) {
    return { comments: [], nextCursor: null, hasMore: false };
  }

  let q = query(
    collectionGroup(db, 'comments'), 
    where("userId", "==", userId),
    orderBy("createdAt", "desc")
  );

  // If viewing someone else's profile, only fetch comments on public posts.
  // This aligns with the security rules and prevents permission errors.
  if (activeUserId !== userId) {
    q = query(q, where("postVisibility", "==", "public"));
  }

  if (cursor) {
    q = query(q, startAfter(cursor));
  }

  q = query(q, firestoreLimit(limit + 1));

  try {
    const commentsSnapshot = await getDocs(q);
    const fetchedDocsData = commentsSnapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() as any 
    }));

    let hasMoreComments = false;
    if (fetchedDocsData.length > limit) {
      hasMoreComments = true;
      fetchedDocsData.pop(); 
    }
    
    const fetchedUsersCache = new Map<string, User | undefined>();
    const getCachedUser = async (idOfUserToGet: string) => {
      if (fetchedUsersCache.has(idOfUserToGet)) {
        return fetchedUsersCache.get(idOfUserToGet);
      }
      const user = await getUser(idOfUserToGet, activeUserId);
      fetchedUsersCache.set(idOfUserToGet, user);
      return user;
    };

    const comments: Comment[] = [];
    for (const rawCommentData of fetchedDocsData) {
        // The parent post ID is available in the document path for a collection group query
        const postId = rawCommentData.parentPostId;
        if (!postId) {
            console.warn("Comment missing parentPostId:", rawCommentData.id);
            continue;
        }

        const commentAuthor = await getCachedUser(rawCommentData.userId);
        if (!commentAuthor) {
             console.warn(`Could not fetch author ${rawCommentData.userId} for comment ${rawCommentData.id}. Skipping.`);
             continue;
        }
        if (activeUserId && commentAuthor.id !== activeUserId) {
            if(commentAuthor.isBlocked || commentAuthor.hasBlockedCurrentUser) continue;
        }

        // Fetch the parent post to provide context in the comment card
        const parentPost = await getPostById(postId, activeUserId);
        
        let fullQuotedPost: Post | undefined | null = null;
        if (rawCommentData.quotedPostObject?.id) {
            fullQuotedPost = await getPostById(rawCommentData.quotedPostObject.id, activeUserId);
        }

        let isLikedForClient = false;
        let isBookmarkedByViewer = false;
        if (activeUserId) {
            const actions = await getViewerActions(activeUserId);
            isLikedForClient = actions.like.has(`${postId}/${rawCommentData.id}`);
            isBookmarkedByViewer = actions.bookmark.has(rawCommentData.id);
        }
        
        const commentToReturn: Comment = {
            id: rawCommentData.id,
            userId: rawCommentData.userId,
            user: commentAuthor,
            authorDetails: createEmbeddedUserDetails(commentAuthor),
            text: rawCommentData.text,
            likes: rawCommentData.likes || 0,
            repostsCount: rawCommentData.repostsCount || 0,
            repliesCount: rawCommentData.repliesCount || 0,
            isLiked: isLikedForClient,
            isBookmarked: isBookmarkedByViewer,
            parentPostId: postId,
            postAuthorId: rawCommentData.postAuthorId,
            postVisibility: rawCommentData.postVisibility || 'public',
            parentPostUser: parentPost, // Now includes the full parent post
            createdAt: new Date(getComparableTime(rawCommentData.createdAt)).toISOString(),
            imageUrl: rawCommentData.imageUrl, media: rawCommentData.media ?? undefined,
            youtubeVideoId: rawCommentData.youtubeVideoId,
            "data-ai-hint": rawCommentData["data-ai-hint"],
            isDeleted: rawCommentData.isDeleted || false,
            hasMedia: rawCommentData.hasMedia || false,
            quotedPostObject: fullQuotedPost,
        };
        comments.push(deepCopyComment(commentToReturn));
    }
    
    const nextCursorValue = comments.length > 0 && hasMoreComments && fetchedDocsData.length > 0
      ? fetchedDocsData[fetchedDocsData.length - 1].createdAt as Timestamp 
      : null;

    return {
      comments,
      nextCursor: nextCursorValue,
      hasMore: hasMoreComments,
    };
  } catch (error: any) {
    console.error(`Error fetching paginated comments for user ${userId}:`, String(error));
    throw error;
  }
}

export const canUserReply = async (postId: string, potentialCommenterId: string | null): Promise<boolean> => {
    const post = await getPostById(postId, potentialCommenterId);
    if (!post || !post.user) return false;
    if (!potentialCommenterId) return post.replyPermission === 'everyone';
    if (post.userId === potentialCommenterId) return true;
    switch (post.replyPermission) {
        case 'everyone': return true;
        case 'followed':
            if (!post.userId) return false;
            const authorFollowsCommenterRef = doc(db, 'users', post.userId, 'following', potentialCommenterId);
            const authorFollowsCommenterSnap = await getDoc(authorFollowsCommenterRef);
            return authorFollowsCommenterSnap.exists();
        case 'mentioned':
            const commenterUser = await getUser(potentialCommenterId, null);
            if (!commenterUser || !commenterUser.username) return false;
            const mentionTag = `@${commenterUser.username}`;
            const textToSearch = (post.text || '') + ' ' + (post.headline || '');
            const mentionRegex = new RegExp(`\\B${mentionTag}\\b`);
            return mentionRegex.test(textToSearch);
        default: return false;
    }
};

// Leituras em andamento de "o autor segue quem quer responder": dez posts do mesmo autor numa página fazem UMA leitura.
const authorFollowsReads = new Map<string, Promise<boolean>>();

/**
 * Mesma regra de `canUserReply`, mas decidida com o post que o cartão do feed JÁ tem na mão. A versão antiga baixava o post
 * inteiro de novo (autor, curtidas, reposts...) para CADA cartão que aparecia, dezenas de leituras a cada página do feed,
 * só para perguntar o que já estava no post. Agora só "seguidos" faz uma leitura (e uma só por autor).
 */
export const canUserReplyToLoadedPost = async (
  post: Partial<Pick<Post, 'userId' | 'replyPermission' | 'text' | 'headline'>>,
  commenter: { id: string; username?: string | null } | null,
): Promise<boolean> => {
  if (!commenter) return post.replyPermission === 'everyone';
  if (post.userId === commenter.id) return true;
  switch (post.replyPermission) {
    case 'everyone':
      return true;
    case 'followed': {
      if (!post.userId) return false;
      const key = `${post.userId}\u0000${commenter.id}`;
      let read = authorFollowsReads.get(key);
      if (!read) {
        read = getDoc(doc(db, 'users', post.userId, 'following', commenter.id))
          .then((snapshot) => snapshot.exists())
          .finally(() => { authorFollowsReads.delete(key); });
        authorFollowsReads.set(key, read);
      }
      return read;
    }
    case 'mentioned': {
      if (!commenter.username) return false;
      const mentionRegex = new RegExp(`\\B@${commenter.username}\\b`);
      return mentionRegex.test(`${post.text || ''} ${post.headline || ''}`);
    }
    default:
      return false;
  }
};

    
