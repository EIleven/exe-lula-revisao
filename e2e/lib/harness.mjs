/**
 * Utilidades compartilhadas pelos testes E2E contra os EMULADORES do Firebase (e2e/*.mjs).
 *
 * Tudo aqui só fala com 127.0.0.1 (emuladores) e com o app local. O token "Bearer owner" é o
 * administrador aceito SOMENTE pelos emuladores: contra o Firebase real ele não vale nada.
 * Dados criados pelos testes são descartáveis (`E2E_RESET=1` zera os emuladores).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

export const PROJECT = 'demo-soberan';
export const DATABASE = process.env.E2E_FIRESTORE_DATABASE ?? 'echo-db-124325';
export const BUCKET = `${PROJECT}.appspot.com`;
export const EMU = {
  hub: 'http://127.0.0.1:4400',
  auth: 'http://127.0.0.1:9099',
  firestore: 'http://127.0.0.1:8080',
  storage: 'http://127.0.0.1:9199',
  functions: 'http://127.0.0.1:5001',
  database: 'http://127.0.0.1:9000',
};
export const ADMIN = { Authorization: 'Bearer owner' };
export const REQUIRED_EMULATORS = ['auth', 'firestore', 'functions', 'database', 'storage'];

// Qualquer host destes, contatado pelo navegador, significa que algo escapou dos emuladores.
export const REAL_GOOGLE_HOSTS =
  /(^|\.)(googleapis\.com|firebaseio\.com|firebaseapp\.com|cloudfunctions\.net|google-analytics\.com|googletagmanager\.com|googlesyndication\.com|doubleclick\.net|gstatic\.com|google\.com)$/;

export async function loadPlaywright() {
  const file = process.env.E2E_NODE_MODULES && path.join(process.env.E2E_NODE_MODULES, 'playwright-core', 'index.mjs');
  if (file && existsSync(file)) return import(pathToFileURL(file).href);
  return import('playwright-core');
}

/**
 * Registro de passos com saída padronizada: `await step('nome', async () => 'detalhe')`.
 * `section(nome)` agrupa os passos seguintes (matriz de funcionalidades); `soft(nome, fn, { tag })` registra a falha e
 * o teste CONTINUA (para coletar todas as falhas de uma vez); `skip(nome, motivo)` registra "não implementado".
 */
export function createRunner(prefix = 'e2e') {
  const results = [];
  let currentSection = '';
  const log = (message) => console.log(`[${prefix} ${new Date().toISOString().slice(11, 19)}] ${message}`);
  const section = (name) => {
    currentSection = name;
    log(`=== ${name} ===`);
  };
  async function step(name, run, { tag = '' } = {}) {
    const started = Date.now();
    try {
      const detail = await run();
      results.push({ section: currentSection, name, status: 'passou', tag, ms: Date.now() - started, detail: detail ?? '' });
      log(`OK    ${name}${detail ? ` — ${detail}` : ''}`);
      return detail;
    } catch (error) {
      const message = String(error?.message ?? error);
      results.push({ section: currentSection, name, status: 'falhou', tag, ms: Date.now() - started, detail: message });
      log(`FALHA ${name} — ${message.split('\n')[0]}`);
      throw error;
    }
  }
  async function soft(name, run, options) {
    try {
      return await step(name, run, options);
    } catch {
      process.exitCode = 1;
      return undefined;
    }
  }
  const skip = (name, reason) => {
    results.push({ section: currentSection, name, status: 'não implementado', tag: '', ms: 0, detail: reason });
    log(`PULOU ${name} — ${reason}`);
  };
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  return { results, log, section, step, soft, skip, check };
}

/** Tabela em Markdown (seção, teste, resultado) para a matriz de funcionalidades. */
export function matrixMarkdown(results) {
  const icon = { passou: 'passou', falhou: '**FALHOU**', 'não implementado': 'não implementado' };
  const rows = results.map((r) => `| ${r.section} | ${r.name.replace(/\|/g, '/')} | ${icon[r.status] ?? r.status}${r.tag ? ` (${r.tag})` : ''} |`);
  return ['| Área | Verificação | Resultado |', '|---|---|---|', ...rows].join('\n');
}

