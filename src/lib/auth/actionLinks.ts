// src/lib/auth/actionLinks.ts
// Links de ação do Firebase Authentication: para onde o e-mail aponta e para onde a pessoa volta depois.
//
// Lógica pura, sem navegador e sem Firebase, para o `npm run e2e:auth-links` exercitar tudo — inclusive as
// tentativas de redirecionamento aberto — sem app nem emuladores.
//
// REGRA QUE MANDA AQUI: o parâmetro `continue` que chega na URL é **dado de entrada hostil**. Ele nunca é usado como
// endereço. Ele é comparado contra uma lista fechada de destinos internos e, se não casar exatamente, cai no padrão.
// Qualquer coisa diferente disso é redirecionamento aberto — o atacante manda o link legítimo do Firebase com
// `continue=https://site-falso/` e usa a nossa marca para levar a pessoa embora.

// SEM import de valor, de propósito: assim o `npm run e2e:auth-links` importa este módulo direto no Node e exercita
// as tentativas de redirecionamento aberto sem precisar de app. A origem oficial entra por parâmetro, e o teste
// confere que quem chama passa `siteConfig.officialOrigin`.

/** Caminho interno, sem o prefixo de idioma. A chave é o que viaja na URL; o valor, onde a pessoa cai. */
export const AUTHORIZED_DESTINATIONS = {
  login: '/login',
  register: '/register',
  settings: '/settings',
  'settings-account': '/settings/account',
  'settings-privacy': '/settings/privacy',
  'data-rights': '/settings/data-rights',
  home: '',
} as const;

export type AuthorizedDestination = keyof typeof AUTHORIZED_DESTINATIONS;

/** Para onde vai quem não pediu destino, ou pediu um que não existe. */
export const DEFAULT_DESTINATION: AuthorizedDestination = 'login';

