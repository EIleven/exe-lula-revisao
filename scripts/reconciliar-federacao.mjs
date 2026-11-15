#!/usr/bin/env node
/**
 * Reconciliação dos dados do Fediverso em PRODUÇÃO, achados pela auditoria de 2026-11-14. Por padrão só MOSTRA o plano (SIMULAÇÃO);
 * só grava com --aplicar. Nada é apagado sem aparecer antes na simulação.
 *
 *   FIRESTORE_ACCESS_TOKEN=$(gcloud auth print-access-token --account=<dono do projeto>) node scripts/reconciliar-federacao.mjs
 *   ... --so=fantasmas|espelhos|duplicatas|atribuicao   (um ou mais temas, separados por vírgula; sem isso, todos; "atribuicao" só lê)
 *   ... --uid=<UID>                                  (o tema "espelhos" para "seguindo" de UMA pessoa)
 *   ... --aplicar                                    (GRAVA; leia a simulação antes)
 *
 * 1. FANTASMAS do próprio domínio: `users/ap_…` cujo ator é do NOSSO domínio (uma resposta ou repost do Fediverso a um post do
 *    @Breno, ao sincronizar o perfil de quem respondeu, criava um "Breno" falso e cópias dos posts dele). São removidos:
 *    o vínculo de seguir (que o contador recalcula sozinho), os posts-cópia, o que o fantasma curtiu/repostou/comentou e, por fim,
 *    o usuário. O que é REAL (o @Breno de verdade, seus posts e seguidores) nunca é tocado: o roteiro recusa qualquer id sem `ap_`.
 * 2. ESPELHOS: seguidor remoto que existe em `ap_followers` (recebe os posts) mas não em `users/{uid}/followers` (não aparece na
 *    lista, não conta, não gera "Segue você"); e, com --uid, "seguindo" remoto sem `ap_following` (não dá para deixar de seguir de
 *    verdade). O espelho é criado a partir do cache `ap_remote_actors`.
 * 3. DUPLICATAS: o mesmo post remoto com dois ids (um do inbox, pelo id ActivityPub, outro do sincronismo de perfil, pela URL).
 *    Só apaga a cópia com EVIDÊNCIA de redundância (mesmo autor e texto, ou atribuída a quem apenas impulsionou o post) e que NINGUÉM
 *    DAQUI interagiu; o resto é listado para decisão manual.
 * 4. ATRIBUIÇÃO: posts remotos gravados em nome de quem os impulsionou, sem gêmeo para comparar. O sincronismo novo
 *    (`garantirPostDeTerceiro`) não recria o post com o autor certo enquanto o `id` estiver ocupado por outro dono; por isso,
 *    com `--aplicar`, apaga apenas os sem interação local (para que voltem com o autor verdadeiro no próximo sincronismo) e
 *    preserva os que têm curtida/repost/comentário de gente daqui.
 *
 * Reversão: nada aqui é recriável a partir do próprio banco (por isso a simulação existe). Os fantasmas e as duplicatas são cópias
 * de conteúdo que o servidor de origem continua tendo; os espelhos só ACRESCENTAM documentos.
 */
import { createHash } from 'node:crypto';

const PROJECT = 'echo-b5aw9';
const DATABASE = 'echo-db-124325';
const HOST = 'exercitodolula.app';
const ORIGEM = `https://${HOST}`;
const TOKEN = process.env.FIRESTORE_ACCESS_TOKEN;
if (!TOKEN) { console.error('Defina FIRESTORE_ACCESS_TOKEN (o valor nunca é impresso).'); process.exit(2); }
const APLICAR = process.argv.includes('--aplicar');
const SO = process.argv.find((a) => a.startsWith('--so='))?.slice(5) ?? '';
const UID_ALVO = process.argv.find((a) => a.startsWith('--uid='))?.slice(6) ?? '';
const temas = SO ? SO.split(',') : ['fantasmas', 'espelhos', 'duplicatas', 'atribuicao'];

