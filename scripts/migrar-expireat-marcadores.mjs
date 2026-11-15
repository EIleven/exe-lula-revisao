#!/usr/bin/env node
/**
 * Põe `expireAt` nos marcadores ANTIGOS de visualização e de clique no perfil.
 *
 *   node scripts/migrar-expireat-marcadores.mjs                       emuladores, só mostra o plano
 *   node scripts/migrar-expireat-marcadores.mjs --aplicar             emuladores, grava
 *   node scripts/migrar-expireat-marcadores.mjs --producao            produção, só mostra o plano
 *   node scripts/migrar-expireat-marcadores.mjs --producao --aplicar  produção, grava (só com autorização)
 *   --colecao=views|profileClicks   restringe a uma das duas (padrão: as duas)
 *   --limite=5000                   para depois de examinar N documentos (primeira rodada cautelosa)
 *   --conferir                      não grava; sai com código 1 se ainda houver algo a migrar
 *
 * Em produção o token vem de FIRESTORE_ACCESS_TOKEN (gcloud auth print-access-token --account=<dono do projeto>) e
 * nunca é impresso.
 *
 * POR QUE EXISTE: a política de TTL do Firestore só apaga documento que TEM o campo `expireAt`. Os marcadores
 * gravados antes da mudança de 2026-11-11 só têm `createdAt`, então o TTL nunca os enxergaria e o rastro de quem viu
 * cada post continuaria guardado para sempre — justamente o que a mudança resolve. E as regras permitem apenas
 * `create` nessas coleções: o cliente não consegue consertar, tem de ser administrativo.
 *
 * O QUE GRAVA: só o campo `expireAt`, com `updateMask`, igual a `createdAt + 90 dias`. Nada mais é tocado — nem
 * `userId`, nem `createdAt`, nem o número agregado do post. Os gatilhos que somam os contadores são
 * `onDocumentCreated`, então ATUALIZAR um marcador existente não os dispara: a contagem do post não muda.
 *
 * IDEMPOTENTE: quem já tem `expireAt` é ignorado. Rodar de novo não grava nada.
 *
 * Marcador cujo `createdAt` está ausente ou com tipo errado é relatado como inválido e NÃO é tocado: chutar a data
 * seria inventar quando a pessoa viu o post. Decida caso a caso se aparecer algum.
 */

const { decideMarkerMigration, MARKER_TTL_DAYS } = await import('../src/lib/analytics/markerExpiry.ts');

const flagValue = (name) => process.argv.slice(2).find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
const args = new Set(process.argv.slice(2));
const PROD = args.has('--producao');
const APLICAR = args.has('--aplicar');
const CONFERIR = args.has('--conferir');
const LIMITE = Number(flagValue('--limite') ?? '0') || Infinity;
const COLECAO = flagValue('--colecao');

const COLECOES = COLECAO ? [COLECAO] : ['views', 'profileClicks'];
for (const c of COLECOES) {
  if (!['views', 'profileClicks'].includes(c)) {
    console.error(`--colecao precisa ser views ou profileClicks (veio "${c}").`);
    process.exit(2);
  }
}

const PROJECT = PROD ? 'echo-b5aw9' : 'demo-soberan';
const DATABASE = 'echo-db-124325';
const FIRESTORE_HOST = PROD ? 'https://firestore.googleapis.com' : `http://${process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'}`;
const ROOT = `projects/${PROJECT}/databases/${DATABASE}/documents`;
const PAGE_SIZE = 300;
const WRITES_PER_COMMIT = 400;

const token = PROD ? process.env.FIRESTORE_ACCESS_TOKEN : 'owner';
if (!token) {
  console.error('Defina FIRESTORE_ACCESS_TOKEN com um token de acesso da conta dona do projeto (o valor não é impresso).');
  process.exit(2);
}
const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  ...(PROD ? { 'x-goog-user-project': PROJECT } : {}),
};

async function call(method, path, body) {
  const url = `${FIRESTORE_HOST}/v1/${path}`;
  const response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* corpo não JSON */ }
  if (!response.ok) {
    const error = new Error(`${method} ${path.replace(ROOT, '')} -> HTTP ${response.status}: ${json?.error?.message ?? text.slice(0, 300)}`);
    error.status = response.status;
    error.firestoreStatus = json?.error?.status;
    throw error;
  }
  return json;
}

const timeOf = (value) => (value?.timestampValue ? Date.parse(value.timestampValue) : undefined);
const curto = (name) => name.replace(`${ROOT}/`, '');

/**
 * Varre um grupo de coleções inteiro, página por página, lendo SÓ `createdAt` e `expireAt` (projeção) para não
 * puxar documento inteiro à toa. O cursor é o nome do documento.
 */
