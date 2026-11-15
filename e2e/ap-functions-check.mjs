#!/usr/bin/env node
/**
 * Testa a parte da federação que roda NAS FUNCTIONS (functions/src/federation.ts): decidir o que enfileirar.
 *   node e2e/ap-functions-check.mjs           (parte pura; não precisa de nada)
 *   com `npm run emulators` no ar, roda também a parte de INTEGRAÇÃO (posts reais disparando a Function)
 *
 * A Function não assina nem entrega: só registra "este post mudou" para o worker do site. O que se prova aqui é que
 *   - a imensa maioria das escritas (contadores) NÃO vira trabalho;
 *   - criar, editar e apagar viram a tarefa certa, e apagar nunca fica pendurado em estado da conta;
 *   - a plataforma desligada impede o post de ser enfileirado (ligar depois não federa o passado);
 *   - o MESMO evento entregue duas vezes gera UMA tarefa;
 *   - excluir a conta marca o handle, enfileira o Delete do ator e apaga o estado de federação;
 *   - a tarefa que a Function grava tem o MESMO formato que o worker lê (os dois pacotes não compartilham código).
 *
 * Sai com código 1 se algo falhar.
 */
import {
  alcanceDe, aoEscreverPost, aoExcluirConta, conteudoMudou, decidirOperacao, gravarTarefa, montarTarefa,
} from '../functions/src/federation.ts';

let falhas = 0;
let total = 0;
const confere = (nome, condicao, motivo, detalhe) => {
  total++;
  if (condicao) console.log(`OK    ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo}`); }
};
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ═════════════ 1. Decisão (pura) ═════════════

const P = (over = {}) => ({ userId: 'U', text: 'oi', media: null, sensitive: false, youtubeVideoId: null, isDeleted: false, federation: 'public', likes: 0, ...over });

for (const [valor, esperado] of [['public', 'public'], ['unlisted', 'unlisted'], ['followers', 'followers'], ['local', 'local'], [undefined, 'local'], [null, 'local'], ['PUBLIC', 'local'], ['tudo', 'local'], ['', 'local'], [42, 'local'], [{}, 'local'], [['public'], 'local']]) {
  confere(`alcance ${JSON.stringify(valor)} → ${esperado}`, alcanceDe({ federation: valor }) === esperado, alcanceDe({ federation: valor }));
}
confere('alcance de documento ausente → local', alcanceDe(undefined) === 'local', 'não local');