const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/documents`;
const H = { Authorization: `Bearer ${TOKEN}`, 'x-goog-user-project': PROJECT, 'Content-Type': 'application/json' };
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (t) => createHash('sha256').update(t).digest('hex');
// Os mesmos ids de src/lib/activitypub/remoteIdentity.ts (que não dá para importar daqui sem o ambiente do app).
const remoteUserIdOf = (actorId) => `ap_${sha(actorId).slice(0, 24)}`;
const remoteFollowDocIdOf = (actorId) => sha(actorId).slice(0, 32);

const plano = (v) => {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(plano);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, plano(x)]));
  return v;
};
const doc = (d) => ({ id: d.name.split('/').pop(), caminho: d.name.split('/documents/')[1], ...Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, v]) => [k, plano(v)])) });
const valorFs = (v) => {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(valorFs) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, valorFs(x)])) } };
};
async function chamar(metodo, caminho, corpo) {
  const r = await fetch(`${FS}${caminho}`, { method: metodo, headers: H, body: corpo ? JSON.stringify(corpo) : undefined });
  return r;
}
async function ler(caminho) {
  const r = await chamar('GET', `/${caminho}`);
  return r.ok ? doc(await r.json()) : null;
}
async function listar(caminho, max = 5000) {
  const saida = [];
  let token = '';
  while (saida.length < max) {
    const r = await chamar('GET', `/${caminho}?pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
    if (!r.ok) throw new Error(`${caminho}: HTTP ${r.status}`);
    const j = await r.json();
    saida.push(...(j.documents ?? []).map(doc));
    if (!j.nextPageToken) break;
    token = j.nextPageToken;
  }
  return saida;
}
async function consultar(colecao, campo, valor, { grupo = false, limite = 500 } = {}) {
  const v = typeof valor === 'boolean' ? { booleanValue: valor } : { stringValue: valor };
  const corpo = { structuredQuery: { from: [{ collectionId: colecao, allDescendants: grupo }], where: { fieldFilter: { field: { fieldPath: campo }, op: 'EQUAL', value: v } }, limit: limite } };
  const r = await chamar('POST', ':runQuery', corpo);
  const j = await r.json();
  if (!r.ok) throw new Error(`consulta ${colecao}.${campo}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.filter((x) => x.document).map((x) => doc(x.document));
}
const existe = async (caminho) => (await ler(caminho)) !== null;
async function apagar(caminho) {
  const r = await chamar('DELETE', `/${caminho}`);
  return r.ok || r.status === 404;
}
async function gravar(caminho, dados) {
  const campos = Object.fromEntries(Object.entries(dados).map(([k, v]) => [k, valorFs(v)]));
  const r = await chamar('PATCH', `/${caminho}`, { fields: campos });
  if (!r.ok) throw new Error(`gravar ${caminho}: HTTP ${r.status}`);
}
/** Apaga um documento e tudo o que há abaixo dele (subcoleções, inclusive de documentos "fantasma"). */
async function apagarArvore(caminho, nivel = 0) {
  if (nivel > 5) throw new Error(`profundidade excessiva em ${caminho}`);
  const r = await chamar('POST', `/${caminho}:listCollectionIds`, { pageSize: 100 });
  const colecoes = r.ok ? ((await r.json()).collectionIds ?? []) : [];
  for (const colecao of colecoes) {
    for (const filho of await listar(`${caminho}/${colecao}`, 5000)) await apagarArvore(filho.caminho, nivel + 1);
  }
  return apagar(caminho);
}

const resumo = {
  simulacao: !APLICAR, fantasmas: 0, espelhosCriados: 0, apFollowingCriados: 0,
  duplicatasRedundantes: 0, duplicatasAutorErrado: 0, duplicatasApagadas: 0, duplicatasParaDecisao: 0,
  atribuidosAoAutorErrado: 0, atribuidosApagados: 0, atribuidosParaDecisao: 0,
};
const titulo = (t) => console.log(`\n=== ${t}`);
console.log(APLICAR ? 'MODO: GRAVANDO (--aplicar)' : 'MODO: SIMULAÇÃO (nada é gravado; use --aplicar depois de ler)');

// ───────────────────────── 1. fantasmas do próprio domínio ─────────────────────────
if (temas.includes('fantasmas')) {
  titulo('1. Fantasmas do próprio domínio (users/ap_… cujo ator é nosso)');
  const candidatos = await consultar('users', 'remoteDomain', HOST, { limite: 200 });
  const fantasmas = candidatos.filter((u) => String(u.id).startsWith('ap_') && String(u.remoteActorId ?? '').startsWith(`${ORIGEM}/`));
  console.log(`${fantasmas.length} fantasma(s) encontrado(s) (${candidatos.length} usuário(s) com remoteDomain = ${HOST}).`);
  for (const f of fantasmas) {
    const handle = /^\/ap\/users\/([A-Za-z0-9_]{3,15})\/?$/.exec(new URL(f.remoteActorId).pathname)?.[1]?.toLowerCase() ?? null;
    const verdadeiro = handle ? (await ler(`ap_handles/${handle}`))?.uid ?? null : null;
    console.log(`\n· ${f.id}  username=${f.username}  actor=${f.remoteActorId}`);
    console.log(`  a pessoa de verdade (ap_handles/${handle}): ${verdadeiro ?? 'NÃO ENCONTRADA — nada será apagado deste fantasma'}`);
    if (!verdadeiro) continue;
    const seguidores = await listar(`users/${f.id}/followers`);
    const seguindo = await listar(`users/${f.id}/following`);
    const posts = await consultar('posts', 'userId', f.id, { limite: 500 });
    const curtidas = await consultar('likes', 'userId', f.id, { grupo: true });
    const reposts = await consultar('reposts', 'userId', f.id, { grupo: true });
    const comentarios = await consultar('comments', 'userId', f.id, { grupo: true });
    const apFollowing = [];
    for (const s of seguidores) { if (await existe(`ap_following/${s.id}/actors/${remoteFollowDocIdOf(f.remoteActorId)}`)) apFollowing.push(s.id); }
    console.log(`  quem "segue" o fantasma: ${seguidores.map((s) => s.id).join(', ') || '-'}  (ap_following a apagar: ${apFollowing.length})`);
    console.log(`  quem o fantasma "segue": ${seguindo.map((s) => s.id).join(', ') || '-'}`);
    console.log(`  posts-cópia: ${posts.length} ${posts.slice(0, 5).map((p) => `${p.id} (${String(p.text ?? '').slice(0, 40)})`).join(' | ')}`);
    console.log(`  curtidas: ${curtidas.length}, reposts: ${reposts.length}, comentários: ${comentarios.length}`);
    resumo.fantasmas++;
    if (!APLICAR) continue;

    // vínculos primeiro: as Functions recontam followersCount/followingCount a partir dos documentos que sobram
    for (const s of seguidores) { await apagar(`users/${s.id}/following/${f.id}`); await apagar(`users/${f.id}/followers/${s.id}`); }
    for (const s of seguindo) { await apagar(`users/${s.id}/followers/${f.id}`); await apagar(`users/${f.id}/following/${s.id}`); }
    for (const uid of apFollowing) await apagar(`ap_following/${uid}/actors/${remoteFollowDocIdOf(f.remoteActorId)}`);
    if (seguidores.length || seguindo.length) { console.log('  esperando 25 s para as Functions recontarem os contadores...'); await dorme(25_000); }
    for (const x of [...curtidas, ...reposts, ...comentarios]) await apagar(x.caminho);
    for (const p of posts) await apagarArvore(`posts/${p.id}`);
    console.log(`  usuário ${f.id} apagado: ${await apagarArvore(`users/${f.id}`)}`);
  }
}

// ───────────────────────── 2. espelhos de seguidores e de "seguindo" ─────────────────────────
if (temas.includes('espelhos')) {
  titulo('2. Espelhos: ap_followers sem users/{uid}/followers, e "seguindo" remoto sem ap_following');
  const apFollowers = await listar('ap_followers');
  let faltam = 0;
  for (const a of apFollowers) {
    const remoteUid = remoteUserIdOf(a.actorId);
    if (await existe(`users/${a.uid}/followers/${remoteUid}`)) continue;
    faltam++;
    const cache = await ler(`ap_remote_actors/${sha(a.actorId)}`);
    const temUsuario = await existe(`users/${remoteUid}`);
    console.log(`· falta o espelho de ${a.actorId} em users/${a.uid}/followers  (usuário ${remoteUid}: ${temUsuario ? 'existe' : cache ? 'será criado a partir do cache' : 'SEM CACHE do ator — não dá para criar'})`);
    if (!APLICAR || (!temUsuario && !cache)) continue;
    if (!temUsuario) {
      await gravar(`users/${remoteUid}`, {
        id: remoteUid, name: cache.name || cache.handle, username: cache.handle, bio: cache.summary || '', avatarUrl: cache.iconUrl || '',
        profileVisibility: 'public', isRemoteFediverse: true, remoteActorId: a.actorId, remoteDomain: cache.domain,
        remoteInbox: cache.inbox || cache.sharedInbox || null, createdAt: new Date(), updatedAt: new Date(),
      });
    }
    await gravar(`users/${a.uid}/followers/${remoteUid}`, { createdAt: new Date(a.createdAtMs ?? Date.now()), isRemoteFediverse: true, remoteActorId: a.actorId });
    resumo.espelhosCriados++;
  }
  console.log(`${apFollowers.length} registro(s) em ap_followers; ${faltam} sem espelho em users/{uid}/followers.`);

  if (UID_ALVO) {
    const seguindo = (await listar(`users/${UID_ALVO}/following`)).filter((d) => String(d.id).startsWith('ap_'));
    let semAp = 0;
    for (const s of seguindo) {
      const u = await ler(`users/${s.id}`);
      if (!u?.remoteActorId) { console.log(`· ${s.id}: sem o usuário remoto (ou sem remoteActorId); nada a fazer`); continue; }
      if (await existe(`ap_following/${UID_ALVO}/actors/${remoteFollowDocIdOf(u.remoteActorId)}`)) continue;
      semAp++;
      console.log(`· ${UID_ALVO} segue ${u.username} (${s.id}) sem registro em ap_following`);
      if (!APLICAR) continue;
      await gravar(`ap_following/${UID_ALVO}/actors/${remoteFollowDocIdOf(u.remoteActorId)}`, {
        actorId: u.remoteActorId, handle: u.username, domain: u.remoteDomain ?? '', name: u.name ?? '', iconUrl: u.avatarUrl || null,
        url: u.remoteUrl ?? u.remoteActorId, followActivityId: `${ORIGEM}/ap/reconciliado/${remoteFollowDocIdOf(u.remoteActorId)}`,
        status: 'unknown', createdAtMs: Date.now(),
      });
      resumo.apFollowingCriados++;
    }
    console.log(`${seguindo.length} "seguindo" remoto(s) de ${UID_ALVO}; ${semAp} sem ap_following.`);
  } else {
    console.log('(para os "seguindo" remotos de uma pessoa, use --uid=<UID>)');
  }
}

// ───────────────────────── 3. posts remotos duplicados ─────────────────────────
// Uma cópia só é apagada com EVIDÊNCIA de que é redundante, e nunca se alguém daqui interagiu com ela:
//   REDUNDANTE   mesmo autor e mesmo texto que o post que fica (só mudou o id local: id ActivityPub x URL da página);
//   AUTOR ERRADO mesmo texto, mas a cópia foi atribuída a QUEM IMPULSIONOU o post (o ator cujo perfil foi sincronizado), não a quem
//                o escreveu, e o que fica tem o autor coerente com o próprio objeto. Era o defeito do sincronismo antigo (corrigido em
//                remoteMaterialize.ts): o post de A aparecia como se fosse de B.
// O resto (texto diferente, autor que não dá para provar, já apagado) é listado para decisão manual.
const norm = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const hostDe = (u) => { try { return new URL(String(u)).hostname.toLowerCase(); } catch { return ''; } };
/** O `@nome` da URL de página (`https://servidor/@nome/123`), em minúsculas, ou null (Misskey, Pleroma etc. não têm). */
const nomeNaPagina = (url) => {
  try { return /^\/@([^/]+)\//.exec(new URL(String(url)).pathname)?.[1]?.toLowerCase() ?? null; } catch { return null; }
};
const usuariosEmCache = new Map();
const usuarioDe = async (uid) => {
  if (!usuariosEmCache.has(uid)) usuariosEmCache.set(uid, await ler(`users/${uid}`));
  return usuariosEmCache.get(uid);
};
/** O autor do post é coerente com o próprio objeto: mora no servidor dele e, quando a página traz o @nome, é o mesmo nome. */
async function autorCoerente(p) {
  const u = await usuarioDe(p.userId);
  const servidorDoObjeto = hostDe(p.remoteObjectId) || hostDe(p.remoteUrl);
  const hostAtor = hostDe(u?.remoteActorId);
  const dom = String(u?.remoteDomain ?? '').toLowerCase();
  if (!u || u.isRemoteFediverse !== true || hostAtor === '' || (hostAtor !== servidorDoObjeto && dom !== servidorDoObjeto)) {
    return false;
  }
  const nome = nomeNaPagina(p.remoteUrl);
  return nome === null || nome === String(u.username ?? '').split('@')[0].toLowerCase();
}

/** Lista interações de usuários locais (`isRemoteFediverse !== true`) em `likes`, `reposts` e `comments` de um post. */
async function interacoesLocais(postId) {
  const subs = [];
  for (const sub of ['likes', 'reposts', 'comments']) {
    for (const x of await listar(`posts/${postId}/${sub}`, 200)) {
      if (x.isRemoteFediverse !== true) subs.push(`${sub}/${x.id}`);
    }
  }
  return subs;
}

/** Executa `fn` sobre `itens` com concorrência limitada para não saturar a API nem demorar minutos em lotes grandes. */
async function mapComLimite(itens, limite, fn) {
  const saida = new Array(itens.length);
  let prox = 0;
  const trabalhador = async () => {
    while (prox < itens.length) {
      const i = prox++;
      saida[i] = await fn(itens[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
  return saida;
}
/** Todos os posts remotos, paginando por id do documento (a consulta simples para em 5000 e esconderia o resto). */
async function postsRemotos() {
  const saida = [];
  let ultimo = null;
  for (;;) {
    const consulta = {
      from: [{ collectionId: 'posts' }],
      where: { fieldFilter: { field: { fieldPath: 'isRemoteFediverse' }, op: 'EQUAL', value: { booleanValue: true } } },
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: 1000,
    };
    if (ultimo) consulta.startAt = { values: [{ referenceValue: ultimo }], before: false };
    const r = await chamar('POST', ':runQuery', { structuredQuery: consulta });
    const j = await r.json();
    if (!r.ok) throw new Error(`posts remotos: ${JSON.stringify(j).slice(0, 200)}`);
    const docs = j.filter((x) => x.document).map((x) => x.document);
    saida.push(...docs.map(doc));
    if (docs.length < 1000) break;
    ultimo = docs[docs.length - 1].name;
  }
  return saida;
}

let remotosEmCache = null;
const todosOsPostsRemotos = async () => (remotosEmCache ??= await postsRemotos());

if (temas.includes('duplicatas')) {
  titulo('3. Posts remotos duplicados (mesma página, ids locais diferentes)');
  const remotos = await todosOsPostsRemotos();
  console.log(`${remotos.length} post(s) remoto(s) lidos.`);
  const porPagina = new Map();
  for (const p of remotos) {
    if (!p.remoteUrl) continue;
    porPagina.set(p.remoteUrl, [...(porPagina.get(p.remoteUrl) ?? []), p]);
  }
  const grupos = [...porPagina.values()].filter((g) => g.length > 1);
  console.log(`${grupos.length} grupo(s) com mais de um id para a mesma página.`);
  for (const grupo of grupos) {
    const ehIdAp = (p) => /\/users\/[^/]+\/statuses\/|\/notes\/|\/objects\//.test(String(p.remoteObjectId ?? ''));
    const ordenado = [...grupo].sort((a, b) => Number(ehIdAp(b)) - Number(ehIdAp(a)) || String(a.createdAt).localeCompare(String(b.createdAt)));
    const [fica, ...sobram] = ordenado;
    console.log(`\n· ${fica.remoteUrl}\n  fica: ${fica.id} (objectId ${fica.remoteObjectId})`);
    for (const p of sobram) {
      let veredito;
      if (fica.isDeleted === true || p.isDeleted === true) veredito = 'um dos dois já está marcado como apagado';
      else if (norm(p.text) !== norm(fica.text)) veredito = 'o texto é diferente';
      else if (p.userId === fica.userId) veredito = 'REDUNDANTE';
      else if ((await autorCoerente(fica)) && !(await autorCoerente(p))) veredito = 'AUTOR ERRADO';
      else veredito = 'não dá para provar qual dos dois autores é o certo';
      if (veredito !== 'REDUNDANTE' && veredito !== 'AUTOR ERRADO') {
        console.log(`  cópia ${p.id}: ressalva (${veredito}) — decisão manual`);
        resumo.duplicatasParaDecisao++;
        continue;
      }
      const subs = await interacoesLocais(p.id);
      if (subs.length > 0) {
        console.log(`  cópia ${p.id} [${veredito}]: TEM interação de gente daqui (${subs.slice(0, 4).join(', ')}) — decisão manual`);
        resumo.duplicatasParaDecisao++;
        continue;
      }
      console.log(`  cópia ${p.id} [${veredito}]: sem interação local — ${APLICAR ? 'apagando' : 'seria apagada'}`);
      if (veredito === 'REDUNDANTE') resumo.duplicatasRedundantes++; else resumo.duplicatasAutorErrado++;
      if (APLICAR) { await apagarArvore(`posts/${p.id}`); resumo.duplicatasApagadas++; }
    }
  }
}

// ───────────────────────── 4. posts remotos com o autor errado ─────────────────────────
// O mesmo defeito, sem gêmeo para comparar: o post foi gravado em nome de quem o impulsionou. Enquanto o `id` continuar ocupado,
// o sincronismo novo recusa gravar o post com o autor verdadeiro. Apagar os que NÃO têm interação local libera o id para voltar
// com o autor certo no próximo sincronismo do perfil ou via Announce no inbox; os que têm interação local são preservados.
if (temas.includes('atribuicao')) {
  titulo('4. Posts remotos atribuídos a quem NÃO os escreveu');
  const remotos = await todosOsPostsRemotos();
  const incoerentes = [];
  for (const p of remotos) {
    if (!p.id.startsWith('ap_') || p.isDeleted === true || !p.userId || !(p.remoteObjectId || p.remoteUrl)) continue;
    if (!(await autorCoerente(p))) incoerentes.push(p);
  }
  resumo.atribuidosAoAutorErrado = incoerentes.length;
  const avaliados = await mapComLimite(incoerentes, 12, async (p) => ({
    p,
    autor: (await usuarioDe(p.userId))?.username ?? p.userId,
    subs: await interacoesLocais(p.id),
  }));
  const comInteracao = avaliados.filter((x) => x.subs.length > 0);
  const semInteracao = avaliados.filter((x) => x.subs.length === 0);
  resumo.atribuidosParaDecisao = comInteracao.length;
  console.log(
    `${remotos.length} post(s) remoto(s) conferidos; ${incoerentes.length} com autor incoerente ` +
      `(${semInteracao.length} sem interação local — ${APLICAR ? 'apagando' : 'seriam apagados'}; ` +
      `${comInteracao.length} com interação local — preservados para decisão manual).`,
  );
  for (const x of semInteracao.slice(0, 12)) {
    console.log(`· [SEM INTERAÇÃO] ${x.p.id}  autor=${x.autor}  página=${x.p.remoteUrl ?? x.p.remoteObjectId}`);
  }
  for (const x of comInteracao.slice(0, 20)) {
    console.log(`· [PRESERVADO] ${x.p.id}  autor=${x.autor}  interações=${x.subs.slice(0, 4).join(', ')}  página=${x.p.remoteUrl ?? x.p.remoteObjectId}`);
  }
  if (APLICAR && semInteracao.length > 0) {
    await mapComLimite(semInteracao, 8, async (x) => {
      await apagarArvore(`posts/${x.p.id}`);
      resumo.atribuidosApagados++;
    });
  }
}

console.log('\n' + JSON.stringify(resumo));
if (!APLICAR) console.log('Simulação concluída: nada foi gravado. Rode de novo com --aplicar para executar.');
