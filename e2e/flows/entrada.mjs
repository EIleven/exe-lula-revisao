/**
 * Regressões relatadas por usuários: YouTube não pode gerar duas prévias; imagem pode ser colada/arrastada direto;
 * uma conta nova abre em preto; e a conversa não pode criar rolagem horizontal nem exibir a barra de artigos.
 */
import { makePng } from '../lib/harness.mjs';

export async function run(ctx) {
  const { runner, users, BASE_URL, stamp } = ctx;
  const { a: A, b: B } = users;
  const { section, soft, check } = runner;
  const youtubeUrl = 'https://www.youtube.com/watch?v=uZamuc0tohY';
  const png = makePng(220, 140, [25, 90, 180]);
  const quotePreviewRequests = [];
  const observePreview = (request) => {
    if (request.url().includes('/api/quote-preview')) quotePreviewRequests.push(request.url());
  };
  A.page.on('request', observePreview);
  // O DOM do player continua sendo validado, mas o teste não carrega o site externo do YouTube.
  // Assim a matriz permanece hermética e não confunde recursos legítimos do iframe com vazamento para o Firebase real.
  await A.page.route(/^https:\/\/www\.youtube\.com\/embed\//, (route) => route.abort());

  const transferFile = (locator, eventType, file) => locator.evaluate((element, data) => {
    const bytes = Uint8Array.from(atob(data.base64), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], data.name, { type: data.mimeType }));
    const EventClass = data.eventType === 'paste' ? ClipboardEvent : DragEvent;
    element.dispatchEvent(new EventClass(data.eventType, {
      ...(data.eventType === 'paste' ? { clipboardData: transfer } : { dataTransfer: transfer }),
      bubbles: true,
      cancelable: true,
    }));
  }, { ...file, eventType, base64: file.buffer.toString('base64') });

  section('entrada: tema, YouTube e mídia direta');
  await soft('a aparência padrão de uma conta nova tem fundo preto real', async () => {
    await A.page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    const colors = await A.page.evaluate(() => ({
      token: getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
      body: getComputedStyle(document.body).backgroundColor,
    }));
    check(colors.token === '0 0% 0%', `--background = ${colors.token}`);
    check(colors.body === 'rgb(0, 0, 0)', `fundo do body = ${colors.body}`);
  }, { tag: 'ux' });

  await soft('colar o link do YouTube no post mostra UM player e não chama a prévia genérica', async () => {
    quotePreviewRequests.length = 0;
    await A.page.getByRole('button', { name: 'Postar', exact: true }).first().click();
    const dialog = A.page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByPlaceholder('E aí?').fill(youtubeUrl);
    await dialog.locator('[data-testid="youtube-embed"]').waitFor();
    await A.page.waitForTimeout(800);
    check(await dialog.locator('[data-testid="youtube-embed"]').count() === 1, 'o compositor não mostrou exatamente um player');
    check(quotePreviewRequests.length === 0, `o YouTube também chamou quote-preview: ${quotePreviewRequests[0]}`);
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
  }, { tag: 'funcional' });

  await soft('arrastar uma imagem do computador diretamente sobre o post anexa e envia a mídia', async () => {
    await A.page.getByRole('button', { name: 'Postar', exact: true }).first().click();
    const dialog = A.page.getByRole('dialog');
    await dialog.waitFor();
    await transferFile(dialog.locator('form'), 'drop', { name: 'arrastada.png', mimeType: 'image/png', buffer: png });
    await dialog.locator('[data-status="ready"]').waitFor({ timeout: 60_000 });
    check(await dialog.locator('[data-testid="composer-media"] img').count() === 1, 'a imagem arrastada não apareceu no compositor');
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  }, { tag: 'funcional' });

  await soft('no chat, o YouTube também usa um único player e a página não tem coluna lateral nem overflow horizontal', async () => {
    quotePreviewRequests.length = 0;
    await A.page.goto(`${BASE_URL}/pt-BR/messages/user/${B.uid}`, { waitUntil: 'domcontentloaded' });
    const input = A.page.getByPlaceholder('Digite sua mensagem...');
    await input.waitFor({ timeout: 90_000 });
    check(await A.page.getByText('Em Alta', { exact: true }).count() === 0, 'a barra lateral de tendências ainda aparece na conversa');
    await input.fill(youtubeUrl);
    await A.page.locator('[data-testid="message-composer"] [data-testid="youtube-embed"]').waitFor();
    check(await A.page.locator('[data-testid="message-composer"] [data-testid="youtube-embed"]').count() === 1, 'a entrada do chat duplicou o player');
    await A.page.locator('form:has(textarea[placeholder="Digite sua mensagem..."]) button[type=submit]').click();
    await A.page.locator('[id^="message-bubble-"] [data-testid="youtube-embed"]').last().waitFor({ timeout: 90_000 });
    check(await A.page.locator('[data-testid="youtube-embed"]').count() === 1, 'depois de enviar, ficou mais de um player na conversa');
    check(quotePreviewRequests.length === 0, `o chat chamou quote-preview para YouTube: ${quotePreviewRequests[0]}`);
    const overflow = await A.page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    check(overflow.scroll <= overflow.width + 1, `a conversa estourou horizontalmente: ${overflow.scroll}px > ${overflow.width}px`);
  }, { tag: 'ux' });

  await soft('colar uma imagem diretamente no campo do chat anexa e envia sem abrir o seletor de arquivos', async () => {
    const input = A.page.getByPlaceholder('Digite sua mensagem...');
    await transferFile(input, 'paste', { name: 'chat-colada.png', mimeType: 'image/png', buffer: png });
    await A.page.getByText('chat-colada.png', { exact: true }).waitFor();
    await input.fill(`Imagem colada ${stamp}`);
    await A.page.locator('form:has(textarea[placeholder="Digite sua mensagem..."]) button[type=submit]').click();
    await A.page.getByText(`Imagem colada ${stamp}`, { exact: true }).waitFor({ timeout: 90_000 });
    await A.page.locator('[id^="message-bubble-"] img[src*="127.0.0.1:9199"]').last().waitFor({ timeout: 90_000 });
  }, { tag: 'funcional' });

  A.page.off('request', observePreview);
}
