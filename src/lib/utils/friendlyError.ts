// src/lib/utils/friendlyError.ts
// Mensagem que a PESSOA entende quando uma gravação ou um envio falha. O erro técnico do SDK (em inglês, com nome de
// função e de documento) nunca vai para a tela: vai para o console, e a tela mostra o que aconteceu e o que fazer.

type ErrorLike = { code?: unknown; name?: unknown; message?: unknown };

const BY_CODE: Record<string, string> = {
  'permission-denied': 'Você não tem permissão para fazer isso. O autor pode ter limitado quem pode responder, ou o acesso foi restringido.',
  'unauthenticated': 'Sua sessão expirou. Entre de novo para continuar.',
  'unavailable': 'Não foi possível falar com o servidor. Verifique sua internet e tente de novo.',
  'deadline-exceeded': 'A conexão demorou demais. Tente de novo.',
  'resource-exhausted': 'Muitas ações em pouco tempo. Aguarde um instante e tente de novo.',
  'not-found': 'Este conteúdo não existe mais.',
  'already-exists': 'Isto já foi enviado.',
  'cancelled': 'O envio foi cancelado.',
  'storage/unauthorized': 'Não foi possível enviar o arquivo: sem permissão ou acima do limite de 5 MB.',
  'storage/quota-exceeded': 'O armazenamento está cheio no momento. Tente mais tarde.',
  'storage/retry-limit-exceeded': 'O envio do arquivo demorou demais. Verifique a internet e tente de novo.',
  'storage/canceled': 'O envio do arquivo foi cancelado.',
  'storage/unauthenticated': 'Sua sessão expirou. Entre de novo para enviar arquivos.',
  'storage/invalid-checksum': 'O arquivo chegou corrompido. Tente enviar de novo.',
};

// Textos técnicos do SDK que não podem aparecer para quem usa o app.
const TECHNICAL = /(called with invalid data|Unsupported field value|FirebaseError|Missing or insufficient permissions|Firebase:|Cannot read prop|is not a function|undefined|\[object )/i;

/**
 * Texto em português para mostrar no aviso de erro. Erros do Firebase viram a mensagem do código (ou `fallback`);
 * erros que o próprio app lança já trazem um texto feito para a pessoa e passam como estão. `fallback` é o que vale
 * quando não há nada melhor.
 */
export function friendlyErrorMessage(error: unknown, fallback: string): string {
  const e: ErrorLike = (typeof error === 'object' && error !== null ? error : {}) as ErrorLike;
  const code = typeof e.code === 'string' ? e.code.replace(/^firestore\//, '') : '';
  if (code && BY_CODE[code]) return BY_CODE[code];
  const message = typeof e.message === 'string' ? e.message.trim() : '';
  const fromFirebase = e.name === 'FirebaseError' || /^(auth|storage|functions|firestore)\//.test(code);
  if (message && !TECHNICAL.test(message) && (!fromFirebase || code.startsWith('functions/'))) return message;
  return fallback;
}
