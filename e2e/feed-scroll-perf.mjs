#!/usr/bin/env node
/**
 * Mede a ROLAGEM do feed num celular simulado (412x915, toque, CPU limitada) contra os emuladores e o app local, com um feed
 * realista (texto, imagens de verdade, artigos, enquetes, conteúdo sensível, localização).
 *
 *   node e2e/feed-scroll-perf.mjs --rotulo antes --url http://localhost:9004 [--posts 72] [--cpu 4] [--repeticoes 3]
 *                                 [--sem-semear] [--sem-reset]
 *
 * O que se mede (em cada cenário de rolagem, com dedos sintetizados pelo próprio Chrome):
 *   - quadros: tempo entre quadros (rAF) e quantos passaram de 33 ms e de 50 ms ("engasgos");
 *   - tarefas longas (Long Tasks, > 50 ms) e quadros longos de animação (LoAF) com o tempo de bloqueio;
 *   - atraso de entrada dos toques (Event Timing: do dedo encostar até o app começar a tratar);
 *   - mudança de layout acumulada (CLS) durante a rolagem;
 *   - COMMITS DO REACT durante a rolagem e quantos componentes foram redesenhados em cada um (um "gancho" do DevTools do React
 *     injetado só no navegador de teste: nada no app). Rolar não deveria redesenhar o feed;
 *   - tempo de script, layout e recálculo de estilo, memória do JavaScript e nós do DOM (CDP Performance.getMetrics).
 * Cenários: carga do feed (montar ~60 cartões), rolagem contínua, inversões de direção, rolar e parar, puxões no topo, e coisas
 * que acontecem de fora com o feed na tela (seguidor novo, notificação, mensagem não lida, a barra do navegador que some e volta,
 * curtir): nenhuma delas deveria redesenhar o feed.
 * Nada fica instalado no app: a instrumentação vive só neste arquivo, no navegador de teste.
 *
 * Saída: tabela no terminal e JSON em E2E_OUT (padrão e2e-output/desempenho-<rotulo>.json). Rode com a mesma máquina parada
 * (sem outras suítes) e compare `antes` x `depois`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  EMU, authAccounts, ensureSignupControl, fsSet, fsUpsert, loadPlaywright, loginViaUi, newUser, registerViaUi, resetEmulators, storageUpload,
} from './lib/harness.mjs';
import { dedo as dedoNativo } from './lib/touch.mjs';

// ------------------------------------------------------------------------------------------------------------ argumentos
const args = process.argv.slice(2);
const opt = (name, padrao) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : padrao;
};
const flag = (name) => args.includes(`--${name}`);
// --so a,b,c: roda só estes cenários (a carga do feed sempre acontece, medida ou não).
const SO = opt('so', '').split(',').map((x) => x.trim()).filter(Boolean);
const quer = (nome) => SO.length === 0 || SO.includes(nome);
// --css "regras": injeta CSS no navegador de teste (comparar com/sem uma regra no MESMO build, por exemplo content-visibility).
const CSS_EXTRA = opt('css', '');
const ROTULO = opt('rotulo', 'medicao');
const BASE_URL = opt('url', 'http://localhost:9004').replace(/\/+$/, '');
const TOTAL_POSTS = Number(opt('posts', '72'));
// --android: mede no Chrome do EMULADOR ANDROID (DevTools em localhost:9222 via `adb forward`; o app e os emuladores do Firebase chegam
// por `adb reverse`), em vez de num celular simulado. Sem limite de CPU (o aparelho já é o aparelho). --visitante: sem login.
const ANDROID = flag('android');
const VISITANTE = flag('visitante');
const CPU = Number(opt('cpu', ANDROID ? '1' : '4'));
/** Tamanho da janela onde os dedos caem (celular simulado: 412x915; no Android é lido do aparelho). */
let TELA = { largura: 412, altura: 915 };
const REPETICOES = Number(opt('repeticoes', '3'));
const OUT_DIR = path.resolve(process.env.E2E_OUT ?? 'e2e-output');
mkdirSync(OUT_DIR, { recursive: true });
const stamp = Date.now().toString(36);
const log = (msg) => console.log(`[desempenho ${new Date().toISOString().slice(11, 19)}] ${msg}`);

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER, headless: true });
const dispositivo = ANDROID ? await chromium.connectOverCDP('http://localhost:9222') : null;

