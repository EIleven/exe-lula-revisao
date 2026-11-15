// src/app/api/p2p/ice/route.ts
// Servidores ICE para o WebRTC do canal P2P: os STUN (descoberta do endereço público) e, se o servidor estiver configurado,
// um TURN (relay) com credencial temporária. Exige login (a credencial do TURN tem custo) e tem limite por pessoa.
//
// Configuração (apphosting.yaml; o segredo vem do Secret Manager): P2P_TURN_URLS (separadas por vírgula, ex.:
// "turn:turn.exemplo.com:3478?transport=udp,turns:turn.exemplo.com:5349?transport=tcp"), P2P_TURN_SECRET (o mesmo
// `static-auth-secret` do coturn) e, opcional, P2P_STUN_URLS. Sem isso a resposta traz só STUN e `turn: null`.
import type { NextRequest } from 'next/server';
import { parseTurnConfig, turnRestCredentials } from '@/lib/p2p/turnCredentials';
import { requestIp, takeRateLimit, verifyRequestUser } from '@/lib/server/requestAuth';

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store' };
const reply = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers, ...extra } });

export async function GET(request: NextRequest) {
  if (!takeRateLimit(`p2p-ice-ip:${requestIp(request)}`, 60, 60_000)) return reply(429, { error: 'muitas-requisicoes' }, { 'Retry-After': '30' });
  const uid = await verifyRequestUser(request);
  if (!uid) return reply(401, { error: 'login-obrigatorio' });
  if (!takeRateLimit(`p2p-ice-uid:${uid}`, 30, 60_000)) return reply(429, { error: 'muitas-requisicoes' }, { 'Retry-After': '30' });

  const cfg = parseTurnConfig(process.env);
  if (!cfg.secret) return reply(200, { stun: cfg.stun, turn: null });
  const cred = turnRestCredentials(cfg.secret, uid, Date.now() / 1000);
  return reply(200, { stun: cfg.stun, turn: { urls: cfg.turnUrls, username: cred.username, credential: cred.credential, expiresAt: cred.expiresAt } });
}
