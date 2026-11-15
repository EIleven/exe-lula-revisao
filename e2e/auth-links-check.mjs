#!/usr/bin/env node
/**
 * Testa os links de ação do Firebase Authentication e a política de senha, sem app nem emuladores.
 *   node e2e/auth-links-check.mjs
 *
 * O coração deste teste é o **redirecionamento aberto**. A página /auth/action recebe `continue` na URL, e esse
 * parâmetro é dado hostil: quem mandar o link LEGÍTIMO do Firebase com `continue=https://site-falso/` usaria a nossa
 * marca e o nosso domínio para levar a pessoa embora, num momento em que ela confia no link porque ele veio de um
 * e-mail que ela mesma pediu. Por isso `resolveDestination` compara contra uma lista fechada e, em qualquer dúvida,
 * cai no login — e por isso a lista de tentativas abaixo é longa.
 *
 * Sai com código 1 se algo falhar.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const {
  AUTHORIZED_DESTINATIONS,
  DEFAULT_DESTINATION,
  actionHandlerUrl,
  buildActionCodeSettings,
  classifyActionError,
  destinationPath,
  localeFromPath,
  normalizeLocale,
  parseActionMode,
  resolveDestination,
  resolveActionDestination,
} = await import('../src/lib/auth/actionLinks.ts');

const { PASSWORD_MIN_LENGTH, checkPassword, looksLikeEmail, normalizeEmail } = await import(
  '../src/lib/auth/password.ts'
);

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const ORIGEM = 'https://exercitodolula.app';
let falhas = 0;

function confere(nome, condicao, motivo, detalhe) {
  if (condicao) console.log(`OK    ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo}`); }
}

// ───────── 1. Redirecionamento aberto: tudo que NÃO pode passar ─────────

const ATAQUES = [
  ['endereço externo', 'https://site-falso.example'],
  ['externo sem esquema', '//site-falso.example'],
  ['externo com barra invertida', '/\\site-falso.example'],
  ['javascript:', 'javascript:alert(1)'],
  ['data:', 'data:text/html,<script>alert(1)</script>'],
  ['domínio parecido', 'https://exercitodolula.app.site-falso.example'],
  ['subdomínio do atacante', 'https://evil.exercitodolula.app.co'],
  ['credencial embutida', 'https://exercitodolula.app@site-falso.example'],
  ['travessia de caminho', '/settings/../../etc/passwd'],
  ['caminho desconhecido', '/admin'],
  ['caminho parecido com um válido', '/settings/accountX'],
  ['prefixo de um válido', '/settings/account/../../x'],
  ['idioma inventado', '/fr/settings/account'],
  ['vazio', ''],
  ['só espaços', '   '],
  ['nulo', null],
  ['indefinido', undefined],
  ['muito longo', `/settings/${'a'.repeat(400)}`],
  ['com nova linha', '/settings/account\nhttps://site-falso.example'],
  ['codificado', '%2F%2Fsite-falso.example'],
];

for (const [nome, entrada] of ATAQUES) {
  const resultado = resolveDestination(entrada);
  confere(
    `recusa: ${nome}`,
    resultado === DEFAULT_DESTINATION,
    `virou "${resultado}" em vez do padrão "${DEFAULT_DESTINATION}"`,
  );
}

for (const [nome, entrada] of ATAQUES.filter(([, value]) => value)) {
  const resultado = resolveActionDestination(null, String(entrada), ORIGEM);
  confere(
    `recusa continueUrl: ${nome}`,
    resultado === DEFAULT_DESTINATION,
    `continueUrl hostil virou "${resultado}"`,
  );
}

// E o que PODE passar.
const VALIDOS = [
  ['chave', 'login', 'login'],
  ['chave com hífen', 'settings-account', 'settings-account'],
  ['chave de direitos', 'data-rights', 'data-rights'],
  ['chave home', 'home', 'home'],
  ['caminho interno', '/settings/account', 'settings-account'],
  ['caminho interno com idioma', '/pt-BR/settings/account', 'settings-account'],
  ['caminho interno em inglês', '/en/settings', 'settings'],
  ['raiz com idioma', '/pt-BR', 'home'],
  ['com espaços nas pontas', '  login  ', 'login'],
];
for (const [nome, entrada, esperado] of VALIDOS) {
  const resultado = resolveDestination(entrada);
  confere(`aceita: ${nome}`, resultado === esperado, `virou "${resultado}", esperado "${esperado}"`, resultado);
}

// ───────── 2. O caminho final nunca sai do site ─────────

for (const chave of Object.keys(AUTHORIZED_DESTINATIONS)) {
  for (const locale of ['pt-BR', 'en']) {
    const caminho = destinationPath(chave, locale);
    const seguro = caminho.startsWith(`/${locale}`) && !caminho.includes('//') && !caminho.includes(':');
    if (!seguro) { falhas++; console.log(`FALHA destino "${chave}" em ${locale} gerou "${caminho}"`); }
  }
}
console.log('OK    todo destino autorizado gera caminho interno, com idioma');

// ───────── 3. O link do e-mail aponta para o domínio oficial ─────────

const url = actionHandlerUrl('pt-BR', 'settings-account', ORIGEM);
confere(
  'o link do e-mail fica no domínio oficial, na página de ação',
  url.startsWith(`${ORIGEM}/pt-BR/auth/action`),
  `veio ${url}`,
  url,
);
confere(
  'o link leva o destino como chave, não como endereço',
  new URL(url).searchParams.get('continue') === 'settings-account',
  'o parâmetro continue não é a chave do destino',
);

const settings = buildActionCodeSettings('en', 'login', ORIGEM);
confere(
  'ActionCodeSettings aponta para a nossa página, no idioma pedido',
  settings.url.startsWith(`${ORIGEM}/en/auth/action`),
  `veio ${settings.url}`,
);
confere(
  'o handler lê com segurança o destino aninhado em continueUrl',
  resolveActionDestination(null, settings.url, ORIGEM) === 'login',
  'o destino aninhado não foi recuperado',
);
confere(
  'continueUrl do mesmo domínio, mas fora do handler, é recusado',
  resolveActionDestination(null, `${ORIGEM}/en/settings/account?continue=home`, ORIGEM) === DEFAULT_DESTINATION,
  'um caminho arbitrário do site não pode virar retorno de autenticação',
);
confere(
  'handleCodeInApp é false (quem trata o código é a nossa página web)',
  settings.handleCodeInApp === false,
  'com true o Firebase tentaria abrir o app por link dinâmico, caminho que esta rede não usa',
);

// ───────── 4. Idioma e modos ─────────

confere('idioma: en é reconhecido', normalizeLocale('en') === 'en', 'en deveria ser aceito');
confere('idioma: inventado cai no padrão', normalizeLocale('fr') === 'pt-BR' && normalizeLocale(null) === 'pt-BR', 'fallback errado');
confere(
  'idioma pelo caminho',
  localeFromPath('/en/settings') === 'en' && localeFromPath('/en') === 'en' && localeFromPath('/pt-BR/x') === 'pt-BR' && localeFromPath('/') === 'pt-BR',
  'detecção de idioma pelo caminho errada',
);
confere(
  'idioma pelo caminho não confunde prefixo',
  localeFromPath('/engenharia') === 'pt-BR',
  '"/engenharia" não é inglês',
);

const MODOS_VALIDOS = ['verifyEmail', 'resetPassword', 'recoverEmail', 'verifyAndChangeEmail'];
confere(
  'os quatro modos do Firebase são aceitos',
  MODOS_VALIDOS.every((m) => parseActionMode(m) === m),
  'algum modo deixou de ser reconhecido',
);
confere(
  'modo inventado, vazio e nulo são recusados',
  parseActionMode('signIn') === null && parseActionMode('') === null && parseActionMode(null) === null,
  'modo desconhecido deveria virar null',
);

// ───────── 5. Erros traduzidos para o que a pessoa vê ─────────

const ERROS = [
  ['auth/expired-action-code', 'expirado'],
  ['auth/invalid-action-code', 'invalido-ou-usado'],
  ['auth/user-disabled', 'usuario-desativado'],
  ['auth/weak-password', 'senha-fraca'],
  ['auth/network-request-failed', 'desconhecido'],
  [null, 'desconhecido'],
];
for (const [codigo, esperado] of ERROS) {
  confere(`erro ${codigo ?? 'ausente'} → ${esperado}`, classifyActionError(codigo) === esperado, 'classificação errada');
}

// ───────── 6. Política de senha ─────────

confere('o mínimo é 8 caracteres', PASSWORD_MIN_LENGTH === 8, `está ${PASSWORD_MIN_LENGTH}`);

const SENHAS = [
  ['boa senha', 'girassol-vermelho-42', undefined, true],
  ['curta', 'abc123', undefined, false],
  ['só números', '12345678901', undefined, false],
  ['óbvia', 'senha123', undefined, false],
  ['caractere repetido', 'aaaaaaaa', undefined, false],
  ['contém o e-mail', 'maria.silva-2026', 'maria.silva@example.com', false],
  ['e-mail curto não atrapalha', 'xyz-senha-forte-1', 'ze@example.com', true],
  ['vazia', '', undefined, false],
];
for (const [nome, senha, email, esperado] of SENHAS) {
  const r = checkPassword(senha, email);
  confere(`senha: ${nome}`, r.ok === esperado, `ok=${r.ok}, esperado ${esperado} (${r.problems.join(', ')})`);
}

confere(
  'e-mail é normalizado para minúsculas e sem espaços',
  normalizeEmail('  Maria@Example.COM ') === 'maria@example.com',
  'normalização de e-mail errada',
);
const EMAILS = [
  ['válido', 'maria@example.com', true],
  ['sem arroba', 'maria.example.com', false],
  ['dois arrobas', 'a@b@example.com', false],
  ['sem ponto no domínio', 'maria@example', false],
  ['ponto duplo', 'maria@exa..mple.com', false],
  ['com espaço', 'maria @example.com', false],
  ['vazio', '', false],
];
for (const [nome, email, esperado] of EMAILS) {
  confere(`e-mail: ${nome}`, looksLikeEmail(email) === esperado, `veio ${looksLikeEmail(email)}`);
}

// ───────── 7. O código usa de fato o que foi testado ─────────

const ler = (rel) => readFileSync(join(RAIZ, 'src', rel), 'utf8');
const seguranca = ler(join('lib', 'services', 'accountSecurity.ts'));
const authSvc = ler(join('lib', 'services', 'authService.ts'));
const privateSvc = ler(join('lib', 'services', 'userPrivate.ts'));
const pagina = ler(join('app', '[locale]', 'auth', 'action', 'page.tsx'));

// `[\s\S]{0,80}` e não `[^)]*`: os argumentos anteriores têm parênteses (`requireUser()`, `email.trim()`).
confere(
  'a confirmação de e-mail passa ActionCodeSettings',
  /sendEmailVerification\([\s\S]{0,80}actionSettings\(/.test(seguranca),
  'sem ActionCodeSettings o link vai para o handler padrão do Firebase, fora do domínio oficial',
);
confere(
  'a redefinição de senha passa ActionCodeSettings',
  /sendPasswordResetEmail\([\s\S]{0,80}actionSettings\(/.test(seguranca),
  'mesmo problema do item anterior',
);
confere(
  'os links usam a origem OFICIAL, não baseUrl',
  seguranca.includes('siteConfig.officialOrigin') && authSvc.includes('siteConfig.officialOrigin'),
  'baseUrl pode apontar para localhost em desenvolvimento, e link de e-mail não volta',
);
confere(
  'a troca de e-mail usa verifyBeforeUpdateEmail',
  authSvc.includes('verifyBeforeUpdateEmail('),
  'a troca precisa confirmar o endereço NOVO antes de valer',
);
confere(
  'a troca de e-mail NÃO usa mais updateEmail direto',
  !/[^a-zA-Z]updateEmail\(/.test(authSvc),
  'updateEmail troca na hora: erro de digitação tranca a pessoa fora da conta',
);
confere(
  'a troca de e-mail não grava o endereço novo antes da confirmação',
  !/verifyBeforeUpdateEmail[\s\S]{0,400}savePrivateAccount/.test(authSvc),
  'gravar antes contradiz a confirmação — e a regra do Firestore recusaria',
);
confere(
  'existe reconciliação do e-mail privado para o link aberto em outro aparelho',
  privateSvc.includes('reconcilePrivateEmail'),
  'sem isso o Auth fica com o e-mail novo e o registro privado com o antigo',
);
confere(
  'a página resolve o destino pela lista fechada',
  pagina.includes('resolveActionDestination('),
  'a página precisa passar o parâmetro pela lista de destinos',
);
confere(
  'a página nunca navega para um endereço vindo da URL',
  !/push\(\s*params\.get|href=\{params\.get|window\.location\s*=/.test(pagina),
  'navegar para valor cru da URL é redirecionamento aberto',
);
confere(
  'a página renova o token depois de confirmar',
  pagina.includes('getIdToken(true)'),
  'sem renovar, as regras continuam vendo email_verified=false e a pessoa segue barrada',
);
confere(
  'a confirmação também renova o token no serviço',
  /getIdToken\(true\)/.test(seguranca),
  'refreshEmailVerified precisa renovar o token',
);
confere(
  'a página não afirma verificar identidade',
  pagina.includes('identityNote'),
  'o aviso de que confirmar e-mail não é identidade civil precisa estar na tela',
);

if (falhas) {
  console.log(`\n${falhas} falha(s) nos links de ação.`);
  process.exit(1);
}
console.log('\nLinks de ação OK: sem redirecionamento aberto, domínio oficial, token renovado.');
