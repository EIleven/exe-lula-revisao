#!/usr/bin/env node
/**
 * Remove do Firestore o conteúdo dos domínios do Fediverso suspensos pela plataforma.
 *
 *   node scripts/purgar-dominios-suspensos.mjs --producao                 inventário (SÓ LÊ)
 *   node scripts/purgar-dominios-suspensos.mjs --producao --aplicar       remove
 *   node scripts/purgar-dominios-suspensos.mjs --producao --limite=200    examina no máximo N por coleção
 *
 * Em produção o token vem de FIRESTORE_ACCESS_TOKEN (gcloud auth print-access-token) e NUNCA é impresso.
 *
 * ───────────────────────── O que este arquivo promete ─────────────────────────
 * Quando um servidor pede para a gente parar e apagar o que é dele, a resposta não pode ser "rodamos alguma
 * coisa". Tem de ser um número por coleção e a lista do que NÃO deu certo. Daí as três regras:
 *
 *   1. CADA PASSO RODA ISOLADO. Um passo que falha não derruba os seguintes. Isto não é zelo abstrato: a versão
 *      anterior deste script morria no passo dos comentários (consulta de grupo de coleção sem índice declarado) e
 *      os passos seguintes nunca rodavam. A purga parecia existir e deixava quase tudo no lugar.
 *   2. O RELATÓRIO MOSTRA AS FALHAS, com nome e motivo, e o processo sai com código 1. Relatório que esconde o que
 *      não foi feito é o que faz alguém dizer "está tudo removido" sem estar.
 *   3. `--aplicar` é obrigatório para apagar. Sem ele, só conta.
 *
 * Espelha src/lib/server/purgeSuspended.ts, que é o caminho usado pelo painel do admin. A lista de domínios vem do
 * MESMO módulo (`suspendedDomains.ts`) nos dois, para não existir duas verdades sobre quem está suspenso.
 */

import { execFileSync } from 'node:child_process';

const { SUSPENDED_FEDIVERSE_DOMAINS, isSuspendedFediverseHost, isFromSuspendedFediverseDomain } = await import(
  '../src/lib/federation/suspendedDomains.ts'
);

const args = process.argv.slice(2);
const tem = (n) => args.includes(n);
const valor = (n, padrao) => {
  const a = args.find((x) => x.startsWith(`${n}=`));
  return a ? a.slice(n.length + 1) : padrao;
};

const PRODUCAO = tem('--producao');
const APLICAR = tem('--aplicar');
const LIMITE = Number(valor('--limite', '0')) || 0;
const PROJETO = PRODUCAO ? 'echo-b5aw9' : 'demo-soberan';
const BANCO = PRODUCAO ? 'echo-db-124325' : '(default)';
const PAGINA = 300;

/**
 * Escopo: por padrão, todos os domínios suspensos. `--dominios=a.com,b.com` limita a esses.
 *
 * Existe porque pedido de remoção vem de um servidor por vez, e a lista de suspensos cresce. Rodar a lista inteira
 * quando alguém pediu por um só apaga conteúdo que ninguém pediu para apagar -- e isso não se desfaz.
 */
const PEDIDOS = (valor('--dominios', '') || '')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);
const ALVOS = PEDIDOS.length ? PEDIDOS : [...SUSPENDED_FEDIVERSE_DOMAINS];
const foraDoEscopo = PEDIDOS.filter((d) => !SUSPENDED_FEDIVERSE_DOMAINS.includes(d));
if (foraDoEscopo.length) {
  console.error(`Recusado: ${foraDoEscopo.join(', ')} nao esta em SUSPENDED_FEDIVERSE_DOMAINS.`);
  console.error('Suspender um dominio e decisao de politica: entra na lista primeiro, depois se purga.');
  process.exit(1);
}

/** O host casa com ALGUM dos domínios deste escopo? Mesma regra de sufixo do módulo central. */
const noEscopo = (host) => {
  if (typeof host !== 'string' || !host.trim()) return false;
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  return ALVOS.some((d) => h === d || h.endsWith(`.${d}`));
};
const urlNoEscopo = (v) => {
  if (typeof v !== 'string' || !v.startsWith('http')) return false;
  try { return noEscopo(new URL(v).hostname); } catch { return false; }
};

const base = PRODUCAO
  ? `https://firestore.googleapis.com/v1/projects/${PROJETO}/databases/${BANCO}/documents`
  : `http://127.0.0.1:8080/v1/projects/${PROJETO}/databases/(default)/documents`;
const raiz = base.slice(0, base.lastIndexOf('/documents'));

function tokenDeAcesso() {
  if (!PRODUCAO) return 'owner';
  const doAmbiente = process.env.FIRESTORE_ACCESS_TOKEN;
  if (doAmbiente) return doAmbiente.trim();
  try {
    return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
  } catch {
    console.error(
      'Sem credencial. Rode:  $env:FIRESTORE_ACCESS_TOKEN = (gcloud auth print-access-token --account=<conta com acesso>)',
    );
    process.exit(1);
  }
}
const TOKEN = tokenDeAcesso();
const cabecalhos = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

