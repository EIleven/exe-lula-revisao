/* eslint-disable no-restricted-globals */
// Service worker das notificações push (FCM) do Exe. Lula. Sem bibliotecas: o navegador entrega o evento `push`, este
// arquivo mostra o aviso e, ao tocar, abre o destino certo (o post, o comentário, o perfil ou a conversa).
// Fica registrado no escopo /firebase-cloud-messaging-push-scope, separado do service worker de cache do site (sw.js).

const DEFAULT_ICON = '/icons/icon-192.png';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function readPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    try {
      return { notification: { body: event.data.text() } };
    } catch {
      return {};
    }
  }
}

/** Há uma janela do app visível e em foco? Nesse caso a tela já mostra a novidade (as notificações são em tempo real). */
async function appIsInFocus() {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return windows.some((client) => client.visibilityState === 'visible' && client.focused);
}

self.addEventListener('push', (event) => {
  const payload = readPayload(event);
  const notification = payload.notification || {};
  const data = payload.data || {};
  const link = data.url || (payload.fcmOptions && payload.fcmOptions.link) || (payload.fcm_options && payload.fcm_options.link) || '/';
  const tag = notification.tag || data.tag || undefined;
  const options = {
    body: notification.body || data.body || '',
    icon: notification.icon || data.icon || DEFAULT_ICON,
    badge: notification.badge || data.badge || DEFAULT_ICON,
    tag,
    renotify: Boolean(tag),
    vibrate: [60, 40, 60], // vibração leve no Android; o navegador ignora onde não existe
    data: { url: link, type: data.type || '', notificationId: data.notificationId || '' },
  };
  const title = notification.title || data.title || 'Exe. Lula';

  event.waitUntil((async () => {
    if (await appIsInFocus()) return; // a pessoa já está olhando o app: sem aviso duplicado
    await self.registration.showNotification(title, options);
  })());
});

/** Mensagem para a página navegar sem recarregar; se ninguém confirmar a tempo, abre o endereço direto. */
function askPageToNavigate(client, url) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), 450);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      resolve(true);
    };
    try {
      client.postMessage({ type: 'exelula:navigate', url }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const ours = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (ours) {
      await ours.focus().catch(() => undefined);
      const handled = await askPageToNavigate(ours, target);
      if (!handled && 'navigate' in ours) await ours.navigate(target).catch(() => undefined);
      return;
    }
    await self.clients.openWindow(target);
  })());
});
