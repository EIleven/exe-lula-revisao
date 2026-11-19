'use client';

// src/lib/p2p/p2pAccountSwitch.ts
// Cofre local de múltiplas contas do dispositivo P2P: permite mapear contas locais, do Fediverso
// e da Atmosfera (Bluesky) usadas no mesmo aparelho, trocar de conta em 1 toque ou unificá-las.

import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { getOrCreateDeviceId, getDeviceFriendlyLabel } from '@/lib/p2p/p2pDevicePairing';

const DEVICE_ACCOUNTS_KEY = 'exelula:device-accounts:v1';
const PROMPT_DISMISSED_PREFIX = 'exelula:device-merge-dismissed:';

export interface DeviceSavedAccount {
  uid: string;
  name: string;
  username: string;
  avatarUrl: string;
  provider: string;
  federatedHandle?: string;
  switchSecret?: string;
  lastActiveAt: number;
}

export function getDeviceSavedAccounts(): DeviceSavedAccount[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(DEVICE_ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is DeviceSavedAccount =>
        Boolean(item && typeof item.uid === 'string' && typeof item.username === 'string')
    );
  } catch {
    return [];
  }
}

export function saveDeviceAccountsList(accounts: DeviceSavedAccount[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DEVICE_ACCOUNTS_KEY, JSON.stringify(accounts.slice(0, 12)));
    window.dispatchEvent(new CustomEvent('idp2p:device-accounts-changed'));
  } catch {
    // ignore storage errors
  }
}

export function removeDeviceSavedAccount(uid: string): void {
  const list = getDeviceSavedAccounts().filter((a) => a.uid !== uid);
  saveDeviceAccountsList(list);
}

export function isMergePromptDismissed(primaryUid: string, secondaryUid: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return (
      window.sessionStorage.getItem(`${PROMPT_DISMISSED_PREFIX}${primaryUid}:${secondaryUid}`) ===
      '1'
    );
  } catch {
    return false;
  }
}

export function dismissMergePrompt(primaryUid: string, secondaryUid: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(`${PROMPT_DISMISSED_PREFIX}${primaryUid}:${secondaryUid}`, '1');
  } catch {
    // ignore
  }
}

export async function registerCurrentAccountOnP2pDevice(user: {
  id: string;
  name: string;
  username: string;
  avatarUrl?: string;
  federatedLoginProvider?: string;
  federatedLoginHandle?: string;
}): Promise<DeviceSavedAccount[]> {
  if (typeof window === 'undefined' || !user?.id) return [];
  const existing = getDeviceSavedAccounts();
  const prevEntry = existing.find((a) => a.uid === user.id);

  let switchSecret = prevEntry?.switchSecret;
  try {
    const token = await auth.currentUser?.getIdToken().catch(() => null);
    if (token) {
      const res = await fetch('/api/idp2p/switch-account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'register-device',
          deviceId: getOrCreateDeviceId(),
          deviceLabel: getDeviceFriendlyLabel(),
          existingSecret: switchSecret || undefined,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { switchSecret?: string };
        if (data.switchSecret) {
          switchSecret = data.switchSecret;
        }
      }
    }
  } catch {
    // best-effort registration
  }

  const updatedEntry: DeviceSavedAccount = {
    uid: user.id,
    name: user.name || user.username,
    username: user.username,
    avatarUrl: user.avatarUrl || '',
    provider: user.federatedLoginProvider || 'exercitodolula',
    federatedHandle: user.federatedLoginHandle,
    switchSecret,
    lastActiveAt: Date.now(),
  };

  const nextList = [updatedEntry, ...existing.filter((a) => a.uid !== user.id)].slice(0, 10);
  saveDeviceAccountsList(nextList);
  return nextList;
}

export async function switchToDeviceAccount(targetUid: string): Promise<boolean> {
  const accounts = getDeviceSavedAccounts();
  const target = accounts.find((a) => a.uid === targetUid);
  if (!target?.switchSecret) {
    throw new Error('Valide esta conta uma vez neste aparelho para ativar a troca em 1 toque.');
  }

  const res = await fetch('/api/idp2p/switch-account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'switch',
      targetUid,
      deviceId: getOrCreateDeviceId(),
      switchSecret: target.switchSecret,
    }),
  });

  if (!res.ok) {
    throw new Error('Sessão de troca rápida expirada. Entre novamente na conta.');
  }

  const data = (await res.json()) as { customToken?: string };
  if (!data.customToken) {
    throw new Error('Token de troca indisponível.');
  }

  await signInWithCustomToken(auth, data.customToken);
  return true;
}

export async function unifyCurrentAccountIntoPrimary(primaryUid: string): Promise<boolean> {
  const accounts = getDeviceSavedAccounts();
  const primary = accounts.find((a) => a.uid === primaryUid);
  if (!primary?.switchSecret) {
    throw new Error('Chave do dispositivo da conta principal não encontrada.');
  }
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sessão atual não autenticada.');

  const res = await fetch('/api/idp2p/switch-account', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: 'unify-into-primary',
      primaryUid,
      deviceId: getOrCreateDeviceId(),
      primarySwitchSecret: primary.switchSecret,
    }),
  });

  if (!res.ok) {
    const errData = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errData.error || 'Não foi possível unificar as contas.');
  }

  const data = (await res.json()) as { customToken?: string; removedUid?: string };
  if (data.removedUid) {
    removeDeviceSavedAccount(data.removedUid);
  }
  if (data.customToken) {
    await signInWithCustomToken(auth, data.customToken);
  }
  return true;
}