// ---------------------------------------------------------------------------------------------------- dados de teste
const TEXTOS = [
  'Bom dia, pessoal! Começando a semana com muita energia e vontade de fazer acontecer.',
  'Alguém mais acha que o transporte público da cidade precisa de uma revisão séria? Cada dia uma novidade.',
  'Acabei de ler um artigo ótimo sobre economia solidária e como ela muda a vida de comunidades inteiras. Recomendo muito!',
  'Reunião de hoje foi produtiva. Fechamos as metas do trimestre e definimos as próximas ações com a equipe.',
  'O que vocês acham da nova proposta? Quero ouvir opiniões de quem trabalha na área antes de formar a minha.',
  'Receita de domingo: bolo de fubá com café fresquinho. Quem aceita um pedaço?',
  'Hoje o dia foi longo, mas valeu cada minuto. Gratidão por tudo que construímos até aqui.',
  'Dica rápida: organize a semana no domingo à noite. Muda tudo, sem exagero nenhum. #produtividade',
  'Cultura é investimento, não gasto. E quem vive disso sabe o quanto o setor movimenta a economia local.',
  'Ótimo jogo ontem! Que partida emocionante, torcida inteira vibrando até o apito final.',
];
const MANCHETES = [
  'Governo anuncia pacote de investimentos em infraestrutura para as regiões Norte e Nordeste',
  'Pesquisa mostra crescimento do emprego formal no terceiro trimestre do ano',
  'Cientistas brasileiros desenvolvem nova técnica para monitorar desmatamento por satélite',
  'Educação: programa federal amplia vagas em tempo integral nas escolas públicas',
];
const PARAGRAFOS = [
  'O anúncio foi feito em coletiva de imprensa na manhã desta terça-feira, com a presença de ministros e governadores.',
  'Segundo os responsáveis, o investimento deve gerar milhares de empregos diretos e indiretos ao longo dos próximos anos.',
  'Especialistas ouvidos pela reportagem avaliam que a medida pode reduzir desigualdades regionais, desde que haja fiscalização.',
  'A população poderá acompanhar o andamento das obras por meio de um painel público atualizado mensalmente.',
  'Entidades representativas pedem transparência na aplicação dos recursos e participação social nas decisões.',
];
const FORMATOS = [[1280, 720], [1080, 1350], [1200, 1200], [1600, 900], [900, 1200], [1000, 667], [1280, 960], [720, 1280]];
const MUNICIPIOS = [{ name: 'São Paulo', state: 'SP', ibgeId: 3550308 }, { name: 'Recife', state: 'PE', ibgeId: 2611606 }, { name: 'Salvador', state: 'BA', ibgeId: 2927408 }];

async function gerarJpeg(page, width, height, seed) {
  return Buffer.from(await page.evaluate(([w, h, s0]) => {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d');
    let s = s0 * 9301 + 49297;
    const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, `hsl(${Math.floor(rnd() * 360)},65%,45%)`);
    grad.addColorStop(1, `hsl(${Math.floor(rnd() * 360)},70%,30%)`);
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) {
      g.fillStyle = `hsla(${Math.floor(rnd() * 360)},70%,60%,${0.1 + rnd() * 0.35})`;
      g.beginPath(); g.arc(rnd() * w, rnd() * h, 12 + rnd() * Math.min(w, h) / 5, 0, Math.PI * 2); g.fill();
    }
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) { const n = (rnd() - 0.5) * 24; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
    g.putImageData(img, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.82).split(',')[1];
  }, [width, height, seed]), 'base64');
}

