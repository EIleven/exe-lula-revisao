// src/lib/p2p/p2pBundle.ts
// O ARQUIVO DE PORTABILIDADE (entrada e saída): preferências, chaveiro E2EE e histórico P2P que existem SÓ neste aparelho.
// Versão 2, cifrado com a senha da pessoa (PBKDF2-SHA256 + AES-256-GCM), com leitura rigorosa. Puro (WebCrypto, sem DOM).
//
// Por que mudou: a versão 1 era um JSON em claro com a chave PRIVADA do E2EE e todas as conversas P2P. Um arquivo desses,
// esquecido na pasta de downloads ou num backup em nuvem, entrega a conta inteira. E a importação aceitava qualquer coisa:
// substituía a chave sem validar (podia deixar a conta sem identidade ou trocar por uma antiga e tornar ilegível o que
// chegou depois) e gravava mensagens sem conferir formato ou tamanho.
//
// Compatível com a LGPD (art. 18, V — portabilidade): formato aberto (JSON), versionado, sem dado de terceiros além do que
// a própria pessoa recebeu nas conversas, e inteligível por quem o abrir com a senha. Os dados da conta guardados no
// servidor (perfil, publicações) seguem pelo canal Direitos dos Dados; este arquivo cobre o que o servidor NÃO tem.
import { base64ToBytes, bytesToBase64, migrateLegacyPair, validateKeyring, type Keyring } from '../crypto/e2eeKeyring.ts';
import { isConversationId, MAX_CONVERSATIONS_IN_STORE, MAX_LOCAL_MESSAGES, sanitizeStored, type StoredP2pMessage } from './p2pLocalStore.ts';

export const BUNDLE_FORMAT = 'exelula-portability';
export const BUNDLE_VERSION = 2;
export const MAX_BUNDLE_CHARS = 8 * 1024 * 1024;
export const DEFAULT_KDF_ITERATIONS = 600_000;
export const MIN_KDF_ITERATIONS = 100_000;
export const MAX_KDF_ITERATIONS = 2_000_000;
export const MIN_PASSPHRASE_CHARS = 8;
const MAX_TOTAL_MESSAGES = 20_000;

export type BundlePreferences = {
  defaultZeroDbOnly: boolean;
  autoConnectP2p: boolean;
  autoConnectScope: 'mutual' | 'any';
  relayOnly: boolean;
};

export type BundleContent = {
  format: typeof BUNDLE_FORMAT;
  version: 2;
  exportedAt: string;
  userId: string;
  preferences?: BundlePreferences;
  e2eeKeyring?: Keyring;
  p2p?: { conversations: Record<string, StoredP2pMessage[]> };
};

type Envelope = {
  format: typeof BUNDLE_FORMAT;
  version: 2;
  encrypted: true;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  data: string;
};

export type ReadBundleError =
  | 'tamanho' | 'json' | 'formato' | 'versao' | 'senha-necessaria' | 'senha-incorreta' | 'outra-conta' | 'invalido' | 'kdf';

const getSubtle = (subtle?: SubtleCrypto): SubtleCrypto => {
  const s = subtle ?? globalThis.crypto?.subtle;
  if (!s) throw new Error('WebCrypto indisponível');
  return s;
};

const aadOf = (kdf: Envelope['kdf']) => new TextEncoder().encode(`${BUNDLE_FORMAT}|2|${kdf.name}|${kdf.hash}|${kdf.iterations}|${kdf.salt}`);

async function deriveKey(passphrase: string, kdf: Envelope['kdf'], subtle: SubtleCrypto): Promise<CryptoKey> {
  const base = await subtle.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: base64ToBytes(kdf.salt), iterations: kdf.iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Cifra o conteúdo com a senha. Recusa senha curta: o arquivo é tão forte quanto ela. */
export async function sealBundle(
  content: BundleContent,
  passphrase: string,
  opts: { iterations?: number; subtle?: SubtleCrypto } = {},
): Promise<string> {
  if (typeof passphrase !== 'string' || passphrase.normalize('NFKC').length < MIN_PASSPHRASE_CHARS) throw new Error('senha-curta');
  const subtle = getSubtle(opts.subtle);
  const iterations = opts.iterations ?? DEFAULT_KDF_ITERATIONS;
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const kdf: Envelope['kdf'] = { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: bytesToBase64(salt) };
  const chave = await deriveKey(passphrase, kdf, subtle);
  const cifrado = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadOf(kdf) }, chave, new TextEncoder().encode(JSON.stringify(content)));
  const envelope: Envelope = {
    format: BUNDLE_FORMAT, version: 2, encrypted: true, kdf,
    cipher: { name: 'AES-GCM', iv: bytesToBase64(iv) },
    data: bytesToBase64(new Uint8Array(cifrado)),
  };
  return JSON.stringify(envelope);
}

