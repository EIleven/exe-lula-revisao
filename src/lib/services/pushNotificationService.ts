// src/lib/services/pushNotificationService.ts
'use client';
// Push das notificações, no navegador (Web Push pelo FCM, com o service worker /firebase-messaging-sw.js) e no app Android
// (plugin nativo do Capacitor, que usa o FCM do Android). O aparelho guarda o token em users/{uid}/fcmTokens/{token} (com
// plataforma e idioma) e a Function onNotificationCreatedSendPush envia o aviso para todos os aparelhos da pessoa.

import { Capacitor } from '@capacitor/core';
import { app, db } from '@/lib/firebase';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';

export type PushPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';
export type PushLocale = 'pt-BR' | 'en';

/** Canal padrão de notificações do Android (o servidor manda o mesmo id; veja functions/src/push.ts). */
const ANDROID_CHANNEL_ID = 'exelula_default';
const SW_URL = '/firebase-messaging-sw.js';
const SW_SCOPE = '/firebase-cloud-messaging-push-scope';
const TOKEN_KEY = 'exelula:push-token';
const prefKey = (userId: string) => `exelula:push:${userId}`;

const isNative = (): boolean => typeof window !== 'undefined' && Capacitor.isNativePlatform();
const normalizeLocale = (locale: string): PushLocale => (locale?.toLowerCase().startsWith('en') ? 'en' : 'pt-BR');

function storageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
  } catch { /* sem localStorage: o estado vale só até recarregar */ }
}

/** Preferência da pessoa neste aparelho: ela desligou o push de propósito? (padrão: ligado se a permissão existir). */
export function isPushTurnedOff(userId: string): boolean {
  return storageGet(prefKey(userId)) === 'off';
}

// ---------------------------------------------------------------------------------------------------------------------
// Navegador
// ---------------------------------------------------------------------------------------------------------------------

async function webSupported(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  try {
    const { isSupported } = await import('firebase/messaging');
    return await isSupported();
  } catch {
    return false;
  }
}

/** Registra o service worker do push e espera ele ficar ativo (o getToken exige um worker ativo). */
async function registerPushWorker(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
  if (registration.active) return registration;
  const worker = registration.installing ?? registration.waiting;
  if (!worker) return registration;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('O service worker de notificações demorou para ativar.')), 15_000);
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') { clearTimeout(timer); resolve(); }
      if (worker.state === 'redundant') { clearTimeout(timer); reject(new Error('O service worker de notificações não pôde ser instalado.')); }
    });
  });
  return registration;
}

async function webToken(): Promise<string> {
  const { getMessaging, getToken } = await import('firebase/messaging');
  const registration = await registerPushWorker();
  // O padrão do SDK vale: a chave VAPID pública padrão do Firebase. Uma própria só é usada se estiver configurada.
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_KEY;
  const token = await getToken(getMessaging(app), {
    serviceWorkerRegistration: registration,
    ...(vapidKey && !vapidKey.startsWith('YOUR_') ? { vapidKey } : {}),
  });
  if (!token) throw new Error('O navegador não devolveu um token de notificação.');
  return token;
}

// ---------------------------------------------------------------------------------------------------------------------
// App Android
// ---------------------------------------------------------------------------------------------------------------------

async function nativePlugin() {
  return (await import('@capacitor/push-notifications')).PushNotifications;
}

const ANDROID_CHANNELS = [
  {
    id: 'exelula_messages',
    name: 'Mensagens Diretas e Grupos',
    description: 'Novas mensagens diretas e conversas em grupo',
    importance: 4 as const,
    visibility: 0 as const,
    vibration: true,
    lights: true,
  },
  {
    id: 'exelula_security',
    name: 'Segurança e Login (IDP2P)',
    description: 'Pedidos de aprovação de novos aparelhos e alertas da conta',
    importance: 4 as const,
    visibility: 0 as const,
    vibration: true,
    lights: true,
  },
  {
    id: 'exelula_mentions',
    name: 'Menções e Respostas',
    description: 'Quando citam, mencionam ou respondem a você',
    importance: 4 as const,
    visibility: 1 as const,
    vibration: true,
    lights: true,
  },
  {
    id: ANDROID_CHANNEL_ID,
    name: 'Atividade Social',
    description: 'Curtidas, reposts e novos seguidores',
    importance: 3 as const,
    visibility: 1 as const,
    vibration: false,
    lights: true,
  },
];

let nativeChannelsCreated = false;

/** Garante os canais organizados no Android 8+ (som, vibração e destaque por categoria). */
export async function ensureNativeChannels(): Promise<void> {
  if (!isNative() || nativeChannelsCreated) return;
  try {
    const PushNotifications = await nativePlugin();
    await Promise.all(
      ANDROID_CHANNELS.map((channel) => PushNotifications.createChannel(channel).catch(() => undefined))
    );
    nativeChannelsCreated = true;
  } catch {
    // Segue sem travar caso o WebView ainda não exponha o plugin
  }
}

function friendlyNativeRegistrationError(raw: unknown): string {
  const msg = String(raw ?? '').trim();
  if (/Default FirebaseApp is not initialized|google[-_ ]?services|MISSING_INSTANCEID_SERVICE/i.test(msg)) {
    return 'Este APK precisa da atualização v1.5.0 (em /download) com suporte completo a notificações nativas.';
  }
  if (/SERVICE_NOT_AVAILABLE|FIS_AUTH_ERROR/i.test(msg)) {
    return 'Serviço de push indisponível no aparelho agora (verifique sua conexão ou o Google Play Services).';
  }
  return msg || 'Falha ao registrar o aparelho para notificações push.';
}

