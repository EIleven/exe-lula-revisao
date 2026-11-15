// src/app/api/auth/ticket/route.ts
import { NextResponse } from 'next/server';
import { consumeLoginTicket } from '@/lib/server/federatedAuth';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!takeRateLimit(`auth-ticket:${requestIp(request)}`, 20, 60_000)) {
    return NextResponse.json({ error: 'muitas-requisicoes' }, { status: 429 });
  }
  const ticket = new URL(request.url).searchParams.get('ticket') ?? '';
  const data = await consumeLoginTicket(ticket);
  if (!data) {
    return NextResponse.json({ error: 'ticket-invalido' }, { status: 400 });
  }
  return NextResponse.json(data);
}