const PREF_SCOPES = ['mutual', 'any'] as const;

function cleanPreferences(raw: unknown): BundlePreferences | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  return {
    defaultZeroDbOnly: r.defaultZeroDbOnly === true,
    autoConnectP2p: r.autoConnectP2p !== false,
    autoConnectScope: (PREF_SCOPES as readonly unknown[]).includes(r.autoConnectScope) ? (r.autoConnectScope as 'mutual' | 'any') : 'mutual',
    relayOnly: r.relayOnly === true,
  };
}

function cleanConversations(raw: unknown): Record<string, StoredP2pMessage[]> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const saida: Record<string, StoredP2pMessage[]> = {};
  let total = 0;
  for (const [id, lista] of Object.entries(raw).slice(0, MAX_CONVERSATIONS_IN_STORE)) {
    if (!isConversationId(id) || !Array.isArray(lista)) continue;
    const limpas: StoredP2pMessage[] = [];
    for (const item of lista.slice(-MAX_LOCAL_MESSAGES)) {
      const m = sanitizeStored(item);
      if (m) limpas.push(m);
    }
    total += limpas.length;
    if (total > MAX_TOTAL_MESSAGES) return null;
    if (limpas.length > 0) saida[id] = limpas;
  }
  return saida;
}

async function validateContent(raw: unknown, userId: string, subtle?: SubtleCrypto): Promise<{ ok: true; content: BundleContent } | { ok: false; error: ReadBundleError }> {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'invalido' };
  const r = raw as Record<string, unknown>;
  if (r.format !== BUNDLE_FORMAT || r.version !== 2) return { ok: false, error: 'invalido' };
  if (r.userId !== userId) return { ok: false, error: 'outra-conta' };
  const content: BundleContent = {
    format: BUNDLE_FORMAT,
    version: 2,
    exportedAt: typeof r.exportedAt === 'string' ? r.exportedAt.slice(0, 40) : '',
    userId,
  };
  const preferences = cleanPreferences(r.preferences);
  if (preferences) content.preferences = preferences;
  if (r.e2eeKeyring !== undefined && r.e2eeKeyring !== null) {
    const ring = await validateKeyring(r.e2eeKeyring, subtle);
    if (!ring) return { ok: false, error: 'invalido' };
    content.e2eeKeyring = ring;
  }
  const p2p = (r.p2p as { conversations?: unknown } | undefined)?.conversations;
  if (p2p !== undefined) {
    const conversations = cleanConversations(p2p);
    if (!conversations) return { ok: false, error: 'invalido' };
    content.p2p = { conversations };
  }
  return { ok: true, content };
}

/** Converte o arquivo da versão 1 (JSON em claro) para o conteúdo atual, validando tudo que entra. */
async function fromLegacy(raw: Record<string, unknown>, userId: string, subtle?: SubtleCrypto): Promise<{ ok: true; content: BundleContent } | { ok: false; error: ReadBundleError }> {
  if (raw.userId !== userId) return { ok: false, error: 'outra-conta' };
  const content: BundleContent = { format: BUNDLE_FORMAT, version: 2, exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt.slice(0, 40) : '', userId };
  const preferences = cleanPreferences(raw.preferences);
  if (preferences) content.preferences = preferences;
  if (raw.e2eeKeyPair) {
    const ring = await migrateLegacyPair(raw.e2eeKeyPair, Date.now(), subtle);
    if (!ring) return { ok: false, error: 'invalido' };
    content.e2eeKeyring = ring;
  }
  if (raw.conversations !== undefined) {
    const conversations = cleanConversations(raw.conversations);
    if (!conversations) return { ok: false, error: 'invalido' };
    content.p2p = { conversations };
  }
  return { ok: true, content };
}

/**
 * Lê um arquivo de portabilidade. Aceita o formato atual (cifrado ou não) e o antigo (v1, em claro). Nada é aplicado aqui:
 * devolve o conteúdo já LIMPO e validado para quem importa decidir o que gravar.
 */
