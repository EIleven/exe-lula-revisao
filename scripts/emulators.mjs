#!/usr/bin/env node
/**
 * Inicia o Firebase Emulator Suite em modo SEGURO (uso: `npm run emulators`).
 *
 * - Projeto de demonstração "demo-*": não existe na nuvem, então nada aqui alcança dados reais.
 * - Isola, apenas para este processo, o login do Firebase CLI e as credenciais padrão do Google
 *   (ADC do gcloud), de modo que nenhuma Function ou emulador consiga usar a identidade do usuário.
 * - Confere Java e portas antes de subir e compila as Functions.
 *
 * Pré-requisitos: Node 22 e JDK 21+ no PATH (ver docs/emuladores.md).
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(ROOT, '.emulator-state'); // ignorado pelo git
const FIREBASE_TOOLS = 'firebase-tools@15.34.0';
const PROJECT = 'demo-soberan';
const CONFIG = 'firebase.emulators.json';
// Devem coincidir com firebase.emulators.json e src/config/firebase.ts.
const PORTS = { ui: 4000, hub: 4400, logging: 4500, functions: 5001, firestore: 8080, database: 9000, auth: 9099, storage: 9199 };

const fail = (message) => {
  console.error(`\n[emuladores] ${message}\n`);
  process.exit(1);
};

// 1) Java: o Firestore/Database emulator precisa de JDK moderno.
const java = spawnSync('java', ['-version'], { encoding: 'utf8', shell: true });
const javaOutput = `${java.stdout ?? ''}${java.stderr ?? ''}`;
const javaMatch = javaOutput.match(/version "(\d+)(?:\.(\d+))?/);
if (java.status !== 0 || !javaMatch) {
  fail('Java não encontrado no PATH. Instale um JDK 21+ (ou use o do Android Studio) e defina JAVA_HOME.');
}
const javaMajor = javaMatch[1] === '1' ? Number(javaMatch[2]) : Number(javaMatch[1]);
if (javaMajor < 11) fail(`Java ${javaMajor} é antigo demais. Use JDK 21+ (veja docs/emuladores.md).`);
if (javaMajor < 21) console.warn(`[emuladores] Aviso: Java ${javaMajor} detectado; o firebase-tools atual recomenda JDK 21+.`);

// 2) Portas livres (falha clara em vez de um emulador que sobe pela metade).
const inUse = [];
for (const [name, port] of Object.entries(PORTS)) {
  const free = await new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
  if (!free) inUse.push(`${name}:${port}`);
}
if (inUse.length > 0) fail(`Portas em uso: ${inUse.join(', ')}. Encerre os processos que as ocupam e tente de novo.`);

// 3) Ambiente isolado (somente para os processos filhos).
for (const dir of ['config', 'gcloud', 'emulators', 'appdata', 'home']) mkdirSync(path.join(STATE, dir), { recursive: true });
const env = {
  ...process.env,
  XDG_CONFIG_HOME: path.join(STATE, 'config'), // firebase-tools não enxerga login do usuário
  CLOUDSDK_CONFIG: path.join(STATE, 'gcloud'), // gcloud (se for chamado) não enxerga as contas do usuário
  FIREBASE_EMULATORS_PATH: path.join(STATE, 'emulators'), // cache dos JARs dos emuladores
  METADATA_SERVER_DETECTION: 'none', // sem tentativa de credenciais via servidor de metadados do GCP
};
// A biblioteca de autenticação do Google procura a ADC em %APPDATA%\gcloud (Windows) ou $HOME/.config/gcloud
// (demais SOs) e NÃO respeita CLOUDSDK_CONFIG: por isso esses diretórios também são redirecionados.
if (process.platform === 'win32') {
  env.APPDATA = path.join(STATE, 'appdata');
} else {
  env.npm_config_cache ??= path.join(os.homedir(), '.npm'); // preserva o cache do npm antes de trocar o HOME
  env.HOME = path.join(STATE, 'home');
}
for (const name of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT']) {
  delete env[name];
}

// 3b) PROVA (não suposição) de que a ADC do usuário não é alcançável a partir do ambiente isolado.
const adcProbe = spawnSync(
  process.execPath,
  [
    '-e',
    "const { GoogleAuth } = require('google-auth-library');" +
      "new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' }).getApplicationDefault().then(() => process.exit(10), () => process.exit(0));",
  ],
  { cwd: path.join(ROOT, 'functions'), env, encoding: 'utf8' },
);
if (adcProbe.status === 10) {
  fail('As credenciais padrão do Google (ADC) ainda estão alcançáveis no ambiente isolado. Abortando para não arriscar o projeto real.');
}
if (adcProbe.status !== 0) {
  fail(`Não foi possível verificar o isolamento de credenciais (rode "npm --prefix functions ci"). ${adcProbe.stderr ?? ''}`);
}
console.log('[emuladores] Isolamento de credenciais verificado: nenhuma ADC alcançável.');

// 4) Compila as Functions (o emulador executa functions/lib).
console.log('[emuladores] Compilando as Functions...');
const build = spawnSync('npm', ['--prefix', 'functions', 'run', 'build'], { cwd: ROOT, env, shell: true, stdio: 'inherit' });
if (build.status !== 0) fail('Falha ao compilar as Functions. Rode "npm --prefix functions ci" e tente de novo.');

// 5) Sobe os emuladores (Auth, Firestore, Functions, Database, Storage + UI).
console.log(`[emuladores] Iniciando ${FIREBASE_TOOLS} no projeto de demonstração "${PROJECT}" (credenciais isoladas)...`);
const child = spawn(
  'npx',
  ['--yes', FIREBASE_TOOLS, 'emulators:start', '--config', CONFIG, '--project', PROJECT, '--only', 'auth,firestore,functions,database,storage'],
  { cwd: ROOT, env, shell: true, stdio: 'inherit' },
);
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
