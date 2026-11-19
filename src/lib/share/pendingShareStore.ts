// src/lib/share/pendingShareStore.ts
'use client';

import { Capacitor, registerPlugin } from '@capacitor/core';

export interface IncomingSharePayload {
  title: string;
  text: string;
  url: string;
  files: File[];
  source: 'android' | 'web';
}

interface NativeSharedFileDescriptor {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

interface NativePendingShareResult {
  hasShare?: boolean;
  title?: string;
  text?: string;
  files?: NativeSharedFileDescriptor[];
}

interface NativeReadFileResult {
  id: string;
  name: string;
  mimeType: string;
  base64: string;
}

interface ShareBridgePluginInterface {
  consumePendingShare: () => Promise<NativePendingShareResult>;
  readSharedFile: (opts: { id: string }) => Promise<NativeReadFileResult>;
  clearSharedFiles: () => Promise<void>;
  addListener: (
    eventName: 'shareReceived',
    listenerFunc: (data: { hasShare?: boolean }) => void
  ) => Promise<{ remove: () => Promise<void> }>;
}

const SESSION_KEY = 'exelula:pending-share:v1';
let memoryShare: IncomingSharePayload | null = null;

function base64ToFile(base64: string, name: string, mimeType: string): File {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], name || 'compartilhado', {
    type: mimeType || 'application/octet-stream',
  });
}

/** Separa título, URL detectada e texto limpo de qualquer conteúdo compartilhado. */
export function extractShareParts(raw: {
  title?: string | null;
  text?: string | null;
  url?: string | null;
}): { title: string; text: string; url: string; combinedText: string } {
  const title = (raw.title || '').trim();
  let text = (raw.text || '').trim();
  let url = (raw.url || '').trim();

  if (!url && text) {
    const match = text.match(/https?:\/\/[^\s<>"')\]]+/i);
    if (match?.[0]) {
      url = match[0].replace(/[.,;!?]+$/, '');
    }
  }

  const parts: string[] = [];
  if (title && !text.includes(title)) parts.push(title);
  if (text) parts.push(text);
  if (url && !text.includes(url)) parts.push(url);
  const combinedText = parts.join('\n\n').trim();

  return { title, text, url, combinedText };
}

export function setPendingShare(payload: IncomingSharePayload | null): void {
  memoryShare = payload;
  if (typeof window === 'undefined') return;
  try {
    if (!payload) {
      sessionStorage.removeItem(SESSION_KEY);
      return;
    }
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        title: payload.title,
        text: payload.text,
        url: payload.url,
        source: payload.source,
      })
    );
  } catch {
    // ignore storage errors
  }
}

export function getPendingShare(): IncomingSharePayload | null {
  if (memoryShare) return memoryShare;
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<IncomingSharePayload>;
    if (!parsed.title && !parsed.text && !parsed.url) return null;
    return {
      title: String(parsed.title || ''),
      text: String(parsed.text || ''),
      url: String(parsed.url || ''),
      files: [],
      source: parsed.source === 'android' ? 'android' : 'web',
    };
  } catch {
    return null;
  }
}

export function clearPendingShare(): void {
  setPendingShare(null);
}

export function getShareBridgePlugin(): ShareBridgePluginInterface | null {
  if (typeof window === 'undefined' || !Capacitor.isNativePlatform()) return null;
  if (!Capacitor.isPluginAvailable('ShareBridge')) return null;
  return registerPlugin<ShareBridgePluginInterface>('ShareBridge');
}

/** Lê e consome um compartilhamento nativo pendente vindo do sistema Android. */
export async function consumeNativeAndroidShare(): Promise<IncomingSharePayload | null> {
  const plugin = getShareBridgePlugin();
  if (!plugin) return null;
  try {
    const pending = await plugin.consumePendingShare();
    if (!pending?.hasShare) return null;

    const files: File[] = [];
    for (const descriptor of pending.files ?? []) {
      try {
        const read = await plugin.readSharedFile({ id: descriptor.id });
        if (read?.base64) {
          files.push(base64ToFile(read.base64, read.name || descriptor.name, read.mimeType || descriptor.mimeType));
        }
      } catch (err) {
        console.warn('[ShareBridge] Não foi possível ler anexo compartilhado:', err);
      }
    }

    const parts = extractShareParts({
      title: pending.title,
      text: pending.text,
    });

    if (!parts.combinedText && files.length === 0) return null;

    const payload: IncomingSharePayload = {
      title: parts.title,
      text: parts.text,
      url: parts.url,
      files,
      source: 'android',
    };
    setPendingShare(payload);
    return payload;
  } catch (err) {
    console.warn('[ShareBridge] Falha ao ler compartilhamento pendente:', err);
    return null;
  }
}

