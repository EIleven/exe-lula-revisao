// src/lib/activitypub/inbox.ts
// Processamento de uma requisição à caixa de entrada (pessoal ou compartilhada). É a superfície pública mais exposta
// da federação: qualquer servidor da Internet pode mandar um POST para cá.
//
// A ORDEM É O DESENHO. Cada passo só roda depois dos mais baratos e sem rede, de modo que um pedido ruim custa o mínimo:
//
//   1. federação desligada?                 → 404, como se a rota não existisse
//   2. método, tamanho, tipo de conteúdo    → 405 / 413 / 415
//   3. caixa pessoal existe e está ativa?   → 404
//   4. ESTRUTURA da assinatura (sem rede)   → 401   (algoritmo, cabeçalhos assinados, Date ±5 min, Digest do corpo)
//   5. política da instância (sem rede)     → 202   (descarte silencioso: erro avisaria o remetente de que foi bloqueado)
//   6. limite por domínio                   → 429
//   7. buscar a chave e VERIFICAR           → 401   (com UMA renovação forçada, por causa de rotação de chave)
//   8. JSON e validação de estrutura        → 400 / 401 / 202
//   9. limite por ator, replay (id visto)   → 429 / 202
//  10. bloqueios da pessoa, então despachar → 202
//
// Respostas 202 para o que é DESCARTADO (bloqueio, replay, tipo que não tratamos) — só 4xx/5xx para o que o
// remetente precisa saber que falhou de verdade.
import { prepareVerification, verifyPrepared } from './signature.ts';
import type { HeaderBag } from './signature.ts';
import { decideInstance, isBlockedByUser } from './gate.ts';
import { pausaDeConsentimento } from './consentimentoDeDominio.ts';
import { activityUrl, domainOfUrl, isOwnUrl, parseLocalPath } from './identity.ts';
import { buildFollowResponse, isAddressedToPublic, parseInboundActivity } from './activity.ts';
import type { InboundActivity } from './activity.ts';
import { deliveryId } from './delivery.ts';
import { isOwnHostUrl, ownPostRef, remotePostIdOf, sameHost } from './remoteIdentity.ts';
import { ACTIVITY_ACCEPT, plainText, resolveRemoteActor } from './remote.ts';
import type { RemoteDeps } from './remote.ts';
import type { WindowLimiter } from './rateLimit.ts';
import type { DeliveryRecord, RemoteActorRecord } from './store.ts';

export const MAX_BODY_BYTES = 1_000_000;
export const SEEN_TTL_MS = 7 * 24 * 3600 * 1000;

export type InboxDeps = RemoteDeps & {
  origin: string;
  /** Limitador por domínio de origem e por ator. */
  domainLimiter: WindowLimiter;
  actorLimiter: WindowLimiter;
  flagLimiter: WindowLimiter;
  /** Gera o trecho opaco do id de uma atividade nossa. */
  randomId: () => string;
};

export type InboxRequest = {
  /** Caixa pessoal (`/ap/users/ana/inbox`) → 'ana'; compartilhada (`/ap/inbox`) → `null`. */
  handle: string | null;
  method: string;
  /** Caminho com a query, como na linha de requisição: entra na string assinada. */
  path: string;
  /** Nomes em minúsculas. `host` deve ser o host PÚBLICO (o da assinatura), não o interno do Cloud Run. */
  headers: HeaderBag;
  body: Uint8Array;
};

export type InboxResponse = { status: number; headers?: Record<string, string>; reason?: string };

const resp = (status: number, reason?: string, headers?: Record<string, string>): InboxResponse => ({ status, reason, headers });

const cabecalho = (h: HeaderBag, nome: string): string => {
  const v = h[nome];
  return (Array.isArray(v) ? v[0] : v) ?? '';
};

