// src/lib/server/federation.ts
// A ligação do servidor com a federação: monta, uma vez por instância, o armazenamento, a rede, as chaves e os
// limitadores, e oferece o que as rotas compartilham. A LÓGICA mora em src/lib/activitypub/ (testada sem Next); aqui
// só se conecta ao mundo real. Nunca importar em código do navegador.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { siteConfig } from '@/config/site';
import { adminAuth, adminFirestore } from '@/lib/server/firebaseAdmin';
import { safeFetchText } from '@/lib/security/safe-fetch';
import { takeRateLimit } from '@/lib/server/requestAuth';
import { createFetcher } from '@/lib/activitypub/fetcher';
import { createFirestoreStore } from '@/lib/activitypub/firestoreStore';
import { enableFederation } from '@/lib/activitypub/account';
import { signGetAsInstance } from '@/lib/activitypub/instanceActor';
import type { InstanceDeps } from '@/lib/activitypub/instanceActor';
import type { AccountRecord } from '@/lib/activitypub/store';
import { parseMasterKeyring } from '@/lib/activitypub/keys';
import type { MasterKeyring } from '@/lib/activitypub/keys';
import { MAX_BODY_BYTES, processInbox } from '@/lib/activitypub/inbox';
import { runWorker } from '@/lib/activitypub/worker';
import { WindowLimiter } from '@/lib/activitypub/rateLimit';
import type { InboxDeps } from '@/lib/activitypub/inbox';
import type { RenderDeps } from '@/lib/activitypub/render';
import type { WorkerDeps, WorkerLogEvent } from '@/lib/activitypub/worker';
import type { AccountDeps } from '@/lib/activitypub/account';
import type { AdminDeps } from '@/lib/activitypub/admin';
import type { ModerationDeps } from '@/lib/activitypub/moderation';

export const AP_JSON = 'application/activity+json; charset=utf-8';
const SOFTWARE_VERSION = '1.0.0';

export type FederationRuntime = {
  origin: string;
  ownHost: string;
  store: ReturnType<typeof createFirestoreStore>;
  render: RenderDeps;
  inbox: InboxDeps;
  /** Seguidores e bloqueios da pessoa. */
  moderation: ModerationDeps;
  /** Painel de quem administra a rede. */
  admin: AdminDeps;
  /** Só existe se a chave-mestra está configurada: rotas que não assinam funcionam sem ela. */
  account(): AccountDeps;
  /** O ator da instância (chave própria da casa): quem assina as buscas feitas sem ser em nome de uma pessoa. */
  instance(): InstanceDeps & { origin: string; now: () => number };
  /** Cabeçalhos de um GET assinado como instância, ou `null` se a chave-mestra não está configurada. */
  signGet(url: string): Promise<Record<string, string> | null>;
  worker(): WorkerDeps;
};

let runtime: FederationRuntime | null = null;

function keyring(): MasterKeyring {
  // Falta de segredo é erro de CONFIGURAÇÃO, não de quem chamou: 503, nunca um comportamento "padrão".
  return parseMasterKeyring(process.env.AP_MASTER_KEY);
}

export function federation(): FederationRuntime {
  if (runtime) return runtime;

  const origin = siteConfig.baseUrl.replace(/\/+$/, '');
  const ownHost = new URL(origin).hostname;
  const db = adminFirestore();
  const now = () => Date.now();
  const store = createFirestoreStore({ db, FieldValue, Timestamp, FieldPath, now });
  // As buscas (GET) que o servidor faz sem ser em nome de uma pessoa são assinadas com a chave do ator da INSTÂNCIA
  // (/ap/actor), e não com a de alguém: ver src/lib/activitypub/instanceActor.ts.
  const instance = () => ({ store, keyring: keyring(), origin, now });
  const signGet = async (url: string): Promise<Record<string, string> | null> => {
    try {
      return await signGetAsInstance(instance(), url);
    } catch {
      return null;
    }
  };
  const fetcher = createFetcher({
    now,
    userAgent: `ExeLula/${SOFTWARE_VERSION} (+${origin})`,
    signGet,
  });
  const randomId = () => randomBytes(12).toString('base64url');

  const render: RenderDeps = {
    store,
    origin,
    ownHost,
    mediaOrigin: `https://${siteConfig.mediaHost}`,
    softwareVersion: SOFTWARE_VERSION,
    mediaTypeOf: async (mediaId) => {
      const snap = await db.collection('media').doc(mediaId).get();
      const tipo = snap.data()?.contentType;
      return typeof tipo === 'string' && tipo ? tipo : null;
    },
  };

  const inbox: InboxDeps = {
    store, fetcher, now, ownHost, origin, randomId,
    // Tetos por instância do servidor (ver rateLimit.ts): um freio, não uma garantia global.
    domainLimiter: new WindowLimiter(240, 60_000),
    actorLimiter: new WindowLimiter(90, 60_000),
    flagLimiter: new WindowLimiter(5, 3_600_000),
  };

  runtime = {
    origin, ownHost, store, render, inbox,
    moderation: { store, now, ownHost, origin, randomId },
    admin: { store, now, ownHost },
    account: () => ({ store, keyring: keyring(), now, ownHost, randomId }),
    instance,
    signGet,
    worker: () => ({ ...render, store, keyring: keyring(), now, ownHost, randomId, fetcher, log: logWorkerEvent }),
  };
  return runtime;
}

