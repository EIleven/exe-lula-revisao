// Utilitários para integração com o protocolo aberto Matrix (Client-Server API v3).

const MATRIX_USER_ID_RE = /^@[a-z0-9._=\/-]+:[a-z0-9.-]+\.[a-z]{2,}(?::\d{1,5})?$/i;
const MATRIX_ROOM_ID_RE = /^[!#][a-zA-Z0-9._=\/-]+:[a-z0-9.-]+\.[a-z]{2,}(?::\d{1,5})?$/;

export function normalizeMatrixHandle(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

export function isValidMatrixHandle(raw: string): boolean {
  return MATRIX_USER_ID_RE.test(normalizeMatrixHandle(raw));
}

export function isValidMatrixRoomId(raw: string): boolean {
  return MATRIX_ROOM_ID_RE.test(raw.trim());
}

export function normalizeMatrixHomeserver(raw?: string): string {
  const cleaned = (raw || 'https://matrix.org').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i.test(cleaned)) {
    throw new Error('URL de homeserver Matrix inválida (precisa começar com https://).');
  }
  return cleaned;
}

/** Envia uma mensagem de texto/HTML para uma sala Matrix usando a API Client-Server v3 padrão. */
export async function sendMatrixRoomMessage(params: {
  homeserverUrl: string;
  accessToken: string;
  roomId: string;
  text: string;
  postUrl?: string;
}): Promise<{ eventId?: string }> {
  const baseUrl = normalizeMatrixHomeserver(params.homeserverUrl);
  const txnId = `exelula_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const endpoint = `${baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(params.roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`;

  const fullText = params.postUrl ? `${params.text}\n\n${params.postUrl}` : params.text;

  const res = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      msgtype: 'm.text',
      body: fullText,
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Matrix HTTP ${res.status}: ${errText.slice(0, 140)}`);
  }

  const data = (await res.json().catch(() => ({}))) as { event_id?: string };
  return { eventId: data.event_id };
}