export async function processInbox(deps: InboxDeps, req: InboxRequest): Promise<InboxResponse> {
  const { store } = deps;
  const agora = deps.now();

  // Registra o desfecho sem nunca gravar corpo de atividade nem conteúdo de terceiro (docs §11).
  const registrar = async (resposta: InboxResponse, extra: { type?: string; domain?: string } = {}) => {
    // 4xx/5xx = recusada. 202 com motivo "aceita-*" = aceita. Qualquer outro 202 (duplicada, descartada, ignorada)
    // foi reconhecido e não gerou efeito.
    const decisao = resposta.status >= 400 ? 'recusada' : resposta.reason?.startsWith('aceita') ? 'aceita' : 'ignorada';
    try {
      await store.audit({ atMs: agora, kind: 'inbox', type: extra.type, domain: extra.domain, decision: decisao, reason: resposta.reason });
      await store.bump(decisao === 'recusada' ? `inbox.recusada.${resposta.reason ?? resposta.status}` : `inbox.${decisao}`);
    } catch {
      // Observabilidade nunca derruba o processamento.
    }
    return resposta;
  };

  // 1. Federação desligada: a rota não existe.
  const plataforma = await store.getPlatform();
  if (!plataforma.enabled || plataforma.killSwitch) return resp(404);

  // 2. Método, tamanho, tipo.
  if (req.method !== 'POST') return resp(405, undefined, { Allow: 'POST' });
  if (req.body.length > MAX_BODY_BYTES) return registrar(resp(413, 'corpo-grande-demais'));
  if (!/json/i.test(cabecalho(req.headers, 'content-type'))) return registrar(resp(415, 'tipo-de-conteudo'));

  // 3. Caixa pessoal.
  if (req.handle !== null) {
    const handle = await store.getHandle(req.handle);
    if (!handle || handle.state !== 'active') return resp(404);
    const conta = await store.getAccount(handle.uid);
    if (!conta?.enabled) return resp(404);
  }

  // 4. Estrutura da assinatura, sem rede.
  const preparado = prepareVerification({ method: req.method, path: req.path, headers: req.headers, body: req.body, now: agora });
  if (!preparado.ok) return registrar(resp(401, `assinatura-${preparado.reason}`));

  const keyId = preparado.parsed.keyId;
  const dominioDaChave = domainOfUrl(keyId);
  if (!dominioDaChave) return registrar(resp(401, 'assinatura-keyid'));

  // 5. Política da instância, antes de qualquer rede.
  const politica = await store.getInstancePolicy();
  const decisaoDaInstancia = decideInstance(dominioDaChave, politica, deps.ownHost);
  if (decisaoDaInstancia.decision === 'reject') {
    return registrar(resp(202, `descartada-${decisaoDaInstancia.reason}`), { domain: dominioDaChave });
  }

  // 6. Limite por domínio.
  const limiteDominio = deps.domainLimiter.take(`d:${dominioDaChave}`, agora);
  if (!limiteDominio.ok) {
    return registrar(resp(429, 'limite-dominio', { 'Retry-After': String(limiteDominio.retryAfterSeconds) }), { domain: dominioDaChave });
  }

  // 7. Chave e verificação.
  let resolvido = await resolveRemoteActor(deps, keyId);
  if (!resolvido.ok) {
    return registrar(resp(401, `chave-${resolvido.reason}`), { domain: dominioDaChave });
  }
  let ator: RemoteActorRecord = resolvido.actor;
  const verificar = (a: RemoteActorRecord) =>
    a.keyId === keyId ? verifyPrepared(preparado, a.publicKeyPem) : ({ ok: false, reason: 'chave' } as const);

  let verificacao = verificar(ator);
  if (!verificacao.ok) {
    // Pode ser rotação de chave. Uma renovação forçada (limitada a uma por cinco minutos por ator).
    resolvido = await resolveRemoteActor(deps, keyId, { forceRefresh: true });
    if (resolvido.ok && resolvido.actor.publicKeyPem !== ator.publicKeyPem) {
      ator = resolvido.actor;
      verificacao = verificar(ator);
    }
  }
  if (!verificacao.ok) return registrar(resp(401, `assinatura-${verificacao.reason}`), { domain: dominioDaChave });

  // 8. JSON e estrutura. A assinatura prova O ATOR; a atividade tem de ser dele.
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(req.body));
  } catch {
    return registrar(resp(400, 'json-invalido'), { domain: dominioDaChave });
  }
  const analisada = parseInboundActivity(json, { signerActor: ator.actorId, ownHost: deps.ownHost });
  if (!analisada.ok) {
    const r = analisada.reason;
    if (r === 'tipo-ignorado') return registrar(resp(202, 'ignorada-tipo'), { domain: dominioDaChave });
    if (r === 'autor-diferente-do-ator' || r === 'id-de-outro-host' || r === 'ator-local') {
      return registrar(resp(401, `falsificacao-${r}`), { domain: dominioDaChave });
    }
    return registrar(resp(400, r), { domain: dominioDaChave });
  }
  const atividade = analisada.activity;

  // 9. Limite por ator e replay.
  const limiteAtor = deps.actorLimiter.take(`a:${ator.actorId}`, agora);
  if (!limiteAtor.ok) {
    return registrar(resp(429, 'limite-ator', { 'Retry-After': String(limiteAtor.retryAfterSeconds) }), { domain: dominioDaChave, type: atividade.type });
  }
  const primeiraVez = await store.markSeen(atividade.id, SEEN_TTL_MS);
  if (!primeiraVez) return registrar(resp(202, 'duplicada'), { domain: dominioDaChave, type: atividade.type });

  // 10. Despachar.
  const resultado = await despachar(deps, atividade, ator, decisaoDaInstancia.decision === 'limit');
  return registrar(resultado, { domain: dominioDaChave, type: atividade.type });
}

// ───────────────────────── Despacho por tipo ─────────────────────────

/** Qual conta nossa a URL aponta (como ator)? Devolve o handle ou `null`. */
function handleLocalDe(deps: InboxDeps, url: string | null): string | null {
  if (!url || !isOwnUrl(url, deps.origin)) return null;
  const rota = parseLocalPath(new URL(url).pathname);
  return rota && rota.kind === 'actor' ? rota.handle : null;
}

/** Qual post local a URL aponta (nota AP, comentário AP ou página web do post)? */
function localPostIdDe(deps: InboxDeps, url: string | null): { postId: string; parentCommentId: string | null } | null {
  const ref = ownPostRef(url, deps.origin);
  return ref ? { postId: ref.postId, parentCommentId: ref.commentId } : null;
}

/** O handle local dono de um id de atividade nosso (`/ap/users/<handle>/activities/<id>`), ou `null`. */
function handleDoIdDeAtividade(deps: InboxDeps, id: string | null): string | null {
  if (!id || !isOwnUrl(id, deps.origin)) return null;
  const m = /^\/ap\/users\/([A-Za-z0-9_]{3,15})\/activities\//.exec(new URL(id).pathname);
  return m ? m[1].toLowerCase() : null;
}

async function despachar(deps: InboxDeps, a: InboxActivity, ator: RemoteActorRecord, silenciada: boolean): Promise<InboxResponse> {
  switch (a.type) {
    case 'Follow':
      return seguir(deps, a, ator);
    case 'Undo':
      return desfazer(deps, a, ator);
    case 'Block':
      return bloqueadoPor(deps, a, ator);
    case 'Delete':
      return apagar(deps, a, ator);
    case 'Flag':
      return denunciar(deps, a, ator);
    case 'Like':
      return curtir(deps, a, ator);
    case 'Announce':
      return impulsionar(deps, a, ator);
    case 'Create':
      return criar(deps, a, ator, silenciada);
    case 'Accept':
      return respostaDeFollow(deps, a, ator, true);
    case 'Reject':
      return respostaDeFollow(deps, a, ator, false);
    case 'Update':
      return atualizar(deps, a, ator);
    case 'Move':
      return mudouDeCasa(deps, a, ator);
    default:
      return resp(202, silenciada ? 'ignorada-instancia-silenciada' : 'ignorada-tipo');
  }
}

