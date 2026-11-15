// src/lib/p2p/turnCredentials.ts
// Credenciais TEMPORÁRIAS para um servidor TURN (relay do WebRTC), no esquema "REST API" do coturn (`use-auth-secret`): o
// nome de usuário é `<expira em>:<identificador>` e a senha é HMAC-SHA1(segredo, nome) em base64. O segredo fica só no
// servidor; quem recebe a credencial só a usa até `expira em`. Módulo puro (só `node:crypto`), servidor.
//
// Por que existe: com dois aparelhos atrás de NAT simétrico (comum em redes móveis com CGNAT), a conexão direta do WebRTC
// não fecha, e sem relay não há plano B: o P2P "não conecta" e ninguém explica por quê. O TURN é o plano B. O servidor
// em si é infraestrutura (coturn próprio ou um provedor); aqui fica o lado do app, que só liga quando configurado.
import { createHash, createHmac } from 'node:crypto';

export type TurnConfig = { stun: string[]; turnUrls: string[]; secret: string | null };

const ICE_URL = /^(stun|stuns|turn|turns):[A-Za-z0-9.\-[\]:]+(\?transport=(udp|tcp))?$/;

/** Lê a configuração do ambiente. Sem `P2P_TURN_URLS` e `P2P_TURN_SECRET`, não há TURN (só STUN). */
export function parseTurnConfig(env: Record<string, string | undefined>): TurnConfig {
  const lista = (v: string | undefined, prefixo: RegExp) =>
    (v ?? '').split(',').map((s) => s.trim()).filter((s) => ICE_URL.test(s) && prefixo.test(s)).slice(0, 4);
  const turnUrls = lista(env.P2P_TURN_URLS, /^turns?:/);
  const secret = (env.P2P_TURN_SECRET ?? '').trim();
  return {
    stun: lista(env.P2P_STUN_URLS, /^stuns?:/),
    turnUrls,
    secret: turnUrls.length > 0 && secret.length >= 16 ? secret : null,
  };
}

export const hmacSha1Base64 = (secret: string, data: string): string => createHmac('sha1', secret).update(data).digest('base64');

/**
 * Credencial do TURN para uma pessoa. O identificador é um resumo do UID (o provedor do TURN não precisa saber quem é),
 * e a validade é curta: uma credencial vazada deixa de servir em `ttlSec`.
 */
export function turnRestCredentials(secret: string, userId: string, nowSec: number, ttlSec = 3600): { username: string; credential: string; expiresAt: number } {
  const expiresAt = Math.floor(nowSec) + ttlSec;
  const quem = createHash('sha256').update(`exelula-turn\n${userId}`).digest('hex').slice(0, 16);
  const username = `${expiresAt}:${quem}`;
  return { username, credential: hmacSha1Base64(secret, username), expiresAt };
}
