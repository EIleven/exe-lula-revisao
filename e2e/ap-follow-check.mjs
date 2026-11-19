#!/usr/bin/env node
/**
 * Seguir perfil do Fediverso: aberto, FECHADO (pedido pendente, bilhete cordial, Accept/Reject) e sair sempre possível.
 *   node e2e/ap-follow-check.mjs        (ou: npm run e2e:ap-seguir)
 * Núcleo: src/lib/activitypub/outboundFollow.ts (sem banco nem rede: tudo injetado) + o adaptador do Firestore (banco de mentira).
 * Sai com código 1 se algo falhar.
 */
import { readFileSync } from 'node:fs';
import { buildDirectCreate, AS_PUBLIC } from '../src/lib/activitypub/activity.ts';
import { createFirestoreStore } from '../src/lib/activitypub/firestoreStore.ts';
import { remoteFollowDocIdOf, remoteUserIdOf } from '../src/lib/activitypub/remoteIdentity.ts';
import { FOLLOW_NOTE_MAX, followRemote, normalizeFollowNote, unfollowRemote, viewOfFollow } from '../src/lib/activitypub/outboundFollow.ts';

let falhas = 0;
let total = 0;
const confere = (nome, condicao, motivo) => {
  total++;
  if (condicao) console.log(`OK    ${nome}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo ?? 'condição falsa'}`); }
};

const ORIGEM = 'https://exercitodolula.app';
const EU = { uid: 'u1', handle: 'ana' };
const ALVO = (extra = {}) => ({
  actorId: 'https://libranet.de/users/marcelo', handle: 'marcelo@libranet.de', domain: 'libranet.de', name: 'Marcelo', iconUrl: null,
  url: 'https://libranet.de/@marcelo', inbox: 'https://libranet.de/users/marcelo/inbox', sharedInbox: 'https://libranet.de/inbox', manuallyApprovesFollowers: false, ...extra,
});

/** Um mundo de mentira: registros, arestas e entregas ficam à vista para conferir. */
function mundo({ entrega = () => ({ ok: true, status: 202 }) } = {}) {
  const w = { registros: new Map(), arestas: new Set(), enviados: [], materializados: 0, t: 1_700_000_000_000 };
  w.deps = {
    now: () => (w.t += 1),
    origin: ORIGEM,
    local: EU,
    getFollow: async (uid, h) => w.registros.get(`${uid}/${h}`) ?? null,
    saveFollow: async (uid, h, r) => { w.registros.set(`${uid}/${h}`, JSON.parse(JSON.stringify(r))); },
    deleteFollow: async (uid, h) => { w.registros.delete(`${uid}/${h}`); },
    saveEdges: async (uid, ru) => { w.arestas.add(`${uid}>${ru}`); },
    deleteEdges: async (uid, ru) => { w.arestas.delete(`${uid}>${ru}`); },
    deliver: async (inbox, activity) => { w.enviados.push({ inbox, activity }); return entrega(inbox, activity, w.enviados.length); },
    materialize: async () => { w.materializados++; },
    nonce: () => 'n0nce',
  };
  return w;
}
const chave = (alvo) => `${EU.uid}/${remoteFollowDocIdOf(alvo.actorId)}`;
const aresta = (alvo) => `${EU.uid}>${remoteUserIdOf(alvo.actorId)}`;

// ───────── estado que a pessoa vê ─────────
confere('ESTADO · sem registro → none; pendente → requested; aceito → following; registro antigo (sem status) → following',
  viewOfFollow(null) === 'none' && viewOfFollow(undefined) === 'none' && viewOfFollow({ status: 'pending' }) === 'requested' && viewOfFollow({ status: 'accepted' }) === 'following' && viewOfFollow({}) === 'following', '');

