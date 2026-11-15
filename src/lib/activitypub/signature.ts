// src/lib/activitypub/signature.ts
// Assinatura HTTP do ActivityPub (draft-cavage-http-signatures-12, a variante que Mastodon, Pleroma, Misskey e
// praticamente todo o Fediverso falam). Módulo puro: só `node:crypto`, sem Firebase e sem Next, para a suíte
// `npm run e2e:ap-core` exercitar cada rejeição — inclusive contra o `openssl`, como segunda opinião independente.
//
// POR QUE ISTO É O CORAÇÃO DA SEGURANÇA: a caixa de entrada é pública. Nada além desta assinatura prova que uma
// atividade veio de quem diz ter vindo. Um erro aqui é falsificação de ator.
//
// O que este módulo recusa, e por quê:
//
// - **Qualquer algoritmo que não seja RSA-SHA256** (`rsa-sha256`; `hs2019` é tratado como o mesmo, que é o que o
//   Fediverso faz). Em particular `hmac-*`: a confusão de algoritmo clássica é o atacante escolher HMAC e usar a
//   chave PÚBLICA como segredo. Aqui HMAC não existe, e a chave decide o algoritmo — o cabeçalho não decide.
// - **Chaves RSA menores que 2048 bits**, e as absurdamente grandes (custo de verificação).
// - **Cabeçalho obrigatório fora do `headers` assinado.** Uma assinatura que não cobre `host`, `date` e `digest` não
//   prova nada sobre o corpo nem impede reenvio para outro destino.
// - **`Digest` que não bate com o corpo**, comparado em tempo constante.
// - **`Date` fora da janela de ±5 minutos**: a primeira barreira contra replay (a segunda é o id da atividade).
// - Cabeçalhos duplicados na própria `Signature`, tamanho absurdo e lista de cabeçalhos longa demais.
import { createHash, createPublicKey, createSign, createVerify, timingSafeEqual } from 'node:crypto';

/** Janela de tolerância de relógio. Cinco minutos é o que Mastodon usa. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

const MAX_SIGNATURE_HEADER_LENGTH = 4096;
const MAX_SIGNED_HEADERS = 20;
const MIN_RSA_BITS = 2048;
const MAX_RSA_BITS = 8192;

/** Cabeçalhos como o Node entrega: nomes em minúsculas, valor único ou lista. */
export type HeaderBag = Record<string, string | string[] | undefined>;

export type ParsedSignature = {
  keyId: string;
  algorithm: string;
  /** Nomes em minúsculas, na ordem em que entram na string assinada. */
  headers: string[];
  signature: Buffer;
  created: number | null;
  expires: number | null;
};

export type SignatureFailure =
  | 'ausente'
  | 'malformada'
  | 'algoritmo'
  | 'cabecalho-nao-assinado'
  | 'cabecalho-ausente'
  | 'digest'
  | 'data'
  | 'chave'
  | 'assinatura';

export type PreparedVerification =
  | { ok: true; parsed: ParsedSignature; signingString: string }
  | { ok: false; reason: SignatureFailure };

// ───────────────────────── Digest ─────────────────────────

/** `SHA-256=<base64>` do corpo, exatamente como o cabeçalho `Digest` do ActivityPub. */
export function sha256Digest(body: string | Uint8Array): string {
  return `SHA-256=${createHash('sha256').update(body).digest('base64')}`;
}

/**
 * O cabeçalho `Digest` pode trazer vários algoritmos (`SHA-256=...,SHA-512=...`). Só SHA-256 vale: é o único que
 * calculamos, e aceitar um algoritmo mais fraco que o remetente listou primeiro seria um rebaixamento.
 */
function digestMatches(headerValue: string, body: Uint8Array): boolean {
  const esperado = createHash('sha256').update(body).digest();
  for (const parte of headerValue.split(',')) {
    const separador = parte.indexOf('=');
    if (separador < 0) continue;
    const algoritmo = parte.slice(0, separador).trim().toLowerCase();
    if (algoritmo !== 'sha-256') continue;
    const recebido = Buffer.from(parte.slice(separador + 1).trim(), 'base64');
    // Comprimento diferente: timingSafeEqual lançaria; e já é, por si, um "não".
    if (recebido.length === esperado.length && timingSafeEqual(recebido, esperado)) return true;
  }
  return false;
}

// ───────────────────────── Cabeçalho Signature ─────────────────────────

