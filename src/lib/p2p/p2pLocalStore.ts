// src/lib/p2p/p2pLocalStore.ts
// O histórico P2P guardado NESTE aparelho (as mensagens do canal Zero DB nunca vão para o banco). Puro: o armazenamento entra
// por parâmetro (`localStorage` no navegador, um Map nos testes).
//
// O que mudou em relação ao código antigo:
//  - o registro guarda só o que a mensagem É (id, quem mandou, texto ou texto cifrado, datas, resposta). O código antigo
//    gravava junto o objeto `sender` inteiro (o perfil completo de quem mandou, e-mail incluído quando presente);
//  - tudo o que se lê passa por `sanitizeStored`, venha do armazenamento ou de um arquivo de backup: formato e teto em cada
//    campo, descartando o resto. Um arquivo de backup adulterado não consegue plantar "mensagens" de outra pessoa;
//  - cota cheia não perde a mensagem nova: descarta as mais antigas e tenta de novo;
//  - a união (importar backup) ordena por data e mantém as 200 MAIS RECENTES (antes mantinha as últimas da lista, na ordem
//    em que estavam, que não é a ordem do tempo).
import { isP2pMessageId, isParentMessageId, MAX_PARENT_CHARS, MAX_TEXT_CHARS, parseE2ee, type WireE2ee } from './p2pProtocol.ts';

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
};

export const MSGS_PREFIX = 'exelula:p2p:msgs:v1:';
export const MAX_LOCAL_MESSAGES = 200;
export const MAX_CONVERSATIONS_IN_STORE = 500;

export type StoredP2pMessage = {
  id: string;
  senderId: string;
  text?: string;
  e2ee?: WireE2ee;
  createdAt: string;
  p2pStatus?: 'queued' | 'sent';
  parentMessageId?: string;
  parentMessageText?: string;
  parentMessageSenderName?: string;
};

const CONVERSATION_ID = /^[A-Za-z0-9]{6,64}_[A-Za-z0-9]{6,64}$/;
export const isConversationId = (id: unknown): id is string => typeof id === 'string' && CONVERSATION_ID.test(id);

const MIN_DATE = Date.UTC(2020, 0, 1);

/** Uma mensagem guardada → cópia limpa, ou `null` se algo estiver fora do formato. */
export function sanitizeStored(raw: unknown, now = Date.now()): StoredP2pMessage | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isP2pMessageId(r.id)) return null;
  if (typeof r.senderId !== 'string' || r.senderId.length === 0 || r.senderId.length > 128) return null;
  if (typeof r.createdAt !== 'string' || r.createdAt.length > 40) return null;
  const t = Date.parse(r.createdAt);
  if (!Number.isFinite(t) || t < MIN_DATE || t > now + 86_400_000) return null;

  const saida: StoredP2pMessage = { id: r.id, senderId: r.senderId, createdAt: new Date(t).toISOString() };
  if (r.p2pStatus === 'queued' || r.p2pStatus === 'sent') saida.p2pStatus = r.p2pStatus;
  // O texto claro e o cifrado são independentes: o histórico antigo guarda os dois (e é o único jeito de ler a mensagem se a
  // chave se perdeu), o novo guarda só o cifrado. Aqui nada é descartado se estiver válido; basta um dos dois existir.
  if (r.e2ee !== undefined && r.e2ee !== null) {
    const e = parseE2ee(r.e2ee);
    if (e) saida.e2ee = e;
  }
  if (typeof r.text === 'string' && r.text.length > 0 && r.text.length <= MAX_TEXT_CHARS) saida.text = r.text;
  if (!saida.e2ee && saida.text === undefined) return null;
  if (r.parentMessageId !== undefined && r.parentMessageId !== null) {
    if (!isParentMessageId(r.parentMessageId)) return null;
    saida.parentMessageId = r.parentMessageId;
    for (const campo of ['parentMessageText', 'parentMessageSenderName'] as const) {
      const v = r[campo];
      if (typeof v === 'string' && v.length <= MAX_PARENT_CHARS) saida[campo] = v;
    }
  }
  return saida;
}

const chaveDe = (userId: string, conversationId: string) => `${MSGS_PREFIX}${userId}:${conversationId}`;

