// src/lib/activitypub/instanceActor.ts
// O ator da INSTÂNCIA: a identidade com que o servidor assina as buscas (GET) que faz sem ser em nome de uma pessoa, como ler
// o perfil, a caixa de saída e as listas de um servidor que exige "Authorized Fetch" (Mastodon em modo seguro, por exemplo).
//
// Antes essas buscas eram assinadas com a chave privada do PRIMEIRO handle ativo (hoje `alexandre`): todo servidor do Fediverso
// via as consultas do HiperVerso como se fossem dele, e a chave privada de uma pessoa ficava decifrada na memória do processo,
// em cache, para sempre. O ator da instância é o que o Mastodon faz (`/actor`, tipo Application): uma chave só da casa, que
// não pertence a ninguém. Fica em `/ap/actor` e a chave é cifrada com a chave-mestra, como as das pessoas (AAD `@instance`,
// que nenhum UID do Firebase pode ter).
//
// SERVIÇO: só importa vizinhos (com .ts) e node:*, nunca Firebase nem Next. O armazenamento entra por parâmetro.
import { createPublicKey } from 'node:crypto';
import { generateActorKeyPair, openSecret, sealSecret } from './keys.ts';
import type { MasterKeyring, SealedSecret } from './keys.ts';
import { instanceActorUrl, instanceKeyIdUrl, sharedInboxUrl } from './identity.ts';
import { signRequest } from './signature.ts';

/** Id reservado do ator da instância na tabela de chaves. Nenhum UID do Firebase tem "@". */
export const INSTANCE_KEY_UID = '@instance';

export type InstanceKeys = { publicKeyPem: string; privateKeyPem: string };

export type InstanceDeps = {
  store: {
    loadSealedKey(uid: string): Promise<SealedSecret | null>;
    /** Grava SE ainda não existir. `false` = já existia (outra instância do servidor criou primeiro). */
    saveSealedKeyIfAbsent(uid: string, sealed: SealedSecret): Promise<boolean>;
  };
  keyring: MasterKeyring;
};

const publicaDe = (privateKeyPem: string): string =>
  createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' }).toString();

/**
 * A chave do ator da instância; cria na primeira vez. Várias instâncias do servidor podem tentar criar ao mesmo tempo: só uma
 * grava (`saveSealedKeyIfAbsent`), e as outras passam a usar a que ficou gravada (nunca duas chaves diferentes em uso).
 */
export async function ensureInstanceKeys(deps: InstanceDeps): Promise<InstanceKeys> {
  const abrir = (selado: SealedSecret): InstanceKeys => {
    const privateKeyPem = openSecret(selado, deps.keyring, INSTANCE_KEY_UID);
    return { privateKeyPem, publicKeyPem: publicaDe(privateKeyPem) };
  };
  const existente = await deps.store.loadSealedKey(INSTANCE_KEY_UID);
  if (existente) return abrir(existente);

  const par = await generateActorKeyPair();
  const gravou = await deps.store.saveSealedKeyIfAbsent(INSTANCE_KEY_UID, sealSecret(par.privateKeyPem, deps.keyring, INSTANCE_KEY_UID));
  if (gravou) return { privateKeyPem: par.privateKeyPem, publicKeyPem: par.publicKeyPem };
  const vencedora = await deps.store.loadSealedKey(INSTANCE_KEY_UID);
  if (!vencedora) throw new Error('A chave do ator da instância não ficou disponível.');
  return abrir(vencedora);
}

/** O documento do ator da instância (tipo Application), como o Mastodon espera ao verificar uma assinatura nossa. */
export function renderInstanceActor(entrada: { origin: string; ownHost: string; publicKeyPem: string }) {
  const id = instanceActorUrl(entrada.origin);
  return {
    '@context': ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'],
    id,
    type: 'Application',
    preferredUsername: entrada.ownHost,
    name: 'HiperVerso',
    summary: 'Conta técnica do servidor: assina as buscas que o HiperVerso faz em outros servidores do Fediverso. Ninguém publica por aqui.',
    url: entrada.origin,
    inbox: sharedInboxUrl(entrada.origin),
    endpoints: { sharedInbox: sharedInboxUrl(entrada.origin) },
    manuallyApprovesFollowers: true,
    publicKey: { id: instanceKeyIdUrl(entrada.origin), owner: id, publicKeyPem: entrada.publicKeyPem },
  };
}

/** Cabeçalhos assinados para um GET, com a chave do ator da instância (`(request-target) host date`, como o Mastodon exige). */
export async function signGetAsInstance(deps: InstanceDeps & { origin: string; now: () => number }, url: string): Promise<Record<string, string>> {
  const { privateKeyPem } = await ensureInstanceKeys(deps);
  return signRequest({ method: 'GET', url, privateKeyPem, keyId: instanceKeyIdUrl(deps.origin), now: deps.now() });
}
