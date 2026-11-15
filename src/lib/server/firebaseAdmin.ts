// src/lib/server/firebaseAdmin.ts
// Firebase Admin para as rotas de API (servidor). Em produção usa a conta de serviço do App Hosting; com os emuladores
// ligados (NEXT_PUBLIC_USE_EMULATORS), aponta Auth e Firestore para eles. Nunca importar em código do navegador.
import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

function adminApp(): App {
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true') {
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
    process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  }
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true') {
    process.env.FIREBASE_STORAGE_EMULATOR_HOST ||= '127.0.0.1:9199';
  }
  return getApps()[0] ?? initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  });
}

export const adminAuth = () => getAuth(adminApp());

/** Firestore do banco nomeado do app (o mesmo do cliente). */
export const adminFirestore = () =>
  getFirestore(adminApp(), process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || '(default)');

/**
 * Bucket do Storage, pelo Admin SDK. Usado pela rota /m/[id] para ler bytes SEM token de download: é o que permite a
 * URL pública não carregar credencial nenhuma. Nunca importar em código do navegador.
 */
export const adminBucket = () => getStorage(adminApp()).bucket();
