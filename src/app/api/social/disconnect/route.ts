import { NextResponse } from 'next/server';
import { verifyRequestUser, takeRateLimit } from '@/lib/server/requestAuth';
import { atprotoSessionStore, deleteConnection, getConnection } from '@/lib/server/socialStore';
import { isSocialProvider } from '@/lib/social/types';
import { getBlueskyOAuthClient } from '@/lib/server/blueskyOAuth';

export async function POST(request: Request) {
  const uid = await verifyRequestUser(request);
  if (!uid) return NextResponse.json({ message: 'Entre na sua conta para gerenciar conexões.' }, { status: 401 });
  if (!takeRateLimit(`social-disconnect:${uid}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ message: 'Muitas tentativas. Aguarde alguns minutos.' }, { status: 429 });
  }
  const body = await request.json().catch(() => ({}));
  if (!isSocialProvider(body.provider)) return NextResponse.json({ message: 'Rede inválida.' }, { status: 400 });
  const connection = await getConnection(uid, body.provider);
  if (connection) {
    if (body.provider === 'bluesky' && connection.did) {
      await getBlueskyOAuthClient().then((client) => client.revoke(connection.did!)).catch(() => undefined);
      await atprotoSessionStore.del(connection.did).catch(() => undefined);
    }
  }
  await deleteConnection(uid, body.provider);
  return NextResponse.json({ ok: true });
}
