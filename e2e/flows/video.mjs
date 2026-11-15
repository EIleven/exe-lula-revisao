/**
 * Seção "video": tudo o que dá para provar do pipeline de vídeo SEM o Cloud Run, executado de verdade contra o app e os
 * emuladores. O que fica de fora (a transcodificação com FFmpeg e a chamada ao Cloud Run Job) só existe na nuvem e é
 * conferido no teste real de produção.
 *
 *  - /api/media/video/init: autenticação, validação (tipo, tamanho, duração, caminho) e os registros que cria;
 *  - /m e /mp enquanto o vídeo processa (425 + progresso) e quando falha (422), sem vazar nada a quem não pode ver;
 *  - regras do Storage de video_staging/: o que é permitido e, sobretudo, o que é NEGADO (outra conta, metadado errado,
 *    tipo errado, arquivo vazio, anônimo, e-mail não confirmado, leitura e listagem);
 *  - o gatilho onVideoSourceUploaded real: confere dono e metadados, enfileira e, sem Cloud Run, volta a "queued";
 *  - apagar o conteúdo cancela o vídeo ainda não processado e apaga a fonte transitória.
 */
import {
  adminFind,
  adminGetDoc,
  cookieDeSessao,
  eventually,
  fsDelete,
  fsSet,
  isPrivateMediaPath,
  isPublicMediaUrl,
  lerMidia,
  signUpUnverified,
  storageDelete,
  storageList,
  storageMetadata,
  storageRead,
  storageUploadResumable,
} from '../lib/harness.mjs';

const ID22 = /^[A-Za-z0-9_-]{22}$/;

