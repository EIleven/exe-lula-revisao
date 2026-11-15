/**
 * Seção "conta": recuperação de senha e verificação de e-mail pela interface real, conferidas no emulador de Auth (que
 * guarda os links "enviados" em /emulator/v1/projects/{p}/oobCodes). A verificação em duas etapas por app autenticador
 * (TOTP) não roda no emulador (ele só implementa o segundo fator por SMS): é testada no projeto real, com conta
 * descartável.
 */
import { EMU, PROJECT, eventually, loginViaUi, newUser, registerViaUi } from '../lib/harness.mjs';

export async function run(ctx) {
  const { runner, users, BASE_URL, shot, browser } = ctx;
  const { a: A, c: C } = users;
  const { section, soft, check } = runner;
  const oobCodes = async (email, requestType) => {
    const response = await fetch(`${EMU.auth}/emulator/v1/projects/${PROJECT}/oobCodes`);
    const { oobCodes: codes = [] } = await response.json();
    return codes.filter((code) => code.email === email && code.requestType === requestType);
  };

  // ---------------------------------------------------------------------------------------------------------------
  section('conta: e-mail e senha');
  await soft('o cadastro envia o e-mail de verificação', async () => {
    const codes = await eventually(async () => {
      const found = await oobCodes(A.email, 'VERIFY_EMAIL');
      return found.length > 0 ? found : null;
    }, { label: 'link de verificação de A no emulador', timeoutMs: 15_000 });
    return `${codes.length} link(s)`;
  });
  await soft('"Esqueceu a senha?" envia o link de nova senha, e um e-mail sem conta recebe a MESMA resposta', async () => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const ask = async (email) => {
        await page.goto(`${BASE_URL}/pt-BR/login`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'Esqueceu a senha?' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('E-mail').fill(email);
        await dialog.getByRole('button', { name: 'Enviar link' }).click();
        await dialog.getByText('Confira o seu e-mail').waitFor({ timeout: 30_000 });
      };
      const before = (await oobCodes(C.email, 'PASSWORD_RESET')).length;
      await ask(C.email);
      await shot(page, 'conta-01-link-de-senha');
      await eventually(async () => (await oobCodes(C.email, 'PASSWORD_RESET')).length > before, { label: 'link de nova senha de C' });
      await ask(`ninguem.${Date.now()}@example.test`); // sem conta: mesma tela, sem revelar nada
    } finally {
      await context.close();
    }
  });

  // ---------------------------------------------------------------------------------------------------------------
  section('conta: verificação de e-mail e duas etapas nas configurações');
  await soft('conta pendente reenvia o link, confirma e passa a "E-mail verificado"', async () => {
    const context = await browser.newContext({ locale: 'pt-BR', serviceWorkers: 'block' });
    const pending = newUser('verify', Date.now().toString(36));
    try {
      const page = await context.newPage();
      await registerViaUi(page, BASE_URL, pending, { confirmEmail: false });
      await page.getByText('Confirme seu e-mail').first().waitFor({ timeout: 60_000 });
      const before = (await oobCodes(pending.email, 'VERIFY_EMAIL')).length;
      await page.getByRole('button', { name: 'Reenviar e-mail' }).click();
      const codes = await eventually(async () => {
        const found = await oobCodes(pending.email, 'VERIFY_EMAIL');
        return found.length > before ? found : null;
      }, { label: 'novo link de verificação' });
      const opened = await fetch(codes[codes.length - 1].oobLink);
      check(opened.ok, `o link de verificação respondeu HTTP ${opened.status}`);
      await page.getByRole('button', { name: /J[aá] confirmei/ }).click();
      await page.goto(`${BASE_URL}/pt-BR/settings/privacy`, { waitUntil: 'domcontentloaded' });
      await page.getByText('E-mail verificado').first().waitFor({ timeout: 30_000 });
      await shot(page, 'conta-02-email-verificado');
    } finally {
      await context.close();
    }
  });
  await soft('com o e-mail verificado, o botão de ativar a verificação em duas etapas fica disponível', async () => {
    await A.page.goto(`${BASE_URL}/pt-BR/settings/privacy`, { waitUntil: 'domcontentloaded' });
    const enable = A.page.getByRole('button', { name: 'Ativar' });
    await enable.waitFor({ timeout: 30_000 });
    check(await enable.isEnabled(), 'o botão "Ativar" continua desabilitado');
  }, { tag: 'ux' });

  // Antes o cadastro e o login (com "Lembrar de mim" desmarcado por padrão) guardavam a sessão só na aba em que a
  // pessoa entrou: um post ou perfil aberto em outra aba aparecia como visitante.
  section('conta: sessão em outras abas');
  await soft('depois do cadastro, uma aba nova já abre logada', async () => {
    const tab = await A.context.newPage();
    try {
      await tab.goto(`${BASE_URL}/pt-BR/settings/privacy`, { waitUntil: 'domcontentloaded' });
      await tab.getByText('E-mail verificado').first().waitFor({ timeout: 60_000 });
    } finally {
      await tab.close();
    }
  }, { tag: 'ux' });
  await soft('depois do login pela tela ("Lembrar de mim" vem marcado), uma aba nova já abre logada', async () => {
    const context = await browser.newContext({ locale: 'pt-BR', serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      await loginViaUi(page, BASE_URL, C);
      const tab = await context.newPage();
      await tab.goto(`${BASE_URL}/pt-BR/settings/privacy`, { waitUntil: 'domcontentloaded' });
      await tab.getByText('E-mail verificado').first().waitFor({ timeout: 60_000 });
    } finally {
      await context.close();
    }
  }, { tag: 'ux' });
  // Antes "?redirect=" aceitava qualquer endereço: depois do login de verdade a pessoa ia parar num site falso.
  await soft('depois de entrar, "?redirect=" só leva a páginas do próprio site (sem redirecionamento aberto)', async () => {
    const loginWithRedirect = async (redirect) => {
      const context = await browser.newContext({ locale: 'pt-BR', serviceWorkers: 'block' });
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/pt-BR/login?redirect=${encodeURIComponent(redirect)}`, { waitUntil: 'domcontentloaded' });
        await page.locator('[data-testid="emulator-banner"][data-status="ok"]').waitFor({ timeout: 90_000 });
        await page.fill('#email', C.email);
        await page.fill('#password', C.password);
        await page.getByRole('button', { name: 'Entrar', exact: true }).click();
        await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 60_000 });
        return new URL(page.url());
      } finally {
        await context.close();
      }
    };
    const site = new URL(BASE_URL).origin;
    for (const outside of ['https://example.org/entrar-de-novo', '//example.org/entrar-de-novo', '/\t/example.org/entrar-de-novo']) {
      const landed = await loginWithRedirect(outside);
      check(landed.origin === site, `${JSON.stringify(outside)} levou para ${landed.origin}`);
    }
    const inside = await loginWithRedirect('/pt-BR/settings/privacy');
    check(inside.origin === site && inside.pathname === '/pt-BR/settings/privacy', `o redirect interno levou para ${inside.href}`);
  }, { tag: 'seg' });
}
