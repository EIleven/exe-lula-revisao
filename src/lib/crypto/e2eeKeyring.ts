// src/lib/crypto/e2eeKeyring.ts
// O CHAVEIRO do E2EE: várias chaves ECDH P-256 por conta (uma ativa, as demais aposentadas), com identificador, validação
// rigorosa e impressão digital. Módulo sem Firebase e sem DOM: usa só WebCrypto (`globalThis.crypto.subtle`, que existe no
// navegador e no Node 22), então a suíte (e2e/e2ee-check.mjs) exercita tudo em Node.
//
// Por que um chaveiro e não "o par de chaves": o código antigo guardava UM par por aparelho e, ao abrir o app num aparelho
// sem chave, gerava outro e SOBRESCREVIA a chave pública da conta. Resultado: cada aparelho novo trocava a chave publicada,
// os outros aparelhos deixavam de decifrar o que chegava depois (e republicavam a deles no próximo acesso: um cabo de guerra
// entre aparelhos), e trocar de navegador tornava ilegível todo o histórico. Com o chaveiro, a troca de chave vira um ato
// explícito (rotação), as chaves antigas continuam decifrando o que já existe, e levar as chaves a outro aparelho é um
// backup cifrado com a senha da pessoa (ver p2pBundle.ts).

export type KeyEntry = {
  /** Identificador estável: base64url dos 16 primeiros bytes do SHA-256 da chave pública canônica. */
  id: string;
  publicJwk: JsonWebKey;
  privateJwk: JsonWebKey;
  createdAt: number;
  /** Presente quando a chave deixou de ser a ativa (continua servindo para decifrar). */
  retiredAt?: number;
};

export type Keyring = { v: 2; activeId: string; keys: KeyEntry[] };

export const MAX_KEYS_IN_RING = 32;
export const ECDH_PARAMS: EcKeyGenParams = { name: 'ECDH', namedCurve: 'P-256' };

const B64URL_32 = /^[A-Za-z0-9_-]{43}$/;