/** A interface mostra o resultado antes de a gravação terminar: as verificações repetem até passar. */
export async function eventually(check, { timeoutMs = 20_000, intervalMs = 500, label = 'condição' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${label} não foi satisfeita em ${timeoutMs} ms`);
}

/**
 * O estado pedido E parado nele por `windowMs`. Toques rápidos viram uma FILA de gravações que, numa conexão lenta, leva
 * alguns segundos: o banco passa por estados intermediários que coincidem com o esperado, e uma checagem pontual
 * (`eventually`) daria por terminado o que ainda não terminou.
 */
export async function stableFor(check, { windowMs = 4000, timeoutMs = 40_000, intervalMs = 250, label = 'condição' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let since = null;
  while (Date.now() < deadline) {
    if (await check()) {
      since ??= Date.now();
      if (Date.now() - since >= windowMs) return;
    } else {
      since = null;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${label} não ficou estável em ${timeoutMs} ms`);
}

export async function emulatorsRunning() {
  const running = Object.keys(await (await fetch(`${EMU.hub}/emulators`)).json());
  const missing = REQUIRED_EMULATORS.filter((name) => !running.includes(name));
  if (missing.length) throw new Error(`emuladores ausentes: ${missing.join(', ')}`);
  return running.filter((name) => !['hub', 'logging', 'ui', 'eventarc', 'tasks'].includes(name));
}

export async function resetEmulators() {
  await fetch(`${EMU.auth}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE', headers: ADMIN });
  await fetch(`${EMU.firestore}/emulator/v1/projects/${PROJECT}/databases/${encodeURIComponent(DATABASE)}/documents`, {
    method: 'DELETE',
    headers: ADMIN,
  });
}

export async function authAccounts() {
  const response = await fetch(`${EMU.auth}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:query`, {
    method: 'POST',
    headers: { ...ADMIN, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) throw new Error(`accounts:query retornou HTTP ${response.status}`);
  return (await response.json()).userInfo ?? [];
}

/** Marca o e-mail como confirmado SOMENTE no emulador de Auth. */
export async function verifyAuthEmail(uid) {
  const response = await fetch(`${EMU.auth}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, {
    method: 'POST',
    headers: { ...ADMIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid, emailVerified: true }),
  });
  if (!response.ok) throw new Error(`accounts:update(emailVerified) retornou HTTP ${response.status}`);
}

