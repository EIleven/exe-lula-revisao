/**
 * Seção "previa": a prévia de um link colado no texto do post (rota /api/quote-preview e o campo de texto).
 *
 * Dois defeitos reais de produção:
 *  1. "veja (https://site.com/a)" capturava o ")" junto, o site de origem respondia "não encontrado" e a rota devolvia
 *     500 (erro do SERVIDOR, e em inglês) para um problema do link;
 *  2. qualquer erro do site do link (404, 403, fora do ar) virava 500.
 * Aqui um servidor de teste local faz o papel do "site do link" (o app aceita loopback nos testes por
 * EXTRACT_ARTICLE_ALLOW_LOOPBACK=true): página boa, página que não existe, e uma porta fechada.
 */
import http from 'node:http';

export async function run(ctx) {
  const { runner, users, BASE_URL, shot } = ctx;
  const { a: A } = users;
  const { section, step, soft, check } = runner;

  const pedidos = [];
  const site = http.createServer((req, res) => {
    pedidos.push(req.url);
    const html = (corpo) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(corpo); };
    // A folha de estilo quebrada de propósito: o jsdom reclama dela no log, mas isso não pode derrubar a prévia.
    if (req.url === '/artigo') return html('<html><head><title>Artigo de teste da prévia</title><meta property="og:description" content="Descrição do artigo de teste"><style>@@@ { { invalid css</style></head><body><article>conteúdo</article></body></html>');
    if (req.url === '/artigo_(2)') return html('<html><head><title>Artigo com parênteses</title></head><body><article>conteúdo</article></body></html>');
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><body>não existe</body></html>');
  });
  await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
  const porta = site.address().port;
  const origem = `http://127.0.0.1:${porta}`;
  const preview = (url) => fetch(`${BASE_URL}/api/quote-preview?url=${encodeURIComponent(url)}`);

  section('previa: a rota');
  try {
    await soft('um link bom devolve a prévia (título, descrição) mesmo com uma folha de estilo quebrada na página', async () => {
      const resposta = await preview(`${origem}/artigo`);
      check(resposta.status === 200, `HTTP ${resposta.status}`);
      const dados = await resposta.json();
      check(dados.headline === 'Artigo de teste da prévia', `título: ${dados.headline}`);
      check(String(dados.text).includes('Descrição do artigo de teste'), `texto: ${dados.text}`);
    }, { tag: 'funcional' });

    await soft('um link cujo site responde 404 NÃO é erro do servidor: 422, em português e dizendo o que o site respondeu', async () => {
      const resposta = await preview(`${origem}/nao-existe`);
      check(resposta.status === 422, `HTTP ${resposta.status} (esperado 422; 500 seria um defeito nosso)`);
      const dados = await resposta.json();
      check(/404/.test(dados.message) && /link/i.test(dados.message), `mensagem: ${dados.message}`);
    }, { tag: 'funcional' });

    await soft('um site que não responde (porta fechada) também é 422 e não 500', async () => {
      const resposta = await preview('http://127.0.0.1:1/qualquer');
      check(resposta.status === 422, `HTTP ${resposta.status}`);
      check(/acessar este link/.test((await resposta.json()).message), 'mensagem inesperada');
    }, { tag: 'funcional' });

    await soft('"http" ou "http://" sozinhos são pedido inválido (400), não erro do servidor', async () => {
      for (const url of ['http', 'http://']) {
        const resposta = await preview(url);
        check(resposta.status === 400, `${url} -> HTTP ${resposta.status}`);
      }
    }, { tag: 'seg' });
  } catch (error) {
    site.close();
    throw error;
  }

  section('previa: o campo de texto');
  const aberto = async (texto) => {
    await A.page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await A.page.getByRole('button', { name: 'Postar', exact: true }).first().click();
    const dialog = A.page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByPlaceholder('E aí?').fill(texto);
    return dialog;
  };
  const consultas = [];
  A.page.on('request', (request) => {
    if (request.url().includes('/api/quote-preview')) consultas.push(decodeURIComponent(new URL(request.url()).searchParams.get('url') ?? ''));
  });

  await soft('um link entre parênteses ao fim da frase "veja (https://...)" mostra a prévia: o ")" não vai junto no endereço', async () => {
    const antes = consultas.length;
    const dialog = await aberto(`Veja isto (${origem}/artigo)`);
    await dialog.getByText('Artigo de teste da prévia').first().waitFor({ timeout: 30_000 });
    await shot(A.page, 'previa-01-link-entre-parenteses');
    const enviados = consultas.slice(antes);
    check(enviados.length > 0 && enviados.every((url) => url === `${origem}/artigo`), `endereços consultados: ${JSON.stringify(enviados)} (esperado ${origem}/artigo, sem o ")")`);
    check(!pedidos.includes('/artigo)'), 'o site do link recebeu o ")" no caminho');
  }, { tag: 'ux' });

  await soft('pontuação da frase no fim do link ("... acho que vale. https://...,") também não vai junto', async () => {
    const antes = consultas.length;
    const dialog = await aberto(`Achei bom: ${origem}/artigo.`);
    await dialog.getByText('Artigo de teste da prévia').first().waitFor({ timeout: 30_000 });
    const enviados = consultas.slice(antes);
    check(enviados.length > 0 && enviados.every((url) => url === `${origem}/artigo`), `endereços consultados: ${JSON.stringify(enviados)}`);
  }, { tag: 'ux' });

  await soft('um link que TEM parênteses (como na Wikipédia) segue inteiro', async () => {
    const antes = consultas.length;
    const dialog = await aberto(`Leia ${origem}/artigo_(2)`);
    await dialog.getByText('Artigo com parênteses').first().waitFor({ timeout: 30_000 });
    const enviados = consultas.slice(antes);
    check(enviados.length > 0 && enviados.every((url) => url === `${origem}/artigo_(2)`), `endereços consultados: ${JSON.stringify(enviados)}`);
  }, { tag: 'ux' });

  await step('encerra o site de teste', async () => {
    await new Promise((resolve) => site.close(resolve));
    return `${pedidos.length} pedidos recebidos`;
  });
}