type InboxActivity = InboundActivity;

async function seguir(deps: InboxDeps, a: InboxActivity, ator: RemoteActorRecord): Promise<InboxResponse> {
  const { store } = deps;
  const handle = handleLocalDe(deps, a.objectId);
  if (!handle) return resp(202, 'ignorada-alvo-desconhecido');

  const reserva = await store.getHandle(handle);
  if (!reserva || reserva.state !== 'active') return resp(202, 'ignorada-alvo-inativo');
  const conta = await store.getAccount(reserva.uid);
  // Conta pausada não responde a ninguém: o Accept seria uma saída de dados que a pessoa pediu para parar.
  if (!conta?.enabled || conta.paused) return resp(202, 'ignorada-conta-inativa');

  const bloqueios = await store.listUserBlocks(reserva.uid);
  if (isBlockedByUser(bloqueios, ator.actorId, ator.domain)) return resp(202, 'descartada-bloqueio');

  const jaSegue = await store.getFollower(reserva.uid, ator.actorId);
  await store.putFollower({
    uid: reserva.uid,
    actorId: ator.actorId,
    inbox: ator.inbox,
    sharedInbox: ator.sharedInbox,
    domain: ator.domain,
    followActivity: a.raw,
    createdAtMs: jaSegue?.createdAtMs ?? deps.now(),
  });

  // O Accept. Idempotente pelo id do Follow respondido: o mesmo Follow nunca gera dois Accept.
  const destino = ator.sharedInbox ?? ator.inbox;
  const idAtividade = activityUrl(deps.origin, handle, `accept-${deps.randomId()}`);
  const corpo = JSON.stringify(buildFollowResponse('Accept', idAtividade, `${deps.origin.replace(/\/+$/, '')}/ap/users/${handle}`, a.raw));
  const registro: DeliveryRecord = {
    id: deliveryId({ uid: reserva.uid, op: 'accept', objectId: a.id, targetInbox: destino }),
    uid: reserva.uid,
    op: 'accept',
    objectId: a.id,
    activityId: idAtividade,
    targetInbox: destino,
    domain: ator.domain,
    body: corpo,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: deps.now(),
    lastDetail: null,
    lastOutcome: null,
    createdAtMs: deps.now(),
    sentAtMs: null,
  };
  await store.putDeliveryIfAbsent(registro);
  await store.bump('seguidores.novos');
  return resp(202, 'aceita-follow');
}

async function desfazer(deps: InboxDeps, a: InboxActivity, ator: RemoteActorRecord): Promise<InboxResponse> {
  const { store } = deps;
  const tipoInterno = a.objectType;
  const embutido = typeof a.object === 'object' && a.object !== null ? (a.object as Record<string, unknown>) : null;

  // Undo de Follow embutido: o alvo vem dentro dele.
  if (embutido && tipoInterno === 'Follow') {
    const alvo = typeof embutido.object === 'string' ? embutido.object : null;
    const handle = handleLocalDe(deps, alvo);
    if (!handle) return resp(202, 'ignorada-alvo-desconhecido');
    const reserva = await store.getHandle(handle);
    if (!reserva) return resp(202, 'ignorada-alvo-desconhecido');
    const removido = await store.deleteFollower(reserva.uid, ator.actorId);
    return resp(202, removido ? 'aceita-unfollow' : 'ignorada-nao-seguia');
  }

  // Undo por id: procura, entre os vínculos deste ator, o Follow com esse id.
  if (typeof a.object === 'string') {
    const vinculos = await store.findFollowersByActor(ator.actorId);
    let removidos = 0;
    for (const v of vinculos) {
      if ((v.followActivity as { id?: unknown }).id === a.object) {
        if (await store.deleteFollower(v.uid, ator.actorId)) removidos++;
      }
    }
    return resp(202, removidos > 0 ? 'aceita-unfollow' : 'ignorada-desfazer');
  }

  // Undo de Like / Announce embutidos.
  if (embutido && (tipoInterno === 'Like' || tipoInterno === 'Announce')) {
    const alvoUrl = typeof embutido.object === 'string' ? embutido.object : null;
    const alvo = localPostIdDe(deps, alvoUrl);
    if (!alvo) return resp(202, 'ignorada-alvo-desconhecido');
    if (tipoInterno === 'Like') {
      const ok = alvo.parentCommentId
        ? await store.removeRemoteCommentLike?.(alvo.postId, alvo.parentCommentId, ator.actorId)
        : await store.removeRemoteLike?.(alvo.postId, ator.actorId);
      return resp(202, ok ? 'aceita-unlike' : 'ignorada-desfazer');
    }
    const ok = alvo.parentCommentId
      ? await store.removeRemoteCommentBoost?.(alvo.postId, alvo.parentCommentId, ator.actorId)
      : await store.removeRemoteBoost?.(alvo.postId, ator.actorId);
    return resp(202, ok ? 'aceita-unannounce' : 'ignorada-desfazer');
  }

  // Undo de Block: não tratamos o que foi desfeito.
  return resp(202, 'ignorada-tipo');
}

/**
 * `Move`: a conta remota avisa que se mudou para outro endereço.
 *
 * Registramos para onde foi — e **não** arrastamos quem a seguia. Mover seguidores sem pedir seria decidir pela pessoa daqui
 * a quem ela passa a seguir, e é exatamente o passo que vira sequestro de audiência se o `Move` for forjado (a prova de que o
 * destino aceita a mudança mora no `alsoKnownAs` do destino, que nem todo servidor publica e que não dá para conferir aqui sem
 * sair buscando). Com o destino registrado, a pessoa decide seguir a conta nova quando quiser.
 *
 * Só o PRÓPRIO ator pode anunciar a própria mudança, e o destino tem de ser outro endereço (nunca um daqui).
 */
