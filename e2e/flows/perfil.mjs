/**
 * Seção "perfil": editar perfil e avatar, busca (pessoas e artigos), configurações persistidas e efeitos, e sair da conta.
 * Cada configuração é conferida na interface E no que ficou gravado em users/{uid}; quando a configuração promete um
 * efeito (notificações, bloqueio, perfil privado), o efeito também é medido.
 */
import { adminFind, adminGetDoc, createPostViaUi, eventually, fsCall, fsCreate, fsSet, makePng, storageList } from '../lib/harness.mjs';

export async function run(ctx) {
  const { runner, users, BASE_URL, stamp, shot } = ctx;
  const { a: A, b: B, c: C } = users;
  const { section, soft, check } = runner;
  const newName = `Alice Perfil ${stamp}`;
  const newBio = `Bio de teste ${stamp}`;
  const profileUrl = (user, locale = 'pt-BR') => `${BASE_URL}/${locale}/profile/${user.uid}`;
  const settingsUrl = (page = '', locale = 'pt-BR') => `${BASE_URL}/${locale}/settings${page ? `/${page}` : ''}`;
  const userDoc = async (user) => (await adminGetDoc(`users/${user.uid}`)).doc;
  // Preferências e palavras silenciadas são dados pessoais: ficam em users/{uid}/private/account, fora do perfil público.
  const privateDoc = async (user) => (await adminGetDoc(`users/${user.uid}/private/account`)).doc ?? {};
  // As notificações do mesmo tipo e alvo se agregam numa só (count++): a medida certa é a soma de count, não o número de documentos.
  const likeNotifications = async (user) =>
    (await adminFind('notifications', { recipientId: user.uid, type: 'like_post' })).reduce((sum, n) => sum + (n.count ?? 1), 0);

  // ---------------------------------------------------------------------------------------------------------------
  section('perfil: editar o próprio perfil');
  await soft('A edita nome e bio pelo diálogo "Editar Perfil" e vê o resultado na página', async () => {
    await A.page.goto(profileUrl(A), { waitUntil: 'domcontentloaded' });
    await A.page.getByRole('button', { name: 'Editar Perfil' }).first().click();
    const dialog = A.page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByPlaceholder('João da Silva').fill(newName);
    await dialog.getByPlaceholder('Conte-nos sobre você').fill(newBio);
    await dialog.getByRole('button', { name: 'Salvar Alterações' }).click();
    await A.page.getByText('Perfil Atualizado').first().waitFor({ timeout: 60_000 });
    await A.page.getByText(newBio).first().waitFor({ timeout: 30_000 });
  });
  await soft('perfil editado: name, name_lowercase e bio gravados; B vê o nome novo na página de A', async () => {
    await eventually(async () => (await userDoc(A)).bio === newBio, { label: 'bio gravada' });
    const doc = await userDoc(A);
    check(doc.name === newName, `name = ${doc.name}`);
    check(doc.name_lowercase === newName.toLowerCase(), `name_lowercase = ${doc.name_lowercase}`);
    await B.page.goto(profileUrl(A), { waitUntil: 'domcontentloaded' });
    await B.page.getByText(newName).first().waitFor({ timeout: 60_000 });
  });
  await soft('A troca o avatar (envio, recorte e salvar): objeto em user_uploads/{A}/avatars/ e avatarUrl aponta para ele', async () => {
    await A.page.goto(profileUrl(A), { waitUntil: 'domcontentloaded' });
    await A.page.getByRole('button', { name: 'Editar Perfil' }).first().click();
    const dialog = A.page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.locator('input[type=file][accept="image/*"]').nth(1).setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: makePng(300, 300, [200, 60, 60]) });
    await A.page.getByRole('button', { name: 'Aplicar Corte' }).click();
    await shot(A.page, 'perfil-01-avatar-recortado');
    await A.page.getByRole('dialog').getByRole('button', { name: 'Salvar Alterações' }).click();
    await A.page.getByText('Perfil Atualizado').first().waitFor({ timeout: 90_000 });
    const doc = await eventually(async () => {
      const current = await userDoc(A);
      return String(current.avatarUrl).includes('127.0.0.1:9199') ? current : null;
    }, { label: 'avatarUrl apontando para o Storage' });
    const objects = await storageList(`user_uploads/${A.uid}/avatars/`);
    check(objects.length === 1, `esperava 1 avatar no Storage, há ${objects.length}`);
    check(doc.avatarUrl.includes(encodeURIComponent(objects[0])), 'avatarUrl não aponta para o objeto enviado');
  });

  // ---------------------------------------------------------------------------------------------------------------
  section('perfil: busca');
  await soft('B busca pelo nome de A: a aba "Pessoas" lista A, com link para o perfil', async () => {
    await B.page.goto(`${BASE_URL}/pt-BR/search?q=${encodeURIComponent('Alice Perfil')}`, { waitUntil: 'domcontentloaded' });
    await B.page.getByRole('tab', { name: 'Pessoas' }).click();
    await B.page.locator(`a[href$="/profile/${A.uid}"]`).first().waitFor({ timeout: 60_000 });
    await shot(B.page, 'perfil-02-busca-pessoas');
  });
  await soft('a caixa de busca do cabeçalho sugere A ao digitar parte do @usuário', async () => {
    await B.page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await B.page.getByRole('button', { name: /buscar|search/i }).first().click().catch(async () => {
      await B.page.locator('header button:has(svg.lucide-search), button:has(svg.lucide-search)').first().click();
    });
    await B.page.getByPlaceholder('Buscar usuários e tópicos...').fill(A.username.slice(0, 9));
    await B.page.getByText(newName).first().waitFor({ timeout: 30_000 });
  });
  await soft('um artigo é encontrado pela aba "Artigos" da busca (por palavra do título)', async () => {
    const headline = `Reforma tributária explicada ${stamp}`;
    const made = await fsCreate('posts', `art_${stamp}`, {
      userId: A.uid, headline, text: '<p>Texto do artigo de teste para a busca.</p>', category: 'news', newsCategory: 'Política', visibility: 'public', isDeleted: false,
      likes: 0, reposts: 0, commentsCount: 0, quotesCount: 0, views: 0, allowReposts: true, replyPermission: 'everyone', createdAt: new Date(),
    }, 'owner');
    check(made.status === 200, `não consegui semear o artigo (HTTP ${made.status})`);
    await B.page.goto(`${BASE_URL}/pt-BR/search?q=${encodeURIComponent('tributária')}`, { waitUntil: 'domcontentloaded' });
    await B.page.getByRole('tab', { name: 'Artigos' }).click();
    await B.page.getByText(headline).first().waitFor({ timeout: 60_000 });
    await shot(B.page, 'perfil-03-busca-artigos');
  });

  // ---------------------------------------------------------------------------------------------------------------
  section('perfil: configurações persistidas');
  await soft('Privacidade: "Perfil Privado" grava profileVisibility = private', async () => {
    await A.page.goto(settingsUrl('privacy'), { waitUntil: 'domcontentloaded' });
    await A.page.locator('#private-profile-switch').click();
    await eventually(async () => (await userDoc(A)).profileVisibility === 'private', { label: 'profileVisibility = private' });
  });
  await soft('perfil privado: quem não segue vê um aviso claro de perfil privado (não "não encontrado")', async () => {
    await B.page.goto(profileUrl(A), { waitUntil: 'domcontentloaded' });
    await B.page.waitForTimeout(6000);
    const text = (await B.page.locator('body').innerText()).replace(/\s+/g, ' ');
    await shot(B.page, 'perfil-04-perfil-privado-visto-por-b');
    check(/privad/i.test(text), `a página de um perfil privado mostra: "${text.slice(0, 140)}"`);
  }, { tag: 'ux' });
  // A Function onUserUpdated leva os posts junto com o perfil (sem isso, os posts de um perfil privado continuavam
  // públicos para qualquer um).
  const postsOfA = async () => (await adminFind('posts', { userId: A.uid })).filter((p) => p.visibility !== 'private');
  await soft('perfil privado: os posts de A passam a "só para seguidores"', async () => {
    const posts = await eventually(async () => {
      const list = await postsOfA();
      return list.length > 0 && list.every((p) => p.visibility === 'followers') ? list : null;
    }, { label: 'posts de A com visibility = followers', timeoutMs: 30_000 });
    return `${posts.length} post(s)`;
  }, { tag: 'funcional' });
  // Página do post de perfil privado: o servidor monta sem login, então não pode responder "não encontrado" para o
  // dono nem para quem segue (era o que acontecia com todos os posts de um perfil privado).
  const privateArticle = `/pt-BR/post/art_${stamp}`;
  const articleHeadline = `Reforma tributária explicada ${stamp}`;
  await soft('perfil privado: o dono abre a página do próprio post', async () => {
    // Em outra aba: a de A continua nas configurações, que os testes seguintes usam.
    const page = await A.context.newPage();
    try {
      await page.goto(`${BASE_URL}${privateArticle}`, { waitUntil: 'domcontentloaded' });
      await page.getByText(articleHeadline).first().waitFor({ timeout: 60_000 });
    } finally {
      await page.close();
    }
  }, { tag: 'funcional' });
  await soft('perfil privado: quem segue abre a página do post', async () => {
    await fsSet(`users/${A.uid}/followers/${C.uid}`, { userId: C.uid, createdAt: new Date() }, 'owner');
    await fsSet(`users/${C.uid}/following/${A.uid}`, { userId: A.uid, createdAt: new Date() }, 'owner');
    try {
      await C.page.goto(`${BASE_URL}${privateArticle}`, { waitUntil: 'domcontentloaded' });
      await C.page.getByText(articleHeadline).first().waitFor({ timeout: 60_000 });
      await shot(C.page, 'perfil-04b-post-privado-visto-por-seguidor');
    } finally {
      await fsCall('DELETE', `users/${A.uid}/followers/${C.uid}`, { token: 'owner' });
      await fsCall('DELETE', `users/${C.uid}/following/${A.uid}`, { token: 'owner' });
    }
  }, { tag: 'funcional' });
  await soft('perfil privado: quem não segue vê "Post indisponível" (e não o conteúdo)', async () => {
    await B.page.goto(`${BASE_URL}${privateArticle}`, { waitUntil: 'domcontentloaded' });
    await B.page.getByText('Post indisponível').waitFor({ timeout: 60_000 });
    check(!(await B.page.locator('body').innerText()).includes(articleHeadline), 'o título do post restrito apareceu para quem não segue');
  }, { tag: 'seg' });
  await soft('sem login, o HTML do post restrito não traz o conteúdo e pede aos buscadores para não indexar', async () => {
    const response = await fetch(`${BASE_URL}${privateArticle}`);
    const html = await response.text();
    check(response.status === 200, `HTTP ${response.status}`);
    check(!html.includes(articleHeadline), 'o título do post restrito está no HTML');
    check(html.includes('<meta name="robots" content="noindex, nofollow"/>'), 'falta o noindex');
  }, { tag: 'seg' });
  // HTTP 200, não 404: o conteúdo das páginas só é montado no navegador (o AppLayout mostra o esqueleto até montar),
  // então o notFound() não chega ao servidor. O que impede os buscadores de indexar a página de erro é o noindex.
  await soft('a página de um post que não existe mostra "Página não encontrada" e pede aos buscadores para não indexar', async () => {
    const url = `${BASE_URL}/pt-BR/post/nao-existe-${stamp}`;
    const html = await (await fetch(url)).text();
    check(html.includes('<meta name="robots" content="noindex, nofollow"/>'), 'falta o noindex');
    check(html.includes('<title>Página não encontrada'), 'o título não diz que a página não foi encontrada');
    await B.page.goto(url, { waitUntil: 'domcontentloaded' });
    await B.page.getByText('Página não encontrada').waitFor({ timeout: 60_000 });
  }, { tag: 'funcional' });
  await soft('Privacidade: "Perfil Privado" desligado volta a gravar public', async () => {
    await A.page.locator('#private-profile-switch').click();
    await eventually(async () => (await userDoc(A)).profileVisibility === 'public', { label: 'profileVisibility = public' });
  });
  await soft('perfil público de novo: os posts de A voltam a ser públicos', async () => {
    await eventually(async () => {
      const list = await postsOfA();
      return list.length > 0 && list.every((p) => p.visibility === 'public');
    }, { label: 'posts de A com visibility = public', timeoutMs: 30_000 });
  }, { tag: 'funcional' });
  await soft('Privacidade: a opção de mensagens "Ninguém" grava dmPreference = none (e "Todos" volta)', async () => {
    await A.page.locator('#dm-none').click();
    await eventually(async () => (await userDoc(A)).dmPreference === 'none', { label: 'dmPreference = none' });
    await A.page.locator('#dm-everyone').click();
    await eventually(async () => (await userDoc(A)).dmPreference === 'everyone', { label: 'dmPreference = everyone' });
  });
  await soft('Notificações: desligar "curtidas" grava notificationPreferences.likes = false (nos dados pessoais, não no perfil público)', async () => {
    await A.page.goto(settingsUrl('notifications'), { waitUntil: 'domcontentloaded' });
    const likesSwitch = A.page.getByRole('switch').first();
    await likesSwitch.waitFor();
    await likesSwitch.click();
    await A.page.getByRole('button', { name: 'Salvar Preferências' }).click();
    await eventually(async () => (await privateDoc(A)).notificationPreferences?.likes === false, { label: 'notificationPreferences.likes = false' });
    check(!('notificationPreferences' in (await userDoc(A))), 'notificationPreferences também foi gravado no perfil público');
  });
  await soft('Notificações: com "curtidas" desligadas, a curtida de B NÃO gera notificação para A (preferência respeitada)', async () => {
    const postText = `Post para o teste de preferências ${stamp}`;
    await A.page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await createPostViaUi(A.page, postText);
    const post = await eventually(async () => (await adminFind('posts', { userId: A.uid })).find((p) => String(p.text).includes(postText)), { label: 'post de A' });
    const before = await likeNotifications(A);
    await B.page.goto(`${BASE_URL}/pt-BR/post/${post.__id}`, { waitUntil: 'domcontentloaded' });
    await B.page.getByText(postText).first().waitFor({ timeout: 90_000 });
    await B.page.locator('button[title="Like"]').first().click();
    await eventually(async () => (await adminGetDoc(`posts/${post.__id}/likes/${B.uid}`)).doc, { label: 'like de B gravado' });
    await new Promise((resolve) => setTimeout(resolve, 6000)); // tempo para a Function agir
    const after = await likeNotifications(A);
    check(after === before, `A recebeu ${after - before} notificação(ões) de curtida mesmo com "curtidas" desligadas: as Functions ignoram notificationPreferences`);
  }, { tag: 'funcional' });
  await soft('Notificações: religar "curtidas" (limpeza)', async () => {
    await A.page.goto(settingsUrl('notifications'), { waitUntil: 'domcontentloaded' });
    const likesSwitch = A.page.getByRole('switch').first();
    await likesSwitch.waitFor();
    if ((await likesSwitch.getAttribute('aria-checked')) !== 'true') {
      await likesSwitch.click();
      await A.page.getByRole('button', { name: 'Salvar Preferências' }).click();
    }
    await eventually(async () => (await privateDoc(A)).notificationPreferences?.likes !== false, { label: 'likes religado' });
  });
  await soft('Conteúdo silenciado: adicionar uma palavra grava em mutedWords', async () => {
    await A.page.goto(settingsUrl('moderation'), { waitUntil: 'domcontentloaded' });
    await A.page.getByPlaceholder('Adicionar palavra ou #hashtag').fill('spoiler');
    await A.page.getByRole('button', { name: 'Adicionar' }).click();
    await eventually(async () => (await privateDoc(A)).mutedWords?.includes('spoiler'), { label: 'mutedWords inclui "spoiler"' });
    check(!('mutedWords' in (await userDoc(A))), 'mutedWords também foi gravado no perfil público');
  });
  await soft('Aparência: escolher "Escuro" aplica a classe dark e "Claro" a remove', async () => {
    await A.page.goto(settingsUrl('appearance'), { waitUntil: 'domcontentloaded' });
    await A.page.locator('label[for="dark"]').click();
    await eventually(async () => A.page.evaluate(() => document.documentElement.classList.contains('dark')), { label: 'classe dark aplicada' });
    await A.page.locator('label[for="light"]').click();
    await eventually(async () => A.page.evaluate(() => !document.documentElement.classList.contains('dark')), { label: 'classe dark removida' });
  });
  await soft('Idiomas: trocar para English leva a /en e traduz a interface; voltar para Português', async () => {
    await A.page.goto(settingsUrl('languages'), { waitUntil: 'domcontentloaded' });
    await A.page.locator('#language-select').click();
    await A.page.getByRole('option', { name: 'English' }).click();
    await A.page.waitForURL(/\/en\/settings\/languages/, { timeout: 30_000 });
    await A.page.getByText('Language').first().waitFor({ timeout: 30_000 });
    await A.page.locator('#language-select').click();
    await A.page.getByRole('option', { name: 'Português (Brasil)' }).click();
    await A.page.waitForURL(/\/pt-BR\/settings\/languages/, { timeout: 30_000 });
  });

  // ---------------------------------------------------------------------------------------------------------------
  section('perfil: bloqueio e silenciar');
  await soft('A bloqueia B pela interface: grava users/A/blockedUsers/B e B não consegue mais mandar notificação a A', async () => {
    await A.page.goto(profileUrl(B), { waitUntil: 'domcontentloaded' });
    await A.page.getByRole('button', { name: 'Mais opções' }).first().click();
    A.page.once('dialog', (dialog) => dialog.accept()); // o app pergunta com window.confirm (diálogo nativo)
    await A.page.getByRole('menuitem', { name: /Bloquear/ }).click();
    await eventually(async () => (await adminGetDoc(`users/${A.uid}/blockedUsers/${B.uid}`)).doc, { label: 'blockedUsers/B gravado' });
  });
  await soft('bloqueado: a curtida de B em um post de A NÃO notifica A', async () => {
    const posts = (await adminFind('posts', { userId: A.uid })).filter((p) => !p.isDeleted && p.text);
    check(posts.length > 0, 'A não tem posts para o teste');
    const target = posts[0];
    await adminGetDoc(`posts/${target.__id}`);
    await fsCall('DELETE', `posts/${target.__id}/likes/${B.uid}`, { token: 'owner' }); // B já tinha curtido este post no passo anterior
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const before = await likeNotifications(A);
    await fsCreate(`posts/${target.__id}/likes`, B.uid, { userId: B.uid, createdAt: new Date() }, 'owner');
    await new Promise((resolve) => setTimeout(resolve, 6000));
    const after = await likeNotifications(A);
    check(after === before, `A, que bloqueou B, recebeu ${after - before} notificação(ões) de curtida de B: as Functions não consideram bloqueios`);
  }, { tag: 'funcional' });
  await soft('limpeza: A desbloqueia B', async () => {
    await fsCall('DELETE', `users/${A.uid}/blockedUsers/${B.uid}`, { token: 'owner' });
  });

  // ---------------------------------------------------------------------------------------------------------------
  section('perfil: sair da conta');
  await soft('Configurações → Sair → confirmar leva à tela de login e o app deixa de reconhecer o usuário', async () => {
    await A.page.goto(settingsUrl(), { waitUntil: 'domcontentloaded' });
    // O botão com confirmação fica no <nav> da página de configurações; o do menu lateral sai direto, sem perguntar.
    await A.page.locator('nav.space-y-2').getByRole('button', { name: 'Sair' }).click();
    await A.page.getByRole('alertdialog').getByRole('button', { name: 'Sair' }).click();
    await A.page.waitForURL(/\/login/, { timeout: 30_000 });
    await shot(A.page, 'perfil-05-saiu');
    await A.page.goto(`${BASE_URL}/pt-BR/messages`, { waitUntil: 'domcontentloaded' });
    await A.page.getByText('Por favor, faça login para ver suas mensagens.').waitFor({ timeout: 30_000 });
  });
  // Presença: cada aba é uma conexão em /status/{uid}/connections; online = ao menos uma (docs/presenca.md).
  await soft('sair da conta: o status de presença de A no RTDB fica offline (senão A aparece online para sempre)', async () => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const response = await fetch(`http://127.0.0.1:9000/status/${A.uid}.json?ns=demo-soberan-default-rtdb`, { headers: { Authorization: 'Bearer owner' } });
    const status = await response.json();
    const connections = Object.keys(status?.connections ?? {}).length;
    check(connections === 0 && typeof status?.lastSeen === 'number', `/status/A = ${JSON.stringify(status)} depois de sair da conta (esperado: sem conexões e com lastSeen)`);
  }, { tag: 'funcional' });
}
