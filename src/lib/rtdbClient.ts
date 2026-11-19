'use client';

// src/lib/rtdbClient.ts
// O Realtime Database do app no NAVEGADOR, sem nunca lançar. Um erro de configuração aqui NÃO pode derrubar a página (ver
// rtdbUrl.ts): quem chama trata `null` como "sem tempo real" e segue com o que tem (Firestore, consulta periódica).
import { getDatabase, type Database } from 'firebase/database';
import { app } from '@/lib/firebase';
import { resolveRtdbUrl } from '@/lib/rtdbUrl';

export function getRtdb(): Database | null {
  try {
    // Emuladores: a mesma instância que firebase-emulators.ts configurou (ela é criada SEM endereço explícito).
    if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true') return getDatabase(app);
    const url = resolveRtdbUrl({
      envUrl: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
      optionsUrl: app.options.databaseURL,
      envProjectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      optionsProjectId: app.options.projectId,
    });
    return url ? getDatabase(app, url) : null;
  } catch (err) {
    console.warn('[rtdb] indisponível:', err instanceof Error ? err.message : String(err));
    return null;
  }
}