// ───────── perfil ABERTO ─────────
{
  const w = mundo(); const alvo = ALVO();
  const r = await followRemote(w.deps, alvo);
  const reg = w.registros.get(chave(alvo));
  confere('ABERTO · segue: 200, view "following", sem pedido', r.status === 200 && r.body.view === 'following' && r.body.following === true && r.body.requested === false && r.body.closed === false, JSON.stringify(r.body));
  confere('ABERTO · UM Follow entregue na caixa de entrada do perfil, assinado como o ator daqui', w.enviados.length === 1 && w.enviados[0].inbox === alvo.inbox && w.enviados[0].activity.type === 'Follow' && w.enviados[0].activity.actor === `${ORIGEM}/ap/users/ana` && w.enviados[0].activity.object === alvo.actorId, JSON.stringify(w.enviados[0]?.activity));
  confere('ABERTO · registro sem status (o Accept confirma depois) e as arestas gravadas na hora', !!reg && reg.status === undefined && reg.manuallyApprovesFollowers === false && w.arestas.has(aresta(alvo)), JSON.stringify(reg));
  confere('ABERTO · o perfil é materializado', w.materializados === 1, String(w.materializados));
}
{
  const w = mundo(); const alvo = ALVO();
  const r = await followRemote(w.deps, alvo, { note: 'Oi! Me aceita?' });
  confere('ABERTO · bilhete é IGNORADO (ninguém recebe mensagem de quem não precisa aprovar)', r.body.noteSent === false && w.enviados.length === 1, `${r.body.noteSent} ${w.enviados.length}`);
}

// ───────── perfil FECHADO ─────────
{
  const w = mundo(); const alvo = ALVO({ manuallyApprovesFollowers: true });
  const r = await followRemote(w.deps, alvo);
  const reg = w.registros.get(chave(alvo));
  confere('FECHADO · pede: 200, view "requested" (NÃO "following"), closed', r.status === 200 && r.body.view === 'requested' && r.body.following === false && r.body.requested === true && r.body.closed === true, JSON.stringify(r.body));
  confere('FECHADO · registro PENDENTE com a data do pedido', !!reg && reg.status === 'pending' && typeof reg.requestedAtMs === 'number' && reg.manuallyApprovesFollowers === true, JSON.stringify(reg));
  confere('FECHADO · NENHUMA aresta até o Accept (feed e contadores andam pelas arestas)', w.arestas.size === 0, [...w.arestas].join(','));
  confere('FECHADO · só o Follow vai (sem bilhete quando a pessoa não escreveu)', w.enviados.length === 1 && w.enviados[0].activity.type === 'Follow' && r.body.noteSent === false, String(w.enviados.length));
}
{
  const w = mundo(); const alvo = ALVO({ manuallyApprovesFollowers: true });
  const r = await followRemote(w.deps, alvo, { note: 'Olá <b>Marcelo</b>! Sou a @ana do Exe. Lula.\nPosso te seguir?' });
  const bil = w.enviados[1]?.activity;
  confere('BILHETE · pedido + bilhete: duas entregas, o Follow primeiro', w.enviados.length === 2 && w.enviados[0].activity.type === 'Follow' && bil?.type === 'Create', w.enviados.map((e) => e.activity.type).join(','));
  confere('BILHETE · endereçado SÓ ao perfil: sem Public, sem seguidores, `directMessage`', bil && JSON.stringify(bil.to) === JSON.stringify([alvo.actorId]) && JSON.stringify(bil.cc) === '[]' && !JSON.stringify([bil.to, bil.cc, bil.object.to, bil.object.cc]).includes(AS_PUBLIC) && bil.directMessage === true && bil.object.directMessage === true, JSON.stringify([bil?.to, bil?.cc]));
  confere('BILHETE · tem a menção ao perfil (é o que o torna mensagem direta) e o texto vem ESCAPADO', bil && bil.object.tag?.[0]?.type === 'Mention' && bil.object.tag[0].href === alvo.actorId && bil.object.tag[0].name === '@marcelo@libranet.de' && bil.object.content.includes('&lt;b&gt;Marcelo&lt;/b&gt;') && !bil.object.content.includes('<b>') && bil.object.content.includes('<br />'), bil?.object?.content);
  confere('BILHETE · ids próprios do nosso ator e `noteSent` true com a data gravada', bil && bil.id.startsWith(`${ORIGEM}/ap/users/ana/activities/create-pedido-`) && bil.object.attributedTo === `${ORIGEM}/ap/users/ana` && r.body.noteSent === true && typeof w.registros.get(chave(alvo)).noteSentAtMs === 'number', JSON.stringify(r.body));
}
{
  let n = 0;
  const w = mundo({ entrega: () => (++n === 1 ? { ok: true, status: 202 } : { ok: false, status: 500 }) }); const alvo = ALVO({ manuallyApprovesFollowers: true });
  const r = await followRemote(w.deps, alvo, { note: 'Oi!' });
  confere('BILHETE · se o bilhete falha o PEDIDO já foi: 200, requested, noteSent false', r.status === 200 && r.body.view === 'requested' && r.body.noteSent === false && w.registros.get(chave(alvo)).status === 'pending', JSON.stringify(r.body));
}
{
  let n = 0;
  const w = mundo({ entrega: () => { if (++n === 2) throw new Error('rede'); return { ok: true, status: 202 }; } }); const alvo = ALVO({ manuallyApprovesFollowers: true });
  const r = await followRemote(w.deps, alvo, { note: 'Oi!' });
  confere('BILHETE · se o envio do bilhete LANÇA erro, o pedido continua valendo', r.status === 200 && r.body.view === 'requested' && r.body.noteSent === false, JSON.stringify(r.body));
}