/** Entra pela API REST do Auth emulado e devolve { idToken, localId }. */
export async function signInRest(email, password) {
  const response = await fetch(`${EMU.auth}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!response.ok) throw new Error(`signInWithPassword retornou HTTP ${response.status}`);
  return response.json();
}

export const documentsBase = () => `${EMU.firestore}/v1/projects/${PROJECT}/databases/${encodeURIComponent(DATABASE)}/documents`;

/** Consulta administrativa (ignora as regras): lista documentos de uma coleção, em qualquer nível se `allDescendants`. */
export async function adminRunQuery(collectionId, { allDescendants = false, limit = 200 } = {}) {
  const response = await fetch(`${documentsBase()}:runQuery`, {
    method: 'POST',
    headers: { ...ADMIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId, allDescendants }], limit } }),
  });
  if (!response.ok) throw new Error(`runQuery(${collectionId}) retornou HTTP ${response.status}`);
  return (await response.json()).filter((row) => row.document).map((row) => row.document);
}

export const docText = (doc) => JSON.stringify(doc.fields ?? {});

// ---------- usuários descartáveis e ações de interface ----------

export function newUser(label = '', stamp = Date.now().toString(36)) {
  const tag = `${stamp}${label}`;
  return {
    name: `Teste E2E ${tag}`,
    username: `e2e_${tag}`,
    email: `e2e.${tag}@example.test`,
    dob: '1990-01-01',
    password: 'Teste!123456',
    tag,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Limite dos primeiros usuários: _signup/control (limit, used) e uma vaga por UID em _signup/control/slots/{uid}.
// Sem o documento de controle o cadastro FECHA (as Functions createUserProfile e claimGoogleProfile recusam), então
// todo teste que cadastra conta precisa dele: registerViaUi garante que exista.
// ---------------------------------------------------------------------------------------------------------------------
export async function seedSignupControl({ limit = 500, used = 0, issued } = {}) {
  const now = new Date();
  // Os testes alteram `used` artificialmente para simular 499/500 vagas. O
  // número histórico não pode voltar junto, ou duas vagas ganhariam o mesmo
  // número depois de uma isenção ou de uma dessas simulações.
  const slots = await signupSlots();
  const issuedValue = issued ?? Math.max(0, ...slots.map((slot) => Number(slot.number) || 0));
  const result = await fsSet('_signup/control', { limit, used, issued: issuedValue, createdAt: now, updatedAt: now }, 'owner');
  if (result.status !== 200) throw new Error(`não consegui gravar o controle do cadastro (HTTP ${result.status})`);
}
/** Lê o documento de controle com o administrador do emulador (null se não existe). */
export async function signupControl() {
  return (await fsGetDoc('_signup/control', 'owner')).doc;
}
/** Cria o controle (limite 500, 0 usadas) só se ainda não existe; não mexe num que já esteja lá. */
export async function ensureSignupControl() {
  if (!(await signupControl())) await seedSignupControl();
}
/** Vagas já registradas (um documento por UID). */
export async function signupSlots() {
  return (await fsList('_signup/control/slots', 'owner', 1000)).docs;
}

/** Liga ou desliga a verificação anti-robô (App Check) do cadastro: o campo requireAppCheck do documento de controle. */
export async function setSignupAppCheck(on) {
  const result = await fsUpdate('_signup/control', { requireAppCheck: on }, 'owner');
  if (result.status !== 200) throw new Error(`não consegui gravar requireAppCheck (HTTP ${result.status})`);
}

/**
 * Token do App Check como o navegador de uma pessoa o envia (cabeçalho X-Firebase-AppCheck). No emulador as Functions
 * não conferem a assinatura (skipTokenVerification), só decodificam: basta um JWT bem formado com o id do app em `sub`.
 */
export function fakeAppCheckToken(appId = '1:000000000000:web:0000000000000000') {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ iss: 'https://firebaseappcheck.googleapis.com/000000000000', sub: appId, aud: [`projects/${PROJECT}`], iat: now, exp: now + 3600 })}.`;
}

/**
 * Chama uma Function callable pela REST do emulador. Devolve { status, result, error } ({ status, details, message }).
 * `appCheck`: token do App Check a enviar no cabeçalho (veja fakeAppCheckToken).
 */
export async function callFunction(name, data, idToken, { appCheck } = {}) {
  const response = await fetch(`${EMU.functions}/${PROJECT}/southamerica-east1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      ...(appCheck ? { 'X-Firebase-AppCheck': appCheck } : {}),
    },
    body: JSON.stringify({ data: data ?? {} }),
  });
  let json = null;
  try { json = await response.json(); } catch { /* sem corpo */ }
  return { status: response.status, result: json?.result, error: json?.error };
}

/**
 * Primeiro acesso com o Google no Auth emulado: o emulador aceita um id_token fictício (JWT sem assinatura) e cria a
 * conta com o provedor google.com, exatamente como o Firebase faz no primeiro login. Devolve { idToken, localId }.
 */
export async function fakeGoogleSignIn({ email, name = 'Pessoa Google', picture, sub = `google-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const fakeToken = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ iss: 'https://accounts.google.com', aud: PROJECT, sub, email, email_verified: true, name, ...(picture ? { picture } : {}) })}.`;
  const response = await fetch(`${EMU.auth}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestUri: 'http://localhost', returnSecureToken: true, returnIdpResponse: true, postBody: `id_token=${fakeToken}&providerId=google.com` }),
  });
  const json = await response.json();
  if (!response.ok || !json.idToken) throw new Error(`signInWithIdp falhou: HTTP ${response.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

/** Exclui a conta no Auth emulado (dispara a Function onUserDeletedCleanup, como excluir a conta no app). */
export async function deleteAuthAccount(uid) {
  const response = await fetch(`${EMU.auth}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:delete`, {
    method: 'POST',
    headers: { ...ADMIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid }),
  });
  if (!response.ok) throw new Error(`accounts:delete retornou HTTP ${response.status}`);
}

/** Cadastro pela interface real (a disponibilidade é validada pela Cloud Function `checkAvailability`). */
export async function registerViaUi(page, baseUrl, user, { confirmEmail = true } = {}) {
  await ensureSignupControl();
  await page.goto(`${baseUrl}/pt-BR/register`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.locator('[data-testid="emulator-banner"][data-status="ok"]').waitFor({ timeout: 90_000 });
  await page.fill('#name', user.name);
  await page.fill('#username', user.username);
  await page.fill('#email', user.email);
  await page.fill('#dateOfBirth', user.dob);
  await page.fill('#password', user.password);
  await page.fill('#confirm-password', user.password);
  await page.getByText('Nome de usuário disponível.').waitFor({ timeout: 60_000 });
  await page.getByText('Formato de e-mail válido.').waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Registrar', exact: true }).click();
  await page.getByText('Cadastro Realizado com Sucesso').first().waitFor({ timeout: 90_000 });
  await page.waitForURL((url) => !url.pathname.endsWith('/register'), { timeout: 60_000 });
  if (confirmEmail) {
    const account = (await authAccounts()).find((item) => item.email === user.email);
    if (!account) throw new Error('conta recém-criada não apareceu no Auth emulado');
    await verifyAuthEmail(account.localId);
    await page.getByRole('button', { name: /J[aá] confirmei/ }).click();
    await page.waitForURL((url) => !url.pathname.includes('/auth/verify-email'), { timeout: 60_000 });
  }
  await page.waitForTimeout(2500);
  await recusarCookies(page);
}

/**
 * O banner de consentimento de cookies (parte de baixo da tela) cobre botões e intercepta cliques. Recusar tudo é a escolha
 * que não grava nada além do necessário; a escolha fica no navegador, então basta uma vez por contexto.
 */
export async function recusarCookies(page) {
  const botao = page.getByRole('button', { name: 'Rejeitar tudo' });
  if (await botao.waitFor({ timeout: 8_000 }).then(() => true, () => false)) await botao.click();
}

/** Login pela interface real, a partir de um contexto sem sessão. */
export async function loginViaUi(page, baseUrl, user) {
  await page.goto(`${baseUrl}/pt-BR/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.locator('[data-testid="emulator-banner"][data-status="ok"]').waitFor({ timeout: 90_000 });
  await page.fill('#email', user.email);
  await page.fill('#password', user.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByText('Login bem-sucedido').first().waitFor({ timeout: 90_000 });
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 60_000 });
  await page.waitForTimeout(2500);
  await recusarCookies(page);
}

