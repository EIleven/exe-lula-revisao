// src/lib/crypto/fileVaultCrypto.ts
// Criptografia local AES-GCM-256 para "Meus Arquivos" (infra P2P / Zero-Knowledge).
// Os arquivos são cifrados no navegador antes do upload (.lulaenc) e decifrados apenas no aparelho autorizado.

const VAULT_SETTINGS_PREFIX = 'exelula:files:vault-settings:v1:';
const VAULT_KEY_PREFIX = 'exelula:files:vault-key:v1:';
const MAGIC_HEADER = new Uint8Array([0x4c, 0x55, 0x4c, 0x41, 0x45, 0x4e, 0x43, 0x31]); // "LULAENC1"

export interface FileVaultSettings {
  encryptOnUpload: boolean;
  p2pSyncKeys: boolean;
}

export const DEFAULT_FILE_VAULT_SETTINGS: FileVaultSettings = {
  encryptOnUpload: false,
  p2pSyncKeys: true,
};

export function isEncryptedFileName(name: string): boolean {
  return name.toLowerCase().endsWith('.lulaenc');
}

export function stripEncryptedExtension(name: string): string {
  return isEncryptedFileName(name) ? name.slice(0, -'.lulaenc'.length) : name;
}

export function getFileVaultSettings(userId: string): FileVaultSettings {
  if (typeof window === 'undefined' || !userId) return { ...DEFAULT_FILE_VAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(`${VAULT_SETTINGS_PREFIX}${userId}`);
    if (!raw) return { ...DEFAULT_FILE_VAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<FileVaultSettings>;
    return {
      encryptOnUpload: Boolean(parsed.encryptOnUpload),
      p2pSyncKeys: parsed.p2pSyncKeys !== false,
    };
  } catch {
    return { ...DEFAULT_FILE_VAULT_SETTINGS };
  }
}

export function saveFileVaultSettings(userId: string, settings: FileVaultSettings): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    window.localStorage.setItem(`${VAULT_SETTINGS_PREFIX}${userId}`, JSON.stringify(settings));
  } catch {
    // Ignora quota/privado
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function getOrCreateLocalFileSecret(userId: string): string {
  if (typeof window === 'undefined') return '';
  const storageKey = `${VAULT_KEY_PREFIX}${userId}`;
  const existing = window.localStorage.getItem(storageKey);
  if (existing && existing.length >= 16) return existing;
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  const secret = bytesToBase64(randomBytes);
  window.localStorage.setItem(storageKey, secret);
  return secret;
}

export function exportLocalFileSecret(userId: string): string {
  return getOrCreateLocalFileSecret(userId);
}

export function importLocalFileSecret(userId: string, secret: string): boolean {
  const trimmed = secret.trim();
  if (trimmed.length < 16 || typeof window === 'undefined') return false;
  window.localStorage.setItem(`${VAULT_KEY_PREFIX}${userId}`, trimmed);
  return true;
}

async function deriveAesKey(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 250_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptFileForUpload(file: File, userId: string): Promise<File> {
  const secret = getOrCreateLocalFileSecret(userId);
  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(salt);
  crypto.getRandomValues(iv);

  const key = await deriveAesKey(secret, salt);
  const plainBuffer = await file.arrayBuffer();
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    plainBuffer,
  );

  const cipherBytes = new Uint8Array(cipherBuffer);
  const output = new Uint8Array(MAGIC_HEADER.length + salt.length + iv.length + cipherBytes.length);
  output.set(MAGIC_HEADER, 0);
  output.set(salt, MAGIC_HEADER.length);
  output.set(iv, MAGIC_HEADER.length + salt.length);
  output.set(cipherBytes, MAGIC_HEADER.length + salt.length + iv.length);

  const outName = isEncryptedFileName(file.name) ? file.name : `${file.name}.lulaenc`;
  return new File([output], outName, { type: 'application/octet-stream' });
}

export async function decryptFileBytes(buffer: ArrayBuffer, userId: string): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(buffer);
  const headerLen = MAGIC_HEADER.length;
  if (bytes.length < headerLen + 16 + 12 + 16) {
    throw new Error('Arquivo cifrado inválido ou corrompido.');
  }
  for (let i = 0; i < headerLen; i += 1) {
    if (bytes[i] !== MAGIC_HEADER[i]) {
      throw new Error('Cabeçalho de criptografia não reconhecido.');
    }
  }
  const salt = bytes.slice(headerLen, headerLen + 16);
  const iv = bytes.slice(headerLen + 16, headerLen + 28);
  const ciphertext = bytes.slice(headerLen + 28);

  const secret = getOrCreateLocalFileSecret(userId);
  const key = await deriveAesKey(secret, salt);
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  );
}

