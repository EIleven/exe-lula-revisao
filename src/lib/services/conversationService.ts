
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
import { getUser, fetchPublicUsersByIds } from './userService';
import {
  MOTIVO_EM_PALAVRAS,
  triarEntradas,
  type MotivoDaRecusa,
  type SinaisDaRelacao,
} from '../messages/entradaEmGrupo';
import { getCurrentUserId } from './authService';
import { getPostById } from './postReadService';

export const conversationsCollection = collection(db, 'conversations');

export const firestoreToConversation = async (convId: string, convDataFromDb: any, activeUserId: string | null): Promise<Conversation | null> => {
    const embeddedById = new Map<string, Partial<User>>();
    if (Array.isArray(convDataFromDb.participantsInfo)) {
      for (const item of convDataFromDb.participantsInfo) {
        if (item && typeof item.id === 'string') {
          embeddedById.set(item.id, item);
        }
      }
    }

    const participantIds: string[] = Array.isArray(convDataFromDb.participantIds)
      ? convDataFromDb.participantIds
      : [];
    const isLargeGroup = Boolean(convDataFromDb.isGroup) && participantIds.length > 4;
    const batchLoadedById = new Map<string, User>();
    if (isLargeGroup) {
      const batchUsers = await fetchPublicUsersByIds(participantIds, activeUserId).catch(() => [] as User[]);
      for (const u of batchUsers) {
        batchLoadedById.set(u.id, u);
      }
    }

    const participantsInfoPromises = participantIds.map(async (pid: string): Promise<User> => {
        const loaded = isLargeGroup
          ? batchLoadedById.get(pid)
          : await getUser(pid, activeUserId).catch(() => undefined);
        if (loaded) return loaded;
        const embedded = embeddedById.get(pid);
        return {
          id: pid,
          name: embedded?.name || (pid.startsWith('ap_') ? 'Usuário do Fediverso' : 'Participante'),
          username: embedded?.username || pid.replace(/^ap_/, 'fediverso_'),
          email: '',
          avatarUrl: embedded?.avatarUrl || '',
          followersCount: 0,
          followingCount: 0,
          postsCount: 0,
          isAdmin: false,
          isModerator: false,
          dmPreference: 'everyone',
          profileVisibility: 'public',
          createdAt: new Date().toISOString(),
        };
    });
    const participantsInfo = await Promise.all(participantsInfoPromises);

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

  const pedidos = Array.from(new Set(selectedUserIds.filter(Boolean))).filter((id) => id !== creatorId);
  if (pedidos.length < 1) {
    throw new Error("Selecione pelo menos um participante além de você.");
  }

  // Criação e adição de participantes passam pela rota autenticada /api/messages/group-members
  // (as firestore.rules barram adição direta de terceiros pelo SDK do cliente).
  const token = await auth.currentUser?.getIdToken().catch(() => null);
  if (!token) {
    throw new Error("Sessão inválida. Faça login novamente para criar o grupo.");
  }

  const res = await fetch('/api/messages/group-members', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: 'create',
      groupName: trimmedName,
      userIds: pedidos,
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    conversationId?: string;
    message?: string;
  };
  if (!res.ok || !payload.conversationId) {
    throw new Error(payload.message || 'Não foi possível criar o grupo.');
  }

  const convSnap = await getDoc(doc(conversationsCollection, payload.conversationId));
  if (!convSnap.exists()) {
    throw new Error("Não foi possível carregar o grupo recém-criado.");
  }
  const created = await firestoreToConversation(convSnap.id, convSnap.data(), activeUserId);
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

export interface AddGroupParticipantsOptions {
  sendFediverseInvite?: boolean;
  sendPublicFediverseMention?: boolean;
  announceInGroup?: boolean;
}

/** Quem não entrou e por quê. Vai para a tela: sumir com a pessoa da lista calado é o que parece aplicativo quebrado. */
export interface RecusaDeEntrada {
  userId: string;
  nome: string;
  motivo: MotivoDaRecusa;
  emPalavras: string;
}

/**
 * Lê os sinais de consentimento de cada pessoa que seria adicionada. Quatro leituras no máximo por candidato, todas
 * permitidas pelas regras: o documento público (já lido por `fetchPublicUsersByIds`), o bloqueio nos dois sentidos e
 * -- só quando a preferência é 'followed' -- o seguimento.
 *
 * NÃO existe `catch` aqui de propósito. Um erro de leitura num teste de BLOQUEIO que "falha aberto" é pior que erro
 * nenhum: adicionaria justamente quem bloqueou. Se não der para conferir, a adição inteira para e a pessoa tenta de
 * novo.
 */
const sinaisDeEntradaEmGrupo = async (
  actorUserId: string,
  ids: string[],
  perfilPorId: Map<string, User>,
): Promise<Map<string, SinaisDaRelacao>> => {
  const pares = await Promise.all(
    ids.map(async (id): Promise<[string, SinaisDaRelacao]> => {
      const perfil = perfilPorId.get(id);
      const ehRemoto = id.startsWith('ap_') || (perfil?.username || '').includes('@');
      const [alvoBloqueouOAtor, atorBloqueouOAlvo] = await Promise.all([
        getDoc(doc(db, 'users', id, 'blockedUsers', actorUserId)).then((s) => s.exists()),
        getDoc(doc(db, 'users', actorUserId, 'blockedUsers', id)).then((s) => s.exists()),
      ]);
      const dmPreference = perfil?.dmPreference;
      const alvoSegueOAtor =
        dmPreference === 'followed'
          ? await getDoc(doc(db, 'users', id, 'following', actorUserId)).then((s) => s.exists())
          : undefined;
      return [id, { dmPreference, ehRemoto, alvoBloqueouOAtor, atorBloqueouOAlvo, alvoSegueOAtor }];
    }),
  );
  return new Map(pares);
};

export const addGroupParticipants = async (
  conversationId: string,
  actorUserId: string,
  userIdsToAdd: string[],
  options: AddGroupParticipantsOptions = {}
): Promise<{ addedUsers: User[]; remoteNotified: number; recusados: RecusaDeEntrada[] }> => {
  const { data } = await assertGroupAdmin(conversationId, actorUserId);
  const currentIds: string[] = Array.isArray(data.participantIds) ? data.participantIds : [];
  const pedidos = userIdsToAdd.filter((id) => Boolean(id) && !currentIds.includes(id));
  if (pedidos.length === 0) {
    return { addedUsers: [], remoteNotified: 0, recusados: [] };
  }

  const authToken = await auth.currentUser?.getIdToken().catch(() => null);
  if (!authToken) {
    throw new Error("Sessão inválida. Faça login novamente.");
  }

  const addRes = await fetch('/api/messages/group-members', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      action: 'add',
      conversationId,
      userIds: pedidos,
    }),
  });
  const addPayload = (await addRes.json().catch(() => ({}))) as {
    addedIds?: string[];
    recusados?: RecusaDeEntrada[];
    message?: string;
  };
  if (!addRes.ok) {
    throw new Error(addPayload.message || 'Ninguém foi adicionado.');
  }

  const newlyAddedIds = Array.isArray(addPayload.addedIds) ? addPayload.addedIds : [];
  const recusados: RecusaDeEntrada[] = Array.isArray(addPayload.recusados) ? addPayload.recusados : [];
  const nextIds = Array.from(new Set([...currentIds, ...newlyAddedIds]));
  const perfis = newlyAddedIds.length > 0 ? await fetchPublicUsersByIds(newlyAddedIds, actorUserId) : [];
  const perfilPorId = new Map(perfis.map((u) => [u.id, u]));

  const addedUsers = newlyAddedIds
    .map((id) => perfilPorId.get(id))
    .filter((u): u is User => Boolean(u));

  let remoteNotified = 0;
  const groupTitle = (data.groupName || 'Grupo').trim();
  const origin =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : 'https://hiperverso.app';

  // Notifica via ActivityPub novos integrantes do Fediverso adicionados ao grupo com link mágico 1-clique
  const remoteNewUsers = addedUsers.filter(
    (u) => u.id.startsWith('ap_') || u.username?.includes('@')
  );
  if (
    options.sendFediverseInvite !== false &&
    remoteNewUsers.length > 0 &&
    typeof window !== 'undefined'
  ) {
    const [token, inviter] = await Promise.all([
      auth.currentUser?.getIdToken().catch(() => null),
      getUser(actorUserId, actorUserId).catch(() => null),
    ]);
    const inviterLabel = inviter?.name || (inviter?.username ? `@${inviter.username}` : 'Alguém');
    if (token) {
      await Promise.all(
        remoteNewUsers.map(async (remoteUser) => {
          const cleanHandle = (remoteUser.username || '').replace(/^@+/, '');
          const magicUrl = `${origin}/pt-BR/login?federated=fediverse&handle=${encodeURIComponent(
            cleanHandle
          )}&groupName=${encodeURIComponent(
            groupTitle
          )}&redirect=${encodeURIComponent(`/pt-BR/messages/group/${conversationId}`)}`;

          const inviteText = `👋 ${inviterLabel} adicionou você ao grupo "${groupTitle}" no HiperVerso (${nextIds.length} participantes).\n\nPara participar da roda de conversa com todos os membros usando sua conta @${cleanHandle}, toque aqui:\n👉 ${magicUrl}`;

          try {
            const res = await fetch('/api/ap/dm', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                recipientId: remoteUser.id,
                conversationId,
                text: inviteText,
                visibility: options.sendPublicFediverseMention ? 'public' : 'direct',
              }),
            });
            if (res.ok) remoteNotified++;
          } catch {
            // Best-effort delivery
          }
        })
      );
    }
  }

  return { addedUsers, remoteNotified, recusados };
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