const getSubtle = (subtle?: SubtleCrypto): SubtleCrypto => {
  const s = subtle ?? globalThis.crypto?.subtle;
  if (!s) throw new Error('WebCrypto indisponível');
  return s;
};

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const normal = b64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normal + '='.repeat((4 - (normal.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Chave pública no formato canônico (só o que identifica o ponto), ou `null` se não for uma P-256 válida. */
export function cleanPublicJwk(raw: unknown): JsonWebKey | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const j = raw as Record<string, unknown>;
  if (j.kty !== 'EC' || j.crv !== 'P-256') return null;
  if (typeof j.x !== 'string' || typeof j.y !== 'string' || !B64URL_32.test(j.x) || !B64URL_32.test(j.y)) return null;
  return { kty: 'EC', crv: 'P-256', x: j.x, y: j.y };
}

export function cleanPrivateJwk(raw: unknown): JsonWebKey | null {
  const pub = cleanPublicJwk(raw);
  const d = (raw as Record<string, unknown> | null)?.d;
  if (!pub || typeof d !== 'string' || !B64URL_32.test(d)) return null;
  return { ...pub, d };
}

/** `{"crv":"P-256","kty":"EC","x":"…","y":"…"}`, sempre na mesma ordem: o que se publica e se compara. */
export function canonicalPublicJson(jwk: JsonWebKey): string {
  const p = cleanPublicJwk(jwk);
  if (!p) throw new Error('Chave pública inválida');
  return JSON.stringify({ crv: p.crv, kty: p.kty, x: p.x, y: p.y });
}

/** Aceita a chave pública como texto JSON (do perfil, do payload) ou objeto. */
export function parsePublicKey(raw: string | JsonWebKey | null | undefined): JsonWebKey | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    if (raw.length > 640) return null;
    try {
      return cleanPublicJwk(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  return cleanPublicJwk(raw);
}

export async function keyIdOf(publicJwk: JsonWebKey, subtle?: SubtleCrypto): Promise<string> {
  const digest = await getSubtle(subtle).digest('SHA-256', new TextEncoder().encode(canonicalPublicJson(publicJwk)));
  return bytesToBase64Url(new Uint8Array(digest).slice(0, 16));
}

export async function generateKeyEntry(now: number, subtle?: SubtleCrypto): Promise<KeyEntry> {
  const s = getSubtle(subtle);
  const pair = await s.generateKey(ECDH_PARAMS, true, ['deriveKey', 'deriveBits']);
  const [pub, priv] = await Promise.all([s.exportKey('jwk', pair.publicKey), s.exportKey('jwk', pair.privateKey)]);
  const publicJwk = cleanPublicJwk(pub);
  const privateJwk = cleanPrivateJwk(priv);
  if (!publicJwk || !privateJwk) throw new Error('Falha ao gerar o par de chaves');
  return { id: await keyIdOf(publicJwk, s), publicJwk, privateJwk, createdAt: now };
}

export const newKeyring = (entry: KeyEntry): Keyring => ({ v: 2, activeId: entry.id, keys: [entry] });

export function activeKey(ring: Keyring): KeyEntry {
  const k = ring.keys.find((x) => x.id === ring.activeId);
  if (!k) throw new Error('Chaveiro sem chave ativa');
  return k;
}

/** A entrada do chaveiro cuja chave pública é esta (comparação pelo ponto, não pelo texto). */
export function findKeyByPublic(ring: Keyring, publicKey: string | JsonWebKey | null | undefined): KeyEntry | null {
  const alvo = parsePublicKey(publicKey);
  if (!alvo) return null;
  return ring.keys.find((k) => k.publicJwk.x === alvo.x && k.publicJwk.y === alvo.y) ?? null;
}

/** Migra o formato antigo (`{ v: 1, publicJwk, privateJwk }`): vira um chaveiro de uma chave, a ativa. */
export async function migrateLegacyPair(raw: unknown, now: number, subtle?: SubtleCrypto): Promise<Keyring | null> {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;
  const publicJwk = cleanPublicJwk(r.publicJwk);
  const privateJwk = cleanPrivateJwk(r.privateJwk);
  if (!publicJwk || !privateJwk || publicJwk.x !== privateJwk.x || publicJwk.y !== privateJwk.y) return null;
  if (!(await privateMatchesPublic(privateJwk, subtle))) return null;
  return newKeyring({ id: await keyIdOf(publicJwk, subtle), publicJwk, privateJwk, createdAt: now });
}

/**
 * O `d` corresponde ao ponto (x, y)? Prova por troca de segredos com uma chave efêmera E: `d·E` tem de ser igual a `e·P`
 * (P = o ponto declarado) se, e somente se, P = d·G. Não depende de o WebCrypto do navegador conferir isso na importação.
 */
async function privateMatchesPublic(privateJwk: JsonWebKey, subtle?: SubtleCrypto): Promise<boolean> {
  try {
    const s = getSubtle(subtle);
    const efemera = await s.generateKey(ECDH_PARAMS, false, ['deriveBits']);
    const priv = await s.importKey('jwk', privateJwk, ECDH_PARAMS, false, ['deriveBits']);
    const pub = await s.importKey('jwk', cleanPublicJwk(privateJwk)!, ECDH_PARAMS, false, []);
    const [a, b] = await Promise.all([
      s.deriveBits({ name: 'ECDH', public: efemera.publicKey }, priv, 256),
      s.deriveBits({ name: 'ECDH', public: pub }, efemera.privateKey, 256),
    ]);
    const x = new Uint8Array(a);
    const y = new Uint8Array(b);
    if (x.length !== 32 || y.length !== 32) return false;
    let dif = 0;
    for (let i = 0; i < 32; i += 1) dif |= x[i] ^ y[i];
    return dif === 0;
  } catch {
    return false;
  }
}

/** Valida e normaliza um chaveiro vindo de fora (armazenamento, arquivo de backup). `null` se qualquer coisa estiver errada. */
export async function validateKeyring(raw: unknown, subtle?: SubtleCrypto): Promise<Keyring | null> {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 2 || typeof r.activeId !== 'string' || !Array.isArray(r.keys)) return null;
  if (r.keys.length === 0 || r.keys.length > MAX_KEYS_IN_RING) return null;
  const vistos = new Set<string>();
  const keys: KeyEntry[] = [];
  for (const item of r.keys) {
    if (typeof item !== 'object' || item === null) return null;
    const k = item as Record<string, unknown>;
    const publicJwk = cleanPublicJwk(k.publicJwk);
    const privateJwk = cleanPrivateJwk(k.privateJwk);
    if (!publicJwk || !privateJwk || publicJwk.x !== privateJwk.x || publicJwk.y !== privateJwk.y) return null;
    const id = await keyIdOf(publicJwk, subtle);
    if (k.id !== id || vistos.has(id)) return null; // o id declarado tem de ser o calculado: ninguém "renomeia" uma chave
    if (!(await privateMatchesPublic(privateJwk, subtle))) return null;
    vistos.add(id);
    const createdAt = typeof k.createdAt === 'number' && Number.isFinite(k.createdAt) ? k.createdAt : 0;
    const entry: KeyEntry = { id, publicJwk, privateJwk, createdAt };
    if (typeof k.retiredAt === 'number' && Number.isFinite(k.retiredAt)) entry.retiredAt = k.retiredAt;
    keys.push(entry);
  }
  if (!vistos.has(r.activeId)) return null;
  return { v: 2, activeId: r.activeId, keys };
}

/** Nova chave ativa; a anterior fica no chaveiro (aposentada) para continuar decifrando o que já existe. */
export async function rotateKeyring(ring: Keyring, now: number, subtle?: SubtleCrypto): Promise<Keyring> {
  if (ring.keys.length >= MAX_KEYS_IN_RING) throw new Error('Chaveiro cheio: exporte um backup e remova chaves muito antigas.');
  const nova = await generateKeyEntry(now, subtle);
  return {
    v: 2,
    activeId: nova.id,
    keys: [...ring.keys.map((k) => (k.id === ring.activeId ? { ...k, retiredAt: k.retiredAt ?? now } : k)), nova],
  };
}

/**
 * União de dois chaveiros (por id). A chave ativa é a de `preferActive` se ele a tiver; senão a do chaveiro `base`.
 * Usado ao restaurar um backup: as chaves do arquivo entram sem apagar as que já existem no aparelho.
 */
export function mergeKeyrings(base: Keyring | null, incoming: Keyring, preferActiveId?: string): Keyring {
  const mapa = new Map<string, KeyEntry>();
  for (const k of base?.keys ?? []) mapa.set(k.id, k);
  for (const k of incoming.keys) {
    const atual = mapa.get(k.id);
    mapa.set(k.id, atual ? { ...atual, ...(k.retiredAt && !atual.retiredAt ? { retiredAt: k.retiredAt } : {}) } : k);
  }
  const keys = [...mapa.values()].slice(0, MAX_KEYS_IN_RING);
  const ativa = preferActiveId && mapa.has(preferActiveId) ? preferActiveId : base?.activeId && mapa.has(base.activeId) ? base.activeId : incoming.activeId;
  return { v: 2, activeId: ativa, keys: keys.map((k) => (k.id === ativa ? withoutRetired(k) : k.retiredAt ? k : { ...k, retiredAt: k.createdAt || 1 })) };
}

function withoutRetired(k: KeyEntry): KeyEntry {
  const { retiredAt: _ignorado, ...resto } = k;
  void _ignorado;
  return resto;
}

/** Impressão digital legível: 5 grupos de 5 dígitos (o mesmo valor aparece nos dois aparelhos que veem a mesma chave). */
export async function fingerprint(publicKey: string | JsonWebKey, subtle?: SubtleCrypto): Promise<string> {
  const jwk = parsePublicKey(publicKey);
  if (!jwk) throw new Error('Chave pública inválida');
  const digest = new Uint8Array(await getSubtle(subtle).digest('SHA-256', new TextEncoder().encode(canonicalPublicJson(jwk))));
  return groupDigits(digest, 5);
}

/** "Número de segurança" da conversa: igual para os dois lados, independe de quem pergunta; muda se qualquer chave mudar. */
export async function safetyNumber(a: string | JsonWebKey, b: string | JsonWebKey, subtle?: SubtleCrypto): Promise<string> {
  const ja = parsePublicKey(a);
  const jb = parsePublicKey(b);
  if (!ja || !jb) throw new Error('Chave pública inválida');
  const [x, y] = [canonicalPublicJson(ja), canonicalPublicJson(jb)].sort();
  const digest = new Uint8Array(await getSubtle(subtle).digest('SHA-256', new TextEncoder().encode(`exelula-safety-v1\n${x}\n${y}`)));
  return groupDigits(digest, 6);
}

function groupDigits(digest: Uint8Array, groups: number): string {
  const blocos: string[] = [];
  for (let g = 0; g < groups; g += 1) {
    const n = ((digest[g * 3] << 16) | (digest[g * 3 + 1] << 8) | digest[g * 3 + 2]) % 100_000;
    blocos.push(String(n).padStart(5, '0'));
  }
  return blocos.join(' ');
}
