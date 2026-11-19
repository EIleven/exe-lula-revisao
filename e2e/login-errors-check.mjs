#!/usr/bin/env node
/**
 * Os motivos de falha do login externo (Fediverso, Atmosfera): src/lib/auth/loginErrors.ts
 *   node e2e/login-errors-check.mjs        (ou: npm run e2e:login-erros)
 *
 * Em 2026-11-14/15 todo login externo falhou em produção (`iam.serviceAccounts.signBlob` negado) e a rota de retorno passou a
 * pôr o TEXTO do erro na URL (`&reason=Permission 'iam.serviceAccounts.signBlob' denied...`), que a tela mostrava como estava.
 * Isso entregava texto interno do servidor a qualquer pessoa e deixava um link forjado escrever o aviso do site. Aqui se prova:
 *  - as mensagens REAIS vistas em produção viram o código certo;
 *  - a URL de erro leva só o código (nunca o texto do erro, nem nome de conta de serviço ou de projeto);
 *  - só código conhecido vira mensagem; texto forjado na URL não aparece na tela;
 *  - nada lança, seja o que for que tenha sido lançado.
 * Sai com código 1 se algo falhar.
 */
import { LOGIN_REASONS, isLoginReason, loginErrorUrl, loginReasonMessage, loginReasonOf, loginReasonOfAuthError } from '../src/lib/auth/loginErrors.ts';

let falhas = 0;
let total = 0;
const confere = (nome, condicao, motivo) => {
  total++;
  if (condicao) console.log(`OK    ${nome}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo ?? 'condição falsa'}`); }
};

// ───────── as mensagens que apareceram de verdade nos logs de produção ─────────
const REAIS = [
  ["Permission 'iam.serviceAccounts.signBlob' denied on resource (or it may not exist). Remediate access with this Troubleshooter URL or share it with your administrator - https://console.cloud.google.com/iam-admin/troubleshooter/summary;errorId=abc", 'credential_unavailable'],
  ['The given sign-in provider is disabled for this Firebase project. Enable it in the Firebase console, under the sign-in method tab of the Auth section.', 'credential_unavailable'],
  ['credential_unavailable: The given sign-in provider is disabled for this Firebase project.', 'credential_unavailable'],
  ['invalid or expired application state', 'state_invalid'],
  ['missing application state', 'state_invalid'],
  ['access_denied', 'access_denied'],
  ['The user denied the request', 'access_denied'],
  ['The email address is already in use by another account. (email-already-exists)', 'account_conflict'],
  ['fetch failed', 'provider_unreachable'],
  ['getaddrinfo ENOTFOUND exemplo.social', 'provider_unreachable'],
  ['connect ETIMEDOUT 10.0.0.1:443', 'provider_unreachable'],
  ['The operation was aborted', 'provider_unreachable'],
  ['alguma coisa que nunca vimos', 'unknown'],
  ['', 'unknown'],
];
for (const [texto, esperado] of REAIS) {
  const obtido = loginReasonOf(new Error(texto));
  confere(`CLASSIFICA · ${JSON.stringify(texto.slice(0, 70))} → ${esperado}`, obtido === esperado, `veio ${obtido}`);
}
confere('CLASSIFICA · aceita string, não só Error', loginReasonOf('fetch failed') === 'provider_unreachable', loginReasonOf('fetch failed'));
confere('CLASSIFICA · aceita objeto com `message`', loginReasonOf({ message: 'signBlob denied' }) === 'credential_unavailable', loginReasonOf({ message: 'signBlob denied' }));
confere('CLASSIFICA · o nome do erro também conta', loginReasonOf(Object.assign(new Error('x'), { name: 'access_denied' })) === 'access_denied', 'ignorou o nome');
for (const estranho of [null, undefined, 0, 42, true, {}, [], Symbol('x'), () => 1, { message: { toString() { throw new Error('boom'); } } }]) {
  let r;
  try { r = loginReasonOf(estranho); } catch (e) { r = `LANÇOU ${e}`; }
  confere(`CLASSIFICA · valor estranho (${typeof estranho}) nunca lança e dá um código conhecido`, isLoginReason(r), String(r));
}
confere('CLASSIFICA · o problema do SERVIDOR vem antes do resto (credencial indisponível + "timeout" no texto ainda é o nosso)', loginReasonOf(new Error('signBlob timeout')) === 'credential_unavailable', loginReasonOf(new Error('signBlob timeout')));

