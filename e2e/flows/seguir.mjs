/**
 * Seção "seguir": o botão Seguir responde NA HORA, como curtir (veja a seção "resposta").
 *
 * Antes, tocar em Seguir esperava 3 a 4 idas ao servidor em sequência (ler, gravar, checar seguimento mútuo, atualizar o
 * usuário) antes de a tela mudar; no perfil nada mudava até o fim, e nas listas e cartões o botão ficava desabilitado, com
 * ícone de espera. No celular isso parece "o toque não pegou". Aqui se confere, pela tela real e com uma conexão lenta
 * simulada (+600 ms em cada chamada ao Firestore):
 *   - o botão vira "Seguindo" e o contador de seguidores sobe em poucas centenas de ms, sem nunca ficar desabilitado;
 *   - depois da tolerância do motor (8 s) a tela continua mostrando "Seguindo" (sem listener ao vivo, o estado gravado precisa
 *     valer como o do servidor; senão "seguir" parecia desfazer sozinho);
 *   - toques rápidos terminam no estado certo na tela e no banco;
 *   - se o servidor recusar (B bloqueou A), a tela volta ao que era, avisa com texto claro e nada é gravado;
 *   - o mesmo na lista de pessoas.
 * A segue B. O estado final é "A não segue B" (as outras seções, como notificacoes, contam com isso).
 */
import { adminGetDoc, eventually, fsDelete, fsSet, stableFor } from '../lib/harness.mjs';

const RESPOSTA_MAX_MS = 700;