// ───────── o texto do bilhete ─────────
confere('TEXTO · vazio, só espaços, não-texto → sem bilhete', normalizeFollowNote('') === null && normalizeFollowNote('   \n  ') === null && normalizeFollowNote(null) === null && normalizeFollowNote(42) === null && normalizeFollowNote({}) === null, '');
confere('TEXTO · tira caracteres de controle e os invisíveis que disfarçam texto (RTL, zero-width)', normalizeFollowNote('a\u0000b\u0007c‮d​e') === 'abcde', JSON.stringify(normalizeFollowNote('a\u0000b\u0007c‮d​e')));
confere('TEXTO · quebra de linha preservada, excesso de linhas em branco vira uma só', normalizeFollowNote('oi\r\n\r\n\r\n\r\nola') === 'oi\n\nola', JSON.stringify(normalizeFollowNote('oi\r\n\r\n\r\n\r\nola')));
confere(`TEXTO · no máximo ${FOLLOW_NOTE_MAX} caracteres (conta emoji como um)`, Array.from(normalizeFollowNote('x'.repeat(2000))).length === FOLLOW_NOTE_MAX && Array.from(normalizeFollowNote('😀'.repeat(600))).length === FOLLOW_NOTE_MAX, '');
{
  const d = buildDirectCreate({ id: 'i', noteId: 'n', actorId: 'a', targetActorId: 't', mentionHandle: 'u@h.test', text: 'x <i>y</i> & "z"\nlinha', publishedIso: '2026-01-01T00:00:00.000Z' });
  confere('CONSTRUTOR · mensagem direta: `to` só o destino, `cc` vazio, escapa HTML e aspas, linha nova vira <br />', JSON.stringify(d.to) === '["t"]' && JSON.stringify(d.cc) === '[]' && d.object.content.includes('&lt;i&gt;y&lt;/i&gt; &amp; &quot;z&quot;<br />linha') && d.object.tag[0].name === '@u@h.test', d.object.content);
}

// ───────── falhas de entrega e dados que faltam ─────────
{
  const w = mundo({ entrega: () => ({ ok: false, status: 503 }) }); const alvo = ALVO({ manuallyApprovesFollowers: true });
  const r = await followRemote(w.deps, alvo, { note: 'Oi!' });
  confere('ENTREGA · se o Follow não é entregue: 502 e NADA muda aqui (sem registro, sem aresta, sem bilhete)', r.status === 502 && r.body.error === 'falha-entrega-remota' && r.body.status === 503 && w.registros.size === 0 && w.arestas.size === 0 && w.enviados.length === 1, JSON.stringify(r));
}
{
  const w = mundo(); const alvo = ALVO({ inbox: null, sharedInbox: null });
  const r = await followRemote(w.deps, alvo);
  confere('ENTREGA · sem caixa de entrada: 422 e nada gravado nem enviado', r.status === 422 && r.body.error === 'inbox-remoto-indisponivel' && w.registros.size === 0 && w.enviados.length === 0, JSON.stringify(r));
}
{
  const w = mundo(); const alvo = ALVO({ inbox: null });
  await followRemote(w.deps, alvo);
  confere('ENTREGA · sem `inbox` usa a caixa de entrada compartilhada', w.enviados[0]?.inbox === alvo.sharedInbox, String(w.enviados[0]?.inbox));
}

