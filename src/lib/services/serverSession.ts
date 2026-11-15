// src/lib/services/serverSession.ts
// Mantém a sessão de servidor (cookie `__session`) alinhada com o estado de autenticação do Firebase.
//
// Para que serve: a mídia privada é servida por rota autenticada (`/mp/<id>`), e `<img>`, `<video>` e link de
// download não mandam cabeçalho `Authorization` — só cookie. Sem esta sincronização, anexo de mensagem não carrega.
//
// Fica no observador de estado de autenticação de propósito: assim cobre login por senha, login com Google,
// recarregamento de página e logout num único ponto, em vez de depender de cada tela lembrar de chamar.
'use client';

import { auth } from '@/lib/firebase';

const ENDPOINT = '/api/auth/session';

/**
 * Último uid sincronizado. Evita repetir a chamada a cada notificação do observador. Começa `undefined` (e não
 * `null`) para que o primeiro carregamento da página sempre renove o cookie — se ele tiver expirado enquanto a
 * sessão do navegador seguia viva, é aqui que se recupera.
 */
let ultimoUid: string | null | undefined;

export async function syncServerSession(): Promise<void> {
  const user = auth.currentUser;
  const uid = user?.uid ?? null;
  if (uid === ultimoUid) return;
  ultimoUid = uid;

  try {
    if (!user) {
      await fetch(ENDPOINT, { method: 'DELETE' });
      return;
    }
    const idToken = await user.getIdToken();
    const resposta = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    if (!resposta.ok) throw new Error(`sessao: HTTP ${resposta.status}`);
  } catch (error) {
    // Falhar aqui degrada a mídia privada, não a rede inteira: deixa tentar de novo na próxima mudança de estado.
    console.error('[sessao] não foi possível sincronizar a sessão de servidor:', error);
    ultimoUid = undefined;
  }
}

/** Encerra a sessão de servidor. Chamar junto do `signOut`, para o cookie não sobreviver ao logout. */
export async function clearServerSession(): Promise<void> {
  ultimoUid = null;
  try {
    await fetch(ENDPOINT, { method: 'DELETE' });
  } catch {
    // Se a chamada falhar, o cookie expira sozinho; e sem sessão do Firebase a rota recusa de todo jeito, porque
    // `verifySessionCookie` confere revogação a cada requisição.
  }
}
