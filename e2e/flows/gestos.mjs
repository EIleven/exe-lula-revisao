/**
 * Seção "gestos": os gestos de toque de um celular (Samsung) e do app, num celular simulado (412x915, com toque). Os dedos
 * são sintetizados pelo próprio Chrome (CDP Input.synthesize*Gesture): eventos de toque de verdade chegam à página.
 *   - puxar para atualizar: um puxão curto NÃO atualiza; um longo "arma" (tique de vibração) e atualiza ao soltar; arrastar de
 *     lado (trocar de aba) não vira "puxar";
 *   - trocar de aba arrastando: só um gesto deliberado (70 px), não um esbarrão;
 *   - visualizador de imagem: pinça amplia, toque duplo amplia/volta, arrastar para baixo fecha;
 *   - voltar (botão ou gesto do Android): o primeiro "voltar" fecha o que está por cima; depois volta no histórico;
 *   - folha de baixo (repost no celular): puxar a alça para baixo fecha.
 * O gesto de voltar do sistema é acionado pelo evento `exelula:hardware-back` (o mesmo caminho do botão do Android).
 */
import { adminFind, eventually, loginViaUi, makePng } from '../lib/harness.mjs';
import { dedo } from '../lib/touch.mjs';

const HARDWARE_BACK = 'exelula:hardware-back';

