#!/usr/bin/env node
/**
 * O ator da instância e o GET assinado (Authorized Fetch), sem app, sem emuladores e sem rede:
 *   node e2e/ap-instancia-check.mjs        (ou: npm run e2e:ap-instancia)
 *
 *   - a casa tem UMA chave própria, criada na primeira vez e a mesma depois; várias instâncias do servidor criando ao mesmo
 *     tempo acabam usando a MESMA chave; ela é cifrada com o AAD "@instance" (não abre como se fosse de uma pessoa);
 *   - o documento do ator é um Application com a chave pública certa, e não se confunde com nenhuma pessoa;
 *   - o GET assinado vale para quem verifica (`(request-target) host date`) e leva o keyId do ator da instância, nunca o de uma
 *     pessoa: antes as buscas saíam assinadas pelo primeiro handle ativo;
 *   - o fetcher só assina quando o servidor remoto EXIGE (401/403) e tenta uma vez só.
 *
 * Sai com código 1 se algo falhar.
 */
import { createFetcher } from '../src/lib/activitypub/fetcher.ts';
import { enableFederation } from '../src/lib/activitypub/account.ts';
import { ensureInstanceKeys, INSTANCE_KEY_UID, renderInstanceActor, signGetAsInstance } from '../src/lib/activitypub/instanceActor.ts';
import { generateActorKeyPair, openSecret } from '../src/lib/activitypub/keys.ts';
import { verifyHttpSignature } from '../src/lib/activitypub/signature.ts';
import { buildInstanceWebfinger, isInstanceWebfingerResource, parseWebfingerResource } from '../src/lib/activitypub/identity.ts';
import { renderInstanceWebfinger } from '../src/lib/activitypub/render.ts';
import { contador, HOST, MESTRA, montar, ORIGEM, T0 } from './helpers/ap-fediverse.mjs';
import { createMemoryStore } from './helpers/ap-memory-store.mjs';

const { confere, encerra } = contador();
const novaLoja = () => createMemoryStore({ now: () => T0 }).store;

// ───────────── 1. a chave da instância ─────────────
{
  const store = novaLoja();
  const deps = { store, keyring: MESTRA };
  const a = await ensureInstanceKeys(deps);
  const b = await ensureInstanceKeys(deps);
  confere('INSTÂNCIA · a chave é criada na primeira vez e é a MESMA nas seguintes', a.privateKeyPem === b.privateKeyPem && a.publicKeyPem === b.publicKeyPem && /BEGIN PUBLIC KEY/.test(a.publicKeyPem), 'a chave mudou');
  const selada = await store.loadSealedKey(INSTANCE_KEY_UID);
  confere('INSTÂNCIA · fica CIFRADA no armazenamento (nunca em texto)', Boolean(selada) && !JSON.stringify(selada).includes('PRIVATE KEY'), JSON.stringify(selada).slice(0, 80));
  let abriuComoPessoa = true;
  try { openSecret(selada, MESTRA, 'U_ANA'); } catch { abriuComoPessoa = false; }
  confere('INSTÂNCIA · o AAD "@instance" amarra a chave à casa: não abre como se fosse de uma pessoa', abriuComoPessoa === false && openSecret(selada, MESTRA, INSTANCE_KEY_UID) === a.privateKeyPem, 'abriu com o AAD de uma pessoa');
  confere('INSTÂNCIA · o id reservado não colide com um UID do Firebase (que é alfanumérico)', /@/.test(INSTANCE_KEY_UID) && !/^[A-Za-z0-9]+$/.test(INSTANCE_KEY_UID), INSTANCE_KEY_UID);

  // várias instâncias do servidor criando ao mesmo tempo
  const corrida = novaLoja();
  const todas = await Promise.all(Array.from({ length: 8 }, () => ensureInstanceKeys({ store: corrida, keyring: MESTRA })));
  const chaves = new Set(todas.map((k) => k.privateKeyPem));
  const gravada = openSecret(await corrida.loadSealedKey(INSTANCE_KEY_UID), MESTRA, INSTANCE_KEY_UID);
  confere('INSTÂNCIA · 8 criações simultâneas acabam usando UMA chave só (a que ficou gravada)', chaves.size === 1 && [...chaves][0] === gravada, `${chaves.size} chaves diferentes em uso`);

  const casa = montar();
  await enableFederation(casa.deps, 'U_ANA', { emailVerified: true });
  const instancia = await ensureInstanceKeys({ store: casa.deps.store, keyring: MESTRA });
  const handle = await casa.store.getHandle('ana_silva');
  confere('INSTÂNCIA · a chave da casa é DIFERENTE da de qualquer pessoa', handle.publicKeyPem !== instancia.publicKeyPem, 'a chave da instância é a de uma pessoa');
}