async function mudouDeCasa(deps: InboxDeps, a: InboxActivity, ator: RemoteActorRecord): Promise<InboxResponse> {
  const bruto = a.raw as { target?: unknown; object?: unknown };
  const destino = typeof bruto.target === 'string' ? bruto.target : null;
  const quem = typeof bruto.object === 'string' ? bruto.object : ator.actorId;
  if (quem !== ator.actorId) return resp(202, 'ignorada-ator-diferente');
  if (!destino || !destino.startsWith('https://') || destino === ator.actorId) return resp(202, 'ignorada-sem-destino');
  // Mudança para um endereço NOSSO não existe: ninguém de fora decide que uma conta daqui é a continuação dela.
  if (isOwnHostUrl(destino, deps.ownHost)) return resp(202, 'ignorada-destino-proprio');
  if (ator.movedTo === destino) return resp(202, 'ignorada-duplicado');
  await deps.store.putRemoteActor({ ...ator, movedTo: destino, fetchedAtMs: deps.now() });
  return resp(202, 'aceita-mudanca');
}

async function bloqueadoPor(deps: InboxDeps, a: InboxActivity, ator: RemoteActorRecord): Promise<InboxResponse> {
  const { store } = deps;
  const handle = handleLocalDe(deps, a.objectId);
  if (!handle) return resp(202, 'ignorada-alvo-desconhecido');
  const reserva = await store.getHandle(handle);
  if (!reserva) return resp(202, 'ignorada-alvo-desconhecido');
  // Quem nos bloqueou não quer receber o que publicamos: deixa de ser seguidor, e nada mais é entregue a ele.
  await store.deleteFollower(reserva.uid, ator.actorId);
  // E não queremos continuar seguindo quem nos bloqueou: o vínculo cai dos dois lados, não só do lado dele.
  await store.rejectOutboundFollow?.(reserva.uid, ator.actorId);

  // Sobrou algum vínculo com esta pessoa? Se NÃO sobrou, o que guardamos dela não tem mais por que ficar no ar:
  // o conteúdo só estava aqui por causa de um laço que ela acabou de cortar. Vira túmulo, como no `Delete`.
  //
  // A condição existe por um motivo: um `Block` é de UMA pessoa contra UMA pessoa. Se outra conta daqui segue este
  // ator — e ele não bloqueou essa outra conta —, apagar tudo puniria quem não tem nada a ver, e seria mais do que
  // ele pediu. Some o espelho quando o último laço acaba, não antes.
  const aindaHaVinculo = (await store.hasLocalLinkToActor?.(ator.actorId)) ?? true;
  if (!aindaHaVinculo) {
    const apagados = await store.removeRemoteActorContent?.(ator.actorId);
    return resp(202, `aceita-bloqueio-conteudo-retirado:${apagados ?? 0}`);
  }
  return resp(202, 'aceita-bloqueio');
}

async function apagar(deps: InboxDeps, a: InboxActivity, ator: RemoteActorRecord): Promise<InboxResponse> {
  const { store } = deps;
  // `Delete` do próprio ator = conta removida no servidor de origem. Limpa tudo que o liga a nós.
  if (a.objectId === ator.actorId) {
    const vinculos = await store.findFollowersByActor(ator.actorId);
    for (const v of vinculos) await store.deleteFollower(v.uid, ator.actorId);
    await store.putRemoteActor({ ...ator, state: 'gone', fetchedAtMs: deps.now() });
    // O que guardamos dele não fica no ar depois que ele mesmo apagou a conta (e o pedido de apagar vale também aqui).
    await store.removeRemoteActorContent?.(ator.actorId);
    return resp(202, 'aceita-ator-removido');
  }
  // Apagar um comentário ou um post remoto que guardamos. Só vale se o ator for o mesmo que o criou.
  if (a.objectId) {
    const removido = await store.removeRemoteComment?.(a.objectId, ator.actorId);
    if (removido) return resp(202, 'aceita-comentario-removido');
    const post = await store.removeRemotePost?.(a.objectId, ator.actorId);
    if (post) return resp(202, 'aceita-post-removido');
  }
  return resp(202, 'ignorada-sem-conteudo-local');
}

/**
 * O alvo de um Like/Announce é um COMENTÁRIO nosso. Devolve a resposta de descarte (comentário que não existe, apagado, de
 * quem bloqueou o ator, ou que nem é nosso) ou `null` se pode seguir. O portão é o do comentário: quem é protegido é o autor
 * dele, que pode não ser o dono do post.
 */
async function descartarSeComentarioInvalido(
  deps: InboxDeps,
  alvo: { postId: string; parentCommentId: string | null },
  ator: RemoteActorRecord,
): Promise<InboxResponse | null> {
  const { store } = deps;
  const objeto = await store.getObject(alvo.postId);
  if (!objeto || objeto.state !== 'federated') return resp(202, 'ignorada-alvo-inativo');
  const comentario = await store.getComment?.(alvo.postId, alvo.parentCommentId as string);
  if (!comentario || comentario.isDeleted || comentario.isRemoteFediverse) return resp(202, 'ignorada-alvo-inativo');
  for (const dono of new Set([objeto.uid, comentario.userId])) {
    const bloqueios = await store.listUserBlocks(dono);
    if (isBlockedByUser(bloqueios, ator.actorId, ator.domain)) return resp(202, 'descartada-bloqueio');
  }
  return null;
}

