#!/usr/bin/env node
/**
 * Teste do PWA contra um build de PRODUÇÃO (`next build` + `next start`) com os emuladores no ar.
 *
 * Fase "install" (padrão), em perfil novo do Chrome:
 *   - o service worker registra e ativa; a página passa a ser controlada por ele;
 *   - todas as URLs do pré-cache respondem 200 (uma que falhe derruba a instalação inteira);
 *   - sem rede, uma rota nunca visitada mostra a página de fallback "Você está offline";
 *   - instalabilidade (Chrome DevTools Protocol): erros que não sejam de ícones reprovam;
 *   - AUDITORIA DOS CACHES depois de fluxos autenticados (cadastro, post, páginas privadas e sondas de
 *     Storage/Firestore com token): nada de autenticação, dado privado ou resposta sensível pode ficar no
 *     Cache Storage (outra origem de dados do Firebase, /api, /__/auth, token na URL, dado da sessão no corpo).
 * Fase "update" (E2E_PHASE=update), no MESMO perfil, com um NOVO build no ar: o service worker novo assume
 * o controle (a página recarrega sozinha), o pré-cache é renovado, as entradas antigas somem e o fallback
 * offline já é o da versão nova (E2E_EXPECT_MARKER).
 *
 * Pré-requisitos: `npm run emulators`; build com NEXT_PUBLIC_USE_EMULATORS=true e valores demo-*;
 * `next start -H localhost -p 9012`. Variáveis: E2E_BASE_URL (padrão http://localhost:9012), E2E_NODE_MODULES,
 * E2E_BROWSER, E2E_OUT (padrão e2e-output/pwa; as duas fases precisam usar o mesmo), E2E_PROFILE_DIR,
 * E2E_OFFLINE_TEXT (padrão "Você está offline"), E2E_EXPECT_MARKER (fase update; padrão "(v2)").
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ADMIN,
  BUCKET,
  EMU,
  createPostViaUi,
  createRunner,
  emulatorsRunning,
  authAccounts,
  loadPlaywright,
  newUser,
  registerViaUi,
  signInRest,
  documentsBase,
} from './lib/harness.mjs';

const BASE_URL = (process.env.E2E_BASE_URL ?? 'http://localhost:9012').replace(/\/+$/, '');
const PHASE = process.env.E2E_PHASE ?? 'install';
const OFFLINE_TEXT = process.env.E2E_OFFLINE_TEXT ?? 'Você está offline';
const EXPECT_MARKER = process.env.E2E_EXPECT_MARKER ?? '(v2)';
const outDir = path.resolve(process.env.E2E_OUT ?? path.join('e2e-output', 'pwa'));
const profileDir = path.resolve(process.env.E2E_PROFILE_DIR ?? path.join(outDir, 'perfil'));
const stateFile = path.join(outDir, 'pwa-state.json');
mkdirSync(outDir, { recursive: true });
if (!['install', 'update'].includes(PHASE)) throw new Error(`E2E_PHASE inválida: ${PHASE} (use install ou update)`);

const { log, step, soft, check } = createRunner(`pwa:${PHASE}`);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const PRECACHE = /^workbox-precache/;
const rand = () => Math.random().toString(36).slice(2, 8);

// Perfil novo só na fase install, e só se estiver dentro da pasta de saída (nunca apaga caminho de fora).
if (PHASE === 'install' && existsSync(profileDir) && profileDir.startsWith(outDir + path.sep)) {
  rmSync(profileDir, { recursive: true, force: true });
}
if (PHASE === 'update' && !existsSync(stateFile)) throw new Error('Rode antes a fase install (falta pwa-state.json em E2E_OUT).');

const { chromium } = await loadPlaywright();
const context = await chromium.launchPersistentContext(profileDir, {
  executablePath: process.env.E2E_BROWSER,
  headless: true,
  viewport: { width: 1440, height: 900 },
  locale: 'pt-BR',
});
const page = context.pages()[0] ?? (await context.newPage());
page.setDefaultTimeout(60_000);
const consoleProblems = [];
context.on('console', (message) => {
  if (['error', 'warning'].includes(message.type())) consoleProblems.push(`${message.type()}: ${message.text().slice(0, 200)}`);
});
const shot = (name) => page.screenshot({ path: path.join(outDir, `${PHASE}-${name}.png`) });

// ---------- consultas feitas dentro da página ----------
const swState = () =>
  page.evaluate(async () => {
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('o service worker não ficou pronto em 60 s')), 60_000)),
    ]);
    // `ready` resolve já com o worker "activating": espera terminar a ativação.
    if (reg.active && reg.active.state !== 'activated') {
      await new Promise((resolve) => {
        const worker = reg.active;
        worker.addEventListener('statechange', () => worker.state === 'activated' && resolve());
        setTimeout(resolve, 30_000);
      });
    }
    return {
      scope: reg.scope,
      state: reg.active?.state,
      script: reg.active?.scriptURL,
      waiting: Boolean(reg.waiting),
      installing: Boolean(reg.installing),
      controlled: Boolean(navigator.serviceWorker.controller),
    };
  });

/** Lista tudo o que há no Cache Storage; em respostas de texto, procura as "agulhas" (dados da sessão). */
const dumpCaches = (needles = []) =>
  page.evaluate(async (needles) => {
    const entries = [];
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        const contentType = response?.headers.get('content-type') ?? '';
        let found = [];
        if (response && response.type !== 'opaque' && /text|json|javascript|xml|x-component/i.test(contentType)) {
          const body = await response.clone().text();
          found = needles.filter((needle) => body.includes(needle));
        }
        entries.push({ cacheName, url: request.url, status: response?.status ?? 0, type: response?.type ?? '', contentType, found });
      }
    }
    return { origin: location.origin, entries };
  }, needles);

