// src/lib/crypto/sovereignKeyring.ts
/**
 * Sistema Soberano de Chaves P2P e Passe QR — HiperVerso
 *
 * Arquitetura 100% local e controlada pelo usuário:
 * - Cada aplicação/serviço recebe um par assimétrico próprio (ECDSA P-256).
 * - A chave privada nunca sai do dispositivo do usuário em texto claro.
 * - O acesso via QR Code gera um passe curto assinado (exelula-pass:v1) com nonce anti-replay e TTL.
 * - A validação é 100% offline/criptográfica: qualquer app ou dispositivo valida sem servidor central.
 * - A sincronização entre aparelhos usa envelope cifrado AES-GCM-256 (PBKDF2 250k iterações).
 */

export type KeyScope = 'acesso-total' | 'leitura' | 'sessao-unica' | string;

export interface SovereignAccessKey {
  id: string;
  appName: string;
  providerDomain: string; // '*' = qualquer aplicação/provedor, ou domínio específico
  scope: KeyScope;
  fingerprint: string;
  publicKeySpkiB64: string;
  privateKeyJwk: JsonWebKey;
  createdAt: number;
  lastUsedAt?: number;
  revoked: boolean;
  boundDeviceIds?: string[]; // se preenchido, só dispositivos autorizados podem usar
}

