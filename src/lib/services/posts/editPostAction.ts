// src/lib/services/posts/editPostAction.ts
import { db } from '@/lib/firebase';
import type { Post, ReplyPermission, PostType, EmbeddedUserDetails, Media } from '@/lib/types'; // User might not be needed directly if relying on authorDetails
import {
  ECHO_COMMENT_MAX_LENGTH,
  NEWS_HEADLINE_MAX_LENGTH,
  // NEWS_BODY_MAX_LENGTH // Not directly used in editPost logic here for text length, but could be
} from '@/lib/constants/domain';
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  increment,
  // Timestamp, // Not directly used here
} from 'firebase/firestore';

// Removed deepCopy utils if not directly used in this specific function for return value construction
// They are used in getPostById which is called at the end.
import { 
    extractYoutubeVideoInfo, 
    extractHashtagsFromString,
} from '@/lib/utils/textUtils';
import { tokensDoDocumento } from '@/lib/search/indiceDeTexto';

import { getCurrentUserId } from '@/lib/services/authService';
import { getPostById } from '@/lib/services/postReadService'; 
import { postsCollection } from '@/lib/services/postService'; 

export const editPost = async ( postId: string, newData: Partial<Pick<Post, 'text' | 'headline' | 'sourceUrl' | 'newsCategory' | 'allowReposts' | 'replyPermission' | 'sensitive'>> & { media?: Media[] | null } ): Promise<Post | undefined> => {
  const postRef = doc(postsCollection, postId);
  const postSnap = await getDoc(postRef);
  if (!postSnap.exists()) throw new Error("Post not found.");
  const oldData = postSnap.data() as Post;
  const currentUID = getCurrentUserId();
  if (oldData.userId !== currentUID) throw new Error("Not authorized to edit.");
  if ((oldData.editCount || 0) >= 1 && oldData.category !== 'news') { 
      throw new Error("Post already edited once.");
  }

  const updatePayload: { [key: string]: any } = { isEdited: true, editCount: increment(1), updatedAt: serverTimestamp() };
  let changed = false;

  const setIfDiff = (key: keyof Post, newVal: any, isNullable: boolean = false) => {
    const valueToSet = newVal === undefined && !isNullable ? oldData[key] : (newVal === '' && isNullable) ? null : newVal;
    // Perform a deep comparison for arrays/objects if necessary, for now a simple one
    if (JSON.stringify(valueToSet) !== JSON.stringify(oldData[key])) {
      updatePayload[key] = valueToSet;
      changed = true;
    }
  };

  let newText = newData.text !== undefined ? newData.text : oldData.text;

  if (oldData.category === 'echo') {
      const youtubeInfo = extractYoutubeVideoInfo(newText || '');
      if (youtubeInfo.videoId) {
        updatePayload.youtubeVideoId = youtubeInfo.videoId;
        newText = youtubeInfo.cleanedText || null;
        updatePayload.media = null; // YouTube video overrides other media
      } else {
        updatePayload.youtubeVideoId = null;
      }
      if (newText && newText.length > ECHO_COMMENT_MAX_LENGTH) {
        newText = newText.substring(0, ECHO_COMMENT_MAX_LENGTH);
      }
      // Use the new media data if provided, otherwise stick with the old.
      setIfDiff('media', newData.media !== undefined ? newData.media : oldData.media, true);
  }
  setIfDiff('text', newText, true);


  // News-specific fields
  if (oldData.category === 'news') {
    let newHeadline = newData.headline !== undefined ? newData.headline : oldData.headline;
    if (newHeadline && newHeadline.length > NEWS_HEADLINE_MAX_LENGTH) newHeadline = newHeadline.substring(0, NEWS_HEADLINE_MAX_LENGTH);
    setIfDiff('headline', newHeadline, true);
    setIfDiff('sourceUrl', newData.sourceUrl !== undefined ? newData.sourceUrl : oldData.sourceUrl, true);
    setIfDiff('newsCategory', newData.newsCategory !== undefined ? newData.newsCategory : oldData.newsCategory, true);
  }
  
  // Interaction settings
  setIfDiff('allowReposts', newData.allowReposts !== undefined ? newData.allowReposts : oldData.allowReposts);
  setIfDiff('replyPermission', newData.replyPermission !== undefined ? newData.replyPermission : oldData.replyPermission);
  if (newData.sensitive !== undefined) {
    setIfDiff('sensitive', Boolean(newData.sensitive));
  }
  
  const textContentForHashtags = (newText || '').replace(/<[^>]*>?/gm, ' ');
  const currentHeadlineForHashtags = updatePayload.hasOwnProperty('headline') ? updatePayload.headline : oldData.headline;
  const newHashtags = extractHashtagsFromString(textContentForHashtags + ' ' + (currentHeadlineForHashtags || ''));
  
  const oldHashtags = oldData.hashtags || [];
  // Editou o texto ou o titulo? Os termos da busca sao refeitos junto. Deixar o indice com o texto antigo faria a
  // busca achar o post por uma palavra que ja nao esta nele -- pior do que nao achar.
  updatePayload.searchTokens = tokensDoDocumento({
    titulo: (currentHeadlineForHashtags as string | null | undefined) ?? null,
    texto: newText,
    autorNome: oldData.authorDetails?.name,
    autorHandle: oldData.authorDetails?.username,
    hashtags: newHashtags,
  });
  if (JSON.stringify(newHashtags.sort()) !== JSON.stringify(oldHashtags.sort())) {
      updatePayload.hashtags = newHashtags.length > 0 ? newHashtags : null;
      changed = true;
  }
  
  // Update hasMedia & sensitive flags based on final state of media and youtubeVideoId
  const finalMedia = updatePayload.hasOwnProperty('media') ? updatePayload.media : oldData.media;
  const finalYoutubeVideoId = updatePayload.hasOwnProperty('youtubeVideoId') ? updatePayload.youtubeVideoId : oldData.youtubeVideoId;
  const newHasMedia = !!(finalMedia?.length || finalYoutubeVideoId);
  if(newHasMedia !== oldData.hasMedia) {
      updatePayload.hasMedia = newHasMedia;
      changed = true;
  }
  const hasStoredMedia = Array.isArray(finalMedia) && finalMedia.length > 0;
  const requestedSensitive = newData.sensitive !== undefined ? newData.sensitive : Boolean(oldData.sensitive);
  const nextSensitive = Boolean(requestedSensitive && hasStoredMedia);
  if (nextSensitive !== Boolean(oldData.sensitive)) {
      updatePayload.sensitive = nextSensitive;
      changed = true;
  }

  // If only interaction settings changed, `changed` might be false, but we still need to update.
  if (!changed && (
    (newData.allowReposts !== undefined && newData.allowReposts !== oldData.allowReposts) ||
    (newData.replyPermission !== undefined && newData.replyPermission !== oldData.replyPermission)
  )) {
    changed = true;
  }


  try {
    if (changed) {
        await updateDoc(postRef, updatePayload);
    } else {
        // If no content changed, we might not need to update `isEdited` unless policy demands it.
        // For simplicity, if the dialog was opened and "Save" was clicked, we assume an edit was intended.
        await updateDoc(postRef, { updatedAt: serverTimestamp(), isEdited: true, editCount: increment(1) });
    }
    return getPostById(postId, currentUID); 
  } catch (e: any) { console.error("Error editing post:", String(e)); throw e; }
};