/**
 * Uma linha de log JSON por evento do worker (entrega que falhou ou morreu, tarefa pulada pelo portão, mídia que ficou de fora).
 * No Cloud Logging o campo `severity` vira a severidade da entrada e `message` o texto, e o resto fica filtrável: é daqui que
 * saem os alertas (ex.: `jsonPayload.event="ap.delivery.dead"` ou `jsonPayload.failureClass="assinatura"`). Nada de corpo de
 * atividade, URL de inbox ou chave: só domínio, operação, status e contadores.
 */
function logWorkerEvent(evento: WorkerLogEvent): void {
  const { level, event, ...resto } = evento;
  const linha = JSON.stringify({ severity: level.toUpperCase(), message: event, event, ...resto });
  if (level === 'error') console.error(linha);
  else if (level === 'warn') console.warn(linha);
  else console.log(linha);
}

// ───────────────────────── requisição ─────────────────────────

/**
 * O host que o REMOTO assinou. Atrás do balanceador do App Hosting o `host` pode ser o interno; o original vem em
 * `x-forwarded-host`. A assinatura cobre o host, então ele entra na verificação exatamente como o remoto o usou.
 */
export function publicHost(request: Request): string {
  const reenviado = (
    request.headers.get('x-fh-requested-host')
    || request.headers.get('x-original-host')
    || request.headers.get('x-forwarded-host')
    || ''
  ).split(',')[0]?.trim();
  const raw = (reenviado || request.headers.get('host') || '').toLowerCase();
  if (!raw || raw.endsWith('.hosted.app') || raw.endsWith('.run.app')) {
    return new URL(siteConfig.baseUrl).hostname.toLowerCase();
  }
  return raw;
}

/**
 * Lê o corpo COM TETO, em fluxo. Não confia em `Content-Length` (pode faltar ou mentir) nem usa `arrayBuffer()` de
 * uma vez: um corpo chunked sem fim esgotaria a memória. Devolve `null` se passar do teto.
 */
export async function readBodyCapped(request: Request, max: number): Promise<Uint8Array | null> {
  const declarado = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declarado) && declarado > max) return null;
  if (!request.body) return new Uint8Array(0);
  const leitor = request.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await leitor.cancel();
      return null;
    }
    partes.push(value);
  }
  return Buffer.concat(partes);
}

/** Resposta JSON do protocolo. */
export function apResponse(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  if (body === null || body === undefined) return new Response(null, { status, headers: extra });
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': AP_JSON, 'Access-Control-Allow-Origin': '*', Vary: 'Accept', ...extra },
  });
}

/** Caixa de entrada (pessoal ou compartilhada). */
export async function handleInbox(request: Request, handle: string | null): Promise<Response> {
  const f = federation();
  const corpo = await readBodyCapped(request, MAX_BODY_BYTES);
  if (corpo === null) return new Response(null, { status: 413 });

  const url = new URL(request.url);
  const cabecalhos: Record<string, string> = {};
  request.headers.forEach((valor, nome) => { cabecalhos[nome.toLowerCase()] = valor; });
  cabecalhos.host = publicHost(request);

  const r = await processInbox(f.inbox, {
    handle,
    method: request.method,
    path: `${url.pathname}${url.search}`,
    headers: cabecalhos,
    body: corpo,
  });
  if (r.status === 202) {
    void runWorker(f.worker()).catch(() => {});
  }
  return new Response(null, { status: r.status, headers: r.headers });
}

// ───────────────────────── quem chama ─────────────────────────

export type Caller = { uid: string; emailVerified: boolean; member: boolean };

/** ID token do Firebase (cabeçalho Authorization). Cookie NÃO serve aqui: ações que mudam estado exigem o cabeçalho. */
export async function identify(request: Request): Promise<Caller | null> {
  const m = (request.headers.get('authorization') ?? '').match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  try {
    const t = await adminAuth().verifyIdToken(m[1]);
    return { uid: t.uid, emailVerified: t.email_verified === true, member: t.member === true };
  } catch {
    return null;
  }
}

/** Administrador da rede (`users/{uid}.isAdmin`), lido pelo servidor — nunca de um campo que o cliente escreva. */
export async function isAdmin(uid: string): Promise<boolean> {
  const snap = await adminFirestore().collection('users').doc(uid).get();
  return snap.data()?.isAdmin === true;
}