/** Publica um post de texto pelo diálogo "Postar". */
export async function createPostViaUi(page, text) {
  await page.getByRole('button', { name: 'Postar', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await dialog.getByPlaceholder('E aí?').fill(text);
  await dialog.getByRole('button', { name: 'Postar', exact: true }).click();
  await page.getByText('Post Enviado!').first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(2000);
}

// ---------- Firestore REST (administrador do emulador ou usuário real, sujeito às regras) ----------

export function fsValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(fsValue) } };
  if (typeof value === 'object') return { mapValue: { fields: fsFields(value) } };
  throw new Error(`valor não suportado: ${typeof value}`);
}
export const fsFields = (object) => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, fsValue(value)]));

/** Converte o valor tipado da REST em valor simples. */
export function fsPlain(value) {
  if (!value || typeof value !== 'object') return value;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('referenceValue' in value) return value.referenceValue;
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(fsPlain);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields ?? {}).map(([k, v]) => [k, fsPlain(v)]));
  return value;
}
export const docPlain = (doc) => ({ __id: doc.name?.split('/').pop(), __path: doc.name?.split('/documents/')[1], ...Object.fromEntries(Object.entries(doc.fields ?? {}).map(([k, v]) => [k, fsPlain(v)])) });

/** token: 'owner' (administrador do emulador), um idToken de usuário, ou undefined (sem login). */
const authHeader = (token) => (token ? { Authorization: `Bearer ${token}` } : {});

