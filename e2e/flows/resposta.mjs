/**
 * Seção "resposta": as interações de liga/desliga (curtir, repostar, salvar) respondem NA HORA na tela.
 *
 * A queixa: curtir um comentário "demorava alguns segundos para ser calculado e aparecer". O contador público é somado por
 * uma Function depois do toque, e o app relia o comentário quando o contador mudava; um dado atrasado do servidor
 * sobrescrevia o toque e a curtida parecia não ter pegado. Aqui se confere, pela tela real:
 *   - a curtida aparece (botão pressionado e contador +1) em poucas centenas de milissegundos;
 *   - ela NÃO some quando chega dado atrasado do servidor (atualizações do documento logo depois do toque);
 *   - toques rápidos terminam no estado certo, tanto na tela quanto no banco;
 *   - se o servidor recusar, a tela volta ao que era e avisa;
 *   - o mesmo para repostar e para curtir o post.
 *
 * A é o autor do post e B interage. Tempos medidos no navegador (limites folgados para não depender da máquina).
 */
import { adminFind, adminGetDoc, createPostViaUi, eventually, fsDelete, fsSet, fsUpdate, stableFor } from '../lib/harness.mjs';

const RESPOSTA_MAX_MS = 700; // o toque precisa aparecer em menos que isto (antes: segundos)

