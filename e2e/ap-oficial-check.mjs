#!/usr/bin/env node
/**
 * A conta oficial @ExercitoDoLula, de ponta a ponta, com um Fediverso simulado (servidores remotos com chaves RSA reais,
 * rede falsa, armazenamento em memória, a Function que enfileira e o worker que entrega):
 *   node e2e/ap-oficial-check.mjs        (ou: npm run e2e:ap-oficial)
 *
 * O que se prova, e que as outras suítes (feitas com a conta "Ana") não provam:
 *   - a identidade da conta no Fediverso: ator com FOTO, descobrível, WebFinger com qualquer caixa;
 *   - todo post publicado (texto, hashtags, mídia, notícia com manchete, vídeo, mídia sem texto) vira `ap_outbound`, chega ao
 *     inbox de cada servidor que segue e aparece na outbox, com assinatura verificável;
 *   - as hashtags saem no campo `tag` SEM `##` (o app guarda `#Lula`; a nota saía `##Lula` e o Mastodon não indexava);
 *   - edição (inclusive só da manchete) vira Update; exclusão (apagar, retirar do alcance, apagar de vez) vira Delete;
 *   - o portão (`eligibleSince`, pausa, plataforma desligada) barra o que deve, e o que ele barra DEIXA RASTRO (log estruturado,
 *     auditoria e contador): nada some em silêncio;
 *   - entrega que falha (assinatura recusada, servidor fora do ar, limite, rede) é classificada, registrada e isolada do resto,
 *     e a que morre pode ser reagendada;
 *   - a validação de entrada da API (mídia que não vai ao Fediverso, anexos demais, vídeo e local inválidos).
 * Sai com código 1 se algo falhar.
 */
import { signRequest, verifyHttpSignature } from '../src/lib/activitypub/signature.ts';
import { enableFederation, getFederationStatus, pauseFederation, resumeFederation } from '../src/lib/activitypub/account.ts';
import { processInbox } from '../src/lib/activitypub/inbox.ts';
import { hashtagsDoTexto } from '../src/lib/activitypub/activity.ts';
import { AS_PUBLIC } from '../src/lib/activitypub/gate.ts';
import { parseWebfingerResource } from '../src/lib/activitypub/identity.ts';
import { failureClassOf } from '../src/lib/activitypub/delivery.ts';
import { imagemDePerfil, renderActor, renderNote, renderOutbox, renderWebfinger } from '../src/lib/activitypub/render.ts';
import { listDeliveriesForUser, retryDeliveryForUser, runWorker, summarizeDeliveries } from '../src/lib/activitypub/worker.ts';
import {
  OFFICIAL_BROKEN_AVATAR, OFFICIAL_DEFAULT_AVATAR, isFederableProfileImage, parseOfficialPost, parseOfficialProfilePatch,
} from '../src/lib/activitypub/officialPost.ts';
import { aoEscreverPost } from '../functions/src/federation.ts';
import { ORIGEM, T0, contador, criarRemoto, follow, montar, requisicao } from './helpers/ap-fediverse.mjs';

const t = contador();
const { confere } = t;
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const OFICIAL = 'official_exercitodolula';
const HANDLE = 'exercitodolula';
const MIDIA = 'https://media.exercitodolula.app';
const DOIS_DIAS = 2 * 24 * 3600 * 1000;

// ───────────────────────── a casa, com a conta oficial e seguidores em dois servidores ─────────────────────────

async function casa({ seguidores = true } = {}) {
  const ctx = montar();
  const { deps, teste, rede, relogio } = ctx;
  teste.seedProfile({
    uid: OFICIAL, name: 'Exército do Lula', username: 'ExercitoDoLula', bio: 'Perfil oficial do Exército do Lula #lula',
    avatarUrl: OFFICIAL_DEFAULT_AVATAR, coverUrl: null, website: 'https://exercitodolula.app', location: null,
    createdAtMs: T0 - 1e9, profileVisibility: 'public', isOfficial: true,
  });
  const ativada = await enableFederation(deps, OFICIAL, { emailVerified: true });
  if (!ativada.ok) throw new Error(`a conta oficial não ativou: ${JSON.stringify(ativada)}`);
  ctx.logs = [];
  deps.log = (e) => ctx.logs.push(e);
  relogio.avanca(60_000); // os posts vêm DEPOIS da ativação (eligibleSince)
  ctx.rel = { now: () => deps.now() };
  ctx.remotos = {};
  if (seguidores) {
    ctx.remotos = {
      bia: await criarRemoto(rede, 'mastodon.social', 'bia'),
      caio: await criarRemoto(rede, 'mastodon.social', 'caio'),
      duda: await criarRemoto(rede, 'pleroma.exemplo.com.br', 'duda'),
    };
    for (const r of Object.values(ctx.remotos)) {
      const x = await processInbox(deps, requisicao(r, { handle: HANDLE, atividade: follow(r, HANDLE), relogio: ctx.rel }));
      if (x.reason !== 'aceita-follow') throw new Error(`seguidor ${r.usuario} não entrou: ${JSON.stringify(x)}`);
    }
    for (const d of [...teste.deliveries.values()]) if (d.op === 'accept') teste.deliveries.delete(d.id);
  }
  ctx.funcao = funcaoDe(ctx);
  ctx.rodar = (over = {}) => runWorker(deps, { budgetMs: 10_000, maxJobs: 25, deliveryBatch: 8, ...over });
  ctx.chave = () => teste.handles.get(HANDLE).publicKeyPem;
  return ctx;
}

/** A Function `aoEscreverPost` (a MESMA do pacote functions/), com um banco falso que lê a casa e grava na fila do worker. */
function funcaoDe(ctx) {
  const { store, teste } = ctx;
  let seq = 0;
  const db = {
    collection: (c) => ({
      doc: (id) => ({
        get: async () => {
          if (c === 'config' && id === 'federation') {
            const p = await store.getPlatform();
            return { exists: true, data: () => ({ enabled: p.enabled, killSwitch: p.killSwitch === true }) };
          }
          return { exists: false, data: () => undefined };
        },
        create: async (d) => {
          if (c !== 'ap_outbound') throw new Error(`escrita inesperada em ${c}`);
          if (teste.jobs.has(d.id)) { const e = new Error('já existe'); e.code = 6; throw e; }
          await store.enqueueJob(d);
        },
        collection: (sub) => ({
          doc: (sid) => ({
            get: async () => {
              if (c === 'users' && sub === 'private' && sid === 'federation') {
                const a = await store.getAccount(id);
                return { exists: Boolean(a), data: () => (a ? { enabled: a.enabled, paused: a.paused } : undefined) };
              }
              return { exists: false, data: () => undefined };
            },
          }),
        }),
      }),
    }),
  };
  return (postId, antes, depois) => aoEscreverPost(db, { idDoEvento: `ev${++seq}`, postId, antes, depois, agora: ctx.deps.now() });
}

/** O documento do Firestore (o que a Function enxerga) a partir do post do nosso modelo. */
const docDe = (p) => (p ? {
  userId: p.userId, federation: p.federation, isDeleted: p.isDeleted, text: p.text, headline: p.headline ?? null, category: p.category,
  sensitive: p.sensitive, youtubeVideoId: p.youtubeVideoId, media: p.media,
} : undefined);

let numero = 0;
const postoOficial = (relogio, over = {}) => ({
  id: `OF${++numero}`, userId: OFICIAL, text: 'Comunicado oficial #Lula #Brasil', hashtags: ['#Lula', '#Brasil'], media: [],
  createdAtMs: relogio.t, updatedAtMs: null, visibility: 'public', federation: 'public', type: 'original', category: 'echo',
  isDeleted: false, hasPoll: false, sensitive: false, youtubeVideoId: null, headline: null, ...over,
});