/** União por id, da mais antiga para a mais nova, mantendo as `max` mais recentes. */
export function mergeConversation(existentes: StoredP2pMessage[], novas: StoredP2pMessage[], max = MAX_LOCAL_MESSAGES): StoredP2pMessage[] {
  const porId = new Map<string, StoredP2pMessage>();
  for (const m of existentes) porId.set(m.id, m);
  for (const m of novas) if (!porId.has(m.id)) porId.set(m.id, m);
  const ordenadas = [...porId.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
  return ordenadas.slice(-max);
}

export function loadConversation(storage: StorageLike, userId: string, conversationId: string): StoredP2pMessage[] {
  if (!userId || !isConversationId(conversationId)) return [];
  try {
    const bruto = storage.getItem(chaveDe(userId, conversationId));
    if (!bruto) return [];
    const lista = JSON.parse(bruto);
    if (!Array.isArray(lista)) return [];
    const limpas: StoredP2pMessage[] = [];
    for (const item of lista.slice(-MAX_LOCAL_MESSAGES * 2)) {
      const m = sanitizeStored(item);
      if (m) limpas.push(m);
    }
    return mergeConversation([], limpas);
  } catch {
    return [];
  }
}

function writeConversation(storage: StorageLike, key: string, lista: StoredP2pMessage[]): boolean {
  let atual = lista;
  for (let tentativa = 0; tentativa < 4; tentativa += 1) {
    try {
      storage.setItem(key, JSON.stringify(atual));
      return true;
    } catch {
      // Cota cheia (ou armazenamento bloqueado): descarta a metade mais antiga e tenta de novo.
      atual = atual.slice(Math.ceil(atual.length / 2));
      if (atual.length === 0) return false;
    }
  }
  return false;
}

/** Guarda uma mensagem. `inserted: false` quando o id já existia (a mensagem repetida não vira duas) ou não coube. */
export function saveMessage(
  storage: StorageLike,
  userId: string,
  conversationId: string,
  message: StoredP2pMessage,
): { inserted: boolean; list: StoredP2pMessage[] } {
  const limpa = sanitizeStored(message);
  const existentes = loadConversation(storage, userId, conversationId);
  if (!limpa || !isConversationId(conversationId) || existentes.some((m) => m.id === limpa.id)) return { inserted: false, list: existentes };
  const lista = mergeConversation(existentes, [limpa]);
  const gravou = writeConversation(storage, chaveDe(userId, conversationId), lista);
  return { inserted: gravou, list: gravou ? lista : existentes };
}

export function updateMessageStatus(
  storage: StorageLike,
  userId: string,
  conversationId: string,
  messageId: string,
  p2pStatus: 'queued' | 'sent',
): StoredP2pMessage[] {
  const lista = loadConversation(storage, userId, conversationId).map((m) =>
    m.id === messageId ? { ...m, p2pStatus } : m,
  );
  writeConversation(storage, chaveDe(userId, conversationId), lista);
  return lista;
}

export function deleteMessage(storage: StorageLike, userId: string, conversationId: string, messageId: string): void {
  const lista = loadConversation(storage, userId, conversationId).filter((m) => m.id !== messageId);
  try {
    storage.setItem(chaveDe(userId, conversationId), JSON.stringify(lista));
  } catch {
    // ignora
  }
}

export function listConversations(storage: StorageLike, userId: string): string[] {
  const prefixo = `${MSGS_PREFIX}${userId}:`;
  const ids: string[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (k && k.startsWith(prefixo)) {
        const id = k.slice(prefixo.length);
        if (isConversationId(id)) ids.push(id);
      }
    }
  } catch {
    // ignora
  }
  return ids.slice(0, MAX_CONVERSATIONS_IN_STORE);
}

export function stats(storage: StorageLike, userId: string): { conversations: number; messages: number } {
  const ids = listConversations(storage, userId);
  let messages = 0;
  for (const id of ids) messages += loadConversation(storage, userId, id).length;
  return { conversations: ids.length, messages };
}

export function clearAll(storage: StorageLike, userId: string): number {
  const prefixo = `${MSGS_PREFIX}${userId}:`;
  const apagar: string[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (k && k.startsWith(prefixo)) apagar.push(k);
    }
    for (const k of apagar) storage.removeItem(k);
  } catch {
    // ignora
  }
  return apagar.length;
}

export function exportAll(storage: StorageLike, userId: string): Record<string, StoredP2pMessage[]> {
  const saida: Record<string, StoredP2pMessage[]> = {};
  for (const id of listConversations(storage, userId)) {
    const lista = loadConversation(storage, userId, id);
    if (lista.length > 0) saida[id] = lista;
  }
  return saida;
}

/** Importa conversas de um backup (já validadas pelo leitor do arquivo): une com o que existe e conta o que de fato entrou. */
export function importConversations(
  storage: StorageLike,
  userId: string,
  conversas: Record<string, unknown[]>,
): { conversationsRestored: number; messagesRestored: number; messagesSkipped: number } {
  let conversationsRestored = 0;
  let messagesRestored = 0;
  let messagesSkipped = 0;
  for (const [conversationId, itens] of Object.entries(conversas).slice(0, MAX_CONVERSATIONS_IN_STORE)) {
    if (!isConversationId(conversationId) || !Array.isArray(itens)) continue;
    const validas = itens.map((i) => sanitizeStored(i)).filter((m): m is StoredP2pMessage => m !== null);
    messagesSkipped += itens.length - validas.length;
    // O mesmo id duas vezes no arquivo vale uma vez só (é a mesma mensagem).
    const limpas = [...new Map(validas.map((m) => [m.id, m])).values()];
    const existentes = loadConversation(storage, userId, conversationId);
    const idsAntes = new Set(existentes.map((m) => m.id));
    const unida = mergeConversation(existentes, limpas);
    if (!writeConversation(storage, chaveDe(userId, conversationId), unida)) {
      messagesSkipped += limpas.length;
      continue;
    }
    messagesRestored += limpas.filter((m) => !idsAntes.has(m.id)).length;
    conversationsRestored += 1;
  }
  return { conversationsRestored, messagesRestored, messagesSkipped };
}