export interface QrPassPayload {
  v: 1;
  kind: 'exelula-pass';
  keyId: string;
  appName: string;
  providerDomain: string;
  scope: KeyScope;
  userId: string;
  deviceId: string;
  fingerprint: string;
  publicKeySpkiB64: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

export type VerifyQrPassResult =
  | { valid: true; payload: QrPassPayload; expiresInSec: number }
  | {
      valid: false;
      code:
        | 'INVALID_FORMAT'
        | 'TAMPERED'
        | 'EXPIRED'
        | 'REPLAY'
        | 'REVOKED'
        | 'FINGERPRINT_MISMATCH'
        | 'PROVIDER_BLOCKED'
        | 'PROVIDER_MISMATCH'
        | 'DEVICE_NOT_AUTHORIZED';
      reason: string;
    };

export interface EncryptedKeyringBundle {
  v: 1;
  kind: 'exelula-keyring-bundle';
  saltB64: string;
  ivB64: string;
  ciphertextB64: string;
  keyCount: number;
  createdAt: number;
}

const STORAGE_PREFIX = 'exelula_sovereign_keyring_v1:';
const BLOCKED_PROVIDERS_PREFIX = 'exelula_sovereign_blocked_providers_v1:';
const NONCE_STORAGE_KEY = 'exelula_sovereign_used_nonces_v1';
const PASS_PREFIX = 'exelula-pass:v1.';
const PBKDF2_ITERATIONS = 250_000;

export function normalizeProviderDomain(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === '*') return '*';
  try {
    if (trimmed.includes('://')) {
      return new URL(trimmed).hostname.toLowerCase();
    }
  } catch {
    // fallback abaixo
  }
  return trimmed.replace(/^https?:\/\//, '').split('/')[0]!.split(':')[0]!.trim() || '*';
}

export function isProviderBlocked(domain: string, blockedList: readonly string[]): boolean {
  const clean = normalizeProviderDomain(domain);
  if (!clean || clean === '*') return false;
  return blockedList.some((entry) => {
    const b = normalizeProviderDomain(entry);
    if (!b || b === '*') return false;
    return clean === b || clean.endsWith(`.${b}`);
  });
}

export function loadBlockedProviders(userId: string): string[] {
  if (typeof window === 'undefined' || !window.localStorage || !userId) return [];
  try {
    const raw = window.localStorage.getItem(`${BLOCKED_PROVIDERS_PREFIX}${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveBlockedProviders(userId: string, providers: string[]): void {
  if (typeof window === 'undefined' || !window.localStorage || !userId) return;
  const unique = Array.from(new Set(providers.map(normalizeProviderDomain).filter((x) => x && x !== '*')));
  window.localStorage.setItem(`${BLOCKED_PROVIDERS_PREFIX}${userId}`, JSON.stringify(unique));
}

const inMemoryUsedNonces = new Map<string, number>();

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Web Crypto API (SubtleCrypto) indisponível neste ambiente.');
  }
  return subtle;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(b64u: string): Uint8Array {
  const norm = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4));
  const binary = atob(norm + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export async function computeKeyFingerprint(publicKeySpkiB64: string): Promise<string> {
  const subtle = getSubtle();
  const digest = new Uint8Array(await subtle.digest('SHA-256', toArrayBuffer(base64UrlToBytes(publicKeySpkiB64))));
  const hex = Array.from(digest.slice(0, 6))
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
  return `LULA-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

export function canonicalPassPayload(payload: QrPassPayload): string {
  return JSON.stringify([
    payload.v,
    payload.kind,
    payload.keyId,
    payload.appName,
    payload.providerDomain,
    payload.scope,
    payload.userId,
    payload.deviceId,
    payload.fingerprint,
    payload.publicKeySpkiB64,
    payload.nonce,
    payload.issuedAt,
    payload.expiresAt,
  ]);
}

export async function createSovereignAccessKey(
  appName: string,
  scope: KeyScope = 'acesso-total',
  providerDomain = '*',
  boundDeviceIds?: string[],
): Promise<SovereignAccessKey> {
  const cleanName = appName.trim();
  if (!cleanName) throw new Error('Informe o nome da aplicação ou serviço.');
  const subtle = getSubtle();
  const pair = await subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const spki = new Uint8Array(await subtle.exportKey('spki', pair.publicKey));
  const publicKeySpkiB64 = bytesToBase64Url(spki);
  const privateKeyJwk = await subtle.exportKey('jwk', pair.privateKey);
  const fingerprint = await computeKeyFingerprint(publicKeySpkiB64);

  return {
    id: bytesToBase64Url(randomBytes(12)),
    appName: cleanName,
    providerDomain: normalizeProviderDomain(providerDomain),
    scope: scope.trim() || 'acesso-total',
    fingerprint,
    publicKeySpkiB64,
    privateKeyJwk,
    createdAt: Date.now(),
    revoked: false,
    ...(boundDeviceIds && boundDeviceIds.length > 0 ? { boundDeviceIds } : {}),
  };
}

export async function createSignedQrPass(params: {
  key: SovereignAccessKey;
  userId: string;
  deviceId: string;
  targetProvider?: string;
  blockedProviders?: readonly string[];
  ttlSeconds?: number;
  nowMs?: number;
}): Promise<{ token: string; payload: QrPassPayload }> {
  const {
    key,
    userId,
    deviceId,
    targetProvider,
    blockedProviders = [],
    ttlSeconds = 120,
    nowMs = Date.now(),
  } = params;
  if (key.revoked) {
    throw new Error('Esta chave foi revogada. Reative-a ou crie uma nova chave.');
  }
  if (key.boundDeviceIds && key.boundDeviceIds.length > 0 && !key.boundDeviceIds.includes(deviceId)) {
    throw new Error('Este aparelho não está autorizado para usar esta chave.');
  }
  const effectiveProvider = normalizeProviderDomain(targetProvider || key.providerDomain || '*');
  if (isProviderBlocked(effectiveProvider, blockedProviders)) {
    throw new Error(`O provedor "${effectiveProvider}" está bloqueado por você.`);
  }
  const subtle = getSubtle();
  const privateKey = await subtle.importKey(
    'jwk',
    key.privateKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const payload: QrPassPayload = {
    v: 1,
    kind: 'exelula-pass',
    keyId: key.id,
    appName: key.appName,
    providerDomain: effectiveProvider,
    scope: key.scope,
    userId,
    deviceId,
    fingerprint: key.fingerprint,
    publicKeySpkiB64: key.publicKeySpkiB64,
    nonce: bytesToBase64Url(randomBytes(16)),
    issuedAt: nowMs,
    expiresAt: nowMs + Math.max(15, ttlSeconds) * 1000,
  };

  const canonicalBytes = utf8ToBytes(canonicalPassPayload(payload));
  const signature = new Uint8Array(
    await subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      toArrayBuffer(canonicalBytes),
    ),
  );

  const payloadB64 = bytesToBase64Url(utf8ToBytes(JSON.stringify(payload)));
  const sigB64 = bytesToBase64Url(signature);
  return {
    token: `${PASS_PREFIX}${payloadB64}.${sigB64}`,
    payload,
  };
}

function readUsedNonces(nowMs: number): Map<string, number> {
  const map = new Map<string, number>();
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(NONCE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, number>;
        for (const [k, exp] of Object.entries(parsed)) {
          if (typeof exp === 'number' && exp > nowMs) map.set(k, exp);
        }
      }
    } catch {
      // ignora erro de storage
    }
  }
  for (const [k, exp] of inMemoryUsedNonces.entries()) {
    if (exp > nowMs) map.set(k, exp);
    else inMemoryUsedNonces.delete(k);
  }
  return map;
}

function markNonceUsed(nonce: string, expiresAt: number): void {
  inMemoryUsedNonces.set(nonce, expiresAt);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const merged = readUsedNonces(Date.now());
      merged.set(nonce, expiresAt);
      const obj: Record<string, number> = {};
      for (const [k, v] of merged.entries()) obj[k] = v;
      window.localStorage.setItem(NONCE_STORAGE_KEY, JSON.stringify(obj));
    } catch {
      // ignora erro de quota
    }
  }
}

