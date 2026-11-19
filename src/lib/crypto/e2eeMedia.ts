// src/lib/crypto/e2eeMedia.ts
'use client';

import {
  decryptDirectMessage,
  encryptDirectMessage,
  isWebCryptoSupported,
  type E2eeEncryptedPayload,
} from './e2ee';
import { base64ToBytes, bytesToBase64 } from './e2eeKeyring';

export type DecryptedMediaResult =
  | { ok: true; objectUrl: string; mime: string }
  | { ok: false; reason: 'unsupported' | 'missing-key' | 'fetch-failed' | 'decrypt-failed' };

interface MediaKeyDescriptor {
  v: 1;
  k: string;
  iv: string;
  mime: string;
  name?: string;
}

const decryptedCache = new Map<string, Promise<DecryptedMediaResult>>();

/**
 * Abre SÓ o descritor (a chave e o formato do arquivo), sem tocar nos bytes da mídia.
 *
 * Serve para a tela decidir o que fazer antes de baixar nada: um anexo v1 é pequeno e pode abrir sozinho; um v2 pode
 * ter 200 MB, e começar a baixar isso porque o balão apareceu na rolagem seria queimar a internet de quem usa.
 */
export async function lerDescritorDeMidia(
  mediaE2ee: E2eeEncryptedPayload,
  currentUserId: string,
  isSender: boolean,
  peerPublicKeyJson?: string | null,
): Promise<{ v: number; bruto: unknown } | null> {
  if (!isWebCryptoSupported()) return null;
  try {
    const dec = await decryptDirectMessage(mediaE2ee, currentUserId, isSender, peerPublicKeyJson);
    if (!dec.ok) return null;
    const bruto = JSON.parse(dec.text) as { v?: unknown };
    const v = typeof bruto?.v === 'number' ? bruto.v : 0;
    return { v, bruto };
  } catch {
    return null;
  }
}

export async function encryptMediaFileForDm(
  file: File,
  senderUserId: string,
  recipientPublicKeyJson?: string | null
): Promise<{ encryptedFile: File; mediaE2ee: E2eeEncryptedPayload } | null> {
  if (!isWebCryptoSupported() || !senderUserId || !recipientPublicKeyJson) return null;
  try {
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aesKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
    const plainBytes = await file.arrayBuffer();
    const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plainBytes);

    const descriptor: MediaKeyDescriptor = {
      v: 1,
      k: bytesToBase64(rawKey),
      iv: bytesToBase64(iv),
      mime: file.type || 'application/octet-stream',
      name: file.name.slice(0, 120),
    };
    const mediaE2ee = await encryptDirectMessage(
      JSON.stringify(descriptor),
      senderUserId,
      recipientPublicKeyJson
    );
    if (!mediaE2ee) return null;

    const encName =
      typeof crypto.randomUUID === 'function'
        ? `${crypto.randomUUID()}.enc`
        : `media_${Date.now()}.enc`;
    const encryptedFile = new File([cipherBuf], encName, { type: 'application/octet-stream' });
    return { encryptedFile, mediaE2ee };
  } catch {
    return null;
  }
}

export function decryptMediaToObjectUrl(
  fileUrl: string,
  mediaE2ee: E2eeEncryptedPayload,
  currentUserId: string,
  isSender: boolean,
  peerPublicKeyJson?: string | null
): Promise<DecryptedMediaResult> {
  if (!isWebCryptoSupported()) {
    return Promise.resolve({ ok: false, reason: 'unsupported' });
  }
  const cacheKey = `${fileUrl}:${currentUserId}`;
  const existing = decryptedCache.get(cacheKey);
  if (existing) return existing;

  const task = (async (): Promise<DecryptedMediaResult> => {
    try {
      const decMeta = await decryptDirectMessage(
        mediaE2ee,
        currentUserId,
        isSender,
        peerPublicKeyJson
      );
      if (!decMeta.ok) {
        return {
          ok: false,
          reason:
            decMeta.reason === 'missing-key' || decMeta.reason === 'key-not-in-keyring'
              ? 'missing-key'
              : 'decrypt-failed',
        };
      }

      const desc = JSON.parse(decMeta.text) as MediaKeyDescriptor;
      if (!desc || desc.v !== 1 || typeof desc.k !== 'string' || typeof desc.iv !== 'string') {
        return { ok: false, reason: 'decrypt-failed' };
      }

      const res = await fetch(fileUrl);
      if (!res.ok) return { ok: false, reason: 'fetch-failed' };
      const cipherBuf = await res.arrayBuffer();

      const rawKey = base64ToBytes(desc.k);
      const iv = base64ToBytes(desc.iv);
      const aesKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
      const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, cipherBuf);
      const mime = desc.mime || 'application/octet-stream';
      const objectUrl = URL.createObjectURL(new Blob([plainBuf], { type: mime }));
      return { ok: true, objectUrl, mime };
    } catch {
      return { ok: false, reason: 'decrypt-failed' };
    }
  })();

  decryptedCache.set(cacheKey, task);
  void task.then((res) => {
    if (!res.ok) decryptedCache.delete(cacheKey);
  });
  return task;
}

