
// src/lib/services/conversationService.ts
import { db, storage, auth } from '../firebase'; // Import storage
import type { Conversation, DirectMessage, E2eeMessagePayload, User, NotificationType } from '../types';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  serverTimestamp,
  Timestamp,
  orderBy,
  limit as firestoreLimit,
  addDoc,
  FieldValue,
  arrayRemove,
  FirestoreError,
  writeBatch,
  arrayUnion,
  deleteDoc,
  setDoc,
  runTransaction,
} from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid'; // For unique file names

import { deepCopyConversation, deepCopyDirectMessage, deepCopyUser } from '../utils/dataTransformers';
import { getUser } from './userService';
import { getCurrentUserId } from './authService';
import { getPostById } from './postReadService';

export const conversationsCollection = collection(db, 'conversations');

export const firestoreToConversation = async (convId: string, convDataFromDb: any, activeUserId: string | null): Promise<Conversation | null> => {
    const participantsInfoPromises = (convDataFromDb.participantIds || []).map(async (pid: string) => {
        return await getUser(pid, activeUserId);
    });
    const participantsInfo = (await Promise.all(participantsInfoPromises)).filter(p => p !== null) as User[];
    if (participantsInfo.length < convDataFromDb.participantIds.length) {
      console.warn(`Conversation ${convId} has missing participant details.`);
    }

    let lastMessageForClient: DirectMessage | undefined | null = undefined;
    if (convDataFromDb.lastMessageId && convDataFromDb.lastMessageSenderId) {
        const sender = participantsInfo.find(p => p.id === convDataFromDb.lastMessageSenderId);
        if(sender) {
             lastMessageForClient = {
                id: convDataFromDb.lastMessageId,
                conversationId: convId,
                senderId: convDataFromDb.lastMessageSenderId,
                sender: sender,
                text: convDataFromDb.lastMessageText || '',
                createdAt: (convDataFromDb.lastMessageAt as Timestamp).toDate().toISOString(),
                parentMessageId: convDataFromDb.parentMessageId,
                parentMessageText: convDataFromDb.parentMessageText,
                parentMessageSenderName: convDataFromDb.parentMessageSenderName,
            }
        }
    } else {
        // Fallback: If last message details are missing, fetch the actual last message
        const messagesQuery = query(collection(db, 'conversations', convId, 'messages'), orderBy('createdAt', 'desc'), firestoreLimit(1));
        const lastMessageSnap = await getDocs(messagesQuery);
        if (!lastMessageSnap.empty) {
            const lastMessageDoc = lastMessageSnap.docs[0];
            const lastMessageData = lastMessageDoc.data();
            const sender = participantsInfo.find(p => p.id === lastMessageData.senderId);
            if (sender) {
                lastMessageForClient = {
                    id: lastMessageDoc.id,
                    conversationId: convId,
                    senderId: lastMessageData.senderId,
                    sender: sender,
                    text: lastMessageData.text || '',
                    e2ee: lastMessageData.e2ee || undefined,
                    createdAt: (lastMessageData.createdAt as Timestamp).toDate().toISOString(),
                    parentMessageId: lastMessageData.parentMessageId,
                    parentMessageText: lastMessageData.parentMessageText,
                    parentMessageSenderName: lastMessageData.parentMessageSenderName,
                };
            }
        }
    }

    const conversationToReturn: Conversation = {
        id: convId,
        participantIds: convDataFromDb.participantIds,
        participantsInfo,
        lastMessage: lastMessageForClient || null,
        unreadCounts: convDataFromDb.unreadCounts || {},
        createdAt: (convDataFromDb.createdAt as Timestamp)?.toDate().toISOString() || new Date().toISOString(),
        lastMessageAt: (convDataFromDb.lastMessageAt as Timestamp)?.toDate().toISOString() || new Date().toISOString(),
        userLeftAt: convDataFromDb.userLeftAt || {},
        isSelf: Boolean(convDataFromDb.isSelf) || (Array.isArray(convDataFromDb.participantIds) && convDataFromDb.participantIds.length === 1 && !convDataFromDb.isGroup),
        isGroup: Boolean(convDataFromDb.isGroup),
        groupName: convDataFromDb.groupName || null,
        groupAvatarUrl: convDataFromDb.groupAvatarUrl || null,
        adminIds: Array.isArray(convDataFromDb.adminIds) ? convDataFromDb.adminIds : [],
        createdBy: convDataFromDb.createdBy,
    };
    return deepCopyConversation(conversationToReturn);
};

