// src/lib/server/deviceLoginCore.ts
// O protocolo de login por dispositivo conectado (Chave Soberana), SEM Firebase nem Next: o banco, o relógio, a emissão da
// credencial e o espelho em tempo real entram por parâmetro (deps). A ligação com o mundo real está em deviceLogin.ts, e
// e2e/device-login-check.mjs percorre cada caminho com um banco de mentira.
//
//   quem quer entrar (aparelho novo, sem sessão)  →  start  →  recebe o CÓDIGO de 6 dígitos e o segredo do desafio
//   aparelho já conectado da conta                →  vê o pedido (SEM o código), DIGITA o código que está na tela do novo e aprova
//   aparelho novo                                 →  poll com o segredo → recebe a credencial
//
// O que mudou em relação à primeira versão:
//  - o código NÃO vai mais para o aparelho que aprova (nem no RTDB, nem na lista de pendentes, nem no aviso): quem aprova tem
//    de DIGITAR o que vê na tela do aparelho novo. Mostrar o código dos dois lados deixava aprovar às cegas ("fadiga de
//    aprovação": um clique cansado entrega a conta);
//  - o `poll` não QUEIMA a aprovação se a credencial falhar ao ser emitida (antes: aprovado → consumido → erro; quem aprovou
//    via "expirada" e tinha de recomeçar). Agora o desafio volta a "aprovado" e a próxima consulta tenta de novo;
//  - teto por conta: no máximo 3 pedidos pendentes de aparelhos diferentes e 12 por hora (o teto por IP não protegia a conta).
import crypto from 'node:crypto';
import { normalizeHandle } from '../activitypub/identity.ts';
import {
  MAX_STARTS_PER_ACCOUNT_PER_HOUR,
  planNewChallenge,
  verificationCodeMatches,
  type PendingChallengeLite,
} from './deviceLoginPolicy.ts';

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** Códigos errados tolerados antes de o pedido ser recusado: 6 dígitos não podem ser adivinhados por tentativa e erro. */
export const MAX_CODE_ATTEMPTS = 5;

export type DeviceLoginStatus = 'pending' | 'approved' | 'rejected' | 'consumed' | 'expired';

/** O que o aparelho que APROVA enxerga. Nunca leva o código nem o segredo. */
export interface DeviceLoginChallengePublic {
  challengeId: string;
  targetUid: string;
  targetUsername: string;
  federatedHandle: string;
  targetName: string;
  targetAvatarUrl: string;
  requesterDeviceId: string;
  requesterDeviceLabel: string;
  requesterIpHint: string;
  status: DeviceLoginStatus;
  createdAt: number;
  expiresAt: number;
}

export interface DeviceLoginChallengeDoc extends DeviceLoginChallengePublic {
  secretTokenHash: string;
  /** O código de 6 dígitos ("123 456"): só o aparelho que PEDIU o recebe (na resposta do `start`). */
  verificationCode: string;
  requesterIpHash: string;
  codeAttempts: number;
  approverDeviceId?: string;
  approverDeviceLabel?: string;
  respondedAt?: number;
  consumedAt?: number | null;
  /** Para a política de expiração (TTL) do Firestore, quando for ligada; o protocolo não depende dela. */
  expireAt?: Date;
}

// ───────────────────────── dependências ─────────────────────────

export type DocSnapLike = { exists: boolean; data(): Record<string, unknown> | undefined };
export type DocRefLike = {
  id: string;
  get(): Promise<DocSnapLike>;
  set(data: Record<string, unknown>): Promise<unknown>;
  update(patch: Record<string, unknown>): Promise<unknown>;
};
export type TxLike = { get(ref: DocRefLike): Promise<DocSnapLike>; update(ref: DocRefLike, patch: Record<string, unknown>): unknown };
export type QueryLike = {
  where(field: string, op: '==', value: unknown): QueryLike;
  limit(n: number): QueryLike;
  get(): Promise<{ docs: { id: string; data(): Record<string, unknown> }[] }>;
};
export interface DbLike {
  collection(name: string): { doc(id: string): DocRefLike } & QueryLike;
  runTransaction<T>(fn: (tx: TxLike) => Promise<T>): Promise<T>;
}

export type CredentialLike = { customToken?: string; emailLink?: string; email?: string };

