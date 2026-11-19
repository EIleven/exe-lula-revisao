// e2e/anti-bot-guard-check.mjs
// Teste unitário do núcleo autoral Anti-Bot / Anti-Scraping / Anti-Pentest / Anti-QA Não Autorizado.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const src = fs.readFileSync(new URL('../src/lib/security/antiBotGuard.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

const modUrl = `data:text/javascript;base64,${Buffer.from(js, 'utf8').toString('base64')}`;
const { evaluateRequestSecurity, resetAntiBotBuckets } = await import(modUrl);

resetAntiBotBuckets();

// 1. Navegador normal autenticado -> allow
const normal = evaluateRequestSecurity({
  ip: '198.51.100.10',
  path: '/pt-BR/feed',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/132.0',
  acceptLanguage: 'pt-BR,pt;q=0.9',
  isAuthenticated: true,
  nowMs: 1_000_000,
});
assert.equal(normal.allowed, true);
assert.equal(normal.action, 'allow');

// 2. Instância Mastodon legítima no inbox AP -> allow
const mastodon = evaluateRequestSecurity({
  ip: '203.0.113.5',
  path: '/ap/inbox',
  userAgent: 'http.rb/5.1.1 (Mastodon/4.3.0; +https://mastodon.social/)',
  nowMs: 1_000_000,
});
assert.equal(mastodon.allowed, true);

// 3. Scraper / bot sem autenticação -> block
const scraper = evaluateRequestSecurity({
  ip: '198.51.100.99',
  path: '/pt-BR/explore',
  userAgent: 'python-requests/2.31.0',
  nowMs: 1_000_000,
});
assert.equal(scraper.allowed, false);
assert.ok(scraper.reasons.includes('user-agent-automacao'));

// 4. Bot de QA não autorizado (Playwright / HeadlessChrome / WebDriver) -> block mesmo se autenticado!
const unauthorizedQa = evaluateRequestSecurity({
  ip: '198.51.100.120',
  path: '/pt-BR/feed',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/131.0.0.0 Safari/537.36',
  secChUa: '"HeadlessChrome";v="131", "Chromium";v="131"',
  webdriverHeader: '1',
  acceptLanguage: 'pt-BR',
  isAuthenticated: true,
  nowMs: 1_000_000,
});
assert.equal(unauthorizedQa.allowed, false);
assert.equal(unauthorizedQa.action, 'block');
assert.ok(unauthorizedQa.reasons.includes('headless-ou-webdriver'));

// 5. Bot de QA AUTORIZADO pelo proprietário (com chave secreta do dono) -> allow!
const ownerAuthorizedQa = evaluateRequestSecurity({
  ip: '198.51.100.121',
  path: '/pt-BR/feed',
  userAgent: 'Mozilla/5.0 Playwright/1.49 HeadlessChrome/131.0',
  webdriverHeader: '1',
  ownerQaToken: 'soberan_owner_secret_key_2026_master',
  expectedOwnerQaToken: 'soberan_owner_secret_key_2026_master',
  nowMs: 1_000_000,
});
assert.equal(ownerAuthorizedQa.allowed, true);
assert.equal(ownerAuthorizedQa.action, 'allow');
assert.ok(ownerAuthorizedQa.reasons.includes('owner-authorized-qa'));

// 6. Scanner Nmap / Pentest / Sondagem de .env ou SQLi -> block imediato com cooldown longo
const nmapProbe = evaluateRequestSecurity({
  ip: '198.51.100.200',
  path: '/.env',
  userAgent: 'Mozilla/5.0 (compatible; Nmap Scripting Engine; https://nmap.org/book/nse.html)',
  nowMs: 1_000_000,
});
assert.equal(nmapProbe.allowed, false);
assert.equal(nmapProbe.action, 'block');
assert.ok(nmapProbe.reasons.includes('scanner-pentest-detectado'));
assert.ok(nmapProbe.reasons.includes('sondagem-rota-proibida'));
assert.ok(nmapProbe.retryAfterSec >= 120);

const sqliProbe = evaluateRequestSecurity({
  ip: '198.51.100.201',
  path: '/pt-BR/explore',
  query: 'q=1%20UNION%20SELECT%20password%20FROM%20information_schema.tables',
  userAgent: 'Mozilla/5.0 Chrome/131.0',
  acceptLanguage: 'pt-BR',
  nowMs: 1_000_000,
});
assert.equal(sqliProbe.allowed, false);
assert.equal(sqliProbe.action, 'block');
assert.ok(sqliProbe.reasons.includes('payload-exploracao-detectado'));

// 7. Burst/DDoS acima do limite em 10s -> block com cooldown
let lastBurst = null;
for (let i = 0; i < 32; i++) {
  lastBurst = evaluateRequestSecurity({
    ip: '198.51.100.77',
    path: '/api/ap/lookup',
    userAgent: 'Mozilla/5.0 Chrome/130.0',
    acceptLanguage: 'en-US',
    nowMs: 2_000_000 + i * 100,
  });
}
assert.equal(lastBurst.allowed, false);
assert.equal(lastBurst.action, 'block');
assert.ok(lastBurst.retryAfterSec >= 30);

console.log('PASS: antiBotGuard (normal, mastodon, scraper, unauthorized-qa, owner-qa, nmap/pentest, sqli, burst-ddos)');