export const getConversationById = async (
  conversationId: string,
  activeUserId: string | null
): Promise<Conversation | null> => {
  if (!conversationId || !activeUserId) return null;
  const conversationRef = doc(conversationsCollection, conversationId);
  const docSnap = await getDoc(conversationRef);
  if (!docSnap.exists()) return null;
  const convData = docSnap.data();
  if (!Array.isArray(convData.participantIds) || !convData.participantIds.includes(activeUserId)) {
    return null;
  }
  return firestoreToConversation(docSnap.id, convData, activeUserId);
};

export const createGroupConversation = async (
  creatorId: string,
  selectedUserIds: string[],
  groupName: string
): Promise<Conversation> => {
  const activeUserId = getCurrentUserId();
  if (!activeUserId || activeUserId !== creatorId) {
    throw new Error("O usuário deve estar logado para criar um grupo.");
  }

  const trimmedName = groupName.trim();
  if (!trimmedName || trimmedName.length > 80) {
    throw new Error("Informe um nome válido para o grupo (1 a 80 caracteres).");
  }

  const participantIds = Array.from(new Set([creatorId, ...selectedUserIds.filter(Boolean)]));
  if (participantIds.length < 2) {
    throw new Error("Selecione pelo menos um participante além de você.");
  }
  if (participantIds.length > 1000) {
    throw new Error("O grupo pode ter no máximo 1000 participantes.");
  }

  const conversationId = `grp_${uuidv4().replace(/-/g, '').slice(0, 20)}`;
  const conversationRef = doc(conversationsCollection, conversationId);

  const unreadCounts: Record<string, number> = {};
  for (const pid of participantIds) {
    unreadCounts[pid] = 0;
  }

  const newGroupData = {
    isGroup: true,
    groupName: trimmedName,
    groupAvatarUrl: null,
    participantIds,
    adminIds: [creatorId],
    createdBy: creatorId,
    createdAt: serverTimestamp(),
    lastMessageAt: serverTimestamp(),
    lastMessageId: null,
    lastMessageText: null,
    lastMessageSenderId: null,
    unreadCounts,
    userLeftAt: {},
  };

  await setDoc(conversationRef, newGroupData);
  const created = await firestoreToConversation(
    conversationId,
    { ...newGroupData, createdAt: Timestamp.now(), lastMessageAt: Timestamp.now() },
    activeUserId
  );
  if (!created) {
    throw new Error("Não foi possível carregar o grupo recém-criado.");
  }
  return created;
};

const assertGroupAdmin = async (conversationId: string, actorUserId: string) => {
  const activeUserId = getCurrentUserId();
  if (!activeUserId || activeUserId !== actorUserId) {
    throw new Error("O usuário deve estar logado para gerenciar o grupo.");
  }
  const conversationRef = doc(conversationsCollection, conversationId);
  const snap = await getDoc(conversationRef);
  if (!snap.exists()) {
    throw new Error("Grupo não encontrado.");
  }
  const data = snap.data();
  if (!data.isGroup) {
    throw new Error("Esta conversa não é um grupo.");
  }
  const adminIds: string[] = Array.isArray(data.adminIds) ? data.adminIds : [];
  if (!adminIds.includes(actorUserId)) {
    throw new Error("Apenas administradores podem gerenciar este grupo.");
  }
  return { conversationRef, data, adminIds };
};

export const addGroupParticipants = async (
  conversationId: string,
  actorUserId: string,
  userIdsToAdd: string[]
): Promise<void> => {
  const { conversationRef, data } = await assertGroupAdmin(conversationId, actorUserId);
  const currentIds: string[] = Array.isArray(data.participantIds) ? data.participantIds : [];
  const nextIds = Array.from(new Set([...currentIds, ...userIdsToAdd.filter(Boolean)]));
  if (nextIds.length > 1000) {
    throw new Error("O grupo pode ter no máximo 1000 participantes.");
  }
  await updateDoc(conversationRef, { participantIds: nextIds });
};