const casos = [
  ['post novo federado → create', undefined, P(), 'create'],
  ['post novo LOCAL → nada', undefined, P({ federation: 'local' }), null],
  ['post novo sem o campo → nada', undefined, P({ federation: undefined }), null],
  ['post novo já apagado → nada', undefined, P({ isDeleted: true }), null],
  ['contador (curtida) num post federado → nada', P(), P({ likes: 1 }), null],
  ['edição do texto → update', P(), P({ text: 'novo' }), 'update'],
  ['edição da mídia → update', P(), P({ media: [{ url: 'x' }] }), 'update'],
  ['aviso sensível → update', P(), P({ sensitive: true }), 'update'],
  ['link do YouTube → update', P(), P({ youtubeVideoId: 'abc' }), 'update'],
  ['edição de post LOCAL → nada', P({ federation: 'local' }), P({ federation: 'local', text: 'novo' }), null],
  ['tombstone de post federado → delete', P(), P({ isDeleted: true }), 'delete'],
  ['tombstone de post LOCAL → nada', P({ federation: 'local' }), P({ federation: 'local', isDeleted: true }), null],
  ['segundo tombstone → nada', P({ isDeleted: true }), P({ isDeleted: true, text: '' }), null],
  ['documento removido de vez, federado → delete', P(), undefined, 'delete'],
  ['documento removido de vez, local → nada', P({ federation: 'local' }), undefined, null],
  ['o servidor retirou do Fediverso (virou local) → delete', P(), P({ federation: 'local' }), 'delete'],
  ['local → público por edição (impossível pelas regras) → NADA', P({ federation: 'local' }), P({ federation: 'public' }), null],
  ['edição de post já apagado → nada', P({ isDeleted: true }), P({ isDeleted: false, text: 'volta' }), null],
  ['mudar de público para só-seguidores sem mexer no conteúdo → nada', P(), P({ federation: 'followers' }), null],
  ['sem antes nem depois → nada', undefined, undefined, null],
  // Post de notícia: o corpo que sai é manchete + resumo + link. Corrigir a manchete TEM de virar Update (antes era ignorado).
  ['notícia: a MANCHETE mudou → update', P({ category: 'news', headline: 'Reunião às 10h' }), P({ category: 'news', headline: 'Reunião ADIADA para as 15h' }), 'update'],
  ['notícia: manchete igual, só contador → nada', P({ category: 'news', headline: 'Reunião às 10h' }), P({ category: 'news', headline: 'Reunião às 10h', likes: 3 }), null],
  ['notícia: manchete de null para texto → update', P({ category: 'news', headline: null }), P({ category: 'news', headline: 'Agora tem manchete' }), 'update'],
  ['post comum: `headline` ausente virando `null` (escrita que só acrescenta o campo) → nada', P({ category: 'echo' }), P({ category: 'echo', headline: null }), null],
  ['categoria mudou (o corpo que sai é montado de outro jeito) → update', P({ category: 'echo' }), P({ category: 'news', headline: 'Virou notícia' }), 'update'],
  ['categoria ausente é "echo": acrescentar `category: "echo"` → nada', P(), P({ category: 'echo' }), null],
];
for (const [nome, antes, depois, esperado] of casos) {
  confere(`decisão · ${nome}`, decidirOperacao(antes, depois) === esperado, `veio ${decidirOperacao(antes, depois)}`);
}
confere('conteudoMudou ignora contadores e metadados', !conteudoMudou(P(), P({ likes: 99, views: 4, updatedAt: 'x', editCount: 3 })), 'tratou contador como conteúdo');
confere('conteudoMudou vê mudança só na ordem da mídia', conteudoMudou(P({ media: [{ url: 'a' }, { url: 'b' }] }), P({ media: [{ url: 'b' }, { url: 'a' }] })), 'ignorou a ordem');

// ═════════════ 2. Tarefa: idempotência e formato ═════════════

const t1 = montarTarefa('create', 'U', 'P1', 'evt-1', 1000);
const t2 = montarTarefa('create', 'U', 'P1', 'evt-1', 5000);
confere('tarefa: o MESMO evento gera o MESMO id (duas entregas do gatilho = uma tarefa)', t1.id === t2.id, `${t1.id} / ${t2.id}`);
confere('tarefa: evento diferente gera id diferente', montarTarefa('create', 'U', 'P1', 'evt-2', 1000).id !== t1.id, 'colidiu');
confere('tarefa: operações diferentes do mesmo evento têm ids diferentes', montarTarefa('delete', 'U', 'P1', 'evt-1', 1000).id !== t1.id, 'colidiu');
confere('tarefa: nasce pendente e vencida', t1.state === 'pending' && t1.nextAttemptAt === 1000 && t1.attempts === 0 && t1.targets === null, JSON.stringify(t1));