async function curtir(deps: InboxDeps, a: InboxActivity, ator: RemoteActorRecord): Promise<InboxResponse> {
  const { store } = deps;
  const alvo = localPostIdDe(deps, a.objectId);
  if (!alvo) return resp(202, 'ignorada-alvo-desconhecido');
  if (alvo.parentCommentId) {
    // Curtir o COMENTÁRIO curte o comentário (antes contava como curtida do post e notificava a pessoa errada).
    const descarte = await descartarSeComentarioInvalido(deps, alvo, ator);
    if (descarte) return descarte;
    const r = await store.recordRemoteCommentLike?.(alvo.postId, alvo.parentCommentId, ator, a.id);
    if (r === 'added') {
      await store.bump('interacoes.likes');
      return resp(202, 'aceita-like-comentario');
    }
    return resp(202, r === 'duplicate' ? 'ignorada-duplicado' : 'ignorada-alvo-inativo');
  }
  const objeto = await store.getObject(alvo.postId);
  if (!objeto || objeto.state !== 'federated') return resp(202, 'ignorada-alvo-inativo');
  const bloqueios = await store.listUserBlocks(objeto.uid);
  if (isBlockedByUser(bloqueios, ator.actorId, ator.domain)) return resp(202, 'descartada-bloqueio');

  const res = await store.recordRemoteLike?.(alvo.postId, ator, a.id);
  if (res === 'added') {
    await store.bump('interacoes.likes');
    return resp(202, 'aceita-like');
  }
  return resp(202, res === 'duplicate' ? 'ignorada-duplicado' : 'ignorada-alvo-inativo');
}

function extractCustomEmojis(obj: Record<string, unknown>): Record<string, string> {
  const customEmojis: Record<string, string> = {};
  if (Array.isArray(obj.tag)) {
    for (const item of obj.tag) {
      if (Object.keys(customEmojis).length >= 30) break;
      if (!item || typeof item !== 'object') continue;
      const rec = item as { type?: unknown; name?: unknown; icon?: { url?: unknown } };
      if (rec.type === 'Emoji' && typeof rec.name === 'string' && /^:[a-zA-Z0-9_]+:$/.test(rec.name)) {
        const iconUrl = typeof rec.icon?.url === 'string' ? rec.icon.url : '';
        if (iconUrl.startsWith('https://')) customEmojis[rec.name] = iconUrl;
      }
    }
  }
  return customEmojis;
}

/**
 * O aviso de conteúdo que o autor escreveu (`summary` do Note; "CW" no Mastodon), em texto puro e curto. `null` quando
 * não há. É o texto que a pessoa daqui lê ANTES de decidir abrir o conteúdo.
 */
export function extractContentWarning(obj: Record<string, unknown>): string | null {
  if (typeof obj.summary !== 'string') return null;
  const limpo = obj.summary
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return limpo ? limpo.slice(0, 200) : null;
}

/**
 * O conteúdo remoto é sensível quando o autor marcou `sensitive` OU escreveu um aviso (`summary`).
 *
 * **Vale mesmo SEM mídia.** Antes a regra exigia anexo, e um texto com aviso (relato de violência, spoiler, gatilho)
 * chegava aqui aberto: o autor pediu que se avisasse e nós mostrávamos direto. O aviso é do AUTOR sobre o conteúdo,
 * não sobre o anexo.
 */
export function extractSensitiveFlag(obj: Record<string, unknown>): boolean {
  return obj.sensitive === true || extractContentWarning(obj) !== null;
}

/**
 * O idioma que a origem declarou: `contentMap` (a chave é a etiqueta) ou o campo `language` do Mastodon. `null` quando
 * ninguém declarou — e aí não se inventa: a vitrine para visitante prefere não mostrar a chutar.
 */
export function extractLanguage(obj: Record<string, unknown>): string | null {
  const mapa = obj.contentMap;
  if (mapa && typeof mapa === 'object' && !Array.isArray(mapa)) {
    const chaves = Object.keys(mapa as Record<string, unknown>);
    if (chaves.length > 0 && typeof chaves[0] === 'string' && chaves[0].trim()) return chaves[0].trim().slice(0, 16);
  }
  if (typeof obj.language === 'string' && obj.language.trim()) return obj.language.trim().slice(0, 16);
  return null;
}

export function extractAttachments(obj: Record<string, unknown>): { url: string; type: 'image' | 'video'; alt?: string | null }[] {
  if (!Array.isArray(obj.attachment)) return [];
  const out: { url: string; type: 'image' | 'video'; alt?: string | null }[] = [];
  for (const att of obj.attachment.slice(0, 4)) {
    if (!att || typeof att !== 'object') continue;
    const rec = att as { type?: unknown; mediaType?: unknown; url?: unknown; name?: unknown };
    const url = typeof rec.url === 'string' ? rec.url : '';
    if (!url.startsWith('https://')) continue;
    const mt = typeof rec.mediaType === 'string' ? rec.mediaType.toLowerCase() : '';
    const isVideo = mt.startsWith('video/') || rec.type === 'Video';
    const isImage = mt.startsWith('image/') || rec.type === 'Image' || rec.type === 'Document';
    if (!isVideo && !isImage) continue;
    out.push({
      url,
      type: isVideo ? 'video' : 'image',
      alt: typeof rec.name === 'string' ? rec.name.slice(0, 500) : null,
    });
  }
  return out;
}

