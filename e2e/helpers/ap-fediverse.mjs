// Um Fediverso simulado, compartilhado pelas suítes de moderação e de administração da federação: servidores remotos com
// chaves RSA reais, rede falsa e armazenamento em memória. Não depende de emulador, app ou rede.
import { signRequest } from '../../src/lib/activitypub/signature.ts';
import { generateActorKeyPair, parseMasterKeyring } from '../../src/lib/activitypub/keys.ts';
import { processInbox } from '../../src/lib/activitypub/inbox.ts';
import { enableFederation } from '../../src/lib/activitypub/account.ts';
import { WindowLimiter } from '../../src/lib/activitypub/rateLimit.ts';
import { createMemoryStore } from './ap-memory-store.mjs';

export const HOST = 'exercitodolula.app';
export const ORIGEM = `https://${HOST}`;
export const T0 = Date.UTC(2026, 10, 12, 15, 0, 0);
export const MESTRA = parseMasterKeyring(`k1:${Buffer.alloc(32, 5).toString('base64')}`);

export function contador() {
  const r = { falhas: 0, total: 0 };
  r.confere = (nome, condicao, motivo, detalhe) => {
    r.total++;
    if (condicao) console.log(`OK    ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
    else { r.falhas++; console.log(`FALHA ${nome} — ${motivo}`); }
  };
  r.encerra = (mensagemOk) => {
    console.log('');
    console.log(`${r.total} verificações.`);
    if (r.falhas) { console.log(`${r.falhas} falha(s).`); process.exit(1); }
    console.log(mensagemOk);
  };
  return r;
}

export async function criarRemoto(rede, host, usuario) {
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

export function criarRede() {
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

/** Casa montada: armazenamento, rede falsa, relógio controlável e as dependências de todos os serviços. */
export function montar(inicial = {}) {
  const relogio = { t: T0, now() { return this.t; }, avanca(ms) { this.t += ms; } };
  const { store, teste } = createMemoryStore({ now: () => relogio.t, ...inicial });
  const rede = criarRede();
  let seq = 0;
  const deps = {
    store, fetcher: rede.fetcher, now: () => relogio.t, ownHost: HOST, origin: ORIGEM,
    mediaOrigin: 'https://media.exercitodolula.app', mediaTypeOf: async () => null, softwareVersion: 'teste',
    keyring: MESTRA, randomId: () => `id${++seq}`,
    domainLimiter: new WindowLimiter(1000, 60_000), actorLimiter: new WindowLimiter(1000, 60_000), flagLimiter: new WindowLimiter(3, 3_600_000),
  };
  const perfil = (uid, username) => ({
    uid, name: username, username, bio: '', avatarUrl: null, coverUrl: null, website: null, location: null,
    createdAtMs: T0 - 1e9, profileVisibility: 'public',
  });
  teste.seedProfile(perfil('U_ANA', 'Ana_Silva'));
  teste.seedProfile(perfil('U_BIA', 'bia'));
  return { deps, store, teste, rede, relogio };
}

export function requisicao(remoto, { handle = 'ana_silva', atividade, relogio } = {}) {
  const path = handle === null ? '/ap/inbox' : `/ap/users/${handle}/inbox`;
  const corpo = JSON.stringify(atividade);
  const assinados = signRequest({ method: 'POST', url: `${ORIGEM}${path}`, body: corpo, privateKeyPem: remoto.par.privateKeyPem, keyId: remoto.keyId, now: relogio.now() });
  return { handle, method: 'POST', path, headers: { ...assinados, 'content-type': 'application/activity+json' }, body: Buffer.from(corpo) };
}

export const follow = (remoto, alvoHandle, id = `https://${remoto.host}/follows/${remoto.usuario}-1`) => ({
  '@context': 'https://www.w3.org/ns/activitystreams', id, type: 'Follow', actor: remoto.id, object: `${ORIGEM}/ap/users/${alvoHandle}`,
});

export const post = (relogio, over = {}) => ({
  id: 'P1', userId: 'U_ANA', text: 'olá mundo #lula', hashtags: ['lula'], media: [], createdAtMs: relogio.t, updatedAtMs: null,
  visibility: 'public', federation: 'public', type: 'original', category: 'echo', isDeleted: false, hasPoll: false,
  sensitive: false, youtubeVideoId: null, ...over,
});

export const tarefa = (relogio, op, postId, uid = 'U_ANA') => ({
  id: `${op}-${postId}-${relogio.t}`, op, uid, postId, targets: null, createdAtMs: relogio.t, nextAttemptAt: relogio.t, attempts: 0, state: 'pending', note: null,
});

export const entregasDe = (rede, filtro = () => true) => rede.posts.filter(filtro).map((p) => ({ ...p, json: JSON.parse(p.body) }));

/**
 * Casa com a Ana federando e três seguidores remotos: bia e caio em mastodon.social, duda em pleroma.exemplo.com.br.
 * Os Accept dos Follow são descartados para que os testes comecem da fila vazia.
 */
export async function comSeguidores(opcoes = {}) {
  const ctx = montar(opcoes);
  const { deps, rede } = ctx;
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
  ctx.rel = rel;
  for (const d of [...ctx.teste.deliveries.values()]) if (d.op === 'accept') ctx.teste.deliveries.delete(d.id);
  return ctx;
}
