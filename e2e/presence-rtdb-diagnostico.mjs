#!/usr/bin/env node
/**
 * DIAGNÓSTICO da presença no Realtime Database EMULADO (não é teste de aprovação: descreve o comportamento atual).
 *
 * Reproduz a lógica de src/lib/services/presenceService.ts com o SDK web do projeto e mede, contra os emuladores:
 *   E1/E2  ciclo normal: online ao entrar, offline por onDisconnect ao cair a conexão, volta a online ao reconectar;
 *   E3     sair da conta: o que acontece com /status/{uid} (o app só escreve "offline" DEPOIS do signOut);
 *   E4     regras do RTDB: leitura/escrita entre usuários, listagem, anônimo, /guests e lixo em /status;
 *   E6     duas abas do mesmo usuário.
 * Resultados e conclusões: docs/presenca.md. Rode da raiz do repositório, com `npm run emulators` no ar:
 *   node e2e/presence-rtdb-diagnostico.mjs
 * Só toca os emuladores (127.0.0.1); dados descartáveis. Sempre sai com código 0 (é diagnóstico).
 */
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.resolve('package.json'));
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } = require('firebase/auth');
const { getDatabase, connectDatabaseEmulator, ref, set, get, onValue, onDisconnect, serverTimestamp, goOffline, goOnline } = require('firebase/database');

const NS = 'demo-soberan-default-rtdb';
const stamp = Date.now().toString(36);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const say = (id, text) => console.log(`${id.padEnd(4)} ${text}`);

const adminHeaders = { Authorization: 'Bearer owner' }; // administrador aceito SOMENTE pelos emuladores
const adminGet = async (nodePath) => (await fetch(`http://127.0.0.1:9000${nodePath}.json?ns=${NS}`, { headers: adminHeaders })).json();
const adminPut = (nodePath, value) =>
  fetch(`http://127.0.0.1:9000${nodePath}.json?ns=${NS}`, { method: 'PUT', headers: adminHeaders, body: JSON.stringify(value) });

async function signUpRest(email, password) {
  const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const json = await response.json();
  if (!json.localId) throw new Error(`signUp falhou: ${JSON.stringify(json)}`);
  return json.localId;
}

