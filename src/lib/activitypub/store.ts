// src/lib/activitypub/store.ts
// O contrato entre a lógica da federação e o armazenamento. Só tipos: a lógica (inbox, worker, conta, descoberta)
// recebe um `FederationStore` e nunca fala com o Firestore diretamente.
//
// POR QUE ESSA SEPARAÇÃO: a lógica de segurança da federação — o que se aceita, o que se entrega, quando se desiste
// — precisa ser testada exaustivamente, com um armazenamento em memória, sem emuladores e em milissegundos. O adaptador
// do Firestore (`firestoreStore.ts`) é uma camada fina e fica sob teste próprio contra o emulador.
import type { SealedSecret } from './keys.ts';
import type { InstancePolicy, PlatformFlags, UserBlock } from './gate.ts';
import type { Outcome } from './delivery.ts';

export type HandleState = 'active' | 'off' | 'deleting' | 'deleted';

/** Reserva do handle federado. Nunca é liberada: reaproveitar um handle permitiria personificar quem saiu. */
export type HandleRecord = {
  handle: string;
  uid: string;
  state: HandleState;
  publicKeyPem: string;
  createdAtMs: number;
  /**
   * Quando a chave privada deve ser destruída. Definido ao remover a conta: a chave precisa sobreviver o bastante
   * para o `Delete` do ator ser entregue e retentado (o horizonte de tentativas é de ~1,5 dia), e não mais que isso.
   */
  keyDeleteAfterMs: number | null;
};

/** O estado de federação de UMA conta (o que a pessoa escolheu). */
export type AccountRecord = {
  uid: string;
  enabled: boolean;
  paused: boolean;
  handle: string | null;
  /** Posts anteriores a isto nunca federam. Regravado a cada ativação e a cada retomada. */
  eligibleSince: number;
  enabledAtMs: number | null;
  publicKeyPem: string | null;
  updatedAtMs: number;
  /** Migração: contas para onde a pessoa aponta (`alsoKnownAs`) e para onde se mudou (`movedTo`). */
  alsoKnownAs: string[];
  movedTo: string | null;
};

/** O que o actor mostra do perfil. Nunca contém e-mail, data de nascimento ou qualquer coisa de `private/`. */
export type LocalProfile = {
  uid: string;
  name: string;
  username: string;
  bio: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  website: string | null;
  location: string | null;
  createdAtMs: number;
  profileVisibility: 'public' | 'private';
  /** Conta institucional da casa (`users/{uid}.isOfficial`): o ator dela é público e indexável, ao contrário do padrão protetor. */
  isOfficial?: boolean;
};

export type LocalPost = {
  id: string;
  userId: string;
  text: string;
  hashtags: string[];
  media: { url: string; type: 'image' | 'video'; alt: string | null }[];
  createdAtMs: number;
  updatedAtMs: number | null;
  visibility: 'public' | 'followers' | 'private';
  federation: string | null;
  type: string;
  category: string;
  isDeleted: boolean;
  hasPoll: boolean;
  sensitive: boolean;
  youtubeVideoId: string | null;
  quotedPostId?: string | null;
  quotedPostUrl?: string | null;
  headline?: string | null;
};

export type LocalComment = {
  id: string;
  postId: string;
  userId: string;
  text: string;
  createdAtMs: number;
  parentCommentId: string | null;
  isDeleted: boolean;
  sensitive: boolean;
  isRemoteFediverse?: boolean;
};

/** Objeto que JÁ saiu: é o registro de que um post foi federado. Mora fora do post (o worker não escreve em posts). */
export type FederatedObject = {
  postId: string;
  uid: string;
  objectId: string;
  scope: 'public' | 'unlisted' | 'followers';
  createdAtMs: number;
  state: 'federated' | 'deleted';
  lastActivityAtMs: number;
};

export type RemoteActorRecord = {
  actorId: string;
  /** `preferredUsername@domínio`. */
  handle: string;
  domain: string;
  type: string;
  inbox: string;
  sharedInbox: string | null;
  keyId: string;
  publicKeyPem: string;
  name: string;
  iconUrl: string | null;
  summary: string;
  movedTo: string | null;
  state: 'ok' | 'gone';
  fetchedAtMs: number;
  /** Última vez que forçamos nova busca por causa de falha de assinatura. Limita a amplificação. */
  lastForcedRefreshAtMs: number;
};

