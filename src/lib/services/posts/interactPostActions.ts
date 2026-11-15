// src/lib/services/posts/interactPostActions.ts
import { db, runTransaction, storage } from '@/lib/firebase';
import type { Post, DeletionResult } from '@/lib/types';
import {
  doc,
  updateDoc,
  serverTimestamp,
  deleteDoc,
  addDoc,
  increment,
  getDoc,
  collection, 
  query,
  where,
  limit as firestoreLimit,
  getDocs,
  setDoc,
  type DocumentReference,
} from 'firebase/firestore';

import { postsCollection } from '@/lib/services/postService';
import { markViewerAction } from '@/lib/services/viewerActions';

// Arquivo enviado por um usuário ao nosso Storage (caminho user_uploads/...); mídia de outros sites não entra.
const OWN_STORAGE_URL = /\/o\/user_uploads(%2F|\/)/;

// ---------------------------------------------------------------------------------------------------------------------
// Gravações IDEMPOTENTES dos marcadores (curtir, repostar, salvar): "deixe o marcador presente/ausente", em uma única ida
// ao servidor. O estado desejado é o que importa (e não "inverta o que está lá"), então toques repetidos, outra aba e
// tentativas de novo dão o mesmo resultado. O contador público não é mexido aqui: quem soma é a Function (onPostLiked...).
// ---------------------------------------------------------------------------------------------------------------------

const isPermissionDenied = (error: unknown): boolean => (error as { code?: unknown } | null)?.code === 'permission-denied';

/** Cria o marcador se faltar (ou apaga, se `present` for falso). Já existir não é erro. */
async function setMarker(ref: DocumentReference, present: boolean, data: Record<string, unknown>): Promise<void> {
  if (!present) {
    await deleteDoc(ref); // apagar o que não existe é um não-fazer-nada, não um erro
    return;
  }
  try {
    await setDoc(ref, data);
  } catch (error) {
    // As regras só deixam CRIAR o marcador: se ele já existe (toque repetido, outra aba), o estado desejado já vale.
    if (isPermissionDenied(error)) {
      const existing = await getDoc(ref).catch(() => null);
      if (existing?.exists()) return;
    }
    throw error;
  }
}

/** Registra no cache de "o que quem vê já fez" e desfaz se a gravação falhar. */
async function withViewerAction(userId: string, kind: 'like' | 'repost' | 'bookmark', key: string, present: boolean, write: () => Promise<void>): Promise<void> {
  markViewerAction(userId, kind, key, present);
  try {
    await write();
  } catch (error) {
    markViewerAction(userId, kind, key, !present);
    throw error;
  }
}

/** Curtida no post: deixa o marcador presente (`liked`) ou ausente. Lança erro se falhar. */
export const setPostLike = (postId: string, userId: string, liked: boolean): Promise<void> =>
  withViewerAction(userId, 'like', postId, liked, () =>
    setMarker(doc(db, `posts/${postId}/likes/${userId}`), liked, { createdAt: serverTimestamp(), userId }));

/** Curtida no comentário. */
export const setCommentLike = (postId: string, commentId: string, userId: string, liked: boolean): Promise<void> =>
  withViewerAction(userId, 'like', `${postId}/${commentId}`, liked, () =>
    setMarker(doc(db, `posts/${postId}/comments/${commentId}/likes/${userId}`), liked, { createdAt: serverTimestamp(), userId }));

/** Repost do post. */
export const setPostRepost = (postId: string, userId: string, reposted: boolean): Promise<void> =>
  withViewerAction(userId, 'repost', postId, reposted, () =>
    setMarker(doc(db, `posts/${postId}/reposts/${userId}`), reposted, { userId, createdAt: serverTimestamp() }));