// ───────────── 2. o documento do ator ─────────────
{
  const store = novaLoja();
  const { publicKeyPem } = await ensureInstanceKeys({ store, keyring: MESTRA });
  const doc = renderInstanceActor({ origin: ORIGEM, ownHost: HOST, publicKeyPem });
  confere('ATOR · tipo Application, no endereço /ap/actor', doc.type === 'Application' && doc.id === `${ORIGEM}/ap/actor`, JSON.stringify(doc.id));
  confere('ATOR · a chave pública é a da casa e o dono é o próprio ator', doc.publicKey.owner === doc.id && doc.publicKey.id === `${ORIGEM}/ap/actor#main-key` && doc.publicKey.publicKeyPem === publicKeyPem, JSON.stringify(doc.publicKey).slice(0, 120));
  confere('ATOR · o nome de usuário é o domínio (como o ator da instância do Mastodon) e a caixa de entrada é a compartilhada', doc.preferredUsername === HOST && doc.inbox === `${ORIGEM}/ap/inbox`, `${doc.preferredUsername} ${doc.inbox}`);
  confere('ATOR · não aceita seguidores (não é uma pessoa) e traz o contexto de segurança', doc.manuallyApprovesFollowers === true && doc['@context'].includes('https://w3id.org/security/v1'), JSON.stringify(doc['@context']));
}

// ───────────── 3. o GET assinado ─────────────
{
  const store = novaLoja();
  const deps = { store, keyring: MESTRA, origin: ORIGEM, now: () => T0 };
  const { publicKeyPem } = await ensureInstanceKeys(deps);
  const url = 'https://mastodon.social/users/gargron?pagina=1';
  const cab = await signGetAsInstance(deps, url);
  confere('GET · o keyId é o do ator da INSTÂNCIA (nunca o de uma pessoa)', cab.signature.includes(`keyId="${ORIGEM}/ap/actor#main-key"`), cab.signature.slice(0, 120));
  confere('GET · assina (request-target) host date e não leva Digest (não há corpo)', cab.signature.includes('headers="(request-target) host date"') && cab.digest === undefined, cab.signature.slice(0, 160));
  const entrada = (extra = {}) => ({ method: 'GET', path: '/users/gargron?pagina=1', headers: { ...cab, ...extra }, body: new Uint8Array(0), now: T0 });
  const v = verifyHttpSignature(entrada(), publicKeyPem);
  confere('GET · quem verifica com a chave pública do ator aceita a assinatura', v.ok === true, JSON.stringify(v));
  const outra = await generateActorKeyPair();
  confere('GET · com a chave de OUTRA conta, a verificação recusa', verifyHttpSignature(entrada(), outra.publicKeyPem).ok === false, 'aceitou a chave errada');
  confere('GET · outro caminho (replay num endereço diferente) é recusado', verifyHttpSignature({ ...entrada(), path: '/users/outra-pessoa' }, publicKeyPem).ok === false, 'aceitou o caminho trocado');
  confere('GET · a data é a do relógio injetado (sem Date.now escondido)', cab.date === new Date(T0).toUTCString(), cab.date);
}

