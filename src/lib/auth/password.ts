// src/lib/auth/password.ts
// Política de senha, em lógica pura, para o cadastro, a troca de senha e a redefinição usarem A MESMA regra.
//
// Sobre "validação no cliente e no servidor": a regra abaixo roda no navegador, e o Firebase Authentication aplica a
// dele no servidor. O mínimo do Firebase é 6 caracteres por padrão, e uma política mais forte (tamanho, classes de
// caractere) se configura no console, em Authentication › Settings › Password policy — ver docs/autenticacao-email.md.
// Se a política do console ficar mais frouxa que esta, o servidor aceita o que o cliente recusou; o contrário é que
// seria problema. Por isso esta regra é o piso, não a garantia.

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 4096; // limite do Firebase; evita corpo gigante

/** As senhas mais usadas do Brasil e as óbvias em qualquer idioma. Lista curta de propósito: não é antivírus. */
const SENHAS_OBVIAS = new Set([
  '12345678', '123456789', '1234567890', 'senha123', 'password', 'password1', 'qwerty123',
  'brasil123', 'lula1234', '11111111', '00000000', 'abcd1234', 'admin123', 'mudar123',
]);

export type PasswordProblem =
  | 'curta'
  | 'longa'
  | 'so-numeros'
  | 'obvia'
  | 'parece-email'
  | 'repetida';

export interface PasswordCheck {
  ok: boolean;
  problems: PasswordProblem[];
}

/**
 * Confere a senha. `email` é opcional e serve para recusar senha derivada do próprio endereço, que é o padrão mais
 * comum de senha fraca e o primeiro que um atacante tenta.
 */
export function checkPassword(password: string, email?: string): PasswordCheck {
  const problems: PasswordProblem[] = [];
  const valor = password ?? '';

  if (valor.length < PASSWORD_MIN_LENGTH) problems.push('curta');
  if (valor.length > PASSWORD_MAX_LENGTH) problems.push('longa');
  if (valor.length > 0 && /^\d+$/.test(valor)) problems.push('so-numeros');
  if (SENHAS_OBVIAS.has(valor.toLowerCase())) problems.push('obvia');

  // Um único caractere repetido, independente de quantos.
  if (valor.length >= PASSWORD_MIN_LENGTH && new Set(valor).size === 1) problems.push('repetida');

  const local = (email ?? '').split('@')[0]?.trim().toLowerCase();
  if (local && local.length >= 4 && valor.toLowerCase().includes(local)) problems.push('parece-email');

  return { ok: problems.length === 0, problems };
}

/** Normaliza o e-mail para comparação e gravação: sem espaços nas pontas e em minúsculas. */
export function normalizeEmail(email: string): string {
  return (email ?? '').trim().toLowerCase();
}

/**
 * Validação de formato de e-mail. Deliberadamente simples: validar e-mail por expressão regular é problema
 * conhecido por não ter solução correta, e quem decide se o endereço existe é a confirmação por link. Aqui só se
 * barra o que é claramente inválido, para dar erro imediato em vez de mandar um e-mail que nunca chega.
 */
export function looksLikeEmail(email: string): boolean {
  const valor = normalizeEmail(email);
  if (valor.length < 6 || valor.length > 254) return false;
  if (/\s/.test(valor)) return false;
  const partes = valor.split('@');
  if (partes.length !== 2) return false;
  const [local, dominio] = partes;
  if (!local || !dominio) return false;
  if (!dominio.includes('.')) return false;
  if (dominio.startsWith('.') || dominio.endsWith('.') || dominio.includes('..')) return false;
  return true;
}