/** Repost do comentário. */
export const setCommentRepost = (postId: string, commentId: string, userId: string, reposted: boolean): Promise<void> =>
  withViewerAction(userId, 'repost', `${postId}/${commentId}`, reposted, () =>
    setMarker(doc(db, `posts/${postId}/comments/${commentId}/reposts/${userId}`), reposted, { userId, createdAt: serverTimestamp() }));

/** Marcador (salvar) do post. As regras deixam o dono escrever livremente em users/{uid}/bookmarks. */
export const setPostBookmark = (postId: string, userId: string, saved: boolean): Promise<void> =>
  withViewerAction(userId, 'bookmark', postId, saved, async () => {
    const ref = doc(db, `users/${userId}/bookmarks/${postId}`);
    if (saved) await setDoc(ref, { postId, createdAt: serverTimestamp() });
    else await deleteDoc(ref);
  });

/** Marcador (salvar) do comentário. */
export const setCommentBookmark = (postId: string, commentId: string, userId: string, saved: boolean): Promise<void> =>
  withViewerAction(userId, 'bookmark', commentId, saved, async () => {
    const ref = doc(db, `users/${userId}/bookmarks/${commentId}`);
    if (saved) await setDoc(ref, { contentType: 'comment', parentPostId: postId, createdAt: serverTimestamp() });
    else await deleteDoc(ref);
  });

/**
 * Toggles a repost on a post.
 * Creates or deletes the 'repost' document and updates the post's reposts count.
 * @param postId The ID of the post to repost/un-repost.
 * @param userId The ID of the user performing the action.
 */
export const toggleRepost = async (postId: string, userId: string): Promise<void> => {
  if (!userId || !postId) {
    throw new Error("User ID and Post ID are required to toggle a repost.");
  }
  const repostRef = doc(db, `posts/${postId}/reposts/${userId}`);
  const postRef = doc(db, 'posts', postId);

  // Só o marcador reposts/{uid}: o contador "reposts" e a notificação são gravados pela Function onPostReposted.
  const [repostDoc, postDoc] = await Promise.all([getDoc(repostRef), getDoc(postRef)]);
  if (!postDoc.exists()) {
    throw new Error("Post not found.");
  }
  if (repostDoc.exists()) {
    await deleteDoc(repostRef);
    markViewerAction(userId, 'repost', postId, false);
    return;
  }
  const postData = postDoc.data();
  if (postData.allowReposts === false && postData.userId !== userId) {
    throw new Error("This post's author does not allow reposts.");
  }
  await setDoc(repostRef, { userId, createdAt: serverTimestamp() });
  markViewerAction(userId, 'repost', postId, true);
};

/**
 * Toggles a like on a post.
 * Creates or deletes the 'like' document. The backend handles the rest.
 * @param postId The ID of the post to like/unlike.
 * @param userId The ID of the user performing the action.
 * @returns {Promise<boolean>} True if the action was successful, false otherwise.
 */
export const togglePostLike = async (postId: string, userId: string | null): Promise<boolean> => {
  if (!userId) {
    console.error("User must be logged in to like a post.");
    return false;
  }

  const likeRef = doc(db, `posts/${postId}/likes/${userId}`);
  
  try {
    const likeDoc = await getDoc(likeRef);

    if (likeDoc.exists()) {
      // User is unliking the post
      await deleteDoc(likeRef);
      markViewerAction(userId, 'like', postId, false);
    } else {
      // User is liking the post
      await setDoc(likeRef, { 
        createdAt: serverTimestamp(),
        userId: userId 
      });
      markViewerAction(userId, 'like', postId, true);
    }
    return true;
  } catch (error) {
    console.error(`Error toggling like on post ${postId}:`, error);
    return false;
  }
};

/**
 * Toggles a bookmark on a post for a user.
 * @param postId The ID of the post to bookmark/unbookmark.
 * @param userId The ID of the user performing the action.
 * @returns A promise that resolves to true if the bookmark was added, false if removed.
 */
