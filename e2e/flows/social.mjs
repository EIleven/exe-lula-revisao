/**
 * Seção "social": seguir/deixar de seguir, curtir/descurtir, repostar/desfazer, comentar, notificações e contadores.
 * A usa a interface sobre os conteúdos de B; as conferências de dados usam o administrador do emulador (ignora regras).
 */
import { adminFind, adminGetDoc, createPostViaUi, eventually } from '../lib/harness.mjs';

const lastNumber = (text) => {
  const found = String(text).match(/\d+/g);
  return found ? Number(found[found.length - 1]) : NaN;
};

export async function run(ctx) {
  const { runner, users, BASE_URL, stamp, shot } = ctx;
  const { a: A, b: B } = users;
  const { section, step, soft, check } = runner;
  const postUrl = (postId) => `${BASE_URL}/pt-BR/post/${postId}`;
  // A barra lateral (<aside>) também tem botões "Seguir" (sugestões): o do perfil é o do <main>.
  // O primeiro link /followers da página é o do cartão do PRÓPRIO usuário (menu lateral): o de B é o do <main>.
  const followersLink = (page) => page.locator(`main a[href$="/profile/${B.uid}/followers"]`).first();
  const mainButton = (page, name) => page.locator('main').getByRole('button', { name, exact: true });
  const notificationsOf = async (user, type) =>
    (await adminFind('notifications', { recipientId: user.uid })).filter((n) => !type || n.type === type);

  // ---------------------------------------------------------------------------------------------------------------
  section('social: preparação');
  let postId;
  const postText = `Post alvo das interações ${stamp}`;
  await step('B publica o post que receberá as interações', async () => {
    await B.page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await createPostViaUi(B.page, postText);
    const post = await eventually(
      async () => (await adminFind('posts', { userId: B.uid })).find((p) => String(p.text).includes(postText)),
      { label: 'post de B no Firestore' },
    );
    postId = post.__id;
    return `post ${postId}`;
  });

  // ---------------------------------------------------------------------------------------------------------------
  section('social: seguir e deixar de seguir');
  await soft('A segue B pela interface: o botão vira "Seguindo" e o contador de seguidores de B mostra 1', async () => {
    await A.page.goto(ctx.profileUrl(B), { waitUntil: 'domcontentloaded' });
    await mainButton(A.page, 'Seguir').click();
    await mainButton(A.page, 'Seguindo').waitFor();
    await eventually(async () => lastNumber(await followersLink(A.page).innerText()) === 1, {
      label: 'contador de seguidores na interface',
    });
    await shot(A.page, 'social-01-seguindo');
  });
  await soft('seguir: following/followers e os dois contadores gravados nos emuladores', async () => {
    const data = await eventually(async () => {
      const [following, follower, userA, userB] = await Promise.all([
        adminGetDoc(`users/${A.uid}/following/${B.uid}`),
        adminGetDoc(`users/${B.uid}/followers/${A.uid}`),
        adminGetDoc(`users/${A.uid}`),
        adminGetDoc(`users/${B.uid}`),
      ]);
      return following.doc && follower.doc && userA.doc?.followingCount === 1 && userB.doc?.followersCount === 1
        ? { following, follower, userA, userB }
        : null;
    }, { label: 'documentos de seguir e contadores' });
    return `A.followingCount=${data.userA.doc.followingCount}, B.followersCount=${data.userB.doc.followersCount}`;
  });
  await soft('seguir: a Function onUserFollowed criou a notificação new_follower para B (autor A)', async () => {
    const found = await eventually(async () => (await notificationsOf(B, 'new_follower'))[0], { label: 'notificação new_follower' });
    check(found.actors?.[0]?.id === A.uid || JSON.stringify(found.actors).includes(A.uid), `autor da notificação inesperado: ${JSON.stringify(found.actors)}`);
    check(found.readAt === null, 'a notificação já nasceu lida');
    return `notificação ${found.__id}`;
  });
  await soft('A deixa de seguir B pela interface: o botão volta a "Seguir"', async () => {
    await mainButton(A.page, 'Seguindo').click();
    await mainButton(A.page, 'Seguir').waitFor();
    await eventually(async () => lastNumber(await followersLink(A.page).innerText()) === 0, {
      label: 'contador de seguidores volta a 0 na interface',
    });
  });
  await soft('deixar de seguir: documentos removidos e contadores de volta a 0 nos emuladores', async () => {
    await eventually(async () => {
      const [following, follower, userA, userB] = await Promise.all([
        adminGetDoc(`users/${A.uid}/following/${B.uid}`),
        adminGetDoc(`users/${B.uid}/followers/${A.uid}`),
        adminGetDoc(`users/${A.uid}`),
        adminGetDoc(`users/${B.uid}`),
      ]);
      return !following.doc && !follower.doc && userA.doc?.followingCount === 0 && userB.doc?.followersCount === 0;
    }, { label: 'remoção dos documentos de seguir' });
  });
  await soft('A volta a seguir B (estado usado pelas próximas seções)', async () => {
    await mainButton(A.page, 'Seguir').click();
    await mainButton(A.page, 'Seguindo').waitFor();
    await eventually(async () => (await adminGetDoc(`users/${B.uid}/followers/${A.uid}`)).doc, { label: 'seguidor gravado de novo' });
  });

  // ---------------------------------------------------------------------------------------------------------------
  section('social: curtir e descurtir');
  const likeButton = (page) => page.locator('button[title="Like"], button[title="Unlike"]').first();
  await soft('A curte o post de B pela interface: botão pressionado e contador 1', async () => {
    await A.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
    await A.page.getByText(postText).first().waitFor({ timeout: 90_000 });
    await likeButton(A.page).click();
    await A.page.locator('button[title="Unlike"]').first().waitFor();
    check((await likeButton(A.page).getAttribute('aria-pressed')) === 'true', 'aria-pressed não ficou "true"');
    await eventually(async () => lastNumber(await likeButton(A.page).innerText()) === 1, { label: 'contador de curtidas na interface' });
    await shot(A.page, 'social-02-curtido');
  });
  await soft('curtir: like gravado, contador do post = 1 (Function onPostLiked) e notificação like_post para B', async () => {
    await eventually(async () => (await adminGetDoc(`posts/${postId}/likes/${A.uid}`)).doc, { label: 'documento do like' });
    const post = await eventually(async () => {
      const { doc } = await adminGetDoc(`posts/${postId}`);
      return doc.likes === 1 ? doc : null;
    }, { label: 'contador likes do post' });
    const notification = await eventually(async () => (await notificationsOf(B, 'like_post'))[0], { label: 'notificação like_post' });
    return `likes=${post.likes}; notificação ${notification.__id}`;
  });
  await soft('A descurte: like removido e contador do post volta a 0 (Function onPostUnliked)', async () => {
    await A.page.locator('button[title="Unlike"]').first().click();
    await A.page.locator('button[title="Like"]').first().waitFor();
    await eventually(async () => !(await adminGetDoc(`posts/${postId}/likes/${A.uid}`)).doc, { label: 'like removido' });
    await eventually(async () => (await adminGetDoc(`posts/${postId}`)).doc.likes === 0, { label: 'contador likes volta a 0' });
  });
  await soft('A curte de novo (estado usado pelas notificações)', async () => {
    await likeButton(A.page).click();
    await A.page.locator('button[title="Unlike"]').first().waitFor();
    await eventually(async () => (await adminGetDoc(`posts/${postId}`)).doc.likes === 1, { label: 'likes = 1 de novo' });
  });

  // ---------------------------------------------------------------------------------------------------------------
  section('social: repostar e desfazer');
  const repostTrigger = (page) => page.locator('button:has(svg.lucide-repeat2)').first();
  // O menu fecha com animação; um clique durante ela é engolido. Espera sumir e abre de novo se preciso.
  const openRepostMenu = async (page) => {
    await page.locator('[role=menu]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    for (let attempt = 0; attempt < 3; attempt++) {
      await repostTrigger(page).click();
      try {
        await page.getByRole('menu').waitFor({ state: 'visible', timeout: 3000 });
        return;
      } catch { /* tenta de novo */ }
    }
    throw new Error('o menu de repost não abriu');
  };
  await soft('A reposta o post de B pelo menu: botão pressionado e contador 1', async () => {
    await openRepostMenu(A.page);
    await A.page.getByRole('menuitem', { name: 'Repostar' }).click();
    await eventually(async () => (await repostTrigger(A.page).getAttribute('aria-pressed')) === 'true', { label: 'botão de repost pressionado' });
    await eventually(async () => lastNumber(await repostTrigger(A.page).innerText()) === 1, { label: 'contador de reposts na interface' });
    await shot(A.page, 'social-03-repostado');
  });
  await soft('repostar: documento reposts/{A} e contador reposts = 1 gravados', async () => {
    await eventually(async () => (await adminGetDoc(`posts/${postId}/reposts/${A.uid}`)).doc, { label: 'documento do repost' });
    await eventually(async () => (await adminGetDoc(`posts/${postId}`)).doc.reposts === 1, { label: 'contador reposts do post' });
  });
  await soft('A desfaz o repost: documento removido e contador volta a 0', async () => {
    await openRepostMenu(A.page);
    await A.page.getByRole('menuitem', { name: 'Desfazer Repost' }).click();
    await eventually(async () => (await repostTrigger(A.page).getAttribute('aria-pressed')) === 'false', { label: 'botão de repost solto' });
    await eventually(async () => !(await adminGetDoc(`posts/${postId}/reposts/${A.uid}`)).doc, { label: 'repost removido' });
    await eventually(async () => (await adminGetDoc(`posts/${postId}`)).doc.reposts === 0, { label: 'contador reposts volta a 0' });
  });

  // ---------------------------------------------------------------------------------------------------------------
  section('social: comentar');
  const commentText = `Comentário de A ${stamp}`;
  await soft('A comenta no post de B: aparece na página e commentsCount = 1', async () => {
    await A.page.getByText('Escreva um comentário...').first().click();
    const dialog = A.page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByPlaceholder('Escreva um comentário...').fill(commentText);
    await dialog.getByRole('button', { name: 'Responder', exact: true }).click();
    await A.page.getByText(commentText).first().waitFor({ timeout: 90_000 });
    const stored = await eventually(
      async () => (await adminFind('comments', {}, { allDescendants: true })).find((c) => String(c.text ?? '').includes(commentText)),
      { label: 'comentário no Firestore' },
    );
    const post = await eventually(async () => {
      const { doc } = await adminGetDoc(`posts/${postId}`);
      return doc.commentsCount === 1 ? doc : null;
    }, { label: 'commentsCount do post' });
    return `comentário ${stored.__id}; commentsCount=${post.commentsCount}`;
  });
  await soft('comentar: a Function onCommentCreated criou a notificação comment_on_post para B', async () => {
    const found = await eventually(async () => (await notificationsOf(B, 'comment_on_post'))[0], { label: 'notificação comment_on_post' });
    return `notificação ${found.__id}`;
  });
  await soft('curtir um comentário: like gravado e contador do comentário = 1 (Function onCommentLiked)', async () => {
    const comment = await eventually(
      async () => (await adminFind('comments', {}, { allDescendants: true })).find((c) => String(c.text ?? '').includes(commentText)),
      { label: 'comentário no Firestore' },
    );
    // o primeiro coração da página é o do post; o segundo é o do comentário
    await A.page.locator('button:has(svg.lucide-heart)').nth(1).click();
    await eventually(async () => (await adminGetDoc(comment.__path)).doc.likes === 1, { label: 'contador likes do comentário' });
    await eventually(async () => (await adminGetDoc(`${comment.__path}/likes/${A.uid}`)).doc, { label: 'documento do like do comentário' });
  });

  // ---------------------------------------------------------------------------------------------------------------
  section('social: notificações e contadores de B');
  let unread;
  await soft('B vê no menu o contador de não lidas = total de notificações e a lista na página', async () => {
    const all = await eventually(async () => {
      const list = await notificationsOf(B);
      return list.length >= 3 ? list : null;
    }, { label: 'ao menos 3 notificações de B (seguidor, curtida, comentário)' });
    unread = all.filter((n) => n.readAt === null).length;
    await B.page.goto(`${BASE_URL}/pt-BR/notifications`, { waitUntil: 'domcontentloaded' });
    // O aria-label é traduzido ("Notificação" em pt-BR). O test id identifica
    // o componente sem acoplar o teste de dados ao idioma da interface.
    await B.page.locator('[data-testid="notification-item"]').first().waitFor({ timeout: 60_000 });
    const items = await B.page.locator('[data-testid="notification-item"]').count();
    check(items === all.length, `a página lista ${items} notificação(ões), mas há ${all.length} gravadas`);
    const link = B.page.getByRole('link', { name: /Notificações/ }).first();
    await eventually(async () => lastNumber(await link.innerText()) === Math.min(unread, 9), { label: `contador do menu = ${unread}` });
    await shot(B.page, 'social-04-notificacoes');
    return `${items} notificações, ${unread} não lidas`;
  });
  await soft('B marca todas como lidas: contador do menu some e readAt gravado em todas', async () => {
    await B.page.getByRole('button', { name: 'Marcar todas como lidas' }).click();
    await eventually(async () => {
      const list = await notificationsOf(B);
      return list.length > 0 && list.every((n) => n.readAt !== null);
    }, { label: 'readAt gravado em todas as notificações' });
    const link = B.page.getByRole('link', { name: /Notificações/ }).first();
    await eventually(async () => !/\d/.test(await link.innerText()), { label: 'contador do menu some' });
    await shot(B.page, 'social-05-todas-lidas');
  });
}
