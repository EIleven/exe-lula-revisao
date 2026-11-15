/**
 * Seção "midia": upload, leitura e exclusão de mídia pelas telas reais E pelas rotas do app que a servem.
 *
 * O app não guarda mais URL do Storage. Mídia de post/comentário é pública e vive em /m/<id> (domínio de mídia); anexo de
 * mensagem e arquivo pessoal são privados e vivem em /mp/<id>, que exige a sessão e REFAZ a autorização a cada pedido.
 * Aqui se prova, no ambiente local (emuladores + o app real):
 *  - o que fica gravado (registro media/<id>, objeto no Storage SEM token de download, nenhuma URL do Storage no documento);
 *  - /m/<id>: leitura anônima, Range, ETag, HEAD, id inexistente e id privado (404), mídia removida (410);
 *  - /mp/<id>: anônimo e terceiro recebem 404, dono e participante recebem a imagem, bloqueio em qualquer direção corta;
 *  - a página carrega a imagem PELA ROTA (nunca pelo Storage) e a exclusão tira a mídia do ar e do bucket;
 *  - arquivo pessoal (kind userFile): só o dono lê.
 * As regras do Storage (quem grava, quem apaga, limite de tamanho) são testadas na seção "autorizacao".
 * A tela /files ainda é um aviso "em construção" (o fileService existe, mas nenhuma tela o usa): o arquivo pessoal é
 * exercitado pela API de upload, que é o que a tela futura vai chamar.
 */
import {
  adminFind,
  adminGetDoc,
  cookieDeSessao,
  eventually,
  fsCall,
  fsDelete,
  fsSet,
  isPrivateMediaPath,
  isPublicMediaUrl,
  lerMidia,
  makePng,
  mediaIdFromUrl,
  storageList,
  storageMetadata,
  storageRead,
} from '../lib/harness.mjs';

const mesmosBytes = (a, b) => Buffer.isBuffer(a) && Buffer.isBuffer(b) && Buffer.compare(a, b) === 0;