/**
 * Zera o contador de nao lidas desta pessoa.
 *
 * `confirmarLeitura` tambem avisa o OUTRO LADO que voce leu (campo `lastReadAt`, com a hora do servidor). Ele e
 * explicito de proposito: o botao "marcar todas como lidas" da lista chama esta funcao para N conversas de uma vez,
 * e se o recibo pegasse carona voce avisaria N pessoas que leu sem ter aberto nada. Quem passa `true` e so a tela da
 * conversa ABERTA, e so quando a pessoa deixou a confirmacao ligada (src/lib/messages/recibos.ts).
 */
export const markConversationAsRead = async (
  conversationId: string,
  userId: string,
  opcoes?: { confirmarLeitura?: boolean },
): Promise<void> => {
  if (!conversationId || !userId) return;

  const conversationRef = doc(db, 'conversations', conversationId);
  try {
      const mudanca: Record<string, unknown> = { [`unreadCounts.${userId}`]: 0 };
      if (opcoes?.confirmarLeitura) mudanca[`lastReadAt.${userId}`] = serverTimestamp();
      await updateDoc(conversationRef, mudanca);
  } catch (error) {
      console.error(`Error marking conversation ${conversationId} as read for user ${userId}:`, error);
  }
};

/**
 * Avisa que voce leu SEM mexer no contador de nao lidas: serve para a conversa que ja esta aberta quando chega
 * mensagem nova (o contador ja foi zerado na abertura, mas a marca de leitura precisa avancar).
 */