export async function run(ctx) {
  const { runner, users, BASE_URL, stamp, shot } = ctx;
  const { a: A, b: B } = users;
  const { section, step, soft, check } = runner;
  const postUrl = (postId) => `${BASE_URL}/pt-BR/post/${postId}`;
  const commentBox = (page, commentId) => page.locator(`#comment-${commentId}`);
  // O botão é achado por SELETOR a cada consulta (e não por um marcador posto no elemento): se a tela remontar o botão, a
  // espera continua achando o novo.
  const LIKE_SELECTOR = 'button:has(svg.lucide-heart)';
  const REPOST_SELECTOR = 'button:has(svg.lucide-repeat2)';
  const inComment = (commentId, selector) => `#comment-${commentId} ${selector}`;
  const likeButton = (page, commentId) => page.locator(inComment(commentId, LIKE_SELECTOR)).first();
  const repostButton = (page, commentId) => page.locator(inComment(commentId, REPOST_SELECTOR)).first();
  const textOf = async (locator) => (await locator.innerText()).replace(/\s+/g, ' ').trim();
  const pressed = async (locator) => (await locator.getAttribute('aria-pressed')) === 'true';

  /** Espera o botão (dado por seletor CSS) estar no estado pedido e devolve quantos ms levou desde `t0`. */
  const aguardar = async (page, selector, estado, t0) => {
    await page.waitForFunction(
      ([css, esperado]) => document.querySelector(css)?.getAttribute('aria-pressed') === esperado,
      [selector, String(estado)],
      { timeout: 10_000, polling: 'raf' },
    );
    return Date.now() - t0;
  };
  /**
   * Simula uma conexão LENTA (celular): toda chamada do navegador ao Firestore demora `ms` a mais. É assim que o defeito
   * aparece para as pessoas (no emulador, em localhost, tudo é instantâneo e nada parece lento). Devolve quem desliga.
   */
  const conexaoLenta = async (page, ms) => {
    const rota = '**/google.firestore.v1.Firestore/**';
    const atraso = async (route) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      await route.continue().catch(() => {});
    };
    await page.route(rota, atraso);
    return () => page.unroute(rota, atraso);
  };
  const LATENCIA_MS = 600;

  // ---------------------------------------------------------------------------------------------------------------
  section('resposta: preparação');
  let postId;
  let commentId;
  let commentPath;
  await step('A publica um post, B comenta e A abre a página do post', async () => {
    await A.page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await createPostViaUi(A.page, `Post para a resposta imediata ${stamp}`);
    postId = (await eventually(async () => (await adminFind('posts', { userId: A.uid })).find((p) => String(p.text).includes(`resposta imediata ${stamp}`)), { label: 'post de A' })).__id;
    await B.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
    await B.page.getByText('Escreva um comentário...').first().click();
    const dialog = B.page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByPlaceholder('Escreva um comentário...').fill(`Comentário para curtir ${stamp}`);
    await dialog.getByRole('button', { name: 'Responder', exact: true }).click();
    await dialog.waitFor({ state: 'detached', timeout: 60_000 });
    const comment = await eventually(async () => (await adminFind('comments', {}, { allDescendants: true })).find((c) => String(c.text).includes(`Comentário para curtir ${stamp}`)), { label: 'comentário de B' });
    commentId = comment.__id;
    commentPath = comment.__path;
    await A.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
    await commentBox(A.page, commentId).waitFor({ timeout: 60_000 });
    return `comentário ${commentId}`;
  });

  // ---------------------------------------------------------------------------------------------------------------
  section('resposta: curtir comentário');
  await soft(`A curte o comentário COM CONEXÃO LENTA (+${LATENCIA_MS} ms em cada chamada): botão pressionado e contador 1 em poucas centenas de ms, botão nunca desabilitado`, async () => {
    const soltar = await conexaoLenta(A.page, LATENCIA_MS);
    try {
      const botao = likeButton(A.page, commentId);
      check(!(await pressed(botao)), 'o comentário já começa curtido');
      const t0 = Date.now();
      await botao.click();
      const ms = await aguardar(A.page, inComment(commentId, LIKE_SELECTOR), true, t0);
      check(ms <= RESPOSTA_MAX_MS, `a curtida levou ${ms} ms para aparecer (limite ${RESPOSTA_MAX_MS} ms) com a conexão lenta`);
      check(!(await botao.isDisabled()), 'o botão de curtir ficou DESABILITADO esperando o servidor (parece que o toque não pegou)');
      await eventually(async () => (await textOf(botao)).includes('1'), { label: 'contador 1 na tela', timeoutMs: 3000 });
      await eventually(async () => (await adminGetDoc(`${commentPath}/likes/${A.uid}`)).doc, { label: 'marcador gravado (em segundo plano)', timeoutMs: 20_000 });
      return `${ms} ms`;
    } finally {
      await soltar();
    }
  }, { tag: 'ux' });

  await soft('dado ATRASADO do servidor logo depois do toque (atualizações do documento) NÃO desfaz a curtida na tela', async () => {
    // Descurte e curte de novo, e a cada toque o documento é atualizado por fora: o listener da tela recebe o comentário
    // com o contador ANTIGO (a Function ainda não somou), exatamente o dado atrasado que sobrescrevia o toque.
    const botao = likeButton(A.page, commentId);
    await eventually(async () => (await adminGetDoc(`${commentPath}`)).doc?.likes === 1, { label: 'a Function somou a curtida' });
    await botao.click(); // descurte
    await aguardar(A.page, inComment(commentId, LIKE_SELECTOR), false, Date.now());
    const amostras = [];
    for (let i = 0; i < 6; i++) {
      await fsUpdate(commentPath, { updatedAt: new Date() }, 'owner'); // snapshot sem mudar o contador
      await A.page.waitForTimeout(120);
      amostras.push({ pressionado: await pressed(botao), texto: await textOf(botao) });
    }
    check(amostras.every((a) => a.pressionado === false), `a tela voltou a mostrar "curtido" com dado atrasado: ${JSON.stringify(amostras)}`);
    await botao.click(); // curte de novo
    const t0 = Date.now();
    const amostras2 = [];
    for (let i = 0; i < 12; i++) {
      await fsUpdate(commentPath, { updatedAt: new Date() }, 'owner');
      await A.page.waitForTimeout(150);
      amostras2.push(await pressed(botao));
    }
    check(amostras2.every(Boolean), `a curtida piscou/sumiu com dado atrasado: ${JSON.stringify(amostras2)}`);
    await shot(A.page, 'resposta-01-curtida-estavel');
    void t0;
  }, { tag: 'ux' });

  await soft('o estado FINAL da tela é o do banco: curtido na tela, marcador gravado e contador = 1 (sem piscar, sem somar duas vezes)', async () => {
    await eventually(async () => (await adminGetDoc(`${commentPath}/likes/${A.uid}`)).doc, { label: 'marcador da curtida' });
    await eventually(async () => (await adminGetDoc(commentPath)).doc?.likes === 1, { label: 'contador do comentário = 1' });
    const botao = likeButton(A.page, commentId);
    await A.page.waitForTimeout(3500); // passa a janela de tolerância do toque
    check(await pressed(botao), 'a curtida sumiu da tela depois de assentar');
    const texto = await textOf(botao);
    check(/(^|\s)1(\s|$)/.test(texto), `contador na tela: "${texto}" (esperado 1)`);
  }, { tag: 'funcional' });

  await soft('toques RÁPIDOS com conexão lenta terminam no estado certo na tela e no banco: 2 toques (curtido -> curtido) e 3 toques (-> descurtido)', async () => {
    const soltar = await conexaoLenta(A.page, LATENCIA_MS);
    try {
      const botao = likeButton(A.page, commentId);
      check(await pressed(botao), 'o comentário deveria estar curtido neste ponto');
      await botao.click();
      await botao.click(); // curtido -> descurtido -> curtido
      check(await pressed(botao), 'dois toques rápidos deveriam terminar curtido, NA HORA (mesmo antes de gravar)');
      await A.page.waitForTimeout(2500);
      check(await pressed(botao), 'a curtida sumiu depois de gravar');
      await stableFor(async () => !!(await adminGetDoc(`${commentPath}/likes/${A.uid}`)).doc, { label: 'marcador continua gravado' });
      await botao.click();
      await botao.click();
      await botao.click(); // curtido -> descurtido -> curtido -> descurtido
      check(!(await pressed(botao)), 'três toques rápidos deveriam terminar descurtido NA HORA');
      await stableFor(async () => !(await adminGetDoc(`${commentPath}/likes/${A.uid}`)).doc, { label: 'marcador apagado no banco' });
      await eventually(async () => (await adminGetDoc(commentPath)).doc?.likes === 0, { label: 'contador volta a 0', timeoutMs: 20_000 });
      await A.page.waitForTimeout(1500);
      check(!(await pressed(botao)), 'depois de assentar a tela voltou a mostrar curtido');
    } finally {
      await soltar();
    }
  }, { tag: 'funcional' });

  await soft('o servidor RECUSA a curtida (o dono do post bloqueou B depois de a tela abrir): a tela volta a "não curtido" e avisa com texto claro', async () => {
    // O post é de A. A página de B abre normalmente e SÓ DEPOIS A bloqueia B (se o bloqueio existisse antes, a página nem
    // mostraria o comentário). As regras do servidor recusam a curtida de quem foi bloqueado pelo dono do post.
    await B.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
    await commentBox(B.page, commentId).waitFor({ timeout: 60_000 });
    const botao = likeButton(B.page, commentId);
    check(!(await pressed(botao)), 'B já começa com o comentário curtido');
    await fsSet(`users/${A.uid}/blockedUsers/${B.uid}`, { userId: B.uid, createdAt: new Date() }, 'owner');
    try {
      await botao.click();
      const aviso = B.page.locator('[role="status"]').filter({ hasText: /Não foi possível curtir/ }).first();
      await aviso.waitFor({ timeout: 15_000 });
      await eventually(async () => !(await pressed(botao)), { label: 'a tela voltou a "não curtido"', timeoutMs: 5000 });
      check(!/(^|\s)[1-9]\d*(\s|$)/.test(await textOf(botao)), `o contador ficou somado na tela: "${await textOf(botao)}"`);
      check(!(await adminGetDoc(`${commentPath}/likes/${B.uid}`)).doc, 'a curtida recusada foi gravada');
      await shot(B.page, 'resposta-02-curtida-recusada');
    } finally {
      await fsDelete(`users/${A.uid}/blockedUsers/${B.uid}`, 'owner');
    }
  }, { tag: 'funcional' });

  // ---------------------------------------------------------------------------------------------------------------
  section('resposta: repostar comentário e curtir post');
  await soft('B reposta o comentário: botão pressionado e contador +1 na hora; marcador gravado', async () => {
    await B.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
    await commentBox(B.page, commentId).waitFor({ timeout: 60_000 });
    const botao = repostButton(B.page, commentId);
    const t0 = Date.now();
    await botao.click();
    await B.page.getByRole('menuitem', { name: 'Repostar Comentário' }).click();
    const ms = await aguardar(B.page, inComment(commentId, REPOST_SELECTOR), true, t0);
    check(ms <= 1500, `o repost levou ${ms} ms para aparecer`);
    await eventually(async () => !!(await adminGetDoc(`${commentPath}/reposts/${B.uid}`)).doc, { label: 'marcador do repost' });
    return `${ms} ms`;
  }, { tag: 'ux' });

  await soft('o menu de repost aberto NÃO fecha quando um contador do comentário muda por fora (o botão não é remontado)', async () => {
    // Antes o botão de repost era um componente declarado dentro de outro: a cada mudança de contador o React o
    // desmontava e montava de novo, fechando o menu e tirando o foco de quem estava escolhendo.
    await B.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
    await commentBox(B.page, commentId).waitFor({ timeout: 60_000 });
    await repostButton(B.page, commentId).click();
    const item = B.page.getByRole('menuitem', { name: /Repost|Desfazer/ }).first();
    await item.waitFor({ timeout: 10_000 });
    for (const likes of [7, 8, 9]) {
      await fsUpdate(commentPath, { likes }, 'owner'); // o contador de curtidas muda: o comentário inteiro é redesenhado
      await B.page.waitForTimeout(350);
    }
    check(await item.isVisible(), 'o menu de repost fechou quando um contador mudou por fora');
    await B.page.keyboard.press('Escape');
    await fsUpdate(commentPath, { likes: 0 }, 'owner');
  }, { tag: 'ux' });

  await soft('B curte o POST de A: botão pressionado em poucas centenas de ms e contador +1', async () => {
    const botao = B.page.locator('main button:has(svg.lucide-heart)').first();
    const t0 = Date.now();
    await botao.click();
    const ms = await aguardar(B.page, 'main button:has(svg.lucide-heart)', true, t0);
    check(ms <= RESPOSTA_MAX_MS, `a curtida do post levou ${ms} ms (limite ${RESPOSTA_MAX_MS} ms)`);
    await eventually(async () => (await adminGetDoc(`posts/${postId}/likes/${B.uid}`)).doc, { label: 'marcador da curtida do post' });
    await eventually(async () => (await adminGetDoc(`posts/${postId}`)).doc?.likes === 1, { label: 'contador do post = 1' });
    await B.page.waitForTimeout(3500);
    check(await pressed(botao), 'a curtida do post sumiu da tela depois de assentar');
    return `${ms} ms`;
  }, { tag: 'ux' });
}