export type FollowerRecord = {
  uid: string;
  actorId: string;
  inbox: string;
  sharedInbox: string | null;
  domain: string;
  /** O `Follow` recebido, devolvido dentro do `Accept` para o servidor remoto casar a resposta. */
  followActivity: Record<string, unknown>;
  createdAtMs: number;
};

export type JobOp =
  | 'create'
  | 'update'
  | 'delete'
  | 'delete-actor'
  | 'comment-create'
  | 'comment-delete'
  | 'remote-like'
  | 'remote-unlike'
  | 'remote-boost'
  | 'remote-unboost'
  | 'local-boost'
  | 'local-unboost'
  | 'remote-reply';

/** O que uma ENTREGA pode ser: as operações da fila mais as respostas a quem nos segue. */
export type DeliveryOp = JobOp | 'accept' | 'reject';

/** Pedido de saída: uma linha por mudança num post. O worker o expande em entregas por destino. */
export type OutboundJob = {
  id: string;
  op: JobOp;
  uid: string;
  postId: string | null;
  commentId?: string | null;
  /** Só em `delete-actor`: o instantâneo dos destinos, porque os seguidores já terão sido apagados. */
  targets: { inbox: string; domain: string }[] | null;
  createdAtMs: number;
  nextAttemptAt: number | null;
  attempts: number;
  state: 'pending' | 'done' | 'skipped';
  note: string | null;
};

export type DeliveryStatus = 'pending' | 'sent' | 'failed' | 'dead' | 'cancelled';

export type DeliveryRecord = {
  id: string;
  uid: string;
  op: DeliveryOp;
  /** Id do post; do actor em `delete-actor`; do `Follow` respondido em `accept`/`reject`. */
  objectId: string;
  activityId: string;
  targetInbox: string;
  domain: string;
  /** O corpo EXATO a enviar. Reenviar os mesmos bytes mantém o `Digest` e a idempotência no destino. */
  body: string;
  status: DeliveryStatus;
  attempts: number;
  /** `null` fora do estado `pending`: sai do índice da fila (consulta de campo único, sem índice composto). */
  nextAttemptAt: number | null;
  lastDetail: string | null;
  lastOutcome: Outcome | null;
  createdAtMs: number;
  sentAtMs: number | null;
};

export type DomainHealth = { domain: string; consecutiveFailures: number; cooldownUntilMs: number; lastFailureMs: number };

export type AuditEntry = {
  atMs: number;
  kind: 'inbox' | 'delivery' | 'account' | 'policy' | 'worker';
  type?: string;
  domain?: string;
  decision: string;
  reason?: string;
  uid?: string;
};

export type RemoteFlag = {
  fromActor: string;
  fromDomain: string;
  targets: string[];
  content: string;
  receivedAtMs: number;
};

/** Tudo o que a federação lê e grava. Implementado em memória (testes) e no Firestore (produção). */
export interface FederationStore {
  // ── configuração da casa ──
  getPlatform(): Promise<PlatformFlags>;
  getInstancePolicy(): Promise<InstancePolicy>;
  /**
   * Grava a chave-mestra de federação da casa. SÓ administradores chegam aqui (a rota confere); o armazenamento não
   * decide quem pode. Cada chamada invalida o cache de leitura, para o botão de emergência valer sem esperar.
   */
  setPlatform(patch: Partial<PlatformFlags>): Promise<void>;
  /** Regra da casa para um domínio. `null` remove a regra. */
  setInstanceRule(domain: string, action: 'allow' | 'silence' | 'suspend' | null): Promise<void>;

  // ── contas e handles ──
  getHandle(handle: string): Promise<HandleRecord | null>;
  getAccount(uid: string): Promise<AccountRecord | null>;
  /** Cria a reserva SE não existir. `false` = já existe (de outra pessoa ou da mesma). */
  createHandleIfAbsent(record: HandleRecord): Promise<boolean>;
  /** Regrava uma reserva que já é desta pessoa (troca de chave, mudança de estado). */
  putHandle(record: HandleRecord): Promise<void>;
  /** Reservas cuja chave já pode ser destruída. */
  listHandlesWithKeyDue(nowMs: number, limit: number): Promise<HandleRecord[]>;
  setHandleState(handle: string, state: HandleState): Promise<void>;
  saveAccount(record: AccountRecord): Promise<void>;
  /** O handle desta pessoa, se já reservou um (mesmo desligado). */
  findHandleByUid(uid: string): Promise<HandleRecord | null>;

