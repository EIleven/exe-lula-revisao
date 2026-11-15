// src/lib/crypto/e2eeIdentity.ts
// A IDENTIDADE E2EE da conta num aparelho: guarda o chaveiro, decide se este aparelho pode criar/publicar chave e cifra/decifra
// mensagens. Sem Firebase e sem DOM: o armazenamento local, a chave pública publicada no perfil e o relógio entram por
// parâmetro (e2ee.ts liga ao localStorage e ao Firestore). A suíte (e2e/e2ee-check.mjs) simula DOIS aparelhos da mesma conta.
//
// A regra que o código antigo violava: **um aparelho que não tem a chave da conta NÃO gera outra por conta própria nem
// sobrescreve a chave publicada.** Antes, cada aparelho novo trocava a chave pública da conta; os outros deixavam de decifrar
// o que chegava e, no acesso seguinte, trocavam de volta (um cabo de guerra). Agora o aparelho sem chave fica em
// `needs-restore` até a pessoa escolher: restaurar o backup cifrado (adota a identidade da conta) ou criar uma identidade nova.
import {
  activeKey, base64ToBytes, bytesToBase64, canonicalPublicJson, ECDH_PARAMS, findKeyByPublic, generateKeyEntry, keyIdOf,
  mergeKeyrings, migrateLegacyPair, newKeyring, parsePublicKey, rotateKeyring, validateKeyring,
  type KeyEntry, type Keyring,
} from './e2eeKeyring.ts';

export type E2eeEncryptedPayload = {
  v: 1;
  alg: 'ECDH-P256-AES-GCM';
  senderPublicKey: string;
  recipientPublicKey?: string;
  iv: string;
  ciphertext: string;
};

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** A chave pública que a conta publica (`users/{uid}.e2eePublicKey`). */
export type PublishedKeys = {
  get(userId: string): Promise<string | null>;
  set(userId: string, publicKeyJson: string): Promise<void>;
};

export type IdentityStatus =
  | { status: 'ready'; keyId: string; publicKeyJson: string; created: boolean }
  /** A conta já tem uma chave publicada que ESTE aparelho não tem (ou o aparelho perdeu a sua). */
  | { status: 'needs-restore'; publishedKeyId: string | null }
  | { status: 'unsupported' }
  | { status: 'storage-unavailable' };

export type DecryptResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'unsupported' | 'missing-key' | 'invalid-payload' | 'decrypt-failed' | 'key-not-in-keyring' };

export const KEY_PREFIX_V2 = 'exelula:e2ee:v2:';
export const KEY_PREFIX_V1 = 'exelula:e2ee:v1:';
const MAX_PLAINTEXT_CHARS = 20_000;

export type IdentityDeps = {
  storage: StorageLike;
  published: PublishedKeys;
  now?: () => number;
  subtle?: SubtleCrypto;
};