async function semear() {
  log(`semeando ${TOTAL_POSTS} posts (texto, imagens, artigos, enquetes, sensível, localização)...`);
  const page = await browser.newPage();
  const autores = ['Marina Lopes', 'João Pereira', 'Carla Nunes', 'Pedro Alves', 'Ana Souza'].map((name, i) => ({
    uid: `perf_autor_${i}_${stamp}`, name, username: `perf${i}${stamp}`.slice(0, 15), avatarUrl: '/profile.png',
  }));
  for (const a of autores) {
    await fsSet(`users/${a.uid}`, { name: a.name, name_lowercase: a.name.toLowerCase(), username: a.username, avatarUrl: a.avatarUrl, bio: 'Autor de teste de desempenho.', createdAt: new Date(), followersCount: 0, followingCount: 0, postsCount: 0, profileVisibility: 'public', dmPreference: 'everyone' }, 'owner');
  }
  const agora = Date.now();
  let imagens = 0;
  const upload = async (indice, uid) => {
    const [w, h] = FORMATOS[indice % FORMATOS.length];
    const bytes = await gerarJpeg(page, w, h, indice + 1);
    const objeto = `user_uploads/${uid}/postMedia/images/perf-${stamp}-${indice}.jpg`;
    const r = await storageUpload(objeto, bytes, 'image/jpeg', 'owner');
    if (r.status !== 200) throw new Error(`upload da imagem ${indice}: HTTP ${r.status}`);
    imagens++;
    return { url: `${EMU.storage}/v0/b/demo-soberan.appspot.com/o/${encodeURIComponent(objeto)}?alt=media`, type: 'image', alt: `Imagem de teste ${indice + 1}` };
  };
  for (let i = 0; i < TOTAL_POSTS; i++) {
    const autor = autores[i % autores.length];
    const tipo = i % 12; // mistura determinística
    const base = {
      userId: autor.uid, authorDetails: { userId: autor.uid, name: autor.name, username: autor.username, avatarUrl: autor.avatarUrl }, type: 'original', visibility: 'public',
      allowReposts: true, replyPermission: 'everyone', likes: (i * 7) % 40, reposts: (i * 3) % 9, quotesCount: i % 4, commentsCount: (i * 5) % 12, views: 50 + i * 11,
      isEdited: false, editCount: 0, isDeleted: false, postFormat: 'standard', createdAt: new Date(agora - i * 20 * 60_000), isLikedBy: {},
    };
    let post;
    if (tipo === 3 || tipo === 9) { // artigo
      const media = [await upload(i, autor.uid)];
      post = { ...base, category: 'news', headline: MANCHETES[i % MANCHETES.length], text: PARAGRAFOS.map((p) => `<p>${p}</p>`).join(''), newsCategory: i % 2 ? 'Política' : 'Economia', sourceUrl: 'https://exemplo.com.br/noticia', media, hasMedia: true };
    } else if (tipo === 1 || tipo === 5 || tipo === 7) { // 1 imagem
      const media = [await upload(i, autor.uid)];
      post = { ...base, category: 'echo', text: TEXTOS[i % TEXTOS.length], media, hasMedia: true };
    } else if (tipo === 6) { // 2 a 4 imagens
      const quantas = 2 + (i % 3);
      const media = [];
      for (let k = 0; k < quantas; k++) media.push(await upload(i * 10 + k, autor.uid));
      post = { ...base, category: 'echo', text: TEXTOS[i % TEXTOS.length], media, hasMedia: true, location: MUNICIPIOS[i % MUNICIPIOS.length] };
    } else if (tipo === 8) { // enquete
      post = { ...base, category: 'echo', text: 'Qual a melhor forma de começar a semana?', hasMedia: false, media: null,
        poll: { options: [{ id: 'a', text: 'Com café' }, { id: 'b', text: 'Com exercício' }, { id: 'c', text: 'Dormindo mais' }], endsAt: new Date(agora + 3 * 24 * 3_600_000) },
        pollOptionIds: ['a', 'b', 'c'], pollCounts: { a: 12, b: 7, c: 9 }, pollTotal: 28 };
    } else if (tipo === 10) { // conteúdo sensível (mídia com aviso)
      const media = [await upload(i, autor.uid)];
      post = { ...base, category: 'echo', text: 'Conteúdo marcado como sensível pelo autor.', media, hasMedia: true, sensitive: true };
    } else { // só texto
      post = { ...base, category: 'echo', text: `${TEXTOS[i % TEXTOS.length]} ${i % 3 === 0 ? TEXTOS[(i + 4) % TEXTOS.length] : ''}`.trim(), hasMedia: false, media: null };
    }
    await fsSet(`posts/perf_${stamp}_${String(i).padStart(3, '0')}`, post, 'owner');
  }
  await page.close();
  log(`semeados: ${TOTAL_POSTS} posts, ${imagens} imagens enviadas ao Storage.`);
}

