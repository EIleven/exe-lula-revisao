/**
 * Seção "composicao": os modais de ENTRADA do usuário (postar, comentar, responder a um comentário, citar post e citar
 * comentário) pela interface real, com o que cada um grava no Firestore e no Storage e o que o outro usuário enxerga.
 *
 * Imagem colada (Ctrl+V) e anexada pelo clipe nos quatro modais: o comentário com imagem chegou a falhar com
 * "Function addDoc() called with invalid data. Unsupported field value: undefined" porque a mídia era gravada com
 * `tempId: undefined` e `isLoading: undefined` (o Firestore recusa `undefined`).
 *
 * A é o autor do post-base e B comenta; as citações e o post com imagem são de A.
 *
 * A mídia gravada é a URL pública OPACA https://media.exercitodolula.app/m/<id> (nunca URL do Storage). Cada modal confere
 * o documento, o registro media/<id>, o objeto SEM token no bucket e a leitura anônima pela rota /m; o navegador de teste
 * manda o domínio de mídia de produção para o app local, então a imagem que a página mostra vem da rota real.
 */
import {
  adminFind,
  adminGetDoc,
  createPostViaUi,
  eventually,
  fsUpdate,
  isPublicMediaUrl,
  lerMidia,
  makePng,
  mediaIdFromUrl,
  storageList,
  storageMetadata,
} from '../lib/harness.mjs';

const MEDIA_KEYS = new Set(['url', 'type', 'alt', 'data-ai-hint']);