async function nativeToken(): Promise<string> {
  const PushNotifications = await nativePlugin();
  await ensureNativeChannels();

  return new Promise<string>((resolve, reject) => {
    const cleanup: Array<() => void> = [];
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup.forEach((remove) => remove());
      fn();
    };
    const timer = setTimeout(
      () => done(() => reject(new Error('O Android demorou para responder ao registro de notificações. Tente atualizar o app em /download.'))),
      20_000
    );

    void (async () => {
      try {
        const regHandle = await PushNotifications.addListener('registration', (result) => {
          clearTimeout(timer);
          done(() => resolve(result.value));
        });
        cleanup.push(() => void regHandle.remove().catch(() => undefined));

        const errHandle = await PushNotifications.addListener('registrationError', (error) => {
          clearTimeout(timer);
          done(() => reject(new Error(friendlyNativeRegistrationError(error?.error))));
        });
        cleanup.push(() => void errHandle.remove().catch(() => undefined));

        if (!settled) {
          await PushNotifications.register();
        }
      } catch (err) {
        clearTimeout(timer);
        done(() => reject(new Error(friendlyNativeRegistrationError(err instanceof Error ? err.message : err))));
      }
    })();
  });
}

/** Abre diretamente as configurações de notificação do app no Android quando o sistema bloqueou o pedido. */
export async function openNativeNotificationSettings(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const { registerPlugin } = await import('@capacitor/core');
    if (!Capacitor.isPluginAvailable('BiometricBridge')) return false;
    const BiometricBridge = registerPlugin<{ openNotificationSettings?: () => Promise<void> }>('BiometricBridge');
    if (typeof BiometricBridge.openNotificationSettings !== 'function') return false;
    await BiometricBridge.openNotificationSettings();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Estado e ações (as mesmas chamadas para navegador e app)
// ---------------------------------------------------------------------------------------------------------------------

/** Permissão atual deste aparelho. */
export async function getPushPermission(): Promise<PushPermission> {
  if (isNative()) {
    try {
      const status = (await (await nativePlugin()).checkPermissions()).receive;
      return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'prompt';
    } catch {
      return 'unsupported';
    }
  }
  if (!(await webSupported())) return 'unsupported';
  return Notification.permission === 'granted' ? 'granted' : Notification.permission === 'denied' ? 'denied' : 'prompt';
}

async function saveToken(userId: string, token: string, locale: string): Promise<void> {
  const platform = isNative() ? 'android' : 'web';
  const ref = doc(db, `users/${userId}/fcmTokens/${token}`);
  await setDoc(ref, {
    platform,
    locale: normalizeLocale(locale),
    registeredAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...(platform === 'web' && typeof navigator !== 'undefined' ? { userAgent: navigator.userAgent.slice(0, 300) } : {}),
  }, { merge: true });
  // Token novo no lugar de um antigo (o FCM troca de tempos em tempos): o antigo não serve mais.
  const previous = storageGet(TOKEN_KEY);
  if (previous && previous !== token) await deleteDoc(doc(db, `users/${userId}/fcmTokens/${previous}`)).catch(() => undefined);
  storageSet(TOKEN_KEY, token);
}

/** Liga o push neste aparelho: pede a permissão (se preciso), registra o aparelho e guarda o token. Lança erro com texto claro. */
export async function enablePush(userId: string, locale: string): Promise<void> {
  if (isNative()) {
    const PushNotifications = await nativePlugin();
    let receive = (await PushNotifications.checkPermissions()).receive;
    if (receive !== 'granted') receive = (await PushNotifications.requestPermissions()).receive;
    if (receive !== 'granted') throw new Error('A permissão para notificações foi negada.');
    await saveToken(userId, await nativeToken(), locale);
  } else {
    if (!(await webSupported())) throw new Error('Este navegador não oferece notificações push.');
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('A permissão para notificações foi negada.');
    await saveToken(userId, await webToken(), locale);
  }
  storageSet(prefKey(userId), 'on');
}

/** Desliga o push neste aparelho: o servidor deixa de enviar para ele. */
export async function disablePush(userId: string): Promise<void> {
  storageSet(prefKey(userId), 'off');
  const token = storageGet(TOKEN_KEY);
  try {
    if (isNative()) {
      await (await nativePlugin()).unregister().catch(() => undefined);
    } else if (await webSupported()) {
      const { deleteToken, getMessaging } = await import('firebase/messaging');
      await deleteToken(getMessaging(app)).catch(() => undefined);
    }
  } finally {
    if (token) await deleteDoc(doc(db, `users/${userId}/fcmTokens/${token}`)).catch(() => undefined);
    storageSet(TOKEN_KEY, null);
  }
}

/**
 * Mantém o token deste aparelho em dia, SEM perguntar nada: só age se a permissão já foi dada e a pessoa não desligou o
 * push. Chamado a cada sessão (o token pode mudar, e uma instalação nova precisa se registrar).
 */
export async function syncPushToken(userId: string, locale: string): Promise<void> {
  if (isPushTurnedOff(userId)) return;
  if ((await getPushPermission()) !== 'granted') return;
  const token = isNative() ? await nativeToken() : await webToken();
  await saveToken(userId, token, locale);
}

/** Este aparelho recebe push agora? (permissão dada e a pessoa não desligou). */
export async function isPushActive(userId: string): Promise<boolean> {
  return !isPushTurnedOff(userId) && (await getPushPermission()) === 'granted' && !!storageGet(TOKEN_KEY);
}

// Nomes antigos (usados pela tela de Configurações): mantidos como apelidos.
export const subscribeToPushNotifications = (userId: string, locale = 'pt-BR') => enablePush(userId, locale);
export const unsubscribeFromPushNotifications = (userId: string) => disablePush(userId);
