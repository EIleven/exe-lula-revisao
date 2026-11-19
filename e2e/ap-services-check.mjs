#!/usr/bin/env node
/**
 * Testa os SERVIÇOS da federação (conta, descoberta, caixa de entrada, motor de entrega) com um Fediverso simulado:
 * servidores remotos com chaves RSA reais, rede falsa e armazenamento em memória. Sem emuladores, sem app, sem rede.
 *   node e2e/ap-services-check.mjs        (ou: npm run e2e:ap-servicos)
 *
 * O que se prova aqui, e que o núcleo sozinho não prova:
 *  - a ORDEM das checagens da caixa de entrada (nada de rede antes do que é barato);
 *  - que o portão roda de novo em cada entrega, e uma pausa CANCELA o que estava na fila;
 *  - que cada entrega que sai tem assinatura verificável pelo verificador real;
 *  - idempotência, retomada depois de queda e backoff;
 *  - que nada sai quando a plataforma está desligada, por enumeração de estados.
 *
 * Sai com código 1 se algo falhar.
 */
import { verifyHttpSignature, signRequest } from '../src/lib/activitypub/signature.ts';
import { generateActorKeyPair, parseMasterKeyring, openSecret } from '../src/lib/activitypub/keys.ts';
import { processInbox } from '../src/lib/activitypub/inbox.ts';
import {
  disableFederation, enableFederation, getFederationStatus, markAccountDeleted, pauseFederation, resumeFederation,
} from '../src/lib/activitypub/account.ts';
import {
  renderActor, renderCountCollection, renderNodeInfo, renderNote, renderOutbox, renderWebfinger,
} from '../src/lib/activitypub/render.ts';
import { listDeliveriesForUser, retryDeliveryForUser, runWorker } from '../src/lib/activitypub/worker.ts';
import { WindowLimiter } from '../src/lib/activitypub/rateLimit.ts';
import { lookupAcct } from '../src/lib/activitypub/remote.ts';
import { AS_PUBLIC } from '../src/lib/activitypub/gate.ts';
import { createMemoryStore } from './helpers/ap-memory-store.mjs';

let falhas = 0;
let total = 0;
function confere(nome, condicao, motivo, detalhe) {
  total++;
  if (condicao) console.log(`OK    ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo}`); }
}

const HOST = 'exercitodolula.app';
const ORIGEM = `https://${HOST}`;
const T0 = Date.UTC(2026, 10, 12, 15, 0, 0);
const MESTRA = parseMasterKeyring(`k1:${Buffer.alloc(32, 5).toString('base64')}`);

// ───────────── um Fediverso simulado ─────────────

async function criarRemoto(rede, host, usuario) {
  const par = await generateActorKeyPair();
  const id = `https://${host}/users/${usuario}`;
  const remoto = {
    host, usuario, id, par,
    inbox: `https://${host}/users/${usuario}/inbox`,
    sharedInbox: `https://${host}/inbox`,
    keyId: `${id}#main-key`,
    doc() {
      return {
        '@context': ['https://www.w3.org/ns/activitystreams'],
        id, type: 'Person', preferredUsername: usuario, name: `${usuario} em ${host}`, summary: '<p>oi</p>',
        inbox: this.inbox, endpoints: { sharedInbox: this.sharedInbox },
        publicKey: { id: this.keyId, owner: id, publicKeyPem: this.par.publicKeyPem },
        icon: { type: 'Image', url: `https://${host}/avatar.png` },
      };
    },
  };
  rede.atores.set(id, () => ({ status: 200, json: remoto.doc() }));
  return remoto;
}

function criarRede() {
  const rede = {
    atores: new Map(),
    gets: [],
    posts: [],
    respostaPost: () => ({ status: 202, unsafe: false }),
    fetcher: {
      async get(url) {
        rede.gets.push(url);
        const h = rede.atores.get(url.split('#')[0]);
        if (h) { const r = h(); return { status: r.status, json: r.json ?? null, finalUrl: url }; }
        return { status: 404, json: null, finalUrl: url };
      },
      async post(url, body, sign) {
        rede.posts.push({ url, body, sign });
        return rede.respostaPost(url, body, sign);
      },
    },
  };
  return rede;
}

function montar(inicial = {}) {
  const { store, teste } = createMemoryStore(inicial);
  const rede = criarRede();
  const relogio = { t: T0, now() { return this.t; }, avanca(ms) { this.t += ms; } };
  let seq = 0;
  const deps = {
    store, fetcher: rede.fetcher, now: () => relogio.t, ownHost: HOST, origin: ORIGEM,
    mediaOrigin: 'https://media.exercitodolula.app', mediaTypeOf: async () => null, softwareVersion: 'teste',
    keyring: MESTRA, randomId: () => `id${++seq}`,
    domainLimiter: new WindowLimiter(1000, 60_000), actorLimiter: new WindowLimiter(1000, 60_000), flagLimiter: new WindowLimiter(3, 3_600_000),
  };
  teste.seedProfile({
    uid: 'U_ANA', name: 'Ana Silva', username: 'Ana_Silva', bio: 'Oi, sou a Ana #lula', avatarUrl: 'https://media.exercitodolula.app/m/AAAAAAAAAAAAAAAAAAAAAA',
    coverUrl: null, website: 'https://ana.exemplo.com.br', location: 'Recife', createdAtMs: T0 - 1e9, profileVisibility: 'public',
  });
  teste.seedProfile({
    uid: 'U_BIA', name: 'Bia', username: 'bia', bio: '', avatarUrl: null, coverUrl: null, website: null, location: null, createdAtMs: T0 - 1e9, profileVisibility: 'public',
  });
  return { deps, store, teste, rede, relogio };
}

const post = (relogio, over = {}) => ({
  id: 'P1', userId: 'U_ANA', text: 'olá mundo #lula', hashtags: ['lula'], media: [], createdAtMs: relogio.t, updatedAtMs: null,
  visibility: 'public', federation: 'public', type: 'original', category: 'echo', isDeleted: false, hasPoll: false,
  sensitive: false, youtubeVideoId: null, ...over,
});
const tarefa = (relogio, op, postId, uid = 'U_ANA') => ({
  id: `${op}-${postId}-${relogio.t}`, op, uid, postId, targets: null, createdAtMs: relogio.t, nextAttemptAt: relogio.t, attempts: 0, state: 'pending', note: null,
});

/** Monta uma requisição à caixa de entrada, assinada como `remoto`. `mutar` adultera depois de assinar. */
function requisicao(remoto, { handle = 'ana_silva', atividade, relogio, caminho, mutar, assinarCom } = {}) {
  const path = caminho ?? (handle === null ? '/ap/inbox' : `/ap/users/${handle}/inbox`);
  const corpo = typeof atividade === 'string' ? atividade : JSON.stringify(atividade);
  const par = assinarCom ?? remoto.par;
  const assinados = signRequest({ method: 'POST', url: `${ORIGEM}${path}`, body: corpo, privateKeyPem: par.privateKeyPem, keyId: remoto.keyId, now: relogio.now() });
  const req = { handle, method: 'POST', path, headers: { ...assinados, 'content-type': 'application/activity+json' }, body: Buffer.from(corpo) };
  if (mutar) mutar(req);
  return req;
}

const follow = (remoto, alvoHandle, id = `https://${remoto.host}/follows/${remoto.usuario}-1`) => ({
  '@context': 'https://www.w3.org/ns/activitystreams', id, type: 'Follow', actor: remoto.id, object: `${ORIGEM}/ap/users/${alvoHandle}`,
});

const entregasDe = (rede, filtro = () => true) => rede.posts.filter(filtro).map((p) => ({ ...p, json: JSON.parse(p.body) }));

// ═════════════ 1. Ciclo de vida da conta ═════════════

{
  const { deps, store, teste } = montar();
  const antes = await getFederationStatus(deps, 'U_ANA');
  confere('CONTA · começa desligada', !antes.enabled && antes.handle === null && antes.acct === null, JSON.stringify(antes));

  teste.platform.enabled = false;
  let r = await enableFederation(deps, 'U_ANA', { emailVerified: true });
  confere('CONTA · não ativa com a plataforma desligada', !r.ok && r.reason === 'plataforma-desligada', JSON.stringify(r));
  teste.platform.enabled = true;

  r = await enableFederation(deps, 'U_ANA', { emailVerified: false });
  confere('CONTA · não ativa sem e-mail confirmado', !r.ok && r.reason === 'email-nao-confirmado', JSON.stringify(r));
  confere('CONTA · e a recusa não deixa rastro (nem handle, nem chave)', teste.handles.size === 0 && teste.keys.size === 0, 'sobrou reserva ou chave');

  r = await enableFederation(deps, 'U_NINGUEM', { emailVerified: true });
  confere('CONTA · perfil inexistente é recusado', !r.ok && r.reason === 'perfil-inexistente', JSON.stringify(r));

  r = await enableFederation(deps, 'U_ANA', { emailVerified: true });
  confere('CONTA · ativa com as três condições', r.ok && r.account.enabled && r.account.handle === 'ana_silva', JSON.stringify(r));
  const st = await getFederationStatus(deps, 'U_ANA');
  confere('CONTA · o handle federado é usuario@host em minúsculas', st.acct === 'ana_silva@exercitodolula.app', String(st.acct));
  confere('CONTA · eligibleSince é o instante da ativação', st.eligibleSince === T0, String(st.eligibleSince));

  const selada = teste.keys.get('U_ANA');
  confere('CONTA · a chave privada é guardada CIFRADA', selada && selada.alg === 'A256GCM' && !JSON.stringify(selada).includes('PRIVATE'), 'chave em claro');
  const pem = openSecret(selada, MESTRA, 'U_ANA');
  confere('CONTA · decifrada, é a chave que casa com a pública da reserva', pem.includes('BEGIN PRIVATE KEY') && teste.handles.get('ana_silva').publicKeyPem.includes('BEGIN PUBLIC KEY'), 'par inconsistente');

  const dupla = await enableFederation(deps, 'U_ANA', { emailVerified: true });
  confere('CONTA · ativar de novo é idempotente (mesma conta, mesma chave)', dupla.ok && teste.keys.size === 1 && dupla.account.eligibleSince === T0, 'regerou ou reabriu a janela');

  // handle de OUTRA pessoa com o mesmo @ (cenário: ela renomeou, outra pegou o @)
  teste.seedProfile({ uid: 'U_OUTRA', name: 'Outra', username: 'Ana_Silva', bio: '', avatarUrl: null, coverUrl: null, website: null, location: null, createdAtMs: T0, profileVisibility: 'public' });
  const conflito = await enableFederation(deps, 'U_OUTRA', { emailVerified: true });
  confere('CONTA · handle já reservado por outra pessoa é recusado', !conflito.ok && conflito.reason === 'handle-indisponivel', JSON.stringify(conflito));

  // pausa e retomada
  relogio_avanca(deps, 60_000);
  const p = await pauseFederation(deps, 'U_ANA');
  confere('CONTA · pausar', p.ok && p.account.paused, JSON.stringify(p));
  relogio_avanca(deps, 60_000);
  const antesRetomar = (await store.getAccount('U_ANA')).eligibleSince;
  const rr = await resumeFederation(deps, 'U_ANA');
  confere('CONTA · retomar regrava eligibleSince (o que nasceu na pausa nunca sai)', rr.ok && !rr.account.paused && rr.account.eligibleSince > antesRetomar, `${antesRetomar} → ${rr.account?.eligibleSince}`);
  confere('CONTA · retomar sem estar pausada não mexe em nada', (await resumeFederation(deps, 'U_ANA')).account.eligibleSince === rr.account.eligibleSince, 'reabriu a janela à toa');
  confere('CONTA · pausar conta nunca ativada é recusado', (await pauseFederation(deps, 'U_BIA')).reason === 'nao-ativada', 'aceitou');

  // desligar
  const d = await disableFederation(deps, 'U_ANA');
  confere('CONTA · desligar', d.ok && !d.account.enabled, JSON.stringify(d));
  confere('CONTA · o handle continua RESERVADO ao desligar', teste.handles.get('ana_silva')?.uid === 'U_ANA' && teste.handles.get('ana_silva').state === 'off', JSON.stringify(teste.handles.get('ana_silva')));
  confere('CONTA · desligar enfileira o Delete do ator', [...teste.jobs.values()].some((j) => j.op === 'delete-actor' && j.uid === 'U_ANA'), 'sem tarefa');
  confere('CONTA · a chave continua (para assinar o Delete)', teste.keys.has('U_ANA'), 'chave destruída cedo demais');
  const outraVez = await enableFederation(deps, 'U_ANA', { emailVerified: true });
  confere('CONTA · religar reaproveita o MESMO handle e a MESMA chave', outraVez.ok && outraVez.account.handle === 'ana_silva' && teste.keys.size === 1, JSON.stringify(outraVez));
}