export async function fsCall(method, resource, { token, body, query } = {}) {
  const qs = query ? `?${query}` : '';
  const response = await fetch(`${documentsBase()}${resource ? `/${resource}` : ''}${qs}`, {
    method,
    headers: { ...authHeader(token), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await response.json(); } catch { /* sem corpo */ }
  return { status: response.status, json };
}

/** Lê um documento. Devolve { status, doc } com doc já em valores simples (ou null). */
export async function fsGetDoc(path, token) {
  const { status, json } = await fsCall('GET', path, { token });
  return { status, doc: status === 200 ? docPlain(json) : null };
}
/** Cria (falha se existir) com id explícito. */
export async function fsCreate(collectionPath, id, data, token) {
  return fsCall('POST', collectionPath, { token, query: `documentId=${encodeURIComponent(id)}`, body: { fields: fsFields(data) } });
}
/** Grava o documento inteiro, criando ou substituindo (idempotente; sujeito às regras se houver token de usuário). */
export const fsSet = (path, data, token) => fsCall('PATCH', path, { token, body: { fields: fsFields(data) } });
/** Atualiza só os campos informados (updateMask) de um documento que já existe. */
export async function fsUpdate(path, data, token) {
  const mask = Object.keys(data).map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join('&');
  return fsCall('PATCH', path, { token, query: `${mask}&currentDocument.exists=true`, body: { fields: fsFields(data) } });
}
/** Grava só os campos informados (updateMask), criando o documento se ele ainda não existe. */
export async function fsUpsert(path, data, token) {
  const mask = Object.keys(data).map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join('&');
  return fsCall('PATCH', path, { token, query: mask, body: { fields: fsFields(data) } });
}
export const fsDelete = (path, token) => fsCall('DELETE', path, { token });
/**
 * Cria com id explícito e com as datas preenchidas pelo SERVIDOR (as regras exigem createdAt == request.time, como o
 * serverTimestamp() do app). Sem isso um teste "permitido" falharia pela data, não pela regra que se quer testar.
 */
export async function fsCreateAtServerTime(collectionPath, id, data, token, timeFields = ['createdAt']) {
  const name = `projects/${PROJECT}/databases/${DATABASE}/documents/${collectionPath}/${id}`;
  const fields = fsFields(Object.fromEntries(Object.entries(data).filter(([key]) => !timeFields.includes(key))));
  const response = await fetch(`${documentsBase()}:commit`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      writes: [{
        update: { name, fields },
        currentDocument: { exists: false },
        updateTransforms: timeFields.map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })),
      }],
    }),
  });
  let json = null;
  try { json = await response.json(); } catch { /* sem corpo */ }
  return { status: response.status, json };
}
/** Lista uma coleção (regra `list`). */
export async function fsList(collectionPath, token, pageSize = 50) {
  const { status, json } = await fsCall('GET', collectionPath, { token, query: `pageSize=${pageSize}` });
  return { status, docs: status === 200 ? (json.documents ?? []).map(docPlain) : [] };
}
/** runQuery estruturada (também sujeita à regra `list`). */
export async function fsQuery(structuredQuery, token) {
  const response = await fetch(`${documentsBase()}:runQuery`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
  });
  let json = null;
  try { json = await response.json(); } catch { /* sem corpo */ }
  const docs = response.status === 200 ? json.filter((row) => row.document).map((row) => docPlain(row.document)) : [];
  return { status: response.status, docs, json };
}
export const whereEq = (field, value) => ({ fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: fsValue(value) } });
export const collectionQuery = (collectionId, { where, limit, allDescendants = false } = {}) => ({
  from: [{ collectionId, allDescendants }],
  ...(where ? { where } : {}),
  ...(limit ? { limit } : {}),
});

