#!/usr/bin/env node
/**
 * Testa src/lib/security/safe-fetch.ts (proteção contra SSRF da rota /api/extract-article) sem emuladores nem app:
 * importa o módulo TypeScript direto (o Node 22 remove os tipos) e usa uma fixture HTTP em 127.0.0.1.
 *   node e2e/safe-fetch-check.mjs
 * Sem rede externa: as URLs "públicas" só são validadas, nunca buscadas. Sai com código 1 se algo falhar.
 */
import dns from 'node:dns';
import http from 'node:http';
import zlib from 'node:zlib';

const { assertSafeUrl, isBlockedAddress, safeFetchText, UnsafeUrlError } = await import('../src/lib/security/safe-fetch.ts');

let failures = 0;
const ok = (name, detail = '') => console.log(`OK    ${name}${detail ? ` — ${detail}` : ''}`);
const fail = (name, detail) => {
  failures++;
  console.log(`FALHA ${name} — ${detail}`);
};
const expectUnsafe = async (name, run) => {
  try {
    await run();
    fail(name, 'foi PERMITIDO');
  } catch (error) {
    if (error instanceof UnsafeUrlError) ok(name, error.message);
    else fail(name, `erro inesperado: ${error?.message ?? error}`);
  }
};

// ---------- fixture local ----------
const MARK = 'CONTEUDO-DA-FIXTURE';
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://x');
  if (url.pathname === '/ok') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<html><body>${MARK}</body></html>`);
  } else if (url.pathname === '/gz') {
    response.setHeader('Content-Type', 'text/html');
    response.setHeader('Content-Encoding', 'gzip');
    response.end(zlib.gzipSync(`<html>${MARK}-gzip</html>`));
  } else if (url.pathname === '/redir-ok') {
    response.statusCode = 302;
    response.setHeader('Location', '/ok');
    response.end();
  } else if (url.pathname === '/redir-metadata') {
    response.statusCode = 302;
    response.setHeader('Location', 'http://169.254.169.254/latest/meta-data/');
    response.end();
  } else if (url.pathname === '/loop') {
    response.statusCode = 302;
    response.setHeader('Location', '/loop');
    response.end();
  } else if (url.pathname === '/big') {
    response.setHeader('Content-Type', 'text/html');
    response.end('x'.repeat(200_000));
  } else if (url.pathname === '/bin') {
    response.setHeader('Content-Type', 'application/octet-stream');
    response.end('binario');
  } else if (url.pathname === '/echo' || url.pathname === '/echo-json') {
    // Devolve o que recebeu, para provar corpo, método e Content-Length do POST.
    const partes = [];
    request.on('data', (c) => partes.push(c));
    request.on('end', () => {
      response.setHeader('Content-Type', 'application/activity+json');
      response.end(JSON.stringify({
        method: request.method,
        contentLength: request.headers['content-length'],
        transferEncoding: request.headers['transfer-encoding'] ?? null,
        host: request.headers.host,
        custom: request.headers['x-teste'] ?? null,
        body: Buffer.concat(partes).toString('utf8'),
      }));
    });
  } else if (url.pathname === '/activity') {
    response.setHeader('Content-Type', 'application/activity+json; charset=utf-8');
    response.end(JSON.stringify({ type: 'Person', id: 'x' }));
  } else if (url.pathname === '/post-redir') {
    // Redireciona um POST para um destino INTERNO. Seguir isto seria mandar uma atividade assinada a outro lugar.
    response.statusCode = 307;
    response.setHeader('Location', 'http://169.254.169.254/latest/meta-data/');
    response.setHeader('Retry-After', '120');
    response.end();
  } else if (url.pathname === '/retry-later') {
    response.statusCode = 429;
    response.setHeader('Retry-After', '37');
    response.setHeader('Content-Type', 'text/plain');
    response.end('devagar');
  } else if (url.pathname === '/huge-ok') {
    // Resposta enorme a um POST: com discardBody nada disso pode ser baixado.
    response.setHeader('Content-Type', 'application/octet-stream');
    response.end('x'.repeat(5_000_000));
  } else if (url.pathname === '/slow') {
    response.setHeader('Content-Type', 'text/html');
    response.write('começou');
    // nunca termina
  } else {
    response.statusCode = 404;
    response.end('não encontrado');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

try {
  // ---------- 1. produção: loopback e redes internas são recusados ----------
  delete process.env.EXTRACT_ARTICLE_ALLOW_LOOPBACK;
  const blockedUrls = [
    `${base}/ok`, `http://localhost:${port}/ok`, `http://[::1]:${port}/ok`, 'http://10.0.0.1/', 'http://192.168.1.1/', 'http://172.16.0.1/',
    'http://172.31.255.255/', 'http://169.254.169.254/latest/meta-data/', 'http://0.0.0.0/', 'http://100.64.0.1/', 'http://127.1/',
    'http://2130706433/', 'http://0x7f.0.0.1/', 'http://0177.0.0.1/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/',
    'http://[::ffff:10.0.0.1]/', 'http://[fe80::1]/', 'http://[fc00::1]/', 'http://[::]/', 'http://224.0.0.1/', 'http://240.0.0.1/',
    'file:///etc/passwd', 'ftp://example.com/', 'gopher://example.com/', 'javascript:alert(1)', 'http://user:senha@example.com/',
    'http://example.com:8080/', 'http://example.com:22/', 'http://', 'nao-e-url',
  ];
  for (const url of blockedUrls) await expectUnsafe(`recusa ${url}`, async () => assertSafeUrl(url));
  for (const url of ['https://example.com/artigo', 'http://example.com/', 'https://www.exemplo.com.br/noticia?id=1#topo', 'http://[2606:4700:4700::1111]/']) {
    try {
      assertSafeUrl(url);
      ok(`aceita ${url}`);
    } catch (error) {
      fail(`aceita ${url}`, error.message);
    }
  }
  for (const [address, expected] of [['8.8.8.8', false], ['1.1.1.1', false], ['93.184.216.34', false], ['2606:4700:4700::1111', false], ['127.0.0.1', true], ['10.1.2.3', true], ['::1', true], ['::ffff:192.168.0.1', true], ['fd00::1', true]]) {
    isBlockedAddress(address) === expected ? ok(`isBlockedAddress(${address}) = ${expected}`) : fail(`isBlockedAddress(${address})`, `esperava ${expected}`);
  }
  await expectUnsafe('safeFetchText não conecta em 127.0.0.1 (produção)', () => safeFetchText(`${base}/ok`));

  // DNS rebinding: um nome "público" que resolve para um endereço interno é recusado NO MOMENTO de conectar
  const originalLookup = dns.lookup;
  dns.lookup = (hostname, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'function' ? {} : options;
    if (hostname === 'rebinding.exemplo.test') return opts.all ? cb(null, [{ address: '10.0.0.5', family: 4 }]) : cb(null, '10.0.0.5', 4);
    return originalLookup(hostname, options, callback);
  };
  try {
    await expectUnsafe('nome que resolve para 10.0.0.5 é recusado na conexão (DNS rebinding)', () => safeFetchText('http://rebinding.exemplo.test/'));
  } finally {
    dns.lookup = originalLookup;
  }

  // ---------- 2. teste local: EXTRACT_ARTICLE_ALLOW_LOOPBACK libera SÓ loopback ----------
  process.env.EXTRACT_ARTICLE_ALLOW_LOOPBACK = 'true';
  try {
    const page = await safeFetchText(`${base}/ok`);
    page.ok && page.text.includes(MARK) && /text\/html/.test(page.contentType) ? ok('loopback liberado só no modo de teste: HTML buscado', `HTTP ${page.status}`) : fail('busca na fixture', JSON.stringify(page).slice(0, 120));
  } catch (error) {
    fail('busca na fixture', error.message);
  }
  try {
    const gz = await safeFetchText(`${base}/gz`);
    gz.text.includes(`${MARK}-gzip`) ? ok('resposta gzip é descomprimida') : fail('gzip', gz.text.slice(0, 80));
  } catch (error) {
    fail('gzip', error.message);
  }
  try {
    const redirected = await safeFetchText(`${base}/redir-ok`);
    redirected.text.includes(MARK) && redirected.finalUrl.endsWith('/ok') ? ok('redirecionamento para destino permitido é seguido', redirected.finalUrl) : fail('redirecionamento', redirected.finalUrl);
  } catch (error) {
    fail('redirecionamento', error.message);
  }
  await expectUnsafe('redirecionamento para 169.254.169.254 é recusado (cada salto é conferido)', () => safeFetchText(`${base}/redir-metadata`));
  await expectUnsafe('10.0.0.1 continua recusado mesmo no modo de teste', () => safeFetchText('http://10.0.0.1/'));
  await expectUnsafe('porta não padrão em host público continua recusada', () => safeFetchText('http://example.com:8080/'));
  await expectUnsafe('laço de redirecionamentos é interrompido', () => safeFetchText(`${base}/loop`, { maxRedirects: 3 }));
  await expectUnsafe('resposta maior que o limite é recusada', () => safeFetchText(`${base}/big`, { maxBytes: 50_000 }));
  await expectUnsafe('tipo de conteúdo não textual é recusado', () => safeFetchText(`${base}/bin`));
  await expectUnsafe('resposta que nunca termina é interrompida pelo tempo limite', () => safeFetchText(`${base}/slow`, { timeoutMs: 900 }));
  // ---------- 2b. capacidades para o ActivityPub: POST, tipos de conteúdo, descartar corpo ----------
  try {
    const corpo = JSON.stringify({ type: 'Follow', nota: 'ação com acento' });
    const r = await safeFetchText(`${base}/echo`, {
      method: 'POST',
      body: corpo,
      headers: { 'Content-Type': 'application/activity+json', 'X-Teste': 'sim' },
      allowedContentTypes: /^application\/(activity|ld)\+json/i,
    });
    const eco = JSON.parse(r.text);
    eco.method === 'POST' ? ok('POST: método chega como POST') : fail('POST método', eco.method);
    eco.body === corpo ? ok('POST: corpo chega intacto, inclusive acentos', `${Buffer.byteLength(corpo)} bytes`) : fail('POST corpo', eco.body);
    eco.contentLength === String(Buffer.byteLength(corpo))
      ? ok('POST: Content-Length é o tamanho em BYTES, não em caracteres')
      : fail('POST Content-Length', `veio ${eco.contentLength}, esperava ${Buffer.byteLength(corpo)}`);
    eco.transferEncoding === null ? ok('POST: nunca usa transfer-encoding chunked') : fail('POST chunked', eco.transferEncoding);
    eco.custom === 'sim' ? ok('POST: cabeçalhos do chamador são enviados') : fail('POST cabeçalho', String(eco.custom));
    r.headers && typeof r.headers === 'object' ? ok('resultado traz os cabeçalhos da resposta') : fail('headers', 'ausente');
  } catch (error) {
    fail('POST', error.message);
  }

  await expectUnsafe(
    'JSON de ActivityPub é recusado SEM allowedContentTypes (padrão continua só texto)',
    () => safeFetchText(`${base}/activity`),
  );
  try {
    const r = await safeFetchText(`${base}/activity`, { allowedContentTypes: /^application\/(activity|ld)\+json/i });
    JSON.parse(r.text).type === 'Person' ? ok('application/activity+json é aceito quando o chamador declara') : fail('activity+json', r.text);
  } catch (error) {
    fail('activity+json declarado', error.message);
  }
  await expectUnsafe(
    'allowedContentTypes declarado NÃO abre o resto: octet-stream continua recusado',
    () => safeFetchText(`${base}/bin`, { allowedContentTypes: /^application\/activity\+json/i }),
  );

  try {
    const r = await safeFetchText(`${base}/post-redir`, { method: 'POST', body: '{}', discardBody: true });
    r.status === 307 && !r.ok ? ok('POST: redirecionamento NÃO é seguido, volta como resposta', 'HTTP 307') : fail('POST redirecionamento', JSON.stringify(r).slice(0, 100));
    String(r.headers['retry-after']) === '120' ? ok('POST: cabeçalhos do 3xx são preservados') : fail('POST Retry-After no 3xx', String(r.headers['retry-after']));
  } catch (error) {
    fail('POST redirecionamento', error.message);
  }
  try {
    const r = await safeFetchText(`${base}/retry-later`, { method: 'POST', body: '{}', discardBody: true });
    r.status === 429 && String(r.headers['retry-after']) === '37'
      ? ok('Retry-After de um 429 chega a quem chamou', 'valor 37')
      : fail('Retry-After 429', JSON.stringify({ s: r.status, h: r.headers['retry-after'] }));
  } catch (error) {
    fail('Retry-After', error.message);
  }
  try {
    const antes = Date.now();
    const r = await safeFetchText(`${base}/huge-ok`, { method: 'POST', body: '{}', discardBody: true, maxBytes: 1000 });
    r.status === 200 && r.text === '' ? ok('discardBody: 5 MB de resposta não são lidos nem estouram maxBytes', `${Date.now() - antes} ms`) : fail('discardBody', JSON.stringify({ s: r.status, t: r.text.length }));
  } catch (error) {
    fail('discardBody', error.message);
  }
  // O `reason` tipado: a federação repete timeout e desiste de destino proibido, e não pode confundir os dois.
  const expectReason = async (nome, run, reason) => {
    try {
      await run();
      fail(nome, 'foi PERMITIDO');
    } catch (error) {
      error instanceof UnsafeUrlError && error.reason === reason
        ? ok(nome, `reason=${reason}`)
        : fail(nome, `esperava reason=${reason}, veio ${error?.reason ?? error?.message}`);
    }
  };
  await expectReason('reason: timeout é "timeout", NÃO "forbidden"', () => safeFetchText(`${base}/slow`, { timeoutMs: 700 }), 'timeout');
  await expectReason('reason: resposta grande é "size"', () => safeFetchText(`${base}/big`, { maxBytes: 50_000 }), 'size');
  await expectReason('reason: laço de redirecionamentos é "redirects"', () => safeFetchText(`${base}/loop`, { maxRedirects: 2 }), 'redirects');
  await expectReason('reason: tipo recusado é "content-type"', () => safeFetchText(`${base}/bin`), 'content-type');
  await expectReason('reason: salto para 169.254.169.254 é "forbidden"', () => safeFetchText(`${base}/redir-metadata`), 'forbidden');
  await expectReason('reason: IP privado direto é "forbidden"', () => safeFetchText('http://10.0.0.1/'), 'forbidden');
  await expectReason('reason: porta não padrão é "forbidden"', () => safeFetchText('http://example.com:8080/'), 'forbidden');
  await expectUnsafe('GET com corpo é recusado', () => safeFetchText(`${base}/ok`, { body: 'x' }));
  await expectUnsafe('POST para 169.254.169.254 é recusado como o GET', () => safeFetchText('http://169.254.169.254/', { method: 'POST', body: '{}' }));
  await expectUnsafe('POST para loopback continua recusado em produção', async () => {
    delete process.env.EXTRACT_ARTICLE_ALLOW_LOOPBACK;
    try { return await safeFetchText(`${base}/echo`, { method: 'POST', body: '{}' }); }
    finally { process.env.EXTRACT_ARTICLE_ALLOW_LOOPBACK = 'true'; }
  });

  try {
    const notFound = await safeFetchText(`${base}/nada`);
    notFound.status === 404 && !notFound.ok ? ok('HTTP 404 volta como status (a rota decide a mensagem)') : fail('404', JSON.stringify(notFound));
  } catch (error) {
    fail('404', error.message);
  }
} finally {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

// ---------- 3. guarda de regressão: nenhuma rota de API busca URL de terceiros com fetch cru ----------
// (o quote-preview chegou a fazer isso e deixava o SSRF aberto; toda busca deve passar por safeFetchText)
{
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const rotas = [];
  const varrer = (dir) => {
    for (const nome of readdirSync(dir)) {
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) varrer(caminho);
      else if (/^route\.(ts|js)$/.test(nome)) rotas.push(caminho);
    }
  };
  varrer(new URL('../src/app/api', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  for (const rota of rotas) {
    const codigo = readFileSync(rota, 'utf8');
    const crua = /(^|[^.\w])fetch\(/m.test(codigo);
    crua ? fail(`rota ${rota.split(/[\\/]src[\\/]/)[1]} não usa fetch cru`, 'usa fetch( direto; use safeFetchText') : ok(`rota ${rota.split(/[\\/]src[\\/]/)[1]} não usa fetch cru`);
  }
}
console.log(failures ? `RESULTADO: ${failures} FALHA(S)` : 'RESULTADO: PASSOU');
process.exit(failures ? 1 : 0);
