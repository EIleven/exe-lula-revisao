// src/lib/feed/remoteCountSync.ts
// Ligação da fila de revalidação (remoteCountSyncQueue.ts) com o navegador: `fetch`, relógio, temporizadores e a visibilidade
// da aba. Quem chama é o hook de contadores ao vivo (useLivePostCounters), quando o cartão de um post do Fediverso chega perto
// da tela. O servidor decide se vale buscar na origem (validade, freio por servidor); o número novo volta pelo ouvinte do
// documento do post, não por esta resposta.
import { createRemoteCountSyncQueue, type RemoteCountSyncQueue } from '@/lib/feed/remoteCountSyncQueue';

let queue: RemoteCountSyncQueue | null = null;

function getQueue(): RemoteCountSyncQueue {
  return (queue ??= createRemoteCountSyncQueue({
    send: async (ids) => {
      const res = await fetch('/api/ap/sync-counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postIds: ids }),
        keepalive: true,
      });
      const retryAfter = Number(res.headers.get('Retry-After'));
      return { ok: res.ok, status: res.status, retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined };
    },
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  }));
}

/** Pede a revalidação do contador de um post remoto (`ap_*`). Para qualquer outro id, não faz nada. */
export function scheduleRemotePostCountSync(postId: string | null | undefined): void {
  if (typeof window === 'undefined') return;
  getQueue().schedule(postId);
}