export async function run(ctx) {
  const { runner, users, BASE_URL, stamp, browser, shot } = ctx;
  const { a: A } = users;
  const { section, step, soft, check } = runner;

  let postId;
  let context;
  let page;
  let cdp;
  const postText = `Post de gestos ${stamp}`;
  const IMAGEM = 'img[src*="127.0.0.1:9199"]';
  const vibes = () => page.evaluate(() => window.__vibes.slice());
  const ptr = () => page.evaluate(() => window.__ptr.slice());
  const limpar = () => page.evaluate(() => { window.__vibes.length = 0; window.__ptr.length = 0; });
  const calma = (ms = 400) => page.waitForTimeout(ms);
  /** Um dedo arrastando a partir de (x, y): positivo em yDistance = dedo PARA BAIXO; negativo em xDistance = dedo para a esquerda. */
  // Toques nativos (veja lib/touch.mjs): o gesto "touch" sintetizado do CDP entrega os eventos mas NÃO rola a página.
  const gesto = (x, y, { xDistance = 0, yDistance = 0, speed = 800, fling = false } = {}) => dedo(cdp, { x, y, dx: xDistance, dy: yDistance, speed, fling });
  // Um arrasto de lado de verdade é rápido (uns 0,3 s): lento, passaria dos 0,7 s que valem para trocar de aba.
  const arrastoDeLado = (x, y, xDistance) => gesto(x, y, { xDistance, speed: 1800, fling: true });
  const escala = async () => Number(await page.locator('[data-testid="image-viewer"]').getAttribute('data-scale'));
  const abaAtiva = async () => (await page.locator('[role="tab"][data-state="active"]').first().innerText()).trim();

  section('gestos: preparação');
  await step('A publica um post com imagem; o celular de A (412x915, com toque) entra e abre a página do post', async () => {
    await A.page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await A.page.getByRole('button', { name: 'Postar', exact: true }).first().click();
    const dialog = A.page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByPlaceholder('E aí?').fill(postText);
    await dialog.locator('input[type=file]').first().setInputFiles({ name: 'foto-gestos.png', mimeType: 'image/png', buffer: makePng(320, 200, [200, 80, 60]) });
    await dialog.locator('img').first().waitFor({ timeout: 30_000 });
    await dialog.locator('[data-status="uploading"]').waitFor({ state: 'detached', timeout: 60_000 });
    await dialog.getByRole('button', { name: 'Postar', exact: true }).click();
    await A.page.getByText('Post Enviado!').first().waitFor({ timeout: 90_000 });
    postId = (await eventually(async () => (await adminFind('posts', { userId: A.uid })).find((p) => String(p.text).includes(`gestos ${stamp}`)), { label: 'post de A' })).__id;

    context = await browser.newContext({
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 2.625,
      hasTouch: true,
      isMobile: true,
      locale: 'pt-BR',
      serviceWorkers: 'block',
      userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    });
    await context.addInitScript(() => {
      window.__vibes = [];
      Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, writable: true, value(pattern) { window.__vibes.push(pattern); return true; } });
      // Estados vistos do indicador de "puxar para atualizar" ("armado/atualizando"), em ordem.
      window.__ptr = [];
      const observar = () => {
        const el = document.querySelector('[data-testid="pull-to-refresh"]');
        if (!el) return;
        const estado = `${el.dataset.armed}/${el.dataset.refreshing}`;
        if (window.__ptr[window.__ptr.length - 1] !== estado) window.__ptr.push(estado);
      };
      new MutationObserver(observar).observe(document, { subtree: true, attributes: true, childList: true });
    });
    page = await context.newPage();
    page.setDefaultTimeout(60_000);
    await loginViaUi(page, BASE_URL, A);
    cdp = await context.newCDPSession(page);
    return `post ${postId}`;
  });

  // ---------------------------------------------------------------------------------------------------------------
  section('gestos: puxar para atualizar e trocar de aba (tela inicial)');
  await step('o celular abre a tela inicial no topo, com o indicador de atualizar', async () => {
    await page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="pull-to-refresh"]').first().waitFor({ state: 'attached', timeout: 60_000 });
    await page.getByText(postText).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    await limpar();
  });

  await soft('um puxão CURTO (100 px de dedo) não atualiza: o indicador desce e volta, sem armar', async () => {
    await limpar();
    await gesto(200, 220, { yDistance: 100 });
    await calma(700);
    const estados = await ptr();
    check(!estados.some((e) => e.endsWith('/true')), `atualizou com um puxão curto: ${JSON.stringify(estados)}`);
    check(!estados.some((e) => e.startsWith('true/')), `armou com um puxão curto: ${JSON.stringify(estados)}`);
    check((await vibes()).length === 0, `vibrou com um puxão curto: ${JSON.stringify(await vibes())}`);
  }, { tag: 'ux' });

  await soft('um puxão LONGO arma (tique de vibração ao cruzar o limiar), atualiza ao soltar (outro tique) e volta ao normal', async () => {
    await limpar();
    await gesto(200, 220, { yDistance: 330 });
    await eventually(async () => (await ptr()).some((e) => e.endsWith('/true')), { label: 'o indicador entrar em "atualizando"', timeoutMs: 8000 });
    const estados = await ptr();
    check(estados.some((e) => e.startsWith('true/')), `não armou antes de atualizar: ${JSON.stringify(estados)}`);
    const pedidos = await vibes();
    check(JSON.stringify(pedidos[0]) === JSON.stringify(10), `o 1º tique (ao armar) deveria ser o de seleção (10): ${JSON.stringify(pedidos)}`);
    check(pedidos.some((p, i) => i > 0 && p === 14), `faltou o tique ao soltar e atualizar: ${JSON.stringify(pedidos)}`);
    await eventually(async () => (await ptr()).at(-1) === 'false/false', { label: 'o indicador voltar ao normal', timeoutMs: 20_000 });
    await shot(page, 'gestos-01-depois-de-atualizar');
  }, { tag: 'ux' });

  await soft('arrastar DE LADO a partir do topo (trocar de aba) não vira "puxar": o indicador nem arma', async () => {
    await limpar();
    await arrastoDeLado(300, 240, -180);
    await calma(600);
    const estados = await ptr();
    check(!estados.some((e) => e.startsWith('true/') || e.endsWith('/true')), `um arrasto de lado virou puxar: ${JSON.stringify(estados)}`);
  }, { tag: 'ux' });

  await soft('trocar de aba arrastando: 180 px de lado trocam; um esbarrão de 30 px não troca', async () => {
    await page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await page.locator('[role="tab"]').first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    const antes = await abaAtiva();
    await arrastoDeLado(300, 400, -30);
    await calma(500);
    check((await abaAtiva()) === antes, `um esbarrão de 30 px trocou de aba: ${antes} -> ${await abaAtiva()}`);
    await arrastoDeLado(340, 400, -230);
    await calma(800);
    check((await abaAtiva()) !== antes, `arrastar 230 px de lado não trocou de aba (continua em "${antes}")`);
    await arrastoDeLado(70, 400, 230);
    await calma(800);
    check((await abaAtiva()) === antes, `arrastar para o outro lado não voltou à aba "${antes}"`);
  }, { tag: 'ux' });

  // ---------------------------------------------------------------------------------------------------------------
  section('gestos: visualizador de imagem');
  await step('o celular abre a página do post e toca na imagem: o visualizador abre no tamanho original', async () => {
    await page.goto(`${BASE_URL}/pt-BR/post/${postId}`, { waitUntil: 'domcontentloaded' });
    await page.locator(IMAGEM).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    await page.locator(IMAGEM).first().tap();
    await page.locator('[data-testid="image-viewer"]').waitFor({ timeout: 15_000 });
    check((await escala()) === 1, `escala inicial ${await escala()}`);
    await shot(page, 'gestos-02-visualizador');
  });

  await soft('pinça (dois dedos se afastando) amplia a imagem', async () => {
    await cdp.send('Input.synthesizePinchGesture', { x: 206, y: 420, scaleFactor: 2.5, relativeSpeed: 300, gestureSourceType: 'touch' });
    await calma(400);
    const e = await escala();
    check(e > 2 && e <= 5, `escala depois da pinça: ${e} (esperado ~2,5)`);
  }, { tag: 'ux' });

  await soft('toque duplo com a imagem ampliada volta ao tamanho original; outro toque duplo amplia 2,5x', async () => {
    await page.touchscreen.tap(206, 420);
    await page.waitForTimeout(80);
    await page.touchscreen.tap(206, 420);
    await calma(500);
    check((await escala()) === 1, `o toque duplo não voltou ao original: ${await escala()}`);
    await page.touchscreen.tap(206, 420);
    await page.waitForTimeout(80);
    await page.touchscreen.tap(206, 420);
    await calma(500);
    check(Math.abs((await escala()) - 2.5) < 0.05, `o toque duplo não ampliou 2,5x: ${await escala()}`);
    await page.touchscreen.tap(206, 420);
    await page.waitForTimeout(80);
    await page.touchscreen.tap(206, 420);
    await calma(500);
    check((await escala()) === 1, `o toque duplo não voltou ao original: ${await escala()}`);
  }, { tag: 'ux' });

  await soft('arrastar a imagem ampliada move a imagem (e não fecha o visualizador)', async () => {
    await page.touchscreen.tap(206, 420);
    await page.waitForTimeout(80);
    await page.touchscreen.tap(206, 420);
    await calma(400);
    const antes = await page.locator('[data-testid="image-viewer-image"]').evaluate((el) => el.style.transform);
    await gesto(206, 420, { xDistance: -80, yDistance: 0, speed: 400 });
    await calma(400);
    const depois = await page.locator('[data-testid="image-viewer-image"]').evaluate((el) => el.style.transform);
    check(antes !== depois, `a imagem não se moveu ao arrastar: ${antes} -> ${depois}`);
    check(await page.locator('[data-testid="image-viewer"]').isVisible(), 'o visualizador fechou ao arrastar a imagem ampliada');
    await page.touchscreen.tap(206, 420);
    await page.waitForTimeout(80);
    await page.touchscreen.tap(206, 420);
    await calma(400);
  }, { tag: 'ux' });

  await soft('puxar a imagem para baixo (no tamanho original) FECHA o visualizador', async () => {
    check((await escala()) === 1, `a escala deveria ser 1 neste ponto: ${await escala()}`);
    await gesto(206, 300, { yDistance: 260, speed: 900 });
    await page.locator('[data-testid="image-viewer"]').waitFor({ state: 'detached', timeout: 8000 });
  }, { tag: 'ux' });

  await soft('um puxão curto (40 px) NÃO fecha: a imagem volta ao lugar', async () => {
    await page.locator(IMAGEM).first().tap();
    await page.locator('[data-testid="image-viewer"]').waitFor({ timeout: 15_000 });
    await gesto(206, 300, { yDistance: 40, speed: 150 });
    await calma(600);
    check(await page.locator('[data-testid="image-viewer"]').isVisible(), 'um puxão curto fechou o visualizador');
  }, { tag: 'ux' });

  // ---------------------------------------------------------------------------------------------------------------
  section('gestos: voltar (botão ou gesto do Android)');
  const voltar = () => page.evaluate((nome) => { const e = new CustomEvent(nome, { detail: {} }); window.dispatchEvent(e); return e.detail.action; }, HARDWARE_BACK);
  await soft('o 1º "voltar" fecha o visualizador aberto e NÃO sai da página', async () => {
    check(await page.locator('[data-testid="image-viewer"]').isVisible(), 'o visualizador deveria estar aberto');
    const urlAntes = page.url();
    const acao = await voltar();
    check(acao === 'overlay', `ação do voltar: ${acao} (esperado "overlay")`);
    await page.locator('[data-testid="image-viewer"]').waitFor({ state: 'detached', timeout: 8000 });
    check(page.url() === urlAntes, `o voltar saiu da página: ${urlAntes} -> ${page.url()}`);
  }, { tag: 'funcional' });

  await soft('sem nada aberto, o "voltar" volta no histórico da página', async () => {
    await page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await page.goto(`${BASE_URL}/pt-BR/post/${postId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const acao = await voltar();
    check(acao === 'history', `ação do voltar: ${acao} (esperado "history")`);
    await page.waitForURL((url) => !url.pathname.includes('/post/'), { timeout: 15_000 });
  }, { tag: 'funcional' });

  // ---------------------------------------------------------------------------------------------------------------
  section('gestos: folha de baixo');
  await soft('no celular, o repost abre uma folha de baixo; puxar a alça para baixo a fecha', async () => {
    await page.goto(`${BASE_URL}/pt-BR/post/${postId}`, { waitUntil: 'domcontentloaded' });
    await page.locator(IMAGEM).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    await page.locator('main button:has(svg.lucide-repeat2)').first().tap();
    const alca = page.locator('[data-testid="sheet-grabber"]').first();
    await alca.waitFor({ timeout: 15_000 });
    // `visible` fica verdadeiro no primeiro quadro da animação, quando a folha
    // ainda está abaixo da viewport. Aguarda a posição final antes de tocar.
    await page.waitForTimeout(600);
    const caixa = await alca.boundingBox();
    check(caixa, 'a alça da folha não foi encontrada');
    await shot(page, 'gestos-03-folha');
    // O dedo encosta na alça e desce 220 px (eventos de toque, em passos).
    const x = Math.round(caixa.x + caixa.width / 2);
    const y = Math.round(caixa.y + caixa.height / 2);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let passo = 1; passo <= 11; passo++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + passo * 20 }] });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.locator('[data-testid="sheet-grabber"]').first().waitFor({ state: 'detached', timeout: 8000 });
  }, { tag: 'ux' });

  await context?.close().catch(() => {});
}