function client(name) {
  const app = initializeApp(
    { apiKey: 'demo-api-key', projectId: 'demo-soberan', authDomain: 'localhost', databaseURL: `http://127.0.0.1:9000/?ns=${NS}` },
    `${name}-${stamp}`,
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getDatabase(app);
  connectDatabaseEmulator(db, '127.0.0.1', 9000);
  return { app, auth, db };
}

const attempt = async (promise) => {
  try {
    await promise;
    return 'PERMITIDO';
  } catch (error) {
    return `NEGADO (${String(error.code || error.message).split('\n')[0]})`;
  }
};

// Cópia fiel de initializePresence() (sem a parte do Firestore, que as regras negam: veja docs/presenca.md).
function initializePresence(db, uid) {
  const statusRef = ref(db, `/status/${uid}`);
  const connectedRef = ref(db, '.info/connected');
  return new Promise((resolve) => {
    onValue(connectedRef, (snapshot) => {
      if (snapshot.val() === true) {
        onDisconnect(statusRef)
          .set({ isOnline: false, lastSeen: serverTimestamp() })
          .then(() => set(statusRef, { isOnline: true, lastSeen: serverTimestamp() }).then(resolve));
      }
    });
  });
}

const A = { email: `pa.${stamp}@example.test`, password: 'Teste!123456' };
const B = { email: `pb.${stamp}@example.test`, password: 'Teste!123456' };
A.uid = await signUpRest(A.email, A.password);
B.uid = await signUpRest(B.email, B.password);

// ---- E1/E2: ciclo normal ----
const a = client('a');
await signInWithEmailAndPassword(a.auth, A.email, A.password);
await initializePresence(a.db, A.uid);
await sleep(500);
let status = await adminGet(`/status/${A.uid}`);
say('E1', `depois de entrar e inicializar: /status/A = ${JSON.stringify(status)}`);
goOffline(a.db); // queda de conexão (equivale a fechar a aba ou perder a rede)
await sleep(1500);
status = await adminGet(`/status/${A.uid}`);
say('E2', `após a queda de conexão: ${JSON.stringify(status)} -> onDisconnect ${status?.isOnline === false ? 'FUNCIONOU' : 'NÃO funcionou'}`);
goOnline(a.db);
await sleep(1500);
status = await adminGet(`/status/${A.uid}`);
say('E2b', `após reconectar: ${JSON.stringify(status)} -> volta a online sozinho: ${status?.isOnline === true}`);

// ---- E3: sair da conta como o CurrentUserContext faz (goOffline só depois de o Auth já ter mudado) ----
await signOut(a.auth);
await sleep(1000);
status = await adminGet(`/status/${A.uid}`);
say('E3a', `logo após signOut: ${JSON.stringify(status)}`);
say('E3b', `escrita "offline" feita pelo app DEPOIS do signOut: ${await attempt(set(ref(a.db, `/status/${A.uid}`), { isOnline: false, lastSeen: serverTimestamp() }))}`);
goOffline(a.db);
await sleep(1500);
status = await adminGet(`/status/${A.uid}`);
say('E3c', `após signOut + queda da conexão: ${JSON.stringify(status)} -> o onDisconnect registrado antes do signOut ${status?.isOnline === false ? 'ainda executa' : 'FOI CANCELADO (o usuário fica "online" para sempre)'}`);

// ---- E4: regras do RTDB ----
const b = client('b');
await signInWithEmailAndPassword(b.auth, B.email, B.password);
await adminPut(`/status/${A.uid}`, { isOnline: true, lastSeen: 1 });
say('E4a', `B lê /status/A: ${await attempt(get(ref(b.db, `/status/${A.uid}`)))}`);
say('E4b', `B escreve /status/A: ${await attempt(set(ref(b.db, `/status/${A.uid}`), { isOnline: false }))}`);
say('E4c', `B lista /status (todos): ${await attempt(get(ref(b.db, '/status')))}`);
say('E4d', `B escreve no PRÓPRIO /status/B um objeto de 300 KB com tipos errados (sem .validate): ${await attempt(set(ref(b.db, `/status/${B.uid}`), { isOnline: 'talvez', lixo: 'x'.repeat(300_000) }))}`);
await adminPut(`/status/${B.uid}`, null);
const anon = client('anon');
say('E4e', `SEM LOGIN lê /status/A: ${await attempt(get(ref(anon.db, `/status/${A.uid}`)))}`);
say('E4f', `SEM LOGIN escreve dado arbitrário em /guests/qualquer: ${await attempt(set(ref(anon.db, `/guests/teste_${stamp}`), { qualquer: 'coisa', n: 1 }))}`);
say('E4g', `SEM LOGIN lê TODO o /guests: ${await attempt(get(ref(anon.db, '/guests')))}`);
await adminPut(`/guests/teste_${stamp}`, null);
await adminPut(`/status/${A.uid}`, null);

// ---- E6: duas abas do mesmo usuário (um único booleano por usuário) ----
const tab1 = client('tab1');
const tab2 = client('tab2');
await signInWithEmailAndPassword(tab1.auth, B.email, B.password);
await signInWithEmailAndPassword(tab2.auth, B.email, B.password);
await initializePresence(tab1.db, B.uid);
await initializePresence(tab2.db, B.uid);
await sleep(500);
goOffline(tab1.db); // fecha só a aba 1; a aba 2 continua aberta
await sleep(1500);
status = await adminGet(`/status/${B.uid}`);
say('E6', `duas abas do mesmo usuário; fecha a aba 1: ${JSON.stringify(status)} -> ${status?.isOnline === false ? 'OFFLINE embora a aba 2 siga aberta (limitação do desenho atual)' : 'online'}`);
await adminPut(`/status/${B.uid}`, null);

for (const c of [a, b, anon, tab1, tab2]) await deleteApp(c.app).catch(() => {});
process.exit(0);