async function publicar(ctx, over = {}) {
  const p = postoOficial(ctx.relogio, over);
  ctx.teste.seedPost(p);
  const resultado = await ctx.funcao(p.id, undefined, docDe(p));
  return { id: p.id, resultado, post: p };
}
async function editar(ctx, id, patch) {
  const antes = docDe(ctx.teste.posts.get(id));
  ctx.teste.patchPost(id, patch);
  return ctx.funcao(id, antes, docDe(ctx.teste.posts.get(id)));
}
/** Roda o worker e devolve só as entregas NOVAS (já com o JSON), sem as dos seguidores. */
async function entregar(ctx, over = {}) {
  const desde = ctx.rede.posts.length;
  const stats = await ctx.rodar(over);
  const novas = ctx.rede.posts.slice(desde).map((p) => ({ ...p, json: JSON.parse(p.body) }));
  return { stats, novas };
}
const dominiosDe = (novas) => novas.map((e) => new URL(e.url).host).sort();
const assinaturaValida = (ctx, e) => {
  const cab = signRequest({ method: 'POST', url: e.url, body: e.body, privateKeyPem: e.sign.privateKeyPem, keyId: e.sign.keyId, now: ctx.deps.now() });
  return verifyHttpSignature({ method: 'POST', path: new URL(e.url).pathname, headers: cab, body: Buffer.from(e.body), now: ctx.deps.now() }, ctx.chave()).ok;
};
const contadorDe = (ctx, nome) => ctx.teste.contadores.get(nome) ?? 0;

// ═════════════ 1. Identidade da conta no Fediverso ═════════════
{
  const ctx = await casa();
  const a = await renderActor(ctx.deps, HANDLE);
  const ator = a.body;
  confere('ATOR · responde 200 como Person do handle certo', a.status === 200 && ator.type === 'Person' && ator.preferredUsername === HANDLE && ator.id === `${ORIGEM}/ap/users/${HANDLE}`, JSON.stringify(ator).slice(0, 140));
  confere('ATOR · tem FOTO: o avatar da casa (arquivo estático) sai como `icon` (antes saía sem, e a foto não aparecia nas outras instâncias)', ator.icon?.url === `${ORIGEM}${OFFICIAL_DEFAULT_AVATAR}`, JSON.stringify(ator.icon));
  confere('ATOR · é descobrível e indexável (conta institucional existe para ser encontrada)', ator.discoverable === true && ator.indexable === true, `${ator.discoverable}/${ator.indexable}`);
  // O controle PRECISA existir de verdade: com a Ana sem federação o ator dela dava 404 e a checagem passava no vazio.
  await enableFederation(ctx.deps, 'U_ANA', { emailVerified: true });
  const ana = await renderActor(ctx.deps, 'ana_silva');
  confere('ATOR · o padrão protetor continua para as outras pessoas: o ator da Ana existe e NÃO é descobrível nem indexável', ana.status === 200 && ana.body.discoverable === false && ana.body.indexable === false, `${ana.status} ${JSON.stringify(ana.body?.discoverable)}/${JSON.stringify(ana.body?.indexable)}`);
  confere('ATOR · a chave pública bate com a reserva do handle', ator.publicKey?.publicKeyPem === ctx.chave() && ator.publicKey.owner === ator.id, 'chave diferente');
  confere('ATOR · tem inbox, outbox, seguidores e inbox compartilhado', ator.inbox?.endsWith(`/ap/users/${HANDLE}/inbox`) && ator.outbox?.endsWith(`/ap/users/${HANDLE}/outbox`) && ator.endpoints?.sharedInbox === `${ORIGEM}/ap/inbox`, JSON.stringify(ator.endpoints));
  confere('ATOR · o resumo traz a bio com a hashtag em link', String(ator.summary).includes('rel="tag"'), ator.summary);

  for (const grafia of [HANDLE, 'ExercitoDoLula', 'EXERCITODOLULA']) {
    // O mesmo caminho da rota: o recurso é normalizado (caixa) por parseWebfingerResource e só então renderizado.
    const w = await renderWebfinger(ctx.deps, parseWebfingerResource(`acct:${grafia}@exercitodolula.app`, ctx.deps.ownHost, ORIGEM));
    confere(`WEBFINGER · acct:${grafia}@exercitodolula.app → 200, sujeito em minúsculas e link para o ator`, w.status === 200 && w.body.subject === `acct:${HANDLE}@exercitodolula.app` && w.body.links.some((l) => l.rel === 'self' && l.href === `${ORIGEM}/ap/users/${HANDLE}`), JSON.stringify(w.body).slice(0, 140));
  }
  const status = await getFederationStatus({ store: ctx.store, ownHost: ctx.deps.ownHost }, OFICIAL);
  confere('STATUS · ativa e não pausada, com o endereço certo', status.enabled === true && status.paused === false && status.acct === `${HANDLE}@exercitodolula.app`, JSON.stringify(status));
}

// imagemDePerfil: o que sai como foto
{
  const deps = { origin: ORIGEM, mediaOrigin: MIDIA };
  const casos = [
    ['arquivo estático do site', '/brand/lula.png', `${ORIGEM}/brand/lula.png`],
    ['arquivo estático em subpasta, jpg', '/img/perfil/foto.JPG'.toLowerCase(), `${ORIGEM}/img/perfil/foto.jpg`],
    ['mídia pública da casa', `${MIDIA}/m/abc123`, `${MIDIA}/m/abc123`],
    ['outra origem', 'https://evil.example/avatar.png', null],
    ['protocolo relativo (outra origem)', '//evil.example/a.png', null],
    ['rota dinâmica /api', '/api/qualquer/coisa.png', null],
    ['mídia privada /mp', '/mp/abc.png', null],
    ['mídia por caminho /m (tem regra própria)', '/m/abc.png', null],
    ['sobe de pasta com ..', '/brand/../api/x.png', null],
    ['sem extensão de imagem', '/brand/lula', null],
    ['extensão não-imagem', '/brand/lula.html', null],
    ['vazio', '', null],
    ['nulo', null, null],
  ];
  for (const [nome, entrada, esperado] of casos) {
    const obtido = imagemDePerfil(deps, entrada);
    confere(`FOTO · ${nome}`, obtido === esperado, `${JSON.stringify(entrada)} → ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`);
  }
  confere('FOTO · o avatar de partida ANTIGO (/lula-icon.png) é o mesmo tipo de caminho: quem o corrige é a rota (ensureOfficialAccount), não a projeção', imagemDePerfil(deps, OFFICIAL_BROKEN_AVATAR) === `${ORIGEM}${OFFICIAL_BROKEN_AVATAR}`, 'inesperado');
}

// ═════════════ 2. Hashtags: o campo `tag` ═════════════
{
  const casos = [
    ['uma hashtag', 'oi #Lula', ['Lula']],
    ['repetida com caixa diferente (a primeira grafia vale)', '#Lula e #lula e #LULA', ['Lula']],
    ['na ordem de aparição', '#b #a #c', ['b', 'a', 'c']],
    ['acentuadas e com número/sublinhado', '#ExércitoContraMentiras #2026_vai #São_Paulo', ['ExércitoContraMentiras', '2026_vai', 'São_Paulo']],
    ['dentro de URL NÃO é hashtag', 'veja https://exemplo.com/pagina#secao e #verdade', ['verdade']],
    ['colada em palavra NÃO é hashtag', 'a#b nao e c#d, mas #sim e', ['sim']],
    ['depois de parêntese e colchete', '(#um) [#dois]', ['um', 'dois']],
    ['só o símbolo', '# # #', []],
    ['em linhas diferentes', '#a\n#b\n\n#c', ['a', 'b', 'c']],
    ['sem texto', '', []],
  ];
  for (const [nome, texto, esperado] of casos) confere(`HASHTAGS · ${nome}`, igual(hashtagsDoTexto(texto), esperado), `${JSON.stringify(hashtagsDoTexto(texto))} ≠ ${JSON.stringify(esperado)}`);
  confere('HASHTAGS · teto de 30 por nota', hashtagsDoTexto(Array.from({ length: 80 }, (_, i) => `#t${i}`).join(' ')).length === 30, 'passou do teto');
}