export async function verifySignedQrPass(
  token: string,
  options?: {
    nowMs?: number;
    consumeNonce?: boolean;
    revokedKeyIds?: ReadonlySet<string>;
    blockedProviders?: readonly string[];
    expectedProvider?: string;
    authorizedDeviceIds?: ReadonlySet<string>;
  },
): Promise<VerifyQrPassResult> {
  const nowMs = options?.nowMs ?? Date.now();
  const consumeNonce = options?.consumeNonce ?? true;
  const trimmed = token.trim();

  if (!trimmed.startsWith(PASS_PREFIX)) {
    return { valid: false, code: 'INVALID_FORMAT', reason: 'Formato inválido (esperado exelula-pass:v1).' };
  }

  const body = trimmed.slice(PASS_PREFIX.length);
  const parts = body.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, code: 'INVALID_FORMAT', reason: 'Passe QR incompleto ou corrompido.' };
  }

  let payload: QrPassPayload;
  let signatureBytes: Uint8Array;
  try {
    payload = JSON.parse(bytesToUtf8(base64UrlToBytes(parts[0]))) as QrPassPayload;
    signatureBytes = base64UrlToBytes(parts[1]);
  } catch {
    return { valid: false, code: 'INVALID_FORMAT', reason: 'Não foi possível decodificar o payload do passe.' };
  }

  if (
    !payload ||
    payload.v !== 1 ||
    payload.kind !== 'exelula-pass' ||
    typeof payload.keyId !== 'string' ||
    typeof payload.publicKeySpkiB64 !== 'string' ||
    typeof payload.nonce !== 'string' ||
    typeof payload.expiresAt !== 'number' ||
    typeof payload.issuedAt !== 'number'
  ) {
    return { valid: false, code: 'INVALID_FORMAT', reason: 'Campos obrigatórios ausentes no passe.' };
  }

  if (options?.revokedKeyIds?.has(payload.keyId)) {
    return { valid: false, code: 'REVOKED', reason: 'Esta chave foi revogada pelo usuário.' };
  }

  if (options?.authorizedDeviceIds && !options.authorizedDeviceIds.has(payload.deviceId)) {
    return {
      valid: false,
      code: 'DEVICE_NOT_AUTHORIZED',
      reason: 'Dispositivo não autorizado na lista de aparelhos vinculados do usuário.',
    };
  }

  const providerToCheck = options?.expectedProvider
    ? normalizeProviderDomain(options.expectedProvider)
    : normalizeProviderDomain(payload.providerDomain || '*');
  if (options?.blockedProviders && isProviderBlocked(providerToCheck, options.blockedProviders)) {
    return {
      valid: false,
      code: 'PROVIDER_BLOCKED',
      reason: `Provedor "${providerToCheck}" bloqueado pelo usuário.`,
    };
  }
  if (
    options?.expectedProvider &&
    payload.providerDomain &&
    payload.providerDomain !== '*' &&
    normalizeProviderDomain(payload.providerDomain) !== providerToCheck
  ) {
    return {
      valid: false,
      code: 'PROVIDER_MISMATCH',
      reason: `Chave restrita a "${payload.providerDomain}" (não autorizada para "${providerToCheck}").`,
    };
  }

  if (nowMs > payload.expiresAt || payload.issuedAt > nowMs + 30_000) {
    return { valid: false, code: 'EXPIRED', reason: 'Passe QR expirado. Gere um novo passe no aparelho.' };
  }

  const usedNonces = readUsedNonces(nowMs);
  if (usedNonces.has(payload.nonce)) {
    return { valid: false, code: 'REPLAY', reason: 'Este Passe QR já foi utilizado (proteção anti-replay).' };
  }

  try {
    const expectedFp = await computeKeyFingerprint(payload.publicKeySpkiB64);
    if (expectedFp !== payload.fingerprint) {
      return { valid: false, code: 'FINGERPRINT_MISMATCH', reason: 'Impressão digital da chave não confere.' };
    }

    const subtle = getSubtle();
    const publicKey = await subtle.importKey(
      'spki',
      toArrayBuffer(base64UrlToBytes(payload.publicKeySpkiB64)),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const canonicalBytes = utf8ToBytes(canonicalPassPayload(payload));
    const ok = await subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      toArrayBuffer(signatureBytes),
      toArrayBuffer(canonicalBytes),
    );
    if (!ok) {
      return { valid: false, code: 'TAMPERED', reason: 'Assinatura ECDSA P-256 inválida ou payload adulterado.' };
    }
  } catch {
    return { valid: false, code: 'TAMPERED', reason: 'Falha ao verificar a assinatura criptográfica.' };
  }

  if (consumeNonce) {
    markNonceUsed(payload.nonce, payload.expiresAt);
  }

  return {
    valid: true,
    payload,
    expiresInSec: Math.max(0, Math.ceil((payload.expiresAt - nowMs) / 1000)),
  };
}

