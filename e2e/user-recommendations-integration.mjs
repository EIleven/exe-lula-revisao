#!/usr/bin/env node
/**
 * Integração real da descoberta contra os emuladores: cria quatro contas descartáveis e uma pequena rede social:
 * B segue A; A segue D; D segue C. Para A, B deve ser explicado como "Segue você", C como conexão em comum e D nunca
 * pode aparecer porque A já o segue. Ao seguir B pela sugestão, o cartão deve sair da lista.
 */
import {
  authAccounts,
  fsSet,
  loadPlaywright,
  newUser,
  registerViaUi,
  resetEmulators,
} from './lib/harness.mjs';

const BASE_URL = (process.env.E2E_BASE_URL ?? 'http://localhost:9005').replace(/\/+$/, '');
const stamp = Date.now().toString(36);
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER, headless: true });
const users = {};
const pageErrors = [];

const relationship = async (followerId, followedId) => {
  const now = new Date();
  const [following, follower] = await Promise.all([
    fsSet(`users/${followerId}/following/${followedId}`, { userId: followedId, createdAt: now }, 'owner'),
    fsSet(`users/${followedId}/followers/${followerId}`, { userId: followerId, createdAt: now }, 'owner'),
  ]);
  if (following.status !== 200 || follower.status !== 200) {
    throw new Error(`não foi possível criar relação ${followerId} -> ${followedId}`);
  }
};

try {
  await resetEmulators();
  for (const label of ['a', 'b', 'c', 'd']) {
    const user = newUser(label, stamp);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', serviceWorkers: 'block' });
    await context.addInitScript(() => sessionStorage.setItem('pwa_install_banner_dismissed', 'true'));
    const page = await context.newPage();
    page.setDefaultTimeout(90_000);
    page.on('pageerror', (error) => pageErrors.push(`${label}: ${error.message}`));
    await registerViaUi(page, BASE_URL, user);
    const account = (await authAccounts()).find((item) => item.email === user.email);
    if (!account) throw new Error(`conta ${label} não apareceu no Auth`);
    users[label] = { ...user, uid: account.localId, context, page };
  }

  await relationship(users.b.uid, users.a.uid); // B segue A: reciprocidade.
  await relationship(users.a.uid, users.d.uid); // D já é seguido: deve ser excluído.
  await relationship(users.d.uid, users.c.uid); // C é seguido por D: uma conexão em comum.

  const page = users.a.page;
  await page.goto(`${BASE_URL}/pt-BR/explore`, { waitUntil: 'domcontentloaded' });
  await page.locator('#suggested-accounts-title').waitFor();

  const suggestions = page.locator('section[aria-labelledby="suggested-accounts-title"]');
  const profile = (uid) => suggestions.locator(`a[href="/pt-BR/profile/${uid}"]`).first();
  await profile(users.b.uid).waitFor();
  await profile(users.c.uid).waitFor();

  const cardText = async (uid) => profile(uid).locator('xpath=../..').innerText();
  const bText = await cardText(users.b.uid);
  const cText = await cardText(users.c.uid);
  if (!bText.includes('Segue você')) throw new Error(`motivo de B incorreto: ${bText}`);
  if (!cText.includes('1 conexão em comum')) throw new Error(`motivo de C incorreto: ${cText}`);
  if (await profile(users.d.uid).count()) throw new Error('D apareceu mesmo já sendo seguido por A');

  await profile(users.b.uid).locator('xpath=../..').getByTestId('follow-button').click();
  await profile(users.b.uid).waitFor({ state: 'detached' });
  const sidebarCopy = page.locator(`aside a[href="/pt-BR/profile/${users.b.uid}"]`);
  await sidebarCopy.waitFor({ state: 'detached' });

  await fsSet(`users/${users.c.uid}/blockedUsers/${users.a.uid}`, {
    userId: users.a.uid,
    createdAt: new Date(),
  }, 'owner');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#suggested-accounts-title').waitFor();
  await page.waitForTimeout(2000);
  if (await profile(users.c.uid).count()) throw new Error('C apareceu mesmo tendo bloqueado A');
  if (pageErrors.length) throw new Error(`pageErrors: ${pageErrors.join(' | ')}`);

  console.log('OK    reciprocidade explicada: "Segue você"');
  console.log('OK    conexão em comum explicada e priorizada');
  console.log('OK    conta já seguida não aparece');
  console.log('OK    seguir remove a conta do Explorar e da coluna direita');
  console.log('OK    quem bloqueou o usuário nunca é sugerido');
  console.log('OK    zero pageErrors');
} finally {
  await Promise.all(Object.values(users).map((user) => user.context.close().catch(() => {})));
  await browser.close();
}