// ───────── idempotência: nada de Follow repetido ─────────
{
  const w = mundo(); const alvo = ALVO({ manuallyApprovesFollowers: true });
  await followRemote(w.deps, alvo);
  const antes = w.enviados.length;
  const r = await followRemote(w.deps, alvo, { note: 'de novo' });
  confere('IDEMPOTENTE · pedir de novo com pedido pendente: "requested", já estava, NADA é enviado', r.body.view === 'requested' && r.body.already === true && w.enviados.length === antes, `${JSON.stringify(r.body)} envios=${w.enviados.length}`);
}
{
  const w = mundo(); const alvo = ALVO();
  w.registros.set(chave(alvo), { ...alvo, followActivityId: 'x', createdAtMs: 1, status: 'accepted' });
  const r = await followRemote(w.deps, alvo);
  confere('IDEMPOTENTE · já segue (aceito): "following", já estava, nada enviado', r.body.view === 'following' && r.body.already === true && w.enviados.length === 0, JSON.stringify(r.body));
  const w2 = mundo();
  w2.registros.set(chave(alvo), { ...alvo, followActivityId: 'x', createdAtMs: 1 });
  const r2 = await followRemote(w2.deps, alvo);
  confere('IDEMPOTENTE · registro antigo (sem status) conta como seguindo', r2.body.view === 'following' && w2.enviados.length === 0, JSON.stringify(r2.body));
}

// ───────── sair: deixar de seguir e cancelar o pedido ─────────
{
  const w = mundo(); const alvo = ALVO();
  await followRemote(w.deps, alvo);
  const idDoFollow = w.registros.get(chave(alvo)).followActivityId;
  w.enviados.length = 0;
  const r = await unfollowRemote(w.deps, { actorId: alvo.actorId, handle: alvo.handle, inbox: alvo.inbox });
  const undo = w.enviados[0]?.activity;
  confere('SAIR · deixa de seguir: limpa registro e arestas, view "none"', r.status === 200 && r.body.view === 'none' && r.body.following === false && r.body.requested === false && !w.registros.has(chave(alvo)) && !w.arestas.has(aresta(alvo)), JSON.stringify(r.body));
  confere('SAIR · avisa com Undo(Follow) referindo o Follow ORIGINAL', undo?.type === 'Undo' && undo.object.type === 'Follow' && undo.object.id === idDoFollow && undo.object.object === alvo.actorId && undo.actor === `${ORIGEM}/ap/users/ana` && r.body.remote === 'sent', JSON.stringify(undo));
}
{
  const w = mundo(); const alvo = ALVO({ manuallyApprovesFollowers: true });
  await followRemote(w.deps, alvo);
  w.enviados.length = 0;
  const r = await unfollowRemote(w.deps, { actorId: alvo.actorId, handle: alvo.handle, inbox: alvo.inbox });
  confere('CANCELAR · cancela o pedido pendente: registro apagado, Undo enviado, view "none"', r.body.view === 'none' && !w.registros.has(chave(alvo)) && w.enviados.length === 1 && w.enviados[0].activity.type === 'Undo' && r.body.closed === true, JSON.stringify(r.body));
}
for (const [nome, entrega, esperado] of [['servidor responde erro', () => ({ ok: false, status: 502 }), 'failed'], ['servidor fora do ar (lança)', () => { throw new Error('ECONNREFUSED'); }, 'failed']]) {
  const w = mundo({ entrega: (_i, a) => (a.type === 'Follow' ? { ok: true, status: 202 } : entrega()) }); const alvo = ALVO();
  await followRemote(w.deps, alvo);
  const r = await unfollowRemote(w.deps, { actorId: alvo.actorId, handle: alvo.handle, inbox: alvo.inbox });
  confere(`SAIR · ${nome}: a pessoa SAI do mesmo jeito (limpo aqui), e o aviso falho é dito (remote: ${esperado})`, r.status === 200 && r.body.view === 'none' && r.body.remote === esperado && !w.registros.has(chave(alvo)) && !w.arestas.has(aresta(alvo)), JSON.stringify(r.body));
}
{
  const w = mundo(); const alvo = ALVO();
  await followRemote(w.deps, alvo); w.enviados.length = 0;
  const r = await unfollowRemote(w.deps, { actorId: alvo.actorId, handle: alvo.handle, inbox: null });
  confere('SAIR · sem caixa de entrada conhecida: limpa aqui e não tenta enviar (remote "skipped")', r.body.remote === 'skipped' && w.enviados.length === 0 && !w.registros.has(chave(alvo)), JSON.stringify(r.body));
}
{
  const w = mundo(); const alvo = ALVO();
  w.arestas.add(aresta(alvo)); // aresta órfã: sem registro em ap_following
  const r = await unfollowRemote(w.deps, { actorId: alvo.actorId, handle: alvo.handle, inbox: alvo.inbox });
  const undo = w.enviados[0]?.activity;
  confere('SAIR · aresta ÓRFÃ (sem registro): é apagada, e o Undo usa o id determinístico do Follow', r.status === 200 && w.arestas.size === 0 && undo?.object?.id?.includes(`/follow-${remoteFollowDocIdOf(alvo.actorId)}`), JSON.stringify(undo?.object));
}
{
  const w = mundo(); const a = ALVO(); const b = ALVO({ actorId: 'https://bolha.us/users/bruja', handle: 'bruja@bolha.us', domain: 'bolha.us', manuallyApprovesFollowers: true, inbox: 'https://bolha.us/users/bruja/inbox' });
  await followRemote(w.deps, a); await followRemote(w.deps, b);
  await unfollowRemote(w.deps, { actorId: a.actorId, handle: a.handle, inbox: a.inbox });
  confere('SAIR · sair de um perfil não mexe nos outros (o aberto saiu, o pedido pendente do outro continua)', !w.registros.has(chave(a)) && w.registros.get(chave(b))?.status === 'pending' && !w.arestas.has(aresta(a)), '');
}