const PARAM = /([A-Za-z]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^,\s"]+))/g;

/** Lê `keyId="...",algorithm="...",headers="...",signature="..."`. Devolve `null` se não for aproveitável. */
export function parseSignatureHeader(valor: string | undefined | null): ParsedSignature | null {
  if (typeof valor !== 'string' || valor.length === 0 || valor.length > MAX_SIGNATURE_HEADER_LENGTH) return null;

  const params = new Map<string, string>();
  let consumido = 0;
  for (const m of valor.matchAll(PARAM)) {
    const nome = m[1].toLowerCase();
    // Parâmetro repetido: qual vale? Quem decide por nós decide o que verificamos. Recusar.
    if (params.has(nome)) return null;
    params.set(nome, (m[2] ?? m[3] ?? '').replace(/\\(.)/g, '$1'));
    consumido += m[0].length;
  }
  if (consumido === 0) return null;

  const keyId = params.get('keyid');
  const assinatura = params.get('signature');
  if (!keyId || !assinatura) return null;

  const headers = (params.get('headers') ?? 'date').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (headers.length === 0 || headers.length > MAX_SIGNED_HEADERS) return null;
  // Cabeçalho repetido na lista assinada serviria para "assinar" o mesmo valor duas vezes e esconder outro.
  if (new Set(headers).size !== headers.length) return null;

  let sig: Buffer;
  try {
    sig = Buffer.from(assinatura, 'base64');
  } catch {
    return null;
  }
  if (sig.length === 0 || sig.length > 1024) return null;

  const numero = (nome: string): number | null => {
    const bruto = params.get(nome);
    if (bruto === undefined) return null;
    const n = Number(bruto);
    return Number.isFinite(n) ? n : NaN;
  };
  const created = numero('created');
  const expires = numero('expires');
  if (Number.isNaN(created) || Number.isNaN(expires)) return null;

  return {
    keyId,
    algorithm: (params.get('algorithm') ?? 'rsa-sha256').toLowerCase(),
    headers,
    signature: sig,
    created,
    expires,
  };
}

function valorDoCabecalho(headers: HeaderBag, nome: string): string | null {
  const bruto = headers[nome];
  if (bruto === undefined) return null;
  const lista = Array.isArray(bruto) ? bruto : [bruto];
  if (lista.length === 0) return null;
  return lista.map((v) => v.trim()).join(', ');
}

export type SignedRequestInput = {
  method: string;
  /** Caminho COM a query, como na linha de requisição: `/ap/users/ana/inbox?x=1`. */
  path: string;
  headers: HeaderBag;
  /** Corpo bruto. `null` para requisição sem corpo. */
  body: Uint8Array | null;
  now: number;
};

/**
 * Tudo o que se confere SEM a chave: estrutura, algoritmo, cabeçalhos obrigatórios cobertos, data e digest. Roda
 * antes de buscar a chave de propósito — buscar uma chave na rede por causa de um pedido já inválido seria deixar
 * qualquer um nos fazer abrir conexões.
 */
export function prepareVerification(entrada: SignedRequestInput): PreparedVerification {
  const bruto = entrada.headers.signature;
  const cabecalho = Array.isArray(bruto) ? (bruto.length === 1 ? bruto[0] : undefined) : bruto;
  if (cabecalho === undefined || cabecalho === '') return { ok: false, reason: 'ausente' };

  const parsed = parseSignatureHeader(cabecalho);
  if (!parsed) return { ok: false, reason: 'malformada' };

  // `hs2019` é o nome genérico do rascunho; no Fediverso ele significa RSA-SHA256. O resto não existe aqui.
  if (parsed.algorithm !== 'rsa-sha256' && parsed.algorithm !== 'hs2019') return { ok: false, reason: 'algoritmo' };

  const metodo = entrada.method.toLowerCase();
  const temCorpo = entrada.body !== null && entrada.body.length > 0;
  const obrigatorios = ['(request-target)', 'host', 'date'];
  // POST sempre assina o digest, mesmo vazio: é ele que amarra o corpo à assinatura.
  if (metodo === 'post' || temCorpo) obrigatorios.push('digest');
  for (const nome of obrigatorios) {
    if (!parsed.headers.includes(nome)) return { ok: false, reason: 'cabecalho-nao-assinado' };
  }

  // Data
  const data = valorDoCabecalho(entrada.headers, 'date');
  if (data === null) return { ok: false, reason: 'cabecalho-ausente' };
  const quando = Date.parse(data);
  if (!Number.isFinite(quando) || Math.abs(entrada.now - quando) > MAX_CLOCK_SKEW_MS) {
    return { ok: false, reason: 'data' };
  }
  if (parsed.headers.includes('(created)')) {
    if (parsed.created === null || Math.abs(entrada.now - parsed.created * 1000) > MAX_CLOCK_SKEW_MS) {
      return { ok: false, reason: 'data' };
    }
  }
  if (parsed.headers.includes('(expires)')) {
    if (parsed.expires === null || entrada.now > parsed.expires * 1000) return { ok: false, reason: 'data' };
  }

  // Digest
  if (obrigatorios.includes('digest')) {
    const digest = valorDoCabecalho(entrada.headers, 'digest');
    if (digest === null) return { ok: false, reason: 'cabecalho-ausente' };
    if (!digestMatches(digest, entrada.body ?? new Uint8Array(0))) return { ok: false, reason: 'digest' };
  }

  // String assinada
  const linhas: string[] = [];
  for (const nome of parsed.headers) {
    if (nome === '(request-target)') {
      linhas.push(`(request-target): ${metodo} ${entrada.path}`);
    } else if (nome === '(created)') {
      if (parsed.created === null) return { ok: false, reason: 'cabecalho-ausente' };
      linhas.push(`(created): ${parsed.created}`);
    } else if (nome === '(expires)') {
      if (parsed.expires === null) return { ok: false, reason: 'cabecalho-ausente' };
      linhas.push(`(expires): ${parsed.expires}`);
    } else {
      const valor = valorDoCabecalho(entrada.headers, nome);
      if (valor === null) return { ok: false, reason: 'cabecalho-ausente' };
      linhas.push(`${nome}: ${valor}`);
    }
  }
  return { ok: true, parsed, signingString: linhas.join('\n') };
}

/** Confere que a chave é RSA e tem tamanho aceitável. Devolve o objeto de chave ou `null`. */
export function loadPublicKey(pem: string) {
  try {
    const chave = createPublicKey(pem);
    if (chave.asymmetricKeyType !== 'rsa') return null;
    const bits = chave.asymmetricKeyDetails?.modulusLength ?? 0;
    if (bits < MIN_RSA_BITS || bits > MAX_RSA_BITS) return null;
    return chave;
  } catch {
    return null;
  }
}

/** Passo final: a assinatura confere com a chave pública? */
export function verifyPrepared(prepared: Extract<PreparedVerification, { ok: true }>, publicKeyPem: string):
  { ok: true } | { ok: false; reason: 'chave' | 'assinatura' } {
  const chave = loadPublicKey(publicKeyPem);
  if (!chave) return { ok: false, reason: 'chave' };
  try {
    const verificador = createVerify('RSA-SHA256');
    verificador.update(prepared.signingString);
    verificador.end();
    return verificador.verify(chave, prepared.parsed.signature) ? { ok: true } : { ok: false, reason: 'assinatura' };
  } catch {
    return { ok: false, reason: 'assinatura' };
  }
}

/** Conveniência: tudo de uma vez, para quem já tem a chave. */
export function verifyHttpSignature(entrada: SignedRequestInput, publicKeyPem: string):
  { ok: true; keyId: string } | { ok: false; reason: SignatureFailure } {
  const preparado = prepareVerification(entrada);
  if (!preparado.ok) return preparado;
  const resultado = verifyPrepared(preparado, publicKeyPem);
  return resultado.ok ? { ok: true, keyId: preparado.parsed.keyId } : resultado;
}

// ───────────────────────── Assinar ─────────────────────────

export type SignRequestInput = {
  method: 'GET' | 'POST';
  url: string;
  /** Presente em POST. Entra no `Digest` e na assinatura. */
  body?: string | Uint8Array;
  privateKeyPem: string;
  /** URL da chave pública do actor: `https://host/ap/users/ana#main-key`. */
  keyId: string;
  now: number;
};

/**
 * Cabeçalhos de uma requisição assinada: `host`, `date`, `digest` (se houver corpo) e `signature`. O chamador
 * acrescenta `content-type`/`accept`/`user-agent`, que não entram na assinatura.
 */
export function signRequest(entrada: SignRequestInput): Record<string, string> {
  const url = new URL(entrada.url);
  const caminho = `${url.pathname}${url.search}`;
  const data = new Date(entrada.now).toUTCString();
  const temCorpo = entrada.body !== undefined;

  const cabecalhos: Record<string, string> = { host: url.host, date: data };
  if (temCorpo) cabecalhos.digest = sha256Digest(entrada.body as string | Uint8Array);

  const assinados = ['(request-target)', 'host', 'date', ...(temCorpo ? ['digest'] : [])];
  const linhas = assinados.map((nome) =>
    nome === '(request-target)'
      ? `(request-target): ${entrada.method.toLowerCase()} ${caminho}`
      : `${nome}: ${cabecalhos[nome]}`,
  );

  const assinador = createSign('RSA-SHA256');
  assinador.update(linhas.join('\n'));
  assinador.end();
  const assinatura = assinador.sign(entrada.privateKeyPem).toString('base64');

  cabecalhos.signature =
    `keyId="${entrada.keyId}",algorithm="rsa-sha256",headers="${assinados.join(' ')}",signature="${assinatura}"`;
  return cabecalhos;
}