export const toggleBookmark = async (postId: string, userId: string): Promise<boolean> => {
  const bookmarkRef = doc(db, `users/${userId}/bookmarks/${postId}`);

  try {
    const bookmarkDoc = await getDoc(bookmarkRef);
    if (bookmarkDoc.exists()) {
      await deleteDoc(bookmarkRef);
      markViewerAction(userId, 'bookmark', postId, false);
      return false; // Bookmark removed
    } else {
      await setDoc(bookmarkRef, {
        postId: postId,
        createdAt: serverTimestamp(),
      });
      markViewerAction(userId, 'bookmark', postId, true);
      return true; // Bookmark added
    }
  } catch (error) {
    console.error(`Error toggling bookmark for post ${postId}:`, error);
    throw new Error("Could not update bookmark status.");
  }
};

/**
 * Toggles a like on a comment.
 * Creates or deletes the 'like' document. The backend handles the rest.
 * @param postId The ID of the parent post.
 * @param commentId The ID of the comment to like/unlike.
 * @param userId The ID of the user performing the action.
 * @returns {Promise<boolean>} True if the action was successful, false otherwise.
 */
export const toggleCommentLike = async (
  postId: string, 
  commentId: string, 
  userId: string | null
): Promise<boolean> => {
  if (!userId) {
    console.error("User must be logged in to like a comment.");
    return false;
  }

  const likeRef = doc(db, `posts/${postId}/comments/${commentId}/likes/${userId}`);
  
  try {
    const likeDoc = await getDoc(likeRef);

    if (likeDoc.exists()) {
      // User is unliking the comment
      await deleteDoc(likeRef);
      markViewerAction(userId, 'like', `${postId}/${commentId}`, false);
    } else {
      // User is liking the comment
      await setDoc(likeRef, { 
        createdAt: serverTimestamp(),
        userId: userId 
      });
      markViewerAction(userId, 'like', `${postId}/${commentId}`, true);
    }
    return true;
  } catch (error) {
    console.error(`Error toggling like on comment ${commentId}:`, error);
    return false;
  }
};

export const toggleCommentRepost = async (postId: string, commentId: string, userId: string): Promise<void> => {
  const repostRef = doc(db, `posts/${postId}/comments/${commentId}/reposts/${userId}`);
  const commentRef = doc(db, `posts/${postId}/comments/${commentId}`);

  // Só o marcador: repostsCount do comentário e a notificação vêm da Function onCommentReposted.
  const [repostDoc, commentDoc] = await Promise.all([getDoc(repostRef), getDoc(commentRef)]);
  if (!commentDoc.exists()) {
    throw new Error("Comment not found.");
  }
  if (repostDoc.exists()) {
    await deleteDoc(repostRef);
    markViewerAction(userId, 'repost', `${postId}/${commentId}`, false);
  } else {
    await setDoc(repostRef, { userId, createdAt: serverTimestamp() });
    markViewerAction(userId, 'repost', `${postId}/${commentId}`, true);
  }
};


export const reportPost = async (reporterId: string | null, postId: string, reason: string): Promise<boolean> => {
    if (!reporterId) return false;
    const reportsColRef = collection(db, 'reports');
    try {
        await addDoc(reportsColRef, { 
            type: 'post', 
            reporterId, 
            postId, 
            reason, 
            createdAt: serverTimestamp(), 
            status: 'pending' 
        });
        return true;
    } catch (error: any) { 
        console.error(`Error reporting post ${postId}:`, String(error)); 
        return false; 
    }
};

