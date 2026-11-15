/**
 * Seção "rolagem": o feed rola e responde bem num celular Android simulado (412x915, com toque, dedos sintetizados pelo próprio
 * Chrome). Vem de um problema real: a rolagem "prendia" porque rolar redesenhava o feed inteiro (centenas de milhares de
 * componentes por segundo) e a barra de abas, o cabeçalho e cada cartão guardavam "estou visível?" em estado do React.
 *
 *   - ouvintes: nada que bloqueie a rolagem (touchstart/touchmove/roda não passivos) fica na janela, no documento ou no corpo, e
 *     nenhum toque é impedido (preventDefault) durante a rolagem vertical;
 *   - começar o dedo em cima de QUALQUER coisa (botão, imagem, texto, menu, avatar, aba, espaço vazio) só rola a página: não
 *     curte, não abre menu nem página, não troca de aba, não arma o "puxar para atualizar", não vibra;
 *   - o toque simples continua funcionando (curtir, abrir o post, abrir o menu, trocar de aba);
 *   - puxar para atualizar só vale NO TOPO de verdade; trocar de aba arrastando só com intenção horizontal clara;
 *   - cabeçalho, abas e navegação inferior somem ao rolar para baixo e voltam ao rolar para cima, por CSS (sem estado);
 *   - rolar, um seguidor novo, uma notificação, uma mensagem não lida, a barra do navegador que some e volta, e curtir NÃO
 *     redesenham o feed: contamos os componentes redesenhados (gancho do DevTools do React, só no navegador de teste);
 *   - mídia sensível coberta não carrega a mídia; as imagens do feed são preguiçosas; os cartões usam content-visibility.
 */
import { eventually, fsSet, fsUpdate, fsUpsert, loginViaUi, makePng, storageUpload, EMU } from '../lib/harness.mjs';
import { installRenderProbe, startRenderProbe, stopRenderProbe } from '../lib/render-probe.mjs';
import { dedo as dedoNativo } from '../lib/touch.mjs';

const TOTAL_POSTS = 24;
/** Orçamento de redesenhos (componentes) por situação. Antes desta correção cada uma custava milhares ou centenas de milhares. */
const ORCAMENTO = {
  // Limites com folga sobre a medição real e, ainda assim, ordens de grandeza abaixo do build antigo:
  // rolar: 204 commits/1,49 milhão de componentes; seguidor/mensagem: ~39 mil; barra do navegador: 1563 commits.
  rolar: { commits: 60, componentes: 200 },
  externo: { commits: 15, componentes: 500 },
  curtir: { commits: 8, componentes: 500 },
};