// O formato é o que o WORKER lê. Os dois pacotes não compartilham código, então o teste é quem garante que concordam.
const { createMemoryStore } = await import('./helpers/ap-memory-store.mjs');
const { disableFederation, enableFederation } = await import('../src/lib/activitypub/account.ts');
const { parseMasterKeyring } = await import('../src/lib/activitypub/keys.ts');
{
  const { store, teste } = createMemoryStore();
  teste.seedProfile({ uid: 'U1', name: 'A', username: 'Anaa', bio: '', avatarUrl: null, coverUrl: null, website: null, location: null, createdAtMs: 0, profileVisibility: 'public' });
  const deps = { store, keyring: parseMasterKeyring(Buffer.alloc(32, 3).toString('base64')), now: () => 5000, ownHost: 'exercitodolula.app', randomId: () => 'x' };
  await enableFederation(deps, 'U1', { emailVerified: true });
  await disableFederation(deps, 'U1');
  const doWorker = [...teste.jobs.values()][0];
  const daFuncao = montarTarefa('delete-actor', 'U1', null, 'e', 5000);
  confere('FORMATO · a tarefa da Function tem EXATAMENTE os campos da que o site cria',
    igual(Object.keys(doWorker).sort(), Object.keys(daFuncao).sort()), `${Object.keys(doWorker).sort()} / ${Object.keys(daFuncao).sort()}`);
  confere('FORMATO · e os mesmos tipos de valor', Object.keys(doWorker).every((k) => typeof doWorker[k] === typeof daFuncao[k] || doWorker[k] === null || daFuncao[k] === null), 'tipos divergem');
}

// ═════════════ 3. aoEscreverPost / aoExcluirConta com um banco falso ═════════════

function bancoFalso(docs = {}) {
  const criados = new Map();
  const atualizados = [];
  const apagados = [];
  const doc = (caminho) => ({
    get: async () => ({ exists: caminho in docs, data: () => docs[caminho] }),
    create: async (d) => {
      if (criados.has(caminho)) { const e = new Error('já existe'); e.code = 6; throw e; }
      criados.set(caminho, d);
    },
    update: async (d) => { atualizados.push([caminho, d]); },
    delete: async () => { apagados.push(caminho); },
    collection: (sub) => ({ doc: (id) => doc(`${caminho}/${sub}/${id}`) }),
  });
  const db = {
    collection: (c) => ({
      doc: (id) => doc(`${c}/${id}`),
      where: (campo, _op, valor) => ({
        limit: () => ({
          get: async () => {
            const achados = Object.entries(docs).filter(([k, v]) => k.startsWith(`${c}/`) && v[campo] === valor);
            return { empty: achados.length === 0, docs: achados.map(([k]) => ({ ref: doc(k) })) };
          },
        }),
      }),
    }),
  };
  return { db, criados, atualizados, apagados };
}
const LIGADA = { 'config/federation': { enabled: true, killSwitch: false }, 'users/U/private/federation': { enabled: true, paused: false } };
const ev = (over = {}) => ({ idDoEvento: 'ev1', postId: 'P1', antes: undefined, depois: P(), agora: 9000, ...over });

