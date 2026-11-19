#!/usr/bin/env node
/**
 * As REGRAS do banco para a confirmação de leitura, exercitadas de verdade contra o emulador do Firestore:
 *   npm run e2e:regras-recibo
 *
 * Por que não basta ler a regra: `lastReadAt` fica no mesmo documento que o contador de não lidas, e esse documento é
 * escrito por todo mundo o tempo todo (abrir conversa, sair de grupo, "marcar todas como lidas"). Uma condição a mais
 * escrita de forma ingênua passa a EXIGIR o campo novo em toda atualização — e aí zerar o contador para de funcionar
 * sem erro visível na tela. É um jeito silencioso de quebrar as mensagens inteiras. Então cada caminho é executado.
 *
 * O que se prova: quem lê só mexe na PRÓPRIA marca, só com a hora do SERVIDOR, nunca na de outra pessoa, e nada disso
 * atrapalha as escritas que já existiam.
 *
 * Roda-se sozinho: sem o emulador em pé, ele mesmo sobe um (projeto `demo-*`, credenciais isoladas) e se re-executa.
 * Sai com código 1 se algo falhar.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJETO = 'demo-soberan';
const JDK = 'E:\\Arquivos de Programas\\Android\\Android Studio\\jbr';

// ───────────────────────── Modo 1: ainda não há emulador — subir um e voltar para cá ─────────────────────────
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  const isolado = path.join(RAIZ, '.emulator-state', 'regras');
  mkdirSync(isolado, { recursive: true });
  // As MESMAS proteções de scripts/emulators.mjs: o emulador não pode enxergar nenhum login real.
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

  console.log('Subindo o emulador (Firestore + Auth) em projeto de demonstração...\n');
  // `shell: true` não é capricho: no Windows o Node recusa executar `npx.cmd` direto, e a falha vem calada (código 1
  // sem uma linha de saída). O comando é montado aqui, sem nada vindo de fora.
  const alvo = path.relative(RAIZ, fileURLToPath(import.meta.url)).split(path.sep).join('/');
  const comando = [
    'npx', '-y', 'firebase-tools@15.34.0', 'emulators:exec',
    '--only', 'firestore,auth',
    '--config', 'firebase.emulators.json',
    '--project', PROJETO,
    `"node ${alvo}"`,
  ].join(' ');
  const r = spawnSync(comando, { cwd: RAIZ, env, stdio: 'inherit', shell: true });
  process.exit(r.status ?? 1);
}

// ───────────────────────── Modo 2: dentro do emulador — executar as regras ─────────────────────────
const { initializeApp, deleteApp } = await import('firebase/app');
const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } = await import('firebase/auth');
const { getFirestore, connectFirestoreEmulator, doc, updateDoc, serverTimestamp, Timestamp } = await import('firebase/firestore');

const HOST_FS = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const HOST_AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const CONV = 'conv_recibo_teste';

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

/** Escreve ignorando as regras: o token `owner` é o atalho do emulador para semear o cenário. */
const semear = async (dados) => {
  const url = `http://${HOST_FS}/v1/projects/${PROJETO}/databases/(default)/documents/conversations/${CONV}`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: dados }),
  });
  if (!r.ok) throw new Error(`não consegui semear a conversa: ${r.status} ${await r.text()}`);
};

const mapaDeNumeros = (obj) => ({
  mapValue: { fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { integerValue: String(v) }])) },
});

const app = initializeApp({ apiKey: 'chave-de-emulador', projectId: PROJETO }, `regras-${Date.now()}`);
const auth = getAuth(app);
connectAuthEmulator(auth, `http://${HOST_AUTH}`, { disableWarnings: true });
const db = getFirestore(app);
connectFirestoreEmulator(db, HOST_FS.split(':')[0], Number(HOST_FS.split(':')[1]));

/** Entra como uma conta do emulador (criando-a na primeira vez) e devolve o uid. */
const entrar = async (email) => {
  await signOut(auth).catch(() => {});
  const senha = 'senha-de-emulador';
  try {
    const c = await createUserWithEmailAndPassword(auth, email, senha);
    return c.user.uid;
  } catch {
    const c = await signInWithEmailAndPassword(auth, email, senha);
    return c.user.uid;
  }
};

