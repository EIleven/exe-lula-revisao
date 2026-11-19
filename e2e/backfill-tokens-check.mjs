#!/usr/bin/env node
/**
 * O script de preenchimento de `searchTokens`, exercitado de verdade contra o emulador do Firestore:
 *   npm run e2e:backfill-tokens
 *
 * Por que isto existe: o script vai mexer em ~37 mil documentos de PRODUÇÃO. Ler o código e achar que está certo
 * não é prova. Aqui ele roda de verdade sobre documentos semeados, e o que se verifica é o que pode dar errado numa
 * escrita em massa:
 *
 *   - Ele grava o campo certo e SÓ ele? (um updateMask errado apaga o resto do documento)
 *   - Ele deixa `updatedAt` e `isEdited` em paz? (senão 37 mil posts viram "editado" de uma vez)
 *   - Rodar duas vezes grava de novo? (não pode: a segunda passada tem de ser só leitura)
 *   - A reversão limpa mesmo? (é a saída se algo der errado)
 *
 * Sobe o emulador sozinho (projeto `demo-*`, credenciais isoladas) e se re-executa dentro dele.
 * Sai com código 1 se algo falhar.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJETO = 'demo-soberan';
const JDK = 'E:\\Arquivos de Programas\\Android\\Android Studio\\jbr';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  const isolado = path.join(RAIZ, '.emulator-state', 'backfill');
  mkdirSync(isolado, { recursive: true });
  const env = {
    ...process.env,
    JAVA_HOME: JDK,
    PATH: `${path.join(JDK, 'bin')}${path.delimiter}${process.env.PATH}`,
    XDG_CONFIG_HOME: path.join(isolado, 'xdg'),
    CLOUDSDK_CONFIG: path.join(isolado, 'gcloud'),
    APPDATA: path.join(isolado, 'appdata'),
    FIREBASE_EMULATORS_PATH: path.join(RAIZ, '.emulator-state', 'emulators'),
  };
  for (const v of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT']) {
    delete env[v];
  }
  const alvo = path.relative(RAIZ, fileURLToPath(import.meta.url)).split(path.sep).join('/');
  const comando = [
    'npx', '-y', 'firebase-tools@15.34.0', 'emulators:exec',
    '--only', 'firestore', '--config', 'firebase.emulators.json', '--project', PROJETO,
    `"node ${alvo}"`,
  ].join(' ');
  console.log('Subindo o emulador do Firestore...\n');
  const r = spawnSync(comando, { cwd: RAIZ, env, stdio: 'inherit', shell: true });
  process.exit(r.status ?? 1);
}

// ───────────────────────── Dentro do emulador ─────────────────────────
const HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const BASE = `http://${HOST}/v1/projects/${PROJETO}/databases/(default)/documents`;

let falhas = 0;
let total = 0;
const confere = (nome, condicao, motivo) => {
  total++;
  if (condicao) console.log(`OK    ${nome}`);
  else {
    falhas++;
    console.log(`FALHA ${nome} — ${motivo}`);
  }
};

const req = async (caminho, opcoes = {}) => {
  const r = await fetch(`${BASE}${caminho}`, {
    ...opcoes,
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json', ...(opcoes.headers || {}) },
  });
  if (!r.ok) throw new Error(`${r.status} ${caminho} — ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

const simples = (v) => {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(simples);
  if ('mapValue' in v) {
    const o = {};
    for (const [k, vv] of Object.entries(v.mapValue.fields || {})) o[k] = simples(vv);
    return o;
  }
  return null;
};

const CARIMBO = '2026-01-15T10:00:00Z';
const posts = [
  { id: 'p1', headline: 'Reforma agrária avança', text: 'o plano de reforma agrária no país', hashtags: ['#Reforma'] },
  { id: 'p2', headline: null, text: 'greve geral dos professores em todo o Brasil', hashtags: [] },
  { id: 'p3', headline: null, text: '🔥🔥🔥', hashtags: [] },
];

for (const p of posts) {
  await req(`/posts?documentId=${p.id}`, {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        headline: p.headline ? { stringValue: p.headline } : { nullValue: null },
        text: { stringValue: p.text },
        hashtags: { arrayValue: { values: p.hashtags.map((h) => ({ stringValue: h })) } },
        authorDetails: { mapValue: { fields: { name: { stringValue: 'Breno Ramos' }, username: { stringValue: 'breno' } } } },
        visibility: { stringValue: 'public' },
        isDeleted: { booleanValue: false },
        isEdited: { booleanValue: false },
        likes: { integerValue: '7' },
        updatedAt: { timestampValue: CARIMBO },
        createdAt: { timestampValue: CARIMBO },
      },
    }),
  });
}

const ler = async (id) => simples({ mapValue: { fields: (await req(`/posts/${id}`)).fields } });
const rodar = (args) => {
  const r = spawnSync(`node scripts/preencher-search-tokens.mjs ${args}`, {
    cwd: RAIZ,
    env: { ...process.env, FIRESTORE_EMULATOR_HOST: HOST },
    encoding: 'utf8',
    shell: true,
  });
  return `${r.stdout || ''}${r.stderr || ''}`;
};

// ───────────────────────── Inventário não grava ─────────────────────────
{
  const saida = rodar('--amostra=3');
  confere('INVENTÁRIO · encontra os posts semeados', /posts examinados \.+ 3/.test(saida), saida.slice(-400));
  confere('INVENTÁRIO · diz que nada foi gravado', saida.includes('Nada foi gravado'), 'não avisou');
  const p1 = await ler('p1');
  confere('INVENTÁRIO · e de fato NÃO gravou', p1.searchTokens === null || p1.searchTokens === undefined, JSON.stringify(p1.searchTokens));
}

// ───────────────────────── A gravação ─────────────────────────
{
  rodar('--aplicar');
  const p1 = await ler('p1');
  const p2 = await ler('p2');
  const p3 = await ler('p3');

  confere('GRAVA · o campo aparece', Array.isArray(p1.searchTokens) && p1.searchTokens.length > 0, JSON.stringify(p1.searchTokens));
  confere(
    'GRAVA · os tokens são os do título, texto, autor e tag',
    ['reforma', 'agraria', 'breno'].every((t) => p1.searchTokens.includes(t)),
    JSON.stringify(p1.searchTokens),
  );
  confere('GRAVA · sem acento (quem digita "agraria" acha)', p1.searchTokens.includes('agraria'), JSON.stringify(p1.searchTokens));
  confere('GRAVA · o segundo post também', Array.isArray(p2.searchTokens) && p2.searchTokens.includes('greve'), JSON.stringify(p2.searchTokens));

  // O QUE NÃO PODE TER MUDADO.
  confere('INTACTO · o texto do post continua lá', p1.text === 'o plano de reforma agrária no país', String(p1.text));
  confere('INTACTO · o título continua lá', p1.headline === 'Reforma agrária avança', String(p1.headline));
  confere('INTACTO · as curtidas continuam', p1.likes === 7, String(p1.likes));
  confere('INTACTO · as hashtags continuam', JSON.stringify(p1.hashtags) === '["#Reforma"]', JSON.stringify(p1.hashtags));
  confere(
    'INTACTO · `updatedAt` NÃO mudou (37 mil posts não viram "editado")',
    String(p1.updatedAt).startsWith('2026-01-15T10:00:00'),
    String(p1.updatedAt),
  );
  confere('INTACTO · `isEdited` continua falso', p1.isEdited === false, String(p1.isEdited));
  // Post só com emoji AINDA é indexado — pelo autor. É o certo: quem procura "breno" tem de achar o que ele
  // publicou, mesmo que a publicação não tenha uma palavra. É também por isso que, em produção, nenhum dos 37 mil
  // posts caiu em "sem texto para indexar".
  confere(
    'AUTOR · post só com emoji continua achável pelo nome de quem publicou',
    Array.isArray(p3.searchTokens) && p3.searchTokens.includes('breno'),
    JSON.stringify(p3.searchTokens),
  );
  confere('AUTOR · e não inventa token do emoji', !p3.searchTokens.some((t) => /[^a-z0-9]/.test(t)), JSON.stringify(p3.searchTokens));
}

// ───────────────────────── Idempotência ─────────────────────────
{
  const saida = rodar('--amostra=3');
  confere(
    'DE NOVO · a segunda passada vê tudo como já correto',
    /já corretos \(nada a fazer\) \.+ 3/.test(saida),
    saida.slice(-500),
  );
  confere('DE NOVO · e não tem nada a gravar', /a gravar \.+ 0/.test(saida), saida.slice(-500));

  const antes = await ler('p1');
  rodar('--aplicar');
  const depois = await ler('p1');
  confere(
    'DE NOVO · rodar com --aplicar outra vez não muda nada',
    JSON.stringify(antes) === JSON.stringify(depois),
    'o documento mudou numa passada que não devia gravar',
  );
}

// ───────────────────────── Texto editado, tokens refeitos ─────────────────────────
{
  await req('/posts/p2?updateMask.fieldPaths=text', {
    method: 'PATCH',
    body: JSON.stringify({ fields: { text: { stringValue: 'assembleia dos metalurgicos' } } }),
  });
  const saida = rodar('');
  confere('MUDOU · post com texto novo volta para a fila', /a gravar \.+ 1/.test(saida), saida.slice(-400));
  rodar('--aplicar');
  const p2 = await ler('p2');
  confere('MUDOU · os tokens novos entraram', p2.searchTokens.includes('assembleia'), JSON.stringify(p2.searchTokens));
  confere(
    'MUDOU · e os velhos saíram (senão a busca acha por palavra que já não está no post)',
    !p2.searchTokens.includes('greve'),
    JSON.stringify(p2.searchTokens),
  );
}

// ───────────────────────── A saída de emergência ─────────────────────────
{
  rodar('--reverter --aplicar');
  const p1 = await ler('p1');
  confere('REVERTE · o campo some', !p1.searchTokens, JSON.stringify(p1.searchTokens));
  confere('REVERTE · e o conteúdo do post continua inteiro', p1.text === 'o plano de reforma agrária no país' && p1.likes === 7, JSON.stringify(p1));
  confere(
    'REVERTE · `updatedAt` continua intacto mesmo na volta',
    String(p1.updatedAt).startsWith('2026-01-15T10:00:00'),
    String(p1.updatedAt),
  );
}

console.log('');
console.log(`${total} verificações.`);
if (falhas) {
  console.log(`${falhas} falha(s).`);
  process.exit(1);
}
console.log('Backfill OK: grava só o campo novo, não marca ninguém como editado, repetir não grava, e a volta limpa.');