export async function run(ctx) {
  const { runner, users, BASE_URL, shot } = ctx;
  const { a: A, b: B } = users;
  const { section, soft, check } = runner;
  const profileUrl = `${BASE_URL}/pt-BR/profile/${B.uid}`;
  const SEGUIR = '[data-testid="profile-follow-button"]';
  // O link de seguidores do PERFIL DE B (a barra lateral tem outro, o do próprio A: `.first()` pegaria o errado).
  const SEGUIDORES = `a[href$="/profile/${B.uid}/followers"] > span.font-bold`;
  const botao = () => A.page.locator(SEGUIR).first();
  const pressed = async () => (await botao().getAttribute('aria-pressed')) === 'true';
  const seguidoresNaTela = async () => Number((await A.page.locator(SEGUIDORES).first().innerText()).trim());
  const aguardarPressionado = (selector, estado) => A.page.waitForFunction(
    ([css, esperado]) => document.querySelector(css)?.getAttribute('aria-pressed') === esperado,
    [selector, String(estado)],
    { timeout: 10_000, polling: 'raf' },
  );
  const conexaoLenta = async (page, ms) => {
    const rota = '**/google.firestore.v1.Firestore/**';
    const atraso = async (route) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      await route.continue().catch(() => {});
    };
    await page.route(rota, atraso);
    return () => page.unroute(rota, atraso);
  };
  const estaNoBanco = async () => !!(await adminGetDoc(`users/${A.uid}/following/${B.uid}`)).doc && !!(await adminGetDoc(`users/${B.uid}/followers/${A.uid}`)).doc;
  const naoEstaNoBanco = async () => !(await adminGetDoc(`users/${A.uid}/following/${B.uid}`)).doc && !(await adminGetDoc(`users/${B.uid}/followers/${A.uid}`)).doc;
  const limpar = async () => {
    await fsDelete(`users/${A.uid}/following/${B.uid}`, 'owner');
    await fsDelete(`users/${B.uid}/followers/${A.uid}`, 'owner');
  };
  // Toques rápidos viram uma FILA de gravações (seguir, deixar de seguir, seguir...) que, com +600 ms em cada chamada, leva
  // alguns segundos: o banco passa por estados que coincidem com o esperado. `stableFor` espera o estado E que ele pare nele
  // (senão o apagamento do administrador, no meio da fila, seria desfeito por ela).
  const estavelPor = (predicado, rotulo) => stableFor(predicado, { label: rotulo });

  section('seguir: no perfil');
  try {
    await soft(`A segue B COM CONEXÃO LENTA (+600 ms em cada chamada): "Seguindo" e o contador +1 em poucas centenas de ms, botão nunca desabilitado`, async () => {
      await limpar();
      await A.page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
      await botao().waitFor({ timeout: 60_000 });
      await A.page.waitForTimeout(1500);
      check(!(await pressed()), 'A já começa seguindo B');
      const antes = await seguidoresNaTela();
      const soltar = await conexaoLenta(A.page, 600);
      try {
        const t0 = Date.now();
        await botao().click();
        await aguardarPressionado(SEGUIR, true);
        const ms = Date.now() - t0;
        check(ms <= RESPOSTA_MAX_MS, `o botão levou ${ms} ms para virar "Seguindo" (limite ${RESPOSTA_MAX_MS} ms) com a conexão lenta`);
        check(!(await botao().isDisabled()), 'o botão ficou DESABILITADO esperando o servidor (parece que o toque não pegou)');
        check((await seguidoresNaTela()) === antes + 1, `contador de seguidores na tela: ${await seguidoresNaTela()} (esperado ${antes + 1})`);
        await eventually(estaNoBanco, { label: 'seguir gravado no banco (em segundo plano)', timeoutMs: 20_000 });
        return `${ms} ms`;
      } finally {
        await soltar();
      }
    }, { tag: 'ux' });

    await soft('depois da tolerância do motor (9 s) a tela CONTINUA mostrando "Seguindo" e o contador do banco (sem desfazer sozinho)', async () => {
      await eventually(async () => (await adminGetDoc(`users/${B.uid}`)).doc?.followersCount >= 1, { label: 'a Function somar o seguidor', timeoutMs: 30_000 });
      await A.page.waitForTimeout(9000);
      check(await pressed(), 'o botão voltou a "Seguir" sozinho depois da tolerância');
      const noBanco = (await adminGetDoc(`users/${B.uid}`)).doc.followersCount;
      check((await seguidoresNaTela()) === noBanco, `contador na tela ${await seguidoresNaTela()} diferente do banco ${noBanco}`);
      await shot(A.page, 'seguir-01-seguindo');
    }, { tag: 'ux' });

    await soft('toques RÁPIDOS com conexão lenta: 3 toques terminam em "Deixou de seguir" na tela e no banco; 2 toques, em "Seguindo"', async () => {
      const soltar = await conexaoLenta(A.page, 600);
      try {
        check(await pressed(), 'A deveria estar seguindo neste ponto');
        await botao().click();
        await botao().click();
        await botao().click(); // seguindo -> não -> seguindo -> não
        check(!(await pressed()), 'três toques rápidos deveriam terminar em "Seguir" NA HORA');
        await estavelPor(naoEstaNoBanco, 'três toques rápidos: seguir apagado no banco');
        check(!(await pressed()), 'depois de gravar a tela voltou a "Seguindo"');
        await botao().click();
        await botao().click(); // não -> seguindo -> não
        check(!(await pressed()), 'dois toques rápidos a partir de "Seguir" deveriam terminar em "Seguir"');
        await estavelPor(naoEstaNoBanco, 'dois toques rápidos: terminar sem seguir gravado');
        check(!(await pressed()), 'depois de gravar a tela voltou a "Seguindo"');
        await botao().click(); // volta a seguir (para as próximas verificações)
        await estavelPor(estaNoBanco, 'seguir gravado de novo');
      } finally {
        await soltar();
      }
    }, { tag: 'funcional' });

    await soft('o servidor RECUSA (B bloqueou A depois de a página abrir): a tela volta a "Seguir", avisa com texto claro e nada é gravado', async () => {
      await limpar();
      await eventually(naoEstaNoBanco, { label: 'a limpeza do seguir (feita pelo administrador) aparecer no banco', timeoutMs: 10_000 });
      await A.page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
      await botao().waitFor({ timeout: 60_000 });
      await A.page.waitForTimeout(1500);
      check(!(await pressed()), `A já começa seguindo B (banco: ${(await naoEstaNoBanco()) ? 'sem seguir' : 'com seguir'})`);
      const antes = await seguidoresNaTela();
      await fsSet(`users/${B.uid}/blockedUsers/${A.uid}`, { userId: A.uid, createdAt: new Date() }, 'owner');
      try {
        await botao().click();
        await A.page.locator('[role="status"]').filter({ hasText: /Não foi possível atualizar o seguir/ }).first().waitFor({ timeout: 15_000 });
        await eventually(async () => !(await pressed()), { label: 'a tela voltou a "Seguir"', timeoutMs: 5000 });
        check((await seguidoresNaTela()) === antes, `o contador ficou somado na tela: ${await seguidoresNaTela()} (esperado ${antes})`);
        check(await naoEstaNoBanco(), 'o seguir recusado foi gravado');
        await shot(A.page, 'seguir-02-recusado');
      } finally {
        await fsDelete(`users/${B.uid}/blockedUsers/${A.uid}`, 'owner');
      }
    }, { tag: 'funcional' });

    section('seguir: na lista de pessoas');
    await soft('na lista "Seguindo" de A, tocar no botão de B vira "Seguir" na hora (sem ícone de espera, nunca desabilitado) e grava', async () => {
      await limpar();
      await fsSet(`users/${A.uid}/following/${B.uid}`, { userId: B.uid, createdAt: new Date() }, 'owner');
      await fsSet(`users/${B.uid}/followers/${A.uid}`, { userId: A.uid, createdAt: new Date() }, 'owner');
      await A.page.goto(`${BASE_URL}/pt-BR/profile/${A.uid}/following`, { waitUntil: 'domcontentloaded' });
      const item = A.page.locator('[data-testid="follow-button"]').first();
      await item.waitFor({ timeout: 60_000 });
      await A.page.waitForTimeout(1500);
      check((await item.getAttribute('aria-pressed')) === 'true', 'B deveria aparecer como "seguindo" na lista de A');
      const soltar = await conexaoLenta(A.page, 600);
      try {
        const t0 = Date.now();
        await item.click();
        await aguardarPressionado('[data-testid="follow-button"]', false);
        const ms = Date.now() - t0;
        check(ms <= RESPOSTA_MAX_MS, `o botão da lista levou ${ms} ms para virar "Seguir" (limite ${RESPOSTA_MAX_MS} ms)`);
        check(!(await item.isDisabled()), 'o botão da lista ficou DESABILITADO esperando o servidor');
        check((await item.locator('svg.animate-spin').count()) === 0, 'o botão da lista mostrou o ícone de espera');
        await eventually(naoEstaNoBanco, { label: 'deixar de seguir gravado', timeoutMs: 25_000 });
        await A.page.waitForTimeout(1500);
        check((await item.getAttribute('aria-pressed')) === 'false', 'depois de gravar o botão da lista voltou a "Seguindo"');
        return `${ms} ms`;
      } finally {
        await soltar();
      }
    }, { tag: 'ux' });
  } finally {
    await limpar();
    await fsDelete(`users/${B.uid}/blockedUsers/${A.uid}`, 'owner');
  }
}