export const confirmarLeituraDaConversa = async (conversationId: string, userId: string): Promise<boolean> => {
  if (!conversationId || !userId) return false;
  try {
    await updateDoc(doc(db, 'conversations', conversationId), {
      [`lastReadAt.${userId}`]: serverTimestamp(),
      [`unreadCounts.${userId}`]: 0,
    });
    return true;
  } catch (error) {
    console.error(`Error confirming read for ${conversationId}:`, error);
    return false;
  }
};


export const sendDirectMessage = async (
  conversationId: string,
  senderId: string,
  data: { 
    customMessageId?: string;
    text?: string; 
    e2ee?: E2eeMessagePayload | null;
    mediaE2ee?: E2eeMessagePayload | null;
    fileUrl?: string; 
    fileType?: DirectMessage['fileType'], 
    posterUrl?: string | null;
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
        const messagePayload = {
            senderId,
            text: data.e2ee ? null : (data.text || null),
            e2ee: data.e2ee || null,
            mediaE2ee: data.mediaE2ee || null,
            fileUrl: data.fileUrl || null,
            fileType: data.fileType || null,
            posterUrl: data.posterUrl || null,
            sharedPostId: data.sharedPostId || null,
            createdAt: serverTimestamp(),
            readAt: null, // Initialize readAt as null
            parentMessageId: data.parentMessageId || null,
            parentMessageText: data.e2ee ? (data.parentMessageId ? '🔒 Mensagem criptografada' : null) : (data.parentMessageText || null),
            parentMessageSenderName: data.e2ee ? null : (data.parentMessageSenderName || null),
        };
        const safeCustomId =
          data.customMessageId && /^[A-Za-z0-9_-]{6,120}$/.test(data.customMessageId)
            ? data.customMessageId
            : null;
        let newMessageRef;
        if (safeCustomId) {
          newMessageRef = doc(messagesColRef, safeCustomId);
          await setDoc(newMessageRef, messagePayload);
        } else {
          newMessageRef = await addDoc(messagesColRef, messagePayload);
        }
        
        // Note: The parent conversation document is now updated by the `onMessageCreated` Cloud Function.

        const isDirect1on1 = !conversationData.isGroup && participantIds.length === 2;
        const remoteRecipientIds = (participantIds as string[]).filter(
          (id) => id !== senderId && (id.startsWith('ap_') || isDirect1on1),
        );
        if (remoteRecipientIds.length > 0) {
          const rawOutboundText = [data.text?.trim(), data.fileUrl].filter(Boolean).join('\n');
          const outboundText =
            conversationData.isGroup && conversationData.groupName && rawOutboundText
              ? `[${conversationData.groupName}] ${rawOutboundText}`
              : rawOutboundText;
          if (outboundText) {
            const token = await auth.currentUser?.getIdToken().catch(() => null);
            if (token) {
              for (const remoteRecipientId of remoteRecipientIds) {
                fetch('/api/ap/dm', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({
                    recipientId: remoteRecipientId,
                    ...(conversationData.isGroup ? { conversationId } : {}),
                    text: outboundText,
                  }),
                }).catch((err) => console.warn('Erro ao enviar DM ao Fediverso:', err));
              }
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
            posterUrl: data.posterUrl,
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

    