export interface DeviceLoginDeps {
  db: DbLike;
  now(): number;
  /** Emite a credencial de login. Pode lançar (ex.: sem permissão no IAM). */
  mint(uid: string, claims: Record<string, unknown>): Promise<CredentialLike>;
  /** Espelha o pedido no Realtime Database (aviso instantâneo no aparelho conectado). `null` apaga. Nunca lança. */
  mirror(uid: string, payload: DeviceLoginChallengePublic | null, challengeId: string): Promise<void>;
  /** Handle local → conta, ou `null`. */
  resolveAccount(localHandle: string): Promise<{ uid: string; username: string; name: string; avatarUrl: string } | null>;
  /** `true` se ainda cabe uma chamada na janela. */
  takeRateLimit(key: string, max: number, windowMs: number): boolean;
  localDomains: ReadonlySet<string>;
  log?: (level: 'warn' | 'error', message: string, detail?: unknown) => void;
}

const COLLECTION = 'deviceLoginChallenges';

const sha256Hex = (value: string) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function generateVerificationCode(): string {
  const padded = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  return `${padded.slice(0, 3)} ${padded.slice(3, 6)}`;
}

export function maskIpHint(ip: string): string {
  if (!ip || ip === 'unknown') return 'Rede desconhecida';
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`;
  }
  if (ip.includes(':')) {
    const parts = ip.split(':').filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}:${parts[1]}::*`;
  }
  return 'IP verificado';
}

/**
 * Converte `@fulano@hiperverso.social`, `@fulano@hiperverso.app`, `@fulano` ou `fulano` para o handle local normalizado.
 * Rejeita domínios externos para orientar a pessoa.
 */
export function parseLocalAccountHandle(raw: string, localDomains: ReadonlySet<string>): { localHandle: string | null; error?: string } {
  const trimmed = raw.trim().replace(/^@+/, '');
  if (!trimmed) return { localHandle: null, error: 'Informe seu @ (ex: @fulano@hiperverso.social).' };
  const atIndex = trimmed.indexOf('@');
  if (atIndex !== -1) {
    const userPart = trimmed.slice(0, atIndex);
    const domainPart = trimmed.slice(atIndex + 1).toLowerCase();
    if (!localDomains.has(domainPart)) {
      return { localHandle: null, error: `O domínio @${domainPart} é externo. Para entrar com sua conta local, use @usuario@hiperverso.social ou @usuario@hiperverso.app.` };
    }
    const normalized = normalizeHandle(userPart);
    if (!normalized) return { localHandle: null, error: 'Formato de @ inválido. Use apenas letras, números e _.' };
    return { localHandle: normalized };
  }
  const normalized = normalizeHandle(trimmed);
  if (!normalized) return { localHandle: null, error: 'Formato de @ inválido. Use @fulano@hiperverso.social.' };
  return { localHandle: normalized };
}

/** Só o que o aparelho que APROVA pode ver: sem o código, sem o segredo, sem o resumo do IP. */
const publicOf = (d: DeviceLoginChallengeDoc): DeviceLoginChallengePublic => ({
  challengeId: d.challengeId,
  targetUid: d.targetUid,
  targetUsername: d.targetUsername,
  federatedHandle: d.federatedHandle,
  targetName: d.targetName,
  targetAvatarUrl: d.targetAvatarUrl,
  requesterDeviceId: d.requesterDeviceId,
  requesterDeviceLabel: d.requesterDeviceLabel,
  requesterIpHint: d.requesterIpHint,
  status: d.status,
  createdAt: d.createdAt,
  expiresAt: d.expiresAt,
});

// ───────────────────────── start ─────────────────────────

export type StartResult =
  | {
      ok: true;
      challengeId: string;
      secretToken: string;
      verificationCode: string;
      expiresAt: number;
      account: { username: string; federatedHandle: string; name: string; avatarUrl: string };
    }
  | { ok: false; error: string; status: number };