export const removeGroupParticipant = async (
  conversationId: string,
  actorUserId: string,
  targetUserId: string
): Promise<void> => {
  const { conversationRef, data, adminIds } = await assertGroupAdmin(conversationId, actorUserId);
  if (data.createdBy && targetUserId === data.createdBy && actorUserId !== data.createdBy) {
    throw new Error("Não é possível remover quem criou o grupo.");
  }
  const currentIds: string[] = Array.isArray(data.participantIds) ? data.participantIds : [];
  const nextIds = currentIds.filter((id) => id !== targetUserId);
  if (nextIds.length < 1) {
    throw new Error("O grupo precisa ter pelo menos 1 participante.");
  }
  const nextAdmins = adminIds.filter((id) => id !== targetUserId);
  if (nextAdmins.length < 1) {
    nextAdmins.push(nextIds[0]);
  }
  await updateDoc(conversationRef, {
    participantIds: nextIds,
    adminIds: nextAdmins,
  });
};

export const setGroupParticipantAdmin = async (
  conversationId: string,
  actorUserId: string,
  targetUserId: string,
  makeAdmin: boolean
): Promise<void> => {
  const { conversationRef, data, adminIds } = await assertGroupAdmin(conversationId, actorUserId);
  const currentIds: string[] = Array.isArray(data.participantIds) ? data.participantIds : [];
  if (!currentIds.includes(targetUserId)) {
    throw new Error("Este usuário não participa do grupo.");
  }
  if (!makeAdmin && data.createdBy && targetUserId === data.createdBy && actorUserId !== data.createdBy) {
    throw new Error("Não é possível remover o admin de quem criou o grupo.");
  }
  const nextAdmins = makeAdmin
    ? Array.from(new Set([...adminIds, targetUserId]))
    : adminIds.filter((id) => id !== targetUserId);
  if (nextAdmins.length < 1) {
    throw new Error("O grupo precisa ter pelo menos um administrador.");
  }
  await updateDoc(conversationRef, { adminIds: nextAdmins });
};

export const updateGroupName = async (
  conversationId: string,
  actorUserId: string,
  newName: string
): Promise<void> => {
  const { conversationRef } = await assertGroupAdmin(conversationId, actorUserId);
  const trimmed = newName.trim();
  if (!trimmed || trimmed.length > 80) {
    throw new Error("Informe um nome válido para o grupo (1 a 80 caracteres).");
  }
  await updateDoc(conversationRef, { groupName: trimmed });
};

export const getOrCreateConversation = async (userId1: string, userId2: string): Promise<Conversation | null> => {
    const activeUserId = getCurrentUserId();
    if (!activeUserId) throw new Error("O usuário deve estar logado.");

    const isSelf = userId1 === userId2;
    if (isSelf && userId1 !== activeUserId) {
      throw new Error("Você não pode abrir uma conversa privada de outro usuário.");
    }

    const sortedParticipants = isSelf ? [userId1] : [userId1, userId2].sort();
    const conversationId = isSelf ? `${userId1}_${userId1}` : sortedParticipants.join('_'); // Deterministic ID
    const conversationRef = doc(conversationsCollection, conversationId);

    try {
        const docSnap = await getDoc(conversationRef);

        if (docSnap.exists()) {
            const convData = docSnap.data();
            // If the active user had previously left, we clear their 'left' status
            // so they can see the full history again upon re-engaging.
            if (convData.userLeftAt && convData.userLeftAt[activeUserId]) {
                const newLeftAt = { ...convData.userLeftAt };
                delete newLeftAt[activeUserId];
                await updateDoc(conversationRef, { userLeftAt: newLeftAt });
            }
            return firestoreToConversation(docSnap.id, docSnap.data(), activeUserId);
        }

        // --- If no conversation exists, create a new one ---
        const user1Details = await getUser(userId1, activeUserId);
        const user2Details = isSelf ? user1Details : await getUser(userId2, activeUserId);
        if (!user1Details || !user2Details) throw new Error("Usuário não encontrado.");

        if (!isSelf) {
          // Check for blocks and DM preferences
          if (user2Details.hasBlockedCurrentUser || user1Details.hasBlockedCurrentUser) {
              console.warn(`Cannot create conversation. Interaction blocked.`);
              throw new Error("Você não pode enviar mensagens para este usuário.");
          }

          const targetUser = activeUserId === userId1 ? user2Details : user1Details;
          if (!targetUser.id.startsWith('ap_')) {
            if (targetUser.dmPreference === 'none') {
                 console.warn(`Cannot create conversation with @${targetUser.username}. DM preferences restrict messages.`);
                 throw new Error(`@${targetUser.username} não está aceitando novas mensagens.`);
            }
            if (targetUser.dmPreference === 'followed') {
                // "Pessoas que você segue": o dono do perfil só recebe mensagens novas de quem ELE segue, isto é,
                // users/{alvo}/following/{eu} precisa existir (as regras do Firestore conferem o mesmo). Antes se
                // olhava users/{alvo}/followers/{eu}, o sentido contrário: liberava quem segue o alvo e barrava quem
                // o alvo segue.
                const targetFollowsActive = await getDoc(doc(db, 'users', targetUser.id, 'following', activeUserId));
                if (!targetFollowsActive.exists()) {
                     console.warn(`Cannot create conversation with @${targetUser.username}. DM preferences restrict messages to people they follow.`);
                     throw new Error(`Você deve ser seguido por @${targetUser.username} para enviar uma mensagem.`);
                }
            }
          }
        }

        const newConvParticipantsInfo = isSelf
            ? [user1Details]
            : [user1Details, user2Details].sort((a,b) => a.id.localeCompare(b.id));

        const newConvDataForFirestore = {
            participantIds: sortedParticipants,
            isSelf,
            isGroup: false,
            // Quem iniciou: a Function que notifica a nova conversa não tem como saber (a lista é ordenada por id).
            createdBy: activeUserId,
            participantsInfo: newConvParticipantsInfo.map(u => ({
                id: u.id,
                name: u.name,
                username: u.username,
                avatarUrl: u.avatarUrl || '',
                "data-ai-hint": u["data-ai-hint"]
            })),
            createdAt: serverTimestamp(),
            lastMessageAt: serverTimestamp(),
            lastMessageId: null,
            lastMessageText: null,
            lastMessageSenderId: null,
            unreadCounts: isSelf ? { [userId1]: 0 } : { [userId1]: 0, [userId2]: 0 },
            userLeftAt: {},
        };
        await setDoc(conversationRef, newConvDataForFirestore);

        const createdConv: Conversation = {
            id: conversationId,
            participantIds: sortedParticipants,
            participantsInfo: newConvParticipantsInfo,
            createdAt: new Date().toISOString(),
            lastMessageAt: new Date().toISOString(),
            lastMessage: null,
            unreadCounts: { [userId1]: 0, [userId2]: 0 },
            userLeftAt: {},
        };
        return deepCopyConversation(createdConv);

    } catch (error: any) {
        console.error("Error in getOrCreateConversation:", String(error));
        throw error;
    }
};