/** Tenta uma escrita e diz só se passou — é isso que a regra decide. */
const tenta = async (mudanca) => {
  try {
    await updateDoc(doc(db, 'conversations', CONV), mudanca);
    return true;
  } catch {
    return false;
  }
};

const A = await entrar('ana@exemplo.test');
const B = await entrar('bento@exemplo.test');
const C = await entrar('estranho@exemplo.test');

const estadoInicial = async () =>
  semear({
    participantIds: { arrayValue: { values: [{ stringValue: A }, { stringValue: B }] } },
    // B precisa começar com contador DIFERENTE de zero: escrever o mesmo valor que já está lá não muda nada, a regra
    // permite (com razão) e o teste não provaria coisa alguma.
    unreadCounts: mapaDeNumeros({ [A]: 2, [B]: 3 }),
    isGroup: { booleanValue: false },
  });

await estadoInicial();
await entrar('ana@exemplo.test');

// ───────────────────────── O que já existia não pode quebrar ─────────────────────────
confere(
  'ANTES · zerar o próprio contador continua permitido (abrir conversa e "marcar todas como lidas")',
  (await tenta({ [`unreadCounts.${A}`]: 0 })) === true,
  'a regra nova quebrou o caminho que já existia — as mensagens parariam de sair de "não lidas"',
);
confere(
  'ANTES · mexer no contador de OUTRA pessoa continua proibido',
  (await tenta({ [`unreadCounts.${B}`]: 0 })) === false,
  'dá para zerar o contador alheio',
);

// ───────────────────────── A confirmação de leitura ─────────────────────────
confere(
  'RECIBO · confirmar a própria leitura com a hora do servidor é permitido',
  (await tenta({ [`unreadCounts.${A}`]: 0, [`lastReadAt.${A}`]: serverTimestamp() })) === true,
  'a escrita legítima foi recusada',
);
confere(
  'RECIBO · confirmar sozinho (conversa já aberta, chegou mensagem nova) é permitido',
  (await tenta({ [`lastReadAt.${A}`]: serverTimestamp() })) === true,
  'recusou a confirmação sem mexer no contador',
);

// A REGRESSÃO QUE IMPORTA: agora o documento JÁ TEM lastReadAt.
confere(
  'RECIBO · com a marca já gravada, zerar só o contador continua permitido',
  (await tenta({ [`unreadCounts.${A}`]: 0 })) === true,
  'a condição do campo novo passou a ser exigida em TODA atualização — zerar não lidas quebraria em silêncio',
);

// ───────────────────────── O que ninguém pode fazer ─────────────────────────
confere(
  'RECIBO · hora inventada pelo cliente é recusada (não dá para antedatar nem forjar)',
  (await tenta({ [`lastReadAt.${A}`]: Timestamp.fromDate(new Date('2020-06-01T00:00:00Z')) })) === false,
  'aceitou carimbo que não veio do servidor',
);
confere(
  'RECIBO · ninguém escreve a marca de OUTRA pessoa ("ela leu" forjado)',
  (await tenta({ [`lastReadAt.${B}`]: serverTimestamp() })) === false,
  'dá para dizer que a outra pessoa leu',
);
confere(
  'RECIBO · nem junto com uma escrita legítima da própria marca',
  (await tenta({ [`lastReadAt.${A}`]: serverTimestamp(), [`lastReadAt.${B}`]: serverTimestamp() })) === false,
  'passou de carona numa escrita válida',
);
confere(
  'RECIBO · campo fora da lista continua barrado (não virou porta de entrada)',
  (await tenta({ [`lastReadAt.${A}`]: serverTimestamp(), groupName: 'invadido' })) === false,
  'a lista de campos permitidos afrouxou',
);

await entrar('estranho@exemplo.test');
confere(
  'RECIBO · quem não participa da conversa não escreve nada',
  (await tenta({ [`lastReadAt.${C}`]: serverTimestamp() })) === false,
  'estranho escreveu no documento da conversa',
);

await signOut(auth).catch(() => {});
await deleteApp(app).catch(() => {});

console.log('');
console.log(`${total} verificações.`);
if (falhas) {
  console.log(`${falhas} falha(s).`);
  process.exit(1);
}
console.log('Regras OK: a marca é só da própria pessoa, só com a hora do servidor, e o que já existia continua passando.');
