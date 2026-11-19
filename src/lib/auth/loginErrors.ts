// src/lib/auth/loginErrors.ts
// Por que um login externo (Fediverso, Atmosfera) falhou, em CÓDIGOS estáveis. Módulo puro (sem Next nem Firebase): serve ao
// servidor, que escolhe o código, e à tela de login, que o transforma em mensagem.
//
// Por que existe: o retorno do OAuth passou a repassar `&reason=<mensagem do erro>` na URL. Isso (1) entregava a qualquer
// pessoa texto interno do servidor ("Permission 'iam.serviceAccounts.signBlob' denied on resource ...", com nome da conta de
// serviço e do projeto) e (2) deixava a tela mostrar QUALQUER texto vindo da URL: um link forjado
// `/login?auth_error=x&reason=Sua conta foi suspensa, ligue para...` aparecia como aviso do site. Agora a URL leva só um
// código conhecido, a mensagem mora aqui, e o texto original do erro fica apenas no log do servidor.

export const LOGIN_REASONS = [
  'credential_unavailable',
  'provider_unreachable',
  'access_denied',
  'state_invalid',
  'account_conflict',
  'unknown',
] as const;

export type LoginReason = (typeof LOGIN_REASONS)[number];

const MENSAGENS: Record<LoginReason, string> = {
  credential_unavailable: 'O servidor não conseguiu emitir a sua sessão agora. Tente de novo em alguns minutos; se continuar, avise o suporte.',
  provider_unreachable: 'Não foi possível falar com o servidor da sua conta. Confira o endereço e tente de novo.',
  access_denied: 'A autorização foi cancelada ou negada no servidor externo.',
  state_invalid: 'Esta tentativa de login expirou ou já foi usada. Comece de novo.',
  account_conflict: 'Já existe uma conta com um dado desta identidade. Entre pelo método que você usou antes.',
  unknown: 'Não foi possível concluir o login com a rede externa. Tente novamente.',
};

export const isLoginReason = (valor: unknown): valor is LoginReason =>
  typeof valor === 'string' && (LOGIN_REASONS as readonly string[]).includes(valor);

/** O texto do erro, de qualquer coisa que tenha sido lançada. Nunca lança. */
function textoDe(erro: unknown): string {
  try {
    if (erro instanceof Error) return `${erro.name} ${erro.message}`;
    if (typeof erro === 'string') return erro;
    if (erro && typeof erro === 'object' && 'message' in erro) return String((erro as { message: unknown }).message);
    return String(erro ?? '');
  } catch {
    return '';
  }
}

/**
 * Classifica o erro de um login externo. A ORDEM importa: a falta de permissão para emitir a sessão (IAM) e o provedor de
 * login desativado são do SERVIDOR e vêm primeiro; o resto é de quem está entrando ou do servidor externo.
 */
export function loginReasonOf(erro: unknown): LoginReason {
  const t = textoDe(erro).toLowerCase();
  if (/credential_unavailable|signblob|tokencreator|iam\.serviceaccounts|createcustomtoken|sign-in provider is disabled|operation[-_]not[-_]allowed/.test(t)) {
    return 'credential_unavailable';
  }
  if (/invalid or expired application state|missing application state|invalid[_ ]state/.test(t)) return 'state_invalid';
  if (/access[_ ]denied|user denied|consent[_ ]required/.test(t)) return 'access_denied';
  if (/email-already-exists|email_exists|already in use|already exists/.test(t)) return 'account_conflict';
  if (/fetch failed|econnre|enotfound|etimedout|timed? ?out|timeout|socket|network|getaddrinfo|abort/.test(t)) return 'provider_unreachable';
  return 'unknown';
}

/** A mensagem de um código CONHECIDO; qualquer outra coisa (inclusive texto forjado na URL) devolve `null`. */
export function loginReasonMessage(bruto: unknown): string | null {
  return isLoginReason(bruto) ? MENSAGENS[bruto] : null;
}

/**
 * Os `auth_error` que as rotas já devolviam SEM motivo (`fediverse_invalid_state`, `fediverse_token_failed`...) também viram um
 * código, para a tela explicar o que dá para explicar em vez de só 'tente novamente'.
 */
export function loginReasonOfAuthError(authError: unknown): LoginReason | null {
  switch (authError) {
    case 'fediverse_invalid_state':
    case 'fediverse_missing_params':
      return 'state_invalid';
    case 'fediverse_app_missing':
    case 'fediverse_token_failed':
    case 'fediverse_profile_failed':
      return 'provider_unreachable';
    default:
      return null;
  }
}

/** O endereço da tela de login com o erro. Só o código vai para a URL, nunca o texto do erro. */
export function loginErrorUrl(origin: string, locale: string, authError: string, erro: unknown): string {
  const lingua = locale === 'en' ? 'en' : 'pt-BR';
  return `${origin.replace(/\/+$/, '')}/${lingua}/login?auth_error=${encodeURIComponent(authError)}&reason=${loginReasonOf(erro)}`;
}