  // ── chaves ──
  saveSealedKey(uid: string, sealed: SealedSecret): Promise<void>;
  /** Grava SE ainda não existir; `false` = já existia. É o que impede duas instâncias do servidor de criar chaves diferentes. */
  saveSealedKeyIfAbsent(uid: string, sealed: SealedSecret): Promise<boolean>;
  loadSealedKey(uid: string): Promise<SealedSecret | null>;
  deleteKey(uid: string): Promise<void>;

  // ── conteúdo local ──
  getProfile(uid: string): Promise<LocalProfile | null>;
  getPost(postId: string): Promise<LocalPost | null>;
  getObject(postId: string): Promise<FederatedObject | null>;
  putObject(record: FederatedObject): Promise<void>;
  /**
   * A outbox só mostra o alcance PÚBLICO (não lista não listados nem só-seguidores). Do mais novo ao mais velho;
   * `before` em ms. No Firestore isto vive numa subcoleção própria, ordenada por um campo só — assim a consulta usa
   * o índice automático e não depende de um índice composto que o emulador não validaria.
   */
  listPublicObjects(uid: string, before: number | null, limit: number): Promise<FederatedObject[]>;
  countPublicObjects(uid: string): Promise<number>;
  /** Contagens da própria federação, para o NodeInfo: contas que optaram e objetos públicos entregues. */
  federationCounts(): Promise<{ accounts: number; publicObjects: number }>;

  // ── seguidores remotos ──
  getFollower(uid: string, actorId: string): Promise<FollowerRecord | null>;
  putFollower(record: FollowerRecord): Promise<void>;
  deleteFollower(uid: string, actorId: string): Promise<boolean>;
  /** Todos os vínculos de seguidor deste ator, em qualquer conta local. */
  findFollowersByActor(actorId: string): Promise<FollowerRecord[]>;
  listFollowers(uid: string, limit: number, afterActorId: string | null): Promise<FollowerRecord[]>;
  countFollowers(uid: string): Promise<number>;

  // ── atores remotos (cache) ──
  getRemoteActor(actorId: string): Promise<RemoteActorRecord | null>;
  putRemoteActor(record: RemoteActorRecord): Promise<void>;

  // ── idempotência de entrada ──
  /** `true` se é a PRIMEIRA vez que este id é visto; `false` se já foi (replay). Atômico. */
  markSeen(activityId: string, ttlMs: number): Promise<boolean>;

  // ── saída da federação ──
  /**
   * Apaga o que a federação guarda DESTA pessoa além do vínculo com seguidores: os objetos federados, a outbox e os
   * bloqueios. Chamado quando ela sai da federação ou apaga a conta (LGPD: não sobra metadado de quem foi embora).
   * Não toca em handle (reservado para sempre) nem em chave (tem prazo próprio).
   */
  purgeUserData(uid: string): Promise<void>;

  // ── bloqueios da pessoa ──
  listUserBlocks(uid: string): Promise<UserBlock[]>;
  addUserBlock(uid: string, block: UserBlock): Promise<void>;
  removeUserBlock(uid: string, block: UserBlock): Promise<void>;

  // ── fila de saída ──
  enqueueJob(job: OutboundJob): Promise<void>;
  claimDueJobs(nowMs: number, limit: number, leaseMs: number): Promise<OutboundJob[]>;
  finishJob(id: string, state: 'done' | 'skipped', note: string | null): Promise<void>;
  /** Cria a entrega SE não existir (id determinístico). `false` = já estava na fila. */
  putDeliveryIfAbsent(record: DeliveryRecord): Promise<boolean>;
  claimDueDeliveries(nowMs: number, limit: number, leaseMs: number): Promise<DeliveryRecord[]>;
  updateDelivery(id: string, patch: Partial<DeliveryRecord>): Promise<void>;
  listDeliveries(uid: string, limit: number): Promise<DeliveryRecord[]>;
  getDelivery(id: string): Promise<DeliveryRecord | null>;
  getDomainHealth(domain: string): Promise<DomainHealth | null>;
  setDomainHealth(health: DomainHealth): Promise<void>;
  /** Quantidade de entregas e tarefas pendentes, para observabilidade. */
  queueDepth(): Promise<{ jobs: number; deliveries: number; dead: number }>;

  // ── observabilidade ──
  audit(entry: AuditEntry): Promise<void>;
  bump(counter: string, by?: number): Promise<void>;
  /** Contadores de um dia (`yyyymmdd`, UTC). Vazio se o dia não teve nada. */
  readCounters(day: string): Promise<Record<string, number>>;
  saveFlag(flag: RemoteFlag): Promise<void>;

