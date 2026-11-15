#!/usr/bin/env node
/**
 * Teste de fumaça E2E (interface REAL) contra os EMULADORES do Firebase.
 *
 * Fluxo: cadastro → conferência no Auth/Firestore emulados → login em contexto limpo →
 *        criação de publicação → conferência no Firestore nomeado.
 * Também prova que o navegador NÃO falou com nenhum endpoint real do Google/Firebase.
 *
 * Pré-requisitos (veja docs/emuladores.md):
 *   - `npm run emulators` e `npm run dev -- -H localhost` rodando;
 *   - playwright-core acessível: defina E2E_NODE_MODULES com uma pasta node_modules que o contenha
 *     (nenhuma dependência é adicionada ao projeto);
 *   - navegador baseado em Chromium: defina E2E_BROWSER com o caminho do chrome.exe/msedge.exe.
 *
 * Variáveis opcionais: E2E_BASE_URL (padrão http://localhost:9002), E2E_FIRESTORE_DATABASE
 * (padrão echo-db-124325), E2E_OUT (pasta das capturas de tela).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:9002';
const PROJECT = 'demo-soberan';
const DATABASE = process.env.E2E_FIRESTORE_DATABASE ?? 'echo-db-124325';
const HUB = 'http://127.0.0.1:4400';
const AUTH = 'http://127.0.0.1:9099';
const FIRESTORE = 'http://127.0.0.1:8080';
const ADMIN = { Authorization: 'Bearer owner' }; // token administrativo aceito SOMENTE pelos emuladores

const stamp = Date.now().toString(36);
const user = {
  name: `Teste E2E ${stamp}`,
  username: `e2e_${stamp}`,
  email: `e2e.${stamp}@example.test`,
  dob: '1990-01-01',
  password: 'Teste!123456',
};
const postText = `Primeira publicação de teste ${stamp}`;
const commentText = `Comentário de teste ${stamp}`;
const replyText = `Resposta de teste ${stamp}`;
const outDir = process.env.E2E_OUT ?? path.resolve('e2e-output', stamp);
mkdirSync(outDir, { recursive: true });

// Qualquer host destes, contatado pelo navegador, significa que algo escapou dos emuladores.
const REAL_GOOGLE_HOSTS =
  /(^|\.)(googleapis\.com|firebaseio\.com|firebaseapp\.com|cloudfunctions\.net|google-analytics\.com|googletagmanager\.com|googlesyndication\.com|doubleclick\.net|gstatic\.com|google\.com)$/;

async function loadPlaywright() {
  const file = process.env.E2E_NODE_MODULES && path.join(process.env.E2E_NODE_MODULES, 'playwright-core', 'index.mjs');
  if (file && existsSync(file)) return import(pathToFileURL(file).href);
  return import('playwright-core');
}

const results = [];
const log = (message) => console.log(`[e2e ${new Date().toISOString().slice(11, 19)}] ${message}`);
async function step(name, run) {
  const started = Date.now();
  try {
    const detail = await run();
    results.push({ name, ok: true, ms: Date.now() - started, detail });
    log(`OK    ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started, detail: String(error?.message ?? error) });
    log(`FALHA ${name} — ${String(error?.message ?? error).split('\n')[0]}`);
    throw error;
  }
}

const documentsUrl = (collection) => `${FIRESTORE}/v1/projects/${PROJECT}/databases/${encodeURIComponent(DATABASE)}/documents/${collection}`;
async function queryCollection(collection, limit = 50) {
  const response = await fetch(`${FIRESTORE}/v1/projects/${PROJECT}/databases/${encodeURIComponent(DATABASE)}/documents:runQuery`, {
    method: 'POST',
    headers: { ...ADMIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], limit } }),
  });
  if (!response.ok) throw new Error(`runQuery(${collection}) retornou HTTP ${response.status}`);
  return (await response.json()).filter((row) => row.document).map((row) => row.document);
}
const asText = (doc) => JSON.stringify(doc.fields ?? {});
// A interface mostra o resultado antes de a gravação terminar: as verificações no banco repetem até passar.
async function eventually(check, { timeoutMs = 20_000, intervalMs = 500, label = 'condição' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${label} não foi satisfeita em ${timeoutMs} ms`);
}
// Comentários podem estar em coleção de topo ou em subcoleção: consulta em todos os níveis.
async function queryAllComments(limit = 200) {
  const response = await fetch(`${FIRESTORE}/v1/projects/${PROJECT}/databases/${encodeURIComponent(DATABASE)}/documents:runQuery`, {
    method: 'POST',
    headers: { ...ADMIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'comments', allDescendants: true }], limit } }),
  });
  if (!response.ok) throw new Error(`runQuery(comments) retornou HTTP ${response.status}`);
  return (await response.json()).filter((row) => row.document).map((row) => row.document);
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({
  executablePath: process.env.E2E_BROWSER,
  headless: true,
});
const hosts = new Set();
const consoleErrors = [];
const pageErrors = [];
const badResponses = new Set();
const watch = (page) => {
  page.on('request', (request) => hosts.add(new URL(request.url()).hostname));
  page.on('response', (response) => {
    if (response.status() >= 400) badResponses.add(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  page.on('console', (message) => message.type() === 'error' && consoleErrors.push(message.text().slice(0, 220)));
  page.on('pageerror', (error) => pageErrors.push(String(error.message).slice(0, 220)));
};
const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: false });

let failed = false;
try {
  if (process.env.E2E_RESET === '1') {
    // Zera os dados DESCARTÁVEIS dos emuladores (nunca há dados reais aqui).
    await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE', headers: ADMIN });
    await fetch(`${FIRESTORE}/emulator/v1/projects/${PROJECT}/databases/${encodeURIComponent(DATABASE)}/documents`, { method: 'DELETE', headers: ADMIN });
    log('Dados dos emuladores zerados (E2E_RESET=1).');
  }
  await step('pré-checagem: emuladores no ar e app respondendo', async () => {
    const running = Object.keys(await (await fetch(`${HUB}/emulators`)).json());
    const missing = ['auth', 'firestore', 'functions', 'database', 'storage'].filter((name) => !running.includes(name));
    if (missing.length) throw new Error(`emuladores ausentes: ${missing.join(', ')}`);
    const login = await fetch(`${BASE_URL}/pt-BR/login`);
    if (login.status !== 200) throw new Error(`/pt-BR/login retornou HTTP ${login.status}`);
    return `emuladores: ${running.filter((n) => !['hub', 'logging', 'ui', 'eventarc', 'tasks'].includes(n)).join(', ')}`;
  });

  // ---------- 1. CADASTRO (contexto 1) ----------
  const context1 = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
  const page = await context1.newPage();
  page.setDefaultTimeout(60_000);
  watch(page);

  await step('cadastro: abre /pt-BR/register e vê o aviso "Emuladores Firebase ativos"', async () => {
    await page.goto(`${BASE_URL}/pt-BR/register`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.locator('[data-testid="emulator-banner"][data-status="ok"]').waitFor({ timeout: 90_000 });
    await shot(page, '01-register-emuladores-ativos');
  });

  await step('cadastro: preenche o formulário e a disponibilidade é validada pela Cloud Function', async () => {
    await page.fill('#name', user.name);
    await page.fill('#username', user.username);
    await page.fill('#email', user.email);
    await page.fill('#dateOfBirth', user.dob);
    await page.fill('#password', user.password);
    await page.fill('#confirm-password', user.password);
    await page.getByText('Nome de usuário disponível.').waitFor({ timeout: 60_000 });
    await page.getByText('E-mail disponível.').waitFor({ timeout: 60_000 });
    await shot(page, '02-register-preenchido');
  });

  await step('cadastro: envia e o app cria a conta, loga e redireciona', async () => {
    await page.getByRole('button', { name: 'Registrar', exact: true }).click();
    await page.getByText('Cadastro Realizado com Sucesso').first().waitFor({ timeout: 90_000 });
    await page.waitForURL((url) => !url.pathname.endsWith('/register'), { timeout: 60_000 });
    await page.waitForTimeout(2500);
    await shot(page, '03-apos-cadastro');
    return `URL final: ${new URL(page.url()).pathname}`;
  });

  let uid;
  await step('cadastro: conta existe no Auth emulado e o perfil existe no Firestore nomeado', async () => {
    const listing = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:query`, {
      method: 'POST',
      headers: { ...ADMIN, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const accounts = (await listing.json()).userInfo ?? [];
    const account = accounts.find((a) => a.email === user.email);
    if (!account) throw new Error('conta não encontrada no Auth emulado');
    uid = account.localId;
    const profile = await eventually(
      async () => (await queryCollection('users', 200)).find((doc) => asText(doc).includes(user.username)),
      { label: `perfil "${user.username}" em users (${DATABASE})` },
    );
    return `uid ${uid}; documento ${profile.name.split('/').pop()} em users (${DATABASE})`;
  });
  await context1.close();

  // ---------- 2. LOGIN (contexto 2, sem nenhuma sessão) ----------
  const context2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
  const page2 = await context2.newPage();
  page2.setDefaultTimeout(60_000);
  watch(page2);

  await step('login: contexto limpo entra com e-mail e senha', async () => {
    await page2.goto(`${BASE_URL}/pt-BR/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page2.locator('[data-testid="emulator-banner"][data-status="ok"]').waitFor({ timeout: 90_000 });
    await page2.fill('#email', user.email);
    await page2.fill('#password', user.password);
    await shot(page2, '04-login-preenchido');
    await page2.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page2.getByText('Login bem-sucedido').first().waitFor({ timeout: 90_000 });
    await page2.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 60_000 });
    await page2.waitForTimeout(2500);
    await shot(page2, '05-apos-login');
    return `URL final: ${new URL(page2.url()).pathname}`;
  });

  // ---------- 3. CRIAR PUBLICAÇÃO ----------
  await step('post: abre o diálogo, escreve e publica', async () => {
    await page2.getByRole('button', { name: 'Postar', exact: true }).first().click();
    const dialog = page2.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByPlaceholder('E aí?').fill(postText);
    await shot(page2, '06-post-dialogo');
    await dialog.getByRole('button', { name: 'Postar', exact: true }).click();
    // O toast (Radix) aparece no balão visível e no anunciador de acessibilidade: basta o primeiro.
    await page2.getByText('Post Enviado!').first().waitFor({ timeout: 90_000 });
    await page2.waitForTimeout(2000);
    await shot(page2, '07-apos-post');
  });

  let postId;
  await step('post: documento existe no Firestore nomeado, com o autor correto', async () => {
    const post = await eventually(
      async () => (await queryCollection('posts', 200)).find((doc) => asText(doc).includes(stamp)),
      { label: 'post em posts' },
    );
    postId = post.name.split('/').pop();
    const owner = post.fields?.userId?.stringValue;
    if (owner !== uid) throw new Error(`userId do post (${owner}) difere do uid da conta (${uid})`);
    // postsCount é incrementado pelo próprio cliente (createPostActions): informativo, não prova a Function.
    const author = (await queryCollection('users', 200)).find((doc) => doc.name.endsWith(`/${uid}`));
    const postsCount = author?.fields?.postsCount?.integerValue ?? author?.fields?.postsCount?.doubleValue ?? 'n/d';
    return `post ${post.name.split('/').pop()} (userId == uid); postsCount do autor: ${postsCount}`;
  });

  // Verificação de leitura: o post publicado deve aparecer no feed depois de recarregar a página.
  await step('feed: o post publicado aparece no feed após recarregar', async () => {
    await page2.reload({ waitUntil: 'domcontentloaded' });
    await page2.getByText(postText).first().waitFor({ timeout: 60_000 });
    await shot(page2, '08-feed-com-o-post');
  });

  // ---------- 4. COMENTAR E RESPONDER (exercita ReplyDialogContent e EmbeddedPostCard) ----------
  await step('comentário: comenta no post pelo diálogo de resposta de topo', async () => {
    await page2.goto(`${BASE_URL}/pt-BR/post/${postId}`, { waitUntil: 'domcontentloaded' });
    await page2.getByText(postText).first().waitFor({ timeout: 90_000 });
    await page2.waitForTimeout(2000);
    await page2.getByText('Escreva um comentário...').first().click();
    const dialog = page2.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByPlaceholder('Escreva um comentário...').fill(commentText);
    await shot(page2, '09-comentario-dialogo');
    await dialog.getByRole('button', { name: 'Responder', exact: true }).click();
    await page2.getByText(commentText).first().waitFor({ timeout: 90_000 });
    await shot(page2, '10-comentario-publicado');
    const stored = await eventually(
      async () => (await queryAllComments()).find((doc) => asText(doc).includes(commentText)),
      { label: 'comentário no Firestore' },
    );
    return `comentário ${stored.name.split('/').pop()} gravado`;
  });

  await step('resposta: responde ao comentário pelo diálogo de resposta a comentário', async () => {
    // O primeiro ícone de balão é o do post ("View comments"); o seguinte é o do comentário.
    await page2.locator('button:has(svg.lucide-message-circle)').nth(1).click();
    const dialog = page2.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByText('Respondendo a').waitFor({ timeout: 30_000 });
    await dialog.getByPlaceholder('Escreva um comentário...').fill(replyText);
    await shot(page2, '11-resposta-dialogo');
    await dialog.getByRole('button', { name: 'Responder', exact: true }).click();
    await page2.getByText('Resposta enviada!').first().waitFor({ timeout: 90_000 });
    const stored = await eventually(
      async () => (await queryAllComments()).find((doc) => asText(doc).includes(replyText)),
      { label: 'resposta no Firestore' },
    );
    await page2.waitForTimeout(1500);
    await shot(page2, '12-resposta-publicada');
    return `resposta ${stored.name.split('/').pop()} gravada`;
  });

  await step('isolamento: nenhum request do navegador foi a endpoint real do Google/Firebase', async () => {
    const real = [...hosts].filter((host) => REAL_GOOGLE_HOSTS.test(host));
    if (real.length) throw new Error(`hosts reais contatados: ${real.join(', ')}`);
    return `hosts contatados: ${[...hosts].sort().join(', ')}`;
  });
  await context2.close();
} catch {
  failed = true;
} finally {
  await browser.close();
  const summary = { project: PROJECT, database: DATABASE, baseUrl: BASE_URL, user: { username: user.username, email: user.email }, results, hosts: [...hosts].sort(), badResponses: [...badResponses].sort(), consoleErrors: [...new Set(consoleErrors)], pageErrors: [...new Set(pageErrors)] };
  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  log(`Resumo gravado em ${path.join(outDir, 'summary.json')}`);
  log(`Erros de console distintos: ${summary.consoleErrors.length} | erros de página: ${summary.pageErrors.length}`);
  for (const entry of summary.badResponses.slice(0, 12)) log(`  resposta HTTP com erro: ${entry}`);
  for (const message of summary.consoleErrors.slice(0, 8)) log(`  console.error: ${message}`);
  for (const message of summary.pageErrors.slice(0, 8)) log(`  pageerror: ${message}`);
  log(failed ? 'RESULTADO: FALHOU' : 'RESULTADO: PASSOU');
  process.exit(failed ? 1 : 0);
}