export async function run(ctx) {
  const { runner, users, BASE_URL, stamp, shot } = ctx;
  const { a: A, b: B } = users;
  const { section, step, soft, check } = runner;
  const png = makePng(240, 160, [30, 120, 220]);
  const arquivo = (name) => ({ name, mimeType: 'image/png', buffer: png });
  const postUrl = (postId) => `${BASE_URL}/pt-BR/post/${postId}`;
  const commentBox = (page, commentId) => page.locator(`#comment-${commentId}`);

  /** Cola uma imagem como o navegador faz no Ctrl+V: evento `paste` com um arquivo na área de transferência. */
  const colarImagem = (locator, { name, mimeType, buffer }) =>
    locator.evaluate((element, dados) => {
      const bytes = Uint8Array.from(atob(dados.base64), (c) => c.charCodeAt(0));
      const transferencia = new DataTransfer();
      transferencia.items.add(new File([bytes], dados.name, { type: dados.mimeType }));
      element.focus();
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transferencia, bubbles: true, cancelable: true }));
    }, { name, mimeType, base64: buffer.toString('base64') });

  /** Espera a pré-visualização aparecer e o envio terminar (a imagem já está no Storage: nenhuma mídia "uploading"). */
  const esperarEnvioDaImagem = async (dialog) => {
    await dialog.locator('[data-status] img').first().waitFor({ timeout: 30_000 });
    await dialog.locator('[data-status="uploading"]').waitFor({ state: 'detached', timeout: 60_000 });
    await dialog.locator('[data-status="ready"]').first().waitFor({ timeout: 10_000 });
  };

  /** Clica no botão de enviar e espera o modal fechar; se aparecer um aviso de erro, falha com o texto dele. */
  const enviar = async (page, dialog, nomeDoBotao) => {
    await dialog.getByRole('button', { name: nomeDoBotao, exact: true }).click();
    const fechou = dialog.waitFor({ state: 'detached', timeout: 60_000 }).then(() => null);
    const erro = page.locator('[role="status"]').filter({ hasText: /Erro|erro|Falha|falha|não enviada/ }).first()
      .waitFor({ state: 'visible', timeout: 60_000 }).then(async () => (await page.locator('[role="status"]').filter({ hasText: /Erro|erro|Falha|falha|não enviada/ }).first().innerText()).replace(/\s+/g, ' '));
    const resultado = await Promise.race([fechou, erro]);
    if (resultado) throw new Error(`o envio falhou com o aviso: "${resultado}"`);
  };

  /**
   * A mídia gravada tem só os campos do tipo Media (nada de tempId/isLoading) e aponta para a URL pública opaca /m/<id>:
   * o registro media/<id> é do autor, o objeto está no bucket SEM token e a rota /m o serve sem login.
   */
  const conferirMidiaGravada = async (doc, quem) => {
    check(Array.isArray(doc.media) && doc.media.length === 1, `esperava 1 mídia gravada, veio ${JSON.stringify(doc.media)}`);
    const [media] = doc.media;
    check(media.type === 'image', `media[0].type = ${media.type}`);
    check(isPublicMediaUrl(media.url), `URL fora do padrão https://media.exercitodolula.app/m/<id>: ${media.url}`);
    const extras = Object.keys(media).filter((key) => !MEDIA_KEYS.has(key));
    check(extras.length === 0, `a mídia gravada tem campos que não são do tipo Media: ${extras.join(', ')}`);
    check(doc.hasMedia === true, `hasMedia = ${doc.hasMedia}`);
    check(!/127[.]0[.]0[.]1:9199|firebasestorage|[?&]token=/.test(JSON.stringify(doc)), 'o documento guarda URL do Storage ou token');
    const mediaId = mediaIdFromUrl(media.url);
    const { doc: registro } = await adminGetDoc(`media/${mediaId}`);
    check(registro && registro.ownerUid === quem.uid && registro.visibility === 'public' && registro.kind === 'postMedia', `media/${mediaId}: dono ${registro?.ownerUid}, ${registro?.kind}/${registro?.visibility}`);
    check(registro?.storagePath?.startsWith(`user_uploads/${quem.uid}/postMedia/images/`), `storagePath fora do padrão: ${registro?.storagePath}`);
    const objeto = registro?.storagePath ? await storageMetadata(registro.storagePath) : null;
    check(objeto, 'o objeto não existe no bucket');
    const servida = await lerMidia(BASE_URL, mediaId);
    check(servida.status === 200 && /^image[/]/.test(servida.headers['content-type'] ?? ''), `a rota /m/${mediaId} respondeu ${servida.status} (${servida.headers['content-type']})`);
  };

  const imagemCarregou = (page, container) =>
    page.waitForFunction((selector) => {
      const img = document.querySelector(`${selector} img[src*="/m/"]`);
      return Boolean(img && img.complete && img.naturalWidth > 0);
    }, container, { timeout: 60_000 });

  const acharComentario = (texto) =>
    eventually(async () => (await adminFind('comments', {}, { allDescendants: true })).find((c) => String(c.text ?? '').includes(texto)),
      { label: `comentário com "${texto.slice(0, 28)}"`, timeoutMs: 60_000 });
  const acharPost = (user, texto) =>
    eventually(async () => (await adminFind('posts', { userId: user.uid })).find((p) => String(p.text ?? '').includes(texto)),
      { label: `post de ${user.label.toUpperCase()} com "${texto.slice(0, 28)}"`, timeoutMs: 60_000 });

  // O menu de repost/citação fecha com animação; um clique durante ela é engolido (mesmo cuidado da seção interacoes).
  const abrirMenu = async (page, gatilho) => {
    await page.locator('[role=menu]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      await gatilho.click();
      try {
        await page.getByRole('menu').waitFor({ state: 'visible', timeout: 3000 });
        return;
      } catch { /* tenta de novo */ }
    }
    throw new Error('o menu de repost/citação não abriu');
  };

  let postId;
  /** Abre o modal de comentário de B no post-base. */
  const abrirComentarioDeB = async () => {
    await B.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
    await B.page.getByText('Escreva um comentário...').first().click();
    const dialog = B.page.getByRole('dialog');
    await dialog.waitFor({ timeout: 15_000 });
    return dialog;
  };
  const avisoVisivel = (page, padrao) => page.locator('[role="status"]').filter({ hasText: padrao }).first();

  // ---------------------------------------------------------------------------------------------------------------
  section('composicao: preparação');
  const textoBase = `Post-base da composição ${stamp}`;
  await step('A publica o post-base', async () => {
    await A.page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await createPostViaUi(A.page, textoBase);
    postId = (await acharPost(A, textoBase)).__id;
    return `post ${postId}`;
  });

  // ---------------------------------------------------------------------------------------------------------------
  section('composicao: imagem em comentário e em resposta');
  let comentarioId;
  const textoComentario = `Comentário com imagem colada ${stamp}`;
  await soft('B cola uma imagem (Ctrl+V) no comentário e envia: o comentário é gravado com a imagem', async () => {
    await B.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
    await B.page.getByText('Escreva um comentário...').first().click();
    const dialog = B.page.getByRole('dialog');
    await dialog.waitFor({ timeout: 15_000 });
    await colarImagem(dialog.getByPlaceholder('Escreva um comentário...'), arquivo('colada.png'));
    await esperarEnvioDaImagem(dialog);
    await dialog.getByPlaceholder('Escreva um comentário...').fill(textoComentario);
    await shot(B.page, 'composicao-01-comentario-imagem-colada');
    await enviar(B.page, dialog, 'Responder');
    const gravado = await acharComentario(textoComentario);
    comentarioId = gravado.__id;
    await conferirMidiaGravada(gravado, B);
    return `comentário ${comentarioId}`;
  }, { tag: 'funcional' });
  await soft('A e B enxergam a imagem do comentário na página do post (carrega de verdade)', async () => {
    check(comentarioId, 'o comentário não foi criado');
    for (const user of [A, B]) {
      await user.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
      await commentBox(user.page, comentarioId).waitFor({ timeout: 60_000 });
      await imagemCarregou(user.page, `#comment-${comentarioId}`);
    }
  }, { tag: 'funcional' });

  const textoAnexo = `Comentário com imagem anexada pelo clipe ${stamp}`;
  await soft('B anexa uma imagem pelo clipe no comentário e envia', async () => {
    await B.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
    await B.page.getByText('Escreva um comentário...').first().click();
    const dialog = B.page.getByRole('dialog');
    await dialog.waitFor({ timeout: 15_000 });
    await dialog.locator('input[type=file]').first().setInputFiles(arquivo('anexada.png'));
    await esperarEnvioDaImagem(dialog);
    await dialog.getByPlaceholder('Escreva um comentário...').fill(textoAnexo);
    await enviar(B.page, dialog, 'Responder');
    await conferirMidiaGravada(await acharComentario(textoAnexo), B);
  }, { tag: 'funcional' });

  await soft('comentário com 3 imagens: a página mostra as 3, não só a primeira', async () => {
    const texto = `Comentário com três imagens ${stamp}`;
    const dialog = await abrirComentarioDeB();
    await dialog.locator('input[type=file]').first().setInputFiles([arquivo('t1.png'), arquivo('t2.png'), arquivo('t3.png')]);
    await eventually(async () => (await dialog.locator('[data-status="ready"]').count()) === 3, { label: 'três imagens enviadas', timeoutMs: 60_000 });
    await dialog.getByPlaceholder('Escreva um comentário...').fill(texto);
    await enviar(B.page, dialog, 'Responder');
    const gravado = await acharComentario(texto);
    check(Array.isArray(gravado.media) && gravado.media.length === 3, `mídias gravadas: ${gravado.media?.length}`);
    for (const user of [A, B]) {
      await user.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
      await commentBox(user.page, gravado.__id).waitFor({ timeout: 60_000 });
      await user.page.waitForFunction((id) => document.querySelectorAll(`#comment-${id} [data-testid="media-grid"] img`).length === 3, gravado.__id, { timeout: 60_000 });
    }
  }, { tag: 'funcional' });

  const textoResposta = `Resposta com imagem colada ${stamp}`;
  await soft('A cola uma imagem na RESPOSTA ao comentário de B e envia', async () => {
    check(comentarioId, 'o comentário de B não foi criado');
    await A.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
    await commentBox(A.page, comentarioId).waitFor({ timeout: 60_000 });
    await commentBox(A.page, comentarioId).locator('button[title="Reply to comment"]').first().click();
    const dialog = A.page.getByRole('dialog');
    await dialog.waitFor({ timeout: 15_000 });
    await colarImagem(dialog.getByPlaceholder('Escreva um comentário...'), arquivo('resposta.png'));
    await esperarEnvioDaImagem(dialog);
    await dialog.getByPlaceholder('Escreva um comentário...').type(textoResposta);
    await enviar(A.page, dialog, 'Responder');
    const resposta = await acharComentario(textoResposta);
    check(resposta.parentCommentId === comentarioId, `a resposta aponta para ${resposta.parentCommentId} (esperado ${comentarioId})`);
    await conferirMidiaGravada(resposta, A);
  }, { tag: 'funcional' });

  // ---------------------------------------------------------------------------------------------------------------
  section('composicao: imagem em post e em citações');
  const textoPost = `Post com imagem colada ${stamp}`;
  await soft('A cola uma imagem no modal Postar e publica: o post guarda a imagem', async () => {
    await A.page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await A.page.getByRole('button', { name: 'Postar', exact: true }).first().click();
    const dialog = A.page.getByRole('dialog');
    await dialog.waitFor();
    await colarImagem(dialog.getByPlaceholder('E aí?'), arquivo('post-colado.png'));
    await esperarEnvioDaImagem(dialog);
    await dialog.getByPlaceholder('E aí?').fill(textoPost);
    await enviar(A.page, dialog, 'Postar');
    await conferirMidiaGravada(await acharPost(A, textoPost), A);
  }, { tag: 'funcional' });

  const textoCitacao = `Citação com imagem colada ${stamp}`;
  await soft('B cola uma imagem ao CITAR o post de A e publica: a citação guarda a imagem', async () => {
    await B.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
    await abrirMenu(B.page, B.page.locator('main button:has(svg.lucide-repeat2)').first());
    await B.page.getByRole('menuitem', { name: 'Citar postagem' }).click();
    const dialog = B.page.getByRole('dialog');
    await dialog.waitFor({ timeout: 15_000 });
    await colarImagem(dialog.getByPlaceholder('E aí...'), arquivo('citacao.png'));
    await esperarEnvioDaImagem(dialog);
    await dialog.getByPlaceholder('E aí...').fill(textoCitacao);
    await enviar(B.page, dialog, 'Postar');
    const citacao = await acharPost(B, textoCitacao);
    check(citacao.type === 'quote', `o post criado é do tipo "${citacao.type}" (esperado quote)`);
    await conferirMidiaGravada(citacao, B);
  }, { tag: 'funcional' });

  const textoCitacaoComentario = `Citação de comentário com imagem colada ${stamp}`;
  await soft('A cola uma imagem ao CITAR o comentário de B e publica: a citação guarda a imagem', async () => {
    check(comentarioId, 'o comentário de B não foi criado');
    await A.page.goto(postUrl(postId), { waitUntil: 'domcontentloaded' });
    await commentBox(A.page, comentarioId).waitFor({ timeout: 60_000 });
    await abrirMenu(A.page, commentBox(A.page, comentarioId).locator('button:has(svg.lucide-repeat2)').first());
    await A.page.getByRole('menuitem', { name: 'Citar Comentário' }).click();
    const dialog = A.page.getByRole('dialog');
    await dialog.waitFor({ timeout: 15_000 });
    await colarImagem(dialog.getByPlaceholder('E aí...'), arquivo('citacao-comentario.png'));
    await esperarEnvioDaImagem(dialog);
    await dialog.getByPlaceholder('E aí...').fill(textoCitacaoComentario);
    await enviar(A.page, dialog, 'Postar');
    const citacao = await acharPost(A, textoCitacaoComentario);
    check(citacao.quotedCommentId === `${postId}/${comentarioId}`, `quotedCommentId = ${citacao.quotedCommentId}`);
    await conferirMidiaGravada(citacao, A);
  }, { tag: 'funcional' });

  // ---------------------------------------------------------------------------------------------------------------
  section('composicao: quando o envio falha, o que a pessoa escreveu fica');

  await soft('comentário recusado pelo servidor (A fecha as respostas com o modal já aberto): aviso em português e o texto e a imagem continuam no formulário', async () => {
    const textoRecusado = `Comentário que será recusado ${stamp}`;
    try {
      const dialog = await abrirComentarioDeB();
      const campo = dialog.getByPlaceholder('Escreva um comentário...');
      await colarImagem(campo, arquivo('recusada.png'));
      await esperarEnvioDaImagem(dialog);
      await campo.fill(textoRecusado);
      // A tela de B ainda não sabe: só o servidor (regra canReplyTo) recusa, no momento do envio.
      await fsUpdate(`posts/${postId}`, { replyPermission: 'none' }, 'owner');
      await dialog.getByRole('button', { name: 'Responder', exact: true }).click();
      const aviso = avisoVisivel(B.page, /Erro ao enviar comentário/);
      await aviso.waitFor({ timeout: 30_000 });
      const textoDoAviso = (await aviso.innerText()).replace(/\s+/g, ' ');
      check(!/Missing or insufficient|FirebaseError|called with|undefined/i.test(textoDoAviso), `o aviso mostra texto técnico do SDK: "${textoDoAviso}"`);
      check(/permissão/.test(textoDoAviso), `o aviso não explica a recusa: "${textoDoAviso}"`);
      check(await dialog.isVisible(), 'o modal fechou depois do erro');
      check((await campo.inputValue()) === textoRecusado, `o texto foi apagado depois do erro (campo: "${await campo.inputValue()}")`);
      check((await dialog.locator('[data-status="ready"] img').count()) === 1, 'a imagem sumiu do formulário depois do erro');
      await shot(B.page, 'composicao-02-erro-mantem-o-conteudo');
      const gravado = (await adminFind('comments', {}, { allDescendants: true })).find((c) => String(c.text ?? '').includes(textoRecusado));
      check(!gravado, 'o comentário recusado foi gravado mesmo assim');
    } finally {
      await fsUpdate(`posts/${postId}`, { replyPermission: 'everyone' }, 'owner');
    }
  }, { tag: 'funcional' });

  await soft('texto acima de 300 caracteres: o envio é barrado com aviso (sem cortar em silêncio) e o texto fica', async () => {
    const dialog = await abrirComentarioDeB();
    const campo = dialog.getByPlaceholder('Escreva um comentário...');
    const longo = `${stamp} ${'a'.repeat(300)}`;
    await campo.fill(longo);
    await dialog.getByRole('button', { name: 'Responder', exact: true }).click();
    await avisoVisivel(B.page, /Texto longo demais/).waitFor({ timeout: 15_000 });
    check(await dialog.isVisible(), 'o modal fechou com o texto longo');
    check((await campo.inputValue()) === longo, 'o texto longo foi alterado ou apagado');
    check(!(await adminFind('comments', {}, { allDescendants: true })).some((c) => String(c.text ?? '').includes(stamp + ' aaaa')), 'um comentário cortado foi gravado');
  }, { tag: 'funcional' });

  await soft('arquivo que não é imagem nem vídeo é recusado na hora, com aviso, e não entra na lista', async () => {
    const dialog = await abrirComentarioDeB();
    await dialog.locator('input[type=file]').first().setInputFiles({ name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('oi') });
    await avisoVisivel(B.page, /Arquivo não suportado/).waitFor({ timeout: 15_000 });
    check((await dialog.locator('[data-status]').count()) === 0, 'o arquivo de texto entrou na lista de mídia');
  }, { tag: 'funcional' });

  await soft('cinco imagens de uma vez: entram quatro e o aviso de limite aparece', async () => {
    const dialog = await abrirComentarioDeB();
    const cinco = ['a', 'b', 'c', 'd', 'e'].map((letra) => arquivo(`lote-${letra}.png`));
    await dialog.locator('input[type=file]').first().setInputFiles(cinco);
    await avisoVisivel(B.page, /Limite de mídia atingido/).waitFor({ timeout: 15_000 });
    await eventually(async () => (await dialog.locator('[data-status]').count()) === 4, { label: 'quatro mídias na lista' });
    await eventually(async () => (await dialog.locator('[data-status="uploading"]').count()) === 0, { label: 'envios terminados', timeoutMs: 60_000 });
    check((await dialog.locator('[data-status]').count()) === 4, 'a lista não ficou com exatamente 4 mídias');
  }, { tag: 'funcional' });

  await soft('Ctrl+Enter envia o comentário', async () => {
    const textoAtalho = `Comentário enviado com Ctrl+Enter ${stamp}`;
    const dialog = await abrirComentarioDeB();
    const campo = dialog.getByPlaceholder('Escreva um comentário...');
    await campo.fill(textoAtalho);
    await campo.press('Control+Enter');
    await dialog.waitFor({ state: 'detached', timeout: 60_000 });
    await acharComentario(textoAtalho);
  }, { tag: 'funcional' });

  await soft('o envio da imagem falha: aviso claro e "Tentar novamente" reenvia o MESMO item (sem duplicar)', async () => {
    const dialog = await abrirComentarioDeB();
    // O envio passa pela rota /api/media/upload (o app não usa mais o SDK do Storage no navegador). Enquanto a rota estiver
    // interceptada o servidor "falha"; nada chega a ele, então não pode sobrar objeto nem registro.
    const registrosAntes = (await adminFind('media', { ownerUid: B.uid })).length;
    const objetosAntes = (await storageList('user_uploads/' + B.uid + '/postMedia/images/')).length;
    await B.page.route('**/api/media/upload', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"upload-failed"}' }));
    await colarImagem(dialog.getByPlaceholder('Escreva um comentário...'), arquivo('vai-falhar.png'));
    await dialog.locator('[data-status="failed"]').waitFor({ timeout: 30_000 });
    const aviso = (await avisoVisivel(B.page, /Falha no envio do arquivo/).innerText()).replace(/\s+/g, ' ');
    check(!/Firebase|storage[/]|50[0-9]|upload-failed/.test(aviso), 'o aviso mostra texto técnico: ' + aviso);
    check((await adminFind('media', { ownerUid: B.uid })).length === registrosAntes, 'a falha do envio deixou um registro media/<id> órfão');
    await B.page.unroute('**/api/media/upload');
    await dialog.getByRole('button', { name: 'Tentar novamente' }).click();
    await dialog.locator('[data-status="ready"]').waitFor({ timeout: 60_000 });
    check((await dialog.locator('[data-status]').count()) === 1, 'tentar de novo duplicou a mídia na lista');
    check((await adminFind('media', { ownerUid: B.uid })).length === registrosAntes + 1, 'tentar de novo não criou exatamente UM registro media/<id>');
    check((await storageList('user_uploads/' + B.uid + '/postMedia/images/')).length === objetosAntes + 1, 'tentar de novo não deixou exatamente UM objeto novo no bucket');
  }, { tag: 'funcional' });
}
