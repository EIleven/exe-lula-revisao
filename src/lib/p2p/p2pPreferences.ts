'use client';

// src/lib/p2p/p2pPreferences.ts
// Preferências do P2P e a ponte da portabilidade (backup cifrado: entrada e saída) com o armazenamento do aparelho.
// A lógica (formato, validação, cifra) está em p2pBundle.ts e p2pLocalStore.ts, testada em Node; aqui só se liga ao
// localStorage e ao E2EE do navegador.
import { exportE2eeKeyring, getE2eeStatus, importE2eeKeyring, isWebCryptoSupported } from '@/lib/crypto/e2ee';
import {
  BUNDLE_FORMAT,
  readBundle,
  sealBundle,
  type BundleContent,
  type BundlePreferences,
  type ReadBundleError,
} from './p2pBundle';
import { clearAll, exportAll, importConversations, stats, type StorageLike } from './p2pLocalStore';

export type AutoConnectScope = 'mutual' | 'any';
export type GroupP2pMode = 'off' | 'hybrid';

export type P2pPreferences = BundlePreferences;

const PREFS_KEY_PREFIX = 'exelula:p2p:prefs:v1:';
const GROUP_MODE_KEY_PREFIX = 'exelula:p2p:group-mode:v1:';

export const DEFAULT_P2P_PREFERENCES: P2pPreferences = {
  defaultZeroDbOnly: false,
  autoConnectP2p: true,
  // P2P ativo por padrão para todas as conversas (pode restringir a mútuos em Configurações > P2P).
  autoConnectScope: 'any',
  // "Ocultar meu IP": só usa relay (TURN). Só vale se o servidor tiver TURN configurado.
  relayOnly: false,
};

const localStore = (): StorageLike | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

export function getP2pPreferences(userId?: string | null): P2pPreferences {
  const store = localStore();
  if (!store || !userId) return { ...DEFAULT_P2P_PREFERENCES };
  try {
    const raw = store.getItem(`${PREFS_KEY_PREFIX}${userId}`);
    if (!raw) return { ...DEFAULT_P2P_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<P2pPreferences>;
    return {
      defaultZeroDbOnly: Boolean(parsed.defaultZeroDbOnly),
      autoConnectP2p: parsed.autoConnectP2p !== false,
      autoConnectScope: parsed.autoConnectScope === 'mutual' ? 'mutual' : 'any',
      relayOnly: parsed.relayOnly === true,
    };
  } catch {
    return { ...DEFAULT_P2P_PREFERENCES };
  }
}

export function saveP2pPreferences(userId: string, prefs: P2pPreferences): void {
  const store = localStore();
  if (!store || !userId) return;
  try {
    store.setItem(`${PREFS_KEY_PREFIX}${userId}`, JSON.stringify(prefs));
  } catch (err) {
    console.warn('[P2P] Falha ao salvar preferências P2P:', err);
  }
}

export function getGroupP2pMode(userId?: string | null, conversationId?: string | null): GroupP2pMode {
  const prefs = getP2pPreferences(userId);
  // Em grupos, mesmo se o usuário ativou P2P como padrão, mantém entrega compatível (P2P + DB para quem está offline/sem P2P)
  // para que todos os participantes recebam todas as mensagens independente da preferência individual de segurança.
  const fallback: GroupP2pMode = prefs.autoConnectP2p || prefs.defaultZeroDbOnly ? 'hybrid' : 'off';
  const store = localStore();
  if (!store || !userId || !conversationId) return fallback;
  try {
    const saved = store.getItem(`${GROUP_MODE_KEY_PREFIX}${userId}:${conversationId}`);
    if (saved === 'off' || saved === 'hybrid') {
      return saved;
    }
    if (saved === 'zero_db') {
      return 'hybrid';
    }
  } catch {
    // ignore
  }
  return fallback;
}

export function setGroupP2pMode(userId: string, conversationId: string, mode: GroupP2pMode): void {
  const store = localStore();
  if (!store || !userId || !conversationId) return;
  try {
    store.setItem(`${GROUP_MODE_KEY_PREFIX}${userId}:${conversationId}`, mode);
  } catch (err) {
    console.warn('[P2P] Falha ao salvar modo P2P do grupo:', err);
  }
}

export function getLocalP2pStats(userId?: string | null): { conversations: number; messages: number } {
  const store = localStore();
  if (!store || !userId) return { conversations: 0, messages: 0 };
  return stats(store, userId);
}

export function clearAllLocalP2pHistory(userId: string): number {
  const store = localStore();
  if (!store || !userId) return 0;
  return clearAll(store, userId);
}

// ───────────────────────── Portabilidade (saída e entrada) ─────────────────────────

export type ExportParts = { preferences: boolean; keys: boolean; p2p: boolean };

/**
 * SAÍDA: monta o arquivo de portabilidade, SEMPRE cifrado com a senha informada (o arquivo contém a chave privada do E2EE e
 * o histórico P2P: em claro, quem o abrir tem a conta). Devolve o texto JSON.
 */
export async function exportPortabilityBundle(userId: string, passphrase: string, parts: ExportParts): Promise<string> {
  const store = localStore();
  if (!store) throw new Error('sem armazenamento local');
  const content: BundleContent = { format: BUNDLE_FORMAT, version: 2, exportedAt: new Date().toISOString(), userId };
  if (parts.preferences) content.preferences = getP2pPreferences(userId);
  if (parts.keys && isWebCryptoSupported()) {
    const ring = await exportE2eeKeyring(userId);
    if (ring) content.e2eeKeyring = ring;
  }
  if (parts.p2p) content.p2p = { conversations: exportAll(store, userId) };
  return sealBundle(content, passphrase);
}

export type ImportSummary = {
  legacy: boolean;
  keysRestored: boolean;
  /** Estado da identidade depois da importação (ex.: `needs-restore` se o arquivo não tinha a chave da conta). */
  identity: string | null;
  conversationsRestored: number;
  messagesRestored: number;
  messagesSkipped: number;
  preferencesRestored: boolean;
};

/**
 * ENTRADA: lê o arquivo (cifrado ou do formato antigo), valida TUDO e só então grava: chaves (unidas às do aparelho, sem
 * apagar nenhuma), conversas (unidas ao que existe) e preferências. Qualquer problema na leitura aborta antes de gravar.
 */
export async function importPortabilityBundle(
  userId: string,
  text: string,
  passphrase?: string,
): Promise<{ ok: true; summary: ImportSummary } | { ok: false; error: ReadBundleError }> {
  const store = localStore();
  if (!store) return { ok: false, error: 'invalido' };
  const lido = await readBundle(text, { userId, passphrase });
  if (!lido.ok) return lido;
  const { content } = lido;

  const summary: ImportSummary = {
    legacy: lido.legacy,
    keysRestored: false,
    identity: null,
    conversationsRestored: 0,
    messagesRestored: 0,
    messagesSkipped: 0,
    preferencesRestored: false,
  };

  if (content.e2eeKeyring) {
    const st = await importE2eeKeyring(userId, content.e2eeKeyring);
    summary.keysRestored = true;
    summary.identity = st.status;
  } else {
    summary.identity = (await getE2eeStatus(userId)).status;
  }
  if (content.p2p) {
    const r = importConversations(store, userId, content.p2p.conversations);
    summary.conversationsRestored = r.conversationsRestored;
    summary.messagesRestored = r.messagesRestored;
    summary.messagesSkipped = r.messagesSkipped;
  }
  if (content.preferences) {
    saveP2pPreferences(userId, content.preferences);
    summary.preferencesRestored = true;
  }
  return { ok: true, summary };
}