async function impulsionar(deps: InboxDeps, a: InboxActivity, ator: RemoteActorRecord): Promise<InboxResponse> {
  const { store } = deps;
  const alvo = localPostIdDe(deps, a.objectId);
  if (alvo?.parentCommentId) {
    const descarte = await descartarSeComentarioInvalido(deps, alvo, ator);
    if (descarte) return descarte;
    const r = await store.recordRemoteCommentBoost?.(alvo.postId, alvo.parentCommentId, ator, a.id);
    if (r === 'added') {
      await store.bump('interacoes.boosts');
      return resp(202, 'aceita-announce-comentario');
    }
    return resp(202, r === 'duplicate' ? 'ignorada-duplicado' : 'ignorada-alvo-inativo');
  }
  if (alvo) {
    const objeto = await store.getObject(alvo.postId);
    if (!objeto || objeto.state !== 'federated') return resp(202, 'ignorada-alvo-inativo');
    const bloqueios = await store.listUserBlocks(objeto.uid);
    if (isBlockedByUser(bloqueios, ator.actorId, ator.domain)) return resp(202, 'descartada-bloqueio');

    const res = await store.recordRemoteBoost?.(alvo.postId, ator, a.id);
    if (res === 'added') {
      await store.bump('interacoes.boosts');
      return resp(202, 'aceita-announce');
    }
    return resp(202, res === 'duplicate' ? 'ignorada-duplicado' : 'ignorada-alvo-inativo');
  }

  // Announce (repost/boost) de um post remoto feito por alguém que um usuário local segue:
  // traz o post para o feed Seguindo como "Repostado por @fulano@...".
  if (!a.objectId || !a.objectId.startsWith('https://') || !store.ingestRemoteAnnounce || !store.hasRemoteFollowers) {
    return resp(202, 'ignorada-alvo-desconhecido');
  }
  if (!(await store.hasRemoteFollowers(ator.actorId))) {
    return resp(202, 'ignorada-sem-alvo');
  }

  const boostCreatedAtMs = typeof (a.raw as { published?: unknown }).published === 'string'
    && Number.isFinite(Date.parse((a.raw as { published: string }).published))
    ? Date.parse((a.raw as { published: string }).published)
    : deps.now();

  // A politica da instancia vale ANTES de qualquer caminho rapido: se o dominio de origem foi recusado, nem um post que ja
  // estava guardado volta ao feed por impulso de terceiro. Antes, bloquear um dominio nao impedia que boosts ressuscitassem
  // o que ele ja tinha publicado aqui.
  const objDomain = domainOfUrl(a.objectId);
  const policy = await store.getInstancePolicy();
  if (!objDomain || decideInstance(objDomain, policy, deps.ownHost).decision === 'reject') {
    return resp(202, 'ignorada-alvo-desconhecido');
  }
  const objHealth = await store.getDomainHealth?.(objDomain).catch(() => null);
  if (pausaDeConsentimento(objHealth, deps.now()).pausado) {
    return resp(202, 'ignorada-dominio-pausado');
  }

  const remotePostId = remotePostIdOf(a.objectId);
  const alreadyExists = await store.hasPost?.(remotePostId);
  if (alreadyExists) {
    const res = await store.ingestRemoteAnnounce({
      booster: ator,
      activityId: a.id,
      apObjectId: a.objectId,
      boostCreatedAtMs,
    });
    if (res === 'added') {
      await store.bump('interacoes.boosts');
      return resp(202, 'aceita-announce-remoto');
    }
    return resp(202, res === 'duplicate' ? 'ignorada-duplicado' : 'ignorada-sem-alvo');
  }


  try {
    const r = await deps.fetcher.get(a.objectId, { accept: ACTIVITY_ACCEPT });
    if (!r || r.status < 200 || r.status >= 300 || !r.json || typeof r.json !== 'object' || Array.isArray(r.json)) {
      return resp(202, 'ignorada-alvo-desconhecido');
    }
    const fetchedObj = r.json as Record<string, unknown>;
    if (fetchedObj.type !== 'Note' && fetchedObj.type !== 'Article') {
      return resp(202, 'ignorada-tipo');
    }
    // O objeto buscado tem de SER o que pedimos: um servidor que responde com o id de OUTRO objeto nos faria guardar, com o
    // id local do que pedimos, um post que não é aquele (e que ele escolheu).
    if (fetchedObj.id !== a.objectId && fetchedObj.id !== r.finalUrl) return resp(202, 'ignorada-objeto-divergente');
    const to = Array.isArray(fetchedObj.to) ? fetchedObj.to : [];
    const cc = Array.isArray(fetchedObj.cc) ? fetchedObj.cc : [];
    const isPub = [...to, ...cc].includes('https://www.w3.org/ns/activitystreams#Public');
    if (!isPub) return resp(202, 'ignorada-nao-publico');

    const texto = plainText(fetchedObj.content, 5000);
    if (!texto) return resp(202, 'ignorada-sem-conteudo');

    const attrRaw = Array.isArray(fetchedObj.attributedTo) ? fetchedObj.attributedTo[0] : fetchedObj.attributedTo;
    const attrId = typeof attrRaw === 'string'
      ? attrRaw
      : (attrRaw && typeof attrRaw === 'object' && typeof (attrRaw as { id?: unknown }).id === 'string' ? (attrRaw as { id: string }).id : null);
    if (!attrId || !attrId.startsWith('https://')) return resp(202, 'ignorada-alvo-desconhecido');
    // Autoria: o post só é de quem diz tê-lo escrito se morar no servidor dessa pessoa. Sem isto, `evil.com` serve um Note com
    // `attributedTo` de outra pessoa e um Announce o traz para o feed de quem segue o impulsionador, com o nome dela.
    if (!sameHost(a.objectId, attrId)) return resp(202, 'ignorada-autoria-de-outro-host');

    const resolvedAuthor = await resolveRemoteActor(deps, attrId);
    if (!resolvedAuthor.ok) return resp(202, 'ignorada-alvo-desconhecido');

    const postCreatedAtMs = typeof fetchedObj.published === 'string' && Number.isFinite(Date.parse(fetchedObj.published))
      ? Date.parse(fetchedObj.published)
      : boostCreatedAtMs;
    const url = typeof fetchedObj.url === 'string' && fetchedObj.url.startsWith('https://') ? fetchedObj.url : a.objectId;
    const customEmojis = extractCustomEmojis(fetchedObj);
    const media = extractAttachments(fetchedObj);
    const sensitive = extractSensitiveFlag(fetchedObj);
    const contentWarning = extractContentWarning(fetchedObj);
    const language = extractLanguage(fetchedObj);

    const res = await store.ingestRemoteAnnounce({
      booster: ator,
      activityId: a.id,
      apObjectId: typeof fetchedObj.id === 'string' ? fetchedObj.id : a.objectId,
      boostCreatedAtMs,
      author: resolvedAuthor.actor,
      text: texto,
      url,
      postCreatedAtMs,
      media,
      sensitive,
      contentWarning,
      language,
      ...(Object.keys(customEmojis).length > 0 ? { customEmojis } : {}),
    });
    if (res === 'added') {
      await store.bump('interacoes.boosts');
      return resp(202, 'aceita-announce-remoto');
    }
    return resp(202, res === 'duplicate' ? 'ignorada-duplicado' : 'ignorada-sem-alvo');
  } catch {
    return resp(202, 'ignorada-alvo-desconhecido');
  }
}