// Hosts/portas onde ficam os dados do Firebase: nunca devem parar em cache de runtime.
const DATA_PLANE = /^(127\.0\.0\.1|localhost):(8080|9099|9199|5001|9000)$|(^|\.)(googleapis\.com|firebaseio\.com|firebaseapp\.com|cloudfunctions\.net)(:\d+)?$/;

function classify(origin, entries) {
  const violations = [];
  const flag = (entry, why) => violations.push({ cache: entry.cacheName, url: entry.url, why });
  for (const entry of entries) {
    const url = new URL(entry.url);
    if (entry.found.length) flag(entry, `corpo contém e-mail ou token da sessão (${entry.found.length} item(ns))`);
    if (PRECACHE.test(entry.cacheName)) continue;
    if (DATA_PLANE.test(url.host)) flag(entry, 'resposta do plano de dados do Firebase em cache de runtime');
    else if (url.origin !== origin) flag(entry, 'resposta de OUTRA origem em cache de runtime');
    if (url.origin === origin && /^\/(api|__\/auth)(\/|$)/.test(url.pathname)) flag(entry, 'endpoint de API/autenticação em cache');
    if (/[?&](token|access_token|id_token)=/.test(url.search)) flag(entry, 'token na URL');
  }
  return violations;
}

const summarize = (entries) => {
  const by = new Map();
  for (const entry of entries) by.set(entry.cacheName, (by.get(entry.cacheName) ?? 0) + 1);
  return [...by].map(([name, count]) => `${name.replace(/^workbox-precache-v2-.*/, 'workbox-precache')}=${count}`).join(', ') || '(vazio)';
};

const buildIdOf = (urls) => urls.map((url) => url.match(/\/_next\/static\/([^/]+)\/_buildManifest\.js/)?.[1]).find(Boolean);