export async function startChallenge(
  deps: DeviceLoginDeps,
  input: { handle: string; requesterDeviceId: string; requesterDeviceLabel: string; requesterIp: string },
): Promise<StartResult> {
  const parsed = parseLocalAccountHandle(input.handle, deps.localDomains);
  if (!parsed.localHandle) return { ok: false, error: parsed.error || 'Handle inválido.', status: 400 };

  const account = await deps.resolveAccount(parsed.localHandle);
  if (!account) {
    return { ok: false, error: `Nenhuma conta encontrada para @${parsed.localHandle}@hiperverso.social.`, status: 404 };
  }
  const { uid, username, name, avatarUrl } = account;

  // Teto por CONTA: o teto por IP (na rota) não impede que muitos IPs, ou um só ao longo da hora, lotem os aparelhos de alguém.
  if (!deps.takeRateLimit(`device-login-acct:${uid}`, MAX_STARTS_PER_ACCOUNT_PER_HOUR, 3_600_000)) {
    return { ok: false, error: 'Muitos pedidos de login para esta conta. Aguarde um pouco ou use outro método de entrada.', status: 429 };
  }

  const now = deps.now();
  const deviceId = input.requesterDeviceId.slice(0, 64) || 'unknown';
  const ipHash = input.requesterIp ? sha256Hex(`ip:${input.requesterIp}`).slice(0, 16) : '';

  const pendingSnap = await deps.db.collection(COLLECTION).where('targetUid', '==', uid).where('status', '==', 'pending').limit(20).get();
  const pending: PendingChallengeLite[] = pendingSnap.docs.map((d) => {
    const data = d.data();
    return {
      challengeId: d.id,
      requesterDeviceId: String(data.requesterDeviceId ?? ''),
      requesterIpHash: String(data.requesterIpHash ?? ''),
      createdAt: Number(data.createdAt ?? 0),
      expiresAt: Number(data.expiresAt ?? 0),
    };
  });
  const plan = planNewChallenge(pending, { deviceId, ipHash }, now);
  if (!plan.allow) {
    return { ok: false, error: 'Já existem pedidos de login pendentes para esta conta. Aguarde alguns minutos ou use outro método de entrada.', status: 429 };
  }
  // O pedido novo do mesmo aparelho/origem SUBSTITUI o antigo: ninguém vê dois avisos nem se bloqueia ao tentar de novo.
  for (const id of plan.supersede) {
    await deps.db.collection(COLLECTION).doc(id).update({ status: 'expired' }).catch(() => undefined);
    await deps.mirror(uid, null, id);
  }

  const challengeId = `dlc_${crypto.randomUUID().replace(/-/g, '')}`;
  const secretToken = crypto.randomBytes(24).toString('base64url');
  const verificationCode = generateVerificationCode();
  const expiresAt = now + CHALLENGE_TTL_MS;
  const federatedHandle = `@${username.toLowerCase()}@hiperverso.social`;

  const doc: DeviceLoginChallengeDoc = {
    challengeId,
    targetUid: uid,
    targetUsername: username,
    federatedHandle,
    targetName: name,
    targetAvatarUrl: avatarUrl,
    requesterDeviceId: deviceId,
    requesterDeviceLabel: input.requesterDeviceLabel.slice(0, 80) || 'Navegador',
    requesterIpHint: maskIpHint(input.requesterIp),
    status: 'pending',
    createdAt: now,
    expiresAt,
    secretTokenHash: sha256Hex(secretToken),
    verificationCode,
    requesterIpHash: ipHash,
    codeAttempts: 0,
    expireAt: new Date(now + 24 * 3_600_000),
  };
  await deps.db.collection(COLLECTION).doc(challengeId).set({ ...doc });
  await deps.mirror(uid, publicOf(doc), challengeId);

  return { ok: true, challengeId, secretToken, verificationCode, expiresAt, account: { username, federatedHandle, name, avatarUrl } };
}

// ───────────────────────── poll ─────────────────────────

export type PollResult = {
  status: DeviceLoginStatus;
  customToken?: string;
  emailLink?: string;
  email?: string;
  uid?: string;
  /** `credential_unavailable`: aprovado, mas o servidor não conseguiu emitir a sessão AGORA (a próxima consulta tenta de novo). */
  error?: string;
};

export async function pollChallenge(deps: DeviceLoginDeps, input: { challengeId: string; secretToken: string }): Promise<PollResult> {
  if (!input.challengeId || !input.secretToken) return { status: 'expired', error: 'Parâmetros inválidos.' };

  const docRef = deps.db.collection(COLLECTION).doc(input.challengeId);
  const tokenHash = sha256Hex(input.secretToken);

  type Tx = { status: DeviceLoginStatus; uid?: string; error?: string; approverDeviceId?: string; consumedAt?: number };
  const txResult = await deps.db.runTransaction<Tx>(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) return { status: 'expired', error: 'Desafio não encontrado.' };
    const data = snap.data() as unknown as DeviceLoginChallengeDoc;
    if (!safeEqualHex(data.secretTokenHash || '', tokenHash)) return { status: 'rejected', error: 'Token do desafio inválido.' };

    const now = deps.now();
    if (data.status === 'pending' && now > data.expiresAt) {
      tx.update(docRef, { status: 'expired' });
      return { status: 'expired', uid: data.targetUid };
    }
    if (data.status === 'approved') {
      if (now > data.expiresAt) {
        tx.update(docRef, { status: 'expired' });
        return { status: 'expired', uid: data.targetUid };
      }
      tx.update(docRef, { status: 'consumed', consumedAt: now });
      return { status: 'approved', uid: data.targetUid, approverDeviceId: data.approverDeviceId || '', consumedAt: now };
    }
    return { status: data.status, uid: data.targetUid };
  });

  if (txResult.status === 'expired' && txResult.uid) {
    await deps.mirror(txResult.uid, null, input.challengeId);
    return { status: 'expired', error: 'Solicitação expirada. Tente novamente.' };
  }

  if (txResult.status === 'approved' && txResult.uid) {
    let credential: CredentialLike;
    try {
      credential = await deps.mint(txResult.uid, {
        authMethod: 'sovereign-device-key',
        approverDeviceId: txResult.approverDeviceId || 'connected-device',
      });
    } catch (err) {
      deps.log?.('error', '[deviceLogin] a aprovação não pôde virar sessão; o desafio volta a "aprovado" para nova tentativa', err instanceof Error ? err.message : String(err));
      // NÃO queima a aprovação: só devolve o desafio ao estado anterior se ninguém mexeu nele nesse meio tempo.
      await deps.db
        .runTransaction(async (tx) => {
          const snap = await tx.get(docRef);
          const d = snap.data() as { status?: string; consumedAt?: number | null } | undefined;
          if (snap.exists && d?.status === 'consumed' && d.consumedAt === txResult.consumedAt) tx.update(docRef, { status: 'approved', consumedAt: null });
        })
        .catch(() => undefined);
      return { status: 'pending', error: 'credential_unavailable' };
    }
    await deps.mirror(txResult.uid, null, input.challengeId);
    return { status: 'approved', ...credential, uid: txResult.uid };
  }

  return { status: txResult.status, ...(txResult.error ? { error: txResult.error } : {}) };
}