const igualEmTempoConstante = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Quem pode acionar o worker: o Cloud Scheduler, com um token OIDC emitido pelo Google para uma conta de serviço
 * NOSSA. Não há segredo guardado no job do Scheduler; o token é verificado no endpoint oficial de tokeninfo.
 *
 * Confere três coisas: que o Google reconhece o token, que a conta de serviço é a esperada e que o público (`aud`)
 * é o endereço desta rota. Qualquer uma faltando, recusa.
 *
 * `AP_WORKER_DEV_TOKEN` existe só para os testes locais e é IGNORADO em produção.
 */
export async function isScheduler(request: Request): Promise<boolean> {
  const m = (request.headers.get('authorization') ?? '').match(/^Bearer\s+(\S+)$/i);
  if (!m) return false;
  const token = m[1];

  const dev = process.env.AP_WORKER_DEV_TOKEN;
  if (dev && process.env.NODE_ENV !== 'production') return igualEmTempoConstante(token, dev);

  const esperado = process.env.AP_SCHEDULER_SA;
  if (!esperado) return false;
  try {
    const r = await safeFetchText(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`, {
      timeoutMs: 5000,
      maxBytes: 20_000,
      allowedContentTypes: /^application\/json/i,
    });
    if (!r.ok) return false;
    const info = JSON.parse(r.text) as { email?: string; email_verified?: string | boolean; aud?: string; exp?: string };
    const audiencia = `${federation().origin}/api/ap/worker`;
    return info.email === esperado
      && String(info.email_verified) === 'true'
      && info.aud === audiencia
      && Number(info.exp) * 1000 > Date.now();
  } catch {
    return false;
  }
}

// ───────────────────────── API de gestão (/api/ap/*) ─────────────────────────

/** Resposta JSON da API de gestão: nunca fica em cache (é estado da pessoa) e não declara CORS (só o próprio site chama). */
export function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

/** Falta de configuração é 503 (problema nosso), nunca um comportamento padrão. */
export function configError(): Response {
  return json(503, { error: 'federacao-nao-configurada' });
}

const TETO_CORPO_JSON = 4096;

/**
 * Corpo JSON pequeno e objeto. Devolve null se for grande demais, inválido ou não for um objeto. `maxBytes` só sobe para
 * quem tem motivo (um post de até 5000 caracteres com anexos não cabe em 4 KB e era recusado como "corpo-invalido").
 */
export async function readJsonObject(request: Request, maxBytes: number = TETO_CORPO_JSON): Promise<Record<string, unknown> | null> {
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return null;
  const bruto = await readBodyCapped(request, maxBytes);
  if (!bruto) return null;
  try {
    const v: unknown = JSON.parse(Buffer.from(bruto).toString('utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Exige pessoa autenticada pelo cabeçalho e aplica o limite de ritmo dela. Devolve a resposta de recusa ou a pessoa. */
export async function requireCaller(request: Request, chave: string, max: number): Promise<Caller | Response> {
  const quem = await identify(request);
  if (!quem) return json(401, { error: 'nao-autenticado' });
  if (!takeRateLimit(`ap-api:${chave}:${quem.uid}`, max, 60_000)) return json(429, { error: 'muitas-requisicoes' }, { 'Retry-After': '30' });
  return quem;
}

/** Exige administrador. */
export async function requireAdmin(request: Request, chave: string, max: number): Promise<Caller | Response> {
  const quem = await requireCaller(request, chave, max);
  if (quem instanceof Response) return quem;
  // 404 e não 403: quem não é administrador não precisa saber que o painel existe.
  if (!(await isAdmin(quem.uid))) return json(404, { error: 'nao-encontrado' });
  return quem;
}

/**
 * Garante que a conta local tenha sua identidade federada (@handle@exercitodolula.app) ativa sob demanda.
 * Se o usuário pausou manualmente, respeita a pausa; caso contrário, ativa automaticamente se apto.
 */
export async function ensureCallerFederationAccount(caller: Caller): Promise<AccountRecord | null> {
  const f = federation();
  const atual = await f.store.getAccount(caller.uid);
  if (atual?.enabled) return atual;

  let emailOk = caller.emailVerified;
  if (!emailOk) {
    try {
      const authUser = await adminAuth().getUser(caller.uid);
      // Contas criadas via OAuth federado (Fediverso/Bluesky) não têm e-mail, mas são membros verificados.
      emailOk = !authUser.email || authUser.emailVerified;
    } catch {
      emailOk = false;
    }
  }
  if (!emailOk) return atual;

  try {
    const res = await enableFederation(f.account(), caller.uid, { emailVerified: true });
    if (res.ok) return res.account;
  } catch {
    // ignora falha de keyring/configuração e devolve estado atual
  }
  return await f.store.getAccount(caller.uid);
}
