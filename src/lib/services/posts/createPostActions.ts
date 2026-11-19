
// src/lib/services/posts/createPostActions.ts
import { db, runTransaction } from '@/lib/firebase';
import type { Post, User, Comment, OriginalPostDetails, ReplyPermission, PostType, EmbeddedUserDetails, Media, PostLocation, PollDraft } from '@/lib/types';
import {
  ECHO_COMMENT_MAX_LENGTH,
  NEWS_HEADLINE_MAX_LENGTH,
  NEWS_BODY_MAX_LENGTH
} from '@/lib/constants/domain';
import {
  doc,
  updateDoc,
  serverTimestamp,
  addDoc,
  increment,
  getDoc,
  writeBatch,
} from 'firebase/firestore';
import {
    deepCopyPost,
    deepCopyOriginalPostDetails
} from '@/lib/utils/dataTransformers';
import {
    extractYoutubeVideoInfo,
    extractHashtagsFromString,
} from '@/lib/utils/textUtils';
import { tokensDoDocumento } from '@/lib/search/indiceDeTexto';
import { getUser } from '@/lib/services/userService';
import { getPostById } from '@/lib/services/postReadService';
import { postsCollection } from '@/lib/services/postService';
import { postVisibilityFor } from './visibility';
import { markViewerAction } from '@/lib/services/viewerActions';
import { removeUndefinedDeep } from '@/lib/utils/firestoreData';
import { buildPoll } from '@/lib/poll';