export const SUPPORTED_LOCALES = ['pt-BR', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Só pt-BR e en existem; qualquer outra coisa cai no padrão do projeto. */
export function normalizeLocale(raw: string | null | undefined): SupportedLocale {
  return raw === 'en' ? 'en' : 'pt-BR';
}

/**
 * Idioma lido do caminho da navegação (`/en/...`). Serve para o e-mail sair no idioma da pessoa **sem** obrigar cada
 * tela a passar o parâmetro — e para cair no padrão onde não existe navegador (servidor, teste).
 *
 * Recebe o caminho por parâmetro para poder ser testado; sem argumento, usa o do navegador.
 */
export function localeFromPath(pathname?: string): SupportedLocale {
  const caminho = pathname ?? (typeof window === 'undefined' ? '' : window.location.pathname);
  return caminho === '/en' || caminho.startsWith('/en/') ? 'en' : 'pt-BR';
}

/**
 * Converte o que veio na URL em um destino autorizado. **Nunca** devolve endereço externo.
 *
 * Aceita a chave (`settings-account`) e também o caminho interno já escrito (`/settings/account`), porque é fácil
 * alguém montar o link à mão. Tudo o mais — endereço absoluto, `//outro-site`, `javascript:`, caminho desconhecido,
 * travessia com `..` — vira o padrão, em silêncio.
 */
export function resolveDestination(raw: string | null | undefined): AuthorizedDestination {
  if (!raw) return DEFAULT_DESTINATION;
  const valor = raw.trim();
  if (valor === '' || valor.length > 200) return DEFAULT_DESTINATION;

  if (valor in AUTHORIZED_DESTINATIONS) return valor as AuthorizedDestination;

  // Caminho interno escrito por extenso. Comparação exata contra a lista — não há "começa com".
  const semIdioma = valor.replace(/^\/(pt-BR|en)(?=\/|$)/, '');
  const encontrado = (Object.keys(AUTHORIZED_DESTINATIONS) as AuthorizedDestination[]).find(
    (chave) => AUTHORIZED_DESTINATIONS[chave] === semIdioma,
  );
  return encontrado ?? DEFAULT_DESTINATION;
}

/** O caminho final, com idioma. É o único jeito de montar para onde a pessoa vai. */
export function destinationPath(destination: AuthorizedDestination, locale: SupportedLocale): string {
  return `/${locale}${AUTHORIZED_DESTINATIONS[destination]}`;
}

/**
 * Descobre o destino a partir dos parâmetros que o Firebase entrega ao handler.
 *
 * Quando há `ActionCodeSettings`, o Firebase não promove os parâmetros da URL de retorno para o nível principal: ele
 * entrega a URL inteira em `continueUrl`. Por isso o handler precisa abrir essa URL e, só então, ler a chave
 * `continue`. A URL inteira também é hostil: só aceitamos a origem oficial e o caminho exato do nosso handler.
 */
export function resolveActionDestination(
  direct: string | null | undefined,
  continueUrl: string | null | undefined,
  origin: string,
): AuthorizedDestination {
  if (direct) return resolveDestination(direct);
  if (!continueUrl) return DEFAULT_DESTINATION;

  try {
    const expectedOrigin = new URL(origin).origin;
    const parsed = new URL(continueUrl);
    if (parsed.origin !== expectedOrigin) return DEFAULT_DESTINATION;
    if (!/^\/(pt-BR|en)\/auth\/action\/?$/.test(parsed.pathname)) return DEFAULT_DESTINATION;
    return resolveDestination(parsed.searchParams.get('continue'));
  } catch {
    return DEFAULT_DESTINATION;
  }
}

/**
 * Endereço da página que trata os links do e-mail. `origin` é sempre `siteConfig.officialOrigin` — a origem oficial,
 * e não `baseUrl`, porque `baseUrl` pode ser sobrescrita em desenvolvimento e um link de e-mail apontando para
 * localhost chegaria inútil na caixa de entrada de alguém.
 */
export function actionHandlerUrl(
  locale: SupportedLocale,
  destination: AuthorizedDestination,
  origin: string,
): string {
  const url = new URL(`/${locale}/auth/action`, origin);
  url.searchParams.set('continue', destination);
  return url.href;
}

/**
 * O que vai no `ActionCodeSettings` de `sendEmailVerification`, `sendPasswordResetEmail` e
 * `verifyBeforeUpdateEmail`.
 *
 * `handleCodeInApp: false` de propósito: quem trata o código é a NOSSA página web, que funciona no site, no PWA e no
 * WebView do Android. Com `true`, o Firebase tentaria abrir o app por link dinâmico, caminho que esta rede não usa.
 *
 * ATENÇÃO, e isto é o mais importante deste arquivo: **`ActionCodeSettings` sozinho NÃO muda o remetente nem o
 * domínio do link do e-mail.** Ele só define para onde a pessoa vai DEPOIS da ação. Pôr o link e o remetente no
 * domínio próprio exige configuração manual no console do Firebase (domínio personalizado e URL de ação
 * personalizada nos modelos de e-mail) mais registros DNS — ver docs/autenticacao-email.md.
 */
export function buildActionCodeSettings(
  locale: SupportedLocale,
  destination: AuthorizedDestination,
  origin: string,
) {
  return {
    url: actionHandlerUrl(locale, destination, origin),
    handleCodeInApp: false,
  };
}

/** Os modos que o Firebase manda na URL. `signIn` não é usado nesta rede (não há link mágico de entrada). */
export type ActionMode = 'verifyEmail' | 'resetPassword' | 'recoverEmail' | 'verifyAndChangeEmail';

const MODOS: readonly ActionMode[] = ['verifyEmail', 'resetPassword', 'recoverEmail', 'verifyAndChangeEmail'];

export function parseActionMode(raw: string | null | undefined): ActionMode | null {
  return MODOS.includes(raw as ActionMode) ? (raw as ActionMode) : null;
}

/**
 * Códigos de erro do Firebase, traduzidos para o que a página precisa mostrar. `expired-action-code` e
 * `invalid-action-code` são tratados separadamente porque a saída para a pessoa é diferente: o primeiro pede um link
 * novo, o segundo costuma significar que o link **já foi usado** — inclusive em outro aparelho, que é o caso comum
 * de quem abre o e-mail no celular e volta ao computador.
 */
export type ActionFailure = 'expirado' | 'invalido-ou-usado' | 'usuario-desativado' | 'senha-fraca' | 'desconhecido';

export function classifyActionError(code: string | null | undefined): ActionFailure {
  switch (code) {
    case 'auth/expired-action-code':
      return 'expirado';
    case 'auth/invalid-action-code':
      return 'invalido-ou-usado';
    case 'auth/user-disabled':
      return 'usuario-desativado';
    case 'auth/weak-password':
      return 'senha-fraca';
    default:
      return 'desconhecido';
  }
}