  // ── interações federadas (opcional para manter mocks antigos compatíveis) ──
  getComment?(postId: string, commentId: string): Promise<LocalComment | null>;
  recordRemoteLike?(postId: string, actor: RemoteActorRecord, activityId: string): Promise<'added' | 'duplicate' | 'missing-post'>;
  removeRemoteLike?(postId: string, actorId: string): Promise<boolean>;
  recordRemoteBoost?(postId: string, actor: RemoteActorRecord, activityId: string): Promise<'added' | 'duplicate' | 'missing-post'>;
  removeRemoteBoost?(postId: string, actorId: string): Promise<boolean>;
  recordRemoteComment?(input: {
    postId: string;
    apObjectId: string;
    actor: RemoteActorRecord;
    text: string;
    createdAtMs: number;
    parentCommentId?: string | null;
  }): Promise<'added' | 'duplicate' | 'missing-post'>;
  removeRemoteComment?(apObjectId: string, actorId: string): Promise<boolean>;
  ingestRemotePost?(input: {
    actor: RemoteActorRecord;
    apObjectId: string;
    text: string;
    url: string;
    createdAtMs: number;
    media?: { url: string; type: 'image' | 'video'; alt?: string | null }[];
    quoteUrl?: string | null;
    customEmojis?: Record<string, string>;
  }): Promise<'added' | 'duplicate' | 'no-followers'>;
  hasRemoteFollowers?(actorId: string): Promise<boolean>;
  hasPost?(postId: string): Promise<boolean>;
  ingestRemoteAnnounce?(input: {
    booster: RemoteActorRecord;
    activityId: string;
    apObjectId: string;
    boostCreatedAtMs: number;
    author?: RemoteActorRecord;
    text?: string;
    url?: string;
    postCreatedAtMs?: number;
    media?: { url: string; type: 'image' | 'video'; alt?: string | null }[];
    customEmojis?: Record<string, string>;
  }): Promise<'added' | 'duplicate' | 'no-followers' | 'missing-post'>;
  // Curtir ou repostar um COMENTÁRIO nosso (e não o post): o marcador vai para o comentário, e as Functions de comentário
  // contam e notificam a pessoa certa. Antes, curtir o comentário curtia o post.
  recordRemoteCommentLike?(postId: string, commentId: string, actor: RemoteActorRecord, activityId: string): Promise<'added' | 'duplicate' | 'missing-comment'>;
  removeRemoteCommentLike?(postId: string, commentId: string, actorId: string): Promise<boolean>;
  recordRemoteCommentBoost?(postId: string, commentId: string, actor: RemoteActorRecord, activityId: string): Promise<'added' | 'duplicate' | 'missing-comment'>;
  removeRemoteCommentBoost?(postId: string, commentId: string, actorId: string): Promise<boolean>;
  /** O servidor remoto ACEITOU o nosso Follow: marca `ap_following` como aceito. `false` = não seguíamos esse ator. */
  acceptOutboundFollow?(uid: string, remoteActorId: string): Promise<boolean>;
  /** O servidor remoto RECUSOU o nosso Follow: desfaz o "Seguindo" gravado por antecipação. `false` = não seguíamos. */
  rejectOutboundFollow?(uid: string, remoteActorId: string): Promise<boolean>;
  /** Edição de um post ou comentário remoto que guardamos. Só o MESMO ator que o criou pode alterá-lo. */
  updateRemoteContent?(apObjectId: string, actorId: string, text: string): Promise<'post' | 'comment' | 'unknown'>;
  /** O autor apagou na origem: o que guardamos vira túmulo (sem texto nem mídia). */
  removeRemotePost?(apObjectId: string, actorId: string): Promise<boolean>;
  /** O ator removeu a conta na origem: os posts dele que guardamos viram túmulo. Devolve quantos. */
  removeRemoteActorContent?(actorId: string): Promise<number>;
  getRemotePostMeta?(postId: string): Promise<{
    remoteObjectId: string;
    remoteInbox: string;
    remoteActorId: string;
  } | null>;
  ingestRemoteDm?(input: {
    targetUid: string;
    actor: RemoteActorRecord;
    apObjectId: string;
    text: string;
    createdAtMs: number;
  }): Promise<'added' | 'duplicate' | 'rejected'>;
}
