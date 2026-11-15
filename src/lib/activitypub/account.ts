// src/lib/activitypub/account.ts
// Ciclo de vida da federação de UMA conta: ativar, pausar, retomar, desligar. É aqui que as promessas feitas à pessoa
// viram código:
//
// - **Ativar é escolha dela e exige e-mail confirmado.** Conta que ainda não provou posse do e-mail não federa.
// - **O handle é reservado para sempre.** `usuario@exercitodolula.app` identifica a pessoa para os outros servidores.
//   Se ela desligar, trocar de @ aqui ou apagar a conta, o handle continua dela (ou de ninguém): reaproveitá-lo
//   permitiria a outra pessoa se passar por ela perante quem já a seguia.
// - **Retomar não federa o passado.** Cada ativação e cada retomada regravam `eligibleSince`: o que foi publicado
//   enquanto a federação estava parada nunca sai.
// - **Desligar retira a pessoa do Fediverso em melhor esforço.** Enfileira o `Delete` do ator para quem a seguia e
//   remove os vínculos. NÃO garante que os outros servidores obedeçam, e a interface diz isso.
import { generateActorKeyPair, openSecret, sealSecret } from './keys.ts';
import type { MasterKeyring } from './keys.ts';
import { normalizeHandle, buildAcct, domainOfUrl } from './identity.ts';
import type { AccountRecord, FederationStore, HandleRecord, OutboundJob } from './store.ts';

export type AccountDeps = {
  store: FederationStore;
  keyring: MasterKeyring;
  now: () => number;
  /** Host público, ex.: `exercitodolula.app`. */
  ownHost: string;
  randomId: () => string;
};

export type FederationStatus = {
  platformEnabled: boolean;
  enabled: boolean;
  paused: boolean;
  handle: string | null;
  acct: string | null;
  eligibleSince: number | null;
  followers: number;
  alsoKnownAs: string[];
  movedTo: string | null;
};

export type AccountFailure =
  | 'plataforma-desligada'
  | 'email-nao-confirmado'
  | 'perfil-inexistente'
  | 'handle-invalido'
  | 'handle-indisponivel'
  | 'conta-removida'
  | 'nao-ativada'
  | 'ja-ativada'
  | 'alias-invalido'
  | 'muitos-aliases';

export type AccountResult = { ok: true; account: AccountRecord } | { ok: false; reason: AccountFailure };

const falha = (reason: AccountFailure): AccountResult => ({ ok: false, reason });

export async function getFederationStatus(deps: Pick<AccountDeps, 'store' | 'ownHost'>, uid: string): Promise<FederationStatus> {
  const [plataforma, conta] = await Promise.all([deps.store.getPlatform(), deps.store.getAccount(uid)]);
  const seguidores = conta?.enabled ? await deps.store.countFollowers(uid) : 0;
  return {
    platformEnabled: plataforma.enabled && !plataforma.killSwitch,
    enabled: Boolean(conta?.enabled),
    paused: Boolean(conta?.paused),
    handle: conta?.handle ?? null,
    acct: conta?.handle ? buildAcct(conta.handle, deps.ownHost) : null,
    eligibleSince: conta?.enabled ? conta.eligibleSince : null,
    followers: seguidores,
    alsoKnownAs: conta?.alsoKnownAs ?? [],
    movedTo: conta?.movedTo ?? null,
  };
}

