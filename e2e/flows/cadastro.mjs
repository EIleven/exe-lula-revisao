/**
 * Seção "cadastro": o limite dos primeiros usuários (vagas HISTÓRICAS), imposto no servidor.
 *
 * Cadastro por e-mail (Function createUserProfile) e primeiro acesso com o Google (Function claimGoogleProfile) passam
 * pela MESMA transação, que confere o limite em _signup/control, reserva a vaga do UID em _signup/control/slots/{uid} e
 * grava perfil, @ e dados pessoais de uma vez. Aqui se prova, nos emuladores:
 *   - 499 vagas usadas: de vários cadastros SIMULTÂNEOS (e-mail e Google) entra exatamente um, e ninguém fica órfão;
 *   - 500 usadas: e-mail e Google são recusados, quem já tem conta continua entrando e excluir conta NÃO libera vaga;
 *   - repetir o pedido do mesmo UID não consome outra vaga; @ repetido, e-mail repetido e @ inválido não consomem;
 *   - sem o documento de controle o cadastro FECHA (não vira ilimitado);
 *   - a mensagem de "vagas preenchidas" aparece em português e em inglês, e a situação pública não vaza o contador;
 *   - as regras do Firestore recusam criar perfil, @ e dados pessoais direto pelo cliente (REST e SDK de verdade);
 *   - o script de migração é idempotente.
 * Roda por último: mexe no documento de controle e o restaura no fim.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DATABASE,
  EMU,
  PROJECT,
  authAccounts,
  callFunction,
  deleteAuthAccount,
  eventually,
  fakeAppCheckToken,
  fakeGoogleSignIn,
  fsCall,
  fsCreate,
  fsDelete,
  fsGetDoc,
  fsSet,
  fsUpdate,
  loginViaUi,
  seedSignupControl,
  setSignupAppCheck,
  signupControl,
  signupSlots,
} from '../lib/harness.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SENHA = 'Teste!123456';
const denied = (response) => response.status === 401 || response.status === 403;
const closed = (response) => response.error?.status === 'RESOURCE_EXHAUSTED';
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,15}$/;

export async function run(ctx) {
  const { runner, users, BASE_URL, browser, shot, stamp } = ctx;
  const { a: A, b: B, c: C } = users;
  const { section, soft, check } = runner;

  let seq = 0;
  /** Dados de um cadastro por e-mail novo e único. */
  const novoCadastro = () => {
    seq += 1;
    const id = `${stamp}${seq}`;
    return { name: `Cadastro ${id}`, username: `c${id}`, email: `cad.${id}@example.test`, dateOfBirth: '1991-02-03', password: SENHA };
  };
  const novoGoogle = async (label = 'g') => {
    seq += 1;
    return fakeGoogleSignIn({ email: `${label}${seq}.${stamp}@example.test`, name: `Pessoa Google ${seq}` });
  };
  const used = async () => (await signupControl()).used;
  const slotCount = async () => (await signupSlots()).length;
  const authEmails = async () => new Set((await authAccounts()).map((account) => account.email));
  const authUids = async () => new Set((await authAccounts()).map((account) => account.localId));
  const profileOf = async (uid) => (await fsGetDoc(`users/${uid}`, 'owner')).doc;
  /**
   * Clica em "Entrar com Google" e conclui o popup do Auth EMULADO: cria uma conta nova (dados gerados pelo emulador) ou,
   * com `existingEmail`, escolhe uma conta que já existe. É o mesmo signInWithPopup que o navegador usa de verdade.
   */
  const googlePopup = async (context, page, { existingEmail } = {}) => {
    const [popup] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: /Google/ }).click()]);
    await popup.waitForLoadState('domcontentloaded');
    if (existingEmail) {
      await popup.getByText(existingEmail).first().click();
      const signIn = popup.locator('#sign-in');
      if (await signIn.isVisible().catch(() => false)) await signIn.click();
    } else {
      await popup.getByText('Add new account').click();
      await popup.locator('#autogen-button').click();
      await popup.locator('#sign-in').click();
    }
  };
  const openLogin = async (context, locale = 'pt-BR') => {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/${locale}/login`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="emulator-banner"][data-status="ok"]').waitFor({ timeout: 90_000 });
    return page;
  };
  const signUpRest = async (email) => {
    const response = await fetch(`${EMU.auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: SENHA, returnSecureToken: true }),
    });
    return response.json();
  };

  // ---------------------------------------------------------------------------------------------------------------
  section('cadastro: vagas, e-mail e Google');
  let baseUsed;
  await soft('cada cadastro pela interface reservou UMA vaga: usadas = vagas registradas, cada UID com a sua', async () => {
    const control = await signupControl();
    const slots = await signupSlots();
    check(control.limit === 500, `limite = ${control.limit}`);
    check(control.used === slots.length, `usadas (${control.used}) difere das vagas registradas (${slots.length})`);
    for (const user of [A, B, C]) {
      const slot = slots.find((entry) => entry.__id === user.uid);
      check(slot, `o usuário ${user.label.toUpperCase()} não tem vaga`);
      check(slot.provider === 'password', `a vaga de ${user.label.toUpperCase()} é do provedor ${slot.provider}`);
    }
    check(new Set(slots.map((slot) => slot.number)).size === slots.length, 'há números de vaga repetidos');
    baseUsed = control.used;
    return `${control.used} de ${control.limit}`;
  }, { tag: 'funcional' });

  await soft('a situação pública do cadastro diz só "aberto" e o limite: não vaza o contador de vagas usadas', async () => {
    const status = await callFunction('getSignupStatus', {});
    check(status.result?.open === true, `open = ${status.result?.open}`);
    check(JSON.stringify(Object.keys(status.result).sort()) === JSON.stringify(['limit', 'open']), `campos devolvidos: ${Object.keys(status.result)}`);
  }, { tag: 'seg' });

  await soft('@ inválido (espaço, símbolo, curto ou longo demais) é recusado no SERVIDOR e não cria conta nem consome vaga', async () => {
    const before = await used();
    for (const username of ['ab cd', 'a/b', 'ab', 'x'.repeat(16), 'çãoç']) {
      const payload = { ...novoCadastro(), username };
      const response = await callFunction('createUserProfile', payload);
      check(response.error?.status === 'INVALID_ARGUMENT', `@ ${JSON.stringify(username)} -> ${response.error?.status ?? 'aceito'}`);
      check(!(await authEmails()).has(payload.email), `@ ${JSON.stringify(username)} deixou uma conta no Auth`);
    }
    check((await used()) === before, 'um @ inválido consumiu vaga');
  }, { tag: 'seg' });

  await soft('na tela, um @ inválido mostra o aviso de formato (3 a 15 letras, números ou _)', async () => {
    const context = await browser.newContext({ locale: 'pt-BR', serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/pt-BR/register`, { waitUntil: 'domcontentloaded' });
      await page.locator('#username').fill('ab cd');
      await page.getByText('Use de 3 a 15 letras, números ou _').waitFor({ timeout: 60_000 });
    } finally {
      await context.close();
    }
  }, { tag: 'ux' });

  const primeiro = novoCadastro();
  let primeiroUid;
  await soft('cadastro por e-mail: cria a conta, o perfil, o @ e a vaga numa transação só (usadas + 1)', async () => {
    const before = await used();
    const response = await callFunction('createUserProfile', primeiro);
    check(response.result?.status === 'success', `createUserProfile -> ${JSON.stringify(response.error ?? response.result).slice(0, 160)}`);
    primeiroUid = response.result.user.id;
    check((await used()) === before + 1, 'o contador não subiu exatamente 1');
    const slot = (await signupSlots()).find((entry) => entry.__id === primeiroUid);
    check(slot && slot.provider === 'password', 'a vaga do novo UID não foi registrada');
    const usernameDoc = (await fsGetDoc(`usernames/${primeiro.username.toLowerCase()}`, 'owner')).doc;
    check(usernameDoc?.userId === primeiroUid, 'o @ não aponta para o novo UID');
    const privateDoc = (await fsGetDoc(`users/${primeiroUid}/private/account`, 'owner')).doc;
    check(privateDoc?.email === primeiro.email, 'os dados pessoais não foram gravados');
    const profile = await profileOf(primeiroUid);
    check(profile.isAdmin === false && profile.isModerator === false, 'o perfil novo nasceu com papel de administrador/moderador');
  }, { tag: 'funcional' });

  await soft('@ já usado (mesmo em maiúsculas) é recusado e NÃO consome vaga nem deixa conta órfã no Auth', async () => {
    const before = await used();
    const slotsBefore = await slotCount();
    const rival = { ...novoCadastro(), username: primeiro.username.toUpperCase() };
    const response = await callFunction('createUserProfile', rival);
    check(response.error?.status === 'ALREADY_EXISTS', `-> ${response.error?.status ?? 'aceito'}`);
    check((await used()) === before && (await slotCount()) === slotsBefore, 'a colisão de @ consumiu vaga');
    check(!(await authEmails()).has(rival.email), 'a colisão de @ deixou uma conta órfã no Auth');
  }, { tag: 'funcional' });

  await soft('@ disputado por dois cadastros AO MESMO TEMPO: entra um só, o outro não consome vaga nem deixa conta órfã', async () => {
    const before = await used();
    const username = `d${stamp}${seq}`;
    const [x, y] = [{ ...novoCadastro(), username }, { ...novoCadastro(), username }];
    const results = await Promise.all([callFunction('createUserProfile', x), callFunction('createUserProfile', y)]);
    const wins = results.filter((r) => r.result?.status === 'success');
    const losses = results.filter((r) => r.error?.status === 'ALREADY_EXISTS');
    check(wins.length === 1 && losses.length === 1, `vitórias ${wins.length}, colisões ${losses.length}: ${JSON.stringify(results.map((r) => r.error?.status ?? 'ok'))}`);
    check((await used()) === before + 1, 'o contador não subiu exatamente 1');
    const emails = await authEmails();
    check([x, y].filter((payload) => emails.has(payload.email)).length === 1, 'sobrou conta órfã no Auth (ou nenhuma)');
  }, { tag: 'funcional' });

  await soft('e-mail já cadastrado é recusado e NÃO consome vaga', async () => {
    const before = await used();
    const response = await callFunction('createUserProfile', { ...novoCadastro(), email: primeiro.email });
    check(response.error?.status === 'ALREADY_EXISTS', `-> ${response.error?.status ?? 'aceito'}`);
    check((await used()) === before, 'o e-mail repetido consumiu vaga');
  }, { tag: 'funcional' });

  let google;
  let googleUsername;
  await soft('Google, primeiro acesso: o PERFIL NASCE NO SERVIDOR com @ provisório único e consome UMA vaga', async () => {
    google = await novoGoogle('g');
    const before = await used();
    const response = await callFunction('claimGoogleProfile', {}, google.idToken);
    check(response.result?.status === 'created', `-> ${JSON.stringify(response.error ?? response.result).slice(0, 160)}`);
    check((await used()) === before + 1, 'o contador não subiu exatamente 1');
    const profile = await profileOf(google.localId);
    check(profile, 'o perfil não foi criado');
    googleUsername = profile.username;
    check(USERNAME_PATTERN.test(googleUsername), `@ provisório inválido: ${googleUsername}`);
    check((await fsGetDoc(`usernames/${googleUsername.toLowerCase()}`, 'owner')).doc?.userId === google.localId, 'o @ não aponta para o UID');
    check((await fsGetDoc(`users/${google.localId}/private/account`, 'owner')).doc?.email === google.email, 'o e-mail do Google não foi para os dados pessoais');
    check(profile.isAdmin === false && profile.isModerator === false, 'o perfil nasceu com papel de administrador/moderador');
    const slot = (await signupSlots()).find((entry) => entry.__id === google.localId);
    check(slot?.provider === 'google.com', 'a vaga não é do provedor google.com');
  }, { tag: 'funcional' });

  await soft('repetir o pedido do MESMO UID (inclusive em paralelo) não consome outra vaga: todos recebem "exists"', async () => {
    const before = await used();
    const slotsBefore = await slotCount();
    const results = await Promise.all([1, 2, 3, 4].map(() => callFunction('claimGoogleProfile', {}, google.idToken)));
    for (const response of results) check(response.result?.status === 'exists', `-> ${JSON.stringify(response.error ?? response.result).slice(0, 120)}`);
    check((await used()) === before && (await slotCount()) === slotsBefore, 'a repetição do mesmo UID consumiu vaga');
    check((await profileOf(google.localId)).username === googleUsername, 'a repetição trocou o @ do perfil');
  }, { tag: 'funcional' });

  await soft('só o login com o Google cria perfil por claimGoogleProfile: sem login e conta de senha são recusados, sem vaga', async () => {
    const before = await used();
    const anonymous = await callFunction('claimGoogleProfile', {});
    check(anonymous.error?.status === 'UNAUTHENTICATED', `sem login -> ${anonymous.error?.status ?? 'aceito'}`);
    // Conta criada direto na API pública do Auth (sem passar pelo cadastro): não ganha perfil nem vaga.
    const account = await signUpRest(`soauth.${stamp}@example.test`);
    const viaPassword = await callFunction('claimGoogleProfile', {}, account.idToken);
    check(viaPassword.error?.status === 'PERMISSION_DENIED', `conta de senha -> ${viaPassword.error?.status ?? 'aceito'}`);
    check(!(await profileOf(account.localId)), 'a conta só-Auth ganhou perfil');
    check((await used()) === before, 'uma recusa consumiu vaga');
  }, { tag: 'seg' });

  // O mesmo caminho pelo NAVEGADOR de verdade: signInWithPopup -> loginWithGoogle -> Function claimGoogleProfile ->
  // "Finalize seu Perfil" (escolhe o @ pela Function updateUserUsername e grava a data de nascimento em private/account,
  // uma escrita do cliente que continua valendo nas regras novas).
  let googleUi;
  await soft('Google pela TELA, vagas abertas: o perfil nasce no servidor, abre "Finalize seu Perfil" e o login termina', async () => {
    await seedSignupControl({ limit: 500, used: await slotCount() });
    const uidsBefore = await authUids();
    const usedBefore = await used();
    const context = await browser.newContext({ locale: 'pt-BR', serviceWorkers: 'block' });
    try {
      const page = await openLogin(context);
      await googlePopup(context, page);
      await page.getByText('Finalize seu Perfil').waitFor({ timeout: 60_000 });
      const created = [...(await authUids())].filter((uid) => !uidsBefore.has(uid));
      check(created.length === 1, `contas novas no Auth: ${created.length}`);
      const uid = created[0];
      const profile = await profileOf(uid);
      check(profile, 'o perfil não foi criado pelo servidor');
      check(USERNAME_PATTERN.test(profile.username), `@ provisório inválido: ${profile.username}`);
      check((await used()) === usedBefore + 1, 'o contador não subiu exatamente 1');
      check((await signupSlots()).find((slot) => slot.__id === uid)?.provider === 'google.com', 'a vaga não é do provedor google.com');

      const username = `ui${stamp}`;
      await page.locator('#username-complete').fill(username);
      await page.getByText('Nome de usuário disponível!').waitFor({ timeout: 60_000 });
      await page.locator('#dob-complete').fill('1992-05-06');
      await page.getByRole('button', { name: 'Salvar e Continuar' }).click();
      await page.getByText('Login bem-sucedido').first().waitFor({ timeout: 60_000 });
      check((await profileOf(uid)).username === username, 'o @ escolhido não foi gravado');
      check((await fsGetDoc(`users/${uid}/private/account`, 'owner')).doc?.dateOfBirth === '1992-05-06', 'a data de nascimento não foi gravada');
      check((await used()) === usedBefore + 1, 'completar o perfil mexeu nas vagas');
      googleUi = { uid, email: (await authAccounts()).find((account) => account.localId === uid).email };
      await shot(page, 'cadastro-03-google-pela-tela');
    } finally {
      await context.close();
    }
  }, { tag: 'funcional' });

  // ---------------------------------------------------------------------------------------------------------------
  section('cadastro: com 499 e com 500 vagas');
  let vencedor;
  await soft('499 vagas usadas: de 6 cadastros SIMULTÂNEOS (3 por e-mail, 3 pelo Google) entra EXATAMENTE 1, sem conta órfã', async () => {
    const slotsBefore = await slotCount();
    await seedSignupControl({ limit: 500, used: 499 });
    const porEmail = [novoCadastro(), novoCadastro(), novoCadastro()];
    const porGoogle = await Promise.all([novoGoogle('r'), novoGoogle('r'), novoGoogle('r')]);
    const results = await Promise.all([
      ...porEmail.map((payload) => callFunction('createUserProfile', payload)),
      ...porGoogle.map((account) => callFunction('claimGoogleProfile', {}, account.idToken)),
    ]);
    const wins = results.filter((r) => r.result && !r.error);
    const refused = results.filter(closed);
    const others = results.filter((r) => !(r.result && !r.error) && !closed(r));
    check(wins.length === 1, `entraram ${wins.length} (esperado exatamente 1); outros erros: ${JSON.stringify(others.map((r) => r.error))}`);
    check(refused.length === 5, `recusados por lotação: ${refused.length} (esperado 5); outros erros: ${JSON.stringify(others.map((r) => r.error))}`);
    check((await used()) === 500, `usadas = ${await used()} (esperado 500)`);
    check((await slotCount()) === slotsBefore + 1, 'o número de vagas registradas não subiu exatamente 1');
    // Sem órfãos: no Auth só sobrou a conta de quem entrou, e ela tem perfil.
    const emails = await authEmails();
    const uids = await authUids();
    const remaining = [
      ...porEmail.filter((payload) => emails.has(payload.email)).map((payload) => ({ kind: 'e-mail', email: payload.email })),
      ...porGoogle.filter((account) => uids.has(account.localId)).map((account) => ({ kind: 'google', uid: account.localId })),
    ];
    check(remaining.length === 1, `contas que sobraram no Auth: ${remaining.length} (esperado 1, a de quem entrou)`);
    vencedor = remaining[0];
    const winnerUid = vencedor.uid ?? (await authAccounts()).find((account) => account.email === vencedor.email).localId;
    check(await profileOf(winnerUid), 'quem entrou ficou sem perfil');
    return `entrou 1 (${vencedor.kind}); 5 recusados`;
  }, { tag: 'funcional' });

  await soft('500 vagas: e-mail e Google são RECUSADOS com a mensagem em português e inglês, e a conta do Google não fica órfã', async () => {
    const before = await slotCount();
    const emailAttempt = novoCadastro();
    const byEmail = await callFunction('createUserProfile', emailAttempt);
    check(closed(byEmail), `e-mail -> ${byEmail.error?.status ?? 'aceito'}`);
    check(byEmail.error.details?.reason === 'signup-closed', `motivo: ${JSON.stringify(byEmail.error.details)}`);
    check(byEmail.error.details?.limit === 500, 'o erro não informa o limite');
    check(/vagas iniciais/.test(byEmail.error.message) && /first 500 spots/.test(byEmail.error.message), `mensagem: ${byEmail.error.message}`);
    check(!(await authEmails()).has(emailAttempt.email), 'o cadastro recusado criou conta no Auth');

    const googleAttempt = await novoGoogle('l');
    const byGoogle = await callFunction('claimGoogleProfile', {}, googleAttempt.idToken);
    check(closed(byGoogle), `Google -> ${byGoogle.error?.status ?? 'aceito'}`);
    check(!(await authUids()).has(googleAttempt.localId), 'a conta do Google recusada ficou órfã no Auth');
    check(!(await profileOf(googleAttempt.localId)), 'a conta do Google recusada ganhou perfil');
    check((await used()) === 500 && (await slotCount()) === before, 'uma recusa mexeu nas vagas');
  }, { tag: 'funcional' });

  await soft('lotado: a situação pública diz "fechado" (sem o contador) e a tela de cadastro avisa em português e em inglês', async () => {
    const status = await callFunction('getSignupStatus', {});
    check(status.result?.open === false && status.result?.limit === 500, `status: ${JSON.stringify(status.result)}`);
    check(!('used' in status.result), 'a situação pública vazou o contador');
    const context = await browser.newContext({ locale: 'pt-BR', serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/pt-BR/register`, { waitUntil: 'domcontentloaded' });
      const card = page.getByTestId('signup-closed');
      await card.waitFor({ timeout: 60_000 });
      const portuguese = await card.innerText();
      check(/Cadastros encerrados/.test(portuguese) && /500 vagas iniciais do Exe\. Lula foram preenchidas/.test(portuguese), `pt-BR: ${portuguese.slice(0, 160)}`);
      await shot(page, 'cadastro-01-lotado-pt');
      await page.goto(`${BASE_URL}/en/register`, { waitUntil: 'domcontentloaded' });
      const englishCard = page.getByTestId('signup-closed');
      await englishCard.waitFor({ timeout: 60_000 });
      const english = await englishCard.innerText();
      check(/Sign-ups are closed/.test(english) && /first 500 spots on Exe\. Lula have been filled/.test(english), `en: ${english.slice(0, 160)}`);
      await shot(page, 'cadastro-02-lotado-en');
    } finally {
      await context.close();
    }
  }, { tag: 'ux' });

  await soft('500 vagas, Google pela TELA com conta NOVA: aviso de vagas preenchidas (pt e en), sai da sessão e não deixa conta no Auth', async () => {
    const slotsBefore = await slotCount();
    for (const [locale, title, message] of [
      ['pt-BR', 'Cadastros encerrados por enquanto', /500 vagas iniciais do Exe\. Lula foram preenchidas/],
      ['en', 'Sign-ups are closed for now', /first 500 spots on Exe\. Lula have been filled/],
    ]) {
      const uidsBefore = await authUids();
      const context = await browser.newContext({ locale, serviceWorkers: 'block' });
      try {
        const page = await openLogin(context, locale);
        await googlePopup(context, page);
        await page.getByText(title).first().waitFor({ timeout: 60_000 });
        check(message.test(await page.locator('body').innerText()), `${locale}: o aviso não traz a mensagem esperada`);
        await shot(page, `cadastro-04-google-lotado-${locale}`);
        check((await page.getByText(/Login bem-sucedido|Login successful/).count()) === 0, `${locale}: mostrou "login bem-sucedido"`);
      } finally {
        await context.close();
      }
      const leftovers = [...(await authUids())].filter((uid) => !uidsBefore.has(uid));
      check(leftovers.length === 0, `${locale}: a conta recusada ficou no Auth (${leftovers.length})`);
      check((await slotCount()) === slotsBefore && (await used()) === 500, `${locale}: a recusa mexeu nas vagas`);
    }
  }, { tag: 'funcional' });

  await soft('com 500 vagas, o Google de quem JÁ TEM conta entra normalmente pela tela (sem aviso de lotação)', async () => {
    check(googleUi, 'depende do teste do Google pela tela com vagas abertas');
    const slotsBefore = await slotCount();
    const context = await browser.newContext({ locale: 'pt-BR', serviceWorkers: 'block' });
    try {
      const page = await openLogin(context);
      await googlePopup(context, page, { existingEmail: googleUi.email });
      await page.getByText('Login bem-sucedido').first().waitFor({ timeout: 60_000 });
      check((await page.getByText('Cadastros encerrados por enquanto').count()) === 0, 'mostrou o aviso de lotação para quem já tem conta');
    } finally {
      await context.close();
    }
    check((await authUids()).has(googleUi.uid) && (await used()) === 500 && (await slotCount()) === slotsBefore, 'entrar com conta existente mexeu em conta ou vagas');
  }, { tag: 'funcional' });

  await soft('com 500 vagas, quem JÁ TEM conta continua entrando: senha pela tela e Google já cadastrado (sem apagar nada)', async () => {
    const before = await slotCount();
    const context = await browser.newContext({ locale: 'pt-BR', serviceWorkers: 'block' });
    try {
      await loginViaUi(await context.newPage(), BASE_URL, B);
    } finally {
      await context.close();
    }
    const again = await callFunction('claimGoogleProfile', {}, google.idToken);
    check(again.result?.status === 'exists', `Google já cadastrado -> ${JSON.stringify(again.error ?? again.result)}`);
    check((await authUids()).has(google.localId), 'o login de quem já tem conta apagou a conta no Auth');
    check((await used()) === 500 && (await slotCount()) === before, 'entrar com conta existente mexeu nas vagas');
  }, { tag: 'funcional' });

  await soft('excluir uma conta NÃO libera a vaga: usadas segue 500, a vaga continua registrada e o cadastro segue fechado', async () => {
    const uid = primeiroUid;
    const slotsBefore = await slotCount();
    await deleteAuthAccount(uid);
    await eventually(async () => !(await profileOf(uid)), { label: 'perfil removido pela limpeza da conta', timeoutMs: 60_000 });
    check((await used()) === 500, `usadas = ${await used()} depois de excluir a conta`);
    check((await slotCount()) === slotsBefore && (await signupSlots()).some((slot) => slot.__id === uid), 'a vaga da conta excluída foi apagada');
    const next = await callFunction('createUserProfile', novoCadastro());
    check(closed(next), `novo cadastro depois da exclusão -> ${next.error?.status ?? 'aceito'}`);
    // O @ da conta excluída volta a ficar livre (a vaga não, o nome sim), mas o cadastro continua fechado.
    check(!(await fsGetDoc(`usernames/${primeiro.username.toLowerCase()}`, 'owner')).doc, 'o @ da conta excluída não foi liberado');
  }, { tag: 'funcional' });

  await soft('sem o documento de controle o cadastro FECHA (não vira ilimitado) e não deixa conta órfã', async () => {
    const saved = await signupControl();
    await fsDelete('_signup/control', 'owner');
    try {
      const attempt = novoCadastro();
      const byEmail = await callFunction('createUserProfile', attempt);
      check(byEmail.error?.status === 'FAILED_PRECONDITION', `e-mail -> ${byEmail.error?.status ?? 'aceito'}`);
      check(!(await authEmails()).has(attempt.email), 'criou conta no Auth sem o controle');
      const status = await callFunction('getSignupStatus', {});
      check(status.error?.status === 'FAILED_PRECONDITION', `situação -> ${status.error?.status ?? 'respondeu'}`);
      const account = await novoGoogle('s');
      const byGoogle = await callFunction('claimGoogleProfile', {}, account.idToken);
      check(byGoogle.error?.status === 'FAILED_PRECONDITION', `Google -> ${byGoogle.error?.status ?? 'aceito'}`);
      check(!(await profileOf(account.localId)), 'ganhou perfil sem o controle');
    } finally {
      await seedSignupControl({ limit: saved.limit, used: saved.used });
    }
  }, { tag: 'seg' });

  // ---------------------------------------------------------------------------------------------------------------
  // Anti-robô: com requireAppCheck ligado no documento de controle, só quem traz o token do App Check (que o navegador de
  // uma pessoa obtém pelo reCAPTCHA) cria conta, ocupa vaga ou consulta se um e-mail existe. O token é o cabeçalho
  // X-Firebase-AppCheck; nos emuladores as Functions só o decodificam (fakeAppCheckToken).
  section('cadastro: anti-robô (App Check)');
  const reabrir = async () => seedSignupControl({ limit: 500, used: await slotCount() });
  await soft('anti-robô LIGADO: cadastro por e-mail SEM o token é recusado antes de criar conta ou gastar vaga (pt e en); COM o token entra', async () => {
    await reabrir();
    await setSignupAppCheck(true);
    try {
      const before = await used();
      const slotsBefore = await slotCount();
      const robo = novoCadastro();
      const semToken = await callFunction('createUserProfile', robo);
      check(semToken.error?.status === 'FAILED_PRECONDITION' && semToken.error.details?.reason === 'app-check', `sem token -> ${JSON.stringify(semToken.error ?? semToken.result).slice(0, 160)}`);
      check(/pessoa/.test(semToken.error.message) && /you are a person/.test(semToken.error.message), `mensagem: ${semToken.error.message}`);
      check(!(await authEmails()).has(robo.email), 'o cadastro sem token criou conta no Auth');
      check((await used()) === before && (await slotCount()) === slotsBefore, 'o cadastro sem token mexeu nas vagas');
      const pessoa = novoCadastro();
      const comToken = await callFunction('createUserProfile', pessoa, undefined, { appCheck: fakeAppCheckToken() });
      check(comToken.result?.status === 'success', `com token -> ${JSON.stringify(comToken.error ?? comToken.result).slice(0, 160)}`);
      check((await used()) === before + 1 && (await slotCount()) === slotsBefore + 1, 'o cadastro com token não gastou exatamente 1 vaga');
    } finally {
      await setSignupAppCheck(false);
    }
  }, { tag: 'seg' });

  await soft('anti-robô LIGADO: checkAvailability (enumeração de e-mails e @) também exige o token', async () => {
    await setSignupAppCheck(true);
    try {
      const semToken = await callFunction('checkAvailability', { type: 'email', value: primeiro.email });
      check(semToken.error?.status === 'FAILED_PRECONDITION' && semToken.error.details?.reason === 'app-check', `sem token -> ${JSON.stringify(semToken.error ?? semToken.result).slice(0, 140)}`);
      const comToken = await callFunction('checkAvailability', { type: 'username', value: `livre${stamp}` }, undefined, { appCheck: fakeAppCheckToken() });
      check(comToken.result?.available === true, `com token -> ${JSON.stringify(comToken.error ?? comToken.result)}`);
    } finally {
      await setSignupAppCheck(false);
    }
  }, { tag: 'seg' });

  await soft('anti-robô LIGADO, Google: conta NOVA sem token é recusada e removida; outra com token entra; quem JÁ TEM perfil continua entrando sem token', async () => {
    await setSignupAppCheck(true);
    try {
      const before = await used();
      const nova = await novoGoogle('ar');
      const semToken = await callFunction('claimGoogleProfile', {}, nova.idToken);
      check(semToken.error?.status === 'FAILED_PRECONDITION' && semToken.error.details?.reason === 'app-check', `sem token -> ${JSON.stringify(semToken.error ?? semToken.result).slice(0, 160)}`);
      check(!(await profileOf(nova.localId)) && (await used()) === before, 'a recusa sem token criou perfil ou gastou vaga');
      await eventually(async () => !(await authUids()).has(nova.localId), {
        label: 'remoção da conta Google recusada pelo anti-robô',
      });
      const humana = await novoGoogle('ah');
      const comToken = await callFunction('claimGoogleProfile', {}, humana.idToken, { appCheck: fakeAppCheckToken() });
      check(comToken.result?.status === 'created', `com token -> ${JSON.stringify(comToken.error ?? comToken.result).slice(0, 160)}`);
      check((await used()) === before + 1, 'o Google com token não gastou exatamente 1 vaga');
      const existente = await callFunction('claimGoogleProfile', {}, google.idToken);
      check(existente.result?.status === 'exists', `quem já tem perfil, sem token -> ${JSON.stringify(existente.error ?? existente.result).slice(0, 140)}`);
    } finally {
      await setSignupAppCheck(false);
    }
  }, { tag: 'seg' });

  await soft('anti-robô DESLIGADO (estado de partida): o cadastro sem token funciona como antes', async () => {
    const before = await used();
    const resposta = await callFunction('createUserProfile', novoCadastro());
    check(resposta.result?.status === 'success', `sem token e anti-robô desligado -> ${JSON.stringify(resposta.error ?? resposta.result).slice(0, 160)}`);
    check((await used()) === before + 1, 'o contador não subiu exatamente 1');
  }, { tag: 'funcional' });

  await soft('na TELA, com o anti-robô ligado e um navegador sem token: aparece o aviso em português e nada é criado', async () => {
    await reabrir();
    await setSignupAppCheck(true);
    const context = await browser.newContext({ locale: 'pt-BR', serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/pt-BR/register`, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-testid="emulator-banner"][data-status="ok"]').waitFor({ timeout: 90_000 });
      const emailsBefore = await authEmails();
      await page.fill('#name', 'Pessoa Sem Token');
      await page.fill('#username', `sem${stamp}`.slice(0, 15));
      await page.fill('#email', `sem.token.${stamp}@example.test`);
      const aviso = page.getByTestId('human-check-failed');
      await aviso.waitFor({ timeout: 60_000 });
      const texto = await aviso.innerText();
      check(/pessoa/.test(texto), `aviso: ${texto.slice(0, 160)}`);
      await shot(page, 'cadastro-05-anti-robo-sem-token');
      check([...(await authEmails())].length === [...emailsBefore].length, 'a tela criou conta no Auth sem o token');
    } finally {
      await context.close();
      await setSignupAppCheck(false);
    }
  }, { tag: 'ux' });

  await soft('corrida: 30 cadastros SIMULTÂNEOS para 10 vagas entram EXATAMENTE 10, os outros 20 recebem "vagas preenchidas" e ninguém fica órfão', async () => {
    const slotsBefore = await slotCount();
    await seedSignupControl({ limit: 500, used: 490 });
    const tentativas = Array.from({ length: 30 }, () => novoCadastro());
    const resultados = await Promise.all(tentativas.map((payload) => callFunction('createUserProfile', payload)));
    const entraram = resultados.filter((r) => r.result?.status === 'success');
    const recusados = resultados.filter(closed);
    const outros = resultados.filter((r) => !(r.result?.status === 'success') && !closed(r));
    check(entraram.length === 10, `entraram ${entraram.length} (esperado exatamente 10); outros erros: ${JSON.stringify(outros.map((r) => r.error?.status))}`);
    check(recusados.length === 20, `recusados por lotação: ${recusados.length} (esperado 20); outros erros: ${JSON.stringify(outros.map((r) => r.error?.status))}`);
    check((await used()) === 500, `usadas = ${await used()} (esperado 500)`);
    check((await slotCount()) === slotsBefore + 10, `vagas registradas: ${await slotCount()} (esperado ${slotsBefore + 10})`);
    const emails = await authEmails();
    const contas = tentativas.filter((payload) => emails.has(payload.email)).length;
    check(contas === 10, `contas que ficaram no Auth: ${contas} (esperado 10, as de quem entrou)`);
    await reabrir();
    return `10 entraram, 20 recusados`;
  }, { tag: 'funcional' });

  // ---------------------------------------------------------------------------------------------------------------
  // Contas de robô ou da casa (a Mariana, por exemplo) não ocupam vaga das PESSOAS: a vaga fica marcada como isenta e
  // `used` só conta as pessoas. Só o script administrativo isenta (o cliente e as Functions de cadastro não conseguem).
  section('cadastro: contas isentas (robôs e da casa) não gastam vaga das pessoas');
  const rodar = (...args) => {
    try {
      const output = execFileSync(process.execPath, [path.join('scripts', 'inicializar-limite-cadastro.mjs'), ...args], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { code: 0, output };
    } catch (error) {
      return { code: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }
  };
  const slotDe = async (uid) => (await signupSlots()).find((slot) => slot.__id === uid);
  await soft('isentar exige o motivo, recusa valores inválidos e o plano (sem --aplicar) não grava nada', async () => {
    // Outras seções da suíte integral criam perfis administrativos sem passar
    // pelo cadastro. Reconcilia esse legado antes de medir o efeito isolado da
    // isenção; caso contrário o mesmo comando registra essas vagas pendentes e
    // o total pode subir mesmo tendo retirado C da contagem.
    const reconciliado = rodar('--aplicar');
    check(reconciliado.code === 0, `reconciliação inicial: ${reconciliado.output.slice(-220)}`);
    await reabrir();
    const antes = JSON.stringify({ slots: await signupSlots(), control: await signupControl() });
    check(rodar(`--isentar=${C.uid}`).code === 2, '--isentar sem --motivo deveria sair com código 2');
    check(rodar('--exigir-app-check=talvez').code === 2, '--exigir-app-check=talvez deveria sair com código 2');
    check(rodar(`--isentar=${C.uid}`, `--desisentar=${C.uid}`, '--motivo=x').code === 2, 'o mesmo uid nos dois lados deveria sair com código 2');
    const plano = rodar(`--isentar=${C.uid}`, '--motivo=robô de teste');
    check(plano.code === 0 && /ISENTAR/.test(plano.output) && /\(nada foi gravado\)/.test(plano.output), `plano: ${plano.output.slice(0, 220)}`);
    check(JSON.stringify({ slots: await signupSlots(), control: await signupControl() }) === antes, 'o plano gravou alguma coisa');
  }, { tag: 'funcional' });

  await soft('isentar uma conta: a vaga fica marcada, usadas cai 1, o motivo fica registrado e rodar de novo não muda nada', async () => {
    const antes = await used();
    const aplicado = rodar(`--isentar=${C.uid}`, '--motivo=robô de teste', '--aplicar');
    check(aplicado.code === 0 && /conferido: limite 500/.test(aplicado.output) && /1 isenta/.test(aplicado.output), `aplicar: ${aplicado.output.slice(-260)}`);
    const slot = await slotDe(C.uid);
    check(slot?.exempt === true && slot.exemptReason === 'robô de teste', `vaga: ${JSON.stringify(slot)}`);
    check((await used()) === antes - 1, `usadas ${await used()} (esperado ${antes - 1})`);
    check(await profileOf(C.uid), 'isentar apagou o perfil');
    const repetido = rodar(`--isentar=${C.uid}`, '--motivo=robô de teste', '--aplicar');
    check(repetido.code === 0 && /nada a mudar/.test(repetido.output), `2ª execução: ${repetido.output.slice(-160)}`);
    check(rodar('--conferir').code === 0, '--conferir deveria passar com uma vaga isenta');
  }, { tag: 'funcional' });

  await soft('com o cadastro LOTADO, isentar um robô abre UMA vaga para uma pessoa e o cadastro fecha de novo', async () => {
    // C está isenta (teste anterior): usadas = P, só as pessoas. Devolve C à contagem e fecha o cadastro com o limite
    // igual às usadas (P + 1): o cadastro está lotado COM o robô contando.
    const contadas = await used();
    check(rodar(`--desisentar=${C.uid}`, `--limite=${contadas + 1}`, '--aplicar').code === 0, 'não consegui fechar o cadastro com o robô contando');
    check((await used()) === contadas + 1, `usadas ${await used()} (esperado ${contadas + 1})`);
    const lotado = await callFunction('createUserProfile', novoCadastro());
    check(closed(lotado), `lotado com o robô contando -> ${lotado.error?.status ?? 'aceito'}`);
    // Isentar o robô tira a vaga dele da contagem: sobra UMA vaga e uma pessoa entra; a seguinte já encontra fechado.
    check(rodar(`--isentar=${C.uid}`, '--motivo=robô de teste', '--aplicar').code === 0, 'não consegui isentar o robô');
    check((await used()) === contadas, `depois de isentar, usadas ${await used()} (esperado ${contadas})`);
    const entrou = await callFunction('createUserProfile', novoCadastro());
    check(entrou.result?.status === 'success', `uma pessoa depois de isentar o robô -> ${JSON.stringify(entrou.error ?? entrou.result).slice(0, 160)}`);
    const fechou = await callFunction('createUserProfile', novoCadastro());
    check(closed(fechou), `a segunda pessoa -> ${fechou.error?.status ?? 'aceito'} (esperado fechado)`);
  }, { tag: 'funcional' });

  await soft('o interruptor do anti-robô pelo script: ligar grava requireAppCheck, desligar também, e o cliente não consegue mexer', async () => {
    check(rodar('--exigir-app-check=sim', '--aplicar').code === 0, 'não consegui ligar');
    check((await signupControl()).requireAppCheck === true, 'requireAppCheck não ficou true');
    const tokenA = await ctx.token(A);
    const cliente = await fsUpdate('_signup/control', { requireAppCheck: false }, tokenA);
    check(denied(cliente), `um cliente conseguiu mexer no interruptor (HTTP ${cliente.status})`);
    check(rodar('--exigir-app-check=nao', '--aplicar').code === 0, 'não consegui desligar');
    check((await signupControl()).requireAppCheck === false, 'requireAppCheck não ficou false');
  }, { tag: 'seg' });

  await soft('limpeza das isenções: tudo volta ao estado de partida (limite 500, ninguém isento, anti-robô desligado)', async () => {
    check(rodar(`--desisentar=${C.uid}`, '--limite=500', '--exigir-app-check=nao', '--aplicar').code === 0, 'a limpeza falhou');
    const control = await signupControl();
    check(control.limit === 500 && control.requireAppCheck === false, `controle: ${JSON.stringify(control)}`);
    check(!(await signupSlots()).some((slot) => slot.exempt === true), 'sobrou vaga isenta');
    check(rodar('--conferir').code === 0, '--conferir deveria passar');
  }, { tag: 'funcional' });

  // ---------------------------------------------------------------------------------------------------------------
  section('cadastro: regras do Firestore contra a criação direta pelo cliente');
  const attacker = await signUpRest(`atacante.${stamp}@example.test`);
  const attackerToken = attacker.idToken;
  const attackerUid = attacker.localId;
  // Tudo isto era PERMITIDO pelas regras antigas (perfil e @ do próprio uid, dados pessoais do próprio e-mail).
  const profileFields = (username) => ({
    name: 'Atacante', name_lowercase: 'atacante', username, avatarUrl: '/profile.png', 'data-ai-hint': 'x', bio: '',
    followersCount: 0, followingCount: 0, postsCount: 0, dmPreference: 'everyone', isAdmin: false, isModerator: false,
    createdAt: new Date(), profileVisibility: 'public', allowTagging: 'everyone', pinnedPostId: null, coverImageUrl: null, 'cover-image-ai-hint': null,
  });
  const negar = (nome, chamada) => soft(nome, async () => {
    const response = await chamada();
    check(denied(response), `a operação foi PERMITIDA (HTTP ${response.status})`);
    return `recusado (HTTP ${response.status})`;
  }, { tag: 'seg' });

  await negar('conta só-Auth cria o PRÓPRIO perfil direto (users/{uid}) — recusado', () => fsCreate('users', attackerUid, profileFields(`atk${stamp}`), attackerToken));
  await negar('conta só-Auth cria um @ direto (usernames/{nome}) — recusado', () => fsCreate('usernames', `atk${stamp}`, { userId: attackerUid }, attackerToken));
  await negar('conta só-Auth cria os dados pessoais direto (private/account, sem vaga) — recusado', () =>
    fsSet(`users/${attackerUid}/private/account`, { email: attacker.email, displaySensitiveContent: false, createdAt: new Date() }, attackerToken));
  await negar('conta só-Auth grava o próprio documento de vaga (_signup/control/slots/{uid}) — recusado', () =>
    fsSet(`_signup/control/slots/${attackerUid}`, { number: 1, provider: 'password', createdAt: new Date() }, attackerToken));
  await negar('conta só-Auth LÊ o documento de controle (contadores) — recusado', () => fsCall('GET', '_signup/control', { token: attackerToken }));
  await negar('conta só-Auth ALTERA o contador (_signup/control.used = 0) — recusado', () => fsSet('_signup/control', { limit: 500, used: 0 }, attackerToken));
  await negar('sem login, ler o documento de controle — recusado', () => fsCall('GET', '_signup/control', {}));

  const tokenA = await ctx.token(A);
  await negar('quem tem conta cria um @ extra (usernames/{outro}) para si — recusado (antes dava para juntar vários @)', () =>
    fsCreate('usernames', `extra${stamp}`, { userId: A.uid }, tokenA));
  await negar('quem tem conta apaga o próprio @ (usernames/{@}) — recusado (antes liberava o nome para outra pessoa)', () =>
    fsDelete(`usernames/${A.username.toLowerCase()}`, tokenA));
  await negar('quem tem conta mexe no contador de vagas — recusado', () => fsSet('_signup/control', { limit: 9999, used: 0 }, tokenA));
  await negar('quem tem conta cria um SEGUNDO perfil para outro UID — recusado', () => fsCreate('users', `outro_${stamp}`, profileFields(`seg${stamp}`), tokenA));

  await soft('controle: quem TEM vaga continua atualizando os dados pessoais e pode recriá-los se faltarem', async () => {
    const update = await fsUpdate(`users/${A.uid}/private/account`, { displaySensitiveContent: true }, tokenA);
    check(update.status === 200, `atualizar os dados pessoais -> HTTP ${update.status}`);
    await fsDelete(`users/${A.uid}/private/account`, 'owner');
    const recreate = await fsSet(`users/${A.uid}/private/account`, { email: A.email, displaySensitiveContent: false, createdAt: new Date() }, tokenA);
    check(recreate.status === 200, `recriar os dados pessoais (tem vaga) -> HTTP ${recreate.status}`);
  }, { tag: 'funcional' });

  await soft('SDK do Firebase de verdade (o mesmo do app): criar perfil, @ e controle direto dá permission-denied', async () => {
    const { initializeApp, deleteApp } = await import('firebase/app');
    const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut } = await import('firebase/auth');
    const { initializeFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, terminate } = await import('firebase/firestore');
    const app = initializeApp({ apiKey: 'demo-api-key', projectId: PROJECT, appId: '1:000000000000:web:0000000000000000' }, `cadastro-sdk-${stamp}`);
    const auth = getAuth(app);
    connectAuthEmulator(auth, EMU.auth, { disableWarnings: true });
    const firestore = initializeFirestore(app, {}, DATABASE);
    connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
    const outcomes = [];
    try {
      // O emulador de Auth pode reiniciar a conexão quando várias exclusões
      // disparam Functions ao mesmo tempo. Repete apenas esse transporte, com
      // um e-mail descartável novo; a prova aqui é das regras do Firestore.
      let credential;
      let lastAuthError;
      for (let attempt = 1; attempt <= 5 && !credential; attempt++) {
        try {
          credential = await createUserWithEmailAndPassword(auth, `sdk.${attempt}.${stamp}@example.test`, SENHA);
        } catch (error) {
          lastAuthError = error;
          if (error?.code !== 'auth/network-request-failed') throw error;
          await new Promise((resolve) => setTimeout(resolve, attempt * 250));
        }
      }
      if (!credential) throw lastAuthError;
      const uid = credential.user.uid;
      const attempts = {
        'users/{uid}': () => setDoc(doc(firestore, 'users', uid), profileFields(`sdk${stamp}`)),
        'usernames/{nome}': () => setDoc(doc(firestore, 'usernames', `sdk${stamp}`), { userId: uid }),
        'private/account': () => setDoc(doc(firestore, 'users', uid, 'private', 'account'), { email: credential.user.email, createdAt: new Date() }),
        '_signup/control (gravar)': () => setDoc(doc(firestore, '_signup', 'control'), { limit: 500, used: 0 }),
        '_signup/control (ler)': () => getDoc(doc(firestore, '_signup', 'control')),
      };
      for (const [name, attempt] of Object.entries(attempts)) {
        try {
          await attempt();
          outcomes.push(`${name}: PERMITIDO`);
        } catch (error) {
          if (error?.code !== 'permission-denied') outcomes.push(`${name}: erro inesperado (${error?.code ?? error})`);
        }
      }
      await signOut(auth);
    } finally {
      await terminate(firestore).catch(() => {});
      await deleteApp(app).catch(() => {});
    }
    check(outcomes.length === 0, outcomes.join('; '));
    return '5 tentativas diretas, todas permission-denied';
  }, { tag: 'seg' });

  // ---------------------------------------------------------------------------------------------------------------
  section('cadastro: script de migração do limite (idempotente)');
  const script = (...args) => {
    try {
      const output = execFileSync(process.execPath, [path.join('scripts', 'inicializar-limite-cadastro.mjs'), ...args], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { code: 0, output };
    } catch (error) {
      return { code: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }
  };
  const legacyIds = [`legado_a_${stamp}`, `legado_b_${stamp}`];
  await soft('perfis antigos sem vaga: o plano (sem --aplicar) não grava, --conferir acusa a divergência e --aplicar reconcilia', async () => {
    for (const [index, id] of legacyIds.entries()) {
      await fsSet(`users/${id}`, { name: `Legado ${index}`, username: `legado${index}${stamp}`, createdAt: new Date(Date.now() - (10 - index) * 86_400_000) }, 'owner');
    }
    const slotsBefore = await slotCount();
    const controlBefore = await signupControl();
    const plan = script();
    check(plan.code === 0 && /2 vaga\(s\) a registrar/.test(plan.output), `plano: ${plan.output.slice(0, 200)}`);
    check((await slotCount()) === slotsBefore && JSON.stringify(await signupControl()) === JSON.stringify(controlBefore), 'o plano gravou alguma coisa');
    check(script('--conferir').code === 1, '--conferir deveria sair com código 1 (há divergência)');
    const applied = script('--aplicar');
    check(applied.code === 0 && /conferido: limite 500/.test(applied.output), `aplicar: ${applied.output.slice(-240)}`);
    check((await slotCount()) === slotsBefore + 2, 'não registrou as 2 vagas');
    const slots = await signupSlots();
    check(legacyIds.every((id) => slots.some((slot) => slot.__id === id && slot.provider === 'migration')), 'as vagas migradas não aparecem como "migration"');
    check(new Set(slots.map((slot) => slot.number)).size === slots.length, 'a migração repetiu um número de vaga');
    const control = await signupControl();
    check(control.used === slots.length, `usadas (${control.used}) difere das vagas (${slots.length})`);
    return `usadas ${control.used}`;
  }, { tag: 'funcional' });
  await soft('rodar a migração de novo não muda nada (idempotente) e --conferir passa', async () => {
    const before = JSON.stringify({ slots: await signupSlots(), control: await signupControl() });
    const second = script('--aplicar');
    check(second.code === 0 && /nada a mudar/.test(second.output), `2ª execução: ${second.output.slice(-200)}`);
    check(script('--conferir').code === 0, '--conferir deveria sair com código 0');
    check(JSON.stringify({ slots: await signupSlots(), control: await signupControl() }) === before, 'a 2ª execução alterou dados');
  }, { tag: 'funcional' });
  await soft('as vagas são históricas também para a migração: apagar o perfil NÃO apaga a vaga nem muda o contador', async () => {
    const before = await used();
    for (const id of legacyIds) await fsDelete(`users/${id}`, 'owner');
    const run = script('--aplicar');
    check(run.code === 0 && /nada a mudar/.test(run.output), `depois de apagar os perfis: ${run.output.slice(-200)}`);
    check((await used()) === before, 'apagar o perfil mudou o contador');
    const slots = await signupSlots();
    check(legacyIds.every((id) => slots.some((slot) => slot.__id === id)), 'a vaga de um perfil apagado foi removida');
  }, { tag: 'funcional' });

  // Deixa o controle coerente (limite 500, usadas = vagas registradas) para quem rodar depois.
  await soft('limpeza: o controle volta a ser coerente (limite 500, usadas = vagas registradas)', async () => {
    await seedSignupControl({ limit: 500, used: await slotCount() });
    const control = await signupControl();
    check(control.used === (await slotCount()) && control.limit === 500, `controle: ${JSON.stringify(control)}`);
    check(baseUsed >= 3, 'estado inicial inesperado');
  }, { tag: 'funcional' });
}