async function fetchAll(urls, concurrency = 8) {
  const bad = [];
  let bytes = 0;
  let index = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (index < urls.length) {
        const url = urls[index++];
        try {
          const response = await fetch(url);
          bytes += (await response.arrayBuffer()).byteLength;
          if (response.status !== 200) bad.push(`${response.status} ${new URL(url).pathname}`);
        } catch (error) {
          bad.push(`erro ${new URL(url).pathname}: ${error.message}`);
        }
      }
    }),
  );
  return { bad, bytes };
}

const swHashNow = async () => sha256(await (await fetch(`${BASE_URL}/sw.js`, { cache: 'no-store' })).text());

try {
  await step('pré-checagem: emuladores no ar, /sw.js, /offline e manifest respondem 200', async () => {
    await emulatorsRunning();
    for (const route of ['/sw.js', '/offline', '/manifest.webmanifest']) {
      const response = await fetch(`${BASE_URL}${route}`);
      check(response.status === 200, `${route} retornou HTTP ${response.status}`);
    }
    return `sw.js sha256=${(await swHashNow()).slice(0, 12)}…`;
  });

  if (PHASE === 'install') {
    // ---------- 1. registro, ativação e controle ----------
    await step('service worker: registra e ativa, escopo "/"', async () => {
      await page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'load', timeout: 120_000 });
      const state = await swState();
      check(state.state === 'activated', `estado do service worker: ${state.state}`);
      check(new URL(state.scope).pathname === '/', `escopo inesperado: ${state.scope}`);
      check(new URL(state.script).pathname === '/sw.js', `script inesperado: ${state.script}`);
      return `${state.script} (${state.state})`;
    });

    await step('service worker: a página passa a ser controlada depois de recarregar', async () => {
      await page.reload({ waitUntil: 'load' });
      const state = await swState();
      check(state.controlled, 'a página não está controlada pelo service worker');
      return 'navigator.serviceWorker.controller presente';
    });

    // ---------- 2. pré-cache ----------
    let precacheUrls;
    await step('pré-cache: todas as URLs respondem 200 e não há entrada indevida', async () => {
      const { entries } = await dumpCaches();
      const pre = entries.filter((entry) => PRECACHE.test(entry.cacheName));
      check(pre.length > 0, 'cache de pré-cache vazio');
      precacheUrls = pre.map((entry) => entry.url);
      check(precacheUrls.some((url) => new URL(url).pathname === '/offline'), '/offline não está no pré-cache');
      check(!precacheUrls.some((url) => /app-build-manifest\.json/.test(url)), 'app-build-manifest.json está no pré-cache');
      const { bad, bytes } = await fetchAll(precacheUrls);
      check(bad.length === 0, `${bad.length} URL(s) do pré-cache não respondem 200: ${bad.slice(0, 5).join(' | ')}`);
      return `${precacheUrls.length} URLs, todas 200, ${(bytes / 1024 / 1024).toFixed(2)} MiB; build ${buildIdOf(precacheUrls)}`;
    });

    // ---------- 3. offline ----------
    await step('offline: rota nunca visitada mostra a página de fallback', async () => {
      const route = `${BASE_URL}/pt-BR/privacy?e2e=${rand()}`;
      const online = await page.goto(route, { waitUntil: 'domcontentloaded' });
      check(online?.status() === 200, `online, a rota deveria responder 200 (veio ${online?.status()})`);
      check(!(await page.getByText(OFFLINE_TEXT).count()), 'a página online já mostra o texto de offline');
      await context.setOffline(true);
      try {
        await page.goto(`${BASE_URL}/pt-BR/about?e2e=${rand()}`, { waitUntil: 'domcontentloaded' });
        await page.getByText(OFFLINE_TEXT).first().waitFor({ timeout: 20_000 });
        await shot('offline-fallback');
      } finally {
        await context.setOffline(false);
      }
      return `"${OFFLINE_TEXT}" exibido sem rede`;
    });

    // O app instalado abre no start_url ("/"), que redireciona para o idioma.
    await step('offline: abrir o start_url "/" (app instalado) leva ao idioma online e ao fallback sem rede', async () => {
      const manifest = await (await fetch(`${BASE_URL}/manifest.webmanifest`)).json();
      check(manifest.start_url === '/', `start_url inesperado: ${manifest.start_url}`);
      await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForURL((url) => /^\/(pt-BR|en)(\/|$)/.test(url.pathname), { timeout: 30_000 });
      await page.waitForLoadState('load');
      const landed = new URL(page.url()).pathname;
      const text = (await page.locator('body').innerText()).trim();
      check(text.length > 20, `online, "/" terminou em página vazia (${landed})`);
      await context.setOffline(true);
      try {
        await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
        await page.getByText(OFFLINE_TEXT).first().waitFor({ timeout: 20_000 });
        await shot('offline-start-url');
      } finally {
        await context.setOffline(false);
      }
      return `online: "/" → ${landed}; sem rede: fallback exibido`;
    });

    // ---------- 4. instalabilidade ----------
    await soft('instalação: requisitos do manifest/service worker (CDP)', async () => {
      await page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'load' });
      await swState();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Page.enable');
      // getAppManifest força a busca do manifest; sem ela, o primeiro getInstallabilityErrors responde "no-manifest".
      const manifest = await cdp.send('Page.getAppManifest');
      await page.waitForTimeout(1500);
      const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
      const ids = installabilityErrors.map((error) => error.errorId);
      const others = ids.filter((id) => !/icon/i.test(id));
      const manifestJson = JSON.parse(manifest.data || '{}');
      const iconStatuses = [];
      for (const icon of manifestJson.icons ?? []) {
        iconStatuses.push(`${icon.src}=${(await fetch(new URL(icon.src, BASE_URL))).status}`);
      }
      writeFileSync(path.join(outDir, `${PHASE}-installability.json`), JSON.stringify({ ids, iconStatuses, manifest: manifestJson }, null, 2));
      check(others.length === 0, `erros de instalação que não são de ícone: ${others.join(', ')}`);
      return ids.length
        ? `bloqueada SÓ por ícones (${ids.join(', ')}); ícones do manifest: ${iconStatuses.join(', ')}`
        : 'sem erros: instalável';
    });

    // ---------- 5. auditoria dos caches com fluxos autenticados ----------
    const user = newUser('p');
    let session;
    await step('auditoria: cadastro e login reais, post e navegação por páginas privadas com o service worker ativo', async () => {
      await registerViaUi(page, BASE_URL, user);
      const account = (await authAccounts()).find((a) => a.email === user.email);
      check(account, 'conta não encontrada no Auth emulado');
      session = await signInRest(user.email, user.password);
      await createPostViaUi(page, `Post do teste de PWA ${user.tag}`);
      for (const route of ['/pt-BR/profile', '/pt-BR/messages', '/pt-BR/notifications', '/pt-BR/settings', '/pt-BR/explore']) {
        await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2500);
      }
      await shot('auditoria-paginas');
      return `usuário ${user.username} (${account.localId})`;
    });

    await step('auditoria: sondas de Storage (com token na URL) e Firestore (com Authorization) pela página controlada', async () => {
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      const objectName = `e2e/pwa-${user.tag}.png`;
      const upload = await fetch(`${EMU.storage}/v0/b/${BUCKET}/o?name=${encodeURIComponent(objectName)}`, {
        method: 'POST',
        headers: { ...ADMIN, 'Content-Type': 'image/png' },
        body: png,
      });
      check(upload.ok, `upload no Storage emulado retornou HTTP ${upload.status}`);
      const token = (await upload.json()).downloadTokens;
      const storageUrl = `${EMU.storage}/v0/b/${BUCKET}/o/${encodeURIComponent(objectName)}?alt=media&token=${token}`;
      const firestoreUrl = `${documentsBase()}/users/${session.localId}`;
      await page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'load' });
      const probes = await page.evaluate(
        async ({ storageUrl, firestoreUrl, idToken }) => {
          const out = {};
          try { out.storageFetch = (await fetch(storageUrl)).status; } catch (error) { out.storageFetch = String(error); }
          try {
            await new Promise((resolve, reject) => {
              const img = new Image();
              img.onload = resolve;
              img.onerror = reject;
              img.src = `${storageUrl}&via=img`;
            });
            out.storageImg = 'carregou';
          } catch { out.storageImg = 'erro'; }
          try { out.firestoreGet = (await fetch(firestoreUrl, { headers: { Authorization: `Bearer ${idToken}` } })).status; } catch (error) { out.firestoreGet = String(error); }
          return out;
        },
        { storageUrl, firestoreUrl, idToken: session.idToken },
      );
      await page.waitForTimeout(2000); // o cache.put do service worker termina depois da resposta
      return `Storage fetch=${probes.storageFetch}, img=${probes.storageImg}; Firestore GET=${probes.firestoreGet}`;
    });

    let audit;
    await soft('auditoria: nada sensível no Cache Storage', async () => {
      // Só dados PRIVADOS da sessão: e-mail e token. O uid, o @usuário e o nome são públicos (aparecem na URL e na
      // página do perfil), então achá-los num payload de rota não é vazamento.
      const needles = [user.email, session.idToken.slice(0, 60)];
      audit = await dumpCaches(needles);
      const violations = classify(audit.origin, audit.entries);
      const runtime = audit.entries.filter((entry) => !PRECACHE.test(entry.cacheName));
      writeFileSync(path.join(outDir, `${PHASE}-caches.json`), JSON.stringify({ entries: audit.entries, violations }, null, 2));
      log(`      caches: ${summarize(audit.entries)}`);
      for (const entry of runtime.slice(0, 40)) log(`      runtime [${entry.cacheName}] ${entry.status} ${entry.type} ${entry.url.replace(/(token=)[^&]+/, '$1…').slice(0, 130)}`);
      if (runtime.length > 40) log(`      … e mais ${runtime.length - 40} entradas de runtime`);
      check(
        violations.length === 0,
        `${violations.length} entrada(s) indevida(s): ` +
          violations.slice(0, 6).map((v) => `[${v.cache}] ${v.why}: ${v.url.replace(/(token=)[^&]+/, '$1…').slice(0, 90)}`).join(' | '),
      );
      return `${audit.entries.length} entradas (${runtime.length} de runtime), nenhuma indevida`;
    });

    // ---------- estado para a fase update ----------
    const { entries } = await dumpCaches();
    writeFileSync(
      stateFile,
      JSON.stringify(
        {
          swSha256: await swHashNow(),
          precacheUrls: entries.filter((entry) => PRECACHE.test(entry.cacheName)).map((entry) => entry.url),
          runtimeUrls: entries.filter((entry) => !PRECACHE.test(entry.cacheName)).map((entry) => entry.url),
          savedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    log(`estado salvo em ${stateFile}`);
  } else {
    // ---------- fase update ----------
    const old = JSON.parse(readFileSync(stateFile, 'utf8'));
    await step('update: o build novo no ar tem um sw.js diferente do anterior', async () => {
      const now = await swHashNow();
      check(now !== old.swSha256, 'o sw.js é idêntico ao da fase install (suba um build NOVO antes)');
      return `antes ${old.swSha256.slice(0, 12)}… → agora ${now.slice(0, 12)}…`;
    });

    await step('update: o service worker novo assume e a página recarrega sozinha', async () => {
      await page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'load', timeout: 120_000 });
      const before = await swState();
      check(before.controlled, 'a página abriu sem controle do service worker antigo (perfil da fase install?)');
      await page.evaluate(() => { window.__e2eMarker = Date.now(); });
      await page.waitForFunction(() => !window.__e2eMarker, null, { timeout: 60_000 });
      await page.waitForLoadState('load');
      const after = await swState();
      check(after.state === 'activated' && after.controlled, `depois da atualização: estado ${after.state}, controlada=${after.controlled}`);
      check(!after.waiting && !after.installing, 'ainda há service worker em espera/instalando');
      return 'recarregou após controllerchange; novo service worker ativo e no controle';
    });

    await step('update: pré-cache renovado (entradas antigas removidas, novas presentes, todas 200)', async () => {
      const { entries } = await dumpCaches();
      const pre = entries.filter((entry) => PRECACHE.test(entry.cacheName)).map((entry) => entry.url);
      const all = new Set(entries.map((entry) => entry.url));
      const oldOnly = old.precacheUrls.filter((url) => !pre.includes(url));
      const stale = oldOnly.filter((url) => all.has(url));
      const fresh = pre.filter((url) => !old.precacheUrls.includes(url));
      check(oldOnly.length > 0 && fresh.length > 0, `nada mudou no pré-cache (removidas ${oldOnly.length}, novas ${fresh.length})`);
      check(stale.length === 0, `${stale.length} entrada(s) antiga(s) continuam em algum cache: ${stale.slice(0, 3).join(' | ')}`);
      const { bad } = await fetchAll(pre);
      check(bad.length === 0, `URLs do pré-cache novo sem 200: ${bad.slice(0, 5).join(' | ')}`);
      const oldBuild = buildIdOf(old.precacheUrls);
      const newBuild = buildIdOf(pre);
      check(newBuild && newBuild !== oldBuild, `build id não mudou (${oldBuild} → ${newBuild})`);
      return `build ${oldBuild} → ${newBuild}; ${oldOnly.length} removidas, ${fresh.length} novas, ${pre.length} no total`;
    });

    await step('update: entradas de runtime da versão anterior não ficaram para trás', async () => {
      const { entries } = await dumpCaches();
      const runtimeNow = new Set(entries.filter((entry) => !PRECACHE.test(entry.cacheName)).map((entry) => entry.url));
      const leftovers = old.runtimeUrls.filter((url) => runtimeNow.has(url) && /\/_next\/static\//.test(url));
      check(leftovers.length === 0, `${leftovers.length} arquivo(s) de build antigo em cache de runtime: ${leftovers.slice(0, 3).join(' | ')}`);
      return `${runtimeNow.size} entrada(s) de runtime agora; nenhuma de build antigo`;
    });

    await step(`offline: o fallback já é o da versão nova ("${EXPECT_MARKER}")`, async () => {
      await context.setOffline(true);
      try {
        await page.goto(`${BASE_URL}/pt-BR/about?e2e=${rand()}`, { waitUntil: 'domcontentloaded' });
        await page.getByText(OFFLINE_TEXT).first().waitFor({ timeout: 20_000 });
        const text = await page.locator('body').innerText();
        check(text.includes(EXPECT_MARKER), `o fallback offline não tem "${EXPECT_MARKER}": "${text.replace(/\s+/g, ' ').slice(0, 80)}"`);
        await shot('offline-fallback-novo');
      } finally {
        await context.setOffline(false);
      }
      return 'fallback offline da versão nova';
    });
  }

  const noisy = [...new Set(consoleProblems)].filter((text) => /service ?worker|workbox|precach|sw\.js/i.test(text));
  await step('console: nenhum erro/aviso de service worker, Workbox ou pré-cache', async () => {
    check(noisy.length === 0, noisy.slice(0, 4).join(' | '));
    return `${consoleProblems.length} mensagem(ns) de console no total, nenhuma sobre service worker`;
  });
} catch (error) {
  process.exitCode = 1;
  log(`interrompido: ${String(error?.message ?? error).split('\n')[0]}`);
} finally {
  await context.close();
  log(process.exitCode ? 'RESULTADO: FALHOU' : 'RESULTADO: PASSOU');
}