/** Liga a federação da conta. Idempotente: ligar o que já está ligado devolve a conta como está. */
export async function enableFederation(deps: AccountDeps, uid: string, contexto: { emailVerified: boolean }): Promise<AccountResult> {
  const { store } = deps;
  const plataforma = await store.getPlatform();
  if (!plataforma.enabled || plataforma.killSwitch) return falha('plataforma-desligada');
  // Conta sem posse de e-mail comprovada não federa (mesma regra de postar, comentar e seguir).
  if (!contexto.emailVerified) return falha('email-nao-confirmado');

  const atual = await store.getAccount(uid);
  if (atual?.enabled) return { ok: true, account: atual };

  const perfil = await store.getProfile(uid);
  if (!perfil) return falha('perfil-inexistente');

  const agora = deps.now();
  const existente = await store.findHandleByUid(uid);
  if (existente && (existente.state === 'deleting' || existente.state === 'deleted')) return falha('conta-removida');

  let handle: HandleRecord;
  if (existente) {
    // Religar: o handle e (se existir) a chave continuam os mesmos. O que muda é o `eligibleSince`.
    handle = existente;
    const selada = await store.loadSealedKey(uid);
    if (!selada) {
      // Reserva sem chave (falha no meio de uma ativação anterior): gera outra e atualiza a pública da reserva.
      const par = await generateActorKeyPair();
      await store.saveSealedKey(uid, sealSecret(par.privateKeyPem, deps.keyring, uid));
      handle = { ...existente, publicKeyPem: par.publicKeyPem };
    }
    handle = { ...handle, state: 'active', keyDeleteAfterMs: null };
    await store.putHandle(handle);
  } else {
    const nome = normalizeHandle(perfil.username);
    if (!nome) return falha('handle-invalido');
    const par = await generateActorKeyPair();
    const novo: HandleRecord = {
      handle: nome,
      uid,
      state: 'active',
      publicKeyPem: par.publicKeyPem,
      createdAtMs: agora,
      keyDeleteAfterMs: null,
    };
    // A reserva é o ato atômico que garante unicidade. A chave só é gravada DEPOIS de a reserva ser nossa.
    const reservou = await store.createHandleIfAbsent(novo);
    if (!reservou) {
      const dono = await store.getHandle(nome);
      if (!dono || dono.uid !== uid) return falha('handle-indisponivel');
      // Corrida consigo mesma: a reserva já é nossa.
    }
    await store.saveSealedKey(uid, sealSecret(par.privateKeyPem, deps.keyring, uid));
    handle = novo;
  }

  const conta: AccountRecord = {
    uid,
    enabled: true,
    paused: false,
    handle: handle.handle,
    // Ativar nunca federa o passado.
    eligibleSince: agora,
    enabledAtMs: agora,
    publicKeyPem: handle.publicKeyPem,
    updatedAtMs: agora,
    alsoKnownAs: atual?.alsoKnownAs ?? [],
    movedTo: null,
  };
  await store.saveAccount(conta);
  await store.audit({ atMs: agora, kind: 'account', decision: 'ativada', uid });
  await store.bump('contas.ativadas');
  return { ok: true, account: conta };
}

export async function pauseFederation(deps: AccountDeps, uid: string): Promise<AccountResult> {
  const conta = await deps.store.getAccount(uid);
  if (!conta?.enabled) return falha('nao-ativada');
  if (conta.paused) return { ok: true, account: conta };
  const agora = deps.now();
  const nova = { ...conta, paused: true, updatedAtMs: agora };
  await deps.store.saveAccount(nova);
  await deps.store.audit({ atMs: agora, kind: 'account', decision: 'pausada', uid });
  return { ok: true, account: nova };
}

/** Retoma. Regrava `eligibleSince`: o que nasceu durante a pausa NÃO é federado. */
export async function resumeFederation(deps: AccountDeps, uid: string): Promise<AccountResult> {
  const plataforma = await deps.store.getPlatform();
  if (!plataforma.enabled || plataforma.killSwitch) return falha('plataforma-desligada');
  const conta = await deps.store.getAccount(uid);
  if (!conta?.enabled) return falha('nao-ativada');
  if (!conta.paused) return { ok: true, account: conta };
  const agora = deps.now();
  const nova = { ...conta, paused: false, eligibleSince: agora, updatedAtMs: agora };
  await deps.store.saveAccount(nova);
  await deps.store.audit({ atMs: agora, kind: 'account', decision: 'retomada', uid });
  return { ok: true, account: nova };
}

/**
 * Desliga a federação da conta e a retira do Fediverso em melhor esforço. O handle continua reservado e a chave é
 * mantida (para assinar o `Delete` e para o caso de a pessoa voltar). Religar depois reaparece como NOVO: quem a
 * seguia precisa segui-la de novo.
 */
