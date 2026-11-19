import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getFirestore, initializeFirestore, type Firestore, runTransaction } from 'firebase/firestore'; // Import runTransaction
import { getStorage, type FirebaseStorage } from 'firebase/storage'; // If you need storage
import { getAnalytics, Analytics } from "firebase/analytics"; // If you need analytics
import { CONSENT_STORAGE_KEY, analyticsAllowed, parseStoredConsent } from '@/lib/consent/consentState';
import { getFunctions, type Functions } from 'firebase/functions'; // Import Firebase Functions
import { firebaseEnv } from '@/config/firebase';
import { connectEmulators } from '@/lib/firebase-emulators';

const firebaseConfigValues = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// Check if essential Firebase config values are present and not placeholders
if (
  !firebaseConfigValues.apiKey || firebaseConfigValues.apiKey === "your_api_key" ||
  !firebaseConfigValues.projectId || firebaseConfigValues.projectId === "your_project_id"
) {
  console.warn(
`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
Firebase configuration is missing or uses placeholder values.
Please ensure all NEXT_PUBLIC_FIREBASE_... variables are set correctly in your .env file.
You can find these values in your Firebase project settings.
The application will likely NOT connect to Firebase correctly until this is resolved.
Check your .env file and restart the development server if changes were made.
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`
  );
}

// Construct the config object
const firebaseConfig: any = {
  apiKey: firebaseConfigValues.apiKey,
  authDomain: firebaseConfigValues.authDomain,
  projectId: firebaseConfigValues.projectId,
  storageBucket: firebaseConfigValues.storageBucket,
  messagingSenderId: firebaseConfigValues.messagingSenderId,
  appId: firebaseConfigValues.appId,
};

// Only add measurementId to the config if it's defined
if (firebaseConfigValues.measurementId && firebaseConfigValues.measurementId !== "your_measurement_id") {
  firebaseConfig.measurementId = firebaseConfigValues.measurementId;
}


// Initialize Firebase
let app: FirebaseApp;
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApp();
}

// App Check (anti-robô): só no navegador e só com a chave do reCAPTCHA configurada (nunca nos emuladores). A partir daqui
// cada chamada às Functions leva o token, que o servidor exige no cadastro quando requireAppCheck está ligado no
// documento de controle (_signup/control). Tem de vir ANTES de qualquer chamada às Functions. Falhar ao iniciar não
// pode derrubar o app: sem token o servidor só recusa o cadastro (com um aviso), o resto segue.
if (typeof window !== 'undefined' && !firebaseEnv.useEmulators && firebaseEnv.recaptchaSiteKey) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(firebaseEnv.recaptchaSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (error) {
    // Já iniciado (recarga a quente em desenvolvimento) ou bloqueado pelo navegador.
    console.warn('App Check não iniciado:', String(error));
  }
}

const auth: Auth = getAuth(app);
// Banco nomeado e região vêm de src/config/firebase.ts (os padrões são os valores do projeto antigo).
// ignoreUndefinedProperties: campo `undefined` é descartado em vez de derrubar a gravação inteira com "Unsupported field
// value: undefined" (foi o que quebrava todo comentário com imagem). É a rede de segurança: o dado continua sendo
// montado sem `undefined` onde se sabe disso (src/lib/utils/firestoreData.ts). Se o Firestore já foi iniciado (recarga a
// quente em desenvolvimento), usa a instância que existe.
const createFirestore = (): Firestore => {
  try {
    return initializeFirestore(app, { ignoreUndefinedProperties: true }, firebaseEnv.firestoreDatabaseId);
  } catch {
    return getFirestore(app, firebaseEnv.firestoreDatabaseId);
  }
};
const db: Firestore = createFirestore();
const functions: Functions = getFunctions(app, firebaseEnv.functionsRegion); // Initialize Functions
const storage: FirebaseStorage = getStorage(app); // If using Firebase Storage

// Modo emulador (opt-in): conecta TODOS os serviços antes de qualquer uso e falha alto se não conseguir.
if (firebaseEnv.useEmulators) {
  connectEmulators(app, { auth, db, functions, storage });
}

// O Google Analytics NÃO é mais iniciado só por importar este módulo. Antes bastava existir um measurementId para ele
// começar a medir em toda visita, sem aviso e sem escolha; hoje `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` não está
// configurado em produção, mas era questão de alguém definir a variável. Agora depende de consentimento para a
// categoria de medição, lido na hora da chamada, e segue fora do modo emulador (dados de teste não vão para a conta
// real). Chame esta função no cliente, depois da decisão da pessoa.
let analyticsInstance: Analytics | null = null;

export function getAnalyticsIfConsented(): Analytics | null {
  // Soberania de dados: telemetria do Google Analytics desativada para não enviar histórico de navegação ao Google.
  if (typeof window === 'undefined' || firebaseEnv.useEmulators) return null;
  return null;
  if (!firebaseConfig.measurementId) return null;
  const stored = (() => {
    try {
      return parseStoredConsent(localStorage.getItem(CONSENT_STORAGE_KEY));
    } catch {
      return null; // Armazenamento bloqueado: sem decisão que se possa comprovar, não mede.
    }
  })();
  if (!analyticsAllowed(stored)) return null;
  if (!analyticsInstance) analyticsInstance = getAnalytics(app);
  return analyticsInstance;
}

export { app, auth, db, runTransaction, storage, functions }; // Export functions and storage
