#!/usr/bin/env node
/**
 * Acrescenta a claim `member: true` somente a contas que possuem perfil E vaga.
 * Preserva todas as claims existentes (inclusive admin/moderacao).
 *
 *  npm run migrar:claims                         emuladores, dry-run
 *  npm run migrar:claims -- --aplicar            emuladores, grava
 *  npm run migrar:claims -- --producao           producao, dry-run
 *  npm run migrar:claims -- --producao --aplicar producao, grava (so com autorizacao)
 *  npm run migrar:claims -- --producao --conferir sai 1 se faltar claim
 */

const args = new Set(process.argv.slice(2));
const production = args.has('--producao');
const apply = args.has('--aplicar');
const checkOnly = args.has('--conferir');
if (apply && checkOnly) {
  console.error('--conferir nao grava: nao combine com --aplicar.');
  process.exit(2);
}

const projectId = production ? 'echo-b5aw9' : 'demo-soberan';
const databaseId = 'echo-db-124325';
if (!production) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
}

const [{initializeApp, applicationDefault, refreshToken}, {getAuth}, {getFirestore}] = await Promise.all([
  import('firebase-admin/app'),
  import('firebase-admin/auth'),
  import('firebase-admin/firestore'),
]);

const refreshTokenValue = process.env.FIREBASE_ADMIN_REFRESH_TOKEN;
const refreshCredential = refreshTokenValue ? refreshToken({
  type: 'authorized_user',
  client_id: process.env.FIREBASE_ADMIN_CLIENT_ID,
  client_secret: process.env.FIREBASE_ADMIN_CLIENT_SECRET,
  refresh_token: refreshTokenValue,
}) : null;
const adminCredential = refreshCredential ?? applicationDefault();
const app = initializeApp(production ? {
  credential: adminCredential,
  projectId,
} : {projectId});
const auth = getAuth(app);
const db = production ? null : getFirestore(app, databaseId);

const productionAccessToken = production
  ? (await adminCredential.getAccessToken()).access_token
  : null;

async function documentExists(path) {
  if (!production) return (await db.doc(path).get()).exists;
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/${encodedPath}`,
    {headers: {
      Authorization: `Bearer ${productionAccessToken}`,
      'x-goog-user-project': projectId,
    }},
  );
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error(`Falha ao ler ${path}: HTTP ${response.status}`);
  }
  return true;
}

async function listUsers() {
  const users = [];
  let pageToken;
  do {
    const page = await auth.listUsers(500, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

const users = await listUsers();
let eligible = 0;
let alreadySet = 0;
let missing = 0;
let authOnly = 0;
let written = 0;

console.log(`alvo: ${production ? 'PRODUCAO' : 'emuladores'} (${projectId}/${databaseId})`);
console.log(`modo: ${apply ? 'GRAVAR' : checkOnly ? 'conferir' : 'dry-run'}`);

for (const user of users) {
  const [profile, slot] = await Promise.all([
    documentExists(`users/${user.uid}`),
    documentExists(`_signup/control/slots/${user.uid}`),
  ]);
  if (!profile || !slot) {
    authOnly++;
    continue;
  }
  eligible++;
  if (user.customClaims?.member === true) {
    alreadySet++;
    continue;
  }
  missing++;
  if (apply) {
    await auth.setCustomUserClaims(user.uid, {...(user.customClaims ?? {}), member: true});
    written++;
  }
}

console.log(`contas no Auth: ${users.length}`);
console.log(`membros elegiveis: ${eligible}`);
console.log(`claim ja presente: ${alreadySet}`);
console.log(`claim faltando: ${missing}`);
console.log(`sem perfil ou vaga (intocadas): ${authOnly}`);
if (apply) console.log(`claims gravadas: ${written}`);
else if (missing) console.log('Nada foi gravado. Use --aplicar somente na implantacao autorizada.');

if (checkOnly && missing > 0) process.exit(1);
