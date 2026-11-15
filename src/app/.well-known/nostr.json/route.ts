// src/app/.well-known/nostr.json/route.ts
// Nostr NIP-05: verificação de identidade `usuario@exercitodolula.app` -> pubkey hex (64 chars),
// sem custo de relay próprio. Usuários que adicionarem `nostrPubkey` no perfil ficam verificáveis no Nostr.
import type { NextRequest } from 'next/server';
import { LRUCache } from 'lru-cache';
import { normalizeHandle } from '@/lib/activitypub/identity';
import { adminFirestore } from '@/lib/server/firebaseAdmin';
import { federation } from '@/lib/server/federation';
import { requestIp, takeRateLimit } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

const CORS = { 'Access-Control-Allow-Origin': '*' };
const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/;
const nip05Cache = new LRUCache<string, string>({ max: 1000, ttl: 5 * 60 * 1000 });

export async function GET(request: NextRequest) {
  if (!takeRateLimit(`nostr-nip05:${requestIp(request)}`, 120, 60_000)) {
    return new Response(null, { status: 429, headers: { ...CORS, 'Retry-After': '60' } });
  }

  const rawName = request.nextUrl.searchParams.get('name');
  const handle = rawName ? normalizeHandle(rawName) : null;
  if (!handle) {
    return Response.json({ names: {} }, { status: 200, headers: { ...CORS, 'Cache-Control': 'public, max-age=300' } });
  }

  let pubkey = nip05Cache.get(handle);
  if (pubkey === undefined) {
    const f = federation();
    const reserva = await f.store.getHandle(handle);
    if (reserva && reserva.state === 'active') {
      const snap = await adminFirestore().collection('users').doc(reserva.uid).get();
      const rawKey = typeof snap.data()?.nostrPubkey === 'string' ? snap.data()?.nostrPubkey.trim().toLowerCase() : '';
      pubkey = HEX_PUBKEY_RE.test(rawKey) ? rawKey : '';
    } else {
      pubkey = '';
    }
    nip05Cache.set(handle, pubkey);
  }

  const names = pubkey ? { [handle]: pubkey } : {};
  return Response.json(
    { names },
    {
      status: 200,
      headers: {
        ...CORS,
        'Cache-Control': 'public, max-age=300, s-maxage=600',
      },
    },
  );
}

