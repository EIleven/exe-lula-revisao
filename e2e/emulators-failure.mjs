#!/usr/bin/env node
/**
 * Teste NEGATIVO (sem fallback silencioso para produção).
 *
 * Com os emuladores FORA DO AR e o app em modo emulador, o app deve:
 *   1. mostrar a faixa vermelha "Emuladores Firebase indisponíveis";
 *   2. registrar um console.error claro;
 *   3. falhar ao tentar entrar (login) SEM falar com nenhum endpoint real do Google/Firebase.
 *
 * Pré-requisitos: app em modo emulador rodando (npm run dev -- -H localhost) e os emuladores PARADOS.
 * Variáveis: E2E_NODE_MODULES, E2E_BROWSER, E2E_BASE_URL (padrão http://localhost:9002), E2E_OUT.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:9002';
const outDir = process.env.E2E_OUT ?? path.resolve('e2e-output', `falha-${Date.now().toString(36)}`);
mkdirSync(outDir, { recursive: true });
const REAL_GOOGLE_HOSTS =
  /(^|\.)(googleapis\.com|firebaseio\.com|firebaseapp\.com|cloudfunctions\.net|google-analytics\.com|googletagmanager\.com|googlesyndication\.com|doubleclick\.net|gstatic\.com|google\.com)$/;

// Única exceção conhecida: quando o SDK do Firestore (WebChannel) não alcança o servidor, ele pede um GIF de 1 pixel
// ao Google só para testar conectividade. Não leva projeto, usuário nem dado algum (apenas um parâmetro aleatório).
const SDK_CONNECTIVITY_PROBE = /^https:\/\/www\.google\.com\/images\/cleardot\.gif\?zx=[a-z0-9]+$/;

async function loadPlaywright() {
  const file = process.env.E2E_NODE_MODULES && path.join(process.env.E2E_NODE_MODULES, 'playwright-core', 'index.mjs');
  if (file && existsSync(file)) return import(pathToFileURL(file).href);
  return import('playwright-core');
}
const log = (message) => console.log(`[e2e-falha ${new Date().toISOString().slice(11, 19)}] ${message}`);
const fail = (message) => {
  log(`FALHA — ${message}`);
  process.exitCode = 1;
};

// Pré-condição: os emuladores precisam estar parados, senão o teste não prova nada.
try {
  await fetch('http://127.0.0.1:4400/emulators', { signal: AbortSignal.timeout(2500) });
  log('Os emuladores ainda estão no ar. Pare-os antes de rodar este teste.');
  process.exit(2);
} catch {
  log('Pré-condição ok: o hub dos emuladores está inacessível.');
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
const page = await context.newPage();
page.setDefaultTimeout(90_000);
const hosts = new Set();
const realUrls = [];
const consoleErrors = [];
page.on('request', (request) => {
  const { hostname } = new URL(request.url());
  hosts.add(hostname);
  if (REAL_GOOGLE_HOSTS.test(hostname)) realUrls.push(request.url());
});
page.on('console', (message) => message.type() === 'error' && consoleErrors.push(message.text()));

try {
  await page.goto(`${BASE_URL}/pt-BR/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 });

  // 1. Faixa vermelha
  const banner = page.locator('[data-testid="emulator-banner"][data-status="error"]');
  await banner.waitFor({ timeout: 90_000 });
  const bannerText = (await banner.innerText()).replace(/\s+/g, ' ');
  await page.screenshot({ path: path.join(outDir, '01-faixa-de-erro.png') });
  if (!/indisponíveis/i.test(bannerText) || !/não usará o projeto real/i.test(bannerText)) {
    fail(`texto inesperado na faixa: "${bannerText}"`);
  } else {
    log(`OK    faixa vermelha exibida: "${bannerText}"`);
  }

  // 2. console.error claro
  const clear = consoleErrors.find((text) => text.includes('[emuladores]') && /NÃO usará o projeto real/.test(text));
  if (!clear) fail('nenhum console.error claro com "[emuladores] ... NÃO usará o projeto real"');
  else log(`OK    console.error claro: "${clear.slice(0, 140)}..."`);

  // 3. Tentar entrar não pode chegar ao Firebase real
  await page.fill('#email', 'qualquer@example.test');
  await page.fill('#password', 'Teste!123456');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByText(/Erro no Login|Falha no Login/).first().waitFor({ timeout: 60_000 });
  await page.screenshot({ path: path.join(outDir, '02-login-falha.png') });
  log('OK    o login falhou (erro mostrado ao usuário), como esperado sem emuladores');

  const probes = realUrls.filter((url) => SDK_CONNECTIVITY_PROBE.test(url));
  const unexpected = realUrls.filter((url) => !SDK_CONNECTIVITY_PROBE.test(url));
  if (unexpected.length) fail(`requisições a hosts REAIS: ${unexpected.join(' , ')}`);
  else {
    log(`OK    nenhuma requisição ao Firebase/Google real, exceto a sonda de conectividade do SDK: ${probes.length}`);
    log(`      (GIF de 1 pixel cleardot.gif; sem dados do projeto). Hosts: ${[...hosts].sort().join(', ')}`);
  }
} catch (error) {
  fail(String(error?.message ?? error).split('\n')[0]);
} finally {
  await browser.close();
  writeFileSync(
    path.join(outDir, 'summary.json'),
    JSON.stringify({ hosts: [...hosts].sort(), realUrls, consoleErrors: [...new Set(consoleErrors)].slice(0, 20) }, null, 2),
  );
  log(process.exitCode ? 'RESULTADO: FALHOU' : 'RESULTADO: PASSOU');
}