{
  const f = bancoFalso(LIGADA);
  const r = await aoEscreverPost(f.db, ev());
  confere('FUNÇÃO · post novo federado com tudo ligado → enfileira create', r === 'enfileirado:create' && f.criados.size === 1, r);
  const tarefa = [...f.criados.values()][0];
  confere('FUNÇÃO · a tarefa leva o dono e o post certos', tarefa.uid === 'U' && tarefa.postId === 'P1' && tarefa.op === 'create', JSON.stringify(tarefa));
  const repetido = await aoEscreverPost(f.db, ev());
  confere('FUNÇÃO · o MESMO evento de novo → "evento-repetido", ainda UMA tarefa', repetido === 'evento-repetido' && f.criados.size === 1, `${repetido} / ${f.criados.size}`);
}
{
  const f = bancoFalso({ ...LIGADA, 'config/federation': { enabled: false } });
  const r = await aoEscreverPost(f.db, ev());
  confere('FUNÇÃO · PLATAFORMA desligada: o post NÃO é enfileirado (ligar depois não federa o passado)', r === 'plataforma-desligada' && f.criados.size === 0, r);
}
{
  const f = bancoFalso({ ...LIGADA, 'config/federation': { enabled: true, killSwitch: true } });
  confere('FUNÇÃO · botão de emergência: não enfileira', (await aoEscreverPost(f.db, ev())) === 'plataforma-desligada' && f.criados.size === 0, 'enfileirou');
}
{
  const f = bancoFalso({});
  confere('FUNÇÃO · SEM o documento de configuração a federação está desligada (padrão seguro)', (await aoEscreverPost(f.db, ev())) === 'plataforma-desligada' && f.criados.size === 0, 'enfileirou sem configuração');
}
for (const [nome, conta] of [['pausada', { enabled: true, paused: true }], ['desligada', { enabled: false, paused: false }], ['inexistente', undefined]]) {
  const f = bancoFalso({ ...LIGADA, 'users/U/private/federation': conta });
  const r = await aoEscreverPost(f.db, ev());
  confere(`FUNÇÃO · conta ${nome}: não enfileira create`, r === 'conta-inativa' && f.criados.size === 0, r);
  const g = bancoFalso({ ...LIGADA, 'users/U/private/federation': conta });
  const e = await aoEscreverPost(g.db, ev({ antes: undefined, depois: P() }));
  void e;
  const h = bancoFalso({ ...LIGADA, 'users/U/private/federation': conta });
  const r2 = await aoEscreverPost(h.db, ev({ antes: P(), depois: P({ text: 'novo' }) }));
  confere(`FUNÇÃO · conta ${nome}: não enfileira update`, r2 === 'conta-inativa' && h.criados.size === 0, r2);
}
for (const [nome, conta, plataforma] of [['conta pausada', { enabled: true, paused: true }, LIGADA['config/federation']], ['conta desligada', undefined, LIGADA['config/federation']], ['plataforma desligada', LIGADA['users/U/private/federation'], { enabled: false }], ['emergência', LIGADA['users/U/private/federation'], { enabled: true, killSwitch: true }]]) {
  const f = bancoFalso({ 'config/federation': plataforma, 'users/U/private/federation': conta });
  const r = await aoEscreverPost(f.db, ev({ antes: P(), depois: P({ isDeleted: true }) }));
  confere(`FUNÇÃO · APAGAR é sempre enfileirado, mesmo com ${nome} (quem decide é o worker)`, r === 'enfileirado:delete' && f.criados.size === 1, r);
}
{
  const f = bancoFalso(LIGADA);
  confere('FUNÇÃO · contador não vira trabalho nem lê o banco', (await aoEscreverPost(f.db, ev({ antes: P(), depois: P({ likes: 5 }) }))) === 'ignorado' && f.criados.size === 0, 'virou trabalho');
  confere('FUNÇÃO · documento sem dono é ignorado com segurança', (await aoEscreverPost(f.db, ev({ depois: { ...P(), userId: undefined } }))) === 'sem-dono', 'não tratou');
}

// exclusão de conta
{
  const f = bancoFalso({ 'ap_handles/ana': { handle: 'ana', uid: 'U1', state: 'active' } });
  const r = await aoExcluirConta(f.db, 'U1', 1_000_000);
  confere('CONTA APAGADA · enfileira o Delete do ator', r === 'enfileirado:delete-actor' && [...f.criados.values()].some((t) => t.op === 'delete-actor' && t.uid === 'U1'), r);
  const up = f.atualizados.find(([c]) => c === 'ap_handles/ana');
  confere('CONTA APAGADA · o handle vira "deleting" com prazo de 3 dias para a chave', up && up[1].state === 'deleting' && up[1].keyDeleteAfterMs === 1_000_000 + 3 * 24 * 3600 * 1000, JSON.stringify(up));
  confere('CONTA APAGADA · o estado de federação da conta é apagado', f.apagados.includes('users/U1/private/federation'), JSON.stringify(f.apagados));
  const g = bancoFalso({});
  confere('CONTA APAGADA · quem nunca federou: nada a fazer', (await aoExcluirConta(g.db, 'U2', 1)) === 'sem-federacao' && g.criados.size === 0 && g.apagados.length === 0, 'agiu sem federação');
  const tarefaFormato = [...f.criados.values()][0];
  confere('CONTA APAGADA · a tarefa tem postId nulo e id estável por (conta, instante)', tarefaFormato.postId === null && tarefaFormato.id === 'delete-actor-U1-1000000', tarefaFormato.id);
}

