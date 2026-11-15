#!/usr/bin/env node
/**
 * Teste de FUMAÇA das rotas da federação rodando DE VERDADE: o app (next dev) contra os emuladores, com requisições
 * HTTP reais, token do Firebase Auth e atividades assinadas por um servidor remoto simulado.
 *
 * Prova o que as suítes de serviço não provam: que as rotas compilam e respondem no Next, que o middleware de idioma
 * não encosta em /.well-known, /ap e /nodeinfo, que o corpo é lido com teto, que a autenticação por cabeçalho e o painel
 * de administração se comportam, e que a fila anda do post à entrega.
 *
 * Pré-requisitos:
 *   npm run emulators                       (Auth, Firestore e Functions)
 *   next dev -p 9102 com NEXT_PUBLIC_USE_EMULATORS=true, NEXT_PUBLIC_BASE_URL=https://ap-teste.exemplo.com.br,
 *   AP_MASTER_KEY=k1:<32 bytes em base64> e AP_WORKER_DEV_TOKEN=token-dev-do-worker-apenas-local
 *   node e2e/ap-routes-smoke.mjs
 *
 * As requisições vão a 127.0.0.1:PORTA com o cabeçalho Host do domínio de teste, porque o domínio precisa ter ponto
 * (a federação recusa hosts de um rótulo só) e não existe no DNS.
 *
 * Sai com código 1 se algo falhar.
 */
import http from 'node:http';
import { signRequest } from '../src/lib/activitypub/signature.ts';
import { generateActorKeyPair } from '../src/lib/activitypub/keys.ts';
import { createFirestoreStore } from '../src/lib/activitypub/firestoreStore.ts';

const PORTA = Number(process.env.AP_SMOKE_PORT ?? 9102);
const HOST = 'ap-teste.exemplo.com.br';
const ORIGEM = `https://${HOST}`;
const DEV_TOKEN = 'token-dev-do-worker-apenas-local';
const PROJETO = 'demo-soberan';
const BANCO = 'echo-db-124325';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= AUTH;

let falhas = 0;
let total = 0;
const confere = (nome, condicao, motivo, detalhe) => {
  total++;
  if (condicao) console.log(`OK    ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo}`); }
};

