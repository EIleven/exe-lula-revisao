// src/app/api/auth/ticket/route.ts
import { NextResponse } from 'next/server';
import { consumeLoginTicket } from '@/lib/server/federatedAuth';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!takeRateLimit(`auth-ticket:${requestIp(request)}`, 20, 60_000)) {
    return NextResponse.json({ error: 'muitas-requisicoes' }, { status: 429 });
  }
  // Credencial de login: nunca pode ficar em cache de navegador, proxy ou CDN (o ticket é de uso único, a resposta não).
  const semCache = { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' };
  const ticket = new URL(request.url).searchParams.get('ticket') ?? '';
  const data = await consumeLoginTicket(ticket);
  if (!data) {
    return NextResponse.json({ error: 'ticket-invalido' }, { status: 400, headers: semCache });
  }
  return NextResponse.json(data, { headers: semCache });
}