export async function run(ctx) {
  const { runner, users, BASE_URL, stamp, token } = ctx;
  const { a: A, b: B, c: C } = users;
  const { section, soft, check } = runner;
  const tokenA = await token(A);
  const tokenB = await token(B);
  const init = (corpo, tk = tokenA) => fetch(`${BASE_URL}/api/media/video/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
  const caminhoPost = (uid, nome) => `user_uploads/${uid}/postMedia/videos/${nome}`;

  // ---------------------------------------------------------------------------------------------------------------
  const stagingAntes = new Set(await storageList('video_staging/'));
  section('vídeo: início do envio (/api/media/video/init)');
  await soft('recusa sem login, corpo inválido, tipo que não é vídeo, tamanho inválido e vídeo longo demais', async () => {
    const base = { storagePath: caminhoPost(A.uid, `v-${stamp}.mp4`), contentType: 'video/mp4', size: 1000, durationSeconds: 12 };
    const casos = [
      ['sem token', () => init(base, null), 401],
      ['token inválido', () => init(base, 'isto.nao.e.um.token'), 401],
      ['corpo que não é JSON', () => init('{nao-json'), 400],
      ['tipo que não é vídeo', () => init({ ...base, contentType: 'image/png' }), 415],
      ['tipo ausente', () => init({ ...base, contentType: undefined }), 415],
      ['tamanho zero', () => init({ ...base, size: 0 }), 400],
      ['tamanho negativo', () => init({ ...base, size: -5 }), 400],
      ['tamanho fracionário', () => init({ ...base, size: 10.5 }), 400],
      ['tamanho em texto', () => init({ ...base, size: 'grande' }), 400],
      ['duração acima de 2h50', () => init({ ...base, durationSeconds: 10_201 }), 422],
      ['duração zero', () => init({ ...base, durationSeconds: 0 }), 422],
      ['caminho de OUTRA conta', () => init({ ...base, storagePath: caminhoPost(B.uid, 'v.mp4') }), 400],
      ['caminho com ..', () => init({ ...base, storagePath: `user_uploads/${A.uid}/postMedia/videos/../../x.mp4` }), 400],
      ['pasta de imagens com tipo de vídeo', () => init({ ...base, storagePath: `user_uploads/${A.uid}/postMedia/images/v.mp4` }), 400],
      ['pasta fora da lista', () => init({ ...base, storagePath: `user_uploads/${A.uid}/qualquer/v.mp4` }), 400],
      ['sem caminho', () => init({ ...base, storagePath: undefined }), 400],
    ];
    const registrosAntes = (await adminFind('videoUploads', { ownerUid: A.uid })).length;
    for (const [nome, chamar, esperado] of casos) {
      const r = await chamar();
      check(r.status === esperado, `${nome}: respondeu ${r.status} (esperado ${esperado})`);
    }
    check((await adminFind('videoUploads', { ownerUid: A.uid })).length === registrosAntes, 'uma recusa deixou registro videoUploads para trás');
  }, { tag: 'privacidade' });

  let post;
  let dm;
  await soft('aceita vídeo de post, de mensagem e de arquivo pessoal: cria media/<id> e videoUploads/<id> no estado "uploading"', async () => {
    const pedido = (storagePath) => init({ storagePath, contentType: 'video/mp4', size: 2048, durationSeconds: 7.5 });
    const r1 = await pedido(caminhoPost(A.uid, `clipe-${stamp}.mp4`));
    post = await r1.json();
    check(r1.status === 201 && ID22.test(post.mediaId), `post: ${r1.status} ${JSON.stringify(post)}`);
    check(post.sourcePath === `video_staging/${A.uid}/${post.mediaId}/source`, `sourcePath = ${post.sourcePath}`);
    check(post.filePath.startsWith(`user_uploads/${A.uid}/postMedia/videos/`) && post.filePath.endsWith(`/${post.mediaId}.mp4`), `filePath = ${post.filePath}`);
    check(isPublicMediaUrl(post.downloadURL), `post: downloadURL deveria ser /m/<id> público: ${post.downloadURL}`);
    check(post.status === 'uploading', `status = ${post.status}`);

    const r2 = await pedido(`user_uploads/${A.uid}/dms/videos/anexo-${stamp}.mp4`);
    dm = await r2.json();
    check(r2.status === 201 && isPrivateMediaPath(dm.downloadURL), `mensagem: ${r2.status} downloadURL ${dm.downloadURL} (deveria ser /mp/<id> privado)`);
    const r3 = await pedido(`user_uploads/${A.uid}/user_files/video-${stamp}.mp4`);
    const arquivo = await r3.json();
    check(r3.status === 201 && isPrivateMediaPath(arquivo.downloadURL), `arquivo pessoal: ${r3.status} downloadURL ${arquivo.downloadURL}`);

    const { doc: media } = await adminGetDoc(`media/${post.mediaId}`);
    check(media?.ownerUid === A.uid && media.kind === 'postMedia' && media.visibility === 'public', `media: ${media?.ownerUid} ${media?.kind}/${media?.visibility}`);
    check(media.processingStatus === 'uploading' && media.contentType === 'video/mp4' && media.size === 0, `media: ${media.processingStatus} ${media.contentType} size ${media.size} (o tamanho final só existe depois do FFmpeg)`);
    check(media.storagePath === post.filePath, `storagePath (${media.storagePath}) != filePath (${post.filePath})`);
    const { doc: envio } = await adminGetDoc(`videoUploads/${post.mediaId}`);
    check(envio?.status === 'uploading' && envio.ownerUid === A.uid && envio.sourcePath === post.sourcePath && envio.outputPath === post.filePath, `videoUploads: ${JSON.stringify(envio)}`);
    check(envio.sourceSize === 2048 && envio.clientDurationSeconds === 7.5 && envio.attempts === 0, `videoUploads: sourceSize ${envio.sourceSize} duração ${envio.clientDurationSeconds} tentativas ${envio.attempts}`);
    const { doc: mDm } = await adminGetDoc(`media/${dm.mediaId}`);
    check(mDm?.kind === 'dm' && mDm.visibility === 'private', `media da mensagem: ${mDm?.kind}/${mDm?.visibility}`);
  });
  await soft('/m e /mp enquanto o vídeo processa: 425 com progresso e Retry-After; falhou: 422; sem vazar nada a quem não pode ver', async () => {
    check(post && dm, 'o início do envio não passou');
    const marcar = (mediaId, campos) => fsSet(`media/${mediaId}`, campos, 'owner');
    const cookieA = await cookieDeSessao(A.context);
    const cookieC = await cookieDeSessao(C.context); // de fora: nunca conversou com A (B conversa com A em outras seções)
    const { doc: base } = await adminGetDoc(`media/${post.mediaId}`);
    for (const [estado, progresso] of [['uploading', 0], ['queued', 0], ['dispatching', 0], ['dispatched', 0], ['processing', 41]]) {
      await marcar(post.mediaId, { ...base, processingStatus: estado, processingProgress: progresso });
      const r = await lerMidia(BASE_URL, post.mediaId);
      check(r.status === 425, `/m com estado ${estado} respondeu ${r.status} (esperado 425 Too Early)`);
      check(r.headers['retry-after'] === '8' && r.headers['x-media-status'] === estado && r.headers['x-media-progress'] === String(progresso), `cabeçalhos com ${estado}: retry-after ${r.headers['retry-after']}, status ${r.headers['x-media-status']}, progresso ${r.headers['x-media-progress']}`);
      check(r.headers['cache-control'] === 'no-store', `um 425 não pode ser cacheado: ${r.headers['cache-control']}`);
    }
    await marcar(post.mediaId, { ...base, processingStatus: 'failed' });
    const falhou = await lerMidia(BASE_URL, post.mediaId);
    check(falhou.status === 422 && falhou.headers['x-media-status'] === 'failed', `/m de vídeo que falhou respondeu ${falhou.status}`);

    const { doc: baseDm } = await adminGetDoc(`media/${dm.mediaId}`);
    await marcar(dm.mediaId, { ...baseDm, processingStatus: 'processing', processingProgress: 70 });
    const dono = await lerMidia(BASE_URL, dm.mediaId, { privada: true, cookie: cookieA });
    check(dono.status === 425 && dono.headers['x-media-progress'] === '70', `/mp do dono com vídeo processando respondeu ${dono.status}`);
    check(/no-store/.test(dono.headers['cache-control'] ?? ''), `o 425 privado precisa de no-store: ${dono.headers['cache-control']}`);
    check((await lerMidia(BASE_URL, dm.mediaId, { privada: true })).status === 404, 'anônimo soube que o vídeo privado existe e está processando');
    check((await lerMidia(BASE_URL, dm.mediaId, { privada: true, cookie: cookieC })).status === 404, 'um terceiro (sem conversa com a dona) soube que o vídeo privado existe e está processando');
    check((await lerMidia(BASE_URL, dm.mediaId)).status === 404, 'o vídeo privado respondeu algo na rota pública /m');
    await marcar(dm.mediaId, { ...baseDm, processingStatus: 'failed' });
    check((await lerMidia(BASE_URL, dm.mediaId, { privada: true, cookie: cookieA })).status === 422, 'o dono não vê que o vídeo falhou');
    check((await lerMidia(BASE_URL, dm.mediaId, { privada: true, cookie: cookieC })).status === 404, 'um terceiro (sem conversa com a dona) soube que o vídeo privado falhou');
    // volta ao estado inicial para os próximos testes
    await marcar(post.mediaId, { ...base, processingStatus: 'uploading', processingProgress: 0 });
  }, { tag: 'privacidade' });

  // ---------------------------------------------------------------------------------------------------------------
  section('vídeo: regras do Storage em video_staging/ (o que é negado importa mais que o que é permitido)');
  const bytes = Buffer.from('conteúdo de teste de um vídeo (não é um vídeo de verdade)');
  const novoId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.replace(/[^A-Za-z0-9]/g, '').padEnd(22, 'x').slice(0, 22);
  const staging = (uid, id) => `video_staging/${uid}/${id}/source`;
  const meta = (id, extra = {}) => ({ mediaId: id, pipeline: 'ffmpeg-v1', ...extra });
  let idPermitido;
  await soft('permite SÓ o envio da própria pessoa, com id de 22 caracteres, metadados corretos, tipo de vídeo e conteúdo', async () => {
    const naoVerificada = await signUpUnverified();
    const id = novoId();
    const negados = [
      ['outra conta (A grava na pasta de B)', () => storageUploadResumable(staging(B.uid, id), bytes, 'video/mp4', meta(id), tokenA)],
      ['anônimo', () => storageUploadResumable(staging(A.uid, id), bytes, 'video/mp4', meta(id), undefined)],
      ['e-mail não confirmado (sem o claim member)', () => storageUploadResumable(staging(naoVerificada.uid, id), bytes, 'video/mp4', meta(id), naoVerificada.idToken)],
      ['pipeline diferente de ffmpeg-v1', () => storageUploadResumable(staging(A.uid, id), bytes, 'video/mp4', meta(id, { pipeline: 'outro' }), tokenA)],
      ['sem o metadado pipeline', () => storageUploadResumable(staging(A.uid, id), bytes, 'video/mp4', { mediaId: id }, tokenA)],
      ['metadado mediaId diferente do caminho', () => storageUploadResumable(staging(A.uid, id), bytes, 'video/mp4', meta(novoId()), tokenA)],
      ['tipo que não é vídeo', () => storageUploadResumable(staging(A.uid, id), bytes, 'image/png', meta(id), tokenA)],
      ['arquivo vazio', () => storageUploadResumable(staging(A.uid, id), Buffer.alloc(0), 'video/mp4', meta(id), tokenA)],
      ['id curto demais', () => storageUploadResumable(staging(A.uid, 'curto'), bytes, 'video/mp4', meta('curto'), tokenA)],
      ['id longo demais', () => storageUploadResumable(staging(A.uid, `${id}x`), bytes, 'video/mp4', meta(`${id}x`), tokenA)],
      ['id com caractere inválido', () => storageUploadResumable(staging(A.uid, `${id.slice(0, 21)}!`), bytes, 'video/mp4', meta(`${id.slice(0, 21)}!`), tokenA)],
      ['nome diferente de source', () => storageUploadResumable(`video_staging/${A.uid}/${id}/outro`, bytes, 'video/mp4', meta(id), tokenA)],
    ];
    const objetosAntes = new Set(await storageList('video_staging/'));
    for (const [nome, tentar] of negados) {
      const r = await tentar();
      check(r.status === 401 || r.status === 403, `${nome}: o Storage respondeu ${r.status} na etapa ${r.etapa} (esperado 401/403)`);
    }
    const novos = (await storageList('video_staging/')).filter((o) => !objetosAntes.has(o));
    check(novos.length === 0, 'uma tentativa negada deixou objeto no bucket: ' + novos.join(', '));

    idPermitido = post.mediaId; // o id que o init reservou para A: o envio legítimo
    const ok = await storageUploadResumable(staging(A.uid, idPermitido), bytes, 'video/mp4', meta(idPermitido), tokenA);
    check(ok.status === 200, `o envio legítimo respondeu ${ok.status} na etapa ${ok.etapa}`);
    const objeto = await storageMetadata(staging(A.uid, idPermitido));
    check(objeto?.contentType === 'video/mp4' && Number(objeto.size) === bytes.length, `objeto gravado: ${objeto?.contentType} ${objeto?.size}`);
  }, { tag: 'privacidade' });
  await soft('a fonte é ILEGÍVEL e não listável para qualquer conta, inclusive a dona; só a dona apaga', async () => {
    check(idPermitido, 'o envio legítimo não aconteceu');
    const nome = staging(A.uid, idPermitido);
    for (const [quem, tk] of [['a dona', tokenA], ['outra conta', tokenB], ['anônimo', undefined]]) {
      const leitura = await storageRead(nome, tk);
      check(leitura.status === 401 || leitura.status === 403, `${quem} leu a fonte transitória: HTTP ${leitura.status} (a fonte só pode ser lida pelo worker)`);
    }
    for (const [quem, tk] of [['a dona', tokenA], ['outra conta', tokenB]]) {
      const lista = await fetch(`http://127.0.0.1:9199/v0/b/demo-soberan.appspot.com/o?prefix=${encodeURIComponent(`video_staging/${A.uid}/`)}`, { headers: { Authorization: `Firebase ${tk}` } });
      check(lista.status === 401 || lista.status === 403, `${quem} listou video_staging: HTTP ${lista.status}`);
    }
    check([401, 403].includes((await storageDelete(nome, tokenB)).status), 'outra conta conseguiu apagar a fonte de A');
    check((await storageMetadata(nome)) !== null, 'a fonte sumiu depois de uma tentativa negada de apagar');
    // a dona pode apagar (cancelar o próprio envio): usa outro objeto, para não gastar o do próximo teste
    const outro = novoId();
    await storageUploadResumable(staging(A.uid, outro), bytes, 'video/mp4', meta(outro), tokenA);
    const apagou = await storageDelete(staging(A.uid, outro), tokenA);
    check(apagou.status === 200 || apagou.status === 204, `a dona não conseguiu apagar a própria fonte: HTTP ${apagou.status}`);
  }, { tag: 'privacidade' });

  // ---------------------------------------------------------------------------------------------------------------
  section('vídeo: gatilho onVideoSourceUploaded (real, no emulador) e cancelamento ao apagar');
  await soft('com registro e dono corretos o gatilho enfileira; sem Cloud Run o envio volta a "queued" com o erro registrado e sem reserva presa', async () => {
    check(idPermitido, 'o envio legítimo não aconteceu');
    const envio = await eventually(async () => {
      const { doc } = await adminGetDoc(`videoUploads/${idPermitido}`);
      return doc?.status === 'queued' && doc.lastDispatchError ? doc : null;
    }, { label: 'videoUploads em queued com o erro de despacho', timeoutMs: 60_000 });
    check(envio.uploadedSize === bytes.length, `uploadedSize = ${envio.uploadedSize} (esperado ${bytes.length})`);
    check(envio.lastDispatchError === 'worker-start-failed', `lastDispatchError = ${envio.lastDispatchError}`);
    check(!envio.dispatchLeaseUntil, 'a reserva (lease) ficou presa depois da falha: o varredor não poderia retomar');
    check(envio.attempts === 0, `attempts = ${envio.attempts} (só conta quando o worker de fato inicia)`);
    const { doc: media } = await adminGetDoc(`media/${idPermitido}`);
    check(media.processingStatus === 'queued', `media.processingStatus = ${media.processingStatus}`);
  });
  await soft('registro de OUTRA pessoa no mesmo id: o gatilho recusa (source-metadata-mismatch) e não inicia worker; sem registro nenhum, ignora', async () => {
    const idX = novoId();
    await fsSet(`media/${idX}`, { ownerUid: B.uid, kind: 'postMedia', visibility: 'public', storagePath: `user_uploads/${B.uid}/postMedia/videos/${idX}.mp4`, contentType: 'video/mp4', size: 0, processingStatus: 'uploading' }, 'owner');
    await fsSet(`videoUploads/${idX}`, { mediaId: idX, ownerUid: B.uid, kind: 'postMedia', visibility: 'public', sourcePath: staging(A.uid, idX), outputPath: `user_uploads/${B.uid}/postMedia/videos/${idX}.mp4`, status: 'uploading', attempts: 0 }, 'owner');
    const r = await storageUploadResumable(staging(A.uid, idX), bytes, 'video/mp4', meta(idX), tokenA);
    check(r.status === 200, `a regra do Storage (que não conhece o registro) deveria permitir: HTTP ${r.status}`);
    const recusado = await eventually(async () => {
      const { doc } = await adminGetDoc(`videoUploads/${idX}`);
      return doc?.status === 'failed' ? doc : null;
    }, { label: 'videoUploads marcado como failed', timeoutMs: 60_000 });
    check(recusado.errorCode === 'source-metadata-mismatch', `errorCode = ${recusado.errorCode}`);
    check((await adminGetDoc(`media/${idX}`)).doc?.processingStatus === 'failed', 'a mídia não foi marcada como failed');

    const semRegistro = novoId();
    await storageUploadResumable(staging(A.uid, semRegistro), bytes, 'video/mp4', meta(semRegistro), tokenA);
    await new Promise((resolve) => setTimeout(resolve, 8000));
    check((await adminGetDoc(`videoUploads/${semRegistro}`)).status === 404, 'o gatilho CRIOU um registro para uma fonte que ninguém reservou');
    check((await adminGetDoc(`media/${semRegistro}`)).status === 404, 'o gatilho CRIOU uma mídia para uma fonte que ninguém reservou');
  }, { tag: 'privacidade' });
  await soft('apagar o post que cita o vídeo cancela o envio ainda não processado, tomba a mídia e apaga a fonte transitória', async () => {
    check(idPermitido, 'o envio legítimo não aconteceu');
    const urlPublica = `https://media.exercitodolula.app/m/${idPermitido}`;
    const postId = `video-${stamp}`;
    await fsSet(`posts/${postId}`, { userId: A.uid, text: 'post com vídeo ainda processando', media: [{ url: urlPublica, type: 'video' }], hasMedia: true, type: 'original', category: 'echo', visibility: 'public', isDeleted: false, likes: 0, reposts: 0, commentsCount: 0 }, 'owner');
    check((await storageMetadata(staging(A.uid, idPermitido))) !== null, 'a fonte não estava no bucket antes de apagar');
    await fsDelete(`posts/${postId}`, 'owner');
    await eventually(async () => Boolean((await adminGetDoc(`media/${idPermitido}`)).doc?.deletedAt), { label: 'media com deletedAt', timeoutMs: 60_000 });
    // O tombstone é escrito antes do cancelamento do upload; esperar só o primeiro tornava esta asserção uma corrida.
    const envio = await eventually(async () => {
      const atual = (await adminGetDoc(`videoUploads/${idPermitido}`)).doc;
      return atual?.status === 'cancelled' ? atual : null;
    }, { label: 'videoUploads cancelado', timeoutMs: 60_000 });
    check(envio.status === 'cancelled', 'videoUploads.status = cancelled: o varredor não retoma o que foi apagado');
    await eventually(async () => (await storageMetadata(staging(A.uid, idPermitido))) === null, { label: 'fonte transitória apagada', timeoutMs: 60_000 });
    const lido = await lerMidia(BASE_URL, idPermitido);
    check(lido.status === 410, `/m do vídeo apagado respondeu ${lido.status} (esperado 410)`);
  }, { tag: 'privacidade' });

  // Limpeza: o teste apaga o que criou em video_staging/ (o emulador guarda estado entre execuções).
  for (const objeto of await storageList('video_staging/')) if (!stagingAntes.has(objeto)) await storageDelete(objeto, 'owner');
}
