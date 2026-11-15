/**
 * Seção "vibracao": o celular vibra LEVEMENTE nas ações da pessoa, no navegador do celular (Vibration API) e no WebView do
 * app (que oferece a mesma API; o plugin nativo só entra no APK novo).
 *
 * Não existe motor de vibração num teste: o navegador de teste recebe um `navigator.vibrate` falso que só anota o que
 * foi pedido. Conferimos o que a pessoa SENTIRIA, num celular simulado (tela de 412x915 com toque):
 *   - curtir vibra UMA vez, no padrão de curtida (e o tique genérico do toque não repete por cima);
 *   - um botão comum vibra um tique curto; rolar a tela por cima de um botão não vibra; o mouse não vibra;
 *   - ligar/desligar em Configurações vale na hora, e religar já dá um toque para a pessoa sentir o que ligou;
 *   - comentar com sucesso termina com o padrão de "deu certo".
 */
import { adminFind, createPostViaUi, eventually, loginViaUi } from '../lib/harness.mjs';
import { dedo } from '../lib/touch.mjs';

// Os padrões de src/lib/haptics.ts (WEB_PATTERNS). Se mudarem lá, mudam aqui: o teste existe para acusar a mudança.
const TAP = 14;
const SELECT = 10;
const LIKE = [10, 40, 16];
const SUCCESS = [12, 50, 12];

