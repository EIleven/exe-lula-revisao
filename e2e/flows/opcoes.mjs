/**
 * Seção "opcoes": as opções exclusivas do compositor de post.
 *
 * Exercita a interface real e também as fronteiras do servidor: emoji inserido no cursor, município da lista local do
 * IBGE, enquete sem mídia e com um único voto por pessoa, contadores que o cliente não altera e proteção visual da mídia
 * marcada como sensível.
 */
import {
  adminFind,
  callFunction,
  eventually,
  fsCreate,
  fsGetDoc,
  fsUpdate,
  makePng,
} from '../lib/harness.mjs';

export async function run(ctx) {
  const { runner, users, BASE_URL, stamp, shot, token } = ctx;
  const { a: A, b: B } = users;
  const { section, soft, check } = runner;
  const postUrl = (postId) => `${BASE_URL}/pt-BR/post/${postId}`;
  const acharPost = (user, text) => eventually(
    async () => (await adminFind('posts', { userId: user.uid })).find((post) => String(post.text ?? '').includes(text)),
    { label: `post de ${user.label.toUpperCase()} com "${text}"`, timeoutMs: 60_000 },
  );

  section('opções do compositor: emoji, localização e enquete');
  let pollPost;
  const pollText = `Enquete com localização ${stamp}`;

  await soft('A insere emoji, escolhe Curitiba/PR e publica uma enquete; o Firestore guarda o formato íntegro', async () => {
    await A.page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await A.page.getByRole('button', { name: 'Postar', exact: true }).first().click();
    const dialog = A.page.getByRole('dialog');
    await dialog.waitFor();
    const text = dialog.getByPlaceholder('E aí?');
    await text.fill(pollText);

    await dialog.getByTestId('composer-emoji-button').click();
    const emojiPanel = A.page.getByTestId('composer-emoji-panel');
    await emojiPanel.waitFor({ timeout: 30_000 });
    await emojiPanel.locator('button[data-unified]').first().click();
    check((await text.inputValue()).length > pollText.length, 'o emoji escolhido não entrou no texto');
    await A.page.keyboard.press('Escape');

    await dialog.getByTestId('composer-location-button').click();
    const search = A.page.getByTestId('composer-location-search');
    await search.waitFor({ timeout: 30_000 });
    await search.fill('Curitiba PR');
    const curitiba = A.page.getByTestId('composer-location-option').filter({ hasText: 'Curitiba' }).first();
    await curitiba.waitFor({ timeout: 30_000 });
    await curitiba.click();
    await dialog.getByTestId('composer-location-selected').filter({ hasText: 'Curitiba, PR' }).waitFor();

    await dialog.getByTestId('composer-poll-button').click();
    await dialog.getByTestId('composer-poll').waitFor();
    check(await dialog.getByRole('button', { name: 'Adicionar imagem ou vídeo' }).isDisabled(), 'o anexo de mídia ficou liberado junto com a enquete');
    await dialog.getByTestId('composer-poll-option-0').fill('Sim');
    await dialog.getByTestId('composer-poll-option-1').fill('Com certeza');
    await shot(A.page, 'opcoes-01-compositor-enquete');
    await dialog.getByRole('button', { name: 'Postar', exact: true }).click();
    await A.page.getByText('Post Enviado!').first().waitFor({ timeout: 90_000 });

    pollPost = await acharPost(A, pollText);
    check(pollPost.location?.name === 'Curitiba' && pollPost.location?.state === 'PR' && pollPost.location?.ibgeId === 4106902,
      `localização gravada: ${JSON.stringify(pollPost.location)}`);
    check(pollPost.poll?.options?.length === 2, `opções gravadas: ${JSON.stringify(pollPost.poll?.options)}`);
    check(pollPost.poll.options[0].id === 'a' && pollPost.poll.options[0].text === 'Sim', 'a primeira opção foi alterada');
    check(pollPost.poll.options[1].id === 'b' && pollPost.poll.options[1].text === 'Com certeza', 'a segunda opção foi alterada');
    check(pollPost.pollCounts?.a === 0 && pollPost.pollCounts?.b === 0 && pollPost.pollTotal === 0, 'a enquete não nasceu zerada');
    check(new Date(pollPost.poll.endsAt).getTime() > Date.now(), 'a enquete nasceu encerrada ou sem prazo válido');
    check(pollPost.media === null && pollPost.youtubeVideoId === null, 'a enquete foi publicada junto com mídia');
    return `post ${pollPost.__id}`;
  }, { tag: 'funcional' });

  await soft('B vê a localização, vota uma vez e recebe o resultado; Function e regras impedem duplicação ou inflação', async () => {
    check(pollPost?.__id, 'o post de enquete não foi criado');
    await B.page.goto(postUrl(pollPost.__id), { waitUntil: 'domcontentloaded' });
    await B.page.getByTestId('post-location').filter({ hasText: 'Curitiba, PR' }).waitFor({ timeout: 60_000 });
    const option = B.page.getByTestId('poll-option-a');
    await option.waitFor({ timeout: 60_000 });
    await option.click();
    await eventually(async () => (await option.innerText()).includes('100%'), { label: 'resultado de 100% na opção votada', timeoutMs: 60_000 });

    const tokenB = await token(B);
    const tokenA = await token(A);
    const vote = await eventually(async () => {
      const result = await fsGetDoc(`posts/${pollPost.__id}/pollVotes/${B.uid}`, tokenB);
      return result.status === 200 ? result.doc : null;
    }, { label: 'documento do voto de B', timeoutMs: 30_000 });
    check(vote.userId === B.uid && vote.optionId === 'a', `voto gravado: ${JSON.stringify(vote)}`);

    const duplicate = await callFunction('voteOnPoll', { postId: pollPost.__id, optionId: 'b' }, tokenB);
    check(duplicate.status >= 400 && String(duplicate.error?.status ?? '').includes('ALREADY_EXISTS'),
      `segundo voto respondeu HTTP ${duplicate.status}: ${JSON.stringify(duplicate.error)}`);
    const afterDuplicate = (await fsGetDoc(`posts/${pollPost.__id}`, 'owner')).doc;
    check(afterDuplicate.pollCounts?.a === 1 && afterDuplicate.pollCounts?.b === 0 && afterDuplicate.pollTotal === 1,
      `o voto repetido mexeu nos contadores: ${JSON.stringify(afterDuplicate.pollCounts)} / ${afterDuplicate.pollTotal}`);

    const inflated = await fsUpdate(`posts/${pollPost.__id}`, { pollTotal: 999 }, tokenA);
    check(inflated.status === 403, `o autor alterou pollTotal diretamente (HTTP ${inflated.status})`);
    const forged = await fsCreate(`posts/${pollPost.__id}/pollVotes`, `forjado-${stamp}`, {
      userId: B.uid,
      optionId: 'b',
      createdAt: new Date(),
    }, tokenB);
    check(forged.status === 403, `o cliente criou voto direto (HTTP ${forged.status})`);
    const invalidLocation = await fsUpdate(`posts/${pollPost.__id}`, {
      location: { name: 'Curitiba', state: 'Paraná', ibgeId: 4106902 },
    }, tokenA);
    check(invalidLocation.status === 403, `o autor gravou localização fora do formato (HTTP ${invalidLocation.status})`);
    await shot(B.page, 'opcoes-02-resultado-enquete');
  }, { tag: 'segurança' });

  section('opções do compositor: conteúdo sensível');
  let sensitivePost;
  const sensitiveText = `Mídia sensível ${stamp}`;
  await soft('A anexa imagem, marca como sensível e publica; B recebe a mídia coberta até escolher mostrá-la', async () => {
    const png = makePng(240, 160, [190, 50, 80]);
    await A.page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await A.page.getByRole('button', { name: 'Postar', exact: true }).first().click();
    const dialog = A.page.getByRole('dialog');
    await dialog.waitFor();
    const sensitiveButton = dialog.getByTestId('composer-sensitive-button');
    check(await sensitiveButton.isDisabled(), 'a opção sensível ficou ativa sem mídia');
    await dialog.locator('input[type=file]').first().setInputFiles({ name: 'sensivel.png', mimeType: 'image/png', buffer: png });
    await dialog.locator('[data-status="ready"]').first().waitFor({ timeout: 60_000 });
    check(!(await sensitiveButton.isDisabled()), 'a opção sensível não foi liberada depois do upload');
    await sensitiveButton.click();
    check((await sensitiveButton.getAttribute('aria-pressed')) === 'true', 'a marcação sensível não ficou ativa');
    await dialog.getByPlaceholder('E aí?').fill(sensitiveText);
    await dialog.getByRole('button', { name: 'Postar', exact: true }).click();
    await A.page.getByText('Post Enviado!').first().waitFor({ timeout: 90_000 });
    sensitivePost = await acharPost(A, sensitiveText);
    check(sensitivePost.sensitive === true && sensitivePost.media?.length === 1, `post sensível gravado: ${JSON.stringify({ sensitive: sensitivePost.sensitive, media: sensitivePost.media })}`);

    await B.page.goto(postUrl(sensitivePost.__id), { waitUntil: 'domcontentloaded' });
    const cover = B.page.getByTestId('sensitive-cover');
    await cover.waitFor({ timeout: 60_000 });
    await shot(B.page, 'opcoes-03-midia-sensivel-coberta');
    await cover.getByRole('button', { name: 'Mostrar mídia' }).click();
    await cover.waitFor({ state: 'detached' });
    check((await B.page.locator('main img[src*="127.0.0.1:9199"]').count()) > 0, 'a imagem não apareceu depois da confirmação');

    const tokenA = await token(A);
    const invalidSensitive = await fsUpdate(`posts/${pollPost.__id}`, { sensitive: true }, tokenA);
    check(invalidSensitive.status === 403, `um post sem mídia foi marcado como sensível (HTTP ${invalidSensitive.status})`);
    return `post ${sensitivePost.__id}`;
  }, { tag: 'funcional' });
}