/** Requisição HTTP com o Host do domínio de teste. Não segue redirecionamentos: o 302 é parte do que se confere. */
function chamar(metodo, caminho, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORTA, path: caminho, method: metodo, agent: false, headers: { host: HOST, connection: 'close', ...headers } }, (res) => {
      const partes = [];
      res.on('data', (c) => partes.push(c));
      res.on('end', () => {
        const texto = Buffer.concat(partes).toString('utf8');
        let json = null;
        try { json = JSON.parse(texto); } catch { /* não é JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, texto, json });
      });
    });
    req.setTimeout(60_000, () => req.destroy(new Error('tempo esgotado')));
    req.on('error', reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

// ───────────── Firebase (emuladores): usuários, sementes e o cache do servidor remoto ─────────────

const { initializeApp } = await import('firebase-admin/app');
const { getAuth } = await import('firebase-admin/auth');
const { getFirestore, FieldValue, Timestamp, FieldPath } = await import('firebase-admin/firestore');
const app = initializeApp({ projectId: PROJETO }, `fumaca-${Date.now()}`);
const auth = getAuth(app);
const db = getFirestore(app, BANCO);
const loja = createFirestoreStore({ db, FieldValue, Timestamp, FieldPath, now: () => Date.now() });

const sufixo = Math.random().toString(36).slice(2, 8);
const dorme = (ms) => new Promise((res) => setTimeout(res, ms));

async function criarPessoa(apelido, { emailVerificado = true, admin = false } = {}) {
  const uid = `fumaca_${apelido}_${sufixo}`;
  const username = `${apelido}_${sufixo}`;
  await auth.createUser({ uid, email: `${uid}@exemplo.com.br`, emailVerified: emailVerificado, password: 'senha-de-teste-123' });
  await db.collection('users').doc(uid).set({
    name: `Pessoa ${apelido}`, username, bio: 'bio de teste', avatarUrl: null, coverImageUrl: null, website: null, location: null,
    createdAt: Timestamp.fromMillis(Date.now() - 86_400_000), profileVisibility: 'public', isAdmin: admin,
    email: 'NAO-PODE-APARECER@exemplo.com',
  });
  const custom = await auth.createCustomToken(uid, { member: true });
  const r = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const { idToken } = await r.json();
  if (!idToken) throw new Error('sem idToken para ' + apelido);
  return { uid, username, handle: username.toLowerCase(), token: idToken, bearer: { Authorization: `Bearer ${idToken}` } };
}

const json = (obj) => ({ body: JSON.stringify(obj), headers: { 'Content-Type': 'application/json' } });
const api = (pessoa, metodo, caminho, obj) =>
  chamar(metodo, caminho, obj === undefined ? { headers: pessoa?.bearer ?? {} } : { ...json(obj), headers: { ...json(obj).headers, ...(pessoa?.bearer ?? {}) } });

/** Um servidor remoto: chave RSA real e o ator já no cache (o app não consegue buscá-lo, pois o domínio não existe). */
async function criarRemoto(usuario, dominio) {
  const par = await generateActorKeyPair();
  const id = `https://${dominio}/users/${usuario}`;
  const remoto = { usuario, dominio, id, par, inbox: `${id}/inbox`, sharedInbox: `https://${dominio}/inbox`, keyId: `${id}#main-key` };
  await loja.putRemoteActor({
    actorId: id, handle: `${usuario}@${dominio}`, domain: dominio, type: 'Person', inbox: remoto.inbox, sharedInbox: remoto.sharedInbox,
    keyId: remoto.keyId, publicKeyPem: par.publicKeyPem, name: `${usuario} em ${dominio}`, iconUrl: null, summary: '', movedTo: null,
    state: 'ok', fetchedAtMs: Date.now(), lastForcedRefreshAtMs: 0,
  });
  return remoto;
}

/** POST assinado na caixa de entrada, como um servidor remoto faria. */
function postarAtividade(remoto, caminho, atividade, { mutar } = {}) {
  const corpo = JSON.stringify(atividade);
  const cab = signRequest({ method: 'POST', url: `${ORIGEM}${caminho}`, body: corpo, privateKeyPem: remoto.par.privateKeyPem, keyId: remoto.keyId, now: Date.now() });
  const req = { headers: { ...cab, 'content-type': 'application/activity+json' }, body: corpo };
  if (mutar) mutar(req);
  return chamar('POST', caminho, req);
}

const followDe = (remoto, handle, id) => ({
  '@context': 'https://www.w3.org/ns/activitystreams', id: id ?? `https://${remoto.dominio}/follows/${remoto.usuario}-${sufixo}`,
  type: 'Follow', actor: remoto.id, object: `${ORIGEM}/ap/users/${handle}`,
});

async function esperarServidor() {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await chamar('GET', '/.well-known/nodeinfo');
      if (r.status > 0) return r;
    } catch { /* ainda subindo */ }
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error('o app não respondeu em 3 minutos');
}

// ═════════════ preparação ═════════════

await esperarServidor();
// O emulador guarda estado de execuções anteriores: a pré-condição da seção A é "sem documento de configuração".
await db.collection('config').doc('federation').delete();
await dorme(11_000); // o app guarda a configuração em cache por 10 s
const ana = await criarPessoa('ana');
const naoVerificada = await criarPessoa('nova', { emailVerificado: false });
const admin = await criarPessoa('adm', { admin: true });
const bob = await criarRemoto('bob', `smoke-${sufixo}.ap-inexistente.net`);

// ═════════════ A. Plataforma DESLIGADA (o padrão seguro: sem documento de configuração) ═════════════

{
  const wf = await chamar('GET', `/.well-known/webfinger?resource=acct:${ana.handle}@${HOST}`);
  confere('DESLIGADA · webfinger → 404', wf.status === 404, `${wf.status}`);
  const ator = await chamar('GET', `/ap/users/${ana.handle}`, { headers: { Accept: 'application/activity+json' } });
  confere('DESLIGADA · actor → 404', ator.status === 404, `${ator.status}`);
  const ni = await chamar('GET', '/nodeinfo/2.1');
  confere('DESLIGADA · nodeinfo/2.1 → 404', ni.status === 404, `${ni.status}`);
  const idx = await chamar('GET', '/.well-known/nodeinfo');
  confere('DESLIGADA · o índice do nodeinfo também só responde com a federação ligada (404)', idx.status === 404, `${idx.status} ${idx.texto.slice(0, 120)}`);
  const caixa = await postarAtividade(bob, '/ap/inbox', followDe(bob, ana.handle));
  confere('DESLIGADA · caixa de entrada compartilhada → 404', caixa.status === 404, `${caixa.status}`);

  const semToken = await api(null, 'GET', '/api/ap/account');
  confere('DESLIGADA · API sem token → 401', semToken.status === 401, `${semToken.status}`);
  const st = await api(ana, 'GET', '/api/ap/account');
  confere('DESLIGADA · o status mostra plataforma desligada e conta não ativada', st.status === 200 && st.json?.platformEnabled === false && st.json?.enabled === false, `${st.status} ${st.texto}`);
  const ativar = await api(ana, 'POST', '/api/ap/account', { action: 'enable' });
  confere('DESLIGADA · ativar → 409 plataforma-desligada', ativar.status === 409 && ativar.json?.error === 'plataforma-desligada', `${ativar.status} ${ativar.texto}`);
  const w = await chamar('POST', '/api/ap/worker', { headers: { Authorization: `Bearer ${DEV_TOKEN}` } });
  confere('DESLIGADA · o worker roda e não faz nada (fila vazia)', w.status === 200 && w.json?.sent === 0, `${w.status} ${w.texto}`);
}

// ═════════════ B. Painel de administração ═════════════

{
  const comum = await api(ana, 'GET', '/api/ap/admin');
  confere('ADMIN · pessoa comum → 404 (a rota nem existe para ela)', comum.status === 404, `${comum.status}`);
  const semToken = await api(null, 'GET', '/api/ap/admin');
  confere('ADMIN · sem token → 401', semToken.status === 401, `${semToken.status}`);
  const vis = await api(admin, 'GET', '/api/ap/admin');
  confere('ADMIN · administrador vê a visão geral', vis.status === 200 && vis.json?.platform?.enabled === false && Array.isArray(vis.json?.rules) && vis.json?.queue, `${vis.status} ${vis.texto.slice(0, 160)}`);
  const ruim = await api(admin, 'POST', '/api/ap/admin', { action: 'platform', enabled: 'sim' });
  confere('ADMIN · valor inválido → 422', ruim.status === 422 && ruim.json?.error === 'valor-invalido', `${ruim.status} ${ruim.texto}`);
  const semAcao = await api(admin, 'POST', '/api/ap/admin', { action: 'apagar-tudo' });
  confere('ADMIN · ação desconhecida → 400', semAcao.status === 400, `${semAcao.status}`);
  const comumPost = await api(ana, 'POST', '/api/ap/admin', { action: 'platform', enabled: true });
  confere('ADMIN · pessoa comum NÃO liga a plataforma (404)', comumPost.status === 404, `${comumPost.status}`);
  const liga = await api(admin, 'POST', '/api/ap/admin', { action: 'platform', enabled: true, mode: 'open', killSwitch: false });
  confere('ADMIN · administrador liga a plataforma', liga.status === 200 && liga.json?.platform?.enabled === true, `${liga.status} ${liga.texto}`);
  const semRegra = await api(admin, 'POST', '/api/ap/admin', { action: 'instance', domain: 'x.exemplo.com.br' });
  confere('ADMIN · regra sem o campo "rule" explícito → 400 (omitir não remove)', semRegra.status === 400, `${semRegra.status}`);
}

// ═════════════ C. Ativar a federação da conta ═════════════

{
  const nv = await api(naoVerificada, 'POST', '/api/ap/account', { action: 'enable' });
  confere('CONTA · e-mail não confirmado → 403', nv.status === 403 && nv.json?.error === 'email-nao-confirmado', `${nv.status} ${nv.texto}`);
  const semCorpo = await chamar('POST', '/api/ap/account', { headers: { ...ana.bearer, 'Content-Type': 'text/plain' }, body: 'enable' });
  confere('CONTA · corpo que não é JSON → 400', semCorpo.status === 400, `${semCorpo.status}`);
  const acaoRuim = await api(ana, 'POST', '/api/ap/account', { action: 'explodir' });
  confere('CONTA · ação inválida → 400', acaoRuim.status === 400, `${acaoRuim.status}`);

  const ok = await api(ana, 'POST', '/api/ap/account', { action: 'enable' });
  confere('CONTA · ativar → 200 com o @ federado', ok.status === 200 && ok.json?.enabled === true && ok.json?.acct === `${ana.handle}@${HOST}`, `${ok.status} ${ok.texto}`);
  const de_novo = await api(ana, 'POST', '/api/ap/account', { action: 'enable' });
  confere('CONTA · ativar de novo é idempotente', de_novo.status === 200 && de_novo.json?.eligibleSince === ok.json?.eligibleSince, `${de_novo.status} ${de_novo.texto}`);
}

// ═════════════ D. Descoberta ═════════════

{
  const wf = await chamar('GET', `/.well-known/webfinger?resource=acct:${ana.handle}@${HOST}`);
  const self = wf.json?.links?.find((l) => l.rel === 'self');
  confere('DESCOBERTA · webfinger devolve o ator', wf.status === 200 && wf.json?.subject === `acct:${ana.handle}@${HOST}` && self?.href === `${ORIGEM}/ap/users/${ana.handle}` && self?.type === 'application/activity+json', `${wf.status} ${wf.texto.slice(0, 200)}`);
  confere('DESCOBERTA · o tipo da resposta é JRD', /application\/(jrd\+json|json)/.test(wf.headers['content-type'] ?? ''), wf.headers['content-type']);
  const porUrl = await chamar('GET', `/.well-known/webfinger?resource=${encodeURIComponent(`${ORIGEM}/ap/users/${ana.handle}`)}`);
  confere('DESCOBERTA · webfinger aceita a URL do ator como recurso', porUrl.status === 200, `${porUrl.status}`);
  const maiuscula = await chamar('GET', `/.well-known/webfinger?resource=acct:${ana.handle.toUpperCase()}@${HOST.toUpperCase()}`);
  confere('DESCOBERTA · maiúsculas no acct são normalizadas', maiuscula.status === 200, `${maiuscula.status}`);
  const outroHost = await chamar('GET', `/.well-known/webfinger?resource=acct:${ana.handle}@outro-servidor.com.br`);
  confere('DESCOBERTA · acct de OUTRO servidor → 404 (só respondemos por nós)', outroHost.status === 404, `${outroHost.status}`);
  const naoExiste = await chamar('GET', `/.well-known/webfinger?resource=acct:ninguem_${sufixo}@${HOST}`);
  confere('DESCOBERTA · conta que não existe → 404', naoExiste.status === 404, `${naoExiste.status}`);
  const naoAtiva = await chamar('GET', `/.well-known/webfinger?resource=acct:${naoVerificada.handle}@${HOST}`);
  confere('DESCOBERTA · conta que não ativou a federação → 404 (não revela que existe)', naoAtiva.status === 404, `${naoAtiva.status}`);
  const semRecurso = await chamar('GET', '/.well-known/webfinger');
  confere('DESCOBERTA · sem "resource" → 400', semRecurso.status === 400, `${semRecurso.status}`);
  const lixo = await chamar('GET', `/.well-known/webfinger?resource=${encodeURIComponent('acct:../../etc/passwd@' + HOST)}`);
  confere('DESCOBERTA · recurso malformado → 404', lixo.status === 404, `${lixo.status}`);

  const hm = await chamar('GET', '/.well-known/host-meta');
  confere('DESCOBERTA · host-meta aponta para o webfinger', hm.status === 200 && hm.texto.includes(`${ORIGEM}/.well-known/webfinger?resource={uri}`), `${hm.status} ${hm.texto.slice(0, 200)}`);
  const idx = await chamar('GET', '/.well-known/nodeinfo');
  confere('DESCOBERTA · o índice do nodeinfo aponta para a origem certa', idx.status === 200 && idx.json?.links?.[0]?.href === `${ORIGEM}/nodeinfo/2.1`, `${idx.status} ${idx.texto.slice(0, 120)}`);
  const ni = await chamar('GET', '/nodeinfo/2.1');
  confere('DESCOBERTA · nodeinfo 2.1: software, protocolo e inscrições', ni.status === 200 && ni.json?.version === '2.1' && ni.json?.protocols?.includes('activitypub') && ni.json?.software?.name && ni.json?.openRegistrations === false, `${ni.status} ${ni.texto.slice(0, 220)}`);
  confere('DESCOBERTA · nodeinfo só traz contagens (nada de listas)', ni.json?.usage?.users && typeof ni.json.usage.users.total === 'number' && !ni.texto.includes('@'), ni.texto.slice(0, 200));
}

// ═════════════ E. Ator, outbox e coleções ═════════════

{
  const ator = await chamar('GET', `/ap/users/${ana.handle}`, { headers: { Accept: 'application/activity+json' } });
  const a = ator.json;
  confere('ATOR · responde application/activity+json', ator.status === 200 && /activity\+json/.test(ator.headers['content-type'] ?? ''), `${ator.status} ${ator.headers['content-type']}`);
  confere('ATOR · é uma Person com id, caixas e chave', a?.type === 'Person' && a.id === `${ORIGEM}/ap/users/${ana.handle}` && a.inbox === `${ORIGEM}/ap/users/${ana.handle}/inbox` && a.outbox && a.followers && a.publicKey?.id === `${ORIGEM}/ap/users/${ana.handle}#main-key`, ator.texto.slice(0, 300));
  confere('ATOR · tem @context e a chave pública em PEM', a?.['@context'] && a.publicKey?.publicKeyPem?.includes('BEGIN PUBLIC KEY'), ator.texto.slice(0, 200));
  confere('ATOR · NUNCA expõe chave privada nem o e-mail da pessoa', !ator.texto.includes('PRIVATE') && !ator.texto.includes('NAO-PODE-APARECER') && !ator.texto.includes('@exemplo.com.br'), 'vazou dado privado');
  confere('ATOR · anuncia a caixa compartilhada', a?.endpoints?.sharedInbox === `${ORIGEM}/ap/inbox`, JSON.stringify(a?.endpoints));
  const ld = await chamar('GET', `/ap/users/${ana.handle}`, { headers: { Accept: 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"' } });
  confere('ATOR · aceita o Accept ld+json do perfil de ActivityStreams', ld.status === 200 && ld.json?.type === 'Person', `${ld.status}`);
  const navegador = await chamar('GET', `/ap/users/${ana.handle}`, { headers: { Accept: 'text/html,application/xhtml+xml' } });
  confere('ATOR · navegador é mandado para o perfil (302)', navegador.status === 302 && String(navegador.headers.location ?? '').includes(HOST), `${navegador.status} ${navegador.headers.location}`);
  const inexistente = await chamar('GET', `/ap/users/ninguem_${sufixo}`, { headers: { Accept: 'application/activity+json' } });
  confere('ATOR · inexistente → 404', inexistente.status === 404, `${inexistente.status}`);
  const invalido = await chamar('GET', '/ap/users/..%2F..%2Fx', { headers: { Accept: 'application/activity+json' } });
  confere('ATOR · handle com caracteres inválidos → 404', invalido.status === 404, `${invalido.status}`);

  const outbox = await chamar('GET', `/ap/users/${ana.handle}/outbox`, { headers: { Accept: 'application/activity+json' } });
  confere('OUTBOX · coleção vazia, só a contagem', outbox.status === 200 && outbox.json?.type === 'OrderedCollection' && outbox.json?.totalItems === 0, `${outbox.status} ${outbox.texto.slice(0, 200)}`);
  const pag = await chamar('GET', `/ap/users/${ana.handle}/outbox?page=true`);
  confere('OUTBOX · a página existe', pag.status === 200 && pag.json?.type === 'OrderedCollectionPage', `${pag.status} ${pag.texto.slice(0, 160)}`);
  for (const ruim of ['abc', '-1', '1e9', '99999999999999999', "1;drop", '']) {
    const r = await chamar('GET', `/ap/users/${ana.handle}/outbox?page=true&before=${encodeURIComponent(ruim)}`);
    confere(`OUTBOX · before="${ruim}" → 400`, r.status === 400, `${r.status}`);
  }
  for (const qual of ['followers', 'following']) {
    const c = await chamar('GET', `/ap/users/${ana.handle}/${qual}`);
    confere(`COLEÇÃO · ${qual}: só a contagem, sem itens`, c.status === 200 && c.json?.totalItems === 0 && !('orderedItems' in c.json) && !('items' in c.json), `${c.status} ${c.texto.slice(0, 160)}`);
  }
  const nota = await chamar('GET', '/ap/notes/naoexiste123', { headers: { Accept: 'application/activity+json' } });
  confere('NOTA · inexistente → 404', nota.status === 404, `${nota.status}`);
  const notaRuim = await chamar('GET', '/ap/notes/..%2Fx', { headers: { Accept: 'application/activity+json' } });
  confere('NOTA · id inválido → 404', notaRuim.status === 404, `${notaRuim.status}`);
}

// ═════════════ F. Caixa de entrada ═════════════

const caixaDaAna = `/ap/users/${ana.handle}/inbox`;
{
  const sem = await chamar('POST', caixaDaAna, { headers: { 'content-type': 'application/activity+json' }, body: JSON.stringify(followDe(bob, ana.handle)) });
  confere('ENTRADA · sem assinatura → 401', sem.status === 401, `${sem.status}`);
  const adulterada = await postarAtividade(bob, caixaDaAna, followDe(bob, ana.handle), { mutar: (r) => { r.body = r.body.replace(ana.handle, `${ana.handle}x`); } });
  confere('ENTRADA · corpo adulterado depois de assinar → 401 (Digest não confere)', adulterada.status === 401, `${adulterada.status}`);
  const impostor = await criarRemoto('impostor', `smoke-${sufixo}.ap-inexistente.net`);
  // o impostor assina com a PRÓPRIA chave, mas diz ser o bob no corpo
  const forjado = await postarAtividade(impostor, caixaDaAna, followDe(bob, ana.handle, `https://${bob.dominio}/follows/forjado-${sufixo}`));
  confere('ENTRADA · assina como um ator e age como outro → recusado (falsificação de ator)', forjado.status >= 400 && forjado.status < 500, `${forjado.status}`);
  const get = await chamar('GET', caixaDaAna);
  confere('ENTRADA · GET na caixa → 405', get.status === 405, `${get.status}`);
  const tipo = await chamar('POST', caixaDaAna, { headers: { 'content-type': 'text/plain' }, body: 'oi' });
  confere('ENTRADA · tipo de conteúdo errado → 415', tipo.status === 415, `${tipo.status}`);
  const grande = await chamar('POST', caixaDaAna, { headers: { 'content-type': 'application/activity+json' }, body: JSON.stringify({ lixo: 'x'.repeat(1_100_000) }) });
  confere('ENTRADA · corpo acima de 1 MB → 413', grande.status === 413, `${grande.status}`);
  const desconhecida = await postarAtividade(bob, `/ap/users/ninguem_${sufixo}/inbox`, followDe(bob, ana.handle));
  confere('ENTRADA · caixa de conta inexistente → 404', desconhecida.status === 404, `${desconhecida.status}`);

  const seguir = await postarAtividade(bob, caixaDaAna, followDe(bob, ana.handle));
  confere('ENTRADA · Follow assinado de um servidor remoto → 202', seguir.status === 202, `${seguir.status}`);
  const repetir = await postarAtividade(bob, caixaDaAna, followDe(bob, ana.handle));
  confere('ENTRADA · o MESMO Follow de novo é replay (202, sem efeito)', repetir.status === 202, `${repetir.status}`);

  const seguidores = await api(ana, 'GET', '/api/ap/followers');
  confere('ENTRADA · o seguidor aparece para a Ana, com @ e nome', seguidores.status === 200 && seguidores.json?.items?.length === 1 && seguidores.json.items[0].handle === `bob@${bob.dominio}`, `${seguidores.status} ${seguidores.texto.slice(0, 200)}`);
  const doBob = await api(admin, 'GET', '/api/ap/followers');
  confere('ENTRADA · outra pessoa NÃO vê os seguidores da Ana', doBob.status === 200 && doBob.json?.items?.length === 0, `${doBob.status} ${doBob.texto}`);
  const col = await chamar('GET', `/ap/users/${ana.handle}/followers`);
  confere('ENTRADA · a coleção pública mostra só a contagem (1)', col.json?.totalItems === 1 && !col.texto.includes(bob.id), `${col.texto.slice(0, 200)}`);
  const st = await api(ana, 'GET', '/api/ap/account');
  confere('ENTRADA · o status da conta conta 1 seguidor', st.json?.followers === 1, `${st.texto}`);

  const entregas = await api(ana, 'GET', '/api/ap/deliveries');
  const aceite = entregas.json?.items?.find((e) => e.op === 'accept');
  confere('ENTRADA · o Accept foi enfileirado para o servidor do seguidor', entregas.status === 200 && aceite?.domain === bob.dominio && aceite?.status === 'pending', `${entregas.status} ${entregas.texto.slice(0, 240)}`);
  confere('ENTRADA · a lista de entregas NÃO expõe corpo nem a URL da caixa do destino', !entregas.texto.includes('"body"') && !entregas.texto.includes('/inbox'), entregas.texto.slice(0, 200));
}

// ═════════════ G. Worker ═════════════

{
  const sem = await chamar('POST', '/api/ap/worker');
  confere('WORKER · sem credencial → 404', sem.status === 404, `${sem.status}`);
  const errado = await chamar('POST', '/api/ap/worker', { headers: { Authorization: 'Bearer token-errado' } });
  confere('WORKER · token errado → 404', errado.status === 404, `${errado.status}`);
  const usuario = await chamar('POST', '/api/ap/worker', { headers: ana.bearer });
  confere('WORKER · token de PESSOA (válido no Firebase) não aciona o worker → 404', usuario.status === 404, `${usuario.status}`);
  const get = await chamar('GET', '/api/ap/worker', { headers: { Authorization: `Bearer ${DEV_TOKEN}` } });
  confere('WORKER · GET → 405', get.status === 405, `${get.status}`);

  const w = await chamar('POST', '/api/ap/worker', { headers: { Authorization: `Bearer ${DEV_TOKEN}` } });
  confere('WORKER · com a credencial do agendador roda', w.status === 200 && typeof w.json?.durationMs === 'number', `${w.status} ${w.texto}`);
  const entregas = await api(ana, 'GET', '/api/ap/deliveries');
  const aceite = entregas.json?.items?.find((e) => e.op === 'accept');
  confere('WORKER · o destino não existe (DNS): a entrega NÃO é perdida, fica para nova tentativa', aceite && aceite.status === 'pending' && aceite.attempts >= 1 && aceite.detail, `${entregas.texto.slice(0, 300)}`);
  const repetir = await api(ana, 'POST', '/api/ap/deliveries', { action: 'retry', id: aceite?.id ?? 'x'.repeat(20) });
  confere('WORKER · "tentar de novo" numa entrega que ainda está na fila → 409', repetir.status === 409, `${repetir.status} ${repetir.texto}`);
  const alheia = await api(admin, 'POST', '/api/ap/deliveries', { action: 'retry', id: aceite?.id ?? 'x'.repeat(20) });
  confere('WORKER · repetir a entrega de OUTRA pessoa → 404 (não revela que existe)', alheia.status === 404, `${alheia.status}`);
  const idRuim = await api(ana, 'POST', '/api/ap/deliveries', { action: 'retry', id: '../../x' });
  confere('WORKER · id de entrega malformado → 400', idRuim.status === 400, `${idRuim.status}`);
}

// ═════════════ H. Do post à entrega (Function + fila + worker) ═════════════

const trabalhador = () => chamar('POST', '/api/ap/worker', { headers: { Authorization: `Bearer ${DEV_TOKEN}` } });
async function tarefasDe(postId) {
  const snap = await db.collection('ap_outbound').where('postId', '==', postId).get();
  return snap.docs.map((d) => d.data());
}
async function esperarTarefa(postId, op, ms = 40_000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const t = (await tarefasDe(postId)).filter((x) => x.op === op);
    if (t.length) return t;
    await dorme(1000);
  }
  return [];
}
const novoPost = (id, over = {}) => db.collection('posts').doc(id).set({
  userId: ana.uid, text: 'olá, Fediverso! #lula', hashtags: ['lula'], media: null, createdAt: Timestamp.now(), updatedAt: null,
  visibility: 'public', federation: 'public', type: 'original', category: 'echo', isDeleted: false, poll: null, sensitive: false,
  youtubeVideoId: null, likes: 0, reposts: 0, ...over,
});
const listaEntregas = async () => (await api(ana, 'GET', '/api/ap/deliveries')).json?.items ?? [];

const P_PUB = `smk_pub_${sufixo}`;
const P_LOCAL = `smk_loc_${sufixo}`;
const P_ANTIGO = `smk_ant_${sufixo}`;
const P_SEG = `smk_seg_${sufixo}`;
{
  await novoPost(P_PUB);
  const criar = await esperarTarefa(P_PUB, 'create');
  confere('POST · publicar com alcance público enfileira UMA tarefa de Create (a Function reagiu)', criar.length === 1 && criar[0].state === 'pending' && criar[0].uid === ana.uid, `${criar.length} tarefa(s)`);

  await novoPost(P_LOCAL, { federation: 'local' });
  await novoPost(P_ANTIGO, { createdAt: Timestamp.fromMillis(Date.now() - 3 * 86_400_000) });
  await novoPost(P_SEG, { federation: 'followers' });
  await esperarTarefa(P_SEG, 'create');
  await dorme(4000);
  confere('POST · alcance "só local" NÃO enfileira nada', (await tarefasDe(P_LOCAL)).length === 0, `${(await tarefasDe(P_LOCAL)).length}`);
  confere('POST · alcance "só seguidores" federa (Create)', (await tarefasDe(P_SEG)).filter((t) => t.op === 'create').length === 1, `${(await tarefasDe(P_SEG)).length}`);

  const w = await trabalhador();
  confere('POST · o worker expande as tarefas', w.status === 200 && w.json?.expanded >= 2, `${w.status} ${w.texto}`);
  const entregas = await listaEntregas();
  const criacoes = entregas.filter((e) => e.op === 'create');
  confere('POST · uma entrega de Create por post federado, para o servidor do seguidor', criacoes.length === 2 && criacoes.every((e) => e.domain === bob.dominio), JSON.stringify(entregas.map((e) => [e.op, e.domain, e.status])));
  const antigo = await tarefasDe(P_ANTIGO);
  const antigaNota = await chamar('GET', `/ap/notes/${P_ANTIGO}`, { headers: { Accept: 'application/activity+json' } });
  confere('POST · post anterior à ativação NÃO federa: a tarefa é encerrada pelo portão, sem entrega e sem Note', antigo.every((x) => x.state === 'skipped' && x.note === 'anterior-a-ativacao') && antigaNota.status === 404 && !entregas.some((e) => e.objectId === P_ANTIGO), JSON.stringify({ antigo: antigo.map((x) => [x.state, x.note]), nota: antigaNota.status }));
  const nota = await chamar('GET', `/ap/notes/${P_PUB}`, { headers: { Accept: 'application/activity+json' } });
  confere('POST · a Note pública responde', nota.status === 200 && nota.json?.type === 'Note' && nota.json.id === `${ORIGEM}/ap/notes/${P_PUB}` && nota.json.attributedTo === `${ORIGEM}/ap/users/${ana.handle}`, `${nota.status} ${nota.texto.slice(0, 240)}`);
  confere('POST · o texto vira HTML e a hashtag vira etiqueta', nota.json?.content?.includes('olá, Fediverso!') && nota.json?.tag?.some((t) => t.type === 'Hashtag'), nota.texto.slice(0, 300));
  const navegador = await chamar('GET', `/ap/notes/${P_PUB}`, { headers: { Accept: 'text/html' } });
  confere('POST · navegador na Note é mandado para a página do post (302)', navegador.status === 302 && String(navegador.headers.location).includes(P_PUB), `${navegador.status} ${navegador.headers.location}`);
  const seg = await chamar('GET', `/ap/notes/${P_SEG}`, { headers: { Accept: 'application/activity+json' } });
  confere('POST · a Note "só seguidores" NÃO é servida a quem pede de fora (404)', seg.status === 404, `${seg.status}`);
  const outbox = await chamar('GET', `/ap/users/${ana.handle}/outbox?page=true`);
  const ids = (outbox.json?.orderedItems ?? []).map((i) => i.object?.id ?? i.id ?? i);
  confere('POST · a outbox lista o público e NÃO o "só seguidores"', ids.some((i) => String(i).includes(P_PUB)) && !ids.some((i) => String(i).includes(P_SEG)), JSON.stringify(ids));
}

// ═════════════ I. Edição e exclusão ═════════════

{
  await db.collection('posts').doc(P_PUB).update({ text: 'texto editado #lula', updatedAt: new Date().toISOString() });
  const upd = await esperarTarefa(P_PUB, 'update');
  confere('EDIÇÃO · editar um post federado enfileira um Update', upd.length === 1, `${upd.length}`);
  await trabalhador();
  confere('EDIÇÃO · o Update vira entrega', (await listaEntregas()).some((e) => e.op === 'update' && e.domain === bob.dominio), JSON.stringify((await listaEntregas()).map((e) => e.op)));
  const nota = await chamar('GET', `/ap/notes/${P_PUB}`, { headers: { Accept: 'application/activity+json' } });
  confere('EDIÇÃO · a Note servida já traz o texto novo', nota.json?.content?.includes('texto editado'), nota.texto.slice(0, 200));

  await db.collection('posts').doc(P_PUB).update({ isDeleted: true });
  const del = await esperarTarefa(P_PUB, 'delete');
  confere('EXCLUSÃO · apagar um post federado enfileira um Delete', del.length === 1, `${del.length}`);
  await trabalhador();
  confere('EXCLUSÃO · o Delete vira entrega', (await listaEntregas()).some((e) => e.op === 'delete' && e.domain === bob.dominio), JSON.stringify((await listaEntregas()).map((e) => e.op)));
  const tomb = await chamar('GET', `/ap/notes/${P_PUB}`, { headers: { Accept: 'application/activity+json' } });
  confere('EXCLUSÃO · a Note apagada responde 410 com Tombstone', tomb.status === 410 && tomb.json?.type === 'Tombstone', `${tomb.status} ${tomb.texto.slice(0, 160)}`);
}

// ═════════════ J. Moderação pela API ═════════════

{
  const semToken = await api(null, 'POST', '/api/ap/blocks', { action: 'add', scope: 'domain', value: 'x.exemplo.com.br' });
  confere('MODERAÇÃO · bloquear sem token → 401', semToken.status === 401, `${semToken.status}`);
  for (const [corpo, esperado] of [
    [{ action: 'add', scope: 'domain', value: 'localhost' }, 422],
    [{ action: 'add', scope: 'domain', value: HOST }, 422],
    [{ action: 'add', scope: 'actor', value: 'http://x.exemplo.com.br/u' }, 422],
    [{ action: 'add', scope: 'tudo', value: 'x' }, 422],
    [{ action: 'explodir' }, 400],
  ]) {
    const r = await api(ana, 'POST', '/api/ap/blocks', corpo);
    confere(`MODERAÇÃO · entrada inválida ${JSON.stringify(corpo).slice(0, 60)} → ${esperado}`, r.status === esperado, `${r.status} ${r.texto}`);
  }
  const outro = await criarRemoto('carla', `smoke-${sufixo}.ap-inexistente.net`);
  await postarAtividade(outro, caixaDaAna, followDe(outro, ana.handle));
  const antes = await api(ana, 'GET', '/api/ap/followers');
  confere('MODERAÇÃO · dois seguidores do mesmo servidor', antes.json?.items?.length === 2, `${antes.texto.slice(0, 200)}`);

  const remover = await api(ana, 'POST', '/api/ap/followers', { action: 'remove', actorId: outro.id });
  confere('MODERAÇÃO · remover seguidor → 200', remover.status === 200, `${remover.status} ${remover.texto}`);
  const denovo = await api(ana, 'POST', '/api/ap/followers', { action: 'remove', actorId: outro.id });
  confere('MODERAÇÃO · remover de novo → 404', denovo.status === 404, `${denovo.status}`);
  const alheio = await api(admin, 'POST', '/api/ap/followers', { action: 'remove', actorId: bob.id });
  confere('MODERAÇÃO · remover seguidor de OUTRA pessoa → 404', alheio.status === 404, `${alheio.status}`);
  confere('MODERAÇÃO · o Reject foi enfileirado', (await listaEntregas()).some((e) => e.op === 'reject'), JSON.stringify((await listaEntregas()).map((e) => e.op)));

  const bloquear = await api(ana, 'POST', '/api/ap/blocks', { action: 'add', scope: 'domain', value: bob.dominio.toUpperCase() });
  confere('MODERAÇÃO · bloquear o servidor remove o seguidor restante', bloquear.status === 200 && bloquear.json?.removedFollowers === 1, `${bloquear.status} ${bloquear.texto}`);
  const lista = await api(ana, 'GET', '/api/ap/blocks');
  confere('MODERAÇÃO · o bloqueio aparece normalizado', lista.json?.items?.some((b) => b.scope === 'domain' && b.value === bob.dominio), lista.texto);
  const volta = await postarAtividade(bob, caixaDaAna, followDe(bob, ana.handle, `https://${bob.dominio}/follows/bob-2-${sufixo}`));
  const aposVolta = await api(ana, 'GET', '/api/ap/followers');
  confere('MODERAÇÃO · um novo Follow do servidor bloqueado é descartado', volta.status === 202 && aposVolta.json?.items?.length === 0, `${volta.status} ${aposVolta.texto}`);
  const desbloquear = await api(ana, 'POST', '/api/ap/blocks', { action: 'remove', scope: 'domain', value: bob.dominio });
  confere('MODERAÇÃO · desbloquear → 200', desbloquear.status === 200, `${desbloquear.status}`);
}

// ═════════════ K. Regras de servidor e botão de emergência (painel) ═════════════

{
  const suspende = await api(admin, 'POST', '/api/ap/admin', { action: 'instance', domain: bob.dominio, rule: 'suspend' });
  confere('PAINEL · administrador suspende um servidor', suspende.status === 200, `${suspende.status} ${suspende.texto}`);
  const entra = await postarAtividade(bob, caixaDaAna, followDe(bob, ana.handle, `https://${bob.dominio}/follows/bob-3-${sufixo}`));
  const seguidores = await api(ana, 'GET', '/api/ap/followers');
  confere('PAINEL · o que chega do servidor suspenso é descartado', entra.status === 202 && seguidores.json?.items?.length === 0, `${entra.status} ${seguidores.texto}`);
  const vis = await api(admin, 'GET', '/api/ap/admin');
  confere('PAINEL · a regra aparece na visão geral, com os contadores', vis.json?.rules?.some((r) => r.domain === bob.dominio && r.action === 'suspend') && typeof vis.json?.counters?.today === 'object', vis.texto.slice(0, 300));
  const tira = await api(admin, 'POST', '/api/ap/admin', { action: 'instance', domain: bob.dominio, rule: null });
  confere('PAINEL · null remove a regra', tira.status === 200, `${tira.status}`);
  const volta = await postarAtividade(bob, caixaDaAna, followDe(bob, ana.handle, `https://${bob.dominio}/follows/bob-4-${sufixo}`));
  const aposVolta = await api(ana, 'GET', '/api/ap/followers');
  confere('PAINEL · sem a regra, o servidor volta a ser aceito', volta.status === 202 && aposVolta.json?.items?.length === 1, `${volta.status} ${aposVolta.texto}`);

  const liga = await api(admin, 'POST', '/api/ap/admin', { action: 'platform', killSwitch: true });
  const wf = await chamar('GET', `/.well-known/webfinger?resource=acct:${ana.handle}@${HOST}`);
  const caixa = await postarAtividade(bob, caixaDaAna, followDe(bob, ana.handle, `https://${bob.dominio}/follows/bob-5-${sufixo}`));
  const ator = await chamar('GET', `/ap/users/${ana.handle}`, { headers: { Accept: 'application/activity+json' } });
  confere('EMERGÊNCIA · com o botão ligado, descoberta, ator e caixa de entrada somem NA HORA', liga.status === 200 && wf.status === 404 && caixa.status === 404 && ator.status === 404, `${liga.status}/${wf.status}/${caixa.status}/${ator.status}`);
  const status = await api(ana, 'GET', '/api/ap/account');
  confere('EMERGÊNCIA · a pessoa vê que a plataforma está fora, e sua escolha continua guardada', status.json?.platformEnabled === false && status.json?.enabled === true, status.texto);
  await api(admin, 'POST', '/api/ap/admin', { action: 'platform', killSwitch: false });
  const wf2 = await chamar('GET', `/.well-known/webfinger?resource=acct:${ana.handle}@${HOST}`);
  confere('EMERGÊNCIA · desligado o botão, tudo volta sem a pessoa fazer nada', wf2.status === 200, `${wf2.status}`);
}

// ═════════════ L. Pausar, retomar e desligar ═════════════

{
  const P_PAUSA = `smk_pau_${sufixo}`;
  const pausa = await api(ana, 'POST', '/api/ap/account', { action: 'pause' });
  confere('PAUSA · pausar → 200', pausa.status === 200 && pausa.json?.paused === true, `${pausa.status} ${pausa.texto}`);
  await novoPost(P_PAUSA);
  await dorme(6000);
  confere('PAUSA · post publicado durante a pausa NÃO é enfileirado', (await tarefasDe(P_PAUSA)).length === 0, `${(await tarefasDe(P_PAUSA)).length}`);
  const retoma = await api(ana, 'POST', '/api/ap/account', { action: 'resume' });
  confere('PAUSA · retomar → 200 e a janela de elegibilidade avança', retoma.status === 200 && retoma.json?.paused === false && retoma.json.eligibleSince > pausa.json.eligibleSince, `${retoma.status} ${retoma.texto}`);
  await dorme(4000);
  confere('PAUSA · e o post feito durante a pausa continua sem federar depois de retomar', (await tarefasDe(P_PAUSA)).length === 0, `${(await tarefasDe(P_PAUSA)).length}`);

  const desliga = await api(ana, 'POST', '/api/ap/account', { action: 'disable' });
  confere('DESLIGAR · desligar → 200', desliga.status === 200 && desliga.json?.enabled === false, `${desliga.status} ${desliga.texto}`);
  const ator = await chamar('GET', `/ap/users/${ana.handle}`, { headers: { Accept: 'application/activity+json' } });
  confere('DESLIGAR · o ator responde 410 com Tombstone', ator.status === 410 && ator.json?.type === 'Tombstone', `${ator.status} ${ator.texto.slice(0, 160)}`);
  const wf = await chamar('GET', `/.well-known/webfinger?resource=acct:${ana.handle}@${HOST}`);
  confere('DESLIGAR · o webfinger some', wf.status === 404, `${wf.status}`);
  const w = await trabalhador();
  const entregas = await listaEntregas();
  confere('DESLIGAR · o worker entrega o Delete do ator a quem seguia', w.status === 200 && entregas.some((e) => e.op === 'delete-actor' && e.domain === bob.dominio), JSON.stringify(entregas.map((e) => e.op)));
  const seguidores = await api(ana, 'GET', '/api/ap/followers');
  confere('DESLIGAR · os vínculos de seguidor são removidos', seguidores.json?.items?.length === 0, seguidores.texto);
  const reativar = await api(ana, 'POST', '/api/ap/account', { action: 'enable' });
  confere('DESLIGAR · religar é possível (o @ continua dela) e recomeça sem passado', reativar.status === 200 && reativar.json?.acct === `${ana.handle}@${HOST}`, `${reativar.status} ${reativar.texto}`);
}

console.log('');
console.log(`${total} verificações.`);
if (falhas) {
  console.log(`${falhas} falha(s).`);
  process.exit(1);
}
console.log('Rotas da federação OK no app real: descoberta, ator, caixa de entrada, worker, moderação e painel.');
process.exit(0);