// ───────── o adaptador do Firestore: Accept grava as arestas do pedido; Reject apaga tudo ─────────
function bancoDeMentira() {
  const dados = new Map();
  const doc = (caminho) => ({
    get: async () => ({ exists: dados.has(caminho), data: () => dados.get(caminho) }),
    set: async (v, opcoes) => { dados.set(caminho, opcoes?.merge ? { ...(dados.get(caminho) ?? {}), ...v } : v); },
    delete: async () => { dados.delete(caminho); },
    collection: (nome) => colecao(`${caminho}/${nome}`),
  });
  const colecao = (caminho) => ({ doc: (id) => doc(`${caminho}/${id}`) });
  return { dados, db: { collection: (nome) => colecao(nome) } };
}
{
  const { dados, db } = bancoDeMentira();
  const loja = createFirestoreStore({ db, FieldValue: { serverTimestamp: () => 'AGORA' }, Timestamp: {}, FieldPath: {}, now: () => 5000 });
  const actorId = 'https://libranet.de/users/marcelo';
  const hash = remoteFollowDocIdOf(actorId); const ru = remoteUserIdOf(actorId);
  dados.set(`ap_following/u1/actors/${hash}`, { actorId, status: 'pending' });
  const ok = await loja.acceptOutboundFollow('u1', actorId);
  confere('ACCEPT · pedido PENDENTE aceito: vira "accepted" com a data e as DUAS arestas passam a existir', ok === true && dados.get(`ap_following/u1/actors/${hash}`).status === 'accepted' && dados.get(`ap_following/u1/actors/${hash}`).acceptedAtMs === 5000 && dados.get(`users/u1/following/${ru}`)?.userId === ru && dados.get(`users/${ru}/followers/u1`)?.userId === 'u1', JSON.stringify([...dados.keys()]));
  dados.clear();
  dados.set(`ap_following/u1/actors/${hash}`, { actorId });
  const ok2 = await loja.acceptOutboundFollow('u1', actorId);
  confere('ACCEPT · registro antigo (perfil aberto, arestas já gravadas): só confirma, NÃO regrava as arestas', ok2 === true && dados.get(`ap_following/u1/actors/${hash}`).status === 'accepted' && !dados.has(`users/u1/following/${ru}`), JSON.stringify([...dados.keys()]));
  dados.clear();
  confere('ACCEPT · sem registro (quem cancelou antes): false, nada criado', (await loja.acceptOutboundFollow('u1', actorId)) === false && dados.size === 0, String(dados.size));
  dados.set(`ap_following/u1/actors/${hash}`, { actorId, status: 'pending' });
  dados.set(`users/u1/following/${ru}`, { userId: ru });
  dados.set(`users/${ru}/followers/u1`, { userId: 'u1' });
  const rej = await loja.rejectOutboundFollow('u1', actorId);
  confere('REJECT · pedido recusado: apaga o registro e qualquer aresta, e o botão volta ao começo', rej === true && dados.size === 0, JSON.stringify([...dados.keys()]));
  confere('REJECT · sem registro: false', (await loja.rejectOutboundFollow('u1', actorId)) === false, '');
}