export async function run(ctx) {
  const { runner, users, BASE_URL, stamp, shot, token } = ctx;
  const { a: A, b: B, c: C } = users;
  const { section, soft, skip, check } = runner;
  const png = makePng(240, 160);
  const imageLoaded = (page, selector) =>
    page.waitForFunction((sel) => {
      const img = document.querySelector(sel);
      return Boolean(img && img.complete && img.naturalWidth > 0);
    }, selector, { timeout: 60_000 });

  // Toda página precisa buscar mídia pelas ROTAS do app, nunca direto no Storage. Registra o que escapar.
  const pedidosAoStorage = { a: [], b: [], c: [] };
  for (const [chave, user] of Object.entries({ a: A, b: B, c: C })) {
    user.page.on('request', (pedido) => {
      if (/127[.]0[.]0[.]1:9199/.test(pedido.url()) && /alt=media|[?&]token=/.test(pedido.url())) pedidosAoStorage[chave].push(pedido.url());
    });
  }
  const semAcessoDiretoAoStorage = (chave) => check(pedidosAoStorage[chave].length === 0, `a página de ${chave.toUpperCase()} buscou mídia direto no Storage: ${pedidosAoStorage[chave].slice(0, 2).join(' | ')}`);

  // ---------------------------------------------------------------------------------------------------------------
  section('mídia: imagem em post');
  const postText = `Post com imagem ${stamp}`;
  let postId;
  let postMediaId;
  let postStoragePath;
  let postBytes; // o que ficou no bucket (o cliente comprime a imagem, então não é o PNG original)
  await soft('A anexa uma imagem pela tela de postagem, espera o envio terminar e publica o post', async () => {
    await A.page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await A.page.getByRole('button', { name: 'Postar', exact: true }).first().click();
    const dialog = A.page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByPlaceholder('E aí?').fill(postText);
    await dialog.locator('input[type=file]').first().setInputFiles({ name: 'foto-teste.png', mimeType: 'image/png', buffer: png });
    await dialog.locator('img').first().waitFor({ timeout: 30_000 }); // pré-visualização da imagem anexada
    // Observação (não determinística, por isso não é teste): clicar em Postar ainda com a mídia "uploading" já deixou o
    // clique sem efeito algum (sem aviso e sem publicar). Aqui espera-se o envio terminar, como um usuário atento.
    await dialog.locator('[data-status="uploading"]').waitFor({ state: 'detached', timeout: 60_000 });
    await shot(A.page, 'midia-01-anexada');
    await dialog.getByRole('button', { name: 'Postar', exact: true }).click();
    await A.page.getByText('Post Enviado!').first().waitFor({ timeout: 90_000 });
  });
  await soft('o post guarda a URL pública OPACA (/m/<id>), o registro media/<id> está certo e o objeto não tem token', async () => {
    const post = await eventually(
      async () => (await adminFind('posts', { userId: A.uid })).find((p) => String(p.text).includes(postText)),
      { label: 'post com imagem no Firestore' },
    );
    postId = post.__id;
    const media = post.media?.[0];
    check(media?.url, `o post não guarda media[0].url: ${JSON.stringify(post.media)}`);
    check(media.type === 'image', `media[0].type = ${media.type}`);
    check(isPublicMediaUrl(media.url), `URL fora do padrão https://media.exercitodolula.app/m/<id>: ${media.url}`);
    postMediaId = mediaIdFromUrl(media.url);
    check(!/127[.]0[.]0[.]1:9199|firebasestorage|[?&]token=/.test(JSON.stringify(post)), 'o documento do post guarda URL do Storage ou token');

    const { doc: registro } = await adminGetDoc(`media/${postMediaId}`);
    check(registro, `não existe media/${postMediaId}`);
    check(registro.ownerUid === A.uid, `ownerUid = ${registro.ownerUid}`);
    check(registro.visibility === 'public' && registro.kind === 'postMedia', `visibility/kind = ${registro.visibility}/${registro.kind}`);
    check(!registro.deletedAt, 'o registro nasceu com deletedAt');
    postStoragePath = registro.storagePath;
    postBytes = (await storageRead(postStoragePath, 'owner')).bytes;
    check(postBytes?.length > 0, `não consegui ler ${postStoragePath} no Storage`);
    check(registro.contentType?.startsWith('image/') && registro.size === postBytes?.length, `contentType/size = ${registro.contentType}/${registro.size} (o objeto tem ${postBytes?.length} bytes)`);
    check(postStoragePath?.startsWith(`user_uploads/${A.uid}/postMedia/images/`), `storagePath fora do padrão: ${postStoragePath}`);

    const objetos = await storageList(`user_uploads/${A.uid}/postMedia/images/`);
    check(objetos.length === 1 && objetos[0] === postStoragePath, `esperava só ${postStoragePath} no Storage, há: ${objetos.join(', ')}`);
    const metadata = await storageMetadata(postStoragePath);
    check(metadata, `o objeto ${postStoragePath} não existe no bucket`);
    return `media ${postMediaId}`;
  });
  await soft('rota PÚBLICA /m/<id>: leitura anônima, cabeçalhos, Range, ETag, HEAD e ids inválidos', async () => {
    check(postMediaId, 'o post não foi criado');
    const r = await lerMidia(BASE_URL, postMediaId);
    const registroTipo = (await adminGetDoc(`media/${postMediaId}`)).doc?.contentType;
    check(r.status === 200, `GET anônimo respondeu ${r.status}`);
    check(mesmosBytes(r.bytes, postBytes), 'os bytes servidos não são os da imagem enviada');
    check(r.headers['content-type'] === registroTipo, `content-type = ${r.headers['content-type']}`);
    check(r.headers['accept-ranges'] === 'bytes', `accept-ranges = ${r.headers['accept-ranges']}`);
    check(/public/.test(r.headers['cache-control'] ?? ''), `cache-control = ${r.headers['cache-control']}`);
    check(r.headers['access-control-allow-origin'] === '*' && r.headers['x-content-type-options'] === 'nosniff', 'faltam CORS aberto ou nosniff na mídia pública');
    check(!Object.keys(r.headers).some((h) => /^x-goog|^location$|^set-cookie$/i.test(h)), `cabeçalhos que vazam o Storage ou sessão: ${Object.keys(r.headers).join(',')}`);

    const parcial = await lerMidia(BASE_URL, postMediaId, { range: 'bytes=0-9' });
    check(parcial.status === 206 && parcial.headers['content-range'] === `bytes 0-9/${postBytes.length}`, `Range respondeu ${parcial.status} ${parcial.headers['content-range']}`);
    check(mesmosBytes(parcial.bytes, postBytes.subarray(0, 10)), 'o trecho servido não bate com o início da imagem');
    const alem = await lerMidia(BASE_URL, postMediaId, { range: `bytes=${postBytes.length + 50}-` });
    check(alem.status === 416, `Range fora do arquivo respondeu ${alem.status}`);

    const etag = r.headers.etag;
    check(etag, 'sem ETag');
    const condicional = await fetch(`${BASE_URL}/m/${postMediaId}`, { headers: { 'If-None-Match': etag } });
    check(condicional.status === 304, `If-None-Match respondeu ${condicional.status}`);
    const cabeca = await lerMidia(BASE_URL, postMediaId, { metodo: 'HEAD' });
    check(cabeca.status === 200 && Number(cabeca.headers['content-length']) === postBytes.length, `HEAD respondeu ${cabeca.status} / length ${cabeca.headers['content-length']}`);

    for (const invalido of ['abc', '..%2F..%2Fetc%2Fpasswd', 'A'.repeat(21), 'A'.repeat(23), '!'.repeat(22)]) {
      const x = await fetch(`${BASE_URL}/m/${invalido}`, { redirect: 'manual' });
      check(x.status === 404, `id inválido "${invalido}" respondeu ${x.status}`);
    }
    const inexistente = await lerMidia(BASE_URL, 'A'.repeat(22));
    check(inexistente.status === 404, `id bem formado mas inexistente respondeu ${inexistente.status}`);
    const rotaPrivada = await lerMidia(BASE_URL, postMediaId, { privada: true });
    check(rotaPrivada.status === 404, `a mídia pública pela rota /mp sem sessão respondeu ${rotaPrivada.status}`);
  }, { tag: 'privacidade' });
  await soft('A e B enxergam a imagem do post na página do post, carregada PELA ROTA /m (nunca direto do Storage)', async () => {
    check(postId, 'o post não foi criado');
    for (const user of [A, B]) {
      await user.page.goto(`${BASE_URL}/pt-BR/post/${postId}`, { waitUntil: 'domcontentloaded' });
      await user.page.getByText(postText).first().waitFor({ timeout: 90_000 });
      await imageLoaded(user.page, `img[src="https://media.exercitodolula.app/m/${postMediaId}"]`);
    }
    semAcessoDiretoAoStorage('a');
    semAcessoDiretoAoStorage('b');
    await shot(B.page, 'midia-02-imagem-vista-por-b');
  });

  // ---------------------------------------------------------------------------------------------------------------
  section('mídia: anexo em mensagem privada');
  const dmText = `Segue a imagem ${stamp}`;
  let dmMediaId;
  let dmStoragePath;
  let dmBytes;
  await soft('A anexa uma imagem numa mensagem para B e ela aparece na conversa', async () => {
    await A.page.goto(`${BASE_URL}/pt-BR/messages/user/${B.uid}`, { waitUntil: 'domcontentloaded' });
    await A.page.getByPlaceholder('Digite sua mensagem...').waitFor({ timeout: 90_000 });
    await A.page.locator('input[type=file][accept*="audio"]').setInputFiles({ name: 'anexo-teste.png', mimeType: 'image/png', buffer: png });
    await A.page.getByPlaceholder('Digite sua mensagem...').fill(dmText);
    await A.page.locator('form:has(textarea[placeholder="Digite sua mensagem..."]) button[type=submit]').click();
    await A.page.getByText(dmText).first().waitFor({ timeout: 90_000 });
    await shot(A.page, 'midia-03-anexo-enviado');
  });
  await soft('a mensagem guarda /mp/<id> (sem URL do Storage); media/<id> é privado do tipo dm e o objeto não tem token', async () => {
    const message = await eventually(
      async () => (await adminFind('messages', {}, { allDescendants: true, limit: 500 })).find((m) => m.text === dmText),
      { label: 'mensagem com anexo' },
    );
    check(isPrivateMediaPath(message.fileUrl), `fileUrl fora do padrão /mp/<id>: ${message.fileUrl}`);
    check(message.fileType === 'image', `fileType = ${message.fileType}`);
    check(!/127[.]0[.]0[.]1:9199|firebasestorage|[?&]token=/.test(JSON.stringify(message)), 'a mensagem guarda URL do Storage ou token');
    dmMediaId = mediaIdFromUrl(message.fileUrl);
    const { doc: registro } = await adminGetDoc(`media/${dmMediaId}`);
    check(registro, `não existe media/${dmMediaId}`);
    check(registro.ownerUid === A.uid && registro.kind === 'dm' && registro.visibility === 'private', `registro: dono ${registro.ownerUid}, ${registro.kind}/${registro.visibility}`);
    dmStoragePath = registro.storagePath;
    dmBytes = (await storageRead(dmStoragePath, 'owner')).bytes;
    check(dmBytes?.length > 0, `não consegui ler ${dmStoragePath} no Storage`);
    check(dmStoragePath?.startsWith(`user_uploads/${A.uid}/dms/images/`), `storagePath fora do padrão: ${dmStoragePath}`);
    const objetos = await storageList(`user_uploads/${A.uid}/dms/images/`);
    check(objetos.length === 1 && objetos[0] === dmStoragePath, `esperava só ${dmStoragePath} no Storage, há: ${objetos.join(', ')}`);
    check(await storageMetadata(dmStoragePath), `o objeto ${dmStoragePath} não existe no bucket`);
  });
  await soft('A e B veem o anexo na conversa, carregado pela rota /mp com a sessão (nunca direto do Storage)', async () => {
    check(dmMediaId, 'a mensagem não foi criada');
    await imageLoaded(A.page, `img[src$="/mp/${dmMediaId}"]`);
    await B.page.goto(`${BASE_URL}/pt-BR/messages/user/${A.uid}`, { waitUntil: 'domcontentloaded' });
    await B.page.getByText(dmText).first().waitFor({ timeout: 90_000 });
    await imageLoaded(B.page, `img[src$="/mp/${dmMediaId}"]`);
    semAcessoDiretoAoStorage('a');
    semAcessoDiretoAoStorage('b');
    await shot(B.page, 'midia-04-anexo-visto-por-b');
  });
  await soft('rota PRIVADA /mp/<id>: anônimo e terceiro recebem 404; dono e participante recebem a imagem; cabeçalhos privados', async () => {
    check(dmMediaId, 'a mensagem não foi criada');
    const cookies = { a: await cookieDeSessao(A.context), b: await cookieDeSessao(B.context), c: await cookieDeSessao(C.context) };
    check(cookies.a && cookies.b && cookies.c, 'faltou o cookie de sessão de alguma das três contas');

    const anonimo = await lerMidia(BASE_URL, dmMediaId, { privada: true });
    check(anonimo.status === 404, `anônimo respondeu ${anonimo.status} (esperado 404, nunca 401/403 que confirmariam o id)`);
    const terceiro = await lerMidia(BASE_URL, dmMediaId, { privada: true, cookie: cookies.c });
    check(terceiro.status === 404, `terceiro (C, fora da conversa) respondeu ${terceiro.status}`);
    const dono = await lerMidia(BASE_URL, dmMediaId, { privada: true, cookie: cookies.a });
    check(dono.status === 200 && mesmosBytes(dono.bytes, dmBytes), `dono respondeu ${dono.status} / bytes ${mesmosBytes(dono.bytes, dmBytes) ? 'iguais' : 'diferentes'}`);
    const participante = await lerMidia(BASE_URL, dmMediaId, { privada: true, cookie: cookies.b });
    check(participante.status === 200 && mesmosBytes(participante.bytes, dmBytes), `participante (B) respondeu ${participante.status}`);

    check(/private/.test(dono.headers['cache-control'] ?? '') && /no-store/.test(dono.headers['cache-control'] ?? ''), `cache-control = ${dono.headers['cache-control']}`);
    check(dono.headers['x-content-type-options'] === 'nosniff' && /noindex/.test(dono.headers['x-robots-tag'] ?? ''), 'faltam nosniff ou noindex na mídia privada');
    check(!dono.headers['access-control-allow-origin'], `a mídia privada abre CORS: ${dono.headers['access-control-allow-origin']}`);
    check(/cookie/i.test(dono.headers.vary ?? ''), `Vary = ${dono.headers.vary} (a resposta muda com a sessão)`);

    const parcial = await lerMidia(BASE_URL, dmMediaId, { privada: true, cookie: cookies.b, range: 'bytes=0-9' });
    check(parcial.status === 206 && mesmosBytes(parcial.bytes, dmBytes.subarray(0, 10)), `Range privado respondeu ${parcial.status}`);
    const pelaRotaPublica = await lerMidia(BASE_URL, dmMediaId);
    check(pelaRotaPublica.status === 404, `o anexo privado pela rota pública /m respondeu ${pelaRotaPublica.status}`);
    const cookieInvalido = await lerMidia(BASE_URL, dmMediaId, { privada: true, cookie: '__session=isto-nao-e-uma-sessao' });
    check(cookieInvalido.status === 404, `cookie de sessão inválido respondeu ${cookieInvalido.status}`);
  }, { tag: 'privacidade' });
  await soft('bloqueio em QUALQUER direção corta o acesso ao anexo na hora, e desbloquear devolve', async () => {
    check(dmMediaId, 'a mensagem não foi criada');
    const cookieB = await cookieDeSessao(B.context);
    const leitura = async () => (await lerMidia(BASE_URL, dmMediaId, { privada: true, cookie: cookieB })).status;
    check((await leitura()) === 200, 'B não lia o anexo antes do bloqueio');
    try {
      await fsSet(`users/${A.uid}/blockedUsers/${B.uid}`, { blockedAt: new Date().toISOString() }, 'owner'); // o dono bloqueou quem pede
      check((await leitura()) === 404, 'A bloqueou B e B ainda lê o anexo');
      await fsDelete(`users/${A.uid}/blockedUsers/${B.uid}`, 'owner');
      check((await leitura()) === 200, 'desbloqueado, B não voltou a ler o anexo');
      await fsSet(`users/${B.uid}/blockedUsers/${A.uid}`, { blockedAt: new Date().toISOString() }, 'owner'); // quem pede bloqueou o dono
      check((await leitura()) === 404, 'B bloqueou A e B ainda lê o anexo');
    } finally {
      await fsDelete(`users/${A.uid}/blockedUsers/${B.uid}`, 'owner').catch(() => {});
      await fsDelete(`users/${B.uid}/blockedUsers/${A.uid}`, 'owner').catch(() => {});
    }
    check((await leitura()) === 200, 'removidos os bloqueios, B não voltou a ler o anexo');
  }, { tag: 'privacidade' });

  // ---------------------------------------------------------------------------------------------------------------
  section('mídia: arquivo pessoal (a tela /files ainda não existe; a API de envio é o que ela vai chamar)');
  await soft('arquivo pessoal enviado pela API fica privado do tipo userFile: só o dono lê, anônimo e outra conta recebem 404', async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const idToken = await token(A);
    const form = new FormData();
    form.set('file', new File([pdf], 'documento.pdf', { type: 'application/pdf' }));
    form.set('storagePath', `user_uploads/${A.uid}/user_files/documento-${stamp}.pdf`);
    const resposta = await fetch(`${BASE_URL}/api/media/upload`, { method: 'POST', headers: { Authorization: `Bearer ${idToken}` }, body: form });
    const corpo = await resposta.json().catch(() => ({}));
    check(resposta.status === 201, `upload do arquivo pessoal respondeu ${resposta.status} ${JSON.stringify(corpo)}`);
    check(isPrivateMediaPath(corpo.downloadURL), `downloadURL de arquivo pessoal deveria ser /mp/<id>: ${corpo.downloadURL}`);
    const id = corpo.mediaId;
    const { doc: registro } = await adminGetDoc(`media/${id}`);
    check(registro?.kind === 'userFile' && registro.visibility === 'private' && registro.ownerUid === A.uid, `registro: ${registro?.kind}/${registro?.visibility}/${registro?.ownerUid}`);
    check(await storageMetadata(registro.storagePath), 'o arquivo pessoal não existe no bucket');

    const cookieA = await cookieDeSessao(A.context);
    const cookieB = await cookieDeSessao(B.context);
    check((await lerMidia(BASE_URL, id)).status === 404, 'o arquivo pessoal respondeu na rota pública /m');
    check((await lerMidia(BASE_URL, id, { privada: true })).status === 404, 'anônimo leu o arquivo pessoal');
    check((await lerMidia(BASE_URL, id, { privada: true, cookie: cookieB })).status === 404, 'outra conta (B) leu o arquivo pessoal');
    const dono = await lerMidia(BASE_URL, id, { privada: true, cookie: cookieA });
    check(dono.status === 200 && mesmosBytes(dono.bytes, pdf), `o dono respondeu ${dono.status}`);
    // Política de exibição (privateAccess.ts): PDF é exibido no navegador; ?dl=1 força o download; tipo fora da lista é sempre download.
    check(/inline/i.test(dono.headers['content-disposition'] ?? ''), 'o PDF deveria ser exibido (inline), veio: ' + dono.headers['content-disposition']);
    const baixar = await fetch(BASE_URL + '/mp/' + id + '?dl=1', { headers: { Cookie: cookieA } });
    check(baixar.status === 200 && /attachment/i.test(baixar.headers.get('content-disposition') ?? ''), 'com ?dl=1 o arquivo deveria vir como attachment, veio ' + baixar.status + ' ' + baixar.headers.get('content-disposition'));
    check(!/filename="documento/.test(baixar.headers.get('content-disposition') ?? ''), 'o nome do arquivo enviado pela pessoa vazou para o cabeçalho (o app monta o nome)');
  }, { tag: 'privacidade' });
  skip('objeto sem token de download no bucket (post, anexo e arquivo pessoal)', 'não executável no emulador: o emulador do Storage acrescenta downloadTokens a TODO objeto, inclusive o gravado pelo Admin SDK sem token pedido (controle: um objeto criado pela mesma chamada que /api/media/upload usa aparece com token). A ausência de token só existe no GCS real e é conferida no teste de produção, lendo os metadados do objeto. Aqui se prova o que é do app: nenhuma URL com token em documento algum e nenhuma página buscando mídia direto no Storage.');
  skip('tela /files: enviar, listar e apagar arquivos pessoais pela interface', 'a tela mostra "Funcionalidade em Construção" e nenhuma tela usa o fileService: não há interface a exercitar. A rota de envio e a leitura privada do arquivo pessoal são testadas acima pela API.');

  // ---------------------------------------------------------------------------------------------------------------
  section('mídia: exclusão');
  /** Apagar de verdade: o registro vira tombstone (410 em /m, 404 em /mp) E o objeto sai do bucket. */
  const conferirMidiaApagada = async (mediaId, storagePath, { privada }) => {
    await eventually(async () => Boolean((await adminGetDoc(`media/${mediaId}`)).doc?.deletedAt), { label: `media/${mediaId} com deletedAt (tombstone)`, timeoutMs: 60_000 });
    const anonimo = await lerMidia(BASE_URL, mediaId);
    check(privada ? anonimo.status === 404 : anonimo.status === 410, `/m/<id> de mídia apagada respondeu ${anonimo.status} (esperado ${privada ? 404 : 410})`);
    if (!privada) check(/max-age=300/.test(anonimo.headers['cache-control'] ?? ''), `o 410 deveria ser cacheável por 5 min: ${anonimo.headers['cache-control']}`);
    await eventually(async () => (await storageMetadata(storagePath)) === null, { label: `objeto ${storagePath} removido do bucket`, timeoutMs: 60_000 });
  };

  await soft('A deleta o post pela interface: o post some do Firestore (ou fica marcado como apagado)', async () => {
    check(postId, 'o post não foi criado');
    await A.page.goto(`${BASE_URL}/pt-BR/post/${postId}`, { waitUntil: 'domcontentloaded' });
    await A.page.getByText(postText).first().waitFor({ timeout: 90_000 });
    await A.page.getByRole('button', { name: 'More options' }).first().click();
    A.page.once('dialog', (dialog) => dialog.accept()); // o app pergunta com window.confirm (diálogo nativo)
    await A.page.getByRole('menuitem', { name: /Deletar post/ }).click();
    await eventually(async () => {
      const { doc } = await adminGetDoc(`posts/${postId}`);
      return !doc || doc.isDeleted === true;
    }, { label: 'post removido ou marcado como apagado' });
  });
  await soft('apagar o post TIRA a imagem do ar (410 em /m/<id>) E a apaga do bucket (senão ela fica pública e pagando armazenamento)', async () => {
    check(postMediaId && postStoragePath, 'o post não foi criado');
    await conferirMidiaApagada(postMediaId, postStoragePath, { privada: false });
    check((await storageList(`user_uploads/${A.uid}/postMedia/images/`)).length === 0, 'sobrou objeto de imagem de post no bucket');
  }, { tag: 'privacidade' });

  // Post que já recebeu comentário não é apagado de vez: vira um "túmulo" (isDeleted) sem o conteúdo. A mídia também
  // precisa sair: o registro, o objeto no bucket e a lista de URLs no documento.
  await soft('post com resposta: apagar deixa um "túmulo" sem texto nem lista de mídia, e a imagem sai do ar e do bucket', async () => {
    const text = `Post com imagem e resposta ${stamp}`;
    await A.page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await A.page.getByRole('button', { name: 'Postar', exact: true }).first().click();
    const dialog = A.page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByPlaceholder('E aí?').fill(text);
    await dialog.locator('input[type=file]').first().setInputFiles({ name: 'foto-2.png', mimeType: 'image/png', buffer: makePng(200, 120, [30, 160, 90]) });
    await dialog.locator('img').first().waitFor({ timeout: 30_000 });
    await dialog.locator('[data-status="uploading"]').waitFor({ state: 'detached', timeout: 60_000 });
    await dialog.getByRole('button', { name: 'Postar', exact: true }).click();
    await A.page.getByText('Post Enviado!').first().waitFor({ timeout: 90_000 });
    const post = await eventually(
      async () => (await adminFind('posts', { userId: A.uid })).find((p) => String(p.text).includes(text)),
      { label: 'segundo post com imagem' },
    );
    const mediaId = mediaIdFromUrl(post.media?.[0]?.url);
    check(mediaId, `o segundo post não guarda uma URL /m/<id>: ${JSON.stringify(post.media)}`);
    const { doc: registro } = await adminGetDoc(`media/${mediaId}`);
    check((await lerMidia(BASE_URL, mediaId)).status === 200, 'a imagem do segundo post não era servida antes de apagar');
    await fsCall('PATCH', `posts/${post.__id}`, { token: 'owner', query: 'updateMask.fieldPaths=commentsCount', body: { fields: { commentsCount: { integerValue: '1' } } } });
    await A.page.goto(`${BASE_URL}/pt-BR/post/${post.__id}`, { waitUntil: 'domcontentloaded' });
    await A.page.getByText(text).first().waitFor({ timeout: 90_000 });
    await A.page.getByRole('button', { name: 'More options' }).first().click();
    A.page.once('dialog', (confirm) => confirm.accept());
    await A.page.getByRole('menuitem', { name: /Deletar post/ }).click();
    const tomb = await eventually(async () => {
      const { doc } = await adminGetDoc(`posts/${post.__id}`);
      return doc?.isDeleted === true ? doc : null;
    }, { label: 'post marcado como apagado (túmulo)' });
    check(tomb.text === null || tomb.text === undefined, 'o túmulo ainda guarda o texto');
    check(!tomb.media || tomb.media.length === 0, `o túmulo ainda guarda a lista de mídia: ${JSON.stringify(tomb.media)}`);
    await conferirMidiaApagada(mediaId, registro.storagePath, { privada: false });
  }, { tag: 'privacidade' });

  await soft('A apaga a mensagem com anexo pela interface: o anexo sai do ar (404 para dono e participante) e do bucket', async () => {
    check(dmMediaId && dmStoragePath, 'a mensagem não foi criada');
    await A.page.goto(`${BASE_URL}/pt-BR/messages/user/${B.uid}`, { waitUntil: 'domcontentloaded' });
    const bolha = A.page.locator('[id^="message-bubble-"]').filter({ hasText: dmText }).first();
    await bolha.waitFor({ timeout: 90_000 });
    await bolha.hover();
    await bolha.locator('button[aria-haspopup="menu"]').first().click();
    await A.page.getByRole('menuitem', { name: 'Apagar' }).click();
    await A.page.getByRole('alertdialog').getByRole('button', { name: 'Apagar' }).click();
    await bolha.waitFor({ state: 'detached', timeout: 30_000 });
    await conferirMidiaApagada(dmMediaId, dmStoragePath, { privada: true });
    const cookies = { a: await cookieDeSessao(A.context), b: await cookieDeSessao(B.context) };
    check((await lerMidia(BASE_URL, dmMediaId, { privada: true, cookie: cookies.a })).status === 404, 'o dono ainda lê o anexo da mensagem apagada');
    check((await lerMidia(BASE_URL, dmMediaId, { privada: true, cookie: cookies.b })).status === 404, 'o participante ainda lê o anexo da mensagem apagada');
  }, { tag: 'privacidade' });
}