/** Lê uma coleção inteira (ou um grupo de coleção), paginando pelo nome do último documento. */
async function consultar(colecao, grupo) {
  const saida = [];
  let cursor = null;
  for (;;) {
    const q = {
      structuredQuery: {
        from: [{ collectionId: colecao, allDescendants: grupo === true }],
        orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
        limit: PAGINA,
      },
    };
    if (cursor) q.structuredQuery.startAt = { values: [{ referenceValue: cursor }], before: false };
    const r = await fetch(`${raiz}/documents:runQuery`, {
      method: 'POST',
      headers: cabecalhos,
      body: JSON.stringify(q),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} — ${(await r.text()).slice(0, 200)}`);
    const linhas = await r.json();
    const docs = linhas.filter((l) => l.document).map((l) => l.document);
    saida.push(...docs);
    if (docs.length < PAGINA) break;
    if (LIMITE && saida.length >= LIMITE) break;
    cursor = docs[docs.length - 1].name;
  }
  return LIMITE ? saida.slice(0, LIMITE) : saida;
}

const simples = (v) => {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(simples);
  if ('mapValue' in v) {
    const o = {};
    for (const [k, vv] of Object.entries(v.mapValue.fields || {})) o[k] = simples(vv);
    return o;
  }
  return null;
};

const plano = (doc) => {
  const o = {};
  for (const [k, v] of Object.entries(doc.fields || {})) o[k] = simples(v);
  return o;
};

/** O registro é de um domínio suspenso? Olha o id do documento e todo campo que possa carregar o host. */
function ehSuspenso(doc) {
  const d = plano(doc);
  const idDoDoc = doc.name.split('/').pop() || '';
  if (idDoDoc.includes('@') && noEscopo(idDoDoc.split('@').pop())) return true;
  if (noEscopo(d.domain) || noEscopo(d.host)) return true;
  if (typeof d.handle === 'string' && d.handle.includes('@') && noEscopo(d.handle.split('@').pop())) return true;
  for (const handle of [d.username, d.authorDetails && d.authorDetails.username]) {
    if (typeof handle === 'string' && handle.includes('@') && noEscopo(handle.split('@').pop())) return true;
  }
  for (const campo of ['remoteDomain']) {
    if (noEscopo(d[campo])) return true;
  }
  for (const campo of ['remoteUrl', 'remoteActorId', 'apActorUri', 'website', 'apObjectId', 'actorId', 'url', 'canonicalUrl', 'targetInbox', 'sharedInbox']) {
    if (urlNoEscopo(d[campo])) return true;
  }
  return false;
}

async function apagar(nomeDoDoc) {
  const caminho = nomeDoDoc.slice(nomeDoDoc.indexOf('/documents') + '/documents'.length);
  const r = await fetch(`${base}${caminho}`, { method: 'DELETE', headers: cabecalhos });
  if (!r.ok) throw new Error(`HTTP ${r.status} ao apagar — ${(await r.text()).slice(0, 160)}`);
}

/** `grupo: true` = consulta de GRUPO DE COLEÇÃO (a subcoleção em qualquer pai, inclusive em post local). */
const PASSOS = [
  { nome: 'users', colecao: 'users' },
  { nome: 'posts', colecao: 'posts' },
  { nome: 'comments', colecao: 'comments', grupo: true },
  { nome: 'ap_remote_comments', colecao: 'ap_remote_comments' },
  { nome: 'ap_remote_actors', colecao: 'ap_remote_actors' },
  { nome: 'ap_followers', colecao: 'ap_followers' },
  { nome: 'ap_handles', colecao: 'ap_handles' },
  { nome: 'ap_deliveries', colecao: 'ap_deliveries' },
  { nome: 'ap_seen', colecao: 'ap_seen' },
  { nome: 'ap_objects', colecao: 'ap_objects' },
  { nome: 'fontes', colecao: 'fontes' },
];

console.log(`Banco: ${PRODUCAO ? 'PRODUÇÃO' : 'emulador'} (${PROJETO}/${BANCO})`);
console.log(`Escopo desta execução: ${ALVOS.join(', ')}`);
if (PEDIDOS.length) console.log(`(a lista completa de suspensos tem ${SUSPENDED_FEDIVERSE_DOMAINS.length} domínios)`);
console.log(APLICAR ? 'APAGANDO.\n' : 'Inventário: nada será apagado.\n');

const contagens = {};
const falhas = [];

for (const { nome, colecao, grupo } of PASSOS) {
  try {
    const docs = await consultar(colecao, grupo);
    const alvos = docs.filter(ehSuspenso);
    const c = { lidos: docs.length, suspensos: alvos.length, apagados: 0 };
    contagens[nome] = c;
    if (APLICAR) {
      for (const doc of alvos) {
        await apagar(doc.name);
        c.apagados++;
      }
    }
    console.log(
      `  ${nome.padEnd(20)} lidos=${String(c.lidos).padStart(6)}  suspensos=${String(c.suspensos).padStart(4)}  apagados=${c.apagados}`,
    );
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    falhas.push({ passo: nome, erro: motivo.slice(0, 300) });
    console.error(`  ${nome.padEnd(20)} FALHOU — ${motivo.slice(0, 150)}`);
  }
}

console.log('');
console.log('─'.repeat(72));
const totalSuspensos = Object.values(contagens).reduce((s, c) => s + c.suspensos, 0);
const totalApagados = Object.values(contagens).reduce((s, c) => s + c.apagados, 0);
console.log(`de domínio suspenso, encontrados ... ${totalSuspensos}`);
console.log(`apagados .......................... ${totalApagados}`);

if (falhas.length) {
  console.log('');
  console.log(`PASSOS QUE FALHARAM (${falhas.length}) — a remoção NÃO está completa:`);
  for (const f of falhas) console.log(`  · ${f.passo}: ${f.erro}`);
}
if (!APLICAR) {
  console.log('');
  console.log('Nada foi apagado. Para apagar, repita com --aplicar.');
}
process.exit(falhas.length ? 1 : 0);