// ───────── guardas no código-fonte (a rota fina e a resposta do perfil) ─────────
const lerSrc = (c) => readFileSync(new URL(`../src/${c}`, import.meta.url), 'utf8');
const sem = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const rota = sem(lerSrc('app/api/ap/follow/route.ts'));
const perfilRemoto = sem(lerSrc('app/api/ap/remote-profile/route.ts'));
const busca = sem(lerSrc('app/api/ap/lookup/route.ts'));
const resolvedor = sem(lerSrc('lib/server/remoteProfile.ts'));
confere('ROTA · usa o núcleo (followRemote/unfollowRemote) e aceita `cancel` como sair', /followRemote\(/.test(rota) && /unfollowRemote\(/.test(rota) && /body\.action\s*===\s*'cancel'/.test(rota), 'a rota voltou a ter regra própria');
confere('ROTA · teto por pessoa e por IP (cada pedido é UM clique; nada em massa)', /takeRateLimit\(`ap-follow:\$\{caller\.uid\}`/.test(rota) && /takeRateLimit\(`ap-follow-ip:/.test(rota) && /json\(429/.test(rota), 'sem limite de pedidos');
confere('ROTA · sair NÃO exige a federação pronta (só seguir exige): plataforma/conta/chave faltando não prendem ninguém', /if \(action === 'follow'\) \{[\s\S]*?plataforma-desligada[\s\S]*?\}/.test(rota) && /podeEnviar \? inbox : null/.test(rota), 'sair voltaria a depender da federação');
confere('ROTA · sair usa o que já está guardado (remoteActorId/remoteInbox), a rede é só para achar a caixa', /stored\?\.remoteActorId/.test(rota) && /stored\?\.remoteInbox/.test(rota), 'sair dependeria de buscar o perfil na rede');
confere('RESOLVEDOR · lê `manuallyApprovesFollowers` do ator e `locked` da API Mastodon', /actor\.manuallyApprovesFollowers\s*===\s*true/.test(resolvedor) && /m\.locked\s*===\s*true/.test(resolvedor), 'o perfil fechado não seria detectado');
confere('BUSCA · /api/ap/lookup devolve manuallyApprovesFollowers', /manuallyApprovesFollowers:\s*p\.manuallyApprovesFollowers\s*===\s*true/.test(busca), 'a tela não saberia que o perfil é fechado');
confere('PERFIL REMOTO · devolve o estado (following/requested) e a bandeira; pedido pendente NÃO é "seguindo"', /viewOfFollow\(/.test(perfilRemoto) && /followRequested/.test(perfilRemoto) && /manuallyApprovesFollowers:\s*res\.profile\.manuallyApprovesFollowers\s*===\s*true/.test(perfilRemoto) && /const isFollowing = followView === 'following'/.test(perfilRemoto), 'o pedido apareceria como Seguindo');

console.log(`\n${total - falhas}/${total} verificações passaram.`);
if (falhas > 0) { console.log(`${falhas} FALHA(S).`); process.exit(1); }
