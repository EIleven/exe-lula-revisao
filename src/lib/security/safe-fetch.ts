// src/lib/security/safe-fetch.ts
// Busca de páginas de terceiros pelo SERVIDOR com proteção contra SSRF (Server-Side Request Forgery).
//
// Sem isto, uma rota que recebe uma URL e a busca (como /api/extract-article) vira um proxy para a rede interna:
// quem a chama alcança localhost, serviços internos e o servidor de metadados da nuvem (169.254.169.254).
//
// Regras: só http/https; sem usuário/senha na URL; só as portas 80 e 443; o endereço de destino nunca pode ser
// privado, de loopback, de link-local, multicast, reservado ou de documentação. A checagem acontece NO MOMENTO da
// conexão (função `lookup` do socket), então não há janela para "DNS rebinding"; endereços IP escritos direto na URL
// (inclusive formas como 2130706433, 0x7f.0.0.1 ou [::ffff:7f00:1]) são conferidos antes de conectar. Redirecionamentos
// são seguidos à mão, e cada salto passa pelas mesmas checagens. Há limite de tempo, de tamanho e de tipo de conteúdo.
//
// Para testes locais (a fixture fica em 127.0.0.1) existe UMA exceção explícita: EXTRACT_ARTICLE_ALLOW_LOOPBACK=true
// libera só loopback e qualquer porta. Nunca defina isto em produção.
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { isSuspendedFediverseHost } from '../federation/suspendedDomains.ts';

/**
 * Por que a busca foi recusada. `forbidden` é o único que significa "este destino não pode ser alcançado, nunca": os
 * outros são condições do momento (tempo, tamanho) ou do conteúdo, e quem entrega algo — como a federação — repete
 * umas e desiste de outras.
 */
export type UnsafeReason = 'forbidden' | 'timeout' | 'size' | 'redirects' | 'content-type';

export class UnsafeUrlError extends Error {
  readonly reason: UnsafeReason;
  constructor(message: string, reason: UnsafeReason = 'forbidden') {
    super(message);
    this.name = 'UnsafeUrlError';
    this.reason = reason;
  }
}

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Padrão GET. POST existe para a entrega de atividades do ActivityPub; nada mais usa. */
  method?: 'GET' | 'POST';
  /** Corpo do POST. O Content-Length é calculado aqui: servidor que recusa "chunked" é comum. */
  body?: string | Buffer;
  /**
   * Tipos de conteúdo aceitos numa resposta 2xx. O padrão continua sendo texto e XML (páginas e artigos). O
   * ActivityPub precisa de `application/activity+json`, que o padrão recusaria.
   */
  allowedContentTypes?: RegExp;
  /**
   * Não lê o corpo da resposta. Para quando só o STATUS importa (entrega de atividade): um servidor hostil não
   * consegue nos fazer baixar nada, e não há tipo de conteúdo a validar.
   */
  discardBody?: boolean;
}

export interface SafeFetchResult {
  status: number;
  ok: boolean;
  finalUrl: string;
  contentType: string;
  text: string;
  /** Cabeçalhos da resposta final. Necessário para `Retry-After` na entrega. */
  headers: http.IncomingHttpHeaders;
}

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 3 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;
const ALLOWED_CONTENT_TYPES = /^(text\/|application\/xhtml\+xml|application\/xml)/i;

const blockList = new net.BlockList();
const blockedV4: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const blockedV6: Array<[string, number]> = [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001::', 32], ['2001:db8::', 32], ['fc00::', 7],
  ['fe80::', 10], ['ff00::', 8],
];
for (const [base, prefix] of blockedV4) blockList.addSubnet(base, prefix, 'ipv4');
for (const [base, prefix] of blockedV6) blockList.addSubnet(base, prefix, 'ipv6');

const loopbackV4 = new net.BlockList();
loopbackV4.addSubnet('127.0.0.0', 8, 'ipv4');

const allowLoopback = () => process.env.EXTRACT_ARTICLE_ALLOW_LOOPBACK === 'true';