// helper do bloco acima: avançar o relógio das deps
function relogio_avanca(deps, ms) { const base = deps.now(); deps.now = () => base + ms; }

// ═════════════ 2. Descoberta ═════════════

{
  const { deps, store, teste } = montar();
  confere('DESCOBERTA · actor de handle inexistente → 404', (await renderActor(deps, 'ninguem')).status === 404, 'respondeu');
  await enableFederation(deps, 'U_ANA', { emailVerified: true });

  // Conta antiga: o vínculo que a pessoa cadastrava continua gravado (leitura retrocompatível) e NÃO pode sair no ator.
  await store.saveAccount({ ...(await store.getAccount('U_ANA')), alsoKnownAs: ['https://x.org/users/ana'] });

  const a = await renderActor(deps, 'ana_silva');
  confere('DESCOBERTA · actor NÃO publica o alsoKnownAs que a pessoa cadastrava, mesmo gravado na conta',
    !JSON.stringify(a.body).includes('x.org/users/ana'),
    JSON.stringify(a.body).slice(0, 200));

  // ── migração de domínio: o host antigo continua válido e aponta para o novo ──
  const ANTIGO = 'https://exercitodolula.app';
  const velho = await renderActor(deps, 'ana_silva', { legacyOrigin: ANTIGO });
  confere('MIGRAÇÃO · pelo host ANTIGO o ator declara o id DELE (documento com id de outro host é recusado como falsificação)',
    velho.body.id === `${ANTIGO}/ap/users/ana_silva` && velho.body.inbox.startsWith(ANTIGO) && velho.body.publicKey.id.startsWith(ANTIGO),
    JSON.stringify({ id: velho.body.id, inbox: velho.body.inbox, key: velho.body.publicKey.id }));
  confere('MIGRAÇÃO · e leva `movedTo` para o endereço canônico (é assim que o Fediverso diz que a conta se mudou)',
    velho.body.movedTo === `${ORIGEM}/ap/users/ana_silva`, String(velho.body.movedTo));
  confere('MIGRAÇÃO · o ator do host antigo NÃO leva alias (quem aponta de volta é o canônico)',
    !('alsoKnownAs' in velho.body), JSON.stringify(velho.body.alsoKnownAs));
  const novo = await renderActor(deps, 'ana_silva', { alsoKnownAs: [`${ANTIGO}/ap/users/ana_silva`] });
  confere('MIGRAÇÃO · o ator canônico aponta de volta pelo auto-alias, e segue com o id canônico',
    novo.body.id === `${ORIGEM}/ap/users/ana_silva` && JSON.stringify(novo.body.alsoKnownAs) === JSON.stringify([`${ANTIGO}/ap/users/ana_silva`]),
    JSON.stringify({ id: novo.body.id, aka: novo.body.alsoKnownAs }));
  const wfVelho = await renderWebfinger(deps, 'ana_silva', { legacyOrigin: ANTIGO, legacyHost: 'exercitodolula.app' });
  confere('MIGRAÇÃO · o WebFinger do host antigo volta a responder, apontando para o ator ANTIGO',
    wfVelho.status === 200 && wfVelho.body.subject === 'acct:ana_silva@exercitodolula.app'
    && JSON.stringify(wfVelho.body.links).includes(`${ANTIGO}/ap/users/ana_silva`),
    JSON.stringify(wfVelho.body));
  confere('DESCOBERTA · actor ativo → 200 com Person', a.status === 200 && a.body.type === 'Person' && a.body.id === `${ORIGEM}/ap/users/ana_silva`, JSON.stringify(a.body).slice(0, 80));
  confere('DESCOBERTA · a chave pública do actor é a da reserva', a.body.publicKey.publicKeyPem === teste.handles.get('ana_silva').publicKeyPem, 'chave diferente');
  confere('DESCOBERTA · o actor NÃO tem chave privada, e-mail nem nascimento', !/PRIVATE|email|birth|nascimento|dateOfBirth/i.test(JSON.stringify(a.body)), 'dado sensível no actor');
  confere('DESCOBERTA · avatar na URL de mídia própria', a.body.icon?.url === 'https://media.exercitodolula.app/m/AAAAAAAAAAAAAAAAAAAAAA', JSON.stringify(a.body.icon));
  confere('DESCOBERTA · bio vira HTML com hashtag', a.body.summary.includes('rel="tag"'), a.body.summary);

  teste.seedProfile({ ...(await store.getProfile('U_ANA')), avatarUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/user_uploads%2FUID%2Fa.jpg?alt=media&token=T' });
  const semLegado = await renderActor(deps, 'ana_silva');
  confere('DESCOBERTA · avatar em URL LEGADA do Firebase NÃO é publicado (vazaria UID e caminho)', !('icon' in semLegado.body) && !JSON.stringify(semLegado.body).includes('firebasestorage'), JSON.stringify(semLegado.body.icon));

  const wf = await renderWebfinger(deps, 'ana_silva');
  confere('DESCOBERTA · WebFinger de conta ativa', wf.status === 200 && wf.body.subject === 'acct:ana_silva@exercitodolula.app' && wf.headers['Content-Type'].startsWith('application/jrd+json'), JSON.stringify(wf));
  confere('DESCOBERTA · WebFinger de handle inexistente → 404', (await renderWebfinger(deps, 'ninguem')).status === 404, 'respondeu');

  const seg = await renderCountCollection(deps, 'ana_silva', 'followers');
  confere('DESCOBERTA · seguidores: só a contagem, sem itens', seg.status === 200 && seg.body.totalItems === 0 && !('orderedItems' in seg.body) && !('first' in seg.body), JSON.stringify(seg.body));

  const ni = await renderNodeInfo(deps);
  confere('DESCOBERTA · NodeInfo 2.1 com activitypub e sem registro aberto', ni.body.version === '2.1' && ni.body.protocols.includes('activitypub') && ni.body.openRegistrations === false, JSON.stringify(ni.body));
  confere('DESCOBERTA · NodeInfo só conta a federação', ni.body.usage.users.total === 1, JSON.stringify(ni.body.usage));

  // posts federados
  teste.seedPost({ id: 'PPUB', userId: 'U_ANA', text: 'público', hashtags: [], media: [], createdAtMs: T0 + 10, updatedAtMs: null, visibility: 'public', federation: 'public', type: 'original', category: 'echo', isDeleted: false, hasPoll: false, sensitive: false, youtubeVideoId: null });
  teste.seedPost({ id: 'PSEG', userId: 'U_ANA', text: 'seguidores', hashtags: [], media: [], createdAtMs: T0 + 20, updatedAtMs: null, visibility: 'public', federation: 'followers', type: 'original', category: 'echo', isDeleted: false, hasPoll: false, sensitive: false, youtubeVideoId: null });
  teste.seedPost({ id: 'PNAO', userId: 'U_ANA', text: 'nunca saiu', hashtags: [], media: [], createdAtMs: T0 + 30, updatedAtMs: null, visibility: 'public', federation: 'local', type: 'original', category: 'echo', isDeleted: false, hasPoll: false, sensitive: false, youtubeVideoId: null });
  await store.putObject({ postId: 'PPUB', uid: 'U_ANA', objectId: `${ORIGEM}/ap/notes/PPUB`, scope: 'public', createdAtMs: T0 + 10, state: 'federated', lastActivityAtMs: T0 + 10 });
  await store.putObject({ postId: 'PSEG', uid: 'U_ANA', objectId: `${ORIGEM}/ap/notes/PSEG`, scope: 'followers', createdAtMs: T0 + 20, state: 'federated', lastActivityAtMs: T0 + 20 });

  const nPub = await renderNote(deps, 'PPUB');
  confere('DESCOBERTA · nota pública → 200 com @context', nPub.status === 200 && nPub.body.type === 'Note' && Array.isArray(nPub.body['@context']) && nPub.body.to.includes(AS_PUBLIC), JSON.stringify(nPub.body).slice(0, 100));
  confere('DESCOBERTA · nota só-seguidores → 404 (não temos como provar quem pede)', (await renderNote(deps, 'PSEG')).status === 404, 'serviu');
  confere('DESCOBERTA · post que NUNCA saiu → 404', (await renderNote(deps, 'PNAO')).status === 404, 'serviu post local');
  confere('DESCOBERTA · post inexistente → 404', (await renderNote(deps, 'XXXX')).status === 404, 'serviu');

  const out = await renderOutbox(deps, 'ana_silva', null);
  confere('DESCOBERTA · outbox conta só o PÚBLICO', out.body.totalItems === 1, JSON.stringify(out.body));
  const pg = await renderOutbox(deps, 'ana_silva', { before: null });
  confere('DESCOBERTA · página da outbox lista Create do público e NÃO o só-seguidores', pg.body.orderedItems.length === 1 && pg.body.orderedItems[0].type === 'Create' && !JSON.stringify(pg.body).includes('PSEG'), JSON.stringify(pg.body).slice(0, 120));

  // apagado → tombstone
  teste.patchPost('PPUB', { isDeleted: true });
  const gone = await renderNote(deps, 'PPUB');
  confere('DESCOBERTA · post apagado → 410 com Tombstone', gone.status === 410 && gone.body.type === 'Tombstone', JSON.stringify(gone));

  // plataforma desligada: tudo some
  teste.platform.enabled = false;
  const todos = await Promise.all([renderActor(deps, 'ana_silva'), renderWebfinger(deps, 'ana_silva'), renderNote(deps, 'PPUB'), renderOutbox(deps, 'ana_silva', null), renderNodeInfo(deps), renderCountCollection(deps, 'ana_silva', 'followers')]);
  confere('DESCOBERTA · plataforma desligada: NADA responde (404 em tudo)', todos.every((x) => x.status === 404), JSON.stringify(todos.map((x) => x.status)));
  teste.platform.enabled = true;

  // conta desligada: 410 no actor, 404 no resto
  await disableFederation(deps, 'U_ANA');
  const off = await renderActor(deps, 'ana_silva');
  confere('DESCOBERTA · conta desligada: actor → 410 Tombstone', off.status === 410 && off.body.type === 'Tombstone', JSON.stringify(off));
  confere('DESCOBERTA · conta desligada: WebFinger → 404 (não revela)', (await renderWebfinger(deps, 'ana_silva')).status === 404, 'revelou');
  confere('DESCOBERTA · conta desligada: outbox e seguidores → 404', (await renderOutbox(deps, 'ana_silva', null)).status === 404 && (await renderCountCollection(deps, 'ana_silva', 'followers')).status === 404, 'respondeu');
}

// ═════════════ 3. Caixa de entrada ═════════════

{
  const ctx = montar();
  const { deps, store, teste, rede, relogio } = ctx;
  await enableFederation(deps, 'U_ANA', { emailVerified: true });
  const bia = await criarRemoto(rede, 'mastodon.social', 'bia');

  const envia = (req) => processInbox(deps, req);
  const enviaFollow = (remoto = bia, over = {}) => envia(requisicao(remoto, { atividade: follow(remoto, 'ana_silva'), relogio: deps, ...over }));
  // `relogio` aqui é só para assinar: usa o relógio das deps
  const rel = { now: () => deps.now() };

  // o caminho feliz
  let r = await envia(requisicao(bia, { atividade: follow(bia, 'ana_silva'), relogio: rel }));
  confere('ENTRADA · Follow assinado e válido → 202', r.status === 202 && r.reason === 'aceita-follow', JSON.stringify(r));
  confere('ENTRADA · o seguidor é gravado com os inboxes do ator VERIFICADO (não os que a atividade cita)',
    (await store.getFollower('U_ANA', bia.id))?.sharedInbox === bia.sharedInbox, JSON.stringify(await store.getFollower('U_ANA', bia.id)));
  const aceites = [...teste.deliveries.values()].filter((d) => d.op === 'accept');
  confere('ENTRADA · um Accept é enfileirado', aceites.length === 1 && aceites[0].targetInbox === bia.sharedInbox, JSON.stringify(aceites.map((a) => a.targetInbox)));
  confere('ENTRADA · o Accept embute o Follow recebido', JSON.parse(aceites[0].body).object.id === follow(bia, 'ana_silva').id, aceites[0].body.slice(0, 100));

  // replay
  r = await envia(requisicao(bia, { atividade: follow(bia, 'ana_silva'), relogio: rel }));
  confere('ENTRADA · REPLAY do mesmo id → 202 "duplicada" e nenhum segundo Accept', r.status === 202 && r.reason === 'duplicada' && [...teste.deliveries.values()].filter((d) => d.op === 'accept').length === 1, JSON.stringify(r));
  const get1 = rede.gets.length;
  r = await envia(requisicao(bia, { atividade: follow(bia, 'ana_silva', 'https://mastodon.social/follows/2'), relogio: rel }));
  confere('ENTRADA · segunda chave em cache: não busca o ator de novo', rede.gets.length === get1, `buscou ${rede.gets.length - get1} vezes`);
  confere('ENTRADA · Follow novo de quem já segue gera NOVO Accept (o remoto pode ter perdido o primeiro)', [...teste.deliveries.values()].filter((d) => d.op === 'accept').length === 2, 'sem novo accept');

  // as recusas de estrutura, em ordem
  const casos = [
    ['GET na caixa de entrada → 405', { ...requisicao(bia, { atividade: follow(bia, 'ana_silva'), relogio: rel }), method: 'GET' }, 405],
    ['corpo maior que 1 MB → 413', { ...requisicao(bia, { atividade: follow(bia, 'ana_silva'), relogio: rel }), body: Buffer.alloc(1_000_001, 65) }, 413],
    ['tipo de conteúdo errado → 415', (() => { const q = requisicao(bia, { atividade: follow(bia, 'ana_silva'), relogio: rel }); q.headers['content-type'] = 'text/html'; return q; })(), 415],
    ['sem assinatura → 401', (() => { const q = requisicao(bia, { atividade: follow(bia, 'ana_silva', 'https://mastodon.social/f/a'), relogio: rel }); delete q.headers.signature; return q; })(), 401],
    ['digest que não bate (corpo adulterado) → 401', (() => { const q = requisicao(bia, { atividade: follow(bia, 'ana_silva', 'https://mastodon.social/f/b'), relogio: rel }); q.body = Buffer.from('{"type":"Delete"}'); return q; })(), 401],
    ['assinatura de 10 minutos atrás (replay antigo) → 401', requisicao(bia, { atividade: follow(bia, 'ana_silva', 'https://mastodon.social/f/c'), relogio: { now: () => deps.now() - 600_000 } }), 401],
    ['caixa pessoal de handle inexistente → 404', requisicao(bia, { handle: 'ninguem', atividade: follow(bia, 'ana_silva', 'https://mastodon.social/f/d'), relogio: rel }), 404],
  ];
  for (const [nome, req, esperado] of casos) {
    const x = await envia(req);
    confere(`ENTRADA · ${nome}`, x.status === esperado, `veio ${x.status} (${x.reason})`);
  }

  // assinada por chave que NÃO é a do ator (impostor)
  const impostor = await generateActorKeyPair();
  r = await envia(requisicao(bia, { atividade: follow(bia, 'ana_silva', 'https://mastodon.social/f/e'), relogio: rel, assinarCom: impostor }));
  confere('ENTRADA · assinada com a chave de um IMPOSTOR → 401', r.status === 401 && /assinatura/.test(r.reason), JSON.stringify(r));

  // falsificação: assinatura de bia, atividade diz ser de outra
  const ze = await criarRemoto(rede, 'outro.social', 'ze');
  r = await envia(requisicao(bia, { atividade: { ...follow(ze, 'ana_silva'), id: 'https://outro.social/follows/9' }, relogio: rel }));
  confere('ENTRADA · FALSIFICAÇÃO: bia assina, a atividade diz ser do ze → 401', r.status === 401 && /falsificacao/.test(r.reason), JSON.stringify(r));

  r = await envia(requisicao(bia, { atividade: { id: 'https://mastodon.social/c/1', type: 'Create', actor: bia.id, object: { id: 'https://mastodon.social/n/1', type: 'Note', attributedTo: ze.id, content: 'x', to: [AS_PUBLIC] } }, relogio: rel }));
  confere('ENTRADA · FALSIFICAÇÃO: Create de bia com autor declarado ze → 401', r.status === 401 && /falsificacao/.test(r.reason), JSON.stringify(r));

  // rotação de chave. Num cenário real ela acontece bem depois da última renovação forçada; o teste anterior (o do
  // impostor) já gastou a janela de 5 minutos, então o relógio avança além dela, como na vida.
  relogio.t += 6 * 60 * 1000;
  const novaChave = await generateActorKeyPair();
  bia.par = novaChave;
  r = await envia(requisicao(bia, { atividade: follow(bia, 'ana_silva', 'https://mastodon.social/f/rot1'), relogio: rel }));
  confere('ENTRADA · ROTAÇÃO: chave nova no remoto, cache antigo → renova uma vez e aceita', r.status === 202, JSON.stringify(r));
  const outraChave = await generateActorKeyPair();
  const getsAntes = rede.gets.length;
  for (let i = 0; i < 6; i++) {
    await envia(requisicao(bia, { atividade: follow(bia, 'ana_silva', `https://mastodon.social/f/lixo${i}`), relogio: rel, assinarCom: outraChave }));
  }
  confere('ENTRADA · 6 assinaturas ruins seguidas NÃO viram 6 buscas (renovação limitada a 1 por 5 min)', rede.gets.length - getsAntes <= 1, `${rede.gets.length - getsAntes} buscas`);

  // política: instância suspensa nunca gera rede
  const spam = await criarRemoto(rede, 'spam.org', 'bot');
  teste.setPolicy({ mode: 'open', rules: { 'spam.org': { action: 'suspend' } } });
  const getsSpam = rede.gets.length;
  r = await envia(requisicao(spam, { atividade: follow(spam, 'ana_silva'), relogio: rel }));
  confere('ENTRADA · instância SUSPENSA → 202 silencioso (não avisa que foi bloqueada)', r.status === 202 && /descartada/.test(r.reason), JSON.stringify(r));
  confere('ENTRADA · e nenhuma requisição de rede foi feita por causa dela', rede.gets.length === getsSpam, `${rede.gets.length - getsSpam} buscas`);
  confere('ENTRADA · e nada foi gravado', !(await store.getFollower('U_ANA', spam.id)) && !teste.remoteActors.has(spam.id), 'gravou algo da instância suspensa');

  teste.setPolicy({ mode: 'allowlist', rules: { 'mastodon.social': { action: 'allow' } } });
  r = await envia(requisicao(ze, { atividade: follow(ze, 'ana_silva'), relogio: rel }));
  confere('ENTRADA · modo lista-permitida: quem não está nela → 202 descartada', r.status === 202 && /fora-da-lista/.test(r.reason), JSON.stringify(r));
  r = await envia(requisicao(bia, { atividade: follow(bia, 'ana_silva', 'https://mastodon.social/f/lp'), relogio: rel }));
  confere('ENTRADA · modo lista-permitida: quem está nela passa', r.status === 202 && r.reason === 'aceita-follow', JSON.stringify(r));
  teste.setPolicy({ mode: 'open', rules: {} });

  // keyId com IP / localhost: SSRF por cabeçalho
  for (const keyId of ['https://127.0.0.1/users/x#main-key', 'https://169.254.169.254/latest#k', 'https://localhost/u#k', 'http://mastodon.social/users/bia#main-key', 'https://u:p@mastodon.social/users/bia#k']) {
    const q = requisicao(bia, { atividade: follow(bia, 'ana_silva', 'https://mastodon.social/f/ssrf'), relogio: rel });
    q.headers.signature = q.headers.signature.replace(/keyId="[^"]*"/, `keyId="${keyId}"`);
    const getsAntesSsrf = rede.gets.length;
    const x = await envia(q);
    confere(`ENTRADA · SSRF pelo keyId (${keyId.slice(0, 32)}) → 401 e SEM rede`, x.status === 401 && rede.gets.length === getsAntesSsrf, `status ${x.status}, ${rede.gets.length - getsAntesSsrf} buscas`);
  }

  // ator remoto com documento malicioso
  const mau = await criarRemoto(rede, 'mau.social', 'mau');
  rede.atores.set(mau.id, () => ({ status: 200, json: { ...mau.doc(), id: 'https://mastodon.social/users/bia' } }));
  r = await envia(requisicao(mau, { atividade: follow(mau, 'ana_silva'), relogio: rel }));
  confere('ENTRADA · ator cujo documento declara OUTRO id (envenenamento de cache) → 401', r.status === 401 && /id-divergente/.test(r.reason), JSON.stringify(r));
  confere('ENTRADA · e a chave dele NÃO foi parar no cache do alvo', (await store.getRemoteActor('https://mastodon.social/users/bia')).publicKeyPem !== mau.par.publicKeyPem, 'cache envenenado');

  rede.atores.set(mau.id, () => ({ status: 200, json: { ...mau.doc(), inbox: 'https://vitima.org/inbox' } }));
  r = await envia(requisicao(mau, { atividade: follow(mau, 'ana_silva', 'https://mau.social/f/2'), relogio: rel }));
  confere('ENTRADA · ator com inbox em OUTRO host (amplificação) → 401', r.status === 401 && /inbox-de-outro-host/.test(r.reason), JSON.stringify(r));
  rede.atores.set(mau.id, () => ({ status: 200, json: { ...mau.doc(), publicKey: { id: mau.keyId, owner: bia.id, publicKeyPem: mau.par.publicKeyPem } } }));
  r = await envia(requisicao(mau, { atividade: follow(mau, 'ana_silva', 'https://mau.social/f/3'), relogio: rel }));
  confere('ENTRADA · chave que declara OUTRO dono → 401', r.status === 401 && /sem-chave/.test(r.reason), JSON.stringify(r));
  rede.atores.set(mau.id, () => ({ status: 200, json: { ...mau.doc(), publicKey: { id: mau.keyId, owner: mau.id, publicKeyPem: '-----BEGIN PUBLIC KEY-----\nlixo\n-----END PUBLIC KEY-----' } } }));
  r = await envia(requisicao(mau, { atividade: follow(mau, 'ana_silva', 'https://mau.social/f/4'), relogio: rel }));
  confere('ENTRADA · chave pública inválida → 401', r.status === 401, JSON.stringify(r));

  // ator removido (410)
  const fantasma = await criarRemoto(rede, 'sumiu.social', 'fantasma');
  rede.atores.set(fantasma.id, () => ({ status: 410, json: null }));
  r = await envia(requisicao(fantasma, { atividade: follow(fantasma, 'ana_silva'), relogio: rel }));
  confere('ENTRADA · ator que o servidor diz ter sido removido (410) → 401', r.status === 401 && /removido/.test(r.reason), JSON.stringify(r));

  // bloqueio da pessoa
  const chato = await criarRemoto(rede, 'chato.social', 'chato');
  await store.addUserBlock('U_ANA', { scope: 'actor', value: chato.id });
  r = await envia(requisicao(chato, { atividade: follow(chato, 'ana_silva'), relogio: rel }));
  confere('ENTRADA · ator bloqueado pela pessoa → 202 descartada, sem seguidor', r.status === 202 && /descartada-bloqueio/.test(r.reason) && !(await store.getFollower('U_ANA', chato.id)), JSON.stringify(r));
  const comDominio = await criarRemoto(rede, 'tox.social', 'a');
  await store.addUserBlock('U_ANA', { scope: 'domain', value: 'tox.social' });
  r = await envia(requisicao(comDominio, { atividade: follow(comDominio, 'ana_silva'), relogio: rel }));
  confere('ENTRADA · domínio bloqueado pela pessoa → 202 descartada', r.status === 202 && /descartada-bloqueio/.test(r.reason), JSON.stringify(r));

  // conta pausada / desligada
  await pauseFederation(deps, 'U_ANA');
  const lara = await criarRemoto(rede, 'lara.social', 'lara');
  r = await envia(requisicao(lara, { atividade: follow(lara, 'ana_silva'), relogio: rel }));
  confere('ENTRADA · conta PAUSADA não aceita seguidor novo (o Accept seria uma saída)', r.status === 202 && /conta-inativa/.test(r.reason) && !(await store.getFollower('U_ANA', lara.id)), JSON.stringify(r));
  await resumeFederation(deps, 'U_ANA');

  // Undo
  const undoEmbutido = { id: 'https://mastodon.social/undo/1', type: 'Undo', actor: bia.id, object: follow(bia, 'ana_silva', 'https://mastodon.social/follows/2') };
  r = await envia(requisicao(bia, { atividade: undoEmbutido, relogio: rel }));
  confere('ENTRADA · Undo(Follow) embutido remove o seguidor', r.reason === 'aceita-unfollow' && !(await store.getFollower('U_ANA', bia.id)), JSON.stringify(r));
  await envia(requisicao(bia, { atividade: follow(bia, 'ana_silva', 'https://mastodon.social/follows/3'), relogio: rel }));
  r = await envia(requisicao(bia, { atividade: { id: 'https://mastodon.social/undo/2', type: 'Undo', actor: bia.id, object: 'https://mastodon.social/follows/3' }, relogio: rel }));
  confere('ENTRADA · Undo por id remove o seguidor certo', r.reason === 'aceita-unfollow' && !(await store.getFollower('U_ANA', bia.id)), JSON.stringify(r));
  r = await envia(requisicao(bia, { atividade: { id: 'https://mastodon.social/undo/3', type: 'Undo', actor: bia.id, object: follow(ze, 'ana_silva') }, relogio: rel }));
  confere('ENTRADA · Undo de Follow de OUTRO ator → 401 (ninguém desfaz o seguir alheio)', r.status === 401, JSON.stringify(r));

  // Block recebido
  await envia(requisicao(bia, { atividade: follow(bia, 'ana_silva', 'https://mastodon.social/follows/4'), relogio: rel }));
  r = await envia(requisicao(bia, { atividade: { id: 'https://mastodon.social/block/1', type: 'Block', actor: bia.id, object: `${ORIGEM}/ap/users/ana_silva` }, relogio: rel }));
  confere('ENTRADA · Block recebido remove o seguidor', r.reason === 'aceita-bloqueio' && !(await store.getFollower('U_ANA', bia.id)), JSON.stringify(r));

  // Delete do ator remoto
  await envia(requisicao(bia, { atividade: follow(bia, 'ana_silva', 'https://mastodon.social/follows/5'), relogio: rel }));
  r = await envia(requisicao(bia, { atividade: { id: 'https://mastodon.social/del/1', type: 'Delete', actor: bia.id, object: bia.id }, relogio: rel }));
  confere('ENTRADA · Delete do próprio ator remove todos os vínculos', r.reason === 'aceita-ator-removido' && !(await store.getFollower('U_ANA', bia.id)), JSON.stringify(r));
  const depoisDoDelete = await envia(requisicao(bia, { atividade: follow(bia, 'ana_silva', 'https://mastodon.social/follows/ressurge'), relogio: rel }));
  confere('ENTRADA · e o ator removido deixa de ser aceito (marcado "removido" no cache por uma hora)', depoisDoDelete.status === 401 && /removido/.test(depoisDoDelete.reason), JSON.stringify(depoisDoDelete));
  r = await envia(requisicao(bia, { atividade: { id: 'https://mastodon.social/del/2', type: 'Delete', actor: bia.id, object: 'https://outro.social/n/1' }, relogio: rel }));
  confere('ENTRADA · Delete de objeto de OUTRO host → 401 (um ator não apaga o alheio)', r.status === 401, JSON.stringify(r));

  // Flag
  for (let i = 0; i < 3; i++) await envia(requisicao(ze, { atividade: { id: `https://outro.social/flag/${i}`, type: 'Flag', actor: ze.id, object: [`${ORIGEM}/ap/users/ana_silva`], content: '<p>CONTEUDO-DA-DENUNCIA-XYZ</p>' }, relogio: rel }));
  confere('ENTRADA · Flag vira SINAL guardado, sem tags, sem ação automática', teste.flags.length === 3 && teste.flags[0].content === 'CONTEUDO-DA-DENUNCIA-XYZ' && (await store.getFollower('U_ANA', ze.id)) === null, JSON.stringify(teste.flags[0]));
  r = await envia(requisicao(ze, { atividade: { id: 'https://outro.social/flag/9', type: 'Flag', actor: ze.id, object: [`${ORIGEM}/ap/users/ana_silva`] }, relogio: rel }));
  confere('ENTRADA · Flag em excesso do mesmo domínio → 429 (vetor preferido de spam)', r.status === 429 && Boolean(r.headers?.['Retry-After']), JSON.stringify(r));

  // tipos não tratados. (Com o ze, não com a bia: o Delete acima marcou a bia como REMOVIDA no cache, e é correto que
  // ela deixe de ser aceita por uma hora.)
  r = await envia(requisicao(ze, { atividade: { id: 'https://outro.social/like/1', type: 'Like', actor: ze.id, object: `${ORIGEM}/ap/notes/P1` }, relogio: rel }));
  confere('ENTRADA · Like (ainda não tratado) → 202 ignorada, não erro', r.status === 202 && /ignorada/.test(r.reason), JSON.stringify(r));
  r = await envia(requisicao(ze, { atividade: { id: 'https://outro.social/x/1', type: 'Dislike', actor: ze.id, object: 'x' }, relogio: rel }));
  confere('ENTRADA · tipo desconhecido → 202', r.status === 202, JSON.stringify(r));

  // JSON ruim depois de assinatura boa
  const corpoRuim = '{"type": "Follow", ';
  r = await envia(requisicao(ze, { atividade: corpoRuim, relogio: rel }));
  confere('ENTRADA · JSON truncado com assinatura boa → 400', r.status === 400, JSON.stringify(r));

  // caixa compartilhada
  const nina = await criarRemoto(rede, 'nina.social', 'nina');
  r = await envia(requisicao(nina, { handle: null, atividade: follow(nina, 'ana_silva'), relogio: rel }));
  confere('ENTRADA · caixa COMPARTILHADA: o destinatário vem do objeto do Follow', r.reason === 'aceita-follow' && Boolean(await store.getFollower('U_ANA', nina.id)), JSON.stringify(r));

  // limite por domínio
  const apertado = { ...deps, domainLimiter: new WindowLimiter(3, 60_000) };
  const rapido = await criarRemoto(rede, 'rapido.social', 'r');
  const statusLimite = [];
  for (let i = 0; i < 5; i++) statusLimite.push((await processInbox(apertado, requisicao(rapido, { atividade: follow(rapido, 'ana_silva', `https://rapido.social/f/${i}`), relogio: rel }))).status);
  confere('ENTRADA · limite por domínio: depois do teto → 429 com Retry-After', igual(statusLimite, [202, 202, 202, 429, 429]), JSON.stringify(statusLimite));

  // plataforma desligada / emergência
  teste.platform.enabled = false;
  r = await envia(requisicao(bia, { atividade: follow(bia, 'ana_silva', 'https://mastodon.social/f/off'), relogio: rel }));
  confere('ENTRADA · plataforma desligada → 404 como se a rota não existisse', r.status === 404, JSON.stringify(r));
  teste.platform.enabled = true;
  teste.platform.killSwitch = true;
  r = await envia(requisicao(bia, { atividade: follow(bia, 'ana_silva', 'https://mastodon.social/f/kill'), relogio: rel }));
  confere('ENTRADA · botão de emergência → 404', r.status === 404, JSON.stringify(r));
  teste.platform.killSwitch = false;

  confere('ENTRADA · a auditoria não guarda corpo de atividade nem conteúdo de terceiro',
    !JSON.stringify(teste.audit).includes('CONTEUDO-DA-DENUNCIA-XYZ') && teste.audit.every((e) => !('body' in e)), 'auditoria com conteúdo');
  confere('ENTRADA · a auditoria registra tipo, domínio e decisão', teste.audit.some((e) => e.kind === 'inbox' && e.type === 'Follow' && e.domain === 'mastodon.social' && e.decision === 'aceita'), 'sem registro');
}

function igual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// ═════════════ 4. Motor de entrega ═════════════

async function comSeguidores(opcoes = {}) {
  const ctx = montar(opcoes);
  const { deps, store, rede } = ctx;
  await enableFederation(deps, 'U_ANA', { emailVerified: true });
  const rel = { now: () => deps.now() };
  const remotos = {
    bia: await criarRemoto(rede, 'mastodon.social', 'bia'),
    caio: await criarRemoto(rede, 'mastodon.social', 'caio'),
    duda: await criarRemoto(rede, 'pleroma.exemplo.com.br', 'duda'),
  };
  for (const r of Object.values(remotos)) {
    const x = await processInbox(deps, requisicao(r, { atividade: follow(r, 'ana_silva'), relogio: rel }));
    if (x.reason !== 'aceita-follow') throw new Error(`seguidor ${r.usuario} não entrou: ${JSON.stringify(x)}`);
  }
  ctx.remotos = remotos;
  // esvazia os Accept: os testes de entrega querem começar do zero
  for (const d of [...ctx.teste.deliveries.values()]) if (d.op === 'accept') ctx.teste.deliveries.delete(d.id);
  return ctx;
}

const rodar = (ctx, over = {}) => runWorker(ctx.deps, { budgetMs: 10_000, maxJobs: 25, deliveryBatch: 8, ...over });

// Create público
{
  const ctx = await comSeguidores();
  const { deps, store, teste, rede, relogio } = ctx;
  relogio.t = deps.now() + 1000;
  const agora = deps.now();
  deps.now = () => relogio.t;
  teste.seedPost(post(relogio, { id: 'P1', createdAtMs: relogio.t }));
  await store.enqueueJob(tarefa(relogio, 'create', 'P1'));

  const stats = await rodar(ctx);
  const env = entregasDe(rede, (p) => !p.url.includes('/follows'));
  confere('ENTREGA · 3 seguidores em 2 servidores → 2 POSTs (o do mastodon.social é uma entrega só, no inbox compartilhado)', env.length === 2 && stats.sent === 2, `${env.length} POSTs, ${stats.sent} enviadas`);
  const alvos = env.map((e) => e.url).sort();
  confere('ENTREGA · destinos: o inbox COMPARTILHADO de cada servidor (todos os atores simulados anunciam um)', igual(alvos, ['https://mastodon.social/inbox', 'https://pleroma.exemplo.com.br/inbox'].sort()), JSON.stringify(alvos));
  const c = env[0].json;
  confere('ENTREGA · é um Create de Note do ator certo', c.type === 'Create' && c.actor === `${ORIGEM}/ap/users/ana_silva` && c.object.type === 'Note' && c.object.attributedTo === c.actor, JSON.stringify(c).slice(0, 120));
  confere('ENTREGA · alcance público: to=Public, cc=seguidores', c.to.includes(AS_PUBLIC) && c.cc.includes(`${ORIGEM}/ap/users/ana_silva/followers`) && igual(c.to, c.object.to), JSON.stringify({ to: c.to, cc: c.cc }));
  confere('ENTREGA · o conteúdo é HTML escapado com a hashtag em link', c.object.content.includes('olá mundo') && c.object.content.includes('rel="tag"'), c.object.content);
  confere('ENTREGA · o id do objeto é a URL canônica da nota', c.object.id === `${ORIGEM}/ap/notes/P1`, c.object.id);

  // cada entrega tem assinatura verificável pelo verificador REAL, com a chave pública do actor
  const publica = teste.handles.get('ana_silva').publicKeyPem;
  let todasValidas = true;
  for (const e of env) {
    const cab = signRequest({ method: 'POST', url: e.url, body: e.body, privateKeyPem: e.sign.privateKeyPem, keyId: e.sign.keyId, now: deps.now() });
    const u = new URL(e.url);
    const v = verifyHttpSignature({ method: 'POST', path: u.pathname, headers: cab, body: Buffer.from(e.body), now: deps.now() }, publica);
    if (!v.ok || e.sign.keyId !== `${ORIGEM}/ap/users/ana_silva#main-key`) todasValidas = false;
  }
  confere('ENTREGA · a chave usada assina de forma verificável com a PÚBLICA publicada no actor', todasValidas, 'assinatura não confere');
  confere('ENTREGA · o keyId é o do actor', env.every((e) => e.sign.keyId === `${ORIGEM}/ap/users/ana_silva#main-key`), JSON.stringify(env.map((e) => e.sign.keyId)));

  const objeto = await store.getObject('P1');
  confere('ENTREGA · o post fica registrado como federado', objeto?.state === 'federated' && objeto.scope === 'public', JSON.stringify(objeto));

  // idempotência: o mesmo pedido de novo não entrega de novo
  await store.enqueueJob({ ...tarefa(relogio, 'create', 'P1'), id: 'repetida' });
  const antes = rede.posts.length;
  await rodar(ctx);
  confere('ENTREGA · IDEMPOTENTE: o mesmo Create pedido duas vezes não entrega duas vezes', rede.posts.length === antes, `${rede.posts.length - antes} POSTs a mais`);
  confere('ENTREGA · e a tarefa repetida é pulada com motivo', teste.jobs.get('repetida').state === 'skipped' && teste.jobs.get('repetida').note === 'ja-federado', JSON.stringify(teste.jobs.get('repetida')));

  // Update
  relogio.t += 60_000;
  teste.patchPost('P1', { text: 'texto EDITADO', updatedAtMs: relogio.t });
  await store.enqueueJob(tarefa(relogio, 'update', 'P1'));
  const antesUp = rede.posts.length;
  await rodar(ctx);
  const ups = entregasDe(rede).slice(antesUp);
  confere('ENTREGA · edição → Update com `updated` e o texto novo', ups.length === 2 && ups[0].json.type === 'Update' && ups[0].json.object.content.includes('EDITADO') && Boolean(ups[0].json.object.updated), JSON.stringify(ups[0]?.json).slice(0, 120));

  // Delete
  relogio.t += 60_000;
  teste.patchPost('P1', { isDeleted: true });
  await store.enqueueJob(tarefa(relogio, 'delete', 'P1'));
  const antesDel = rede.posts.length;
  await rodar(ctx);
  const dels = entregasDe(rede).slice(antesDel);
  confere('ENTREGA · exclusão → Delete com Tombstone', dels.length === 2 && dels[0].json.type === 'Delete' && dels[0].json.object.type === 'Tombstone' && dels[0].json.object.id === `${ORIGEM}/ap/notes/P1`, JSON.stringify(dels[0]?.json).slice(0, 140));
  confere('ENTREGA · o registro passa a "apagado" (a URL da nota passa a dar 410)', (await store.getObject('P1')).state === 'deleted', 'não marcou');
  confere('ENTREGA · e a nota responde 410 depois', (await renderNote(deps, 'P1')).status === 410, 'ainda serve');
}

// O portão no momento do ENVIO
{
  const casos = [
    ['conta PAUSADA depois de enfileirar → cancela', async (c) => { await pauseFederation(c.deps, 'U_ANA'); }, 'conta-pausada'],
    ['conta DESLIGADA depois de enfileirar → cancela', async (c) => { await disableFederation(c.deps, 'U_ANA'); }, 'conta-nao-optou'],
    ['post virou PRIVADO depois de enfileirar → cancela', async (c) => { c.teste.patchPost('P1', { visibility: 'private' }); }, 'post-privado'],
    ['post voltou a ser LOCAL depois de enfileirar → cancela', async (c) => { c.teste.patchPost('P1', { federation: 'local' }); }, 'post-local'],
    ['post APAGADO antes do Create sair → cancela', async (c) => { c.teste.patchPost('P1', { isDeleted: true }); }, 'post-apagado'],
  ];
  for (const [nome, mexer, motivo] of casos) {
    const ctx = await comSeguidores();
    const { deps, store, teste, rede, relogio } = ctx;
    relogio.t = deps.now() + 1000;
    deps.now = () => relogio.t;
    teste.seedPost(post(relogio, { id: 'P1', createdAtMs: relogio.t }));
    await store.enqueueJob(tarefa(relogio, 'create', 'P1'));
    // expande SEM entregar: só a fase A (budget 0 impede o laço da fase B)
    await rodar(ctx, { budgetMs: 0 });
    const pendentes = [...teste.deliveries.values()].filter((d) => d.status === 'pending' && d.op === 'create').length;
    await mexer(ctx);
    if (nome.includes('DESLIGADA')) for (const j of [...teste.jobs.values()]) if (j.op === 'delete-actor') teste.jobs.delete(j.id);
    await rodar(ctx);
    const saiu = rede.posts.filter((p) => JSON.parse(p.body).type === 'Create').length;
    const canceladas = [...teste.deliveries.values()].filter((d) => d.status === 'cancelled' && d.lastDetail === motivo).length;
    confere(`PORTÃO NO ENVIO · ${nome}`, pendentes === 2 && saiu === 0 && canceladas === 2, `pendentes ${pendentes}, saiu ${saiu}, canceladas(${motivo}) ${canceladas}`);
  }

  // pausa e retomada: o que nasceu durante a pausa não sai
  {
    const ctx = await comSeguidores();
    const { deps, store, teste, rede, relogio } = ctx;
    relogio.t = deps.now() + 1000; deps.now = () => relogio.t;
    await pauseFederation(deps, 'U_ANA');
    relogio.t += 5000;
    teste.seedPost(post(relogio, { id: 'DURANTE', createdAtMs: relogio.t }));
    await store.enqueueJob(tarefa(relogio, 'create', 'DURANTE'));
    await rodar(ctx);
    confere('PORTÃO · tarefa criada com a conta pausada é pulada (nada entra na fila)', [...teste.deliveries.values()].filter((d) => d.op === 'create').length === 0 && rede.posts.length === 0, 'enfileirou durante a pausa');
    relogio.t += 5000;
    await resumeFederation(deps, 'U_ANA');
    await store.enqueueJob({ ...tarefa(relogio, 'create', 'DURANTE'), id: 'depois-de-retomar' });
    await rodar(ctx);
    confere('PORTÃO · RETOMAR não federa o que foi publicado durante a pausa', rede.posts.length === 0 && teste.jobs.get('depois-de-retomar').note === 'anterior-a-ativacao', JSON.stringify(teste.jobs.get('depois-de-retomar')));
    relogio.t += 5000;
    teste.seedPost(post(relogio, { id: 'DEPOIS', createdAtMs: relogio.t }));
    await store.enqueueJob(tarefa(relogio, 'create', 'DEPOIS'));
    await rodar(ctx);
    confere('PORTÃO · e o que nasce DEPOIS de retomar sai', entregasDe(rede).filter((e) => e.json.type === 'Create').length === 2, 'não saiu');
  }

  // alcances
  {
    const ctx = await comSeguidores();
    const { deps, store, teste, rede, relogio } = ctx;
    relogio.t = deps.now() + 1000; deps.now = () => relogio.t;
    teste.seedPost(post(relogio, { id: 'LOC', federation: 'local' }));
    teste.seedPost(post(relogio, { id: 'PRIV', visibility: 'private', federation: 'followers' }));
    teste.seedPost(post(relogio, { id: 'SEGX', visibility: 'followers', federation: 'public' }));
    teste.seedPost(post(relogio, { id: 'QUOTE', type: 'story' }));
    teste.seedPost(post(relogio, { id: 'ODD', category: 'outra' }));
    teste.seedPost(post(relogio, { id: 'POLL', hasPoll: true }));
    for (const id of ['LOC', 'PRIV', 'SEGX', 'QUOTE', 'ODD', 'POLL']) await store.enqueueJob(tarefa(relogio, 'create', id));
    await rodar(ctx);
    confere('ALCANCE · local, privado, público-sobre-só-seguidores, tipo e categoria desconhecidos e enquete: NENHUM sai', rede.posts.length === 0, `${rede.posts.length} POSTs saíram`);
    const motivos = [...teste.jobs.values()].map((j) => `${j.postId}:${j.note}`).sort();
    confere('ALCANCE · e cada um é pulado com o MOTIVO certo',
      igual(motivos, ['LOC:post-local', 'ODD:categoria-nao-suportada', 'POLL:enquete-nao-suportada', 'PRIV:post-privado', 'QUOTE:tipo-nao-suportado', 'SEGX:visibilidade-incompativel']), JSON.stringify(motivos));

    teste.seedPost(post(relogio, { id: 'UNL', federation: 'unlisted' }));
    teste.seedPost(post(relogio, { id: 'FOL', visibility: 'followers', federation: 'followers' }));
    await store.enqueueJob(tarefa(relogio, 'create', 'UNL'));
    await store.enqueueJob(tarefa(relogio, 'create', 'FOL'));
    await rodar(ctx);
    const por = (id) => entregasDe(rede, (p) => JSON.parse(p.body).object?.id?.endsWith(`/${id}`));
    const unl = por('UNL')[0]?.json; const fol = por('FOL')[0]?.json;
    confere('ALCANCE · não listado: to=seguidores, cc=Public', unl && unl.to.length === 1 && unl.to[0].endsWith('/followers') && unl.cc.includes(AS_PUBLIC), JSON.stringify({ to: unl?.to, cc: unl?.cc }));
    confere('ALCANCE · só-seguidores: o Público NÃO aparece em lugar nenhum', fol && !JSON.stringify(fol).includes(AS_PUBLIC) && fol.to[0].endsWith('/followers'), JSON.stringify({ to: fol?.to, cc: fol?.cc }));
    teste.seedPost(post(relogio, { id: 'NEWS', category: 'news' }));
    await store.enqueueJob(tarefa(relogio, 'create', 'NEWS'));
    await rodar(ctx);
    confere('ALCANCE · notícia (category "news") sai, como o post comum (permitido desde 85b7eb6)', por('NEWS').length > 0, 'a notícia não foi entregue');
  }

  // youtube e mídia
  {
    const ctx = await comSeguidores();
    const { deps, store, teste, rede, relogio } = ctx;
    relogio.t = deps.now() + 1000; deps.now = () => relogio.t;
    deps.mediaTypeOf = async (id) => (id === 'BBBBBBBBBBBBBBBBBBBBBB' ? 'image/webp' : null);
    teste.seedPost(post(relogio, {
      id: 'MID', text: 'com mídia', youtubeVideoId: 'dQw4w9WgXcQ',
      media: [
        { url: 'https://media.exercitodolula.app/m/BBBBBBBBBBBBBBBBBBBBBB', type: 'image', alt: 'uma foto' },
        { url: 'https://firebasestorage.googleapis.com/v0/b/x/o/user_uploads%2FUID%2Fa.jpg?alt=media&token=T', type: 'image', alt: null },
        { url: 'https://media.exercitodolula.app/m/CCCCCCCCCCCCCCCCCCCCCC', type: 'video', alt: null },
      ],
    }));
    await store.enqueueJob(tarefa(relogio, 'create', 'MID'));
    await rodar(ctx);
    const nota = entregasDe(rede)[0].json.object;
    confere('MÍDIA · só a mídia da NOSSA URL pública sai (a do Firebase, com UID no caminho, fica de fora)', nota.attachment.length === 2 && nota.attachment.every((a) => a.url.startsWith('https://media.exercitodolula.app/m/')), JSON.stringify(nota.attachment));
    confere('MÍDIA · o tipo MIME vem do registro da mídia, com padrão por tipo', nota.attachment[0].mediaType === 'image/webp' && nota.attachment[1].mediaType === 'video/mp4' && nota.attachment[0].name === 'uma foto', JSON.stringify(nota.attachment));
    confere('MÍDIA · o link do YouTube entra no texto', nota.content.includes('youtube.com/watch?v=dQw4w9WgXcQ'), nota.content);
    confere('MÍDIA · nada de firebasestorage no que sai', !JSON.stringify(entregasDe(rede)).includes('firebasestorage'), 'host do Storage vazou');
  }
}

// Falhas, backoff e disjuntor
{
  const ctx = await comSeguidores();
  const { deps, store, teste, rede, relogio } = ctx;
  relogio.t = deps.now() + 1000; deps.now = () => relogio.t;
  teste.seedPost(post(relogio, { id: 'P1', createdAtMs: relogio.t }));
  await store.enqueueJob(tarefa(relogio, 'create', 'P1'));

  rede.respostaPost = (url) => (url.includes('pleroma') ? { status: 503, unsafe: false } : { status: 202, unsafe: false });
  let s = await rodar(ctx);
  const porDominio = (d) => [...teste.deliveries.values()].find((x) => x.domain === d && x.op === 'create');
  confere('FALHA · 503 de um destino NÃO impede a entrega aos outros', s.sent === 1 && s.retried === 1, JSON.stringify(s));
  const pl = porDominio('pleroma.exemplo.com.br');
  confere('FALHA · 503 reagenda com espera (~1 min) e conta a tentativa', pl.status === 'pending' && pl.attempts === 1 && pl.nextAttemptAt > relogio.t + 40_000 && pl.nextAttemptAt < relogio.t + 80_000, JSON.stringify({ a: pl.attempts, em: pl.nextAttemptAt - relogio.t }));
  confere('FALHA · o corpo reenviado é IDÊNTICO (mesmos bytes, mesmo Digest)', rede.posts.filter((p) => p.url.includes('pleroma'))[0].body === pl.body, 'corpo mudou');

  // antes da hora: não tenta
  const antes = rede.posts.length;
  await rodar(ctx);
  confere('FALHA · antes do horário de reagendamento, NÃO tenta de novo', rede.posts.length === antes, `${rede.posts.length - antes} POSTs`);

  // percorre as 8 tentativas
  for (let i = 0; i < 20; i++) {
    relogio.t += 25 * 3600 * 1000;
    teste.health.clear();
    await rodar(ctx);
    if (porDominio('pleroma.exemplo.com.br').status !== 'pending') break;
  }
  const morto = porDominio('pleroma.exemplo.com.br');
  confere('FALHA · depois de 8 tentativas a entrega vira DEAD-LETTER, visível', morto.status === 'dead' && morto.attempts === 8 && /esgotadas/.test(morto.lastDetail), JSON.stringify({ s: morto.status, a: morto.attempts, d: morto.lastDetail }));
  confere('FALHA · e para de ser tentada', morto.nextAttemptAt === null, String(morto.nextAttemptAt));
  const q = await store.queueDepth();
  confere('FALHA · a contagem de mortas aparece na observabilidade', q.dead === 1, JSON.stringify(q));

  // retentar pela pessoa
  rede.respostaPost = () => ({ status: 202, unsafe: false });
  confere('FALHA · "tentar de novo" de entrega ALHEIA não revela nem age', (await retryDeliveryForUser(deps, 'U_BIA', morto.id)) === 'inexistente', 'agiu');
  confere('FALHA · "tentar de novo" de entrega que ainda está pendente é recusado', (await retryDeliveryForUser(deps, 'U_ANA', porDominio('mastodon.social').id)) === 'nao-permitido', 'aceitou');
  confere('FALHA · "tentar de novo" da própria entrega morta reagenda', (await retryDeliveryForUser(deps, 'U_ANA', morto.id)) === 'reagendada', 'recusou');
  await rodar(ctx);
  confere('FALHA · e ela é entregue', porDominio('pleroma.exemplo.com.br').status === 'sent', JSON.stringify(porDominio('pleroma.exemplo.com.br').status));
  const visao = await listDeliveriesForUser(deps, 'U_ANA');
  confere('FALHA · a visão para a pessoa não tem corpo nem URL de inbox', visao.length > 0 && visao.every((v) => !('body' in v) && !('targetInbox' in v)), JSON.stringify(visao[0]));
}

for (const [nome, status, vira] of [['404', 404, 'dead'], ['400', 400, 'dead'], ['410 (inbox sumiu)', 410, 'dead'], ['422', 422, 'dead']]) {
  const ctx = await comSeguidores();
  const { deps, store, teste, rede, relogio } = ctx;
  relogio.t = deps.now() + 1000; deps.now = () => relogio.t;
  teste.seedPost(post(relogio, { id: 'P1', createdAtMs: relogio.t }));
  await store.enqueueJob(tarefa(relogio, 'create', 'P1'));
  rede.respostaPost = () => ({ status, unsafe: false });
  await rodar(ctx);
  const ds = [...teste.deliveries.values()].filter((d) => d.op === 'create');
  confere(`FALHA · ${nome} é permanente: morre na 1ª tentativa, sem insistir`, ds.every((d) => d.status === vira && d.attempts === 1), JSON.stringify(ds.map((d) => [d.status, d.attempts])));
}

{
  const ctx = await comSeguidores();
  const { deps, store, teste, rede, relogio } = ctx;
  relogio.t = deps.now() + 1000; deps.now = () => relogio.t;
  teste.seedPost(post(relogio, { id: 'P1', createdAtMs: relogio.t }));
  await store.enqueueJob(tarefa(relogio, 'create', 'P1'));
  rede.respostaPost = () => ({ status: null, unsafe: true, errorDetail: 'destino recusado' });
  await rodar(ctx);
  const ds = [...teste.deliveries.values()].filter((d) => d.op === 'create');
  confere('FALHA · destino bloqueado pela guarda de SSRF: morre sem repetir', ds.every((d) => d.status === 'dead' && d.attempts === 1 && d.lastOutcome === 'unsafe'), JSON.stringify(ds.map((d) => [d.status, d.lastOutcome])));
}

{
  const ctx = await comSeguidores();
  const { deps, store, teste, rede, relogio } = ctx;
  relogio.t = deps.now() + 1000; deps.now = () => relogio.t;
  teste.seedPost(post(relogio, { id: 'P1', createdAtMs: relogio.t }));
  await store.enqueueJob(tarefa(relogio, 'create', 'P1'));
  rede.respostaPost = () => ({ status: 429, unsafe: false, retryAfter: '7200' });
  await rodar(ctx);
  const d = [...teste.deliveries.values()].find((x) => x.op === 'create' && x.status === 'pending');
  confere('FALHA · 429 com Retry-After de 2 h: a espera é de pelo menos 2 h', d && d.nextAttemptAt - relogio.t >= 7200 * 1000, d ? String((d.nextAttemptAt - relogio.t) / 1000) : 'sem entrega pendente');
}

{
  // disjuntor: depois de falhas seguidas num domínio, as outras entregas dele esperam
  const ctx = await comSeguidores();
  const { deps, store, teste, rede, relogio } = ctx;
  relogio.t = deps.now() + 1000; deps.now = () => relogio.t;
  rede.respostaPost = () => ({ status: 503, unsafe: false });
  for (let i = 1; i <= 4; i++) {
    teste.seedPost(post(relogio, { id: `P${i}`, createdAtMs: relogio.t }));
    await store.enqueueJob({ ...tarefa(relogio, 'create', `P${i}`), id: `j${i}` });
  }
  await rodar(ctx);
  const h = await store.getDomainHealth('pleroma.exemplo.com.br');
  confere('DISJUNTOR · falhas seguidas num domínio abrem o disjuntor', h && h.consecutiveFailures >= 3 && h.cooldownUntilMs > relogio.t, JSON.stringify(h));
  const tentativasPleroma = rede.posts.filter((p) => p.url.includes('pleroma')).length;
  confere('DISJUNTOR · e o domínio não é martelado: menos POSTs que entregas', tentativasPleroma < 4, `${tentativasPleroma} POSTs para 4 entregas`);
  const adiadas = [...teste.deliveries.values()].filter((d) => d.domain === 'pleroma.exemplo.com.br' && d.attempts === 0);
  confere('DISJUNTOR · as adiadas NÃO gastam tentativa', adiadas.length >= 1 && adiadas.every((d) => d.nextAttemptAt >= h.cooldownUntilMs), JSON.stringify(adiadas.map((d) => d.attempts)));
  rede.respostaPost = () => ({ status: 202, unsafe: false });
  relogio.t = h.cooldownUntilMs + 1000;
  await rodar(ctx);
  const h2 = await store.getDomainHealth('pleroma.exemplo.com.br');
  confere('DISJUNTOR · o primeiro sucesso zera o contador', h2.consecutiveFailures === 0, JSON.stringify(h2));
}

// Plataforma desligada: nada sai, e a fila é PRESERVADA
{
  const ctx = await comSeguidores();
  const { deps, store, teste, rede, relogio } = ctx;
  relogio.t = deps.now() + 1000; deps.now = () => relogio.t;
  teste.seedPost(post(relogio, { id: 'P1', createdAtMs: relogio.t }));
  await store.enqueueJob(tarefa(relogio, 'create', 'P1'));
  await rodar(ctx, { budgetMs: 0 });
  const depois = [...teste.deliveries.values()].filter((d) => d.status === 'pending').length;
  teste.platform.killSwitch = true;
  const s = await rodar(ctx);
  confere('EMERGÊNCIA · botão acionado: o worker não envia NADA', rede.posts.length === 0 && s.sent === 0 && s.jobs === 0, JSON.stringify(s));
  confere('EMERGÊNCIA · e a fila fica como estava (não é descartada)', [...teste.deliveries.values()].filter((d) => d.status === 'pending').length === depois && depois > 0, `${depois} pendentes`);
  teste.platform.killSwitch = false;
  await rodar(ctx);
  confere('EMERGÊNCIA · ao desacionar, a fila segue e entrega', rede.posts.length > 0, 'não retomou');
}

// Invariante: plataforma desligada ⇒ nenhum POST, em QUALQUER combinação de estados
{
  let violacoes = 0; let combos = 0;
  for (const kill of [true, false]) for (const enabled of [true, false]) for (const paused of [true, false]) for (const op of ['create', 'update', 'delete']) {
    if (enabled && !kill) continue; // só os casos de plataforma desligada
    combos++;
    const ctx = await comSeguidores();
    const { deps, store, teste, rede, relogio } = ctx;
    relogio.t = deps.now() + 1000; deps.now = () => relogio.t;
    teste.seedPost(post(relogio, { id: 'P1', createdAtMs: relogio.t }));
    await store.putObject({ postId: 'P1', uid: 'U_ANA', objectId: `${ORIGEM}/ap/notes/P1`, scope: 'public', createdAtMs: relogio.t, state: 'federated', lastActivityAtMs: relogio.t });
    if (paused) await pauseFederation(deps, 'U_ANA');
    teste.platform.enabled = enabled; teste.platform.killSwitch = kill;
    await store.enqueueJob(tarefa(relogio, op, 'P1'));
    await rodar(ctx);
    if (rede.posts.length > 0) violacoes++;
  }
  confere(`INVARIANTE · plataforma desligada ⇒ NENHUM POST, em ${combos} combinações (create/update/delete × pausa × desligada/emergência)`, violacoes === 0, `${violacoes} violações`);
}

// Apagar vale com a conta pausada ou desligada
{
  for (const [nome, acao] of [['pausada', (c) => pauseFederation(c.deps, 'U_ANA')], ['desligada', (c) => disableFederation(c.deps, 'U_ANA')]]) {
    const ctx = await comSeguidores();
    const { deps, store, teste, rede, relogio } = ctx;
    relogio.t = deps.now() + 1000; deps.now = () => relogio.t;
    teste.seedPost(post(relogio, { id: 'P1', createdAtMs: relogio.t }));
    await store.enqueueJob(tarefa(relogio, 'create', 'P1'));
    await rodar(ctx);
    const aposCreate = rede.posts.length;
    await acao(ctx);
    for (const j of [...teste.jobs.values()]) if (j.op === 'delete-actor') teste.jobs.delete(j.id);
    teste.patchPost('P1', { isDeleted: true });
    await store.enqueueJob({ ...tarefa(relogio, 'delete', 'P1'), id: 'apagar' });
    await rodar(ctx);
    const deletes = entregasDe(rede).slice(aposCreate).filter((e) => e.json.type === 'Delete');
    confere(`APAGAR · com a conta ${nome}, o Delete de algo que JÁ saiu ainda é entregue`, deletes.length === 2, `${deletes.length} Deletes`);
  }
}

// Desligar a conta: Delete do ator
{
  const ctx = await comSeguidores();
  const { deps, store, teste, rede, relogio } = ctx;
  relogio.t = deps.now() + 1000; deps.now = () => relogio.t;
  // a pessoa tinha publicado e bloqueado alguém antes de sair
  await store.putObject({ postId: 'ANTIGO', uid: 'U_ANA', objectId: `${ORIGEM}/ap/notes/ANTIGO`, scope: 'public', createdAtMs: relogio.t, state: 'federated', lastActivityAtMs: relogio.t });
  await store.addUserBlock('U_ANA', { scope: 'domain', value: 'ruim.org' });
  await disableFederation(deps, 'U_ANA');
  await rodar(ctx);
  const atores = entregasDe(rede).filter((e) => e.json.type === 'Delete');
  confere('DESLIGAR · cada servidor recebe o Delete do ator (2 destinos)', atores.length === 2 && atores.every((e) => e.json.object === `${ORIGEM}/ap/users/ana_silva`), JSON.stringify(atores.map((a) => a.url)));
  confere('DESLIGAR · e os vínculos de seguidor são removidos', (await store.countFollowers('U_ANA')) === 0, String(await store.countFollowers('U_ANA')));
  confere('DESLIGAR · e nada mais da pessoa fica na federação: objetos, outbox e bloqueios (LGPD)',
    ![...teste.objects.values()].some((o) => o.uid === 'U_ANA') && (await store.listUserBlocks('U_ANA')).length === 0 && (await store.countPublicObjects('U_ANA')) === 0,
    JSON.stringify({ objetos: [...teste.objects.keys()], bloqueios: await store.listUserBlocks('U_ANA') }));
  confere('DESLIGAR · a chave continua para quem queira religar', teste.keys.has('U_ANA'), 'chave destruída');
}

// Conta apagada: a chave morre depois do prazo
{
  const ctx = await comSeguidores();
  const { deps, store, teste, rede, relogio } = ctx;
  relogio.t = deps.now() + 1000; deps.now = () => relogio.t;
  await markAccountDeleted(deps, 'U_ANA');
  confere('CONTA APAGADA · o handle fica "deleting" e NUNCA mais é reativável', teste.handles.get('ana_silva').state === 'deleting', JSON.stringify(teste.handles.get('ana_silva')));
  const tentativa = await enableFederation(deps, 'U_ANA', { emailVerified: true });
  confere('CONTA APAGADA · religar é recusado', !tentativa.ok && tentativa.reason === 'conta-removida', JSON.stringify(tentativa));
  await rodar(ctx);
  confere('CONTA APAGADA · o Delete do ator sai para os seguidores', entregasDe(rede).filter((e) => e.json.type === 'Delete').length === 2, 'não saiu');
  confere('CONTA APAGADA · e a chave AINDA existe (precisa assinar as reentregas)', teste.keys.has('U_ANA'), 'destruída cedo');
  relogio.t += 4 * 24 * 3600 * 1000;
  const s = await rodar(ctx);
  confere('CONTA APAGADA · passado o prazo (3 dias), a chave é DESTRUÍDA', !teste.keys.has('U_ANA') && s.keysDestroyed === 1, JSON.stringify(s));
  confere('CONTA APAGADA · o handle continua reservado como "deleted"', teste.handles.get('ana_silva').state === 'deleted', JSON.stringify(teste.handles.get('ana_silva')));
  confere('CONTA APAGADA · o actor responde 410 (nunca 200)', (await renderActor(deps, 'ana_silva')).status === 410, 'ainda serve');
}

// Concorrência: duas execuções do worker ao mesmo tempo não duplicam
{
  const ctx = await comSeguidores();
  const { deps, store, teste, rede, relogio } = ctx;
  relogio.t = deps.now() + 1000; deps.now = () => relogio.t;
  teste.seedPost(post(relogio, { id: 'P1', createdAtMs: relogio.t }));
  await store.enqueueJob(tarefa(relogio, 'create', 'P1'));
  await Promise.all([rodar(ctx), rodar(ctx), rodar(ctx)]);
  confere('CONCORRÊNCIA · 3 execuções simultâneas do worker entregam cada destino UMA vez', rede.posts.length === 2, `${rede.posts.length} POSTs`);
}

// Retomada depois de queda no meio da expansão
{
  const ctx = await comSeguidores();
  const { deps, store, teste, rede, relogio } = ctx;
  relogio.t = deps.now() + 1000; deps.now = () => relogio.t;
  teste.seedPost(post(relogio, { id: 'P1', createdAtMs: relogio.t }));
  await store.enqueueJob(tarefa(relogio, 'create', 'P1'));
  const original = store.putObject;
  let caiu = false;
  store.putObject = async (r) => { if (!caiu) { caiu = true; throw new Error('queda simulada'); } return original(r); };
  await rodar(ctx, { budgetMs: 0 });
  confere('RETOMADA · a queda deixou entregas criadas mas o post SEM marca de federado', caiu && teste.deliveries.size === 2 && !(await store.getObject('P1')), `${teste.deliveries.size} entregas`);
  teste.expirarPosse();
  relogio.t += 120_000;
  await rodar(ctx);
  confere('RETOMADA · a tarefa é refeita depois da queda, SEM duplicar as entregas', [...teste.deliveries.values()].filter((d) => d.op === 'create').length === 2, `${teste.deliveries.size} entregas`);
  confere('RETOMADA · e o post passa a federado', (await store.getObject('P1'))?.state === 'federated', 'sem marca');
  confere('RETOMADA · cada destino recebeu UMA vez', rede.posts.length === 2, `${rede.posts.length} POSTs`);
}

// Accept: sai para quem ainda segue, e NÃO sai para quem desfez antes
{
  const ctx = montar();
  const { deps, store, teste, rede } = ctx;
  await enableFederation(deps, 'U_ANA', { emailVerified: true });
  const rel = { now: () => deps.now() };
  const bia = await criarRemoto(rede, 'mastodon.social', 'bia');
  const caio = await criarRemoto(rede, 'mastodon.social', 'caio');
  await processInbox(deps, requisicao(bia, { atividade: follow(bia, 'ana_silva'), relogio: rel }));
  await processInbox(deps, requisicao(caio, { atividade: follow(caio, 'ana_silva'), relogio: rel }));
  // o caio desfaz ANTES de o Accept dele sair
  await processInbox(deps, requisicao(caio, {
    atividade: { id: 'https://mastodon.social/undo/caio', type: 'Undo', actor: caio.id, object: follow(caio, 'ana_silva') }, relogio: rel,
  }));
  await rodar(ctx);
  const aceites = entregasDe(rede).filter((e) => e.json.type === 'Accept');
  confere('ACCEPT · sai para quem ainda segue, no inbox compartilhado, com o Follow embutido',
    aceites.length === 1 && aceites[0].url === bia.sharedInbox && aceites[0].json.object.actor === bia.id && aceites[0].json.object.id === follow(bia, 'ana_silva').id,
    JSON.stringify(aceites.map((a) => [a.url, a.json.object?.actor])));
  confere('ACCEPT · é assinado com a chave do actor local',
    aceites[0]?.sign.keyId === `${ORIGEM}/ap/users/ana_silva#main-key` && aceites[0].json.actor === `${ORIGEM}/ap/users/ana_silva`, JSON.stringify(aceites[0]?.sign.keyId));
  const doCaio = [...teste.deliveries.values()].find((d) => d.op === 'accept' && JSON.parse(d.body).object.actor === caio.id);
  confere('ACCEPT · NÃO sai para quem desfez o Follow antes (seria responder a quem já foi embora)',
    doCaio?.status === 'cancelled' && doCaio.lastDetail === 'seguidor-desfeito', JSON.stringify([doCaio?.status, doCaio?.lastDetail]));
  confere('ACCEPT · e a conta pausada não responde a ninguém',
    await (async () => {
      const lara = await criarRemoto(rede, 'lara.social', 'lara');
      await processInbox(deps, requisicao(lara, { atividade: follow(lara, 'ana_silva'), relogio: rel }));
      await pauseFederation(deps, 'U_ANA');
      const antes = rede.posts.length;
      await rodar(ctx);
      const d = [...teste.deliveries.values()].find((x) => x.op === 'accept' && JSON.parse(x.body).object.actor === lara.id);
      return rede.posts.length === antes && d?.status === 'cancelled' && d.lastDetail === 'conta-inativa';
    })(), 'o Accept saiu com a conta pausada');
}

// A política da instância muda DEPOIS de a entrega ser criada
{
  const ctx = await comSeguidores();
  const { deps, store, teste, rede, relogio } = ctx;
  relogio.t = deps.now() + 1000; deps.now = () => relogio.t;
  teste.seedPost(post(relogio, { id: 'P1', createdAtMs: relogio.t }));
  await store.enqueueJob(tarefa(relogio, 'create', 'P1'));
  await rodar(ctx, { budgetMs: 0 }); // só expande
  teste.setPolicy({ mode: 'open', rules: { 'pleroma.exemplo.com.br': { action: 'suspend' } } });
  await rodar(ctx);
  const pl = [...teste.deliveries.values()].find((d) => d.op === 'create' && d.domain === 'pleroma.exemplo.com.br');
  const ma = [...teste.deliveries.values()].find((d) => d.op === 'create' && d.domain === 'mastodon.social');
  confere('POLÍTICA NO ENVIO · instância suspensa DEPOIS de enfileirar → a entrega é cancelada, não enviada',
    pl.status === 'cancelled' && pl.lastDetail === 'dominio-recusado' && !rede.posts.some((p) => p.url.includes('pleroma')), JSON.stringify([pl.status, pl.lastDetail]));
  confere('POLÍTICA NO ENVIO · e as demais instâncias seguem normalmente', ma.status === 'sent', ma.status);
}

// Busca de acct (para seguir alguém do Fediverso)
{
  const { deps, rede, teste } = montar();
  const luna = await criarRemoto(rede, 'fedi.exemplo.com.br', 'luna');
  rede.atores.set('https://fedi.exemplo.com.br/.well-known/webfinger?resource=acct%3Aluna%40fedi.exemplo.com.br', () => ({
    status: 200, json: { subject: 'acct:luna@fedi.exemplo.com.br', links: [{ rel: 'self', type: 'application/activity+json', href: luna.id }] },
  }));
  let r = await lookupAcct(deps, '@luna@fedi.exemplo.com.br');
  confere('BUSCA · acct → WebFinger → ator validado', r.ok && r.actor.handle === 'luna@fedi.exemplo.com.br' && r.actor.inbox === luna.inbox, JSON.stringify(r).slice(0, 100));
  for (const ruim of ['luna', 'luna@127.0.0.1', 'luna@localhost', '@@x', '', 'luna@fedi.exemplo.com.br:8080']) {
    const getsAntes = rede.gets.length;
    const x = await lookupAcct(deps, ruim);
    confere(`BUSCA · acct inválido "${ruim}" é recusado SEM rede`, !x.ok && rede.gets.length === getsAntes, JSON.stringify(x));
  }
  teste.setPolicy({ mode: 'open', rules: { 'fedi.exemplo.com.br': { action: 'suspend' } } });
  const getsAntes = rede.gets.length;
  r = await lookupAcct(deps, '@luna@fedi.exemplo.com.br');
  confere('BUSCA · instância suspensa: recusa SEM rede', !r.ok && r.reason === 'dominio-recusado' && rede.gets.length === getsAntes, JSON.stringify(r));
}

console.log('');
console.log(`${total} verificações.`);
if (falhas) {
  console.log(`${falhas} falha(s).`);
  process.exit(1);
}
console.log('Serviços da federação OK: entrada hostil recusada, portão no envio, idempotência e retomada.');
