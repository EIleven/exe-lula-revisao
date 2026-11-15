// src/app/ap/inbox/route.ts
// Caixa de entrada COMPARTILHADA: um POST serve todos os seguidores locais de um servidor remoto. O destinatário sai do
// próprio objeto da atividade (ex.: o alvo do Follow).
import { handleInbox } from '@/lib/server/federation';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handleInbox(request, null);
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
