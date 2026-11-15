#!/usr/bin/env node
/**
 * Prova a camada de mídia em produção com contas e objetos descartáveis.
 * Não lê arquivos de usuários reais, não imprime tokens/cookies e limpa tudo no finally.
 *
 * Requer ADC do gcloud e NEXT_PUBLIC_FIREBASE_API_KEY no ambiente.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const { generateMediaId } = await import('../src/lib/media/mediaId.ts');

const PROJECT = 'echo-b5aw9';
const DATABASE = 'echo-db-124325';
const BUCKET = 'echo-b5aw9.firebasestorage.app';
const ORIGIN = 'https://exercitodolula.app';
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
if (!API_KEY) throw new Error('Defina NEXT_PUBLIC_FIREBASE_API_KEY.');
const ACCESS_TOKEN = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
if (!ACCESS_TOKEN) throw new Error('Defina GOOGLE_OAUTH_ACCESS_TOKEN sem imprimi-lo.');

const credential = {
  getAccessToken: async () => ({ access_token: ACCESS_TOKEN, expires_in: 3_000 }),
};
const app = initializeApp({ credential, projectId: PROJECT, storageBucket: BUCKET });
const auth = getAuth(app);
const FS_ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/documents`;
const GCS_ROOT = `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o`;
const stamp = `${Date.now()}-${randomBytes(4).toString('hex')}`;
const password = `T3ste-${randomBytes(12).toString('base64url')}!`;
const users = [];
const paths = [];
const mediaIds = [];
let conversationId = '';

const ok = (name) => console.log(`OK    ${name}`);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function cloudCall(method, url, body, allow404 = false) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'x-goog-user-project': PROJECT,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (allow404 && response.status === 404) return null;
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* resposta sem JSON */ }
  if (!response.ok) {
    throw new Error(`${method} ${new URL(url).pathname} falhou (${response.status}): ${parsed?.error?.message ?? 'erro'}`);
  }
  return parsed;
}

const firestoreValue = (value) => {
  if (Array.isArray(value)) return { arrayValue: { values: value.map((item) => firestoreValue(item)) } };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value)
    ? { integerValue: String(value) }
    : { doubleValue: value };
  return { stringValue: String(value) };
};
const firestoreFields = (data) => Object.fromEntries(
  Object.entries(data).map(([key, value]) => [key, firestoreValue(value)]),
);
const docUrl = (path) => `${FS_ROOT}/${path}`;
const getDoc = (path) => cloudCall('GET', docUrl(path), undefined, true);
const setDoc = (path, data, updateFields = []) => {
  const query = new URLSearchParams();
  for (const field of updateFields) query.append('updateMask.fieldPaths', field);
  const suffix = query.size ? `?${query}` : '';
  return cloudCall('PATCH', `${docUrl(path)}${suffix}`, { fields: firestoreFields(data) });
};
const deleteDoc = (path) => cloudCall('DELETE', docUrl(path), undefined, true);
const getObject = (path) => cloudCall('GET', `${GCS_ROOT}/${encodeURIComponent(path)}`);
const deleteObject = (path) => cloudCall('DELETE', `${GCS_ROOT}/${encodeURIComponent(path)}`, undefined, true);

async function createTestUser(label) {
  const user = await auth.createUser({
    email: `teste-midia-${stamp}-${label}@example.com`,
    password,
    emailVerified: true,
    displayName: `Teste mídia ${label}`,
  });
  users.push(user.uid);
  await auth.setCustomUserClaims(user.uid, { member: true });
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password, returnSecureToken: true }),
    },
  );
  const body = await response.json();
  assert(response.ok && typeof body.idToken === 'string', `login descartável ${label} falhou (${response.status})`);
  return { uid: user.uid, idToken: body.idToken };
}