const createEmbeddedUserDetails = (user: User): EmbeddedUserDetails => {
  let avatarToEmbed = user.avatarUrl;
  if (user.avatarUrl && user.avatarUrl.startsWith('data:image')) {
    console.warn(`[EmbedWarning] User ${user.id} has base64 avatar in createPostActions. Using placeholder for embedding.`);
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

export const createPost = async (data: {
  userId: string;
  text?: string;
  media?: Media[] | null; // Changed to accept media array
  allowReposts: boolean;
  replyPermission: ReplyPermission;
  category?: 'echo' | 'news';
  headline?: string;
  sourceUrl?: string;
  newsCategory?: string;
  postFormat?: 'standard' | 'short_video';
  quotedPostObject?: Post | null;
  youtubeVideoId?: string; // Can still come from text parsing
  location?: PostLocation | null;
  sensitive?: boolean;
  poll?: PollDraft | null;
  /** Alcance no Fediverso. Omitido ou 'local' = o post fica só aqui (o padrão). Enquete e citação nunca federam. */
  federation?: 'local' | 'public' | 'unlisted' | 'followers';
}): Promise<Post | undefined> => {
  const author = await getUser(data.userId, data.userId);
  if (!author) throw new Error('User not found for creating post.');

  const authorDetailsToEmbed = createEmbeddedUserDetails(author);

  let textForPost = data.text;
  let headlineForPost = data.headline;
  let detectedYoutubeVideoId = data.youtubeVideoId;
  let finalMedia = data.media;

  // Youtube link in text overrides any attached media
  if (data.text) {
    const youtubeInfo = extractYoutubeVideoInfo(data.text);
    if (youtubeInfo.videoId) {
      detectedYoutubeVideoId = youtubeInfo.videoId;
      textForPost = youtubeInfo.cleanedText || '';
      finalMedia = []; // Clear media if a YT link is present
    }
  }

  if (finalMedia && finalMedia.length > 0) {
    detectedYoutubeVideoId = undefined; // Can't have both
  }
  if (data.quotedPostObject) {
    finalMedia = [];
    detectedYoutubeVideoId = undefined;
  }

  if (data.poll && ((finalMedia?.length ?? 0) > 0 || !!detectedYoutubeVideoId)) {
    throw new Error('Uma enquete não pode ser publicada junto com imagem ou vídeo.');
  }

  const builtPoll = data.poll ? buildPoll(data.poll, Date.now()) : null;
  
  const finalPostFormat = detectedYoutubeVideoId ? 'short_video' : 'standard';

  if (data.category === 'echo' && textForPost && textForPost.length > ECHO_COMMENT_MAX_LENGTH) textForPost = textForPost.substring(0, ECHO_COMMENT_MAX_LENGTH);
  if (data.category === 'news') {
    if (headlineForPost && headlineForPost.length > NEWS_HEADLINE_MAX_LENGTH) headlineForPost = headlineForPost.substring(0, NEWS_HEADLINE_MAX_LENGTH);
    if (textForPost && textForPost.length > NEWS_BODY_MAX_LENGTH) textForPost = textForPost.substring(0, NEWS_BODY_MAX_LENGTH);
  }

  const hashtags = extractHashtagsFromString((textForPost || '') + ' ' + (headlineForPost || ''));

  let originalPostDetailsToEmbed: OriginalPostDetails | null = null;
  if (data.quotedPostObject) {
    const op = data.quotedPostObject;
    originalPostDetailsToEmbed = {
      id: op.id,
      authorDetails: op.authorDetails || createEmbeddedUserDetails(op.user!),
      type: op.type,
      text: op.text || null,
      media: op.media,
      youtubeVideoId: op.youtubeVideoId || null,
      createdAt: op.createdAt,
      allowReposts: op.allowReposts,
      replyPermission: op.replyPermission,
      visibility: op.visibility,
      category: op.category,
      headline: op.headline || null,
      sourceUrl: op.sourceUrl || null,
      newsCategory: op.newsCategory || null,
      views: op.views || 0,
      postFormat: op.postFormat || 'standard',
      isEdited: op.isEdited || false,
      editCount: op.editCount || 0,
      hasMedia: op.hasMedia || false,
    } as OriginalPostDetails;
  }


  const postObjectForFirestore: any = {
    userId: data.userId,
    authorDetails: authorDetailsToEmbed,
    type: data.quotedPostObject ? 'quote' : 'original' as PostType,
    originalPostDetails: originalPostDetailsToEmbed,
    allowReposts: data.allowReposts,
    replyPermission: data.replyPermission,
    visibility: postVisibilityFor(author),
    category: data.category || 'echo',
    likes: 0,
    reposts: 0,
    quotesCount: 0,
    commentsCount: 0,
    createdAt: serverTimestamp(),
    postFormat: finalPostFormat,
    views: 0,
    isEdited: false,
    editCount: 0,
    isDeleted: false, // Ensure this is always set
    isLikedBy: {}, // For Firestore document structure
    hashtags: hashtags.length > 0 ? hashtags : null,
    // Termos para a BUSCA alcancar este post pelo banco, e nao so dentro da janela dos mais recentes. Sem isto a
    // busca por palavra so enxerga as ultimas horas da rede. Ver src/lib/search/indiceDeTexto.ts.
    searchTokens: tokensDoDocumento({
      titulo: headlineForPost,
      texto: textForPost,
      autorNome: authorDetailsToEmbed?.name,
      autorHandle: authorDetailsToEmbed?.username,
      hashtags,
    }),
    text: (textForPost && textForPost.trim() !== '') ? textForPost : null,
    youtubeVideoId: detectedYoutubeVideoId || null,
    media: finalMedia || null,
    hasMedia: !!(finalMedia && finalMedia.length > 0) || !!detectedYoutubeVideoId,
    headline: headlineForPost || null,
    sourceUrl: data.sourceUrl || null,
    newsCategory: data.newsCategory || null,
    location: data.location || null,
    sensitive: Boolean(data.sensitive && finalMedia && finalMedia.length > 0),
    poll: builtPoll?.poll || null,
    pollOptionIds: builtPoll?.pollOptionIds || null,
    pollCounts: builtPoll?.pollCounts || null,
    pollTotal: builtPoll?.pollTotal || 0,
    // Só grava o campo quando o post vai para o Fediverso: posts locais continuam idênticos aos de sempre.
    ...(data.federation && data.federation !== 'local' && !builtPoll
      ? { federation: data.federation }
      : {}),
  };
  
  if (data.category === 'news' && !postObjectForFirestore.headline) {
    throw new Error("Headline is required for news posts.");
  }
  
  // Sanitize the object to remove any 'undefined' values before sending to Firestore
  const sanitizedPostObject = removeUndefinedDeep(postObjectForFirestore);


  try {
    // postsCount do autor e quotesCount do post citado são gravados pela Function onPostCreated.
    const newPostRef = await addDoc(postsCollection, sanitizedPostObject);

    const optimisticTimestamp = new Date().toISOString();
    return deepCopyPost({
        id: newPostRef.id,
        ...sanitizedPostObject,
        createdAt: optimisticTimestamp,
        user: author,
        comments: [],
        isLiked: false,
    } as Post);
  } catch (error: any) { console.error("Error creating post:", String(error)); throw error; }
};

const createQuoteInteraction = async ( type: 'quote', originalPostId: string, actorId: string, interactionData: { text?: string; media?: Media[]; allowReposts?: boolean; replyPermission?: ReplyPermission; quotedPostObject?: Post | null; federation?: 'local' | 'public' | 'unlisted' | 'followers'; location?: Post['location']; sensitive?: boolean; } ): Promise<{ newPost: Post; updatedOriginalPost: Post } | undefined> => {
    const actorUser = await getUser(actorId, actorId);
    if (!actorUser) throw new Error("Actor not found.");
    const actorDetailsToEmbed = createEmbeddedUserDetails(actorUser);

    let updatedOriginalPost: Post | undefined;
    const isInternalPost = !originalPostId.startsWith('http');

    if (isInternalPost) {
        // O contador quotesCount do post citado é gravado pela Function onPostCreated; aqui só se confere a permissão.
        const snap = await getDoc(doc(postsCollection, originalPostId));
        if (!snap.exists()) throw new Error('Original post not found.');
        const data = snap.data() as Post;
        if (data.allowReposts === false && data.userId !== actorId) {
            throw new Error('Interactions not allowed for this post.');
        }
        // Post só para seguidores não é citado por OUTRA pessoa: a citação levaria o conteúdo para fora do círculo do
        // autor. O próprio autor cita o que é dele (a citação nasce com a visibilidade do perfil dele e não sai do
        // círculo) — antes a conta privada não conseguia citar o próprio post.
        if (data.isDeleted) throw new Error('Interactions not allowed for this post.');
        if ((data.visibility ?? 'public') !== 'public' && data.userId !== actorId) {
            throw new Error('Interactions not allowed for this post.');
        }
    }
    
    // Always fetch the original post details to embed.
    // If it's external, this will use the preview API via getPostById logic.
    updatedOriginalPost = await getPostById(originalPostId, actorId);
    if (!updatedOriginalPost) throw new Error('Failed to get original post details for embedding.');


    const originalPostAuthor = await getUser(updatedOriginalPost.userId, actorId);
    if (!originalPostAuthor) {
        throw new Error("Original post author details missing for embedding.");
    }
    const opAuthorForEmbedding = createEmbeddedUserDetails(originalPostAuthor);


    let detailsToEmbed: OriginalPostDetails = {
        id: updatedOriginalPost.id,
        authorDetails: opAuthorForEmbedding,
        type: updatedOriginalPost.type,
        originalPostDetails: updatedOriginalPost.originalPostDetails || null,
        text: updatedOriginalPost.text || null,
        media: updatedOriginalPost.media,
        youtubeVideoId: updatedOriginalPost.youtubeVideoId || null,
        createdAt: updatedOriginalPost.createdAt,
        allowReposts: updatedOriginalPost.allowReposts,
        replyPermission: updatedOriginalPost.replyPermission,
        visibility: updatedOriginalPost.visibility,
        category: updatedOriginalPost.category,
        headline: updatedOriginalPost.headline || null,
        sourceUrl: updatedOriginalPost.sourceUrl || null,
        newsCategory: updatedOriginalPost.newsCategory || null,
        views: updatedOriginalPost.views || 0,
        postFormat: updatedOriginalPost.postFormat || 'standard',
        isEdited: updatedOriginalPost.isEdited || false,
        editCount: updatedOriginalPost.editCount || 0,
        hasMedia: updatedOriginalPost.hasMedia || false,
        sensitive: updatedOriginalPost.sensitive === true,
    };

    if (interactionData.quotedPostObject) {
       const op = interactionData.quotedPostObject;
        detailsToEmbed = {
          id: op.id,
          authorDetails: op.authorDetails || createEmbeddedUserDetails(op.user!),
          type: op.type,
          text: op.text || null,
          media: op.media,
          youtubeVideoId: op.youtubeVideoId || null,
          createdAt: op.createdAt,
          allowReposts: op.allowReposts,
          replyPermission: op.replyPermission,
          visibility: op.visibility,
          category: op.category,
          headline: op.headline || null,
          sensitive: op.sensitive === true,
        } as OriginalPostDetails;
    }

    const embeddedDetails: OriginalPostDetails = deepCopyOriginalPostDetails(detailsToEmbed)!;

    let newText = interactionData.text, newMedia = interactionData.media, newYTId: string | undefined, newFormat = 'standard';
    if (type === 'quote' && newText) {
        const yt = extractYoutubeVideoInfo(newText);
        if (yt.videoId) { newYTId = yt.videoId; newText = yt.cleanedText || ''; newMedia = undefined; newFormat = 'short_video'; }
    }
    if (newMedia && newMedia.length > 0) { newYTId = undefined; }

    const hashtags = extractHashtagsFromString(newText || '');

    const newPostFirestoreData: any = {
        userId: actorId,
        authorDetails: actorDetailsToEmbed,
        type,
        originalPostDetails: embeddedDetails,
        likes: 0, reposts: 0, quotesCount: 0, commentsCount: 0,
        createdAt: serverTimestamp(),
        allowReposts: interactionData.allowReposts !== undefined ? interactionData.allowReposts : true,
        replyPermission: interactionData.replyPermission || 'everyone',
        visibility: postVisibilityFor(actorUser),
        federation: interactionData.federation ?? 'local',
        location: interactionData.location || null,
        sensitive: Boolean(interactionData.sensitive && newMedia && newMedia.length > 0),
        category: 'echo', // A quote or repost is always an 'echo'
        isLikedBy: {},
        isEdited: false,
        editCount: 0,
        isDeleted: false,
        views: 0,
        postFormat: newFormat,
        hashtags: hashtags.length > 0 ? hashtags : null,
        text: null, media: null, youtubeVideoId: null, headline: null, sourceUrl: null, newsCategory: null,
        hasMedia: !!(newMedia && newMedia.length > 0) || !!newYTId,
    };

    if (type === 'quote') {
        if (newText && newText.trim() !== '') newPostFirestoreData.text = newText.substring(0, ECHO_COMMENT_MAX_LENGTH);
        if (newYTId) newPostFirestoreData.youtubeVideoId = newYTId;
        if (newMedia && newMedia.length > 0) newPostFirestoreData.media = newMedia;
    }
    
    // Sanitize before sending
    const sanitizedPostObject = removeUndefinedDeep(newPostFirestoreData);

    try {
        // postsCount do autor: Function onPostCreated.
        const newPostRef = await addDoc(postsCollection, sanitizedPostObject);
        if (isInternalPost) markViewerAction(actorId, 'quote', originalPostId, true);

        const optimisticTimestamp = new Date().toISOString();
        const newPostForClient = deepCopyPost({
            ...sanitizedPostObject,
            id: newPostRef.id,
            createdAt: optimisticTimestamp,
            user: actorUser,
            comments: [],
            isLiked: false,
        } as Post)!;

        return { newPost: newPostForClient, updatedOriginalPost: updatedOriginalPost! };
    } catch (e: any) { console.error(`create ${type}:`, String(e)); throw e; }
};


export const quotePost = async ( originalPostId: string, quoterId: string, quoteText: string, options?: { media?: Media[]; allowReposts?: boolean; replyPermission?: ReplyPermission; quotedPostObject?: Post | null; federation?: 'local' | 'public' | 'unlisted' | 'followers'; location?: Post['location']; sensitive?: boolean; } ): Promise<{ newPost: Post; updatedOriginalPost: Post } | undefined> => {
    if (!quoterId) throw new Error("Quoter ID is required.");
    if (!quoteText && (!options?.media || options.media.length === 0) && !options?.quotedPostObject) throw new Error("Quote must have text, media, or a quoted post.");
    return createQuoteInteraction('quote', originalPostId, quoterId, {
        text: quoteText,
        media: options?.media,
        allowReposts: options?.allowReposts,
        replyPermission: options?.replyPermission,
        quotedPostObject: options?.quotedPostObject,
        federation: options?.federation,
        location: options?.location,
        sensitive: options?.sensitive,
    });
};

export const quoteComment = async (
  originalCommentId: string,
  parentPostId: string,
  quoterId: string,
  quoteText: string,
  options?: {
    media?: Media[];
    allowReposts?: boolean;
    replyPermission?: ReplyPermission;
    federation?: 'local' | 'public' | 'unlisted' | 'followers';
    location?: Post['location'];
    sensitive?: boolean;
  }
): Promise<Post | undefined> => {
  if (!quoterId) throw new Error("Quoter ID is required.");
  if (!quoteText && (!options?.media || options.media.length === 0)) throw new Error("Quote must have text or media.");

  const quoterUser = await getUser(quoterId, quoterId);
  if (!quoterUser) throw new Error("Quoter user not found.");

  const quoterDetailsToEmbed = createEmbeddedUserDetails(quoterUser);

  // repostsCount do comentário citado e postsCount do autor são gravados pela Function onPostCreated.
  const commentRef = doc(db, 'posts', parentPostId, 'comments', originalCommentId);
  const commentSnap = await getDoc(commentRef);
  if (!commentSnap.exists()) {
    throw new Error("Original comment not found.");
  }
  // Comentário de post público, ou de um post do próprio autor, e não apagado (as regras também conferem).
  const quotedCommentData = commentSnap.data();
  if (quotedCommentData.isDeleted) throw new Error('Interactions not allowed for this comment.');
  if ((quotedCommentData.postVisibility ?? 'public') !== 'public' && quotedCommentData.postAuthorId !== quoterId) {
    throw new Error('Interactions not allowed for this comment.');
  }

  // Prepare the new post object
  let newText = quoteText, newMedia = options?.media, newYTId: string | undefined, newFormat = 'standard';
  if (newText) {
      const yt = extractYoutubeVideoInfo(newText);
      if (yt.videoId) { newYTId = yt.videoId; newText = yt.cleanedText || ''; newMedia = undefined; newFormat = 'short_video'; }
  }
  if (newMedia && newMedia.length > 0) { newYTId = undefined; }

  const hashtags = extractHashtagsFromString(newText || '');

  const newPostFirestoreData: any = {
      userId: quoterId,
      authorDetails: quoterDetailsToEmbed,
      type: 'quote',
      quotedCommentId: `${parentPostId}/${originalCommentId}`, // Store composite ID
      likes: 0,
      reposts: 0,
      quotesCount: 0,
      commentsCount: 0,
      createdAt: serverTimestamp(),
      allowReposts: options?.allowReposts !== undefined ? options.allowReposts : true,
      replyPermission: options?.replyPermission || 'everyone',
      visibility: postVisibilityFor(quoterUser),
      federation: options?.federation ?? 'local',
      location: options?.location || null,
      sensitive: Boolean(options?.sensitive && newMedia && newMedia.length > 0),
      category: 'echo',
      isLikedBy: {},
      isEdited: false,
      editCount: 0,
      isDeleted: false,
      views: 0,
      postFormat: newFormat,
      hashtags: hashtags.length > 0 ? hashtags : null,
      text: null, media: null, youtubeVideoId: null,
      hasMedia: !!(newMedia && newMedia.length > 0) || !!newYTId,
  };

  if (newText && newText.trim() !== '') newPostFirestoreData.text = newText.substring(0, ECHO_COMMENT_MAX_LENGTH);
  if (newYTId) newPostFirestoreData.youtubeVideoId = newYTId;
  if (newMedia && newMedia.length > 0) newPostFirestoreData.media = newMedia.map(m => ({ url: m.url, type: m.type, alt: m.alt || '' }));
  
  // Sanitize before sending
  const sanitizedPostObject = removeUndefinedDeep(newPostFirestoreData);

  try {
      const newPostRef = await addDoc(postsCollection, sanitizedPostObject);
      markViewerAction(quoterId, 'quote', `${parentPostId}/${originalCommentId}`, true);

      const newPostForClient = await getPostById(newPostRef.id, quoterId);
      if (!newPostForClient) {
          throw new Error("Could not retrieve the newly created post.");
      }

      return newPostForClient;
  } catch (e: any) {
      console.error(`Error creating comment quote:`, String(e));
      throw e;
  }
};
