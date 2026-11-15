/**
 * Seção "artigos": criar um artigo (a partir de uma URL servida por uma fixture LOCAL, sem internet), lê-lo e interagir.
 * Também mede a rota /api/extract-article, que busca no servidor qualquer URL recebida (risco de SSRF).
 */
import http from 'node:http';
import { adminFind, adminGetDoc, eventually } from '../lib/harness.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

export async function run(ctx) {
  const { runner, users, BASE_URL, stamp, shot } = ctx;
  const { a: A, b: B } = users;
  const { section, soft, step, check } = runner;
  const title = `Artigo de teste E2E ${stamp}`;
  const paragraph = (n) =>
    `Parágrafo ${n} do artigo de teste ${stamp}: este texto existe somente para o teste automatizado de criação de artigos e precisa ter bastante conteúdo para ser reconhecido como o corpo principal da página.`;

  // Fixture local: nada sai da máquina.
  let port;
  const server = http.createServer((request, response) => {
    if (request.url === '/artigo') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(
        `<!doctype html><html><head><title>${title}</title><meta property="og:image" content="http://127.0.0.1:${port}/imagem.png"></head>` +
          `<body><nav>menu</nav><article><h1>${title}</h1><p>${paragraph(1)}</p><p>${paragraph(2)}</p><p>${paragraph(3)}</p></article></body></html>`,
      );
    } else if (request.url === '/imagem.png') {
      response.setHeader('Content-Type', 'image/png');
      response.end(PNG);
    } else if (request.url === '/interno') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><title>Painel interno</title></head><body><article><p>SEGREDO-INTERNO-${stamp}: conteúdo de um serviço que só responde em 127.0.0.1 e que ninguém de fora da máquina deveria alcançar. ${paragraph(9)}</p><p>${paragraph(10)}</p></article></body></html>`);
    } else {
      response.statusCode = 404;
      response.end('não encontrado');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;

  try {
    // -------------------------------------------------------------------------------------------------------------
    section('artigos: criar a partir de uma URL');
    let articleId;
    await soft('A extrai o artigo da URL de fixture e a página mostra título e fonte', async () => {
      await A.page.goto(`${BASE_URL}/pt-BR/breaknews`, { waitUntil: 'domcontentloaded' });
      await A.page.getByPlaceholder('https://exemplo.com.br/artigo').fill(`http://127.0.0.1:${port}/artigo`);
      await A.page.getByRole('button', { name: 'Extrair', exact: true }).click();
      await A.page.getByRole("heading", { name: title }).first().waitFor({ timeout: 60_000 });
      await shot(A.page, 'artigos-01-extraido');
    });
    await soft('A compartilha como artigo (categoria + Publicar) e o artigo é gravado como category=news', async () => {
      await A.page.getByRole('button', { name: 'Compartilhar como Artigo' }).click();
      const dialog = A.page.getByRole('dialog');
      await dialog.waitFor();
      await dialog.getByRole('combobox').first().click();
      await A.page.getByRole('option').first().click();
      const publish = dialog.getByRole('button', { name: 'Publicar', exact: true });
      await eventually(async () => publish.isEnabled(), { label: 'botão Publicar habilitado', timeoutMs: 20_000 });
      await shot(A.page, 'artigos-02-dialogo');
      await publish.click();
      await A.page.getByText('Artigo Publicado!').first().waitFor({ timeout: 60_000 });
      const post = await eventually(
        async () => (await adminFind('posts', { userId: A.uid })).find((p) => p.category === 'news' && String(p.headline).includes(title)),
        { label: 'artigo no Firestore' },
      );
      articleId = post.__id;
      check(post.sourceUrl?.includes(`127.0.0.1:${port}/artigo`), `sourceUrl gravada: ${post.sourceUrl}`);
      check(post.newsCategory, 'newsCategory não gravada');
      return `artigo ${articleId} (categoria "${post.newsCategory}")`;
    });

    // -------------------------------------------------------------------------------------------------------------
    section('artigos: ler e interagir');
    await soft('B abre o artigo e vê título e corpo', async () => {
      check(articleId, 'o artigo não foi criado');
      await B.page.goto(`${BASE_URL}/pt-BR/post/${articleId}`, { waitUntil: 'domcontentloaded' });
      await B.page.getByText(title).first().waitFor({ timeout: 90_000 });
      await B.page.getByText(paragraph(2).slice(0, 60)).first().waitFor({ timeout: 30_000 });
      await shot(B.page, 'artigos-03-lido-por-b');
    });
    await soft('B curte o artigo: like gravado e contador do artigo = 1', async () => {
      check(articleId, 'o artigo não foi criado');
      await B.page.locator('button[title="Like"]').first().click();
      await B.page.locator('button[title="Unlike"]').first().waitFor();
      await eventually(async () => (await adminGetDoc(`posts/${articleId}/likes/${B.uid}`)).doc, { label: 'like do artigo' });
      await eventually(async () => (await adminGetDoc(`posts/${articleId}`)).doc.likes === 1, { label: 'contador likes do artigo' });
    });
    await soft('B comenta o artigo e o comentário aparece', async () => {
      const text = `Comentário de B no artigo ${stamp}`;
      await B.page.getByText('Escreva um comentário...').first().click();
      const dialog = B.page.getByRole('dialog');
      await dialog.waitFor();
      await dialog.getByPlaceholder('Escreva um comentário...').fill(text);
      await dialog.getByRole('button', { name: 'Responder', exact: true }).click();
      await B.page.getByText(text).first().waitFor({ timeout: 60_000 });
      await eventually(async () => (await adminGetDoc(`posts/${articleId}`)).doc.commentsCount === 1, { label: 'commentsCount do artigo' });
    });
    await soft('o dono A recebe as notificações de curtida e comentário do artigo', async () => {
      await eventually(async () => (await adminFind('notifications', { recipientId: A.uid, type: 'like_post' })).length >= 1, { label: 'like_post para A' });
      await eventually(async () => (await adminFind('notifications', { recipientId: A.uid, type: 'comment_on_post' })).length >= 1, { label: 'comment_on_post para A' });
    });

    // -------------------------------------------------------------------------------------------------------------
    section('artigos: segurança da extração (/api/extract-article)');
    // O servidor de teste roda com EXTRACT_ARTICLE_ALLOW_LOOPBACK=true (a fixture fica em 127.0.0.1), que libera SÓ o
    // loopback. As demais redes internas precisam continuar recusadas; o loopback em produção é coberto por
    // e2e/safe-fetch-check.mjs. Estes endereços não respondem aqui: se a rota os buscasse, a chamada ficaria pendurada.
    await soft('a extração recusa redes internas e o servidor de metadados da nuvem (SSRF), sem tentar conectar', async () => {
      // Com login (a rota exige): assim o teste mede a proteção contra SSRF, não a falta de token.
      const idToken = await ctx.token(A);
      for (const target of ['http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/', 'http://192.168.0.1/', 'http://[fd00::1]/', 'http://2852039166/']) {
        const started = Date.now();
        const response = await fetch(`${BASE_URL}/api/extract-article`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ url: target }),
          signal: AbortSignal.timeout(20_000),
        }).catch((error) => ({ status: 0, error: String(error?.message ?? error) }));
        check(response.status === 400 && Date.now() - started < 5_000, `${target} -> HTTP ${response.status} em ${Date.now() - started} ms (esperado 400 imediato)`);
      }
    }, { tag: 'seg' });
    await soft('a extração exige login (sem cookie nem token, qualquer pessoa usa o servidor para buscar páginas)', async () => {
      const response = await fetch(`${BASE_URL}/api/extract-article`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `http://127.0.0.1:${port}/artigo` }),
      });
      check(response.status === 401 || response.status === 403, `a rota respondeu HTTP ${response.status} para uma chamada anônima`);
    }, { tag: 'seg' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