// ───────────── 4. o fetcher só assina quando o servidor exige ─────────────
{
  const chamadas = [];
  const resposta = (status, json = null) => ({ ok: status >= 200 && status < 300, status, text: json ? JSON.stringify(json) : '', headers: {}, finalUrl: 'x' });
  const cria = (comoResponder, signGet) => createFetcher({
    now: () => T0, userAgent: 'teste', signGet,
    fetchText: async (url, opcoes) => { chamadas.push({ url, headers: opcoes.headers }); return comoResponder(opcoes.headers ?? {}); },
  });
  const ACEITA = { accept: 'application/activity+json' };
  const assinador = async (url) => ({ host: 'mastodon.social', date: 'agora', signature: `keyId="${ORIGEM}/ap/actor#main-key",signature="x"` });

  chamadas.length = 0;
  const ok = await cria(() => resposta(200, { id: 'a' }), assinador).get('https://mastodon.social/users/a', ACEITA);
  confere('FETCHER · servidor aberto: uma chamada, SEM assinar (não entregamos identidade à toa)', ok.status === 200 && chamadas.length === 1 && !chamadas[0].headers.signature, JSON.stringify(chamadas));

  chamadas.length = 0;
  const seguro = await cria((h) => (h.signature ? resposta(200, { id: 'a' }) : resposta(401)), assinador).get('https://secure.exemplo.com.br/users/a', ACEITA);
  confere('FETCHER · servidor com Authorized Fetch (401): tenta de novo ASSINADO e consegue', seguro.status === 200 && seguro.json?.id === 'a' && chamadas.length === 2 && Boolean(chamadas[1].headers.signature), JSON.stringify(chamadas.map((c) => Boolean(c.headers.signature))));
  confere('FETCHER · a segunda chamada leva o keyId do ator da instância', String(chamadas[1].headers.signature).includes('/ap/actor#main-key'), String(chamadas[1].headers.signature));

  chamadas.length = 0;
  const proibido = await cria((h) => (h.signature ? resposta(200, { id: 'b' }) : resposta(403)), assinador).get('https://secure.exemplo.com.br/users/b', ACEITA);
  confere('FETCHER · 403 também dispara a nova tentativa assinada', proibido.status === 200 && chamadas.length === 2, `${proibido.status} / ${chamadas.length} chamadas`);

  chamadas.length = 0;
  const sempre401 = await cria(() => resposta(401), assinador).get('https://secure.exemplo.com.br/users/c', ACEITA);
  confere('FETCHER · se nem assinado o servidor aceita, desiste depois de UMA nova tentativa (sem laço)', sempre401.status === 401 && chamadas.length === 2, `${sempre401.status} / ${chamadas.length} chamadas`);

  chamadas.length = 0;
  const semChave = await cria(() => resposta(401), async () => null).get('https://secure.exemplo.com.br/users/d', ACEITA);
  confere('FETCHER · sem chave da instância configurada (assinador devolve null): não repete', semChave.status === 401 && chamadas.length === 1, `${semChave.status} / ${chamadas.length} chamadas`);

  chamadas.length = 0;
  const assinadorQueFalha = async () => { throw new Error('sem AP_MASTER_KEY'); };
  const falhou = await cria(() => resposta(401), assinadorQueFalha).get('https://secure.exemplo.com.br/users/e', ACEITA);
  confere('FETCHER · assinador que LANÇA não derruba a busca: devolve o 401 original', falhou.status === 401 && chamadas.length === 1, `${falhou.status} / ${chamadas.length} chamadas`);

  chamadas.length = 0;
  const naoExiste = await cria(() => resposta(404), assinador).get('https://mastodon.social/users/fantasma', ACEITA);
  confere('FETCHER · 404 não é falta de assinatura: não repete', naoExiste.status === 404 && chamadas.length === 1, `${naoExiste.status} / ${chamadas.length} chamadas`);

  chamadas.length = 0;
  const semAssinador = await cria(() => resposta(401), undefined).get('https://secure.exemplo.com.br/users/f', ACEITA);
  confere('FETCHER · sem assinador nenhum, o 401 volta como veio', semAssinador.status === 401 && chamadas.length === 1, `${semAssinador.status} / ${chamadas.length} chamadas`);
}

