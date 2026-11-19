import { Agent } from '@atproto/api';
import {
  JoseKey,
  NodeOAuthClient,
  requestLocalLock,
  type NodeSavedSession,
  type NodeSavedState,
} from '@atproto/oauth-client-node';
import { atprotoSessionStore, atprotoStateStore } from './socialStore';
import { socialOrigin } from './socialConfig';

let clientPromise: Promise<NodeOAuthClient> | null = null;

function readPrivateJwk(): Record<string, unknown> {
  const raw = process.env.ATPROTO_PRIVATE_JWK?.trim();
  if (!raw) throw new Error('Bluesky OAuth não está configurado no servidor.');
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    } catch {
      throw new Error('ATPROTO_PRIVATE_JWK não contém uma chave JWK válida.');
    }
  }
}

export function blueskyClientMetadata() {
  const origin = socialOrigin();
  return {
    client_id: `${origin}/api/social/bluesky/client-metadata`,
    client_name: 'HiperVerso',
    client_uri: origin,
    logo_uri: `${origin}/brand/lula.png`,
    tos_uri: `${origin}/pt-BR/terms`,
    policy_uri: `${origin}/pt-BR/privacy`,
    redirect_uris: [`${origin}/api/social/bluesky/callback`] as [string],
    grant_types: ['authorization_code', 'refresh_token'] as ['authorization_code', 'refresh_token'],
    scope: 'atproto transition:generic',
    response_types: ['code'] as ['code'],
    application_type: 'web' as const,
    token_endpoint_auth_method: 'private_key_jwt' as const,
    token_endpoint_auth_signing_alg: 'ES256',
    dpop_bound_access_tokens: true,
    jwks_uri: `${origin}/api/social/bluesky/jwks`,
  };
}

export async function getBlueskyOAuthClient(): Promise<NodeOAuthClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const key = await JoseKey.fromJWK(readPrivateJwk(), 'social-1');
      return new NodeOAuthClient({
        clientMetadata: blueskyClientMetadata(),
        keyset: [key],
        stateStore: atprotoStateStore as {
          set(key: string, value: NodeSavedState): Promise<void>;
          get(key: string): Promise<NodeSavedState | undefined>;
          del(key: string): Promise<void>;
        },
        sessionStore: atprotoSessionStore as {
          set(key: string, value: NodeSavedSession): Promise<void>;
          get(key: string): Promise<NodeSavedSession | undefined>;
          del(key: string): Promise<void>;
        },
        requestLock: requestLocalLock,
      });
    })().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

export async function getBlueskyAgent(did: string): Promise<Agent> {
  const client = await getBlueskyOAuthClient();
  return new Agent(await client.restore(did));
}