/** Converte ::ffff:a.b.c.d e ::ffff:7f00:1 no IPv4 embutido; devolve null se não for esse formato. */
function embeddedIPv4(address: string): string | null {
  const lower = address.toLowerCase();
  if (!lower.startsWith('::ffff:')) return null;
  const rest = lower.slice('::ffff:'.length);
  if (net.isIPv4(rest)) return rest;
  const hex = rest.split(':');
  if (hex.length !== 2) return null;
  const [high, low] = hex.map((part) => Number.parseInt(part, 16));
  if (!Number.isInteger(high) || !Number.isInteger(low)) return null;
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function isLoopback(address: string): boolean {
  const ip = embeddedIPv4(address) ?? address;
  if (net.isIPv4(ip)) return loopbackV4.check(ip, 'ipv4');
  return ip === '::1';
}

/** true se o endereço NÃO pode ser alcançado a partir do servidor. */
export function isBlockedAddress(address: string): boolean {
  if (allowLoopback() && isLoopback(address)) return false;
  const mapped = embeddedIPv4(address);
  if (mapped) return blockList.check(mapped, 'ipv4');
  if (net.isIPv4(address)) return blockList.check(address, 'ipv4');
  if (net.isIPv6(address)) return blockList.check(address, 'ipv6');
  return true; // nem IPv4 nem IPv6: não confie
}

/** Valida a URL antes de qualquer conexão. Devolve a URL já normalizada (o WHATWG URL converte 2130706433 e 0x7f.1). */
export function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('URL inválida.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnsafeUrlError('Só http e https são permitidos.');
  if (url.username || url.password) throw new UnsafeUrlError('URL com usuário e senha não é permitida.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new UnsafeUrlError('URL sem host.');
  const loopbackTesting = allowLoopback() && (host === 'localhost' || (net.isIP(host) !== 0 && isLoopback(host)));
  if (url.port && !['80', '443'].includes(url.port) && !loopbackTesting) throw new UnsafeUrlError('Porta não permitida.');
  if (net.isIP(host) !== 0 && isBlockedAddress(host)) throw new UnsafeUrlError('Endereço de destino não permitido.');
  if (host.toLowerCase() === 'localhost' && !allowLoopback()) throw new UnsafeUrlError('Endereço de destino não permitido.');
  if (isSuspendedFediverseHost(host)) throw new UnsafeUrlError('Domínio suspenso pela política da instância.');
  return url;
}

/** `lookup` do socket: resolve e recusa se QUALQUER endereço resolvido for proibido (vale no momento da conexão). */
function safeLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (error: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void,
): void {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    const list = addresses as dns.LookupAddress[];
    const forbidden = list.find((entry) => isBlockedAddress(entry.address));
    if (!list.length || forbidden) return callback(new UnsafeUrlError('Endereço de destino não permitido.') as NodeJS.ErrnoException);
    if (options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

function decompress(response: http.IncomingMessage): NodeJS.ReadableStream {
  const encoding = String(response.headers['content-encoding'] ?? '').toLowerCase();
  if (encoding === 'gzip' || encoding === 'x-gzip') return response.pipe(zlib.createGunzip());
  if (encoding === 'deflate') return response.pipe(zlib.createInflate());
  if (encoding === 'br') return response.pipe(zlib.createBrotliDecompress());
  return response;
}

interface OnceOptions {
  timeoutMs: number;
  maxBytes: number;
  headers: Record<string, string>;
  method: 'GET' | 'POST';
  body?: Buffer;
  allowedContentTypes: RegExp;
  discardBody: boolean;
}

async function once(url: URL, options: OnceOptions) {
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const headers = { ...options.headers };
    if (options.body) headers['Content-Length'] = String(options.body.length);
    const request = transport.request(
      url,
      { method: options.method, headers, lookup: safeLookup as never, timeout: options.timeoutMs },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          return resolve({ status, headers: response.headers, body: '' });
        }
        // Só o status importa: não baixa nada, e portanto não há tipo a validar nem tamanho a estourar.
        if (options.discardBody) {
          response.resume();
          return resolve({ status, headers: response.headers, body: '' });
        }
        const type = String(response.headers['content-type'] ?? '');
        if (status >= 200 && status < 300 && type && !options.allowedContentTypes.test(type)) {
          response.resume();
          return reject(new UnsafeUrlError('Tipo de conteúdo não permitido.', 'content-type'));
        }
        const chunks: Buffer[] = [];
        let received = 0;
        response.on('error', reject);
        const stream = decompress(response);
        stream.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > options.maxBytes) {
            request.destroy(new UnsafeUrlError('Resposta grande demais.', 'size'));
            return;
          }
          chunks.push(chunk);
        });
        stream.on('end', () => resolve({ status, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
        stream.on('error', reject);
      },
    );
    request.on('timeout', () => request.destroy(new UnsafeUrlError('Tempo esgotado.', 'timeout')));
    request.on('error', reject);
    request.end(options.body);
  });
}

/**
 * Busca segura: valida a URL, a cada redirecionamento e o endereço no momento de conectar.
 *
 * Em POST, redirecionamento NUNCA é seguido: a entrega de uma atividade assinada a outro destino que o servidor
 * remoto escolheu seria redirecionar uma requisição autenticada. O 3xx volta como resposta e quem chamou decide.
 */
export async function safeFetchText(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const method = options.method ?? 'GET';
  const maxRedirects = method === 'POST' ? 0 : options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const body = options.body === undefined ? undefined : Buffer.from(options.body);
  if (method === 'GET' && body) throw new UnsafeUrlError('GET não leva corpo.');
  const deadline = Date.now() + timeoutMs;
  let current = assertSafeUrl(rawUrl);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new UnsafeUrlError('Tempo esgotado.', 'timeout');
    const { status, headers, body: text } = await once(current, {
      timeoutMs: remaining,
      maxBytes,
      headers: options.headers ?? {},
      method,
      body,
      allowedContentTypes: options.allowedContentTypes ?? ALLOWED_CONTENT_TYPES,
      discardBody: options.discardBody ?? false,
    });
    if (status >= 300 && status < 400 && headers.location && maxRedirects > 0) {
      current = assertSafeUrl(new URL(String(headers.location), current).href);
      continue;
    }
    return {
      status,
      ok: status >= 200 && status < 300,
      finalUrl: current.href,
      contentType: String(headers['content-type'] ?? ''),
      text,
      headers,
    };
  }
  throw new UnsafeUrlError('Redirecionamentos demais.', 'redirects');
}
