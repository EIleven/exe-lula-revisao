/**
 * Conexão OPT-IN aos emuladores do Firebase, somente para desenvolvimento local.
 *
 * Garantias de segurança:
 *  1. Só é usado com NEXT_PUBLIC_USE_EMULATORS=true (ver src/config/firebase.ts).
 *  2. Exige projectId "demo-*": um projeto assim não existe na nuvem, então mesmo um erro de
 *     configuração nunca alcança dados reais.
 *  3. Nenhuma falha é engolida: se uma conexão não puder ser configurada, o módulo lança erro.
 *     O app nunca sobe "meio conectado" nem cai em silêncio para a produção.
 *  4. Se os emuladores não estiverem rodando, a falha é anunciada (console e aviso na tela).
 *
 * As funções connect*Emulator do SDK são idempotentes quando chamadas com a mesma configuração
 * (necessário no SSR/HMR do Next), então não há motivo para capturar exceções aqui.
 */
import type { FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { connectFunctionsEmulator, type Functions } from 'firebase/functions';
import { connectStorageEmulator, type FirebaseStorage } from 'firebase/storage';
import { connectDatabaseEmulator, getDatabase } from 'firebase/database';
import { firebaseEnv } from '@/config/firebase';

const HOST = firebaseEnv.emulatorHost;
const PORTS = firebaseEnv.emulatorPorts;

/** Emuladores que o app exige (um por serviço Firebase usado pelo cliente). */
export const REQUIRED_EMULATORS = ['auth', 'firestore', 'functions', 'database', 'storage'] as const;

type Services = {
  auth: Auth;
  db: Firestore;
  functions: Functions;
  storage: FirebaseStorage;
};

export function connectEmulators(app: FirebaseApp, { auth, db, functions, storage }: Services): void {
  const projectId = app.options.projectId ?? '(vazio)';
  if (!projectId.startsWith('demo-')) {
    throw new Error(
      '[emuladores] NEXT_PUBLIC_USE_EMULATORS=true exige NEXT_PUBLIC_FIREBASE_PROJECT_ID começando com "demo-" ' +
        `(recebido: "${projectId}"). Abortando para nunca tocar em um projeto real.`,
    );
  }

  connectAuthEmulator(auth, `http://${HOST}:${PORTS.auth}`, { disableWarnings: true });
  connectFirestoreEmulator(db, HOST, PORTS.firestore);
  connectFunctionsEmulator(functions, HOST, PORTS.functions);
  connectStorageEmulator(storage, HOST, PORTS.storage);
  connectDatabaseEmulator(getDatabase(app), HOST, PORTS.database);

  // Confere o resultado em vez de confiar apenas em "não lançou erro".
  const firestoreHost = (db.toJSON() as { settings?: { host?: string } }).settings?.host;
  if (!auth.emulatorConfig || firestoreHost !== `${HOST}:${PORTS.firestore}`) {
    throw new Error(
      '[emuladores] Auth/Firestore não ficaram apontando para os emuladores. ' +
        'Abortando para não tocar em serviços reais.',
    );
  }
}

export type EmulatorStatus = { ok: true } | { ok: false; message: string };

/** Pergunta ao hub dos emuladores quais serviços estão de pé. Usado pelo aviso na tela. */
export async function checkEmulatorsRunning(): Promise<EmulatorStatus> {
  const url = `http://${HOST}:${PORTS.hub}/emulators`;
  const timeout = async <T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      return await run(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const response = await timeout((signal) => fetch(url, { cache: 'no-store', signal }));
    const running = Object.keys((await response.json()) as Record<string, unknown>);
    const missing = REQUIRED_EMULATORS.filter((name) => !running.includes(name));
    if (missing.length > 0) {
      return { ok: false, message: `Emuladores não iniciados: ${missing.join(', ')}.` };
    }
    return { ok: true };
  } catch {
    // Pode ser CORS (hub no ar, resposta ilegível) ou hub fora do ar: o modo no-cors distingue.
    try {
      await timeout((signal) => fetch(url, { mode: 'no-cors', cache: 'no-store', signal }));
      return { ok: true };
    } catch {
      return { ok: false, message: `Hub dos emuladores inacessível em ${url}.` };
    }
  }
}