export const deletePost = async (postId: string, userId: string | null): Promise<DeletionResult | null> => {
    if (!userId) throw new Error("User ID is required to delete a post.");
    if (!postId) throw new Error("Post ID is required to delete a post.");

    const postRef = doc(postsCollection, postId);
    try {
        let finalStatus: 'deleted' | 'tombstoned' | null = null;
        // Arquivos do post no nosso Storage (imagens e vídeos enviados): apagados depois da transação.
        let storageUrls: string[] = [];
        // Se o post apagado era uma citação, o que ele citava deixa de contar como "citado por mim".
        let quotedKey: string | null = null;

        await runTransaction(db, async (transaction) => {
            // --- READ PHASE ---
            const postSnap = await transaction.get(postRef);
            if (!postSnap.exists()) throw new Error("Post not found or already deleted.");

            const data = postSnap.data() as Post;
            const isPostOwner = data.userId === userId;
            if (!isPostOwner) {
                throw new Error("User is not authorized to delete this post.");
            }
            storageUrls = [...(data.media ?? []).map((item) => item.url), data.imageUrl, data.videoUrl].filter(
                (url): url is string => typeof url === 'string' && OWN_STORAGE_URL.test(url),
            );
            quotedKey = data.type === 'quote' ? (data.quotedCommentId || data.originalPostDetails?.id || null) : null;

            // --- LOGIC & VALIDATION PHASE ---
            // postsCount do autor e o contador do post/comentário citado são devolvidos pelas Functions
            // (onPostDeleted ao apagar, onPostUpdated ao "tombar"): o navegador não grava mais números.
            const hasInteractions = (data.commentsCount || 0) > 0 || ((data.reposts || 0) + (data.quotesCount || 0)) > 0;
            const canPermanentlyDelete = !hasInteractions || data.type === 'repost';

            // --- WRITE PHASE ---
            if (canPermanentlyDelete) {
                transaction.delete(postRef);
                finalStatus = 'deleted';
            } else {
                transaction.update(postRef, {
                    isDeleted: true,
                    text: null,
                    headline: null,
                    imageUrl: null,
                    videoUrl: null,
                    media: null,
                    hasMedia: false,
                    youtubeVideoId: null,
                    "data-ai-hint": null,
                    originalPostDetails: null,
                    quotedComment: null,
                    quotedCommentId: null,
                });
                finalStatus = 'tombstoned';
            }
        });

        if (quotedKey) markViewerAction(userId, 'quote', quotedKey, false);

        // O post já saiu (ou foi esvaziado): apaga as imagens e vídeos dele no Storage. Sem isso o arquivo continuava
        // público (as regras do Storage liberam a leitura de user_uploads/) e ocupando espaço. Falha aqui não desfaz a
        // exclusão: fica no console.
        if (storageUrls.length > 0) {
            // Importado só quando há arquivo a apagar, para não pesar no pacote de todas as telas (o SDK do Storage
            // e, em mediaUploadService, a biblioteca de compressão de imagens).
            const { ref: storageRef, deleteObject } = await import('firebase/storage');
            await Promise.all(
                storageUrls.map((url) =>
                    deleteObject(storageRef(storage, url)).catch((error) => console.warn(`Não foi possível apagar a mídia ${url} do Storage:`, String(error))),
                ),
            );
        }

        if (finalStatus === 'tombstoned') {
            const { getPostById } = await import('@/lib/services/postReadService');
            const updatedPost = await getPostById(postId, userId);
            return { status: 'tombstoned', updatedPost };
        }
        if (finalStatus === 'deleted') {
            return { status: 'deleted' };
        }

        return null; 

    } catch (error: any) {
        console.error(`Error deleting post ${postId}:`, String(error));
        if (error.message.includes("not authorized") || error.message.includes("not found")) {
            throw error;
        }
        return null;
    }
};

export const findInteractionPost = async (originalPostId: string, interactorId: string, type: 'repost' | 'quote'): Promise<string | null> => {
  if (!originalPostId || !interactorId) return null;

  const q = query(
    postsCollection,
    where('type', '==', type),
    where('userId', '==', interactorId),
    where('originalPostDetails.id', '==', originalPostId),
    firestoreLimit(1)
  );

  try {
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
      return querySnapshot.docs[0].id;
    }
    return null;
  } catch (error) {
    console.error(`Error finding ${type} post:`, error);
    return null;
  }
};