async function sessionFor(idToken) {
  const response = await fetch(`${ORIGIN}/api/auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  assert(response.ok, `criação de sessão falhou (${response.status})`);
  const setCookie = response.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/(?:^|,\s*)(__session=[^;]+)/);
  assert(match, 'cookie __session não foi emitido');
  return match[1];
}

async function upload(idToken, storagePath, bytes, name, contentType) {
  const form = new FormData();
  form.append('file', new File([bytes], name, { type: contentType }));
  form.append('storagePath', storagePath);
  const response = await fetch(`${ORIGIN}/api/media/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  assert(response.status === 201, `upload falhou (${response.status}; ${String(body.error ?? 'sem-código')})`);
  assert(typeof body.mediaId === 'string' && typeof body.downloadURL === 'string', 'resposta de upload incompleta');
  assert(body.filePath === storagePath, 'servidor devolveu caminho diferente do solicitado');
  paths.push(storagePath);
  mediaIds.push(body.mediaId);
  return body;
}

async function assertNoToken(storagePath) {
  const metadata = await getObject(storagePath);
  const token = metadata?.metadata?.firebaseStorageDownloadTokens;
  assert(token === undefined || token === null || token === '', 'objeto novo nasceu com token permanente');
}

async function head(pathOrUrl, cookie, expected) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${ORIGIN}${pathOrUrl}`;
  const headers = cookie ? { Cookie: cookie } : {};
  const response = await fetch(url, { method: 'HEAD', headers, redirect: 'manual' });
  assert(response.status === expected, `HEAD ${new URL(url).pathname}: veio ${response.status}, esperado ${expected}`);
  return response;
}

async function waitForTombstone(mediaId, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await getDoc(`media/${mediaId}`);
    if (snapshot?.fields?.deletedAt?.timestampValue) return;
    await sleep(2_000);
  }
  throw new Error('onUserDeletedCleanup não marcou a mídia dentro do prazo');
}

try {
  const [owner, participant, outsider] = await Promise.all([
    createTestUser('a'), createTestUser('b'), createTestUser('c'),
  ]);
  const [ownerCookie, participantCookie, outsiderCookie] = await Promise.all([
    sessionFor(owner.idToken), sessionFor(participant.idToken), sessionFor(outsider.idToken),
  ]);
  ok('três contas verificadas e sessões descartáveis criadas');

  const privatePath = `user_uploads/${owner.uid}/user_files/teste-${stamp}.txt`;
  const privateUpload = await upload(owner.idToken, privatePath, 'arquivo privado descartável', 'teste.txt', 'text/plain');
  assert(privateUpload.downloadURL === `/mp/${privateUpload.mediaId}`, 'arquivo pessoal não recebeu /mp/<id>');
  await assertNoToken(privatePath);
  const privateDoc = await getDoc(`media/${privateUpload.mediaId}`);
  assert(privateDoc?.fields?.visibility?.stringValue === 'private', 'registro privado media/{id} inválido');
  await head(privateUpload.downloadURL, ownerCookie, 200);
  await head(privateUpload.downloadURL, '', 404);
  await head(privateUpload.downloadURL, participantCookie, 404);
  ok('arquivo pessoal: sem token; dono 200; anônimo e outra conta 404');

  const dmPath = `user_uploads/${owner.uid}/dms/files/teste-${stamp}.txt`;
  const dmUpload = await upload(owner.idToken, dmPath, 'anexo privado descartável', 'anexo.txt', 'text/plain');
  await assertNoToken(dmPath);
  conversationId = [owner.uid, participant.uid].sort().join('_');
  const conversationPath = `conversations/${conversationId}`;
  await setDoc(conversationPath, { participantIds: [owner.uid, participant.uid], createdAt: new Date() });
  await head(dmUpload.downloadURL, participantCookie, 200);
  await head(dmUpload.downloadURL, outsiderCookie, 404);
  await setDoc(conversationPath, { participantIds: [owner.uid] }, ['participantIds']);
  await head(dmUpload.downloadURL, participantCookie, 404);
  await setDoc(conversationPath, { participantIds: [owner.uid, participant.uid] }, ['participantIds']);
  const blockPath = `users/${owner.uid}/blockedUsers/${participant.uid}`;
  await setDoc(blockPath, { createdAt: new Date() });
  await head(dmUpload.downloadURL, participantCookie, 404);
  await deleteDoc(blockPath);
  await head(dmUpload.downloadURL, participantCookie, 200);
  ok('anexo: participante 200; estranho, removido e bloqueado 404; desbloqueio restaura 200');

  // Anexo COPIADO. O reenvio antigo copiava a URL em vez do arquivo, e o conserto desses casos legados é uma cópia
  // do objeto para a pasta de quem reenviou. Um objeto copiado tem de atravessar a rota como qualquer outro, e a
  // cópia tem de nascer sem token: o `copyTo` do Storage leva os metadados da origem, token incluído.
  const copyPath = `user_uploads/${participant.uid}/dms/images/${randomUUID()}.txt`;
  await cloudCall(
    'POST',
    `${GCS_ROOT}/${encodeURIComponent(dmPath)}/copyTo/b/${BUCKET}/o/${encodeURIComponent(copyPath)}`,
    {},
  );
  paths.push(copyPath);
  await cloudCall('PATCH', `${GCS_ROOT}/${encodeURIComponent(copyPath)}`, {
    metadata: { firebaseStorageDownloadTokens: null },
  });
  await assertNoToken(copyPath);
  const copyMeta = await getObject(copyPath);
  const copyId = generateMediaId();
  mediaIds.push(copyId);
  await setDoc(`media/${copyId}`, {
    storagePath: copyPath,
    contentType: copyMeta.contentType ?? 'text/plain',
    size: Number(copyMeta.size ?? 0),
    ownerUid: participant.uid,
    visibility: 'private',
    kind: 'dm',
    createdAt: new Date(),
  });
  await head(`/mp/${copyId}`, participantCookie, 200);
  await head(`/mp/${copyId}`, ownerCookie, 200);
  await head(`/mp/${copyId}`, outsiderCookie, 404);
  await head(`/mp/${copyId}`, '', 404);
  const fatia = await fetch(`${ORIGIN}/mp/${copyId}`, {
    headers: { Cookie: participantCookie, Range: 'bytes=0-9' },
  });
  assert(fatia.status === 206, `Range na cópia veio ${fatia.status}, esperado 206`);
  assert((await fatia.arrayBuffer()).byteLength === 10, 'Range na cópia não devolveu 10 bytes');
  ok('anexo copiado: sem token, dono e participante 200, estranho e anônimo 404, Range 206');

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const publicPath = `user_uploads/${owner.uid}/postMedia/images/teste-${stamp}.png`;
  const publicUpload = await upload(owner.idToken, publicPath, png, 'teste.png', 'image/png');
  assert(publicUpload.downloadURL === `https://media.exercitodolula.app/m/${publicUpload.mediaId}`, 'URL pública própria incorreta');
  await assertNoToken(publicPath);
  const publicResponse = await head(publicUpload.downloadURL, '', 200);
  assert(publicResponse.headers.get('access-control-allow-origin') === '*', 'mídia pública sem CORS externo');
  ok('mídia pública: URL própria, anônima 200, CORS externo e nenhum token');

  const logout = await fetch(`${ORIGIN}/api/auth/session`, { method: 'DELETE', headers: { Cookie: ownerCookie } });
  assert(logout.ok && /Max-Age=0/i.test(logout.headers.get('set-cookie') ?? ''), 'logout não apagou __session');
  await head(privateUpload.downloadURL, '', 404);
  ok('logout seguido de acesso privado retorna 404');

  await setDoc(`media/${privateUpload.mediaId}`, { deletedAt: new Date() }, ['deletedAt']);
  await head(privateUpload.downloadURL, ownerCookie, 404);
  ok('tombstone corta acesso até do dono');

  await auth.deleteUser(owner.uid);
  users.splice(users.indexOf(owner.uid), 1);
  await waitForTombstone(publicUpload.mediaId);
  await head(publicUpload.downloadURL, '', 410);
  await head(dmUpload.downloadURL, participantCookie, 404);
  ok('exclusão da conta propaga tombstone: público 410 e anexo 404');

  console.log(`RESULTADO: ${mediaIds.length} uploads novos, todos sem token permanente; matriz de produção aprovada.`);
} finally {
  if (conversationId) await deleteDoc(`conversations/${conversationId}`).catch(() => {});
  for (const uid of users) await auth.deleteUser(uid).catch(() => {});
  for (const path of paths) await deleteObject(path).catch(() => {});
  for (const id of mediaIds) await deleteDoc(`media/${id}`).catch(() => {});
  await deleteApp(app);
  console.log('LIMPEZA: contas, registros e objetos descartáveis removidos.');
}