async function deriveBundleAesKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = getSubtle();
  const baseKey = await subtle.importKey(
    'raw',
    toArrayBuffer(utf8ToBytes(passphrase)),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptKeyringForTransfer(
  keys: SovereignAccessKey[],
  passphrase: string,
): Promise<EncryptedKeyringBundle> {
  if (passphrase.trim().length < 6) {
    throw new Error('Use uma frase-chave com pelo menos 6 caracteres para cifrar o cofre.');
  }
  const subtle = getSubtle();
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const aesKey = await deriveBundleAesKey(passphrase, salt);
  const plaintext = utf8ToBytes(JSON.stringify(keys));
  const ciphertext = new Uint8Array(
    await subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      aesKey,
      toArrayBuffer(plaintext),
    ),
  );
  return {
    v: 1,
    kind: 'exelula-keyring-bundle',
    saltB64: bytesToBase64Url(salt),
    ivB64: bytesToBase64Url(iv),
    ciphertextB64: bytesToBase64Url(ciphertext),
    keyCount: keys.length,
    createdAt: Date.now(),
  };
}

export async function decryptKeyringTransfer(
  bundle: EncryptedKeyringBundle,
  passphrase: string,
): Promise<SovereignAccessKey[]> {
  if (!bundle || bundle.v !== 1 || bundle.kind !== 'exelula-keyring-bundle') {
    throw new Error('Formato de cofre cifrado inválido.');
  }
  const subtle = getSubtle();
  const salt = base64UrlToBytes(bundle.saltB64);
  const iv = base64UrlToBytes(bundle.ivB64);
  const ciphertext = base64UrlToBytes(bundle.ciphertextB64);
  const aesKey = await deriveBundleAesKey(passphrase, salt);
  const decrypted = new Uint8Array(
    await subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      aesKey,
      toArrayBuffer(ciphertext),
    ),
  );
  const parsed = JSON.parse(bytesToUtf8(decrypted)) as SovereignAccessKey[];
  if (!Array.isArray(parsed)) throw new Error('Conteúdo do cofre inválido.');
  return parsed;
}

export function loadLocalKeyring(userId: string): SovereignAccessKey[] {
  if (typeof window === 'undefined' || !window.localStorage || !userId) return [];
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SovereignAccessKey[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalKeyring(userId: string, keys: SovereignAccessKey[]): void {
  if (typeof window === 'undefined' || !window.localStorage || !userId) return;
  window.localStorage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(keys));
}

export function mergeKeyrings(existing: SovereignAccessKey[], incoming: SovereignAccessKey[]): SovereignAccessKey[] {
  const byId = new Map<string, SovereignAccessKey>();
  for (const k of existing) byId.set(k.id, k);
  for (const k of incoming) {
    const prev = byId.get(k.id);
    if (!prev) {
      byId.set(k.id, k);
    } else {
      byId.set(k.id, {
        ...prev,
        ...k,
        revoked: prev.revoked || k.revoked,
      });
    }
  }
  return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
}
