// src/lib/services/presenceService.ts
// Presença online/offline. O Realtime Database é a ÚNICA fonte (só ele percebe no servidor quando a conexão cai);
// nada vai para o Firestore. Cada aba/aparelho é uma conexão em /status/{uid}/connections/{id}: "online" é ter ao
// menos uma (antes, fechar uma aba marcava offline com outra aberta). Sair da conta marca offline ANTES do signOut
// (depois dele a escrita é negada e a pessoa ficava online para sempre). Visitantes: /guests/{id}, que some quando a
// conexão cai. Veja docs/presenca.md.
import {
  getDatabase,
  ref,
  onValue,
  onDisconnect,
  set,
  push,
  remove,
  serverTimestamp,
  type DatabaseReference,
  type Unsubscribe,
} from 'firebase/database';

const GUEST_SESSION_ID_KEY = 'soberan-guest-session-id';
const GUEST_ID_PATTERN = /^guest_[0-9]{10,16}_[a-z0-9]{1,12}$/;

type UserSession = { uid: string; connectionRef: DatabaseReference | null; stopListening: Unsubscribe };
let userSession: UserSession | null = null;
let guestSession: { guestRef: DatabaseReference; stopListening: Unsubscribe } | null = null;

const sessionStorageGet = (key: string): string | null => {
  try { return window.sessionStorage.getItem(key); } catch { return null; }
};
const sessionStorageSet = (key: string, value: string) => {
  try { window.sessionStorage.setItem(key, value); } catch { /* armazenamento indisponível: id novo a cada carga */ }
};

export const initializePresence = (userId: string) => {
  if (!userId || userSession?.uid === userId) return;
  if (userSession) void goOffline(userSession.uid);

  const rtdb = getDatabase();
  const connectionsRef = ref(rtdb, `status/${userId}/connections`);
  const lastSeenRef = ref(rtdb, `status/${userId}/lastSeen`);
  const session: UserSession = { uid: userId, connectionRef: null, stopListening: () => {} };

  session.stopListening = onValue(ref(rtdb, '.info/connected'), (snap) => {
    if (snap.val() !== true) return;
    // A cada (re)conexão, uma entrada nova. O servidor a apaga e grava a hora quando a conexão cair; só depois de
    // registrar isso a entrada é criada (sem a ordem, uma queda no meio deixaria "online" para sempre).
    const connectionRef = push(connectionsRef);
    session.connectionRef = connectionRef;
    onDisconnect(connectionRef).remove()
      .then(() => onDisconnect(lastSeenRef).set(serverTimestamp()))
      .then(() => set(connectionRef, true))
      .catch((error) => console.warn('[presença] falha ao registrar a conexão:', error));
  });
  userSession = session;
};

/** Marca offline agora. Chamar com a sessão AINDA autenticada (antes de signOut). */
export const goOffline = async (userId?: string): Promise<void> => {
  const session = userSession;
  if (!session || (userId && session.uid !== userId)) return;
  userSession = null;
  session.stopListening();

  const rtdb = getDatabase();
  const lastSeenRef = ref(rtdb, `status/${session.uid}/lastSeen`);
  try {
    if (session.connectionRef) {
      await onDisconnect(session.connectionRef).cancel();
      await remove(session.connectionRef);
    }
    await onDisconnect(lastSeenRef).cancel();
    await set(lastSeenRef, serverTimestamp());
  } catch (error) {
    console.warn('[presença] falha ao marcar offline:', error);
  }
};

export const initializeGuestPresence = () => {
  if (guestSession || typeof window === 'undefined') return;

  let guestId = sessionStorageGet(GUEST_SESSION_ID_KEY);
  if (!guestId || !GUEST_ID_PATTERN.test(guestId)) {
    guestId = `guest_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    sessionStorageSet(GUEST_SESSION_ID_KEY, guestId);
  }

  const rtdb = getDatabase();
  const guestRef = ref(rtdb, `guests/${guestId}`);
  const stopListening = onValue(ref(rtdb, '.info/connected'), (snap) => {
    if (snap.val() !== true) return;
    onDisconnect(guestRef).remove()
      .then(() => set(guestRef, { isOnline: true, lastSeen: serverTimestamp() }))
      .catch((error) => console.warn('[presença] falha ao registrar visitante:', error));
  });
  guestSession = { guestRef, stopListening };
};

export const goOfflineGuest = () => {
  const session = guestSession;
  if (!session) return;
  guestSession = null;
  session.stopListening();
  onDisconnect(session.guestRef).cancel().catch(() => {});
  remove(session.guestRef).catch(() => {});
};
