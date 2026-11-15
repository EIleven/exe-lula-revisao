// src/app/api/auth/bluesky/start/route.ts
// Inicia OAuth com a Atmosfera (Bluesky) para login/cadastro no Exe. Lula.
import { NextResponse } from 'next/server';
import { getBlueskyOAuthClient } from '@/lib/server/blueskyOAuth';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';
import { blueskyConfigured } from '@/lib/server/socialConfig';
import { createLinkState } from '@/lib/server/socialStore';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!takeRateLimit(`auth-bsky-start:${requestIp(request)}`, 15, 5 * 60_000)) {
    return NextResponse.json({ message: 'Muitas tentativas. Aguarde alguns minutos.' }, { status: 429 });
  }
  if (!blueskyConfigured()) {
    return NextResponse.json({ message: 'A integração com a Atmosfera (Bluesky) não está configurada.' }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as { handle?: unknown; locale?: unknown };
  const handle = String(body.handle ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!/^(?:did:[a-z0-9:%._-]+|[a-z0-9](?:[a-z0-9.-]{1,251}[a-z0-9])?)$/i.test(handle)) {
    return NextResponse.json({ message: 'Informe um endereço válido do Bluesky (ex: voce.bsky.social).' }, { status: 400 });
  }

  try {
    const locale = body.locale === 'en' ? 'en' : 'pt-BR';
    const state = await createLinkState({ uid: '__login__', provider: 'bluesky', locale });
    const client = await getBlueskyOAuthClient();
    const url = await client.authorize(handle, { state, ui_locales: locale === 'en' ? 'en' : 'pt-BR pt en' });
    return NextResponse.json({ url: url.href });
  } catch (error) {
    console.error('Bluesky auth start failed:', error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      { message: 'Não foi possível iniciar o login com a Atmosfera. Confira seu endereço.' },
      { status: 502 },
    );
  }
}