// ═════════════ 4. Integração: posts reais disparando a Function no emulador ═════════════

const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
let emulador = false;
try {
  const h = await fetch('http://127.0.0.1:4400/emulators');
  emulador = h.ok && 'functions' in (await h.json());
} catch { emulador = false; }

if (!emulador) {
  console.log('\n(integração NÃO executada: emuladores com Functions não estão no ar — rode `npm run emulators`)');
} else {
  const H = await import('./lib/harness.mjs');
  const { ADMIN, EMU, PROJECT, adminRunQuery, eventually, fsCreateAtServerTime, fsGetDoc, fsSet, fsUpdate, signInRest, deleteAuthAccount } = H;
  void FS_HOST;
  const stamp = Date.now().toString(36);

  async function criarConta(rotulo, federacao) {
    const email = `fn.${stamp}.${rotulo}@example.test`;
    const senha = 'Teste!123456';
    const cria = await fetch(`${EMU.auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: senha, returnSecureToken: true }),
    });
    const { localId: uid } = await cria.json();
    await fetch(`${EMU.auth}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, {
      method: 'POST', headers: { ...ADMIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ localId: uid, emailVerified: true, customAttributes: JSON.stringify({ member: true }) }),
    });
    const { idToken } = await signInRest(email, senha);
    await fsSet(`users/${uid}`, { name: `Fn ${rotulo}`, username: `fn_${rotulo}_${stamp}`.slice(0, 15), name_lowercase: 'fn', profileVisibility: 'public', followersCount: 0, followingCount: 0, postsCount: 0, isAdmin: false }, 'owner');
    if (federacao) await fsSet(`users/${uid}/private/federation`, federacao, 'owner');
    return { uid, token: idToken };
  }
  const base = (c, extra = {}) => ({ userId: c.uid, text: 'olá', visibility: 'public', likes: 0, reposts: 0, commentsCount: 0, quotesCount: 0, views: 0, isDeleted: false, allowReposts: true, replyPermission: 'everyone', category: 'echo', type: 'original', ...extra });
  const tarefasDe = async (postId) => (await adminRunQuery('ap_outbound', { limit: 500 })).filter((d) => d.fields?.postId?.stringValue === postId).map((d) => ({ op: d.fields.op.stringValue, id: d.name.split('/').pop() }));

  await fsSet('config/federation', { enabled: true, killSwitch: false, mode: 'open' }, 'owner');
  const A = await criarConta('a', { enabled: true, paused: false, handle: 'a' });

  const idPub = `fn_${stamp}_pub`;
  await fsCreateAtServerTime('posts', idPub, base(A, { federation: 'public' }), A.token);
  let achou = null;
  try { achou = await eventually(async () => { const t = await tarefasDe(idPub); return t.length ? t : null; }, { timeoutMs: 25_000, label: 'tarefa create' }); } catch { achou = null; }
  confere('INTEGRAÇÃO · um post federado de verdade vira a tarefa "create" na fila (a Function está viva e ligada)', achou && achou.length === 1 && achou[0].op === 'create', JSON.stringify(achou));

  // negativos: só valem porque o positivo acima mostrou que a Function responde
  if (achou) {
    const idLocal = `fn_${stamp}_loc`;
    await fsCreateAtServerTime('posts', idLocal, base(A, { federation: 'local' }), A.token);
    const idSem = `fn_${stamp}_sem`;
    await fsCreateAtServerTime('posts', idSem, base(A), A.token);
    await fsUpdate(`posts/${idPub}`, { likes: 7 }, 'owner');
    await new Promise((r) => setTimeout(r, 4000));
    confere('INTEGRAÇÃO · post LOCAL e post sem o campo NÃO viram tarefa', (await tarefasDe(idLocal)).length === 0 && (await tarefasDe(idSem)).length === 0, 'enfileirou post local');
    confere('INTEGRAÇÃO · contador gravado pelo servidor NÃO vira tarefa', (await tarefasDe(idPub)).length === 1, JSON.stringify(await tarefasDe(idPub)));

    await fsUpdate(`posts/${idPub}`, { text: 'editado', isEdited: true, editCount: 1, updatedAt: new Date().toISOString() }, A.token);
    const upd = await eventually(async () => { const t = await tarefasDe(idPub); return t.some((x) => x.op === 'update') ? t : null; }, { timeoutMs: 20_000, label: 'tarefa update' }).catch(() => null);
    confere('INTEGRAÇÃO · editar o texto vira "update"', Boolean(upd), JSON.stringify(await tarefasDe(idPub)));

    await fsUpdate(`posts/${idPub}`, { isDeleted: true, text: '' }, A.token);
    const del = await eventually(async () => { const t = await tarefasDe(idPub); return t.some((x) => x.op === 'delete') ? t : null; }, { timeoutMs: 20_000, label: 'tarefa delete' }).catch(() => null);
    confere('INTEGRAÇÃO · apagar o post vira "delete"', Boolean(del), JSON.stringify(await tarefasDe(idPub)));

    // plataforma desligada: o post nasce mas NÃO é enfileirado, e ligar depois não o resgata
    await fsSet('config/federation', { enabled: false, killSwitch: false, mode: 'open' }, 'owner');
    const idOff = `fn_${stamp}_off`;
    await fsCreateAtServerTime('posts', idOff, base(A, { federation: 'public' }), A.token);
    await new Promise((r) => setTimeout(r, 4000));
    await fsSet('config/federation', { enabled: true, killSwitch: false, mode: 'open' }, 'owner');
    await new Promise((r) => setTimeout(r, 4000));
    confere('INTEGRAÇÃO · post criado com a plataforma DESLIGADA nunca é enfileirado, nem depois de ligá-la', (await tarefasDe(idOff)).length === 0, JSON.stringify(await tarefasDe(idOff)));

    // exclusão de conta
    const Z = await criarConta('z', { enabled: true, paused: false, handle: 'z' });
    await fsSet(`ap_handles/fnz${stamp}`, { handle: `fnz${stamp}`, uid: Z.uid, state: 'active', publicKeyPem: 'PEM', createdAtMs: 1, keyDeleteAfterMs: null }, 'owner');
    await deleteAuthAccount(Z.uid);
    const marcado = await eventually(async () => {
      const r = await fsGetDoc(`ap_handles/fnz${stamp}`, 'owner');
      return r.doc?.state === 'deleting' ? r.doc : null;
    }, { timeoutMs: 40_000, label: 'handle deleting' }).catch(() => null);
    confere('INTEGRAÇÃO · excluir a conta marca o handle como "deleting" com prazo para a chave', marcado && typeof marcado.keyDeleteAfterMs === 'number', JSON.stringify(marcado));
    const jobConta = (await adminRunQuery('ap_outbound', { limit: 500 })).some((d) => d.fields?.op?.stringValue === 'delete-actor' && d.fields?.uid?.stringValue === Z.uid);
    confere('INTEGRAÇÃO · e enfileira o Delete do ator', jobConta, 'sem tarefa delete-actor');
    const aposConta = await fsGetDoc(`users/${Z.uid}/private/federation`, 'owner');
    confere('INTEGRAÇÃO · e o estado de federação da conta some (o cleanup antigo só apagava private/account)', aposConta.status === 404, `HTTP ${aposConta.status}`);
  }
}

console.log('');
console.log(`${total} verificações.`);
if (falhas) {
  console.log(`${falhas} falha(s).`);
  process.exit(1);
}
console.log('Function de federação OK: só enfileira, só o que importa, e idempotente.');