// -------------------------------------------------------------------------------------------- instrumentação do navegador
/** Roda ANTES do app: observadores de desempenho e o gancho do DevTools do React (conta commits e componentes redesenhados). */
function instrumentar() {
  const P = (window.__perf = { minY: 0, maxY: 0, on: false, frames: [], longTasks: [], loaf: [], events: [], cls: 0, commits: 0, componentsRendered: 0, commitSizes: [] });
  window.addEventListener('scroll', () => { if (P.on) { const y = window.scrollY; if (y < P.minY) P.minY = y; if (y > P.maxY) P.maxY = y; } }, { passive: true });
  let last = 0;
  const tick = (t) => { if (P.on && last) P.frames.push(t - last); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const observar = (type, cb, extra = {}) => { try { new PerformanceObserver((list) => list.getEntries().forEach(cb)).observe({ type, buffered: false, ...extra }); } catch { /* o navegador não oferece */ } };
  observar('longtask', (e) => { if (P.on) P.longTasks.push({ start: e.startTime, duration: e.duration }); });
  observar('long-animation-frame', (e) => { if (P.on) P.loaf.push({ start: e.startTime, duration: e.duration, blocking: e.blockingDuration ?? 0 }); });
  observar('layout-shift', (e) => { if (P.on && !e.hadRecentInput) P.cls += e.value; });
  observar('event', (e) => { if (P.on) P.events.push({ type: e.name, duration: e.duration, delay: e.processingStart - e.startTime }); }, { durationThreshold: 16 });
  const isFn = (tag) => tag === 0 || tag === 11 || tag === 15;
  const contar = (next, prev) => {
    let n = isFn(next.tag) && (next.flags & 1) ? 1 : 0;
    if (!prev || next.child !== prev.child) { // subárvore tocada neste commit
      for (let child = next.child; child; child = child.sibling) n += contar(child, child.alternate);
    }
    return n;
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, isDisabled: false, renderers: new Map(),
    inject(renderer) { const id = this.renderers.size + 1; this.renderers.set(id, renderer); return id; },
    onCommitFiberRoot(_id, root) {
      if (!P.on) return;
      P.commits++;
      const n = contar(root.current, root.current.alternate);
      P.componentsRendered += n;
      P.commitSizes.push(n);
    },
    onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, onScheduleFiberRoot() {}, checkDCE() {},
  };
  P.start = () => { P.minY = P.maxY = window.scrollY; P.on = true; P.frames.length = 0; P.longTasks.length = 0; P.loaf.length = 0; P.events.length = 0; P.cls = 0; P.commits = 0; P.componentsRendered = 0; P.commitSizes.length = 0; };
  P.stop = () => { P.on = false; return { minY: P.minY, maxY: P.maxY, frames: P.frames.slice(), longTasks: P.longTasks.slice(), loaf: P.loaf.slice(), events: P.events.slice(), cls: P.cls, commits: P.commits, componentsRendered: P.componentsRendered, commitSizes: P.commitSizes.slice() }; };
}

// ------------------------------------------------------------------------------------------------------------ estatística
const quantil = (valores, q) => {
  if (valores.length === 0) return 0;
  const ordenado = valores.slice().sort((a, b) => a - b);
  return ordenado[Math.min(ordenado.length - 1, Math.floor(q * ordenado.length))];
};
const soma = (valores) => valores.reduce((a, b) => a + b, 0);
const mediana = (valores) => quantil(valores, 0.5);
const arred = (n, casas = 1) => Math.round(n * 10 ** casas) / 10 ** casas;

function resumir(bruto, deltaCdp, rolou) {
  const quadros = bruto.frames;
  const longas = bruto.longTasks;
  const entradas = bruto.events.filter((e) => /^(pointer|touch|click)/.test(e.type));
  return {
    rolouPx: Math.round(rolou),
    faixaDeRolagemPx: Math.round(bruto.maxY - bruto.minY),
    quadros: quadros.length,
    quadroMedianoMs: arred(mediana(quadros)),
    quadroP95Ms: arred(quantil(quadros, 0.95)),
    quadroP99Ms: arred(quantil(quadros, 0.99)),
    quadroMaxMs: arred(Math.max(0, ...quadros)),
    quadrosAcima33ms: quadros.filter((q) => q > 33.4).length,
    quadrosAcima50ms: quadros.filter((q) => q > 50).length,
    tarefasLongas: longas.length,
    tarefasLongasTotalMs: arred(soma(longas.map((t) => t.duration))),
    tarefaLongaMaxMs: arred(Math.max(0, ...longas.map((t) => t.duration))),
    loafQuadrosLongos: bruto.loaf.length,
    loafBloqueioTotalMs: arred(soma(bruto.loaf.map((l) => l.blocking))),
    atrasoEntradaMaxMs: arred(Math.max(0, ...entradas.map((e) => e.delay))),
    entradasLentas: entradas.filter((e) => e.delay > 50 || e.duration > 100).length,
    cls: arred(bruto.cls, 4),
    commitsReact: bruto.commits,
    componentesRedesenhados: bruto.componentsRendered,
    maiorCommit: Math.max(0, ...bruto.commitSizes),
    scriptMs: arred(deltaCdp.ScriptDuration * 1000),
    layoutMs: arred(deltaCdp.LayoutDuration * 1000),
    estiloMs: arred(deltaCdp.RecalcStyleDuration * 1000),
    tarefaMs: arred(deltaCdp.TaskDuration * 1000),
    layouts: Math.round(deltaCdp.LayoutCount),
    recalculosEstilo: Math.round(deltaCdp.RecalcStyleCount),
  };
}

// ------------------------------------------------------------------------------------------------------------- cenários
async function metricasCdp(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}
const diferenca = (depois, antes) => Object.fromEntries(Object.keys(depois).map((k) => [k, (depois[k] ?? 0) - (antes[k] ?? 0)]));

/**
 * Dedo arrastando a partir de (x, y), por toques nativos (veja lib/touch.mjs: o gesto sintetizado "touch" do CDP NÃO rola a
 * página). yDistance negativo = dedo para CIMA (a página rola para baixo). `fling: false` solta o dedo parado (sem inércia).
 */
const dedo = (cdp, { x = TELA.largura / 2, y = Math.round(TELA.altura * 0.76), yDistance = 0, xDistance = 0, speed = 1500, fling = true }) =>
  dedoNativo(cdp, { x, y, dx: xDistance, dy: yDistance, speed, fling, largura: TELA.largura, altura: TELA.altura });

async function assentar(page) {
  let anterior = -1;
  for (let i = 0; i < 20; i++) {
    const atual = await page.evaluate(() => window.scrollY);
    if (Math.abs(atual - anterior) < 1) return;
    anterior = atual;
    await page.waitForTimeout(120);
  }
}

async function medir(page, cdp, nome, corpo, { rolagemMinima = 0 } = {}) {
  await assentar(page);
  await page.waitForTimeout(500);
  const y0 = await page.evaluate(() => window.scrollY);
  const antes = await metricasCdp(cdp);
  await page.evaluate(() => window.__perf.start());
  await corpo();
  await assentar(page);
  await page.waitForTimeout(450); // o que o app ainda faz logo depois de parar (por exemplo, a gravação da posição)
  const bruto = await page.evaluate(() => window.__perf.stop());
  const depois = await metricasCdp(cdp);
  const y1 = await page.evaluate(() => window.scrollY);
  const resumo = resumir(bruto, diferenca(depois, antes), Math.abs(y1 - y0));
  resumo.heapMB = arred((depois.JSHeapUsedSize ?? 0) / 1048576);
  resumo.nosDomAoFinal = Math.round(depois.Nodes ?? 0);
  if (resumo.faixaDeRolagemPx < rolagemMinima) throw new Error(`o cenário "${nome}" só rolou ${resumo.faixaDeRolagemPx} px (mínimo ${rolagemMinima}): a rolagem não aconteceu, a medição não vale`);
  log(`  ${nome}: rolou ${resumo.faixaDeRolagemPx} px, ${resumo.quadros} quadros, p95 ${resumo.quadroP95Ms} ms, ${resumo.quadrosAcima50ms} > 50 ms, ${resumo.tarefasLongas} tarefas longas, ${resumo.commitsReact} commits do React (${resumo.componentesRedesenhados} componentes), atraso de entrada máx ${resumo.atrasoEntradaMaxMs} ms`);
  return resumo;
}

async function rodada(viewer, numero) {
  const context = ANDROID ? dispositivo.contexts()[0] : await browser.newContext({
    viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, hasTouch: true, isMobile: true, locale: 'pt-BR', serviceWorkers: 'block',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  });
  await context.addInitScript(instrumentar);
  const page = await context.newPage();
  await page.bringToFront(); // sem a aba na frente o Chrome não rola a página com os toques de teste
  page.setDefaultTimeout(60_000);
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e.message).slice(0, 200)));
  if (!VISITANTE) await loginViaUi(page, BASE_URL, viewer);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');

  // Abre o feed e carrega até ~60 cartões (a pior situação: tudo no DOM). Esta carga já é medida, com a CPU limitada: é o
  // custo de MONTAR os cartões (o que cada um faz ao aparecer) a cada página que a rolagem pede.
  await page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-post-id]').first().waitFor({ timeout: 90_000 });
  if (CSS_EXTRA) await page.addStyleTag({ content: CSS_EXTRA });
  TELA = await page.evaluate(() => ({ largura: Math.round(innerWidth), altura: Math.round(window.visualViewport?.height ?? innerHeight) }));
  log(`janela de ${TELA.largura}x${TELA.altura} px${ANDROID ? ' (Android)' : ''}`);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  const resultado = { cartoes: 0, nosDom: 0, cenarios: {} };
  const carregarFeed = async () => {
    for (let i = 0; i < 40; i++) {
      const n = await page.locator('[data-post-id]').count();
      const fim = await page.getByText('Você chegou ao fim do feed').count();
      if (n >= TOTAL_POSTS - 12 || fim > 0) break;
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(900);
    }
  };
  if (quer('carga')) resultado.cenarios.carga = await medir(page, cdp, 'carga do feed até ~60 cartões (rolando até o fim)', carregarFeed);
  else await carregarFeed();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(2500);
  resultado.cartoes = await page.locator('[data-post-id]').count();
  resultado.nosDom = Math.round((await metricasCdp(cdp)).Nodes);
  log(`rodada ${numero}: ${resultado.cartoes} cartões no DOM, ${resultado.nosDom} nós`);

  await page.evaluate(() => window.scrollTo(0, 400));
  if (quer('rolagemContinua')) resultado.cenarios.rolagemContinua = await medir(page, cdp, 'rolagem contínua (6 descidas e 3 subidas)', async () => {
    for (let i = 0; i < 6; i++) { await dedo(cdp, { yDistance: -1400, speed: 2800 }); await page.waitForTimeout(60); }
    for (let i = 0; i < 3; i++) { await dedo(cdp, { yDistance: 1400, speed: 2800 }); await page.waitForTimeout(60); }
  }, { rolagemMinima: 3000 });
  await page.evaluate(() => window.scrollTo(0, 600));
  if (quer('inversoes')) resultado.cenarios.inversoes = await medir(page, cdp, 'inversões de direção (20 pares)', async () => {
    for (let i = 0; i < 20; i++) { await dedo(cdp, { yDistance: -260, speed: 900, fling: false }); await dedo(cdp, { yDistance: 260, speed: 900, fling: false }); }
  }, { rolagemMinima: 200 });
  await page.evaluate(() => window.scrollTo(0, 800));
  if (quer('pausas')) resultado.cenarios.pausas = await medir(page, cdp, 'rolar e parar (10 vezes, 350 ms de pausa)', async () => {
    for (let i = 0; i < 10; i++) { await dedo(cdp, { yDistance: -500, speed: 1400, fling: false }); await page.waitForTimeout(350); }
  }, { rolagemMinima: 2000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  if (quer('noTopo')) resultado.cenarios.noTopo = await medir(page, cdp, 'puxões curtos e voltas no topo (10 vezes)', async () => {
    for (let i = 0; i < 10; i++) { await dedo(cdp, { yDistance: 120, speed: 600, fling: false }); await dedo(cdp, { yDistance: -200, speed: 800, fling: false }); await dedo(cdp, { yDistance: 200, speed: 800, fling: false }); }
  });

  // O primeiro arrasto para baixo, a partir do topo, tem que rolar. (No build anterior uma regra de touch-action do próprio feed,
  // aplicada só quando a página estava no topo, impedia a rolagem nativa de começar: o feed "prendia" no topo.)
  await page.evaluate(() => window.scrollTo(0, 0));
  if (quer('saidaDoTopo')) {
    let rolaram = 0;
    resultado.cenarios.saidaDoTopo = await medir(page, cdp, 'primeiro arrasto para baixo a partir do topo (10 tentativas)', async () => {
      for (let i = 0; i < 10; i++) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(700);
        await dedo(cdp, { y: 700, yDistance: -400, speed: 800, fling: false });
        await page.waitForTimeout(300);
        if ((await page.evaluate(() => window.scrollY)) > 200) rolaram++;
      }
    });
    resultado.cenarios.saidaDoTopo.tentativas = 10;
    resultado.cenarios.saidaDoTopo.rolaram = rolaram;
    log(`  (saída do topo: ${rolaram} de 10 arrastos rolaram a página)`);
  }

  // Coisas que acontecem de fora enquanto a pessoa olha o feed (um seguidor novo, uma notificação, uma mensagem). Nenhuma delas
  // pode redesenhar os cartões do feed: o único custo aceitável é o do próprio número que mudou.
  const upsert = (caminho, dados) => fsUpsert(caminho, dados, 'owner');
  const externo = async (nome, descricao, acao) => {
    if (!quer(nome) || VISITANTE) return;
    await page.evaluate(() => window.scrollTo(0, 1200));
    resultado.cenarios[nome] = await medir(page, cdp, descricao, async () => {
      await acao();
      await page.waitForTimeout(2500);
    });
  };
  await externo('seguidorNovo', 'um seguidor novo (o perfil de quem está logado muda)', () => upsert(`users/${viewer.uid}`, { followersCount: 10 + numero }));
  await externo('notificacaoNova', 'uma notificação nova (o número da barra de navegação)', () => fsSet(`notifications/perf_${stamp}_${numero}`, {
    recipientId: viewer.uid, type: 'new_follower', count: 1, entityId: 'perf_autor_0', entityType: 'user', previewText: null,
    actors: [{ userId: 'perf_autor_0', name: 'Marina Lopes', username: 'perf0', avatarUrl: '/profile.png' }],
    createdAt: new Date(), readAt: null,
  }, 'owner'));
  await externo('mensagemNaoLida', 'uma mensagem não lida (dados privados do perfil)', () => upsert(`users/${viewer.uid}/private/account`, { totalUnreadMessages: numero }));

  // A barra de endereços do Chrome no Android some e volta enquanto se rola: a altura visível da janela muda e o navegador
  // avisa (resize do visualViewport). Isso não pode redesenhar os cartões.
  await page.evaluate(() => window.scrollTo(0, 1200));
  if (quer('barraDoNavegador') && !ANDROID) resultado.cenarios.barraDoNavegador = await medir(page, cdp, 'a barra do navegador some e volta (a altura da janela muda 6 vezes)', async () => {
    for (let i = 0; i < 6; i++) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 412, height: i % 2 === 0 ? 980 : 915, deviceScaleFactor: 2.625, mobile: true });
      await page.waitForTimeout(250);
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true });
  });

  // Curtir é um toque de verdade num botão: só aquele cartão pode mudar. Sem rolar durante a medição (rolar tem o seu cenário).
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1500);
  if (quer('curtir') && !VISITANTE) {
    let toques = 0;
    resultado.cenarios.curtir = await medir(page, cdp, 'curtir 3 posts (toque no coração, sem rolar)', async () => {
      const alvos = await page.evaluate(() => [...document.querySelectorAll('button[title="Like"], button[title="Unlike"]')]
        .map((b) => b.getBoundingClientRect())
        .filter((r) => r.top > 130 && r.bottom < innerHeight - 90 && r.width > 0)
        .slice(0, 1)
        .map((r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })));
      for (const alvo of alvos) {
        // Três mudanças no mesmo cartão, sem misturar a medição com uma rolagem para procurar outros corações.
        for (let i = 0; i < 3; i++) {
          await page.touchscreen.tap(alvo.x, alvo.y);
          toques++;
          await page.waitForTimeout(900);
        }
      }
    });
    resultado.cenarios.curtir.toques = toques;
    log(`  (curtir: ${toques} toques dados)`);
    if (toques < 3) throw new Error(`o cenário "curtir" só conseguiu ${toques} toque(s) no coração`);
  }

  resultado.errosDePagina = erros;
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  if (ANDROID) await page.close(); // a janela padrão do Chrome do aparelho não se fecha
  else await context.close();
  return resultado;
}