export async function readBundle(
  text: string,
  ctx: { userId: string; passphrase?: string; minIterations?: number; maxIterations?: number; subtle?: SubtleCrypto },
): Promise<{ ok: true; content: BundleContent; legacy: boolean } | { ok: false; error: ReadBundleError }> {
  if (typeof text !== 'string' || text.length > MAX_BUNDLE_CHARS) return { ok: false, error: 'tamanho' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'json' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'formato' };
  const r = raw as Record<string, unknown>;

  if (r.format === BUNDLE_FORMAT) {
    if (typeof r.version !== 'number') return { ok: false, error: 'formato' };
    if (r.version > BUNDLE_VERSION) return { ok: false, error: 'versao' };
    if (r.version !== BUNDLE_VERSION) return { ok: false, error: 'formato' };
    if (r.encrypted !== true) {
      const v = await validateContent(r, ctx.userId, ctx.subtle);
      return v.ok ? { ok: true, content: v.content, legacy: false } : v;
    }
    const kdf = r.kdf as Record<string, unknown> | undefined;
    const cipher = r.cipher as Record<string, unknown> | undefined;
    if (!kdf || !cipher || kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' || cipher.name !== 'AES-GCM') return { ok: false, error: 'formato' };
    const iterations = kdf.iterations;
    const min = ctx.minIterations ?? MIN_KDF_ITERATIONS;
    const max = ctx.maxIterations ?? MAX_KDF_ITERATIONS;
    // O arquivo traz o custo da derivação: um valor absurdo travaria o navegador, um valor baixo enfraqueceria a senha.
    if (typeof iterations !== 'number' || !Number.isInteger(iterations) || iterations < min || iterations > max) return { ok: false, error: 'kdf' };
    if (typeof kdf.salt !== 'string' || typeof cipher.iv !== 'string' || typeof r.data !== 'string') return { ok: false, error: 'formato' };
    let salt: Uint8Array;
    let iv: Uint8Array<ArrayBuffer>;
    let dados: Uint8Array<ArrayBuffer>;
    try {
      salt = base64ToBytes(kdf.salt);
      iv = base64ToBytes(cipher.iv);
      dados = base64ToBytes(r.data);
    } catch {
      return { ok: false, error: 'formato' };
    }
    if (salt.length < 16 || salt.length > 64 || iv.length !== 12 || dados.length < 17) return { ok: false, error: 'formato' };
    if (!ctx.passphrase) return { ok: false, error: 'senha-necessaria' };

    const subtle = getSubtle(ctx.subtle);
    const header: Envelope['kdf'] = { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: kdf.salt };
    let interno: unknown;
    try {
      const chave = await deriveKey(ctx.passphrase, header, subtle);
      const claro = await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aadOf(header) }, chave, dados);
      interno = JSON.parse(new TextDecoder().decode(claro));
    } catch {
      return { ok: false, error: 'senha-incorreta' }; // senha errada e arquivo adulterado são indistinguíveis (de propósito)
    }
    const v = await validateContent(interno, ctx.userId, ctx.subtle);
    return v.ok ? { ok: true, content: v.content, legacy: false } : v;
  }

  // Formato antigo (v1): JSON em claro, sem `format`.
  if (r.version === 1 && typeof r.userId === 'string') {
    const v = await fromLegacy(r, ctx.userId, ctx.subtle);
    return v.ok ? { ok: true, content: v.content, legacy: true } : v;
  }
  return { ok: false, error: 'formato' };
}

/** Texto para a pessoa, por motivo. */
export function describeBundleError(error: ReadBundleError): string {
  switch (error) {
    case 'tamanho': return 'O arquivo é grande demais para ser um backup do HiperVerso.';
    case 'json': return 'O arquivo não é um backup válido (não é JSON).';
    case 'formato': return 'O arquivo não parece ser um backup do HiperVerso.';
    case 'versao': return 'Este backup foi criado por uma versão mais nova do app. Atualize o app e tente de novo.';
    case 'senha-necessaria': return 'Este backup é protegido por senha. Informe a senha para abrir.';
    case 'senha-incorreta': return 'Senha incorreta, ou o arquivo foi alterado.';
    case 'outra-conta': return 'Este backup pertence a outra conta.';
    case 'kdf': return 'Os parâmetros de proteção do arquivo estão fora do aceitável.';
    default: return 'O conteúdo do backup é inválido e não foi importado.';
  }
}
