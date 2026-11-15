// src/lib/activitypub/fetcher.ts
// O meio de rede REAL da federação: toda saída passa por `safeFetchText`, que resolve o DNS no momento da conexão e
// recusa endereço privado, loopback, link-local, porta fora de 80/443 e redirecionamento para qualquer um deles.
// Nada neste projeto faz `fetch` cru para um servidor remoto.
import { safeFetchText, UnsafeUrlError } from '../security/safe-fetch.ts';
import { signRequest } from './signature.ts';
import type { Fetcher } from './remote.ts';

const TIPOS_ACEITOS = /^application\/(activity\+json|ld\+json|jrd\+json|json)/i;

export type FetcherOptions = {
  now: () => number;
  /** `Exe.Lula/1.0 (+https://exercitodolula.app)`: servidores remotos usam isto para entrar em contato. */
  userAgent: string;
  /** Assinador HTTP opcional usado em fallback quando um servidor remoto exige Authorized Fetch (401/403). */
  signGet?: (url: string, accept: string) => Promise<Record<string, string> | null>;
  /** A rede. Em produção é `safeFetchText` (guarda de SSRF); a suíte injeta uma falsa. */
  fetchText?: typeof safeFetchText;
};

export function createFetcher({ now, userAgent, signGet, fetchText = safeFetchText }: FetcherOptions): Fetcher {
  return {
    async get(url, { accept }) {
      const requestOpts = {
        timeoutMs: 8000,
        maxBytes: 1_000_000,
        maxRedirects: 3,
        allowedContentTypes: TIPOS_ACEITOS,
      };
      // GET de ator: pequeno, curto, no máximo três redirecionamentos (cada salto é conferido pela guarda de SSRF).
      let resposta = await fetchText(url, {
        ...requestOpts,
        headers: { Accept: accept, 'User-Agent': userAgent },
      });
      if ((resposta.status === 401 || resposta.status === 403) && signGet) {
        const signedHeaders = await signGet(url, accept).catch(() => null);
        if (signedHeaders) {
          resposta = await fetchText(url, {
            ...requestOpts,
            headers: { Accept: accept, 'User-Agent': userAgent, ...signedHeaders },
          });
        }
      }
      let json: unknown | null = null;
      if (resposta.ok) {
        try {
          json = JSON.parse(resposta.text);
        } catch {
          json = null;
        }
      }
      return { status: resposta.status, json, finalUrl: resposta.finalUrl };
    },

    async post(url, body, { privateKeyPem, keyId }) {
      try {
        const assinatura = signRequest({ method: 'POST', url, body, privateKeyPem, keyId, now: now() });
        const resposta = await fetchText(url, {
          method: 'POST',
          body,
          headers: {
            ...assinatura,
            'Content-Type': 'application/activity+json',
            Accept: 'application/activity+json',
            'User-Agent': userAgent,
          },
          timeoutMs: 10_000,
          // Só o status importa: um servidor hostil não consegue nos fazer baixar nada em troca de uma entrega.
          discardBody: true,
        });
        return { status: resposta.status, unsafe: false, retryAfter: resposta.headers['retry-after'] };
      } catch (erro) {
        if (erro instanceof UnsafeUrlError) {
          // `forbidden` = destino que nunca poderemos alcançar (não repete). Tempo e tamanho são do momento.
          return { status: null, unsafe: erro.reason === 'forbidden', errorDetail: erro.message };
        }
        // DNS, TLS, conexão recusada ou interrompida: passageiro. Nunca a mensagem inteira (pode ter caminho/host).
        const codigo = (erro as { code?: string })?.code;
        return { status: null, unsafe: false, errorDetail: codigo ?? 'falha de rede' };
      }
    },
  };
}