// ------------------------------------------------------------------------------------------------------------ principal
try {
  if (!flag('sem-reset')) { await resetEmulators(); log('emuladores zerados.'); }
  await ensureSignupControl();
  const viewer = { ...newUser('v', stamp), label: 'v' };
  const ctx0 = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'pt-BR', serviceWorkers: 'block' });
  const page0 = await ctx0.newPage();
  page0.setDefaultTimeout(60_000);
  await registerViaUi(page0, BASE_URL, viewer);
  viewer.uid = (await authAccounts()).find((a) => a.email === viewer.email).localId;
  await ctx0.close();
  if (!flag('sem-semear')) {
    await semear();
    log('aguardando as Functions terminarem de processar os posts semeados...');
    await new Promise((resolve) => setTimeout(resolve, 20_000));
  }

  const rodadas = [];
  for (let r = 1; r <= REPETICOES; r++) rodadas.push(await rodada(viewer, r));

  // Mediana entre as rodadas, cenário a cenário.
  const medianas = {};
  for (const cenario of Object.keys(rodadas[0].cenarios)) {
    medianas[cenario] = {};
    for (const metrica of Object.keys(rodadas[0].cenarios[cenario])) medianas[cenario][metrica] = arred(mediana(rodadas.map((r) => r.cenarios[cenario][metrica])), 2);
  }
  const saida = { rotulo: ROTULO, url: BASE_URL, cpu: CPU, repeticoes: REPETICOES, posts: TOTAL_POSTS, cartoesNoDom: rodadas.map((r) => r.cartoes), nosDom: rodadas.map((r) => r.nosDom), medianas, rodadas, errosDePagina: rodadas.flatMap((r) => r.errosDePagina) };
  const arquivo = path.join(OUT_DIR, `desempenho-${ROTULO}.json`);
  writeFileSync(arquivo, JSON.stringify(saida, null, 2));
  console.log(`\n=== ${ROTULO} (CPU ${CPU}x, ${REPETICOES} rodadas, mediana) ===`);
  console.table(Object.fromEntries(Object.entries(medianas).map(([c, m]) => [c, {
    'quadros>50ms': m.quadrosAcima50ms, 'p95 ms': m.quadroP95Ms, 'máx ms': m.quadroMaxMs, 'tarefas longas': m.tarefasLongas, 'bloqueio LoAF ms': m.loafBloqueioTotalMs,
    'rolou px': m.faixaDeRolagemPx, 'rolaram de 10': m.rolaram, 'atraso entrada máx': m.atrasoEntradaMaxMs, 'commits React': m.commitsReact, 'componentes': m.componentesRedesenhados, 'maior commit': m.maiorCommit, 'script ms': m.scriptMs, 'tarefa ms': m.tarefaMs, 'layout ms': m.layoutMs, 'estilo ms': m.estiloMs, 'heap MB': m.heapMB, 'CLS': m.cls,
  }])));
  console.log(`JSON completo: ${arquivo}`);
  if (saida.errosDePagina.length) console.log(`ERROS DE PÁGINA (pageerror): ${JSON.stringify([...new Set(saida.errosDePagina)])}`);
} finally {
  await dispositivo?.close();
  await browser.close();
}