export const getUserConversations = async (userId: string): Promise<Conversation[]> => {
    if (!userId) return [];
    const q = query(conversationsCollection, where('participantIds', 'array-contains', userId), orderBy('lastMessageAt', 'desc'));

    try {
        const querySnapshot = await getDocs(q);
        if (querySnapshot.empty) return [];

        const userConvosPromises = querySnapshot.docs.map(docSnap =>
            firestoreToConversation(docSnap.id, docSnap.data(), userId)
        );
        const userConvos = (await Promise.all(userConvosPromises)).filter(c => c !== null) as Conversation[];
        return userConvos;
    } catch (error: any) {
        console.error("Error fetching user conversations:", String(error));
        return [];
    }
};

export const markConversationAsRead = async (conversationId: string, userId: string): Promise<void> => {
  if (!conversationId || !userId) return;
  
  const conversationRef = doc(db, 'conversations', conversationId);
  try {
      const fieldToUpdate = `unreadCounts.${userId}`;
      await updateDoc(conversationRef, { [fieldToUpdate]: 0 });
  } catch (error) {
      console.error(`Error marking conversation ${conversationId} as read for user ${userId}:`, error);
  }
};


export const sendDirectMessage = async (
  conversationId: string,
  senderId: string,
  data: { 
    text?: string; 
    e2ee?: E2eeMessagePayload | null;
    fileUrl?: string; 
    fileType?: DirectMessage['fileType'], 
    sharedPostId?: string,
    parentMessageId?: string;
    parentMessageText?: string;
    parentMessageSenderName?: string;
  }
): Promise<DirectMessage | null> => {
    if (!senderId) {
        console.error("Error: senderId is required to send a message.");
        return null;
    }
    if (!data.text?.trim() && !data.fileUrl && !data.sharedPostId && !data.e2ee) {
        console.error("Error: Message must have text, a file, or a shared post.");
        return null;
    }

    try {
        const conversationRef = doc(db, 'conversations', conversationId);
        const conversationSnap = await getDoc(conversationRef);

        if (!conversationSnap.exists()) {
            throw new Error("Conversa não encontrada.");
        }

        const conversationData = conversationSnap.data();
        const participantIds = conversationData.participantIds || [];

        if (!participantIds.includes(senderId)) {
            throw new FirestoreError('permission-denied', 'O remetente não é um participante desta conversa.');
        }

        const messagesColRef = collection(db, 'conversations', conversationId, 'messages');
        const newMessageRef = await addDoc(messagesColRef, {
            senderId,
            text: data.e2ee ? null : (data.text || null),
            e2ee: data.e2ee || null,
            fileUrl: data.fileUrl || null,
            fileType: data.fileType || null,
            sharedPostId: data.sharedPostId || null,
            createdAt: serverTimestamp(),
            readAt: null, // Initialize readAt as null
            parentMessageId: data.parentMessageId || null,
            parentMessageText: data.parentMessageText || null,
            parentMessageSenderName: data.parentMessageSenderName || null,
        });
        
        // Note: The parent conversation document is now updated by the `onMessageCreated` Cloud Function.

        const remoteRecipientId = (participantIds as string[]).find(
          (id) => id !== senderId && id.startsWith('ap_'),
        );
        if (remoteRecipientId) {
          const outboundText = [data.text?.trim(), data.fileUrl].filter(Boolean).join('\n');
          if (outboundText) {
            const token = await auth.currentUser?.getIdToken().catch(() => null);
            if (token) {
              fetch('/api/ap/dm', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  recipientId: remoteRecipientId,
                  text: outboundText,
                }),
              }).catch((err) => console.warn('Erro ao enviar DM ao Fediverso:', err));
            }
          }
        }

        const senderDetails = await getUser(senderId, senderId);
        if (!senderDetails) throw new Error("Não foi possível recuperar os detalhes do remetente.");
        
        let sharedPost = null;
        if(data.sharedPostId) {
            sharedPost = await getPostById(data.sharedPostId, senderId);
        }

        const createdMessage: DirectMessage = {
            id: newMessageRef.id,
            conversationId: conversationId,
            senderId: senderId,
            sender: senderDetails,
            text: data.text || '',
            e2ee: data.e2ee || undefined,
            fileUrl: data.fileUrl,
            fileType: data.fileType,
            sharedPostId: data.sharedPostId,
            sharedPost: sharedPost,
            createdAt: new Date().toISOString(),
            readAt: null,
            parentMessageId: data.parentMessageId,
            parentMessageText: data.parentMessageText,
            parentMessageSenderName: data.parentMessageSenderName,
        };
        return deepCopyDirectMessage(createdMessage);

    } catch (error: any) {
        console.error("Error sending direct message:", String(error));
        if (error.code === 'permission-denied') {
             throw error; 
        }
        return null;
    }
};

