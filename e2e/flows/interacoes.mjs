/**
 * Seção "interacoes": TODAS as ações sobre um post e sobre um comentário, pela interface real, com a notificação que
 * cada uma gera para o dono do conteúdo — e o mesmo conjunto num PERFIL PRIVADO, onde quem segue continua fazendo tudo
 * e quem não segue é recusado pelas regras.
 *
 * A é o autor do post; B segue A, comenta e interage; C não segue A. Os dados são conferidos com o administrador do
 * emulador (ignora regras) e as recusas são medidas pela REST com o login real de C.
 */
import {
  adminFind,
  adminGetDoc,
  createPostViaUi,
  eventually,
  fsCall,
  // Marcadores (curtida, repost) e comentários exigem a hora do SERVIDOR: com a hora do cliente a regra recusa pelo
  // FORMATO, e um teste de recusa passaria pelo motivo errado (sem provar a regra de privacidade).
  fsCreateAtServerTime,
  fsSet,
  fsUpdate,
} from '../lib/harness.mjs';

const denied = (response) => response.status === 401 || response.status === 403;

export async function run(ctx) {
  const { runner, users, BASE_URL, stamp, shot } = ctx;
  const { a: A, b: B, c: C } = users;
  const { section, step, soft, check } = runner;
  const postUrl = (postId) => `${BASE_URL}/pt-BR/post/${postId}`;
  const tokenC = await ctx.token(C);

  const notificationsOf = async (user, type) =>
    (await adminFind('notifications', { recipientId: user.uid })).filter((n) => !type || n.type === type);
  /** Espera a Function criar a notificação do tipo pedido para a pessoa (entityId opcional). */
  const waitNotification = (user, type, entityId) =>
    eventually(async () => {
      const found = (await notificationsOf(user, type)).filter((n) => !entityId || n.entityId === entityId);
      return found.length ? found[found.length - 1] : null;
    }, { label: `notificação ${type} para ${user.label.toUpperCase()}`, timeoutMs: 60_000 });

  // O menu de repost/citação fecha com animação; um clique durante ela é engolido (mesmo cuidado da seção social).
  const openMenu = async (page, trigger) => {
    await page.locator('[role=menu]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    for (let attempt = 0; attempt < 3; attempt++) {
      await trigger.click();
      try {
        await page.getByRole('menu').waitFor({ state: 'visible', timeout: 3000 });
        return;
      } catch { /* tenta de novo */ }
    }
    throw new Error('o menu de repost/citação não abriu');
  };
  const postRepostButton = (page) => page.locator('main button:has(svg.lucide-repeat2)').first();
  const commentBox = (page, commentId) => page.locator(`#comment-${commentId}`);
  /** Escreve a citação no diálogo ("E aí...") e publica. */
  const sendQuote = async (page, text) => {
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ timeout: 15_000 });
    await dialog.getByPlaceholder('E aí...').fill(text);
    await dialog.getByRole('button', { name: 'Postar', exact: true }).click();
    await dialog.waitFor({ state: 'detached', timeout: 60_000 });
  };
  /** Escreve um comentário ou uma resposta no diálogo e envia. */
  const sendComment = async (page, text) => {
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ timeout: 15_000 });
    await dialog.getByPlaceholder('Escreva um comentário...').fill(text);
    await dialog.getByRole('button', { name: 'Responder', exact: true }).click();
    await dialog.waitFor({ state: 'detached', timeout: 60_000 });
  };
  const findPostByText = (user, text) =>
    eventually(async () => (await adminFind('posts', { userId: user.uid })).find((p) => String(p.text ?? '').includes(text)),
      { label: `post de ${user.label.toUpperCase()} com "${text.slice(0, 24)}"`, timeoutMs: 60_000 });
  const findCommentByText = (text) =>
    eventually(async () => (await adminFind('comments', {}, { allDescendants: true })).find((c) => String(c.text ?? '').includes(text)),
      { label: `comentário com "${text.slice(0, 24)}"`, timeoutMs: 60_000 });

  // ---------------------------------------------------------------------------------------------------------------
  section('interacoes: preparação');
  let postId;
  let commentId;
  const postText = `Post de A para todas as acoes ${stamp}`;
  await step('A publica o post e B passa a seguir A', async () => {
    await A.page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await createPostViaUi(A.page, postText);
    postId = (await findPostByText(A, postText)).__id;
    // Seguir semeado pelo administrador: a seção social já cobre o seguir pela interface.
    await fsSet(`users/${A.uid}/followers/${B.uid}`, { userId: B.uid, createdAt: new Date() }, 'owner');
    await fsSet(`users/${B.uid}/following/${A.uid}`, { userId: A.uid, createdAt: new Date() }, 'owner');
    return `post ${postId}`;
  });

  // ---------------------------------------------------------------------------------------------------------------
  section('interacoes: repostar e citar um POST');
  await soft('B reposta o post de A: botão pressionado, documento gravado e notificação "repost" para A', async () => {
    await B.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
    await openMenu(B.page, postRepostButton(B.page));
    await B.page.getByRole('menuitem', { name: 'Repostar', exact: true }).click();
    await eventually(async () => (await postRepostButton(B.page).getAttribute('aria-pressed')) === 'true', { label: 'botão de repost pressionado' });
    await eventually(async () => (await adminGetDoc(`posts/${postId}/reposts/${B.uid}`)).doc, { label: 'documento do repost' });
    await eventually(async () => (await adminGetDoc(`posts/${postId}`)).doc.reposts === 1, { label: 'contador reposts = 1' });
    const notification = await waitNotification(A, 'repost', postId);
    check(notification.actors?.some((actor) => actor.userId === B.uid), 'a notificação de repost não aponta B como autor');
    await shot(B.page, 'interacoes-01-repost-do-post');
  }, { tag: 'funcional' });
  await soft('B desfaz o repost: documento removido e contador de volta a 0', async () => {
    await openMenu(B.page, postRepostButton(B.page));
    await B.page.getByRole('menuitem', { name: 'Desfazer Repost' }).click();
    await eventually(async () => !(await adminGetDoc(`posts/${postId}/reposts/${B.uid}`)).doc, { label: 'repost removido' });
    await eventually(async () => (await adminGetDoc(`posts/${postId}`)).doc.reposts === 0, { label: 'contador reposts = 0' });
  }, { tag: 'funcional' });

  const quoteText = `Citando o post de A ${stamp}`;
  let quotePostId;
  await soft('B cita o post de A: vira post de B, quotesCount = 1 e notificação "quote" para A', async () => {
    await openMenu(B.page, postRepostButton(B.page));
    await B.page.getByRole('menuitem', { name: 'Citar postagem' }).click();
    await sendQuote(B.page, quoteText);
    const quote = await findPostByText(B, quoteText);
    quotePostId = quote.__id;
    check(quote.type === 'quote', `o post criado é do tipo "${quote.type}" (esperado quote)`);
    check(quote.originalPostDetails?.id === postId, 'a citação não aponta para o post de A');
    await eventually(async () => (await adminGetDoc(`posts/${postId}`)).doc.quotesCount === 1, { label: 'quotesCount = 1 no post de A' });
    const notification = await waitNotification(A, 'quote', postId);
    check(notification.actors?.some((actor) => actor.userId === B.uid), 'a notificação de citação não aponta B como autor');
    await shot(B.page, 'interacoes-02-citacao-do-post');
    return `citação ${quotePostId}`;
  }, { tag: 'funcional' });
  await soft('a página da citação mostra o texto de B E o post de A citado dentro dela', async () => {
    await B.page.goto(postUrl(quotePostId), { waitUntil: 'domcontentloaded' });
    await B.page.getByText(quoteText).first().waitFor({ timeout: 60_000 });
    await B.page.getByText(postText).first().waitFor({ timeout: 30_000 });
  }, { tag: 'funcional' });
  await soft('B desfaz a citação: o post de citação é apagado e quotesCount volta a 0', async () => {
    await B.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
    await openMenu(B.page, postRepostButton(B.page));
    B.page.once('dialog', (dialog) => dialog.accept()); // "tem certeza que quer deletar sua citação?"
    await B.page.getByRole('menuitem', { name: 'Desfazer Citação' }).click();
    await eventually(async () => (await adminGetDoc(`posts/${postId}`)).doc.quotesCount === 0, { label: 'quotesCount = 0' });
    await eventually(async () => (await adminGetDoc(`posts/${quotePostId}`)).doc?.isDeleted !== false, { label: 'post de citação apagado' });
  }, { tag: 'funcional' });

  // ---------------------------------------------------------------------------------------------------------------
  section('interacoes: comentar, responder, repostar e citar um COMENTÁRIO');
  const commentText = `Comentario de B ${stamp}`;
  await soft('B comenta no post de A: commentsCount = 1 e notificação "comment_on_post" para A', async () => {
    await B.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
    await B.page.getByText('Escreva um comentário...').first().click();
    await sendComment(B.page, commentText);
    await B.page.getByText(commentText).first().waitFor({ timeout: 90_000 });
    commentId = (await findCommentByText(commentText)).__id;
    await eventually(async () => (await adminGetDoc(`posts/${postId}`)).doc.commentsCount === 1, { label: 'commentsCount = 1' });
    await waitNotification(A, 'comment_on_post', postId);
    return `comentário ${commentId}`;
  }, { tag: 'funcional' });

  const replyText = `Resposta de A ao comentario ${stamp}`;
  let replyCommentId;
  await soft('A responde ao comentário de B: resposta gravada e notificação "reply_to_comment" para B', async () => {
    await A.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
    await commentBox(A.page, commentId).waitFor({ timeout: 60_000 });
    await commentBox(A.page, commentId).locator('button[title="Reply to comment"]').first().click();
    await sendComment(A.page, replyText);
    const reply = await findCommentByText(replyText);
    replyCommentId = reply.__id;
    check(reply.parentCommentId === commentId, `a resposta aponta para ${reply.parentCommentId} (esperado ${commentId})`);
    await waitNotification(B, 'reply_to_comment');
    await shot(A.page, 'interacoes-03-resposta-ao-comentario');
  }, { tag: 'funcional' });

  const commentRepostButton = (page) => commentBox(page, commentId).locator('button:has(svg.lucide-repeat2)').first();
  await soft('A reposta o comentário de B: repostsCount = 1 e notificação "repost" para B', async () => {
    await openMenu(A.page, commentRepostButton(A.page));
    await A.page.getByRole('menuitem', { name: 'Repostar Comentário' }).click();
    await eventually(async () => (await adminGetDoc(`posts/${postId}/comments/${commentId}`)).doc.repostsCount === 1, { label: 'repostsCount = 1 no comentário' });
    const notification = await waitNotification(B, 'repost', commentId);
    check(notification.actors?.some((actor) => actor.userId === A.uid), 'a notificação não aponta A como autor');
    await shot(A.page, 'interacoes-04-repost-do-comentario');
  }, { tag: 'funcional' });

  const quoteCommentText = `Citando o comentario de B ${stamp}`;
  // No comentário, repost e citação somam no MESMO contador (repostsCount), que é o número mostrado no cartão.
  await soft('A cita o comentário de B: vira post de A com quotedCommentId e notificação "quote" para B', async () => {
    await openMenu(A.page, commentRepostButton(A.page));
    await A.page.getByRole('menuitem', { name: 'Citar Comentário' }).click();
    await sendQuote(A.page, quoteCommentText);
    const quote = await findPostByText(A, quoteCommentText);
    check(quote.quotedCommentId === `${postId}/${commentId}`, `quotedCommentId = ${quote.quotedCommentId}`);
    await eventually(async () => (await adminGetDoc(`posts/${postId}/comments/${commentId}`)).doc.repostsCount === 2, { label: 'repost + citação = 2 no comentário' });
    await waitNotification(B, 'quote', commentId);
  }, { tag: 'funcional' });

  // ---------------------------------------------------------------------------------------------------------------
  section('interacoes: menção e salvar');
  await soft('post que menciona @A gera notificação "mention_in_post" para A', async () => {
    const text = `Oi @${A.username} veja isso ${stamp}`;
    await B.page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await createPostViaUi(B.page, text);
    await findPostByText(B, `veja isso ${stamp}`);
    await waitNotification(A, 'mention_in_post');
  }, { tag: 'funcional' });
  await soft('B salva o post de A: fica gravado na lista de salvos de B', async () => {
    await B.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
    await B.page.locator('main button:has(svg.lucide-bookmark)').first().click();
    await eventually(async () => (await adminGetDoc(`users/${B.uid}/bookmarks/${postId}`)).doc, { label: 'post salvo gravado' });
  }, { tag: 'funcional' });

  // ---------------------------------------------------------------------------------------------------------------
  section('interacoes: compartilhar em outras redes');
  await soft('o menu Compartilhar abre com as redes e a imagem do post no visual do Exe. Lula', async () => {
    await B.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
    await B.page.locator('main button:has(svg.lucide-ellipsis), main button:has(svg.lucide-more-horizontal)').first().click();
    await B.page.getByRole('menuitem', { name: 'Compartilhar' }).click();
    const dialog = B.page.getByRole('dialog');
    // exact: a descrição do diálogo também contém "imagem para o Instagram".
    await dialog.getByText('Imagem para o Instagram', { exact: true }).waitFor({ timeout: 30_000 });
    for (const rede of ['WhatsApp', 'X', 'Bluesky', 'Telegram', 'Facebook', 'Threads']) {
      const href = await dialog.getByRole('link', { name: rede, exact: true }).getAttribute('href');
      check(href?.includes(encodeURIComponent(postId)), `o link do ${rede} não leva ao post: ${href?.slice(0, 60)}`);
    }
    await shot(B.page, 'interacoes-09-compartilhar');
    await B.page.keyboard.press('Escape');
  }, { tag: 'funcional' });
  await soft('a imagem do post sai pronta nos três formatos (link, feed e story)', async () => {
    const tamanhos = { '': '1200x630', '?formato=quadrado': '1080x1080', '?formato=story': '1080x1920' };
    for (const [parametro, esperado] of Object.entries(tamanhos)) {
      const response = await fetch(`${BASE_URL}/api/post-image/${postId}${parametro}`, { redirect: 'manual' });
      check(response.status === 200, `formato ${esperado}: HTTP ${response.status}`);
      check((response.headers.get('content-type') ?? '').includes('image/png'), `formato ${esperado} não veio como imagem`);
    }
    return Object.values(tamanhos).join(', ');
  }, { tag: 'funcional' });
  await soft('a prévia do link do post público mostra o próprio post, não a logo genérica', async () => {
    const html = await (await fetch(`${BASE_URL}/pt-BR/post/${postId}`)).text();
    const imagem = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? '';
    check(imagem.includes(`/api/post-image/${postId}`), `og:image = ${imagem.slice(0, 80)}`);
    return imagem.slice(0, 70);
  }, { tag: 'funcional' });

  // ---------------------------------------------------------------------------------------------------------------
  section('interacoes: as mesmas ações com o PERFIL PRIVADO de A');
  await step('A liga "Perfil Privado" e os posts passam a ser só para seguidores', async () => {
    await A.page.goto(`${BASE_URL}/pt-BR/settings/privacy`, { waitUntil: 'domcontentloaded' });
    await A.page.locator('#private-profile-switch').click();
    await eventually(async () => (await adminGetDoc(`users/${A.uid}`)).doc.profileVisibility === 'private', { label: 'perfil privado' });
    await eventually(async () => (await adminGetDoc(`posts/${postId}`)).doc.visibility === 'followers', { label: 'post só para seguidores' });
  });

  // O conteúdo é do próprio autor: o repost e a citação dele nascem com a visibilidade do perfil dele e não saem do
  // círculo. Antes a conta privada não conseguia repostar nem citar NADA do que era dela.
  // O repost é só um marcador (o feed monta a entrada a partir dele), então ele acompanha a visibilidade do original.
  await soft('o AUTOR reposta o PRÓPRIO post restrito', async () => {
    await A.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
    await A.page.getByText(postText).first().waitFor({ timeout: 60_000 });
    await openMenu(A.page, postRepostButton(A.page));
    await A.page.getByRole('menuitem', { name: 'Repostar', exact: true }).click();
    await eventually(async () => (await adminGetDoc(`posts/${postId}/reposts/${A.uid}`)).doc, { label: 'repost do autor gravado' });
    await eventually(async () => (await adminGetDoc(`posts/${postId}`)).doc.reposts === 1, { label: 'contador reposts = 1' });
  }, { tag: 'funcional' });
  const quoteDoAutorText = `Citando o proprio post restrito ${stamp}`;
  await soft('o AUTOR cita o PRÓPRIO post restrito, e a citação fica só para seguidores', async () => {
    await openMenu(A.page, postRepostButton(A.page));
    await A.page.getByRole('menuitem', { name: 'Citar postagem' }).click();
    await sendQuote(A.page, quoteDoAutorText);
    const quote = await findPostByText(A, quoteDoAutorText);
    check(quote.type === 'quote', 'a citação do próprio post não foi criada');
    check(quote.visibility === 'followers', `a citação do autor ficou com visibility = ${quote.visibility}`);
    await shot(A.page, 'interacoes-07-autor-cita-o-proprio-post-restrito');
  }, { tag: 'funcional' });
  await soft('o AUTOR reposta o PRÓPRIO comentário dentro do post restrito', async () => {
    await A.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
    const bar = commentBox(A.page, replyCommentId);
    await bar.waitFor({ timeout: 60_000 });
    await openMenu(A.page, bar.locator('button:has(svg.lucide-repeat2)').first());
    await A.page.getByRole('menuitem', { name: 'Repostar Comentário' }).click();
    await eventually(async () => (await adminGetDoc(`posts/${postId}/comments/${replyCommentId}`)).doc.repostsCount === 1,
      { label: 'repost do próprio comentário' });
  }, { tag: 'funcional' });

  await soft('quem SEGUE (B) continua curtindo o post restrito, e A é notificado', async () => {
    await B.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
    await B.page.getByText(postText).first().waitFor({ timeout: 60_000 });
    await B.page.locator('main button:has(svg.lucide-heart)').first().click();
    await eventually(async () => (await adminGetDoc(`posts/${postId}/likes/${B.uid}`)).doc, { label: 'curtida gravada' });
    await waitNotification(A, 'like_post', postId);
    await shot(B.page, 'interacoes-05-acoes-no-perfil-privado');
  }, { tag: 'funcional' });
  await soft('quem SEGUE (B) continua comentando no post restrito', async () => {
    const text = `Comentario no perfil privado ${stamp}`;
    await B.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
    await B.page.getByText('Escreva um comentário...').first().click();
    await sendComment(B.page, text);
    const comment = await findCommentByText(text);
    check(comment.postVisibility === 'followers', `o comentário guardou postVisibility = ${comment.postVisibility}`);
    await waitNotification(A, 'comment_on_post', postId);
  }, { tag: 'funcional' });

  // Repostar e citar levariam o conteúdo para fora do círculo do autor: o servidor recusa e a interface não pode
  // oferecer a ação como se funcionasse (era o que acontecia: a opção abria e falhava com erro de permissão).
  await soft('para QUEM SEGUE, repostar e citar o post restrito ficam DESABILITADOS, com o motivo explicado', async () => {
    await B.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
    await B.page.getByText(postText).first().waitFor({ timeout: 60_000 });
    await openMenu(B.page, postRepostButton(B.page));
    const repostar = B.page.getByRole('menuitem', { name: 'Repostar', exact: true });
    const citar = B.page.getByRole('menuitem', { name: 'Citar postagem' });
    check(await repostar.isDisabled(), '"Repostar" continua clicável num post só para seguidores');
    check(await citar.isDisabled(), '"Citar postagem" continua clicável num post só para seguidores');
    check(/só para seguidores/i.test((await repostar.getAttribute('title')) ?? ''), 'falta explicar por que não dá para repostar');
    await shot(B.page, 'interacoes-06-repost-e-citacao-desabilitados');
    await B.page.keyboard.press('Escape');
  }, { tag: 'ux' });
  await soft('o servidor também recusa repostar o post restrito (defesa real, além da interface)', async () => {
    const tokenB = await ctx.token(B);
    const response = await fsCreateAtServerTime(`posts/${postId}/reposts`, B.uid, { userId: B.uid, createdAt: new Date() }, tokenB);
    check(denied(response), `quem segue conseguiu repostar um post restrito (HTTP ${response.status})`);
    return `recusado (HTTP ${response.status})`;
  }, { tag: 'seg' });

  const negar = (nome, chamada) =>
    soft(nome, async () => {
      const response = await chamada();
      check(denied(response), `a operação foi PERMITIDA (HTTP ${response.status})`);
      return `recusado (HTTP ${response.status})`;
    }, { tag: 'seg' });

  await negar('quem NÃO segue (C) não lê o post restrito', () => fsCall('GET', `posts/${postId}`, { token: tokenC }));
  await negar('quem NÃO segue (C) não curte o post restrito', () =>
    fsCreateAtServerTime(`posts/${postId}/likes`, C.uid, { userId: C.uid, createdAt: new Date() }, tokenC));
  await negar('quem NÃO segue (C) não reposta o post restrito', () =>
    fsCreateAtServerTime(`posts/${postId}/reposts`, C.uid, { userId: C.uid, createdAt: new Date() }, tokenC));
  await negar('quem NÃO segue (C) não comenta no post restrito', () =>
    fsCreateAtServerTime(`posts/${postId}/comments`, `c_de_c_${stamp}`, {
      userId: C.uid, postId, postAuthorId: A.uid, text: 'comentario indevido', createdAt: new Date(),
      likes: 0, repliesCount: 0, repostsCount: 0, quotesCount: 0, isDeleted: false, postVisibility: 'followers',
    }, tokenC));
  await negar('quem NÃO segue (C) não lê os comentários do post restrito', () =>
    fsCall('GET', `posts/${postId}/comments`, { token: tokenC }));

  await soft('a imagem de compartilhamento de um post restrito NÃO mostra o conteúdo (cai na marca)', async () => {
    for (const parametro of ['', '?formato=quadrado', '?formato=story']) {
      const response = await fetch(`${BASE_URL}/api/post-image/${postId}${parametro}`, { redirect: 'manual' });
      check(response.status >= 300 && response.status < 400, `a imagem do post restrito foi montada (HTTP ${response.status})`);
      check(String(response.headers.get('location')).includes('exe-lula-og.png'), 'não caiu na imagem da marca');
    }
    return 'os três formatos caem na imagem da marca';
  }, { tag: 'seg' });

  await soft('quem NÃO segue (C) vê "Post indisponível" na página do post restrito', async () => {
    await C.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
    await C.page.getByText('Post indisponível').waitFor({ timeout: 60_000 });
    check(!(await C.page.locator('body').innerText()).includes(postText), 'o texto do post restrito apareceu para quem não segue');
  }, { tag: 'seg' });

  // ---------------------------------------------------------------------------------------------------------------
  section('interacoes: combinações entre perfil privado e público');
  const postDeC = `Post publico de C ${stamp}`;
  let postDeCId;
  await step('C (público) publica um post e B passa a ser privado', async () => {
    await C.page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await createPostViaUi(C.page, postDeC);
    postDeCId = (await findPostByText(C, postDeC)).__id;
    await B.page.goto(`${BASE_URL}/pt-BR/settings/privacy`, { waitUntil: 'domcontentloaded' });
    await B.page.locator('#private-profile-switch').click();
    await eventually(async () => (await adminGetDoc(`users/${B.uid}`)).doc.profileVisibility === 'private', { label: 'B privado' });
  });

  // Um perfil privado reposta e cita conteúdo PÚBLICO normalmente: o que ele cria é que fica só para os seguidores
  // dele. Nada do círculo de ninguém é exposto.
  await soft('perfil PRIVADO (B) reposta e cita um post PÚBLICO (de C); o que B cria fica só para seguidores de B', async () => {
    const idDeC = postDeCId;
    await B.page.goto(postUrl(idDeC), { waitUntil: 'domcontentloaded' });
    await B.page.getByText(postDeC).first().waitFor({ timeout: 60_000 });
    await openMenu(B.page, postRepostButton(B.page));
    await B.page.getByRole('menuitem', { name: 'Repostar', exact: true }).click();
    await eventually(async () => (await adminGetDoc(`posts/${idDeC}/reposts/${B.uid}`)).doc, { label: 'repost de B no post de C' });
    const texto = `Privado citando publico ${stamp}`;
    await openMenu(B.page, postRepostButton(B.page));
    await B.page.getByRole('menuitem', { name: 'Citar postagem' }).click();
    await sendQuote(B.page, texto);
    const quote = await findPostByText(B, texto);
    check(quote.visibility === 'followers', `a citação de B ficou com visibility = ${quote.visibility}`);
    check(quote.originalPostDetails?.id === idDeC, 'a citação não aponta para o post de C');
    await shot(B.page, 'interacoes-08-privado-cita-publico');
  }, { tag: 'funcional' });

  // Dois perfis privados que se seguem: cada um VÊ e curte o do outro, mas nenhum reposta nem cita o do outro.
  await soft('dois perfis PRIVADOS que se seguem: A vê o post de B e pode curtir', async () => {
    await fsSet(`users/${B.uid}/followers/${A.uid}`, { userId: A.uid, createdAt: new Date() }, 'owner');
    await fsSet(`users/${A.uid}/following/${B.uid}`, { userId: B.uid, createdAt: new Date() }, 'owner');
    const postDeB = await eventually(
      async () => (await adminFind('posts', { userId: B.uid })).find((p) => p.visibility === 'followers' && !p.isDeleted && String(p.text ?? '').includes(stamp)),
      { label: 'post de B só para seguidores' },
    );
    const tokenA = await ctx.token(A);
    const leitura = await fsCall('GET', `posts/${postDeB.__id}`, { token: tokenA });
    check(leitura.status === 200, `A (segue B) não conseguiu ler o post de B (HTTP ${leitura.status})`);
    // A pode já ter curtido este post numa seção anterior: sem apagar a marca, a tentativa daria "já existe" (409) e
    // não provaria nada sobre a regra.
    await fsCall('DELETE', `posts/${postDeB.__id}/likes/${A.uid}`, { token: 'owner' });
    const curtida = await fsCreateAtServerTime(`posts/${postDeB.__id}/likes`, A.uid, { userId: A.uid, createdAt: new Date() }, tokenA);
    check(curtida.status === 200, `A não conseguiu curtir o post de B (HTTP ${curtida.status})`);
    await fsCall('DELETE', `posts/${postDeB.__id}/reposts/${A.uid}`, { token: 'owner' });
    const repost = await fsCreateAtServerTime(`posts/${postDeB.__id}/reposts`, A.uid, { userId: A.uid, createdAt: new Date() }, tokenA);
    check(denied(repost), `A conseguiu repostar o post restrito de B (HTTP ${repost.status})`);
    return `post de B ${postDeB.__id}`;
  }, { tag: 'seg' });
  await soft('quem NÃO segue (C) não lê o post restrito de B', async () => {
    const postDeB = await eventually(
      async () => (await adminFind('posts', { userId: B.uid })).find((p) => p.visibility === 'followers' && !p.isDeleted && String(p.text ?? '').includes(stamp)),
      { label: 'post de B só para seguidores' },
    );
    const response = await fsCall('GET', `posts/${postDeB.__id}`, { token: tokenC });
    check(denied(response), `C leu o post restrito de B (HTTP ${response.status})`);
    return `recusado (HTTP ${response.status})`;
  }, { tag: 'seg' });

  // ---------------------------------------------------------------------------------------------------------------
  // O feed criado pela pessoa usava um caminho próprio: só posts públicos, sem reposts e SEM paginação (acabava na
  // primeira página). Agora passa pelo mesmo motor do "Seguindo".
  section('interacoes: feed criado pela pessoa');
  const feedId = `meu_feed_${stamp}`;
  const paginatedPostIds = Array.from({ length: 14 }, (_, index) => `feed_page_${stamp}_${index}`);
  await step('C segue A (privado), fixa um feed com A/B/C e há mais de uma página de posts', async () => {
    await fsSet(`users/${A.uid}/followers/${C.uid}`, { userId: C.uid, createdAt: new Date() }, 'owner');
    await fsSet(`users/${C.uid}/following/${A.uid}`, { userId: A.uid, createdAt: new Date() }, 'owner');
    await fsSet(`users/${C.uid}/customFeeds/${feedId}`, {
      name: `Meu feed ${stamp}`, userIds: [A.uid, B.uid, C.uid], isPinned: false, createdAt: new Date(),
    }, 'owner');
    await fsUpdate(`users/${C.uid}/private/account`, { tabPreferences: { hidden: [], pinnedOrder: [feedId] } }, 'owner');
    const baseTime = Date.now() - 60 * 60 * 1000;
    for (let index = 0; index < paginatedPostIds.length; index++) {
      await fsSet(`posts/${paginatedPostIds[index]}`, {
        userId: C.uid, type: 'original', text: `Página do feed ${index} ${stamp}`, media: [], hasMedia: false,
        visibility: 'public', allowReposts: true, replyPermission: 'everyone', category: 'echo', hashtags: [],
        likes: 0, reposts: 0, quotesCount: 0, commentsCount: 0, views: 0, isEdited: false, editCount: 0,
        isDeleted: false, postFormat: 'standard', createdAt: new Date(baseTime + index * 1000),
      }, 'owner');
    }
  });

  await soft('o feed criado traz conteúdo público e o post restrito de um perfil que a pessoa segue', async () => {
    await C.page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await C.page.getByRole('tab', { name: `Meu feed ${stamp}` }).click();
    const apareceu = await C.page.waitForFunction((id) =>
      [...document.querySelectorAll(`[data-post-id="${id}"]`)].some((node) => node.getClientRects().length > 0),
    postId, { timeout: 60_000 }).then(() => true, () => false);
    await shot(C.page, 'interacoes-10-feed-criado');
    if (!apareceu) {
      const visivel = (await C.page.locator('main').last().innerText()).replace(/\s+/g, ' ').slice(0, 300);
      const ids = await C.page.locator('[data-post-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-post-id')));
      check(false, `o post de A (${postId}) não apareceu no feed criado; ids renderizados: ${ids.join(', ')}; a aba mostra: "${visivel}"; console: ${(C.consoleLog ?? []).slice(-6).join(' | ')}`);
    }
    await C.page.waitForFunction((id) =>
      [...document.querySelectorAll(`[data-post-id="${id}"]`)].some((node) => node.getClientRects().length > 0),
    postDeCId, { timeout: 60_000 });
  }, { tag: 'funcional' });

  await soft('o feed criado pagina de verdade e entrega itens além dos dez primeiros', async () => {
    const oldestId = paginatedPostIds[0];
    for (let attempt = 0; attempt < 8; attempt++) {
      const visible = await C.page.evaluate((id) =>
        [...document.querySelectorAll(`[data-post-id="${id}"]`)].some((node) => node.getClientRects().length > 0), oldestId);
      if (visible) return;
      await C.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await C.page.waitForTimeout(500);
    }
    check(false, `o item antigo ${oldestId} não chegou pela paginação`);
  }, { tag: 'funcional' });

  await soft('o cache separa a conta e não persiste conteúdo só para seguidores', async () => {
    const cache = await eventually(async () => C.page.evaluate(async ({ publicId, privateId }) => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('SoberanFeedCache');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const stores = [...database.objectStoreNames];
      if (!stores.includes('feedItems')) { database.close(); return null; }
      const items = await new Promise((resolve, reject) => {
        const request = database.transaction('feedItems').objectStore('feedItems').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      database.close();
      if (!items.some((item) => item.id === publicId)) return null;
      return { stores, privateFound: items.some((item) => item.id === privateId), scopes: [...new Set(items.map((item) => item.scope))] };
    }, { publicId: postDeCId, privateId: postId }), { label: 'cache do feed público', timeoutMs: 30_000 });
    check(!cache.stores.includes('posts'), 'a tabela insegura do cache antigo ainda existe');
    check(!cache.privateFound, 'o post só para seguidores foi persistido no IndexedDB');
    check(cache.scopes.length === 1 && cache.scopes[0] === C.uid, `escopos do cache: ${cache.scopes.join(', ')}`);
  }, { tag: 'seg' });

  await step('limpa o feed personalizado e os posts de paginação', async () => {
    await fsUpdate(`users/${C.uid}/private/account`, { tabPreferences: { hidden: [], pinnedOrder: [] } }, 'owner');
    await fsCall('DELETE', `users/${C.uid}/customFeeds/${feedId}`, { token: 'owner' });
    await fsCall('DELETE', `users/${A.uid}/followers/${C.uid}`, { token: 'owner' });
    await fsCall('DELETE', `users/${C.uid}/following/${A.uid}`, { token: 'owner' });
    for (const id of paginatedPostIds) {
      await fsCall('DELETE', `posts/${id}`, { token: 'owner' });
    }
  });

  // ---------------------------------------------------------------------------------------------------------------
  section('interacoes: contas conectadas e publicação externa');
  await soft('a tela de contas conectadas carrega Bluesky e X sem expor credenciais ao navegador', async () => {
    await C.page.goto(`${BASE_URL}/pt-BR/settings/connections`, { waitUntil: 'domcontentloaded' });
    await C.page.getByTestId('social-connection-bluesky').waitFor({ timeout: 30_000 });
    await C.page.getByTestId('social-connection-x').waitFor({ timeout: 30_000 });
    const visibleText = await C.page.locator('main').innerText();
    check(visibleText.includes('Bluesky') && visibleText.includes('X'), 'as duas redes não apareceram na tela');
    check(!/access.?token|refresh.?token|client.?secret/i.test(visibleText), 'a interface exibiu o nome de uma credencial secreta');
    await shot(C.page, 'interacoes-11-contas-conectadas');
  }, { tag: 'funcional' });

  await soft('o compositor oferece o seletor de redes e leva à conexão quando nenhuma conta está ligada', async () => {
    await C.page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await C.page.getByRole('button', { name: 'Postar', exact: true }).first().click();
    const dialog = C.page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Escolher outras redes' }).click();
    const connect = C.page.getByRole('link', { name: 'Conectar Bluesky ou X' });
    await connect.waitFor();
    check((await connect.getAttribute('href')) === '/pt-BR/settings/connections', 'o seletor não leva às contas conectadas');
    await C.page.keyboard.press('Escape');
    await C.page.keyboard.press('Escape');
  }, { tag: 'ux' });

  await soft('as rotas sociais exigem login e as coleções de credenciais são invisíveis pelo SDK cliente', async () => {
    const anonymous = await fetch(`${BASE_URL}/api/social/status`);
    check(anonymous.status === 401, `/api/social/status sem login retornou HTTP ${anonymous.status}`);
    const clientRead = await fsCall('GET', `social_connections/${C.uid}_bluesky`, { token: tokenC });
    check(denied(clientRead), `o cliente leu social_connections (HTTP ${clientRead.status})`);
  }, { tag: 'seg' });

  await soft('o servidor recusa publicar fora um post restrito antes de contatar qualquer rede', async () => {
    const restricted = await eventually(
      async () => (await adminFind('posts', { userId: B.uid })).find((p) => p.visibility === 'followers' && !p.isDeleted),
      { label: 'post restrito de B para tentativa de cross-post' },
    );
    const tokenB = await ctx.token(B);
    const response = await fetch(`${BASE_URL}/api/social/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId: restricted.__id, providers: ['bluesky', 'x'], locale: 'pt-BR' }),
    });
    check(response.status === 409, `cross-post de conteúdo restrito retornou HTTP ${response.status}`);
    const body = await response.json();
    check(/Apenas posts públicos/.test(body.message ?? ''), `mensagem inesperada: ${body.message}`);
  }, { tag: 'seg' });

  // ---------------------------------------------------------------------------------------------------------------
  section('interacoes: limpeza');
  await step('A e B voltam a ser públicos e deixam de se seguir', async () => {
    for (const user of [A, B]) {
      await user.page.goto(`${BASE_URL}/pt-BR/settings/privacy`, { waitUntil: 'domcontentloaded' });
      await user.page.locator('#private-profile-switch').click();
      await eventually(async () => (await adminGetDoc(`users/${user.uid}`)).doc.profileVisibility === 'public',
        { label: `${user.label.toUpperCase()} público de novo` });
    }
    await fsCall('DELETE', `users/${A.uid}/followers/${B.uid}`, { token: 'owner' });
    await fsCall('DELETE', `users/${B.uid}/following/${A.uid}`, { token: 'owner' });
    await fsCall('DELETE', `users/${B.uid}/followers/${A.uid}`, { token: 'owner' });
    await fsCall('DELETE', `users/${A.uid}/following/${B.uid}`, { token: 'owner' });
  });
}
