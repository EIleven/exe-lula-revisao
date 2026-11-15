#!/usr/bin/env node
/**
 * XSS no navegador de verdade: semeia nos EMULADORES um artigo, um post comum, uma citação e um post com título
 * "</script>", todos com cargas que tentam rodar script, e abre as páginas (sem login) num Chrome sem interface.
 * Passa se nenhuma carga rodar (window.__xss continua indefinido, nenhum alert) e se o conteúdo legítimo aparecer
 * (texto, link de hashtag, embed do YouTube).
 *   E2E_BASE_URL=http://localhost:9002 node e2e/xss-render-check.mjs
 * Requer os emuladores no ar e o app rodando (build de produção apontando para eles). Sai com código 1 se falhar.
 */
import { createRunner, fsSet, loadPlaywright } from './lib/harness.mjs';

const BASE_URL = (process.env.E2E_BASE_URL ?? 'http://localhost:9002').replace(/\/+$/, '');
const stamp = Date.now().toString(36);
const runner = createRunner('xss');
const { step, soft, check, section } = runner;
const now = new Date();
const authorId = `xss_autor_${stamp}`;
const author = { userId: authorId, name: `Autor XSS ${stamp}`, username: `xss_${stamp}`, avatarUrl: '/profile.png', 'data-ai-hint': 'avatar' };
const RUN = 'window.__xss=(window.__xss||0)+1';
const basePost = {
  userId: authorId, authorDetails: author, type: 'original', category: 'echo', visibility: 'public', isDeleted: false,
  likes: 0, reposts: 0, commentsCount: 0, quotesCount: 0, views: 0, allowReposts: true, replyPermission: 'everyone',
  hasMedia: false, createdAt: now,
};
const ids = { news: `xss_artigo_${stamp}`, echo: `xss_post_${stamp}`, quote: `xss_citacao_${stamp}`, jsonld: `xss_jsonld_${stamp}` };

section('preparação');
await step('semear autor e posts com cargas XSS (administrador do emulador)', async () => {
  const writes = [
    fsSet(`users/${authorId}`, { name: author.name, name_lowercase: author.name.toLowerCase(), username: author.username, avatarUrl: '/profile.png', bio: '', followersCount: 0, followingCount: 0, postsCount: 0, isAdmin: false, isModerator: false, profileVisibility: 'public', dmPreference: 'everyone', createdAt: now }, 'owner'),
    fsSet(`usernames/${author.username}`, { userId: authorId }, 'owner'),
    fsSet(`posts/${ids.news}`, {
      ...basePost, category: 'news', headline: `Artigo XSS ${stamp}`, newsCategory: 'Política',
      text: `<p>Texto seguro do artigo ${stamp}</p><img src=x onerror="${RUN}"><script>${RUN}</script>`
        + `<a href="javascript:${RUN}">link ruim</a><p style="position:fixed;inset:0" onclick="${RUN}">sobreposição</p>`
        + `<div data-youtube-video=""><div class="youtube-embed"><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe></div></div>`
        + `<p>#tag${stamp} e &#39;aspas&#39; <a href="https://example.com/#secao">âncora</a></p>`,
    }, 'owner'),
    fsSet(`posts/${ids.echo}`, { ...basePost, text: `Post comum <img src=x onerror="${RUN}"> fim ${stamp}` }, 'owner'),
    fsSet(`posts/${ids.jsonld}`, { ...basePost, text: `</script><script>window.__xss=9//${stamp}` }, 'owner'),
    fsSet(`posts/${ids.quote}`, {
      ...basePost, type: 'quote', text: `Citando ${stamp}`,
      originalPostDetails: { id: ids.echo, authorDetails: author, type: 'original', category: 'echo', visibility: 'public', text: `Cópia <img src=x onerror="${RUN}"> citada ${stamp}`, createdAt: now.toISOString() },
    }, 'owner'),
  ];
  const results = await Promise.all(writes);
  const bad = results.filter((r) => r.status !== 200);
  check(bad.length === 0, `falhou ao semear: ${bad.map((r) => r.status).join(', ')}`);
});

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER, headless: true });
const context = await browser.newContext();
// Nada de rede externa (o embed do YouTube só precisa existir no DOM).
await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
const page = await context.newPage();
const dialogs = [];
page.on('dialog', (dialog) => { dialogs.push(dialog.message()); dialog.dismiss().catch(() => {}); });
const ran = async () => page.evaluate(() => window.__xss);

const visit = async (path, expectedText) => {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' });
  await page.getByText(expectedText).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500); // tempo para um onerror atrasado disparar
  const value = await ran();
  check(value === undefined && dialogs.length === 0, `script da carga RODOU (window.__xss=${value}, alerts=${dialogs.length})`);
};

try {
  section('páginas sem login');
  await soft('artigo: o HTML aparece, nada roda, YouTube e hashtag continuam', async () => {
    await visit(`/pt-BR/post/${ids.news}`, `Texto seguro do artigo ${stamp}`);
    check(await page.locator('iframe[src="https://www.youtube.com/embed/dQw4w9WgXcQ"]').count() === 1, 'o embed do YouTube sumiu');
    check(await page.locator(`a[href="/pt-BR/tag/tag${stamp}"]`).count() >= 1, 'a hashtag não virou link');
    check(await page.locator('a[href^="javascript:"]').count() === 0, 'sobrou link javascript:');
    check(await page.locator('a[href="https://example.com/#secao"]').count() === 1, 'a âncora #secao do link foi quebrada pela hashtag');
    check((await page.locator('body').innerText()).includes("'aspas'"), 'a entidade &#39; foi quebrada');
    // Só dentro do corpo do artigo: a própria interface usa position (next/image com fill, popovers).
    check(await page.locator('.prose [style*="position"]').count() === 0, 'sobrou CSS de posicionamento do autor no artigo');
  }, { tag: 'seg' });
  await soft('post comum com "<img onerror>": aparece como texto e não roda', async () => {
    await visit(`/pt-BR/post/${ids.echo}`, `fim ${stamp}`);
  }, { tag: 'seg' });
  await soft('citação: a cópia embutida aparece como texto e não roda', async () => {
    await visit(`/pt-BR/post/${ids.quote}`, `Citando ${stamp}`);
  }, { tag: 'seg' });
  await soft('post com "</script>" no início: o JSON-LD não fecha a tag', async () => {
    await page.goto(`${BASE_URL}/pt-BR/post/${ids.jsonld}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const value = await ran();
    check(value === undefined, `o "</script>" do texto rodou script pelo JSON-LD (window.__xss=${value})`);
  }, { tag: 'seg' });
  await soft('feed Explorar com esses posts: nada roda', async () => {
    await page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);
    const value = await ran();
    check(value === undefined && dialogs.length === 0, `script rodou no feed (window.__xss=${value})`);
  }, { tag: 'seg' });
} finally {
  await browser.close();
}

const results = runner.results;
const failed = results.filter((r) => r.status === 'falhou').length;
console.log(`Resumo: ${results.length - failed} passaram, ${failed} falharam.`);
process.exitCode = failed ? 1 : 0;
