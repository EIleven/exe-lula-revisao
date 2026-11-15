// src/config/firebase.ts
// Configuração de ambiente do Firebase que NÃO é segredo e varia entre projetos/ambientes.
// Os padrões reproduzem o comportamento anterior: sem as variáveis, nada muda.

export const firebaseEnv = {
  /** ID do banco Firestore usado pelo app (banco nomeado herdado do projeto antigo). */
  firestoreDatabaseId: process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || 'echo-db-124325',
  /** Região das Cloud Functions chamadas pelo cliente (callables). */
  functionsRegion: process.env.NEXT_PUBLIC_FUNCTIONS_REGION || 'southamerica-east1',
  /**
   * Emuladores do Firebase: opt-in EXPLÍCITO, somente desenvolvimento local.
   * Exige projectId "demo-*" (ver src/lib/firebase-emulators.ts).
   */
  useEmulators: process.env.NEXT_PUBLIC_USE_EMULATORS === 'true',
  /**
   * Chave PÚBLICA do reCAPTCHA Enterprise que o App Check usa como anti-robô no cadastro. Sem ela o App Check não é
   * iniciado (desenvolvimento e emuladores) e o app se comporta como antes.
   */
  recaptchaSiteKey: process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || '',
  /** Fixo em loopback de propósito: o modo emulador nunca aponta para uma máquina remota. */
  emulatorHost: '127.0.0.1',
  /** Portas definidas em firebase.emulators.json. */
  emulatorPorts: {
    auth: 9099,
    firestore: 8080,
    functions: 5001,
    database: 9000,
    storage: 9199,
    hub: 4400,
  },
} as const;