async function criar(deps: InboxDeps, a: InboxActivity, ator: RemoteActorRecord, silenciada: boolean): Promise<InboxResponse> {
  if (silenciada) return resp(202, 'ignorada-instancia-silenciada');
  if (a.objectType !== 'Note' && a.objectType !== 'Article') return resp(202, 'ignorada-tipo');
  const obj = typeof a.object === 'object' && a.object !== null ? (a.object as Record<string, unknown>) : null;
  if (!obj || !a.objectId) return resp(202, 'ignorada-sem-conteudo');
  // (Que o id do objeto mora no host do ator, e que o autor declarado é ele, já foi exigido por parseInboundActivity.)

  const rawReplyTo = Array.isArray(obj.inReplyTo) ? obj.inReplyTo[0] : obj.inReplyTo;
  const replyTo = typeof rawReplyTo === 'string'
    ? rawReplyTo
    : (rawReplyTo && typeof rawReplyTo === 'object' && typeof (rawReplyTo as { id?: unknown }).id === 'string')
      ? (rawReplyTo as { id: string }).id
      : null;
  const alvoPostLocal = replyTo ? localPostIdDe(deps, replyTo) : null;

  // Mensagem direta (DM) privada do Fediverso: não endereçada a as:Public e direcionada a um ator local
  if (!isAddressedToPublic(a) && !alvoPostLocal) {
    const recipients = [...a.to, ...a.cc];
    const localHandles = Array.from(
      new Set(recipients.map((u) => handleLocalDe(deps, u)).filter((h): h is string => Boolean(h))),
    );
    if (localHandles.length === 0) return resp(202, 'ignorada-nao-publico');

    const textoDm = plainText(obj.content, 5000);
    if (!textoDm) return resp(202, 'ignorada-sem-conteudo');
    const publishedMs = typeof obj.published === 'string' && Number.isFinite(Date.parse(obj.published))
      ? Date.parse(obj.published)
      : deps.now();

    let addedCount = 0;
    let dupCount = 0;
    for (const handle of localHandles) {
      const reserva = await deps.store.getHandle(handle);
      if (!reserva || reserva.state !== 'active') continue;
      const conta = await deps.store.getAccount(reserva.uid);
      if (!conta?.enabled || conta.paused) continue;
      const bloqueios = await deps.store.listUserBlocks(reserva.uid);
      if (isBlockedByUser(bloqueios, ator.actorId, ator.domain)) continue;

      const dmRes = await deps.store.ingestRemoteDm?.({
        targetUid: reserva.uid,
        actor: ator,
        apObjectId: a.objectId,
        text: textoDm,
        createdAtMs: publishedMs,
      });
      if (dmRes === 'added') addedCount++;
      else if (dmRes === 'duplicate') dupCount++;
    }
    if (addedCount > 0) return resp(202, 'aceita-dm');
    if (dupCount > 0) return resp(202, 'ignorada-duplicado');
    return resp(202, 'ignorada-nao-publico');
  }

  if (!replyTo) {
    if (!isAddressedToPublic(a)) return resp(202, 'ignorada-nao-publico');
    const textoPost = plainText(obj.content, 5000);
    if (!textoPost) return resp(202, 'ignorada-sem-conteudo');
    const publishedMs = typeof obj.published === 'string' && Number.isFinite(Date.parse(obj.published))
      ? Date.parse(obj.published)
      : deps.now();
    const url = typeof obj.url === 'string' && obj.url.startsWith('https://') ? obj.url : a.objectId;
    const customEmojis = extractCustomEmojis(obj);
    const media = extractAttachments(obj);
    const sensitive = extractSensitiveFlag(obj);
    const contentWarning = extractContentWarning(obj);
    const language = extractLanguage(obj);
    const rawQuote = obj.quoteUrl ?? obj.quoteUri ?? obj._misskey_quote;
    const quoteUrl = typeof rawQuote === 'string' && rawQuote.startsWith('https://') ? rawQuote : null;
    const ing = await deps.store.ingestRemotePost?.({
      actor: ator,
      apObjectId: a.objectId,
      text: textoPost,
      url,
      createdAtMs: publishedMs,
      media,
      sensitive,
      contentWarning,
      language,
      quoteUrl,
      ...(Object.keys(customEmojis).length > 0 ? { customEmojis } : {}),
    });
    if (ing === 'added') {
      await deps.store.bump('interacoes.posts_remotos');
      return resp(202, 'aceita-post-remoto');
    }
    return resp(202, ing === 'duplicate' ? 'ignorada-duplicado' : 'ignorada-sem-alvo');
  }
  const alvo = localPostIdDe(deps, replyTo);
  const { store } = deps;
  let targetPostId: string | null = alvo?.postId ?? null;
  let targetParentCommentId: string | null = alvo?.parentCommentId ?? null;

  if (alvo) {
    const objeto = await store.getObject(alvo.postId);
    if (!objeto || objeto.state !== 'federated') return resp(202, 'ignorada-alvo-inativo');
    const bloqueios = await store.listUserBlocks(objeto.uid);
    if (isBlockedByUser(bloqueios, ator.actorId, ator.domain)) return resp(202, 'descartada-bloqueio');
  } else if (replyTo.startsWith('https://') && store.hasPost) {
    const remotePostId = remotePostIdOf(replyTo);
    if (await store.hasPost(remotePostId)) {
      targetPostId = remotePostId;
      targetParentCommentId = null;
    }
  }

  if (!targetPostId) return resp(202, 'ignorada-alvo-desconhecido');

  const texto = plainText(obj.content, 2000);
  if (!texto) return resp(202, 'ignorada-sem-conteudo');
  const publishedMs = typeof obj.published === 'string' && Number.isFinite(Date.parse(obj.published))
    ? Date.parse(obj.published)
    : deps.now();

  const replyMedia = extractAttachments(obj);
  const replySensitive = extractSensitiveFlag(obj);
  const replyContentWarning = extractContentWarning(obj);

  const res = await store.recordRemoteComment?.({
    postId: targetPostId,
    apObjectId: a.objectId,
    actor: ator,
    text: texto,
    createdAtMs: publishedMs,
    parentCommentId: targetParentCommentId,
    media: replyMedia,
    sensitive: replySensitive,
    contentWarning: replyContentWarning,
  });
  if (res === 'added') {
    await store.bump('interacoes.respostas');
    return resp(202, 'aceita-reply');
  }
  return resp(202, res === 'duplicate' ? 'ignorada-duplicado' : 'ignorada-alvo-inativo');
}