// ───────────── 5. a descoberta do ator da instância (WebFinger) ─────────────
// Mastodon, em modo de busca autorizada, só aceita a assinatura depois de confirmar o ator: busca o documento e pergunta
// `acct:<preferredUsername>@<domínio>` por WebFinger, exigindo que o `self` seja o id do ator. Em produção os primeiros pedidos
// dessa confirmação chegaram e recebiam 404: a chave existia, mas nenhum servidor desses a aceitaria.
{
  const store = novaLoja();
  const { publicKeyPem } = await ensureInstanceKeys({ store, keyring: MESTRA });
  const ator = renderInstanceActor({ origin: ORIGEM, ownHost: HOST, publicKeyPem });
  const acctDoAtor = `acct:${ator.preferredUsername}@${HOST}`;

  confere('WEBFINGER · o acct que o Mastodon monta a partir do ator (preferredUsername@domínio) é reconhecido', isInstanceWebfingerResource(acctDoAtor, HOST, ORIGEM), acctDoAtor);
  confere('WEBFINGER · o reconhecimento ignora maiúsculas e aceita a URL do ator, com ou sem barra final',
    isInstanceWebfingerResource(`acct:${HOST.toUpperCase()}@${HOST.toUpperCase()}`, HOST, ORIGEM)
      && isInstanceWebfingerResource(`${ORIGEM}/ap/actor`, HOST, ORIGEM)
      && isInstanceWebfingerResource(`${ORIGEM}/ap/actor/`, HOST, ORIGEM), 'recusou uma forma válida');
  const intrusos = [
    `acct:${HOST}@outro.com.br`, `acct:outro.com.br@${HOST}`, `acct:ana_silva@${HOST}`, `acct:${HOST}`,
    'https://outro.com.br/ap/actor', `${ORIGEM}/ap/users/ana_silva`, `${ORIGEM}/ap/actor/extra`, `${ORIGEM}/ap/actors`,
    '', null, undefined, `acct:${HOST}@${HOST}`.padEnd(400, 'a'),
  ];
  const aceitos = intrusos.filter((x) => isInstanceWebfingerResource(x, HOST, ORIGEM));
  confere('WEBFINGER · só o ator da instância: outro host, outra pessoa, outro caminho e entrada absurda são recusados', aceitos.length === 0, `aceitou ${JSON.stringify(aceitos)}`);
  confere('WEBFINGER · o caminho das pessoas nunca reivindica o ator da instância (nenhum dos dois pode responder pelo outro)',
    parseWebfingerResource(acctDoAtor, HOST, ORIGEM) === null && parseWebfingerResource(`${ORIGEM}/ap/actor`, HOST, ORIGEM) === null
      && !isInstanceWebfingerResource(`acct:ana_silva@${HOST}`, HOST, ORIGEM), 'os dois responderam pelo mesmo recurso');

  const jrd = buildInstanceWebfinger({ host: HOST, origin: ORIGEM });
  const self = jrd.links.find((l) => l.rel === 'self');
  confere('WEBFINGER · o assunto é o acct do ator e o `self` é o id do ator, em ActivityPub (a exigência do Mastodon)',
    jrd.subject === acctDoAtor && self?.href === ator.id && self?.type === 'application/activity+json' && jrd.aliases.includes(ator.id), JSON.stringify(jrd));

  const casa = montar();
  const ligada = await renderInstanceWebfinger(casa.deps);
  confere('WEBFINGER · plataforma ligada: 200 em JRD, com o mesmo documento', ligada.status === 200 && /jrd\+json/.test(ligada.headers?.['Content-Type'] ?? '') && ligada.body.subject === acctDoAtor, JSON.stringify(ligada).slice(0, 160));
  await casa.store.setPlatform({ killSwitch: true });
  confere('WEBFINGER · botão de emergência: 404 (some junto com o ator)', (await renderInstanceWebfinger(casa.deps)).status === 404, 'respondeu');
  await casa.store.setPlatform({ killSwitch: false, enabled: false });
  confere('WEBFINGER · plataforma desligada: 404', (await renderInstanceWebfinger(casa.deps)).status === 404, 'respondeu');
}

encerra('Ator da instância OK: uma chave só da casa, cifrada e única, descoberta por WebFinger, e o GET só é assinado (e só com ela) quando o servidor remoto exige.');