// ───────── a URL leva só o código ─────────
const ORIGEM = 'https://exercitodolula.app';
for (const [texto] of REAIS) {
  const url = loginErrorUrl(ORIGEM, 'pt-BR', 'fediverse_error', new Error(texto));
  const sufixo = url.split('reason=')[1];
  confere(`URL · ${JSON.stringify(texto.slice(0, 50))}: o reason é um código conhecido`, isLoginReason(sufixo), sufixo);
  confere(`URL · ${JSON.stringify(texto.slice(0, 50))}: nada do texto do erro vaza`, !/signblob|permission|iam|firebase|troubleshoot|console\.|denied|disabled|enotfound|etimedout|getaddrinfo/i.test(url.replace(/credential_unavailable|access_denied/g, '')), url);
}
confere('URL · formato completo', loginErrorUrl(`${ORIGEM}///`, 'en', 'bluesky', new Error('fetch failed')) === `${ORIGEM}/en/login?auth_error=bluesky&reason=provider_unreachable`, loginErrorUrl(`${ORIGEM}///`, 'en', 'bluesky', new Error('fetch failed')));
confere('URL · idioma desconhecido cai em pt-BR (não monta caminho com texto livre)', loginErrorUrl(ORIGEM, '../../evil', 'x', 'y').startsWith(`${ORIGEM}/pt-BR/login?`), loginErrorUrl(ORIGEM, '../../evil', 'x', 'y'));
confere('URL · o auth_error é codificado (não injeta parâmetro)', loginErrorUrl(ORIGEM, 'pt-BR', 'a&reason=forjado', 'x').includes('auth_error=a%26reason%3Dforjado&reason=unknown'), loginErrorUrl(ORIGEM, 'pt-BR', 'a&reason=forjado', 'x'));

// ───────── a tela: só código conhecido vira mensagem ─────────
for (const codigo of LOGIN_REASONS) {
  const m = loginReasonMessage(codigo);
  confere(`TELA · ${codigo} tem mensagem em português, sem termo interno`, typeof m === 'string' && m.length > 20 && !/signblob|iam|firebase|google|token creator|permission/i.test(m), String(m));
}
for (const forjado of ['Sua conta foi suspensa. Ligue para 0800-000', '<script>alert(1)</script>', 'credential_unavailable ', 'CREDENTIAL_UNAVAILABLE', '', null, undefined, 42, {}, [], 'unknown\n']) {
  confere(`TELA · texto forjado na URL (${JSON.stringify(forjado)?.slice(0, 40)}) não vira mensagem`, loginReasonMessage(forjado) === null, String(loginReasonMessage(forjado)));
}

// ───────── os auth_error antigos, sem motivo ─────────
const ANTIGOS = [['fediverse_invalid_state', 'state_invalid'], ['fediverse_missing_params', 'state_invalid'], ['fediverse_app_missing', 'provider_unreachable'], ['fediverse_token_failed', 'provider_unreachable'], ['fediverse_profile_failed', 'provider_unreachable'], ['fediverse_error', null], ['bluesky', null], ['qualquer', null], [null, null], [undefined, null]];
for (const [authError, esperado] of ANTIGOS) confere(`AUTH_ERROR · ${String(authError)} → ${esperado}`, loginReasonOfAuthError(authError) === esperado, String(loginReasonOfAuthError(authError)));

console.log(`\n${total - falhas}/${total} verificações passaram.`);
if (falhas > 0) { console.log(`${falhas} FALHA(S).`); process.exit(1); }