// ═════════════ 3. Publicar: texto, hashtags, mídia, notícia, vídeo ═════════════
{
  const ctx = await casa();
  const { relogio, rede, teste } = ctx;

  // 3a. post comum com hashtags — guardadas COM o `#`, como o app grava em produção
  const a = await publicar(ctx, { text: 'Comunicado oficial #Lula #Brasil e de novo #lula. Veja https://exercitodolula.app/pt-BR/feed#topo', hashtags: ['#Lula', '#Brasil'] });
  confere('FUNÇÃO · o post oficial novo é enfileirado como create (nada barrou: plataforma e conta ligadas)', a.resultado === 'enfileirado:create' && teste.jobs.size === 1, a.resultado);
  const job = [...teste.jobs.values()][0];
  confere('FUNÇÃO · a tarefa é do dono certo e do post certo', job.uid === OFICIAL && job.postId === a.id && job.op === 'create' && job.state === 'pending', JSON.stringify(job));

  const { stats, novas } = await entregar(ctx);
  confere('ENTREGA · 3 seguidores em 2 servidores → 2 POSTs (o do mastodon.social é UMA entrega, no inbox compartilhado)', novas.length === 2 && stats.sent === 2, `${novas.length} POSTs, ${stats.sent} enviadas`);
  confere('ENTREGA · destinos: o inbox compartilhado de cada servidor', igual(novas.map((e) => e.url).sort(), ['https://mastodon.social/inbox', 'https://pleroma.exemplo.com.br/inbox']), JSON.stringify(novas.map((e) => e.url)));
  const c = novas[0].json;
  confere('ENTREGA · é um Create de Note, do ator oficial, com o objeto atribuído a ele', c.type === 'Create' && c.actor === `${ORIGEM}/ap/users/${HANDLE}` && c.object.type === 'Note' && c.object.attributedTo === c.actor, JSON.stringify(c).slice(0, 140));
  confere('ENTREGA · alcance público: to = Public, cc = seguidores', c.to.includes(AS_PUBLIC) && c.cc.includes(`${ORIGEM}/ap/users/${HANDLE}/followers`) && igual(c.to, c.object.to), JSON.stringify({ to: c.to, cc: c.cc }));
  confere('ENTREGA · o objeto tem a URL canônica da nota e a página do post', c.object.id === `${ORIGEM}/ap/notes/${a.id}` && c.object.url === `${ORIGEM}/pt-BR/post/${a.id}`, JSON.stringify({ id: c.object.id, url: c.object.url }));
  confere('ENTREGA · toda entrega tem assinatura verificável com a chave PÚBLICA do ator e o keyId dele', novas.every((e) => assinaturaValida(ctx, e) && e.sign.keyId === `${ORIGEM}/ap/users/${HANDLE}#main-key`), 'assinatura não confere');
  confere('ENTREGA · o post fica registrado como federado', (await ctx.store.getObject(a.id))?.state === 'federated', JSON.stringify(await ctx.store.getObject(a.id)));
  confere('ENTREGA · sem falha, sem barulho: nenhum log do worker numa entrega que deu certo', ctx.logs.length === 0, JSON.stringify(ctx.logs));

  // as hashtags: sem `##` (bug confirmado em produção: `"name":"##ExercitoContraMentiras"`, href `.../tag/%23Exercito...`)
  const tags = c.object.tag;
  confere('HASHTAGS · saem como objetos Hashtag, UMA por hashtag (Lula e lula são a mesma), na ordem do texto', igual(tags.map((x) => x.type), ['Hashtag', 'Hashtag']) && igual(tags.map((x) => x.name), ['#Lula', '#Brasil']), JSON.stringify(tags));
  confere('HASHTAGS · nenhum nome começa com `##` e nenhum href leva `%23`', tags.every((x) => !x.name.startsWith('##') && !x.href.includes('%23')), JSON.stringify(tags));
  confere('HASHTAGS · o href é a página da hashtag na nossa casa', tags[0].href === `${ORIGEM}/pt-BR/tag/Lula`, tags[0].href);
  confere('HASHTAGS · o link no corpo e o `tag` concordam (a mesma hashtag, o mesmo endereço)', c.object.content.includes(`href="${ORIGEM}/pt-BR/tag/Lula"`) && c.object.content.includes('rel="tag"'), c.object.content);
  confere('HASHTAGS · o `#` dentro da URL do texto não vira hashtag nem link de hashtag', !c.object.content.includes('tag/topo') && !tags.some((x) => x.name === '#topo'), c.object.content);

  // a outbox mostra o post
  const out = await renderOutbox(ctx.deps, HANDLE, null);
  confere('OUTBOX · a coleção diz que tem 1 item e aponta a primeira página', out.status === 200 && out.body.totalItems === 1 && Boolean(out.body.first), JSON.stringify(out.body).slice(0, 140));
  const pg = await renderOutbox(ctx.deps, HANDLE, { before: null });
  const item = pg.body.orderedItems?.[0];
  confere('OUTBOX · a primeira página traz o Create do post, com as hashtags certas', pg.status === 200 && item?.type === 'Create' && item.object.id === `${ORIGEM}/ap/notes/${a.id}` && item.object.tag?.[0]?.name === '#Lula', JSON.stringify(item).slice(0, 160));
  const nota = await renderNote(ctx.deps, a.id);
  confere('NOTA · GET /ap/notes/:id serve o objeto público com a mesma `tag`', nota.status === 200 && nota.body.id === `${ORIGEM}/ap/notes/${a.id}` && igual(nota.body.tag, c.object.tag), `${nota.status}`);

  // 3b. mídia: a da casa sai; a de fora e o 9º anexo NÃO saem — e agora ficam registrados
  relogio.avanca(1000);
  const m = await publicar(ctx, {
    text: 'Foto do ato', hashtags: [],
    media: [
      { url: `${MIDIA}/m/img1`, type: 'image', alt: 'Multidão na avenida' },
      { url: `${MIDIA}/m/vid1`, type: 'video', alt: null },
      { url: 'https://firebasestorage.googleapis.com/v0/b/x/o/media%2Ffoto.jpg?alt=media&token=abc', type: 'image', alt: null },
    ],
  });
  const logsAntes = ctx.logs.length;
  const mm = await entregar(ctx);
  const notaM = mm.novas[0].json.object;
  confere('MÍDIA · a mídia da casa sai como anexo, com tipo e texto alternativo', notaM.attachment.length === 2 && notaM.attachment[0].url === `${MIDIA}/m/img1` && notaM.attachment[0].name === 'Multidão na avenida' && notaM.attachment[1].mediaType === 'video/mp4', JSON.stringify(notaM.attachment));
  confere('MÍDIA · a de FORA (URL do Firebase, com token) não sai: publicar isso seria entregar a URL privada ao mundo', !JSON.stringify(notaM).includes('firebasestorage'), JSON.stringify(notaM.attachment));
  const omitidas = ctx.logs.slice(logsAntes).filter((e) => e.event === 'ap.media.omitted');
  confere('MÍDIA · ...e o que ficou de fora DEIXA RASTRO: contador, log estruturado e auditoria (antes: nada)', contadorDe(ctx, 'worker.midia-omitida') === 1 && omitidas.length === 1 && omitidas[0].count === 1 && omitidas[0].postId === m.id && teste.audit.some((e) => e.decision === 'midia-omitida'), JSON.stringify({ c: contadorDe(ctx, 'worker.midia-omitida'), omitidas }));
  confere('MÍDIA · o log não leva URL de mídia nem corpo de atividade', !JSON.stringify(omitidas).includes('firebasestorage') && !JSON.stringify(omitidas).includes('"object"'), JSON.stringify(omitidas));

  // 3c. mídia sem texto
  relogio.avanca(1000);
  await publicar(ctx, { text: '', hashtags: [], media: [{ url: `${MIDIA}/m/solo`, type: 'image', alt: null }] });
  const solo = (await entregar(ctx)).novas[0].json.object;
  confere('MÍDIA SEM TEXTO · sai a nota com o anexo e conteúdo vazio', solo.attachment.length === 1 && solo.content === '', JSON.stringify({ a: solo.attachment.length, c: solo.content }));

  // 3d. vídeo do YouTube: o link entra no corpo
  relogio.avanca(1000);
  await publicar(ctx, { text: 'Assista', hashtags: [], youtubeVideoId: 'dQw4w9WgXcQ' });
  const yt = (await entregar(ctx)).novas[0].json.object;
  confere('YOUTUBE · o link do vídeo entra no corpo (a nota não tem como "anexar" um vídeo externo)', yt.content.includes('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), yt.content);

  // 3e. sensível
  relogio.avanca(1000);
  await publicar(ctx, { text: 'Imagem forte', hashtags: [], sensitive: true, media: [{ url: `${MIDIA}/m/forte`, type: 'image', alt: null }] });
  confere('SENSÍVEL · a marca `sensitive` sai na nota', (await entregar(ctx)).novas[0].json.object.sensitive === true, 'não marcou');

  // 3f. notícia: o ARTIGO INTEIRO vai na nota (manchete em negrito + corpo), e o endereço fica só no campo `url`.
  relogio.avanca(1000);
  const longo = `${'Texto da matéria. '.repeat(40)}#CorteNoFim`;
  const n = await publicar(ctx, { category: 'news', headline: 'Reunião nacional confirmada #Mobilização', text: longo, hashtags: ['#Mobilização', '#CorteNoFim'] });
  const nn = (await entregar(ctx)).novas[0].json.object;
  const corpoPuro = nn.content.replace(/<[^>]+>/g, '|').replace(/&amp;/g, '&');
  confere('NOTÍCIA · a manchete abre a nota, em negrito', nn.content.startsWith('<p><strong>Reunião nacional confirmada'), nn.content.slice(0, 120));
  confere('NOTÍCIA · o corpo vai INTEIRO: sem corte em 360 e sem reticências (quem lê no Mastodon não precisa abrir o site)',
    !nn.content.includes('...') && nn.content.includes('#CorteNoFim') && corpoPuro.length > 600,
    `${corpoPuro.length} caracteres: ${nn.content.slice(0, 120)}`);
  confere('NOTÍCIA · o endereço canônico fica no campo `url`, e NÃO enfiado no texto',
    nn.url === `${ORIGEM}/pt-BR/post/${n.id}` && !nn.content.includes(`${ORIGEM}/pt-BR/post/${n.id}`),
    `url=${nn.url}`);
  confere('NOTÍCIA · `tag` traz as hashtags que o leitor VÊ — e agora ele vê o texto todo, inclusive a do fim',
    igual(nn.tag.filter((x) => x.type === 'Hashtag').map((x) => x.name).sort(), ['#CorteNoFim', '#Mobilização']),
    JSON.stringify(nn.tag));
  void corpoPuro;

  // 3g. alcances
  relogio.avanca(1000);
  await publicar(ctx, { text: 'Só quem segue', hashtags: [], federation: 'followers' });
  const seg = (await entregar(ctx)).novas[0].json;
  confere('ALCANCE · "só seguidores": to = seguidores, sem Público', seg.to.includes(`${ORIGEM}/ap/users/${HANDLE}/followers`) && !seg.to.includes(AS_PUBLIC) && !seg.cc.includes(AS_PUBLIC), JSON.stringify({ to: seg.to, cc: seg.cc }));
  relogio.avanca(1000);
  await publicar(ctx, { text: 'Não listado', hashtags: [], federation: 'unlisted' });
  const nl = (await entregar(ctx)).novas[0].json;
  confere('ALCANCE · "não listado": to = seguidores, cc = Público', nl.to.includes(`${ORIGEM}/ap/users/${HANDLE}/followers`) && nl.cc.includes(AS_PUBLIC), JSON.stringify({ to: nl.to, cc: nl.cc }));
  relogio.avanca(1000);
  const loc = await publicar(ctx, { text: 'Só aqui', hashtags: [], federation: 'local' });
  confere('ALCANCE · "local": a Function NÃO enfileira (o post nunca sai da casa)', loc.resultado === 'ignorado' && (await entregar(ctx)).novas.length === 0, loc.resultado);
  void rede;
}

// ═════════════ 4. Menção (limite conhecido) ═════════════
{
  const ctx = await casa();
  await publicar(ctx, { text: 'Obrigado @fulano@mastodon.social pelo apoio #Lula', hashtags: ['#Lula'] });
  const nota = (await entregar(ctx)).novas[0].json.object;
  confere('LIMITE CONHECIDO · menção a pessoa de outro servidor sai como TEXTO: sem tag Mention e sem o ator no cc (a pessoa não é notificada). Implementar exige resolver o WebFinger e entregar ao inbox dela', !nota.tag.some((x) => x.type === 'Mention') && nota.cc.every((x) => !x.includes('fulano')), JSON.stringify(nota.tag));
}

// ═════════════ 5. Edição ═════════════
{
  const ctx = await casa();
  const { relogio } = ctx;
  const a = await publicar(ctx, { text: 'Reunião às 10h #Lula', hashtags: ['#Lula'] });
  await entregar(ctx);

  relogio.avanca(60_000);
  confere('EDIÇÃO · só contador (curtida) não vira nada', (await editar(ctx, a.id, { likes: 5 })) === 'ignorado', 'virou tarefa');
  relogio.avanca(60_000);
  const r = await editar(ctx, a.id, { text: 'Reunião ADIADA para as 15h #Lula #Atualização', hashtags: ['#Lula', '#Atualização'], updatedAtMs: relogio.t });
  confere('EDIÇÃO · mudar o texto vira Update', r === 'enfileirado:update', r);
  const up = await entregar(ctx);
  const u = up.novas[0]?.json;
  confere('EDIÇÃO · chega aos 2 servidores como Update da MESMA nota, com o texto novo, as tags novas e `updated`', up.novas.length === 2 && u.type === 'Update' && u.object.id === `${ORIGEM}/ap/notes/${a.id}` && u.object.content.includes('ADIADA') && Boolean(u.object.updated) && igual(u.object.tag.map((x) => x.name), ['#Lula', '#Atualização']), JSON.stringify(u).slice(0, 160));
  confere('EDIÇÃO · o Update é assinado e verificável', up.novas.every((e) => assinaturaValida(ctx, e)), 'assinatura não confere');

  // notícia: corrigir SÓ a manchete
  relogio.avanca(60_000);
  const n = await publicar(ctx, { category: 'news', headline: 'Ato é na terça', text: 'Detalhes do ato.', hashtags: [] });
  await entregar(ctx);
  relogio.avanca(60_000);
  const rn = await editar(ctx, n.id, { headline: 'Ato é na QUARTA', updatedAtMs: relogio.t });
  confere('EDIÇÃO · corrigir só a MANCHETE de uma notícia vira Update (antes era ignorado e o Fediverso ficava com a manchete errada)', rn === 'enfileirado:update', rn);
  const un = (await entregar(ctx)).novas[0]?.json;
  confere('EDIÇÃO · e o Update leva a manchete nova', un?.type === 'Update' && un.object.content.includes('Ato é na QUARTA') && !un.object.content.includes('na terça'), JSON.stringify(un?.object?.content));

  // editar ANTES de o Create sair: o Create leva o conteúdo mais novo e o Update não vai sozinho
  relogio.avanca(60_000);
  const b = await publicar(ctx, { text: 'Versão 1', hashtags: [] });
  relogio.avanca(1000);
  await editar(ctx, b.id, { text: 'Versão 2', updatedAtMs: relogio.t });
  const duplo = await entregar(ctx);
  const tipos = duplo.novas.map((e) => e.json.type);
  const primeiroPorServidor = [...new Set(duplo.novas.map((e) => new URL(e.url).host))].map((h) => duplo.novas.find((e) => new URL(e.url).host === h).json.type);
  confere('EDIÇÃO · editar antes de o Create sair: o primeiro a chegar a cada servidor é o Create, e NADA leva a versão antiga (o Update que sobra é redundante, mas igual)', primeiroPorServidor.every((x) => x === 'Create') && duplo.novas.every((e) => e.json.object.content.includes('Versão 2') && !e.json.object.content.includes('Versão 1')), JSON.stringify(tipos));
}

// ═════════════ 6. Exclusão ═════════════
{
  const ctx = await casa();
  const { relogio } = ctx;

  // apagar (tombstone)
  const a = await publicar(ctx, { text: 'Vou apagar', hashtags: [] });
  await entregar(ctx);
  relogio.avanca(60_000);
  const r = await editar(ctx, a.id, { isDeleted: true });
  confere('EXCLUSÃO · apagar o post (tombstone) vira delete', r === 'enfileirado:delete', r);
  const d = await entregar(ctx);
  confere('EXCLUSÃO · chega aos 2 servidores como Delete do objeto, assinado', d.novas.length === 2 && d.novas.every((e) => e.json.type === 'Delete' && String(e.json.object?.id ?? e.json.object) === `${ORIGEM}/ap/notes/${a.id}` && assinaturaValida(ctx, e)), JSON.stringify(d.novas[0]?.json).slice(0, 160));
  const nota = await renderNote(ctx.deps, a.id);
  confere('EXCLUSÃO · a URL do objeto deixa de servir o conteúdo (Tombstone 410 ou 404)', nota.status === 410 || nota.status === 404, `${nota.status}`);
  const pg = await renderOutbox(ctx.deps, HANDLE, { before: null });
  confere('EXCLUSÃO · a outbox não lista mais o post', !(pg.body.orderedItems ?? []).some((x) => x.object?.id === `${ORIGEM}/ap/notes/${a.id}`), JSON.stringify(pg.body.orderedItems?.map((x) => x.object?.id)));

  // apagar de vez (documento removido)
  relogio.avanca(60_000);
  const b = await publicar(ctx, { text: 'Apagar de vez', hashtags: [] });
  await entregar(ctx);
  relogio.avanca(60_000);
  const antes = docDe(ctx.teste.posts.get(b.id));
  ctx.teste.removePost(b.id);
  const rb = await ctx.funcao(b.id, antes, undefined);
  confere('EXCLUSÃO · documento removido de vez também vira delete', rb === 'enfileirado:delete', rb);
  const db = await entregar(ctx);
  confere('EXCLUSÃO · ...e o Delete SAI mesmo sem o post no banco (o worker usa o registro do que foi entregue)', db.novas.length === 2 && db.novas.every((e) => e.json.type === 'Delete'), `${db.novas.length} entregas: ${JSON.stringify(db.novas.map((e) => e.json.type))}`);

  // retirar do Fediverso (alcance vira local)
  relogio.avanca(60_000);
  const c = await publicar(ctx, { text: 'Retirar do Fediverso', hashtags: [] });
  await entregar(ctx);
  relogio.avanca(60_000);
  const rc = await editar(ctx, c.id, { federation: 'local' });
  confere('EXCLUSÃO · retirar do Fediverso (alcance vira local) vira delete', rc === 'enfileirado:delete', rc);
  confere('EXCLUSÃO · ...e o Delete sai', (await entregar(ctx)).novas.every((e) => e.json.type === 'Delete'), 'não saiu');

  // apagar com a conta PAUSADA: o Delete sai mesmo assim (não se prende ninguém a uma cópia que quer retirar)
  relogio.avanca(60_000);
  const e = await publicar(ctx, { text: 'Apagar pausada', hashtags: [] });
  await entregar(ctx);
  await pauseFederation(ctx.deps, OFICIAL);
  relogio.avanca(60_000);
  const re = await editar(ctx, e.id, { isDeleted: true });
  const de = await entregar(ctx);
  confere('EXCLUSÃO · conta PAUSADA: o Delete de algo que já saiu é enfileirado e entregue mesmo assim', re === 'enfileirado:delete' && de.novas.length === 2 && de.novas.every((x) => x.json.type === 'Delete'), `${re} / ${de.novas.length}`);

  // apagar o que NUNCA saiu: nada a retirar
  await resumeFederation(ctx.deps, OFICIAL);
  relogio.avanca(60_000);
  const f = await publicar(ctx, { text: 'Nunca saiu', hashtags: [], createdAtMs: T0 - 10 }); // anterior à ativação: o Create é barrado
  await entregar(ctx);
  relogio.avanca(60_000);
  await editar(ctx, f.id, { isDeleted: true });
  confere('EXCLUSÃO · apagar o que nunca saiu não manda Delete a ninguém', (await entregar(ctx)).novas.length === 0, 'mandou Delete de algo que nunca saiu');
}

// ═════════════ 7. O portão, e o rastro do que ele barra ═════════════
{
  const ctx = await casa();
  const { relogio, teste } = ctx;

  // eligibleSince: o instante exato da ativação passa; um instante antes, não
  const conta = await ctx.store.getAccount(OFICIAL);
  const noLimite = await publicar(ctx, { text: 'No instante da ativação', hashtags: [], createdAtMs: conta.eligibleSince });
  const r1 = await entregar(ctx);
  confere('PORTÃO · post criado EXATAMENTE em `eligibleSince` sai (o limite é aberto: `<`)', r1.novas.length === 2, `${r1.novas.length}`);
  void noLimite;

  relogio.avanca(1000);
  const antigo = await publicar(ctx, { text: 'Anterior à ativação', hashtags: [], createdAtMs: conta.eligibleSince - 1 });
  const logsAntes = ctx.logs.length;
  const r2 = await entregar(ctx);
  confere('PORTÃO · post anterior à ativação NÃO sai (religar/ativar nunca federa o passado)', r2.novas.length === 0 && (await ctx.store.getObject(antigo.id)) === null, `${r2.novas.length}`);
  const pulos = ctx.logs.slice(logsAntes).filter((e) => e.event === 'ap.job.skipped');
  confere('PORTÃO · ...e o pulo DEIXA RASTRO: log estruturado com o motivo, auditoria e contador (antes: só o contador)', pulos.length === 1 && pulos[0].reason === 'anterior-a-ativacao' && pulos[0].postId === antigo.id && teste.audit.some((e) => e.decision === 'pulada' && e.reason === 'create:anterior-a-ativacao') && contadorDe(ctx, 'worker.pulada.anterior-a-ativacao') === 1, JSON.stringify(pulos));
  const job = [...teste.jobs.values()].find((j) => j.postId === antigo.id);
  confere('PORTÃO · a tarefa fica como "skipped" com o motivo (não volta a ser tentada)', job?.state === 'skipped' && job.note === 'anterior-a-ativacao', JSON.stringify(job));

  // plataforma desligada na hora de publicar: a Function nem enfileira
  await ctx.store.setPlatform({ enabled: false });
  relogio.avanca(1000);
  const semPlataforma = await publicar(ctx, { text: 'Plataforma desligada', hashtags: [] });
  confere('PORTÃO · plataforma DESLIGADA: a Function não enfileira, e ligar depois não federa o passado', semPlataforma.resultado === 'plataforma-desligada' && ![...teste.jobs.values()].some((j) => j.postId === semPlataforma.id), semPlataforma.resultado);
  await ctx.store.setPlatform({ enabled: true });

  // botão de emergência com tarefa já na fila: nada sai e a fila FICA
  relogio.avanca(1000);
  const comTarefa = await publicar(ctx, { text: 'Antes do botão', hashtags: [] });
  await ctx.store.setPlatform({ killSwitch: true });
  const rk = await entregar(ctx);
  confere('PORTÃO · botão de emergência com a tarefa na fila: nada sai e a tarefa continua pendente', rk.novas.length === 0 && teste.jobs.get([...teste.jobs.values()].find((j) => j.postId === comTarefa.id).id).state === 'pending', 'saiu ou foi descartada');
  await ctx.store.setPlatform({ killSwitch: false });
  confere('PORTÃO · desligado o botão, a tarefa que ficou na fila sai', (await entregar(ctx)).novas.length === 2, 'não saiu');

  // pausa com entregas já criadas: são CANCELADAS (o portão roda de novo no envio)
  relogio.avanca(1000);
  await publicar(ctx, { text: 'Pausa no meio', hashtags: [] });
  await ctx.rodar({ budgetMs: 10_000, maxJobs: 25, deliveryBatch: 0 }); // expande, mas não entrega nada
  await pauseFederation(ctx.deps, OFICIAL);
  const rp = await entregar(ctx);
  confere('PORTÃO · conta pausada depois de expandir: as entregas são CANCELADAS, nenhuma sai', rp.novas.length === 0 && rp.stats.cancelled === 2 && contadorDe(ctx, 'entrega.cancelada.conta-pausada') === 2, JSON.stringify(rp.stats));
  confere('PORTÃO · ...e cada cancelamento tem auditoria com o domínio', teste.audit.filter((e) => e.kind === 'delivery' && e.decision === 'cancelada').length >= 2, 'sem auditoria');

  // religar não federa o passado: o que foi publicado durante a pausa não sai
  relogio.avanca(1000);
  const duranteAPausa = await publicar(ctx, { text: 'Durante a pausa', hashtags: [] });
  confere('PORTÃO · conta pausada: a Function não enfileira', duranteAPausa.resultado === 'conta-inativa', duranteAPausa.resultado);
  relogio.avanca(1000);
  await resumeFederation(ctx.deps, OFICIAL);
  relogio.avanca(1000);
  const depois = await publicar(ctx, { text: 'Depois de retomar', hashtags: [] });
  const rr = await entregar(ctx);
  confere('PORTÃO · retomada: o que veio depois sai; o que ficou na pausa NÃO é federado depois (ADR-AP-6)', rr.novas.length === 2 && rr.novas.every((e) => e.json.object.id.endsWith(depois.id)), JSON.stringify(rr.novas.map((e) => e.json.object?.id)));
}

// ═════════════ 8. Quando a entrega falha ═════════════
{
  const ctx = await casa();
  const { relogio, rede, teste } = ctx;

  // 8a. um servidor recusa a assinatura (401), o outro aceita
  rede.respostaPost = (url) => (url.startsWith('https://mastodon.social') ? { status: 401, unsafe: false } : { status: 202, unsafe: false });
  const a = await publicar(ctx, { text: 'Teste de assinatura', hashtags: [] });
  const r1 = await entregar(ctx);
  confere('FALHA · 401 do mastodon.social não atrapalha o pleroma: uma enviada, uma reagendada (isolamento por servidor)', r1.stats.sent === 1 && r1.stats.retried === 1, JSON.stringify(r1.stats));
  const f1 = ctx.logs.filter((e) => e.event === 'ap.delivery.failed');
  confere('FALHA · o 401 vira log estruturado de ERRO, com domínio, operação, status, CLASSE `assinatura` e o tempo até a próxima tentativa', f1.length === 1 && f1[0].level === 'error' && f1[0].domain === 'mastodon.social' && f1[0].op === 'create' && f1[0].status === 401 && f1[0].failureClass === 'assinatura' && f1[0].attempts === 1 && f1[0].retryInSeconds > 0, JSON.stringify(f1));
  confere('FALHA · o log NÃO leva corpo da atividade, URL de inbox nem chave', f1.every((e) => !('body' in e) && !('targetInbox' in e) && !JSON.stringify(e).includes('/inbox') && !JSON.stringify(e).includes('PRIVATE')), JSON.stringify(f1));
  confere('FALHA · contador por classe: entrega.falha.assinatura = 1 (e nenhuma outra classe)', contadorDe(ctx, 'entrega.falha.assinatura') === 1 && contadorDe(ctx, 'entrega.falha.servidor') === 0 && contadorDe(ctx, 'entrega.falha.rede') === 0, JSON.stringify([...teste.contadores.entries()].filter(([k]) => k.startsWith('entrega.falha'))));

  // 8b. insiste até desistir (401: no máximo 3 tentativas) e a morte tem rastro completo
  relogio.avanca(DOIS_DIAS);
  await entregar(ctx);
  relogio.avanca(DOIS_DIAS);
  const r3 = await entregar(ctx);
  confere('FALHA · 401 desiste na 3ª tentativa (não martela um servidor que nos recusa)', r3.stats.dead === 1, JSON.stringify(r3.stats));
  const morta = ctx.logs.filter((e) => e.event === 'ap.delivery.dead');
  confere('FALHA · a morte vira log de ERRO com o motivo, a classe e as tentativas', morta.length === 1 && morta[0].level === 'error' && morta[0].reason === 'tentativas-esgotadas' && morta[0].failureClass === 'assinatura' && morta[0].attempts === 3 && morta[0].domain === 'mastodon.social', JSON.stringify(morta));
  const auditada = teste.audit.find((e) => e.kind === 'delivery' && e.decision === 'morta');
  confere('FALHA · a auditoria da morte diz o que o servidor respondeu (antes: só "tentativas-esgotadas", sem separar 401 de 503)', auditada?.reason === 'tentativas-esgotadas (HTTP 401)' && auditada.domain === 'mastodon.social', JSON.stringify(auditada));
  confere('FALHA · contadores da morte: por motivo e por classe', contadorDe(ctx, 'entrega.morta.tentativas-esgotadas') === 1 && contadorDe(ctx, 'entrega.morta-classe.assinatura') === 1 && contadorDe(ctx, 'entrega.falha.assinatura') === 3, JSON.stringify([...teste.contadores.entries()].filter(([k]) => k.startsWith('entrega.'))));

  // 8c. a "caixa de mortos": o que a administração enxerga, e o reagendamento
  const lista = await listDeliveriesForUser({ store: ctx.store }, OFICIAL, 50);
  const saude = summarizeDeliveries(lista);
  confere('MORTAS · o resumo conta o estado das entregas, a morta, o domínio com problema e as recusas de assinatura', saude.total === 2 && saude.byStatus.sent === 1 && saude.byStatus.dead === 1 && saude.signatureRejected === 1 && saude.dead[0]?.domain === 'mastodon.social' && saude.domainsWithTrouble[0]?.domain === 'mastodon.social', JSON.stringify(saude));
  confere('MORTAS · a morta mostra o que o destino respondeu, sem corpo nem URL de inbox', String(saude.dead[0]?.detail).includes('HTTP 401') && !JSON.stringify(saude).includes('/inbox'), JSON.stringify(saude.dead));
  const idMorta = saude.dead[0].id;
  confere('MORTAS · reagendar uma entrega que NÃO é da conta é recusado como inexistente', (await retryDeliveryForUser(ctx.deps, 'U_ANA', idMorta)) === 'inexistente', 'reagendou de outra pessoa');
  rede.respostaPost = () => ({ status: 202, unsafe: false });
  confere('MORTAS · reagendar a morta funciona', (await retryDeliveryForUser(ctx.deps, OFICIAL, idMorta)) === 'reagendada', 'não reagendou');
  const rr = await entregar(ctx);
  confere('MORTAS · consertado o servidor, a entrega reagendada SAI', rr.novas.length === 1 && rr.stats.sent === 1 && new URL(rr.novas[0].url).host === 'mastodon.social', JSON.stringify(rr.stats));
  void a;
}
{
  // 8d. servidor fora do ar (500): reentrega com espera crescente até esgotar 8 tentativas; classe `servidor`
  const ctx = await casa();
  const { relogio, rede, teste } = ctx;
  rede.respostaPost = (url) => (url.startsWith('https://pleroma') ? { status: 500, unsafe: false } : { status: 202, unsafe: false });
  await publicar(ctx, { text: 'Servidor caído', hashtags: [] });
  let mortas = 0;
  let rodadas = 0;
  for (; rodadas < 12 && mortas === 0; rodadas++) {
    const r = await entregar(ctx);
    mortas += r.stats.dead;
    relogio.avanca(DOIS_DIAS);
  }
  confere('FALHA 5xx · desiste depois de 8 tentativas no total', mortas === 1 && rodadas === 8, `${mortas} morta(s) em ${rodadas} rodada(s)`);
  confere('FALHA 5xx · classe `servidor` em todas as 8, e a morte com a classe certa', contadorDe(ctx, 'entrega.falha.servidor') === 8 && contadorDe(ctx, 'entrega.morta-classe.servidor') === 1 && ctx.logs.filter((e) => e.event === 'ap.delivery.failed' && e.failureClass === 'servidor').every((e) => e.level === 'warn'), JSON.stringify([...teste.contadores.entries()].filter(([k]) => k.startsWith('entrega.'))));
  confere('FALHA 5xx · 5xx é "warn" enquanto reentrega e "error" só quando morre (assinatura é error desde a 1ª)', ctx.logs.filter((e) => e.event === 'ap.delivery.dead').length === 1 && ctx.logs.filter((e) => e.level === 'error').length === 1, JSON.stringify(ctx.logs.map((e) => `${e.level}:${e.event}`)));
}
{
  // 8e. 429 com Retry-After, falha de rede e 403 (bloqueio)
  const ctx = await casa();
  const { relogio, rede } = ctx;
  rede.respostaPost = (url) => (url.startsWith('https://pleroma') ? { status: 429, unsafe: false, retryAfter: '7200' } : { status: null, unsafe: false, errorDetail: 'tempo esgotado' });
  await publicar(ctx, { text: 'Limite e rede', hashtags: [] });
  await entregar(ctx);
  const falhas = ctx.logs.filter((e) => e.event === 'ap.delivery.failed');
  const porDominio = Object.fromEntries(falhas.map((e) => [e.domain, e]));
  confere('FALHA 429 · classe `limite`, e o Retry-After pedido (2 h) é respeitado como espera mínima', porDominio['pleroma.exemplo.com.br']?.failureClass === 'limite' && porDominio['pleroma.exemplo.com.br'].retryInSeconds >= 7200, JSON.stringify(porDominio['pleroma.exemplo.com.br']));
  confere('FALHA REDE · sem resposta: classe `rede`, status nulo', porDominio['mastodon.social']?.failureClass === 'rede' && porDominio['mastodon.social'].status === null, JSON.stringify(porDominio['mastodon.social']));

  const c2 = await casa();
  c2.rede.respostaPost = () => ({ status: 403, unsafe: false });
  await publicar(c2, { text: 'Bloqueio', hashtags: [] });
  await entregar(c2);
  confere('FALHA 403 · classe `bloqueio` (a instância nos conhece e recusou), distinta da assinatura', c2.logs.some((e) => e.event === 'ap.delivery.failed' && e.failureClass === 'bloqueio') && !c2.logs.some((e) => e.failureClass === 'assinatura'), JSON.stringify(c2.logs.map((e) => e.failureClass)));
  void relogio;
}

// classificação, em tabela
{
  const tabela = [
    [401, 'retry', 'assinatura'], [403, 'retry', 'bloqueio'], [null, 'retry', 'rede'], [408, 'retry', 'limite'], [425, 'retry', 'limite'], [429, 'retry', 'limite'],
    [500, 'retry', 'servidor'], [502, 'retry', 'servidor'], [503, 'retry', 'servidor'], [400, 'permanent', 'recusada'], [404, 'permanent', 'recusada'], [422, 'permanent', 'recusada'],
    [410, 'gone', 'removida'], [301, 'permanent', 'recusada'], [202, 'unsafe', 'insegura'], [null, 'unsafe', 'insegura'],
  ];
  for (const [status, resultado, classe] of tabela) confere(`CLASSE · HTTP ${status} (${resultado}) → ${classe}`, failureClassOf(status, resultado) === classe, failureClassOf(status, resultado));
}

// ═════════════ 9. Sem seguidores ainda (a situação REAL de hoje em produção) ═════════════
{
  const ctx = await casa({ seguidores: false });
  const a = await publicar(ctx, { text: 'Primeiro post #Lula', hashtags: ['#Lula'] });
  const r = await entregar(ctx);
  confere('SEM SEGUIDORES · nenhuma entrega, mas a tarefa termina (`sem-destinos`) e o post fica registrado como federado', r.novas.length === 0 && [...ctx.teste.jobs.values()][0].state === 'done' && [...ctx.teste.jobs.values()][0].note === 'sem-destinos' && (await ctx.store.getObject(a.id))?.state === 'federated', JSON.stringify([...ctx.teste.jobs.values()][0]));
  const out = await renderOutbox(ctx.deps, HANDLE, { before: null });
  confere('SEM SEGUIDORES · mesmo assim o post aparece na outbox (quem seguir depois o enxerga ao abrir o perfil)', out.body.orderedItems?.length === 1 && out.body.orderedItems[0].object.tag?.[0]?.name === '#Lula', JSON.stringify(out.body).slice(0, 120));
  // um seguidor chega DEPOIS: não recebe o passado por entrega, mas o próximo post chega a ele
  const bia = await criarRemoto(ctx.rede, 'mastodon.social', 'bia');
  const x = await processInbox(ctx.deps, requisicao(bia, { handle: HANDLE, atividade: follow(bia, HANDLE), relogio: ctx.rel }));
  confere('SEM SEGUIDORES · o primeiro seguidor remoto é aceito', x.reason === 'aceita-follow', JSON.stringify(x));
  await entregar(ctx); // o Accept
  ctx.relogio.avanca(1000);
  await publicar(ctx, { text: 'Segundo post', hashtags: [] });
  const r2 = await entregar(ctx);
  confere('SEM SEGUIDORES · o post seguinte chega ao novo seguidor (e só ele; o primeiro não é reenviado)', r2.novas.length === 1 && r2.novas[0].json.type === 'Create' && r2.novas[0].json.object.content.includes('Segundo post'), JSON.stringify(r2.novas.map((e) => e.json.type)));
}

// ═════════════ 10. Entrada da API oficial (validação) ═════════════
{
  const ctx = { mediaOrigin: MIDIA };
  const ok = (corpo) => parseOfficialPost(corpo, ctx);
  const erro = (corpo) => { const r = parseOfficialPost(corpo, ctx); return r.ok ? null : r.error; };
  const propria = { url: `${MIDIA}/m/abc`, type: 'image' };

  const feliz = ok({ text: 'Olá #Lula', media: [{ ...propria, alt: ' Foto ' }], allowReposts: false, replyPermission: 'followed', location: { name: 'São Paulo', state: 'sp', ibgeId: 3550308 }, federation: 'unlisted', sensitive: true });
  confere('ENTRADA · um post completo e válido é aceito e normalizado', feliz.ok && feliz.post.federation === 'unlisted' && feliz.post.allowReposts === false && feliz.post.replyPermission === 'followed' && feliz.post.media[0].alt === 'Foto' && feliz.post.location.state === 'SP' && feliz.post.sensitive === true, JSON.stringify(feliz));
  confere('ENTRADA · padrões: alcance público, todos respondem, repost liberado, categoria echo', igual([ok({ text: 'x' }).post.federation, ok({ text: 'x' }).post.replyPermission, ok({ text: 'x' }).post.allowReposts, ok({ text: 'x' }).post.category], ['public', 'everyone', true, 'echo']), JSON.stringify(ok({ text: 'x' })));
  confere('ENTRADA · "sensível" sem mídia não vale (como antes)', ok({ text: 'x', sensitive: true }).post.sensitive === false, 'marcou sensível sem mídia');
  confere('ENTRADA · a mídia só sai com `url`, `type` e `alt` (nada além é gravado)', igual(Object.keys(ok({ text: 'x', media: [{ ...propria, 'data-ai-hint': 'x', segredo: 1 }] }).post.media[0]), ['url', 'type']), JSON.stringify(ok({ text: 'x', media: [{ ...propria, segredo: 1 }] })));

  const recusas = [
    ['sem conteúdo nenhum', { text: '   ' }, 'conteudo-vazio'],
    ['mídia de fora com alcance público (iria SEM a imagem)', { text: 'x', media: [{ url: 'https://exemplo.com/a.jpg', type: 'image' }] }, 'midia-nao-federavel'],
    ['mídia do Firebase com token', { text: 'x', media: [{ url: 'https://firebasestorage.googleapis.com/v0/b/x/o/a.jpg?token=1', type: 'image' }] }, 'midia-nao-federavel'],
    ['mídia privada (/mp)', { text: 'x', media: [{ url: '/mp/abc', type: 'image' }] }, 'midia-nao-federavel'],
    ['9 anexos (o Fediverso leva 8; o 9º sumiria)', { text: 'x', media: Array.from({ length: 9 }, (_, i) => ({ url: `${MIDIA}/m/i${i}`, type: 'image' })) }, 'midia-nao-federavel'],
    ['anexo que não é objeto', { text: 'x', media: ['a'] }, 'midia-invalida'],
    ['tipo de anexo inválido', { text: 'x', media: [{ url: `${MIDIA}/m/a`, type: 'file' }] }, 'midia-invalida'],
    ['media que não é lista', { text: 'x', media: 'a' }, 'midia-invalida'],
    ['texto alternativo enorme', { text: 'x', media: [{ ...propria, alt: 'a'.repeat(1501) }] }, 'midia-invalida'],
    ['texto enorme', { text: 'a'.repeat(5001) }, 'texto-longo'],
    ['vídeo do YouTube inválido', { text: 'x', youtubeVideoId: 'curto' }, 'youtube-invalido'],
    ['vídeo do YouTube com caractere perigoso', { text: 'x', youtubeVideoId: 'abc&def=123' }, 'youtube-invalido'],
    ['notícia sem título', { category: 'news', text: 'x' }, 'titulo-obrigatorio'],
    ['notícia com título curto', { category: 'news', text: 'x', headline: 'abc' }, 'titulo-obrigatorio'],
    ['título enorme', { category: 'news', headline: 'a'.repeat(201), text: 'x' }, 'titulo-longo'],
    ['link da notícia que não é https', { category: 'news', headline: 'Manchete boa', text: 'x', sourceUrl: 'javascript:alert(1)' }, 'link-invalido'],
    ['permissão de resposta desconhecida', { text: 'x', replyPermission: 'todos' }, 'permissao-invalida'],
    ['local sem estado de 2 letras', { text: 'x', location: { name: 'SP', state: 'São Paulo', ibgeId: 1 } }, 'local-invalido'],
    ['local com id não inteiro', { text: 'x', location: { name: 'SP', state: 'SP', ibgeId: 1.5 } }, 'local-invalido'],
    ['alcance desconhecido (antes virava "público" em silêncio)', { text: 'x', federation: 'PUBLIC' }, 'alcance-invalido'],
  ];
  for (const [nome, corpo, esperado] of recusas) confere(`ENTRADA · recusa: ${nome} → ${esperado}`, erro(corpo) === esperado, `veio ${erro(corpo)}`);
  confere('ENTRADA · só daqui (alcance local): a mídia de fora é aceita (ninguém vai federá-la)', ok({ text: 'x', federation: 'local', media: [{ url: 'https://exemplo.com/a.jpg', type: 'image' }] }).ok === true, 'recusou mídia de um post local');
  confere('ENTRADA · só daqui: mas endereço que não é URL nem caminho continua inválido', erro({ text: 'x', federation: 'local', media: [{ url: 'javascript:alert(1)', type: 'image' }] }) === 'midia-invalida', String(erro({ text: 'x', federation: 'local', media: [{ url: 'javascript:alert(1)', type: 'image' }] })));
  confere('ENTRADA · a notícia só leva link https e categoria curta', (() => { const r = ok({ category: 'news', headline: 'Manchete boa', text: 'x', sourceUrl: 'https://exemplo.com/m', newsCategory: ` ${'a'.repeat(100)} ` }); return r.ok && r.post.sourceUrl === 'https://exemplo.com/m' && r.post.newsCategory.length === 60; })(), 'sourceUrl/newsCategory');
  confere('ENTRADA · eco ignora manchete e link (só notícia os usa)', (() => { const r = ok({ text: 'x', headline: 'Isto some', sourceUrl: 'https://exemplo.com/m' }); return r.ok && r.post.headline === '' && r.post.sourceUrl === null; })(), 'vazou manchete');

  // perfil
  const p = (corpo) => parseOfficialProfilePatch(corpo, ctx);
  confere('PERFIL · avatar estático do site e mídia pública da casa são aceitos', p({ avatarUrl: '/brand/lula.png' }).ok && p({ avatarUrl: `${MIDIA}/m/foto` }).ok, 'recusou avatar válido');
  confere('PERFIL · avatar de outro endereço é RECUSADO com o motivo (antes: aceito, e a foto sumia no Fediverso)', (() => { const r = p({ avatarUrl: 'https://exemplo.com/a.png' }); return !r.ok && r.error === 'imagem-nao-federavel' && r.detail.includes('mídia pública'); })(), JSON.stringify(p({ avatarUrl: 'https://exemplo.com/a.png' })));
  confere('PERFIL · capa de outro endereço também', !p({ coverImageUrl: 'http://exemplo.com/c.jpg' }).ok, 'aceitou capa de fora');
  confere('PERFIL · o avatar de partida ANTIGO (arquivo que nunca existiu) é trocado pelo que existe', p({ avatarUrl: OFFICIAL_BROKEN_AVATAR }).patch.avatarUrl === OFFICIAL_DEFAULT_AVATAR, JSON.stringify(p({ avatarUrl: OFFICIAL_BROKEN_AVATAR })));
  confere('PERFIL · vazio apaga a imagem', p({ avatarUrl: '  ' }).patch.avatarUrl === '', JSON.stringify(p({ avatarUrl: '  ' })));
  confere('PERFIL · site precisa ser https://', !p({ website: 'exercitodolula.app' }).ok && p({ website: 'https://exercitodolula.app' }).ok && p({ website: '' }).patch.website === '', 'site');
  confere('PERFIL · nome e bio são cortados e o nome vazio é ignorado', (() => { const r = p({ name: ` ${'n'.repeat(120)} `, bio: 'b'.repeat(900) }); return r.patch.name.length === 80 && r.patch.bio.length === 500 && p({ name: '  ' }).patch.name === undefined; })(), 'cortes');
  confere('PERFIL · isFederableProfileImage em tabela', isFederableProfileImage('/brand/lula.png', ctx) && !isFederableProfileImage('/api/x.png', ctx) && !isFederableProfileImage('//evil.example/x.png', ctx), 'tabela');
}

t.encerra('A conta oficial federa de ponta a ponta, e o que falha deixa rastro.');