// ───────────────────────── respond ─────────────────────────

export type RespondResult = { ok: true; status: 'approved' | 'rejected' } | { ok: false; error: string; status: number };

export async function respondChallenge(
  deps: DeviceLoginDeps,
  input: {
    challengeId: string;
    uid: string;
    action: 'approve' | 'reject';
    /** O código que a pessoa DIGITOU, lido da tela do aparelho que pediu. Obrigatório para aprovar. */
    verificationCode?: unknown;
    approverDeviceId: string;
    approverDeviceLabel: string;
  },
): Promise<RespondResult> {
  const docRef = deps.db.collection(COLLECTION).doc(input.challengeId);

  type Tx = RespondResult;
  const txResult = await deps.db.runTransaction<Tx>(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) return { ok: false, error: 'Solicitação não encontrada.', status: 404 };
    const data = snap.data() as unknown as DeviceLoginChallengeDoc;
    if (data.targetUid !== input.uid) return { ok: false, error: 'Sem permissão para responder a este desafio.', status: 403 };
    if (data.status !== 'pending') return { ok: false, error: `Solicitação já está ${data.status}.`, status: 409 };
    if (deps.now() > data.expiresAt) {
      tx.update(docRef, { status: 'expired' });
      return { ok: false, error: 'Solicitação expirada.', status: 410 };
    }

    if (input.action === 'approve') {
      if (!verificationCodeMatches(data.verificationCode ?? '', input.verificationCode)) {
        const tentativas = (data.codeAttempts ?? 0) + 1;
        if (tentativas >= MAX_CODE_ATTEMPTS) {
          tx.update(docRef, { status: 'rejected', codeAttempts: tentativas, respondedAt: deps.now() });
          return { ok: false, error: 'Código errado várias vezes: a solicitação foi recusada por segurança.', status: 423 };
        }
        tx.update(docRef, { codeAttempts: tentativas });
        return { ok: false, error: 'O código não confere com o que aparece no outro aparelho. Confira e digite de novo.', status: 400 };
      }
    }

    const nextStatus: 'approved' | 'rejected' = input.action === 'approve' ? 'approved' : 'rejected';
    tx.update(docRef, {
      status: nextStatus,
      approverDeviceId: input.approverDeviceId.slice(0, 64),
      approverDeviceLabel: input.approverDeviceLabel.slice(0, 80),
      respondedAt: deps.now(),
    });
    return { ok: true, status: nextStatus };
  });

  // Sai da lista do aparelho que aprova quando já não há o que responder (respondido, vencido ou recusado por segurança).
  if (txResult.ok || txResult.status === 410 || txResult.status === 423) await deps.mirror(input.uid, null, input.challengeId);
  return txResult;
}

// ───────────────────────── pendentes (para o aparelho que aprova) ─────────────────────────

export async function listPending(deps: DeviceLoginDeps, uid: string): Promise<DeviceLoginChallengePublic[]> {
  const now = deps.now();
  const snap = await deps.db.collection(COLLECTION).where('targetUid', '==', uid).where('status', '==', 'pending').limit(10).get();
  const list: DeviceLoginChallengePublic[] = [];
  for (const doc of snap.docs) {
    const d = doc.data() as unknown as DeviceLoginChallengeDoc;
    if (d.expiresAt <= now) continue;
    list.push(publicOf(d));
  }
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