/**
 * `Accept`/`Reject` do NOSSO Follow. O servidor remoto responde ao pedido de uma pessoa daqui para seguir alguém de lá: o
 * "Seguindo" que gravamos por antecipação vira definitivo (Accept) ou é desfeito (Reject, e é o que acontece com conta
 * trancada que não aceita). Quem responde é o ator seguido, e ele tem de ser o que a pessoa pediu para seguir.
 */
async function respostaDeFollow(deps: InboxDeps, a: InboxActivity, ator: RemoteActorRecord, aceito: boolean): Promise<InboxResponse> {
  const { store } = deps;
  const embutido = typeof a.object === 'object' && a.object !== null ? (a.object as Record<string, unknown>) : null;
  if (embutido && embutido.type !== 'Follow') return resp(202, 'ignorada-tipo');
  const quem = embutido && typeof embutido.actor === 'string' ? embutido.actor : null;
  const idDoFollow = embutido ? (typeof embutido.id === 'string' ? embutido.id : null) : typeof a.object === 'string' ? a.object : null;
  const handle = handleLocalDe(deps, quem) ?? handleDoIdDeAtividade(deps, idDoFollow);
  if (!handle) return resp(202, 'ignorada-alvo-desconhecido');
  const reserva = await store.getHandle(handle);
  if (!reserva) return resp(202, 'ignorada-alvo-desconhecido');
  const ok = aceito
    ? await store.acceptOutboundFollow?.(reserva.uid, ator.actorId)
    : await store.rejectOutboundFollow?.(reserva.uid, ator.actorId);
  if (!ok) return resp(202, 'ignorada-nao-seguia');
  return resp(202, aceito ? 'aceita-follow-aceito' : 'aceita-follow-recusado');
}

/** `Update` de um Note: a edição de um post ou comentário remoto que guardamos. Só o ator que o criou pode alterá-lo. */
async function atualizar(deps: InboxDeps, a: InboxActivity, ator: RemoteActorRecord): Promise<InboxResponse> {
  if (a.objectType !== 'Note' && a.objectType !== 'Article') return resp(202, 'ignorada-tipo');
  const obj = typeof a.object === 'object' && a.object !== null ? (a.object as Record<string, unknown>) : null;
  if (!obj || !a.objectId) return resp(202, 'ignorada-sem-conteudo');
  const texto = plainText(obj.content, 5000);
  if (!texto) return resp(202, 'ignorada-sem-conteudo');
  // Numa edição o aviso pode ter sido ACRESCENTADO ou RETIRADO: `null` apaga o que havia, e marcar sensível segue a mesma regra
  // da ingestão (aviso escrito já basta, com ou sem mídia).
  const avisoAtualizado = extractContentWarning(obj);
  const sensitiveUpdate = typeof obj.sensitive === 'boolean' || avisoAtualizado !== null ? extractSensitiveFlag(obj) : undefined;
  const onde = await deps.store.updateRemoteContent?.(a.objectId, ator.actorId, texto, sensitiveUpdate, avisoAtualizado);
  if (!onde || onde === 'unknown') return resp(202, 'ignorada-sem-conteudo-local');
  return resp(202, onde === 'comment' ? 'aceita-edicao-comentario' : 'aceita-edicao-post');
}

async function denunciar(deps: InboxDeps, a: InboxActivity, ator: RemoteActorRecord): Promise<InboxResponse> {
  const { store } = deps;
  // Denúncia recebida de fora é SINAL, nunca ação automática (docs §9). Com limite próprio, porque é o vetor
  // preferido de spam entre instâncias.
  const limite = deps.flagLimiter.take(`f:${ator.domain}`, deps.now());
  if (!limite.ok) return resp(429, 'limite-denuncias', { 'Retry-After': String(limite.retryAfterSeconds) });
  const bruto = (a.raw as { content?: unknown }).content;
  const alvos = (Array.isArray(a.object) ? a.object : [a.object]).filter((x): x is string => typeof x === 'string').slice(0, 20);
  await store.saveFlag({
    fromActor: ator.actorId,
    fromDomain: ator.domain,
    targets: alvos,
    content: typeof bruto === 'string' ? bruto.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000) : '',
    receivedAtMs: deps.now(),
  });
  return resp(202, 'aceita-denuncia');
}
