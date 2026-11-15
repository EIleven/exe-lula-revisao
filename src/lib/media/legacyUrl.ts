// src/lib/media/legacyUrl.ts
// Leitura das URLs ANTIGAS do Storage, as que carregam `?alt=media&token=...`. Módulo puro, sem imports, para a
// migração e o teste usarem a mesma função.
//
// Serve a dois propósitos: achar o caminho do objeto a partir de uma URL já gravada no Firestore, e reconhecer o que
// ainda é URL antiga — que é como a conferência final prova que a migração terminou.

const HOST_ANTIGO = 'firebasestorage.googleapis.com';

/**
 * Caminho do objeto embutido numa URL antiga, ou `null` se não for uma delas.
 *
 * A URL tem a forma `.../o/<caminho percent-encoded>?alt=media&token=<uuid>`. O caminho vem codificado porque contém
 * barras, então precisa ser decodificado para casar com o nome do objeto no bucket.
 *
 * O host é comparado pelo **hostname exato**, nunca por `includes`: `firebasestorage.googleapis.com.site-falso.test`
 * contém a nossa string e passaria por nossa URL. Tratar URL de terceiro como nossa faria a migração agir sobre
 * objeto que não é dela — e, no relatório, contar como pendência algo que não existe no nosso bucket.
 */
export function caminhoDaUrlAntiga(url: unknown): string | null {
  if (typeof url !== 'string' || url === '') return null;

  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null; // Não é URL absoluta: as novas são `/mp/<id>` relativas, e caem aqui.
  }
  if (hostname !== HOST_ANTIGO) return null;

  const match = /\/o\/([^?#]+)/.exec(url);
  if (!match) return null;
  try {
    const caminho = decodeURIComponent(match[1]);
    // Só aceita o que de fato parece objeto nosso: evita tratar lixo como caminho válido.
    return caminho.startsWith('user_uploads/') ? caminho : null;
  } catch {
    return null;
  }
}

/** A URL ainda aponta para o Storage (e portanto depende de token)? */
export function isLegacyStorageUrl(url: unknown): boolean {
  return caminhoDaUrlAntiga(url) !== null;
}

/** O token embutido, quando existe. Usado só para relatório — nunca para conceder acesso. */
export function tokenDaUrlAntiga(url: unknown): string | null {
  if (caminhoDaUrlAntiga(url) === null) return null;
  const match = /[?&]token=([^&#]+)/.exec(url as string);
  return match ? match[1] : null;
}