/** Usa o administrador do emulador para buscar documentos de uma coleção que cumpram um filtro simples. */
export async function adminFind(collectionId, filters = {}, { allDescendants = false, limit = 200 } = {}) {
  const entries = Object.entries(filters);
  const where = entries.length === 0 ? undefined : entries.length === 1
    ? whereEq(entries[0][0], entries[0][1])
    : { compositeFilter: { op: 'AND', filters: entries.map(([k, v]) => whereEq(k, v)) } };
  const { status, docs } = await fsQuery(collectionQuery(collectionId, { where, limit, allDescendants }), 'owner');
  if (status !== 200) throw new Error(`adminFind(${collectionId}) retornou HTTP ${status}`);
  return docs;
}
export const adminGetDoc = (path) => fsGetDoc(path, 'owner');

// ---------- Storage REST (emulador) ----------
const storageAuth = (token) => (token === 'owner' ? { Authorization: 'Bearer owner' } : token ? { Authorization: `Firebase ${token}` } : {});
export async function storageUpload(objectName, bytes, contentType, token) {
  const response = await fetch(`${EMU.storage}/v0/b/${BUCKET}/o?name=${encodeURIComponent(objectName)}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, ...storageAuth(token) },
    body: bytes,
  });
  let json = null;
  try { json = await response.json(); } catch { /* sem corpo */ }
  return { status: response.status, json };
}
export async function storageRead(objectName, token) {
  const response = await fetch(`${EMU.storage}/v0/b/${BUCKET}/o/${encodeURIComponent(objectName)}?alt=media`, { headers: storageAuth(token) });
  return { status: response.status, bytes: response.status === 200 ? Buffer.from(await response.arrayBuffer()) : null };
}
export async function storageDelete(objectName, token) {
  const response = await fetch(`${EMU.storage}/v0/b/${BUCKET}/o/${encodeURIComponent(objectName)}`, { method: 'DELETE', headers: storageAuth(token) });
  return { status: response.status };
}
export async function storageList(prefix) {
  const response = await fetch(`${EMU.storage}/v0/b/${BUCKET}/o?prefix=${encodeURIComponent(prefix)}`, { headers: storageAuth('owner') });
  const json = await response.json().catch(() => ({}));
  return (json.items ?? []).map((item) => item.name);
}

// ---------- imagem de teste (PNG válido, gerado aqui, sem arquivos no repositório) ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
/** PNG RGB de cor única. */
export function makePng(width = 64, height = 64, [r, g, b] = [11, 92, 255]) {
  const rowSize = width * 3 + 1;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = y * rowSize + 1 + x * 3;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 bits por canal
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Mídia por id OPACO. Depois da camada de mídia, o app não guarda mais URL do Storage: posts e comentários guardam
// https://media.exercitodolula.app/m/<id> (público) e mensagens guardam /mp/<id> (privado, exige a sessão). As duas
// rotas são do PRÓPRIO app, então os testes as exercitam de verdade: o navegador de teste manda o domínio público de
// produção para o app local, e a leitura sem navegador (anônima, outra pessoa, o dono) vai direto ao app.
// ---------------------------------------------------------------------------------------------------------------------
export const MEDIA_PUBLIC_HOST = 'media.exercitodolula.app';
const ID22 = '[A-Za-z0-9_-]{22}';
export const PUBLIC_MEDIA_URL = new RegExp(`^https://media[.]exercitodolula[.]app/m/(${ID22})$`);
export const PRIVATE_MEDIA_PATH = new RegExp(`^/mp/(${ID22})$`);
/** Id opaco de uma URL pública (/m/<id>) ou de um caminho privado (/mp/<id>); null para qualquer outra coisa. */
export const mediaIdFromUrl = (url) => (PUBLIC_MEDIA_URL.exec(String(url ?? '')) ?? PRIVATE_MEDIA_PATH.exec(String(url ?? '')))?.[1] ?? null;
export const isPublicMediaUrl = (url) => PUBLIC_MEDIA_URL.test(String(url ?? ''));
export const isPrivateMediaPath = (url) => PRIVATE_MEDIA_PATH.test(String(url ?? ''));

/**
 * Faz o navegador de teste buscar o domínio público de mídia NO APP LOCAL. A URL gravada nos posts é a de produção
 * (https://media.exercitodolula.app/m/<id>), que não existe no ambiente de teste; sem isto nenhuma imagem carregaria e
 * a rota /m nunca seria exercitada. O corpo e os cabeçalhos (inclusive Range e os de cache) vêm da rota real.
 */
export async function mapearMidiaPublicaParaLocal(context, baseUrl) {
  await context.route(`https://${MEDIA_PUBLIC_HOST}/**`, async (route) => {
    const original = new URL(route.request().url());
    const resposta = await route.fetch({ url: `${baseUrl}${original.pathname}${original.search}` });
    await route.fulfill({ response: resposta });
  });
}

/** Valor do cookie de sessão (__session) de um contexto de navegador, ou null se a pessoa não está logada. */
export async function cookieDeSessao(context) {
  const cookie = (await context.cookies()).find((c) => c.name === '__session');
  return cookie ? `__session=${cookie.value}` : null;
}

/**
 * Lê uma mídia pelas rotas do app, SEM navegador: { status, headers, bytes }. `privada` usa /mp (precisa de `cookie`);
 * sem `cookie` é uma requisição anônima. `range` é o valor do cabeçalho Range, ex.: "bytes=0-9".
 */
export async function lerMidia(baseUrl, id, { privada = false, cookie = null, range = null, metodo = 'GET' } = {}) {
  const resposta = await fetch(`${baseUrl}/${privada ? 'mp' : 'm'}/${id}`, {
    method: metodo,
    redirect: 'manual',
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(range ? { Range: range } : {}) },
  });
  const bytes = metodo === 'HEAD' ? null : Buffer.from(await resposta.arrayBuffer());
  return { status: resposta.status, headers: Object.fromEntries(resposta.headers.entries()), bytes };
}

/** Metadados de um objeto do Storage emulado (inclui downloadTokens, se houver). null se o objeto não existe. */
export async function storageMetadata(objectName) {
  const response = await fetch(`${EMU.storage}/v0/b/${BUCKET}/o/${encodeURIComponent(objectName)}`, { headers: storageAuth('owner') });
  if (response.status !== 200) return null;
  return response.json().catch(() => null);
}

/**
 * Envio RETOMÁVEL ao Storage emulado, como o SDK Web faz (é o único jeito de gravar metadados personalizados, que as
 * regras de video_staging exigem). Devolve { status, etapa }: etapa "start" ou "finalize" indica onde o emulador respondeu.
 * 200 = gravado. Com `token` é uma pessoa logada; sem token é anônimo; 'owner' é o administrador do emulador.
 */
export async function storageUploadResumable(objectName, bytes, contentType, customMetadata, token) {
  const inicio = await fetch(`${EMU.storage}/v0/b/${BUCKET}/o?name=${encodeURIComponent(objectName)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.length),
      'X-Goog-Upload-Header-Content-Type': contentType,
      ...storageAuth(token),
    },
    body: JSON.stringify({ name: objectName, contentType, metadata: customMetadata }),
  });
  if (inicio.status !== 200) return { status: inicio.status, etapa: 'start' };
  const url = inicio.headers.get('x-goog-upload-url');
  if (!url) return { status: 0, etapa: 'start', erro: 'sem x-goog-upload-url' };
  const fim = await fetch(url, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0', ...storageAuth(token) },
    body: bytes,
  });
  return { status: fim.status, etapa: 'finalize' };
}

/** Cria uma conta no Auth emulado SEM confirmar o e-mail (sem o claim member): { uid, idToken }. */
export async function signUpUnverified(label = 'naoverificada') {
  const email = `e2e.${label}.${Date.now().toString(36)}@example.test`;
  const response = await fetch(`${EMU.auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Teste!123456', returnSecureToken: true }),
  });
  const json = await response.json();
  return { uid: json.localId, idToken: json.idToken };
}