export async function run(ctx) {
  const { runner, users, BASE_URL, stamp, browser, shot } = ctx;
  const { a: A, b: B } = users;
  const { section, step, soft, check } = runner;

  let context;
  let page;
  let cdp;
  const errosDePagina = [];
  const textoDe = (i) => `Rolagem ${i} ${stamp}`;

  // ------------------------------------------------------------------------------------------------ ajudantes
  /**
   * Um dedo arrastando a partir de (x, y), por toques nativos (veja lib/touch.mjs: o gesto "touch" sintetizado do CDP NÃO rola a
   * página, então não serve para testar rolagem). dy negativo = dedo PARA CIMA (a página rola para baixo); dx negativo = dedo
   * para a esquerda; `fling: true` solta o dedo em movimento (a página continua por inércia).
   */
  const dedo = (x, y, { dx = 0, dy = 0, speed = 800, fling = false } = {}) => dedoNativo(cdp, { x, y, dx, dy, speed, fling });
  const calma = (ms = 450) => page.waitForTimeout(ms);
  const irAoTopo = async () => { await page.evaluate(() => window.scrollTo(0, 0)); await calma(600); };
  const limpar = () => page.evaluate(() => { window.__vibes.length = 0; window.__ptr.length = 0; });
  /** Ponto central do n-ésimo elemento VISÍVEL (fora do cabeçalho e da navegação inferior) que casa com o seletor. */
  const ponto = (seletor, indice = 0, { topoMinimo = 120 } = {}) => page.evaluate(({ seletor, indice, topoMinimo }) => {
    const el = [...document.querySelectorAll(seletor)].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 4 && r.height > 4 && r.top > topoMinimo && r.bottom < innerHeight - 70;
    })[indice];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, { seletor, indice, topoMinimo });
  /** Um espaço vazio dentro de um cartão (a margem direita, ao lado do conteúdo). */
  const espacoVazio = () => page.evaluate(() => {
    const cartao = [...document.querySelectorAll('[data-post-id]')].find((c) => { const r = c.getBoundingClientRect(); return r.top > 150 && r.bottom < innerHeight - 100; });
    if (!cartao) return null;
    const r = cartao.getBoundingClientRect();
    return { x: Math.round(r.right - 5), y: Math.round(r.top + 28) };
  });
  const estado = () => page.evaluate(() => {
    const indicador = document.querySelector('[data-testid="pull-to-refresh"]');
    return {
      url: location.pathname + location.search,
      y: Math.round(window.scrollY),
      curtidos: document.querySelectorAll('button[title="Unlike"]').length,
      abertos: document.querySelectorAll('[role="dialog"], [role="menu"], [role="alertdialog"]').length,
      aba: document.querySelector('[role="tab"][data-state="active"]')?.textContent?.trim() ?? null,
      ptr: indicador ? `${indicador.dataset.armed}/${indicador.dataset.refreshing}` : null,
      vibracoes: window.__vibes.length,
    };
  });
  const igualAntes = (antes, depois, motivo) => {
    check(depois.url === antes.url, `${motivo}: a página mudou (${antes.url} -> ${depois.url})`);
    check(depois.curtidos === antes.curtidos, `${motivo}: curtiu/descurtiu sem querer (${antes.curtidos} -> ${depois.curtidos})`);
    check(depois.abertos === antes.abertos, `${motivo}: abriu ou fechou um menu/diálogo (${antes.abertos} -> ${depois.abertos})`);
    check(depois.aba === antes.aba, `${motivo}: trocou de aba (${antes.aba} -> ${depois.aba})`);
    check(depois.ptr === null || !depois.ptr.startsWith('true/') && !depois.ptr.endsWith('/true'), `${motivo}: armou ou disparou o "puxar para atualizar" (${depois.ptr})`);
    check(depois.vibracoes === antes.vibracoes, `${motivo}: vibrou (${depois.vibracoes - antes.vibracoes}x)`);
  };
  /** Ouvintes de rolagem que NÃO são passivos (cada um faz o navegador esperar o JavaScript antes de rolar). */
  const ouvintesQueBloqueiam = async () => {
    const ruins = [];
    for (const expressao of ['window', 'document', 'document.documentElement', 'document.body']) {
      const { result } = await cdp.send('Runtime.evaluate', { expression: expressao });
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
      for (const ouvinte of listeners) {
        if (['touchstart', 'touchmove', 'wheel', 'mousewheel'].includes(ouvinte.type) && ouvinte.passive === false) ruins.push(`${expressao}:${ouvinte.type}`);
      }
      await cdp.send('Runtime.releaseObject', { objectId: result.objectId });
    }
    return ruins;
  };
  const barras = () => page.evaluate(() => {
    const retangulo = (seletor) => { const el = document.querySelector(seletor); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; };
    return {
      chrome: document.documentElement.dataset.chrome ?? null,
      y: Math.round(window.scrollY),
      cabecalho: retangulo('header.chrome-header'),
      abas: retangulo('.chrome-sticky'),
      navegacao: retangulo('.chrome-bottom'),
      altura: innerHeight,
    };
  });

  // ------------------------------------------------------------------------------------------------ preparação
  section('rolagem: preparação');
  await step(`B publica um feed variado (${TOTAL_POSTS} posts: texto, imagem, artigo, enquete, mídia sensível, várias imagens) e A abre a tela inicial num celular simulado`, async () => {
    const agora = Date.now();
    const base = (i) => ({
      userId: B.uid,
      authorDetails: { userId: B.uid, name: B.name, username: B.username, avatarUrl: '/profile.png' },
      type: 'original', visibility: 'public', allowReposts: true, replyPermission: 'everyone',
      likes: i % 5, reposts: 0, quotesCount: 0, commentsCount: i % 3, views: 10 + i,
      isEdited: false, editCount: 0, isDeleted: false, postFormat: 'standard',
      createdAt: new Date(agora - i * 1000), isLikedBy: {}, category: 'echo', hasMedia: false, media: null,
    });
    const imagem = async (i, largura, altura, cor) => {
      const objeto = `user_uploads/${B.uid}/postMedia/images/rolagem-${stamp}-${i}.png`;
      const r = await storageUpload(objeto, makePng(largura, altura, cor), 'image/png', 'owner');
      check(r.status === 200, `upload da imagem ${i}: HTTP ${r.status}`);
      return { url: `${EMU.storage}/v0/b/demo-soberan.appspot.com/o/${encodeURIComponent(objeto)}?alt=media`, type: 'image', alt: `Imagem ${i}` };
    };
    for (let i = 0; i < TOTAL_POSTS; i++) {
      let post;
      if (i === 1) post = { ...base(i), text: textoDe(i), hasMedia: true, media: [await imagem(i, 640, 400, [200, 80, 60])] };
      else if (i === 2) post = { ...base(i), category: 'news', headline: `Manchete da rolagem ${stamp}`, text: '<p>Primeiro parágrafo do artigo de teste da rolagem.</p><p>Segundo parágrafo.</p>', newsCategory: 'Economia', sourceUrl: 'https://exemplo.com.br/noticia', hasMedia: true, media: [await imagem(i, 800, 450, [60, 120, 200])] };
      else if (i === 3) post = { ...base(i), text: `Enquete da rolagem ${stamp}`, poll: { options: [{ id: 'a', text: 'Sim' }, { id: 'b', text: 'Não' }], endsAt: new Date(agora + 3 * 24 * 3_600_000) }, pollOptionIds: ['a', 'b'], pollCounts: { a: 3, b: 2 }, pollTotal: 5 };
      else if (i === 4) post = { ...base(i), text: `Sensível da rolagem ${stamp}`, sensitive: true, hasMedia: true, media: [await imagem(i, 600, 600, [180, 40, 90])] };
      else if (i === 5) post = { ...base(i), text: textoDe(i), hasMedia: true, media: [await imagem(i * 10, 500, 500, [90, 160, 70]), await imagem(i * 10 + 1, 500, 500, [160, 90, 70]), await imagem(i * 10 + 2, 500, 500, [70, 90, 160])] };
      else post = { ...base(i), text: `${textoDe(i)}. Um texto de tamanho comum para ocupar uma boa parte do cartão e deixar a lista comprida o bastante.` };
      const r = await fsSet(`posts/rolagem_${stamp}_${String(i).padStart(3, '0')}`, post, 'owner');
      check(r.status === 200, `semear o post ${i}: HTTP ${r.status}`);
    }
    context = await browser.newContext({
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 2.625,
      hasTouch: true,
      isMobile: true,
      locale: 'pt-BR',
      serviceWorkers: 'block',
      userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    });
    await context.addInitScript(installRenderProbe);
    await context.addInitScript(() => {
      window.__vibes = [];
      Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, writable: true, value(pattern) { window.__vibes.push(pattern); return true; } });
      // Estados vistos do indicador de "puxar para atualizar" ("armado/atualizando"), em ordem.
      window.__ptr = [];
      new MutationObserver(() => {
        const el = document.querySelector('[data-testid="pull-to-refresh"]');
        if (!el) return;
        const estado = `${el.dataset.armed}/${el.dataset.refreshing}`;
        if (window.__ptr[window.__ptr.length - 1] !== estado) window.__ptr.push(estado);
      }).observe(document, { subtree: true, attributes: true, childList: true });
      // Mudança de layout acumulada e toques impedidos (preventDefault) durante a rolagem.
      window.__cls = 0;
      window.__shifts = [];
      try {
        new PerformanceObserver((lista) => lista.getEntries().forEach((e) => {
          if (e.hadRecentInput) return;
          window.__cls += e.value;
          window.__shifts.push({
            value: e.value,
            at: Math.round(e.startTime),
            sources: (e.sources ?? []).map((source) => {
              const node = source.node;
              return node ? `${node.nodeName}.${String(node.className ?? '').slice(0, 70)}` : 'sem nó';
            }),
          });
        })).observe({ type: 'layout-shift', buffered: true });
      } catch { /* sem suporte */ }
      window.__impedidos = 0;
      for (const tipo of ['touchstart', 'touchmove', 'pointermove', 'wheel']) {
        // Na fase de borbulhamento da janela, depois de todos os outros ouvintes: se alguém impediu o gesto, já se sabe.
        window.addEventListener(tipo, (e) => { if (e.defaultPrevented) window.__impedidos += 1; }, { passive: true });
      }
    });
    page = await context.newPage();
    page.setDefaultTimeout(60_000);
    page.on('pageerror', (e) => errosDePagina.push(String(e.message).slice(0, 200)));
    await loginViaUi(page, BASE_URL, A);
    cdp = await context.newCDPSession(page);
    await page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await page.getByText(textoDe(0)).first().waitFor({ timeout: 90_000 });
    await page.getByText(`Sensível da rolagem ${stamp}`).first().waitFor({ timeout: 60_000 });
    await calma(2500);
    await shot(page, 'rolagem-01-feed');
    // O CLS que interessa começa depois que a tela inicial assentou; não mistura a hidratação/carga inicial com os gestos.
    await page.evaluate(() => { window.__cls = 0; window.__shifts.length = 0; });
    return `${TOTAL_POSTS} posts de B`;
  });

  // ------------------------------------------------------------------------------------------------ ouvintes e estrutura
  section('rolagem: ouvintes e estrutura');
  await soft('nenhum ouvinte de toque ou roda NÃO passivo (que faria o navegador esperar o JavaScript para rolar) fica na janela, no documento ou no corpo', async () => {
    const ruins = await ouvintesQueBloqueiam();
    check(ruins.length === 0, `ouvintes que bloqueiam a rolagem: ${ruins.join(', ')}`);
  }, { tag: 'desempenho' });

  await soft('o feed não usa touch-action que restrinja a rolagem (nem no topo, nem fora dele): a rolagem nativa é livre em qualquer posição', async () => {
    // O defeito que prendia o feed: no topo da página o contêiner do feed ganhava `touch-action: pan-x pan-up`. Em CSS "pan-up"
    // libera rolar a página PARA CIMA (dedo para baixo), o contrário do que o comentário dizia: rolar para baixo ficava bloqueado.
    const restricoes = () => page.evaluate(() => {
      const ruins = [];
      for (let e = document.querySelector('[data-post-id]'); e; e = e.parentElement) {
        const valor = getComputedStyle(e).touchAction;
        if (valor !== 'auto' && valor !== 'manipulation') ruins.push(`${e.tagName}.${String(e.className).slice(0, 24)}=${valor}`);
      }
      return ruins;
    });
    await irAoTopo();
    const noTopo = await restricoes();
    check(noTopo.length === 0, `no topo: ${noTopo.join(' | ')}`);
    await page.evaluate(() => window.scrollTo(0, 600));
    await calma(700);
    const fora = await restricoes();
    check(fora.length === 0, `fora do topo: ${fora.join(' | ')}`);
    await irAoTopo();
  }, { tag: 'ux' });

  await soft('os cartões do feed usam content-visibility e as imagens do feed são preguiçosas (loading=lazy, decoding=async)', async () => {
    const info = await page.evaluate(() => {
      const cartoes = [...document.querySelectorAll('[data-post-id]')];
      const imagens = [...document.querySelectorAll('[data-post-id] img[src*="127.0.0.1:9199"]')];
      return {
        cartoes: cartoes.length,
        semContentVisibility: cartoes.filter((c) => getComputedStyle(c).contentVisibility !== 'auto').length,
        imagens: imagens.length,
        naoPreguicosas: imagens.filter((i) => i.loading !== 'lazy').length,
        semDecodeAssincrono: imagens.filter((i) => i.decoding !== 'async').length,
      };
    });
    check(info.cartoes > 0, 'nenhum cartão no feed');
    check(info.semContentVisibility === 0, `${info.semContentVisibility} de ${info.cartoes} cartões sem content-visibility: auto`);
    check(info.imagens > 0, 'nenhuma imagem de post no feed');
    check(info.naoPreguicosas === 0, `${info.naoPreguicosas} de ${info.imagens} imagens sem loading=lazy`);
    check(info.semDecodeAssincrono === 0, `${info.semDecodeAssincrono} de ${info.imagens} imagens sem decoding=async`);
  }, { tag: 'desempenho' });

  await soft('mídia sensível coberta NÃO carrega a imagem (nem desfoca: não há filtro caro a cada quadro); ao mostrar, a imagem aparece', async () => {
    const capa = page.getByTestId('sensitive-cover').first();
    await capa.scrollIntoViewIfNeeded();
    await calma(400);
    const antes = await capa.evaluate((el) => {
      const cartao = el.closest('[data-post-id]');
      return { imagens: cartao.querySelectorAll('img[src*="127.0.0.1:9199"]').length, desfoque: getComputedStyle(el).backdropFilter };
    });
    check(antes.imagens === 0, `a mídia sensível coberta já tem ${antes.imagens} imagem(ns) no DOM`);
    check(antes.desfoque === 'none', `a capa usa filtro de desfoque (${antes.desfoque})`);
    await capa.getByRole('button', { name: 'Mostrar mídia' }).tap();
    await capa.waitFor({ state: 'detached' });
    const depois = await page.locator('[data-post-id]', { hasText: `Sensível da rolagem ${stamp}` }).locator('img[src*="127.0.0.1:9199"]').count();
    check(depois > 0, 'a imagem não apareceu depois de mostrar a mídia');
    await shot(page, 'rolagem-02-sensivel-revelada');
  }, { tag: 'desempenho' });

  // ------------------------------------------------------------------------------------------------ começar o dedo em qualquer coisa
  section('rolagem: começar o dedo em cima de qualquer coisa só rola a página');
  await soft('o PRIMEIRO arrasto para baixo, com a página parada no topo (scrollY = 0), rola a página (antes o feed prendia no topo)', async () => {
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      await irAoTopo();
      const antes = await estado();
      check(antes.y === 0, `a página deveria estar no topo (y=${antes.y})`);
      await dedo(206, 700, { dy: -400, speed: 800 });
      await calma(600);
      const depois = await estado();
      check(depois.y >= 250, `tentativa ${tentativa}: o primeiro arrasto a partir do topo não rolou a página (y=${depois.y})`);
    }
  }, { tag: 'ux' });

  const ALVOS = [
    { nome: 'em cima do botão de curtir', ponto: () => ponto('button[title="Like"]') },
    { nome: 'em cima de uma imagem do post', ponto: () => ponto('[data-post-id] img[src*="127.0.0.1:9199"]') },
    { nome: 'em cima do texto do post', ponto: () => ponto('[data-post-id] p.whitespace-pre-wrap') },
    { nome: 'em cima do botão de mais opções', ponto: () => ponto('button[aria-label="More options"]') },
    { nome: 'em cima do avatar de quem postou', ponto: () => ponto('[data-post-id] a[href*="/profile/"]') },
    { nome: 'num espaço vazio do cartão', ponto: espacoVazio },
    // As abas ficam coladas no topo: para o dedo ter espaço, a página começa rolada e o dedo DESCE (a página sobe).
    { nome: 'em cima de uma aba (Seguindo, Explorar, Artigos)', paraCima: true, preparar: async () => { await page.evaluate(() => window.scrollTo(0, 700)); await calma(800); }, ponto: () => ponto('[role="tab"]', 1, { topoMinimo: 0 }) },
  ];
  for (const alvo of ALVOS) {
    await soft(`o dedo começando ${alvo.nome} e subindo 360 px só rola a página (nada é curtido, aberto, trocado nem vibra)`, async () => {
      if (alvo.preparar) await alvo.preparar();
      else await irAoTopo();
      const inicio = await alvo.ponto();
      check(inicio, `não achei ${alvo.nome} na tela`);
      await limpar();
      const antes = await estado();
      // O dedo anda até onde a tela deixa (um toque fora da janela é descartado): no máximo 360 px (300 se desce).
      const distancia = alvo.paraCima ? Math.min(300, 880 - inicio.y) : Math.min(360, inicio.y - 50);
      await dedo(inicio.x, inicio.y, { dy: alvo.paraCima ? distancia : -distancia });
      await calma(500);
      const depois = await estado();
      const rolou = alvo.paraCima ? antes.y - depois.y : depois.y - antes.y;
      check(rolou >= Math.max(60, distancia * 0.6), `a página não rolou direito (de ${antes.y} para ${depois.y}; o dedo andou ${distancia} px)`);
      igualAntes(antes, depois, `rolar ${alvo.nome}`);
    }, { tag: 'ux' });
  }

  await soft('um arremesso rápido e longo começando em cima do botão de curtir só rola (e rola bastante)', async () => {
    await irAoTopo();
    const inicio = await ponto('button[title="Like"]');
    check(inicio, 'não achei o botão de curtir');
    const antes = await estado();
    await dedo(inicio.x, inicio.y, { dy: -700, speed: 2800, fling: true });
    await calma(1200);
    const depois = await estado();
    check(depois.y - antes.y >= 350, `o arremesso rolou pouco (de ${antes.y} para ${depois.y})`);
    igualAntes(antes, depois, 'arremesso');
  }, { tag: 'ux' });

  await soft('rolar para baixo e para cima sem soltar o dedo (e invertendo de direção) não curte nem abre nada', async () => {
    await irAoTopo();
    const inicio = await ponto('[data-post-id] p.whitespace-pre-wrap');
    check(inicio, 'não achei texto de post');
    const antes = await estado();
    for (let i = 0; i < 6; i++) {
      await dedo(inicio.x, inicio.y, { dy: -240, speed: 900 });
      await dedo(inicio.x, inicio.y, { dy: 180, speed: 900 });
    }
    await calma(500);
    igualAntes(antes, await estado(), 'inversões de direção');
  }, { tag: 'ux' });

  await soft('nenhum toque, movimento ou roda foi impedido (preventDefault) durante toda a rolagem vertical', async () => {
    const impedidos = await page.evaluate(() => window.__impedidos);
    check(impedidos === 0, `${impedidos} evento(s) de rolagem impedidos`);
  }, { tag: 'desempenho' });

  // ------------------------------------------------------------------------------------------------ o toque simples
  section('rolagem: o toque simples continua funcionando');
  await soft('tocar no coração curte na hora e tocar de novo descurte', async () => {
    await irAoTopo();
    const inicio = await ponto('button[title="Like"]');
    check(inicio, 'não achei o botão de curtir');
    await page.touchscreen.tap(inicio.x, inicio.y);
    await eventually(async () => (await page.locator('button[title="Unlike"]').count()) === 1, { label: 'o coração ficar curtido', timeoutMs: 4000 });
    const fim = await ponto('button[title="Unlike"]');
    await page.touchscreen.tap(fim.x, fim.y);
    await eventually(async () => (await page.locator('button[title="Unlike"]').count()) === 0, { label: 'o coração voltar ao normal', timeoutMs: 4000 });
  }, { tag: 'funcional' });

  await soft('tocar no mais opções abre o menu (ou a folha) e voltar fecha', async () => {
    await irAoTopo();
    const inicio = await ponto('button[aria-label="More options"]');
    check(inicio, 'não achei o botão de mais opções');
    await page.touchscreen.tap(inicio.x, inicio.y);
    await eventually(async () => (await page.locator('[role="menu"], [role="dialog"]').count()) > 0, { label: 'o menu abrir', timeoutMs: 4000 });
    await page.keyboard.press('Escape');
    await eventually(async () => (await page.locator('[role="menu"], [role="dialog"]').count()) === 0, { label: 'o menu fechar', timeoutMs: 4000 });
  }, { tag: 'funcional' });

  await soft('tocar na aba Artigos troca de aba e tocar em Explorar volta', async () => {
    await irAoTopo();
    await page.locator('[role="tab"]', { hasText: 'Artigos' }).tap();
    await eventually(async () => (await estado()).aba === 'Artigos', { label: 'a aba Artigos ficar ativa', timeoutMs: 4000 });
    await page.locator('[role="tab"]', { hasText: 'Explorar' }).tap();
    await eventually(async () => (await estado()).aba === 'Explorar', { label: 'a aba Explorar voltar', timeoutMs: 4000 });
  }, { tag: 'funcional' });

  await soft('tocar no texto de um post abre o post e voltar devolve o feed', async () => {
    await irAoTopo();
    const inicio = await ponto('[data-post-id] p.whitespace-pre-wrap');
    check(inicio, 'não achei texto de post');
    await page.touchscreen.tap(inicio.x, inicio.y);
    await page.waitForURL(/\/post\//, { timeout: 15_000 });
    await page.goBack();
    await page.locator('[data-post-id]').first().waitFor({ timeout: 30_000 });
    await calma(800);
  }, { tag: 'funcional' });

  // ------------------------------------------------------------------------------------------------ puxar e trocar de aba
  section('rolagem: puxar para atualizar e trocar de aba só com intenção clara');
  await soft('puxar para baixo FORA do topo (a página já rolou) não arma nem atualiza; só rola de volta', async () => {
    await page.evaluate(() => window.scrollTo(0, 900));
    await calma(700);
    await limpar();
    const antes = await estado();
    await dedo(200, 400, { dy: 330 });
    await calma(700);
    const depois = await estado();
    check(depois.y < antes.y, `a página não rolou para cima (de ${antes.y} para ${depois.y})`);
    check(depois.y > 0, `o teste deveria terminar fora do topo (y=${depois.y})`);
    const estados = await page.evaluate(() => window.__ptr.slice());
    check(!estados.some((e) => e.startsWith('true/') || e.endsWith('/true')), `armou ou atualizou fora do topo: ${JSON.stringify(estados)}`);
  }, { tag: 'ux' });

  await soft('puxar para baixo NO topo arma, vibra e atualiza ao soltar; um puxão curto não', async () => {
    await irAoTopo();
    await limpar();
    await dedo(200, 220, { dy: 100 });
    await calma(600);
    let estados = await page.evaluate(() => window.__ptr.slice());
    check(!estados.some((e) => e.startsWith('true/') || e.endsWith('/true')), `um puxão curto atualizou: ${JSON.stringify(estados)}`);
    await limpar();
    await dedo(200, 220, { dy: 330 });
    await eventually(async () => (await page.evaluate(() => window.__ptr.slice())).some((e) => e.endsWith('/true')), { label: 'o indicador entrar em "atualizando"', timeoutMs: 8000 });
    estados = await page.evaluate(() => window.__ptr.slice());
    check(estados.some((e) => e.startsWith('true/')), `não armou antes de atualizar: ${JSON.stringify(estados)}`);
    await eventually(async () => (await page.evaluate(() => window.__ptr.slice())).at(-1) === 'false/false', { label: 'o indicador voltar ao normal', timeoutMs: 20_000 });
  }, { tag: 'ux' });

  await soft('arrastar de lado 230 px troca de aba (e de volta); 30 px ou um arrasto diagonal NÃO trocam', async () => {
    await irAoTopo();
    const antes = (await estado()).aba;
    await dedo(340, 500, { dx: -30 });
    await calma(400);
    check((await estado()).aba === antes, 'um esbarrão de 30 px trocou de aba');
    await dedo(340, 560, { dx: -120, dy: -240 });
    await calma(500);
    const diagonal = await estado();
    check(diagonal.aba === antes, `um arrasto diagonal trocou de aba (${antes} -> ${diagonal.aba})`);
    check(diagonal.y >= 100, `o arrasto diagonal deveria ter rolado a página (y=${diagonal.y})`);
    await irAoTopo();
    await dedo(340, 500, { dx: -230, speed: 1800, fling: true });
    await eventually(async () => (await estado()).aba !== antes, { label: 'a aba trocar com 230 px de lado', timeoutMs: 4000 });
    // Não começa na borda esquerda: no Android/Chrome esse gesto é "voltar" do sistema, não troca de aba do app.
    await dedo(120, 500, { dx: 230, speed: 1800, fling: true });
    await eventually(async () => (await estado()).aba === antes, { label: 'a aba voltar', timeoutMs: 4000 });
  }, { tag: 'ux' });

  // ------------------------------------------------------------------------------------------------ barras
  section('rolagem: cabeçalho, abas e navegação inferior');
  await soft('rolar para baixo esconde o cabeçalho e a navegação inferior e sobe as abas; rolar um pouco para cima os traz de volta (por CSS)', async () => {
    await irAoTopo();
    const topo = await barras();
    check(topo.cabecalho && topo.abas && topo.navegacao, `faltam barras: ${JSON.stringify(topo)}`);
    check(topo.chrome === 'shown' || topo.chrome === null, `no topo as barras deveriam aparecer (${topo.chrome})`);
    check(topo.cabecalho.top >= -1 && topo.cabecalho.bottom > 30, `cabeçalho fora do lugar no topo: ${JSON.stringify(topo.cabecalho)}`);
    check(topo.navegacao.top < topo.altura, `navegação inferior escondida no topo: ${JSON.stringify(topo.navegacao)}`);

    await dedo(200, 700, { dy: -600 });
    await calma(700);
    const baixo = await barras();
    check(baixo.chrome === 'hidden', `rolando para baixo as barras deveriam esconder (${baixo.chrome})`);
    check(baixo.cabecalho.bottom <= 1, `o cabeçalho deveria estar fora da tela: ${JSON.stringify(baixo.cabecalho)}`);
    check(baixo.abas.top <= 1, `as abas deveriam subir ao topo: ${JSON.stringify(baixo.abas)}`);
    check(baixo.navegacao.top >= baixo.altura - 1, `a navegação inferior deveria estar fora da tela: ${JSON.stringify(baixo.navegacao)}`);

    const antesDaTremida = await barras();
    // 8 px ainda é tratado como TOQUE pelo Chrome (poderia abrir o post sob o dedo); 24 px já é rolagem, mas segue abaixo
    // da histerese de 36 px das barras e representa a pequena acomodação que não pode fazê-las piscar.
    await dedo(200, 400, { dy: 24 });
    await calma(400);
    const depoisDaTremida = await barras();
    check(depoisDaTremida.chrome === 'hidden', `uma tremida pequena revelou as barras (scrollY ${antesDaTremida.y} -> ${depoisDaTremida.y})`);

    await dedo(200, 400, { dy: 70 }); // rolar um pouco para cima revela
    await calma(700);
    const cima = await barras();
    check(cima.chrome === 'shown', `rolando um pouco para cima as barras deveriam voltar (${cima.chrome})`);
    check(cima.cabecalho.top >= -1, `o cabeçalho deveria voltar: ${JSON.stringify(cima.cabecalho)}`);
    check(Math.abs(cima.abas.top - cima.cabecalho.bottom) <= 2, `as abas deveriam ficar coladas ao cabeçalho: abas ${JSON.stringify(cima.abas)} cabeçalho ${JSON.stringify(cima.cabecalho)}`);
    check(cima.navegacao.top < cima.altura, `a navegação inferior deveria voltar: ${JSON.stringify(cima.navegacao)}`);
    await shot(page, 'rolagem-03-barras');
  }, { tag: 'ux' });

  // ------------------------------------------------------------------------------------------------ redesenhos
  section('rolagem: rolar e eventos de fora não redesenham o feed');
  await step('o feed carrega mais páginas (rolando até o fim) e volta ao topo, para as medições abaixo não incluírem carga', async () => {
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await calma(900);
    }
    await irAoTopo();
    const cartoes = await page.locator('[data-post-id]').count();
    check(cartoes >= 20, `poucos cartões no DOM: ${cartoes}`);
    return `${cartoes} cartões no DOM`;
  });

  await soft(`rolar para cima e para baixo 20 vezes redesenha poucos componentes (máx. ${ORCAMENTO.rolar.componentes} em ${ORCAMENTO.rolar.commits} commits; antes: centenas de milhares)`, async () => {
    await page.evaluate(() => window.scrollTo(0, 300));
    await calma(600);
    await startRenderProbe(page);
    for (let i = 0; i < 20; i++) {
      await dedo(200, 650, { dy: -260, speed: 900 });
      await dedo(200, 400, { dy: 260, speed: 900 });
    }
    await calma(700);
    const r = await stopRenderProbe(page);
    check(r.commits <= ORCAMENTO.rolar.commits, `${r.commits} commits do React ao rolar (máx. ${ORCAMENTO.rolar.commits})`);
    check(r.components <= ORCAMENTO.rolar.componentes, `${r.components} componentes redesenhados ao rolar (máx. ${ORCAMENTO.rolar.componentes}; o maior commit: ${r.biggest}; mais frequentes: ${JSON.stringify(r.top)})`);
    return `${r.commits} commits, ${r.components} componentes`;
  }, { tag: 'desempenho' });

  const medirExterno = async (acao) => {
    await page.evaluate(() => window.scrollTo(0, 600));
    await calma(600);
    await startRenderProbe(page);
    await acao();
    await calma(2800);
    return stopRenderProbe(page);
  };
  const conferirExterno = (r) => {
    check(r.commits <= ORCAMENTO.externo.commits, `${r.commits} commits do React (máx. ${ORCAMENTO.externo.commits})`);
    check(r.components <= ORCAMENTO.externo.componentes, `${r.components} componentes redesenhados (máx. ${ORCAMENTO.externo.componentes}; o maior commit: ${r.biggest})`);
    return `${r.commits} commits, ${r.components} componentes`;
  };
  await soft('um seguidor novo (o perfil de quem está logado muda) não redesenha o feed', async () => {
    const r = await medirExterno(async () => { await fsUpdate(`users/${A.uid}`, { followersCount: 7 }, 'owner'); });
    return conferirExterno(r);
  }, { tag: 'desempenho' });

  await soft('uma notificação nova (o número da barra de navegação) não redesenha o feed', async () => {
    const r = await medirExterno(async () => {
      await fsSet(`notifications/rolagem_${stamp}_1`, {
        recipientId: A.uid, type: 'new_follower', count: 1, entityId: B.uid, entityType: 'user', previewText: null,
        actors: [{ userId: B.uid, name: B.name, username: B.username, avatarUrl: '/profile.png' }],
        createdAt: new Date(), readAt: null,
      }, 'owner');
    });
    return conferirExterno(r);
  }, { tag: 'desempenho' });

  await soft('uma mensagem não lida (dados privados do perfil) não redesenha o feed', async () => {
    const r = await medirExterno(async () => { await fsUpsert(`users/${A.uid}/private/account`, { totalUnreadMessages: 3 }, 'owner'); });
    return conferirExterno(r);
  }, { tag: 'desempenho' });

  await soft('a barra de endereços do navegador que some e volta (a altura da janela muda) não redesenha o feed', async () => {
    const r = await medirExterno(async () => {
      for (let i = 0; i < 6; i++) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 412, height: i % 2 === 0 ? 980 : 915, deviceScaleFactor: 2.625, mobile: true });
        await calma(250);
      }
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true });
    });
    return conferirExterno(r);
  }, { tag: 'desempenho' });

  await soft(`curtir um post redesenha só aquele cartão (máx. ${ORCAMENTO.curtir.componentes} componentes em ${ORCAMENTO.curtir.commits} commits)`, async () => {
    await irAoTopo();
    const inicio = await ponto('button[title="Like"]');
    check(inicio, 'não achei o botão de curtir');
    await startRenderProbe(page);
    await page.touchscreen.tap(inicio.x, inicio.y);
    await calma(2200);
    const r = await stopRenderProbe(page);
    check(r.commits <= ORCAMENTO.curtir.commits, `${r.commits} commits do React ao curtir (máx. ${ORCAMENTO.curtir.commits})`);
    check(r.components <= ORCAMENTO.curtir.componentes, `${r.components} componentes redesenhados ao curtir (máx. ${ORCAMENTO.curtir.componentes}; o maior commit: ${r.biggest})`);
    const fim = await ponto('button[title="Unlike"]');
    if (fim) await page.touchscreen.tap(fim.x, fim.y); // desfaz
    await calma(800);
    return `${r.commits} commits, ${r.components} componentes`;
  }, { tag: 'desempenho' });

  // ------------------------------------------------------------------------------------------------ fecho
  section('rolagem: estabilidade');
  await soft('a página não deu saltos de layout durante tudo isso (CLS baixo) e não houve erro de página', async () => {
    const { cls, shifts } = await page.evaluate(() => ({ cls: window.__cls, shifts: window.__shifts.slice().sort((a, b) => b.value - a.value).slice(0, 5) }));
    check(cls < 0.1, `mudança de layout acumulada alta: ${cls.toFixed(4)}; maiores: ${JSON.stringify(shifts)}`);
    check(errosDePagina.length === 0, `erros de página: ${[...new Set(errosDePagina)].join(' | ')}`);
    return `CLS ${cls.toFixed(4)}`;
  }, { tag: 'desempenho' });

  await cdp?.detach().catch(() => {});
  await context?.close().catch(() => {});
}
