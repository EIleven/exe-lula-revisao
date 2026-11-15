// src/app/ap/users/[username]/inbox/route.ts
// Caixa de entrada pessoal. A ordem das checagens está em src/lib/activitypub/inbox.ts.
import { normalizeHandle } from '@/lib/activitypub/identity';
import { handleInbox } from '@/lib/server/federation';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ username: string }> }) {
  const handle = normalizeHandle((await context.params).username);
  if (!handle) return new Response(null, { status: 404 });
  return handleInbox(request, handle);
}

// Qualquer outro método: 405, sem tocar no banco.
export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