export async function run(ctx) {
  const { runner, users, BASE_URL, stamp, browser, shot } = ctx;
  const { a: A } = users;
  const { section, step, soft, check } = runner;

  section('vibracao: celular simulado');
  let postId;
  let context;
  let page;
  const vibes = () => page.evaluate(() => window.__vibes.slice());
  const limpar = () => page.evaluate(() => { window.__vibes.length = 0; });
  /** Espera o que o celular fosse pedir de vibração assentar (os toques disparam em poucos ms) e devolve o que foi pedido. */
  const sentido = async () => { await page.waitForTimeout(350); return vibes(); };
  const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const postLike = 'main button:has(svg.lucide-heart)';

  await step('A publica um post; o celular de A (tela 412x915, com toque) entra e abre o post', async () => {
    await A.page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await createPostViaUi(A.page, `Post para vibrar ${stamp}`);
    postId = (await eventually(async () => (await adminFind('posts', { userId: A.uid })).find((p) => String(p.text).includes(`vibrar ${stamp}`)), { label: 'post de A' })).__id;
    context = await browser.newContext({
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 2.625,
      hasTouch: true,
      isMobile: true,
      locale: 'pt-BR',
      serviceWorkers: 'block',
      userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    });
    // `navigator.vibrate` falso: anota cada pedido de vibração (é o que o motor do celular receberia).
    await context.addInitScript(() => {
      window.__vibes = [];
      Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, writable: true, value(pattern) { window.__vibes.push(pattern); return true; } });
    });
    page = await context.newPage();
    page.setDefaultTimeout(60_000);
    await loginViaUi(page, BASE_URL, A);
    await page.goto(`${BASE_URL}/pt-BR/post/${postId}`, { waitUntil: 'domcontentloaded' });
    await page.locator(postLike).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    const suporte = await page.evaluate(() => ({ vibrate: typeof navigator.vibrate, toque: navigator.maxTouchPoints }));
    check(suporte.vibrate === 'function' && suporte.toque > 0, `o celular simulado precisa de vibrate e de toque: ${JSON.stringify(suporte)}`);
    await limpar();
    return `post ${postId}`;
  });

  section('vibracao: o que a pessoa sente');
  await soft('curtir vibra UMA vez, no padrão de curtida (o tique do toque não repete por cima)', async () => {
    await limpar();
    await page.locator(postLike).first().tap();
    const pedidos = await sentido();
    check(igual(pedidos, [LIKE]), `vibrações pedidas: ${JSON.stringify(pedidos)} (esperado ${JSON.stringify([LIKE])})`);
  }, { tag: 'ux' });

  await soft('descurtir é só um tique leve (e também uma vez)', async () => {
    await limpar();
    await page.locator(postLike).first().tap();
    const pedidos = await sentido();
    check(igual(pedidos, [TAP]), `vibrações pedidas: ${JSON.stringify(pedidos)} (esperado ${JSON.stringify([TAP])})`);
  }, { tag: 'ux' });

  await soft('um botão comum (comentar) vibra um tique curto; o mouse no mesmo botão não vibra', async () => {
    const botao = page.locator('main button:has(svg.lucide-message-circle)').first();
    await limpar();
    await botao.tap();
    const toque = await sentido();
    check(igual(toque, [TAP]), `com o dedo: ${JSON.stringify(toque)} (esperado ${JSON.stringify([TAP])})`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await limpar();
    await botao.click(); // o Playwright clica com o MOUSE (pointerType "mouse"), não com o dedo
    const mouse = await sentido();
    check(mouse.length === 0, `com o mouse: ${JSON.stringify(mouse)} (esperado nenhuma vibração)`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }, { tag: 'ux' });

  await soft('rolar a tela com o dedo começando em cima de um botão NÃO vibra', async () => {
    const botao = page.locator(postLike).first();
    const caixa = await botao.boundingBox();
    check(caixa, 'botão de curtir não encontrado');
    await limpar();
    const cdp = await context.newCDPSession(page);
    // Dedo de verdade (toques nativos, veja lib/touch.mjs): sobe 120 px a partir do centro do botão.
    await dedo(cdp, { x: caixa.x + caixa.width / 2, y: caixa.y + caixa.height / 2, dy: -120, speed: 600 });
    const pedidos = await sentido();
    check(pedidos.length === 0, `rolar a tela vibrou: ${JSON.stringify(pedidos)}`);
    await cdp.detach();
  }, { tag: 'ux' });

  await soft('desligar em Configurações vale na hora: depois disso nada vibra, nem curtir', async () => {
    await page.goto(`${BASE_URL}/pt-BR/settings/notifications`, { waitUntil: 'domcontentloaded' });
    const chave = page.locator('#haptics-switch');
    await chave.waitFor({ timeout: 60_000 });
    check((await chave.getAttribute('aria-checked')) === 'true', 'a vibração deveria começar LIGADA');
    await chave.tap(); // desliga
    await page.waitForTimeout(300);
    check((await chave.getAttribute('aria-checked')) === 'false', 'a chave não desligou');
    check((await page.evaluate(() => localStorage.getItem('exelula:haptics'))) === 'off', 'a preferência não foi guardada');
    await page.goto(`${BASE_URL}/pt-BR/post/${postId}`, { waitUntil: 'domcontentloaded' });
    await page.locator(postLike).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    await limpar();
    await page.locator(postLike).first().tap();
    const pedidos = await sentido();
    check(pedidos.length === 0, `com a vibração desligada ainda vibrou: ${JSON.stringify(pedidos)}`);
  }, { tag: 'funcional' });

  await soft('religar dá um toque na hora (a pessoa sente o que ligou) e a vibração volta', async () => {
    await page.goto(`${BASE_URL}/pt-BR/settings/notifications`, { waitUntil: 'domcontentloaded' });
    const chave = page.locator('#haptics-switch');
    await chave.waitFor({ timeout: 60_000 });
    check((await chave.getAttribute('aria-checked')) === 'false', 'a vibração deveria continuar DESLIGADA');
    await limpar();
    await chave.tap(); // liga
    const pedidos = await sentido();
    check(igual(pedidos, [SELECT]), `ao religar: ${JSON.stringify(pedidos)} (esperado ${JSON.stringify([SELECT])})`);
    check((await page.evaluate(() => localStorage.getItem('exelula:haptics'))) === 'on', 'a preferência não foi guardada');
  }, { tag: 'funcional' });

  await soft('comentar com sucesso termina com o padrão de "deu certo"', async () => {
    await page.goto(`${BASE_URL}/pt-BR/post/${postId}`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Escreva um comentário...').first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    await page.getByText('Escreva um comentário...').first().tap();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByPlaceholder('Escreva um comentário...').fill(`Comentário que vibra ${stamp}`);
    await limpar();
    await dialog.getByRole('button', { name: 'Responder', exact: true }).tap();
    await dialog.waitFor({ state: 'detached', timeout: 60_000 });
    await page.waitForTimeout(500);
    const pedidos = await vibes();
    await shot(page, 'vibracao-01-comentario-enviado');
    check(igual(pedidos[0], TAP), `o toque no botão deveria dar o tique curto primeiro: ${JSON.stringify(pedidos)}`);
    check(igual(pedidos[pedidos.length - 1], SUCCESS), `o fim deveria ser o padrão de sucesso: ${JSON.stringify(pedidos)}`);
  }, { tag: 'ux' });

  await context?.close().catch(() => {});
}