export const deleteDirectMessage = async (conversationId: string, messageId: string): Promise<void> => {
    const currentUserId = getCurrentUserId();
    if (!currentUserId) throw new Error("Usuário deve estar autenticado para apagar uma mensagem.");

    const messageRef = doc(db, 'conversations', conversationId, 'messages', messageId);
    
    // We don't need to read before deleting because Firestore rules will enforce ownership.
    // This saves a read operation.
    await deleteDoc(messageRef);

    // Note: This does not update the `lastMessage...` fields on the parent conversation document.
    // A Cloud Function triggered on message delete would be the robust way to handle this,
    // as it can query for the new last message and update the conversation atomically.
    // On the client, the message will disappear, but the conversation preview might show stale data until a new message is sent.
};

export const acceptConversationRequest = async (conversationId: string, userId: string): Promise<void> => {
    // Accepting a request is functionally the same as marking it as read,
    // which moves it to the main conversation list due to the client-side logic.
    await markConversationAsRead(conversationId, userId);
};

export const declineOrLeaveConversation = async (conversationId: string, userId: string): Promise<void> => {
     if (!userId) throw new Error("O ID de usuário é necessário para sair/recusar uma conversa.");

    const conversationRef = doc(db, 'conversations', conversationId);

    try {
        const conversationSnap = await getDoc(conversationRef);
        if (!conversationSnap.exists()) {
            throw new Error("Conversa não encontrada.");
        }

        // We don't delete the conversation, just mark that the user has "left".
        // This prevents them from seeing it in their list unless the other user messages again.
        const leftAtUpdate = {
            [`userLeftAt.${userId}`]: serverTimestamp()
        };
        await updateDoc(conversationRef, leftAtUpdate);
        console.log(`User ${userId} has declined/left conversation ${conversationId}.`);

    } catch (error: any) {
        console.error(`Error declining/leaving conversation ${conversationId}:`, String(error));
        throw error;
    }
};

    