async function* varrer(collectionId) {
  let cursor = null;
  let vistos = 0;
  while (vistos < LIMITE) {
    const structuredQuery = {
      from: [{ collectionId, allDescendants: true }],
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      select: { fields: [{ fieldPath: 'createdAt' }, { fieldPath: 'expireAt' }] },
      limit: Math.min(PAGE_SIZE, LIMITE - vistos),
    };
    if (cursor) structuredQuery.startAt = { values: [{ referenceValue: cursor }], before: false };

    const resposta = await call('POST', `${ROOT}:runQuery`, { structuredQuery });
    const documentos = (resposta ?? []).map((linha) => linha.document).filter(Boolean);
    if (documentos.length === 0) return;

    for (const doc of documentos) {
      vistos++;
      yield doc;
    }
    cursor = documentos[documentos.length - 1].name;
    if (documentos.length < structuredQuery.limit) return;
  }
}

async function gravar(writes) {
  for (let i = 0; i < writes.length; i += WRITES_PER_COMMIT) {
    await call('POST', `${ROOT}:commit`, { writes: writes.slice(i, i + WRITES_PER_COMMIT) });
  }
}

const agora = Date.now();
let totalExaminados = 0;
let totalJaTem = 0;
let totalAtualizar = 0;
let totalVencidos = 0;
let totalInvalidos = 0;
let totalGravados = 0;
const exemplosInvalidos = [];

console.log(`alvo: ${PROD ? 'PRODUÇÃO' : 'emuladores'} · ${PROJECT}/${DATABASE}`);
console.log(`modo: ${APLICAR ? 'GRAVAR' : CONFERIR ? 'conferir (sai 1 se faltar algo)' : 'dry-run (nada é gravado)'}`);
console.log(`prazo: createdAt + ${MARKER_TTL_DAYS} dias`);
if (LIMITE !== Infinity) console.log(`limite: ${LIMITE} documentos por coleção`);
console.log('');

for (const collectionId of COLECOES) {
  let examinados = 0;
  let jaTem = 0;
  let aAtualizar = 0;
  let vencidos = 0;
  let invalidos = 0;
  let writes = [];

  for await (const doc of varrer(collectionId)) {
    examinados++;
    const decisao = decideMarkerMigration(
      {
        createdAtMs: timeOf(doc.fields?.createdAt),
        hasExpireAt: doc.fields?.expireAt !== undefined,
      },
      agora,
    );

    if (decisao.action === 'ja-tem') {
      jaTem++;
      continue;
    }
    if (decisao.action === 'invalido') {
      invalidos++;
      if (exemplosInvalidos.length < 10) exemplosInvalidos.push(`${curto(doc.name)} (${decisao.reason})`);
      continue;
    }

    aAtualizar++;
    if (decisao.alreadyExpired) vencidos++;
    writes.push({
      update: {
        name: doc.name,
        fields: { expireAt: { timestampValue: new Date(decisao.expireAtMs).toISOString() } },
      },
      // Só este campo é tocado: o resto do documento fica intacto.
      updateMask: { fieldPaths: ['expireAt'] },
      // Se o TTL já apagou o documento entre a leitura e a gravação, NÃO o recriamos.
      currentDocument: { exists: true },
    });

    if (APLICAR && writes.length >= WRITES_PER_COMMIT) {
      await gravar(writes);
      totalGravados += writes.length;
      writes = [];
    }
  }

  if (APLICAR && writes.length) {
    await gravar(writes);
    totalGravados += writes.length;
  }

  console.log(`${collectionId}:`);
  console.log(`  examinados ............ ${examinados}`);
  console.log(`  já têm expireAt ....... ${jaTem}`);
  console.log(`  a atualizar ........... ${aAtualizar}`);
  console.log(`  …destes, já vencidos .. ${vencidos}  (o TTL apaga na próxima varredura)`);
  console.log(`  inválidos (intocados) . ${invalidos}`);
  console.log('');

  totalExaminados += examinados;
  totalJaTem += jaTem;
  totalAtualizar += aAtualizar;
  totalVencidos += vencidos;
  totalInvalidos += invalidos;
}

console.log('total:');
console.log(`  examinados ${totalExaminados} · já têm ${totalJaTem} · a atualizar ${totalAtualizar} (vencidos ${totalVencidos}) · inválidos ${totalInvalidos}`);
if (APLICAR) console.log(`  GRAVADOS: ${totalGravados}`);

if (exemplosInvalidos.length) {
  console.log('\nmarcadores inválidos (não tocados; decida caso a caso):');
  for (const exemplo of exemplosInvalidos) console.log(`  ${exemplo}`);
  if (totalInvalidos > exemplosInvalidos.length) console.log(`  … e outros ${totalInvalidos - exemplosInvalidos.length}`);
}

if (!APLICAR && totalAtualizar > 0) {
  console.log(`\nnada foi gravado. Para aplicar: adicione --aplicar${PROD ? '' : ' (e --producao para valer em produção)'}.`);
}

if (CONFERIR && totalAtualizar > 0) {
  console.log(`\nainda há ${totalAtualizar} marcador(es) sem expireAt.`);
  process.exit(1);
}
if (LIMITE !== Infinity) {
  console.log('\nATENÇÃO: rodou com --limite, então este NÃO é o total da base. Rode sem limite para o número real.');
}