export async function disableFederation(deps: AccountDeps, uid: string): Promise<AccountResult> {
  const { store } = deps;
  const conta = await store.getAccount(uid);
  if (!conta?.enabled) return falha('nao-ativada');
  const agora = deps.now();

  const nova: AccountRecord = { ...conta, enabled: false, paused: false, updatedAtMs: agora };
  await store.saveAccount(nova);
  if (conta.handle) await store.setHandleState(conta.handle, 'off');

  // O worker faz o resto: levanta os destinos, entrega o Delete do ator e remove os vínculos.
  await store.enqueueJob(jobDeleteActor(deps, uid));
  await store.audit({ atMs: agora, kind: 'account', decision: 'desligada', uid });
  await store.bump('contas.desligadas');
  return { ok: true, account: nova };
}

/** Atualiza a lista `alsoKnownAs` da conta (até 5 URIs HTTPS externas) para vínculo/migração no Fediverso. */
export async function setAlsoKnownAs(deps: AccountDeps, uid: string, aliases: string[]): Promise<AccountResult> {
  const { store } = deps;
  const plataforma = await store.getPlatform();
  if (!plataforma.enabled || plataforma.killSwitch) return falha('plataforma-desligada');
  const conta = await store.getAccount(uid);
  if (!conta?.enabled) return falha('nao-ativada');

  const proprio = deps.ownHost.toLowerCase();
  const limpos: string[] = [];
  const vistos = new Set<string>();
  for (const bruto of aliases) {
    const trimmed = typeof bruto === 'string' ? bruto.trim() : '';
    if (!trimmed) continue;
    const dom = domainOfUrl(trimmed);
    if (!dom || dom === proprio || dom.endsWith(`.${proprio}`)) return falha('alias-invalido');
    if (!trimmed.startsWith('https://')) return falha('alias-invalido');
    if (!vistos.has(trimmed)) {
      vistos.add(trimmed);
      limpos.push(trimmed);
    }
  }
  if (limpos.length > 5) return falha('muitos-aliases');

  const agora = deps.now();
  const nova: AccountRecord = { ...conta, alsoKnownAs: limpos, updatedAtMs: agora };
  await store.saveAccount(nova);
  await store.audit({ atMs: agora, kind: 'account', decision: 'aliases-atualizados', reason: String(limpos.length), uid });
  return { ok: true, account: nova };
}

/**
 * Conta apagada: igual a desligar, mas o handle passa a `deleting` (nunca mais reativável) e a chave ganha prazo
 * para ser destruída. Chamada pelo gatilho de exclusão de conta, que só enfileira; o trabalho pesado é do worker.
 */
export async function markAccountDeleted(deps: AccountDeps, uid: string): Promise<void> {
  const { store } = deps;
  const agora = deps.now();
  const reserva = await store.findHandleByUid(uid);
  if (!reserva) return; // nunca federou: nada a retirar
  await store.putHandle({
    ...reserva,
    state: 'deleting',
    // O Delete do ator precisa ser entregue e retentado (~1,5 dia): a chave vive até depois disso, e não mais.
    keyDeleteAfterMs: agora + 3 * 24 * 3600 * 1000,
  });
  const conta = await store.getAccount(uid);
  if (conta) await store.saveAccount({ ...conta, enabled: false, paused: false, updatedAtMs: agora });
  await store.enqueueJob(jobDeleteActor(deps, uid));
  await store.audit({ atMs: agora, kind: 'account', decision: 'removida', uid });
  await store.bump('contas.removidas');
}

function jobDeleteActor(deps: AccountDeps, uid: string): OutboundJob {
  const agora = deps.now();
  return {
    id: `delete-actor-${uid}-${agora}`,
    op: 'delete-actor',
    uid,
    postId: null,
    targets: null,
    createdAtMs: agora,
    nextAttemptAt: agora,
    attempts: 0,
    state: 'pending',
    note: null,
  };
}

/** Decifra a chave privada de uma conta para assinar. Lança se a chave não existe ou foi adulterada. */
export async function loadPrivateKey(deps: Pick<AccountDeps, 'store' | 'keyring'>, uid: string): Promise<string | null> {
  const selada = await deps.store.loadSealedKey(uid);
  return selada ? openSecret(selada, deps.keyring, uid) : null;
}