export function createIdentityService(deps: IdentityDeps) {
  const subtle = deps.subtle ?? globalThis.crypto?.subtle;
  const now = deps.now ?? (() => Date.now());
  const cache = new Map<string, Promise<IdentityStatus>>();

  const invalidate = (userId: string) => cache.delete(userId);

  /** O chaveiro guardado neste aparelho. Lê o formato novo; se só houver o antigo (v1), migra. */
  async function loadRing(userId: string): Promise<Keyring | null> {
    if (!subtle) return null;
    const raw2 = deps.storage.getItem(`${KEY_PREFIX_V2}${userId}`);
    if (raw2) {
      try {
        const ring = await validateKeyring(JSON.parse(raw2), subtle);
        if (ring) return ring;
      } catch {
        // cai para o formato antigo
      }
    }
    const raw1 = deps.storage.getItem(`${KEY_PREFIX_V1}${userId}`);
    if (raw1) {
      try {
        const migrado = await migrateLegacyPair(JSON.parse(raw1), now(), subtle);
        if (migrado) {
          saveRing(userId, migrado);
          return migrado;
        }
      } catch {
        // formato inválido: trata como sem chave
      }
    }
    return null;
  }

  /** Grava o chaveiro (e espelha a chave ativa no formato antigo, para abas e versões antigas continuarem funcionando). */
  function saveRing(userId: string, ring: Keyring): void {
    const ativa = activeKey(ring);
    deps.storage.setItem(`${KEY_PREFIX_V2}${userId}`, JSON.stringify(ring));
    deps.storage.setItem(`${KEY_PREFIX_V1}${userId}`, JSON.stringify({ v: 1, publicJwk: ativa.publicJwk, privateJwk: ativa.privateJwk }));
  }

  async function publish(userId: string, key: KeyEntry): Promise<void> {
    await deps.published.set(userId, canonicalPublicJson(key.publicJwk));
  }

  async function readStatus(userId: string): Promise<IdentityStatus> {
    if (!subtle || !userId) return { status: 'unsupported' };
    let ring = await loadRing(userId);
    const publicada = await deps.published.get(userId);
    const publicadaJwk = parsePublicKey(publicada);

    if (ring) {
      const ativa = activeKey(ring);
      if (publicadaJwk) {
        const igualAtiva = publicadaJwk.x === ativa.publicJwk.x && publicadaJwk.y === ativa.publicJwk.y;
        if (!igualAtiva) {
          const conhecida = findKeyByPublic(ring, publicadaJwk);
          // Publicada = uma chave NOSSA já aposentada: a rotação foi feita aqui e a publicação não terminou. Termina.
          if (conhecida) await publish(userId, ativa);
          // Publicada = chave que este aparelho não tem: a conta mudou de identidade em outro lugar. NÃO sobrescreve.
          else return { status: 'needs-restore', publishedKeyId: await keyIdOf(publicadaJwk, subtle) };
        }
      } else {
        await publish(userId, ativa);
      }
      return { status: 'ready', keyId: ativa.id, publicKeyJson: canonicalPublicJson(ativa.publicJwk), created: false };
    }

    // Sem chaveiro neste aparelho.
    if (publicadaJwk) return { status: 'needs-restore', publishedKeyId: await keyIdOf(publicadaJwk, subtle) };

    // Primeiro aparelho da conta: cria e publica.
    const entrada = await generateKeyEntry(now(), subtle);
    ring = newKeyring(entrada);
    try {
      saveRing(userId, ring);
    } catch {
      return { status: 'storage-unavailable' };
    }
    await publish(userId, entrada);
    return { status: 'ready', keyId: entrada.id, publicKeyJson: canonicalPublicJson(entrada.publicJwk), created: true };
  }

  /** Resolve a situação da conta neste aparelho (uma vez por sessão; mutações invalidam). */
  function status(userId: string): Promise<IdentityStatus> {
    let p = cache.get(userId);
    if (!p) {
      p = readStatus(userId).catch((err): IdentityStatus => {
        cache.delete(userId); // erro de rede/permissão: tenta de novo na próxima
        throw err;
      });
      cache.set(userId, p);
      p.catch(() => {});
    }
    return p;
  }

  /** Troca a chave ativa por uma nova (a anterior fica no chaveiro e continua decifrando). */
  async function rotate(userId: string): Promise<IdentityStatus> {
    const st = await status(userId);
    if (st.status !== 'ready') throw new Error('A identidade precisa estar pronta para girar a chave.');
    const ring = await loadRing(userId);
    if (!ring) throw new Error('Chaveiro ausente');
    const novo = await rotateKeyring(ring, now(), subtle);
    saveRing(userId, novo);
    invalidate(userId);
    await publish(userId, activeKey(novo));
    return status(userId);
  }

  /**
   * "Começar do zero" neste aparelho: gera uma identidade nova e a PUBLICA, mesmo que a conta já tivesse outra. É a escolha
   * explícita de quem perdeu as chaves: as mensagens cifradas para a chave antiga só voltam a abrir se o backup aparecer.
   */
  async function createNewIdentity(userId: string): Promise<IdentityStatus> {
    if (!subtle) return { status: 'unsupported' };
    const atual = await loadRing(userId);
    const novo = atual ? await rotateKeyring(atual, now(), subtle) : newKeyring(await generateKeyEntry(now(), subtle));
    try {
      saveRing(userId, novo);
    } catch {
      return { status: 'storage-unavailable' };
    }
    invalidate(userId);
    await publish(userId, activeKey(novo));
    return status(userId);
  }

  /**
   * Restaura chaves de um backup. As do arquivo ENTRAM no chaveiro sem apagar as do aparelho. Se alguma delas for a chave que a
   * conta publica, ela vira a ativa (o aparelho passa a ter a identidade da conta); senão a ativa continua a do aparelho.
   */
  async function importKeyring(userId: string, incoming: Keyring): Promise<IdentityStatus> {
    const valido = await validateKeyring(incoming, subtle);
    if (!valido) throw new Error('Chaveiro inválido');
    const local = await loadRing(userId);
    const publicada = parsePublicKey(await deps.published.get(userId));
    const daConta = publicada ? findKeyByPublic(valido, publicada) : null;
    const unido = mergeKeyrings(local, valido, daConta?.id);
    saveRing(userId, unido);
    invalidate(userId);
    return status(userId);
  }

  async function exportKeyring(userId: string): Promise<Keyring | null> {
    return loadRing(userId);
  }

  async function deriveAes(privateJwk: JsonWebKey, peerPublicJwk: JsonWebKey): Promise<CryptoKey> {
    const [priv, pub] = await Promise.all([
      subtle!.importKey('jwk', privateJwk, ECDH_PARAMS, false, ['deriveKey']),
      subtle!.importKey('jwk', peerPublicJwk, ECDH_PARAMS, false, []),
    ]);
    return subtle!.deriveKey({ name: 'ECDH', public: pub }, priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  /** Cifra com a chave ATIVA. `null` se não der (sem WebCrypto, sem chave do destinatário, identidade pendente). */
  async function encrypt(plaintext: string, userId: string, recipientPublicKeyJson?: string | null): Promise<E2eeEncryptedPayload | null> {
    if (!subtle || !plaintext || plaintext.length > MAX_PLAINTEXT_CHARS) return null;
    const destinatario = parsePublicKey(recipientPublicKeyJson);
    if (!destinatario) return null;
    const st = await status(userId);
    if (st.status !== 'ready') return null;
    const ring = await loadRing(userId);
    if (!ring) return null;
    const minha = activeKey(ring);
    const aes = await deriveAes(minha.privateJwk, destinatario);
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const cifrado = await subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(plaintext));
    return {
      v: 1,
      alg: 'ECDH-P256-AES-GCM',
      senderPublicKey: canonicalPublicJson(minha.publicJwk),
      recipientPublicKey: canonicalPublicJson(destinatario),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(cifrado)),
    };
  }

  /**
   * Decifra. Escolhe a chave PRIVADA pela chave pública que o payload registra como "minha" (a do remetente, se fui eu quem
   * mandou; a do destinatário, se recebi) e, se ela não estiver no chaveiro, tenta as demais: depois de uma rotação, o
   * histórico antigo continua abrindo.
   */
  async function decrypt(payload: E2eeEncryptedPayload, userId: string, isSender: boolean, peerPublicKeyJson?: string | null): Promise<DecryptResult> {
    if (!subtle) return { ok: false, reason: 'unsupported' };
    if (!payload || payload.v !== 1 || typeof payload.iv !== 'string' || typeof payload.ciphertext !== 'string') return { ok: false, reason: 'invalid-payload' };
    const ring = await loadRing(userId);
    if (!ring) return { ok: false, reason: 'missing-key' };

    const par = parsePublicKey(isSender ? payload.recipientPublicKey || peerPublicKeyJson : payload.senderPublicKey || peerPublicKeyJson);
    if (!par) return { ok: false, reason: 'invalid-payload' };
    let iv: Uint8Array<ArrayBuffer>;
    let cifrado: Uint8Array<ArrayBuffer>;
    try {
      iv = base64ToBytes(payload.iv);
      cifrado = base64ToBytes(payload.ciphertext);
    } catch {
      return { ok: false, reason: 'invalid-payload' };
    }

    const minhaNoPayload = findKeyByPublic(ring, isSender ? payload.senderPublicKey : payload.recipientPublicKey);
    const ordem = minhaNoPayload ? [minhaNoPayload, ...ring.keys.filter((k) => k.id !== minhaNoPayload.id)] : ring.keys;
    for (const chave of ordem) {
      try {
        const aes = await deriveAes(chave.privateJwk, par);
        const claro = await subtle.decrypt({ name: 'AES-GCM', iv }, aes, cifrado);
        return { ok: true, text: new TextDecoder().decode(claro) };
      } catch {
        // próxima chave
      }
    }
    return { ok: false, reason: minhaNoPayload ? 'decrypt-failed' : 'key-not-in-keyring' };
  }

  return { status, rotate, createNewIdentity, importKeyring, exportKeyring, encrypt, decrypt, invalidate, loadRing };
}

export type IdentityService = ReturnType<typeof createIdentityService>;
