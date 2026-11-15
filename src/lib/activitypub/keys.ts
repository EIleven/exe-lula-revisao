// src/lib/activitypub/keys.ts
// Chaves de assinatura dos actors e a cifra que as guarda. Módulo puro (`node:crypto` apenas).
//
// DESENHO (emenda ao ADR-AP-5): a chave privada de cada pessoa é gerada no servidor, cifrada com AES-256-GCM e só o
// texto cifrado vai ao Firestore, em coleção sem NENHUM acesso de cliente. A chave-mestra mora no Secret Manager.
//
// Por que não "um segredo por pessoa no Secret Manager": não escala (criar, versionar e cobrar um segredo por conta) e
// não compra nada além do que a cifra envelope já compra — comprometer o banco SOZINHO não entrega nenhuma chave
// privada, porque a mestra mora em outro serviço, com outro controle de acesso. Comprometer o banco E o segredo
// entrega tudo, nos dois desenhos.
//
// A cifra é autenticada (GCM) e amarrada à pessoa pelo AAD: trocar o texto cifrado de A pelo de B no banco não
// produz uma chave válida para B — a decifragem falha em vez de entregar a chave errada.
import { createCipheriv, createDecipheriv, createHash, generateKeyPair, randomBytes } from 'node:crypto';

export type ActorKeyPair = { publicKeyPem: string; privateKeyPem: string };

/** RSA 2048: o mínimo que o Fediverso aceita e que o verificador deste projeto exige. */
export function generateActorKeyPair(): Promise<ActorKeyPair> {
  return new Promise((resolve, reject) => {
    generateKeyPair(
      'rsa',
      {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      },
      (erro, publicKeyPem, privateKeyPem) => (erro ? reject(erro) : resolve({ publicKeyPem, privateKeyPem })),
    );
  });
}

/** Impressão digital curta da chave pública, para log e auditoria: nunca o PEM. */
export function publicKeyFingerprint(publicKeyPem: string): string {
  return createHash('sha256').update(publicKeyPem.trim()).digest('base64url').slice(0, 16);
}

// ───────────────────────── Chave-mestra ─────────────────────────

export type MasterKeyring = {
  /** Id da chave com que se CIFRA daqui em diante. */
  activeId: string;
  keys: ReadonlyMap<string, Buffer>;
};

/**
 * Lê o segredo da chave-mestra. Formato: `id:base64` — por exemplo `k1:Zm9v…`. Vários separados por vírgula
 * (`k2:…,k1:…`); a PRIMEIRA cifra e todas decifram, o que permite rotacionar sem migrar na hora: acrescenta-se a
 * nova na frente, e as cifras antigas seguem abrindo até serem regravadas.
 *
 * Um segredo sem `id:` (só o base64) vira a chave `k1`: é o formato mais simples de criar à mão.
 */
export function parseMasterKeyring(segredo: string | undefined | null): MasterKeyring {
  const texto = (segredo ?? '').trim();
  if (!texto) throw new Error('AP_MASTER_KEY ausente.');
  const keys = new Map<string, Buffer>();
  let activeId = '';
  for (const parte of texto.split(',')) {
    const limpa = parte.trim();
    if (!limpa) continue;
    const separador = limpa.indexOf(':');
    const id = separador > 0 ? limpa.slice(0, separador) : 'k1';
    const base64 = separador > 0 ? limpa.slice(separador + 1) : limpa;
    if (!/^[A-Za-z0-9_-]{1,16}$/.test(id)) throw new Error('Id de chave-mestra inválido.');
    const chave = Buffer.from(base64, 'base64');
    if (chave.length !== 32) throw new Error('A chave-mestra precisa ter exatamente 32 bytes.');
    if (keys.has(id)) throw new Error('Id de chave-mestra repetido.');
    keys.set(id, chave);
    if (!activeId) activeId = id;
  }
  if (!activeId) throw new Error('AP_MASTER_KEY sem nenhuma chave.');
  return { activeId, keys };
}

// ───────────────────────── Cifra envelope ─────────────────────────

export type SealedSecret = {
  v: 1;
  alg: 'A256GCM';
  /** Id da chave-mestra usada. */
  kid: string;
  iv: string;
  ct: string;
  tag: string;
};

const AAD_PREFIXO = 'ap-actor-key:';

/** Cifra um segredo para uma pessoa. O `aad` é o uid: amarra o texto cifrado ao dono. */
export function sealSecret(texto: string, keyring: MasterKeyring, aad: string): SealedSecret {
  const chave = keyring.keys.get(keyring.activeId);
  if (!chave) throw new Error('Chave-mestra ativa indisponível.');
  const iv = randomBytes(12); // 96 bits: o tamanho que o GCM foi projetado para usar
  const cifra = createCipheriv('aes-256-gcm', chave, iv);
  cifra.setAAD(Buffer.from(AAD_PREFIXO + aad, 'utf8'));
  const ct = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()]);
  return {
    v: 1,
    alg: 'A256GCM',
    kid: keyring.activeId,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: cifra.getAuthTag().toString('base64'),
  };
}

/** Decifra. Lança se a chave-mestra não existe, se o `aad` não é o do dono ou se o texto foi adulterado. */
export function openSecret(selado: SealedSecret, keyring: MasterKeyring, aad: string): string {
  if (selado.v !== 1 || selado.alg !== 'A256GCM') throw new Error('Formato de segredo desconhecido.');
  const chave = keyring.keys.get(selado.kid);
  if (!chave) throw new Error('Chave-mestra desse segredo não está disponível.');
  const decifra = createDecipheriv('aes-256-gcm', chave, Buffer.from(selado.iv, 'base64'));
  decifra.setAAD(Buffer.from(AAD_PREFIXO + aad, 'utf8'));
  decifra.setAuthTag(Buffer.from(selado.tag, 'base64'));
  return Buffer.concat([decifra.update(Buffer.from(selado.ct, 'base64')), decifra.final()]).toString('utf8');
}

/** Recifra com a chave ativa, para concluir uma rotação. Devolve `null` se já está na chave ativa. */
export function rewrapSecret(selado: SealedSecret, keyring: MasterKeyring, aad: string): SealedSecret | null {
  if (selado.kid === keyring.activeId) return null;
  return sealSecret(openSecret(selado, keyring, aad), keyring, aad);
}
