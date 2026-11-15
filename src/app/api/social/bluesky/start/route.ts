import { NextResponse } from 'next/server';
import { verifyRequestMember, takeRateLimit } from '@/lib/server/requestAuth';
import { blueskyConfigured } from '@/lib/server/socialConfig';
import { getBlueskyOAuthClient } from '@/lib/server/blueskyOAuth';
import { createLinkState } from '@/lib/server/socialStore';

export async function POST(request: Request) {
  const uid = await verifyRequestMember(request);
  if (!uid) return NextResponse.json({ message: 'Confirme seu e-mail para conectar o Bluesky.' }, { status: 403 });
  if (!takeRateLimit(`social-connect:${uid}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ message: 'Muitas tentativas de conexão. Aguarde alguns minutos.' }, { status: 429 });
  }
  if (!blueskyConfigured()) return NextResponse.json({ message: 'A conexão com o Bluesky ainda não foi configurada.' }, { status: 503 });
  const body = await request.json().catch(() => ({}));
  const handle = String(body.handle ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!/^(?:did:[a-z0-9:%._-]+|[a-z0-9](?:[a-z0-9.-]{1,251}[a-z0-9])?)$/i.test(handle)) {
    return NextResponse.json({ message: 'Informe um endereço válido do Bluesky.' }, { status: 400 });
  }
  try {
    const locale = body.locale === 'en' ? 'en' : 'pt-BR';
    const state = await createLinkState({ uid, provider: 'bluesky', locale });
    const client = await getBlueskyOAuthClient();
    const url = await client.authorize(handle, { state, ui_locales: locale === 'en' ? 'en' : 'pt-BR pt en' });
    return NextResponse.json({ url: url.href });
  } catch (error) {
    console.error('Bluesky OAuth start failed:', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ message: 'Não foi possível iniciar a conexão com o Bluesky. Confira seu endereço.' }, { status: 502 });
  }
}
