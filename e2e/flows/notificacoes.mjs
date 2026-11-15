/**
 * Seção "notificacoes": o aviso (push) de CADA ação que notifica, ponta a ponta nos emuladores.
 *
 * Três partes:
 *  1. Aparelhos: as regras deixam só o dono guardar e ler os tokens de push (users/{uid}/fcmTokens), com campos fixos.
 *     (Sem a regra o app não conseguia nem guardar o token: negado por padrão, e nenhum push chegou a ninguém.)
 *  2. Mensagens: para cada ação (curtir, comentar, responder, repostar, citar, mencionar, seguir, mensagem direta) a
 *     Function onNotificationCreatedSendPush monta o aviso certo para CADA idioma dos aparelhos de quem recebe. Nos
 *     emuladores não existe FCM: a Function guarda o que SERIA enviado em _pushOutbox, e aqui se confere texto, destino
 *     do toque e ajustes de Android e navegador. A criação da notificação em si (tela, contador) é coberta pelas seções
 *     social, interacoes e mensagens.
 *  3. Regras do envio: notificação agregada (várias mensagens seguidas, várias curtidas) reenvia o aviso quando deve
 *     (toda mensagem; curtidas só nas marcas 5, 10, 25...), "nova conversa" não avisa, quem não tem aparelho não
 *     recebe nada e a preferência desligada em Configurações vale também para o push.
 *
 * B é quem recebe os avisos (com um aparelho web em português e um Android em inglês); A é quem age.
 */
import { adminFind, adminGetDoc, createPostViaUi, eventually, fsCall, fsDelete, fsGetDoc, fsList, fsSet, fsUpdate } from '../lib/harness.mjs';

const denied = (response) => response.status === 401 || response.status === 403;
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function run(ctx) {
  const { runner, users, BASE_URL, stamp } = ctx;
  const { a: A, b: B, c: C } = users;
  const { section, step, soft, check } = runner;
  const tokenA = await ctx.token(A);
  const tokenB = await ctx.token(B);
  const web = `web-${'w'.repeat(70)}-${stamp}`;
  const android = `android-${'a'.repeat(70)}-${stamp}`;
  const tokenDoc = (platform, locale, extra = {}) => ({ platform, locale, registeredAt: new Date(), updatedAt: new Date(), ...extra });
  const now = () => new Date();
  const identidade = (user) => ({ userId: user.uid, name: user.name, username: user.username, avatarUrl: '/profile.png' });
  const postBase = (user, extra) => ({ userId: user.uid, category: 'echo', visibility: 'public', authorDetails: identidade(user), likes: 0, reposts: 0, quotesCount: 0, commentsCount: 0, views: 0, isDeleted: false, createdAt: now(), ...extra });
  const commentBase = (user, postId, extra) => ({ userId: user.uid, parentPostId: postId, postAuthorId: B.uid, postVisibility: 'public', likes: 0, repliesCount: 0, repostsCount: 0, isDeleted: false, createdAt: now(), authorDetails: identidade(user), ...extra });

  // ---------------------------------------------------------------------------------------------------------------
  section('notificacoes: aparelhos (tokens de push) e regras');
  await soft('B guarda os tokens dos seus aparelhos (web em português e Android em inglês) e consegue lê-los', async () => {
    const a = await fsSet(`users/${B.uid}/fcmTokens/${web}`, tokenDoc('web', 'pt-BR', { userAgent: 'e2e-chrome' }), tokenB);
    const b = await fsSet(`users/${B.uid}/fcmTokens/${android}`, tokenDoc('android', 'en'), tokenB);
    check(a.status === 200 && b.status === 200, `gravar tokens -> HTTP ${a.status} / ${b.status}`);
    const lista = await fsList(`users/${B.uid}/fcmTokens`, tokenB);
    check(lista.status === 200 && lista.docs.length === 2, `B lê os próprios tokens: HTTP ${lista.status}, ${lista.docs?.length} documentos`);
  }, { tag: 'funcional' });

  await soft('os tokens de B são só de B: outra conta não lê, não grava e não apaga', async () => {
    check(denied(await fsCall('GET', `users/${B.uid}/fcmTokens/${web}`, { token: tokenA })), 'A leu o token de B');
    check(denied(await fsSet(`users/${B.uid}/fcmTokens/${'z'.repeat(60)}`, tokenDoc('web', 'pt-BR'), tokenA)), 'A gravou um token na conta de B');
    check(denied(await fsDelete(`users/${B.uid}/fcmTokens/${web}`, tokenA)), 'A apagou o token de B');
    check(denied(await fsCall('GET', `users/${B.uid}/fcmTokens/${web}`, {})), 'sem login leu o token de B');
    check((await fsGetDoc(`users/${B.uid}/fcmTokens/${web}`, 'owner')).doc, 'o token de B sumiu depois das tentativas de A');
  }, { tag: 'seg' });

  await soft('só campos e valores válidos: plataforma desconhecida, campo extra, idioma estranho e id curto são recusados', async () => {
    const id = `${'q'.repeat(60)}-${stamp}`;
    check(denied(await fsSet(`users/${B.uid}/fcmTokens/${id}`, tokenDoc('smart-tv', 'pt-BR'), tokenB)), 'plataforma desconhecida aceita');
    check(denied(await fsSet(`users/${B.uid}/fcmTokens/${id}`, { ...tokenDoc('web', 'pt-BR'), isAdmin: true }, tokenB)), 'campo extra aceito');
    check(denied(await fsSet(`users/${B.uid}/fcmTokens/${id}`, tokenDoc('web', 'fr'), tokenB)), 'idioma fora de pt-BR/en aceito');
    check(denied(await fsSet(`users/${B.uid}/fcmTokens/curto`, tokenDoc('web', 'pt-BR'), tokenB)), 'id curto demais aceito');
    check(!(await fsGetDoc(`users/${B.uid}/fcmTokens/${id}`, 'owner')).doc, 'um token inválido foi gravado mesmo assim');
  }, { tag: 'seg' });

  // ---------------------------------------------------------------------------------------------------------------
  section('notificacoes: o que cada ação envia (texto, idioma e destino do toque)');
  let postId;
  let commentB;
  const quoteId = `qa_${stamp}`;

  await step('B publica o post que A vai curtir, comentar, repostar e citar', async () => {
    await B.page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await createPostViaUi(B.page, `Post de B para os avisos ${stamp}`);
    postId = (await eventually(async () => (await adminFind('posts', { userId: B.uid })).find((p) => String(p.text).includes(`avisos ${stamp}`)), { label: 'post de B' })).__id;
    return `post ${postId}`;
  });

  /**
   * Espera o que a Function GUARDARIA para enviar a B e devolve as mensagens por idioma (pt = aparelho web em português,
   * en = aparelho Android em inglês). `filtro` escolhe uma entrega específica (por exemplo, pelo contador).
   */
  const esperarEnvio = async (tipo, filtro = () => true) => {
    const entrega = await eventually(async () => (await adminFind('_pushOutbox', { recipientId: B.uid, type: tipo })).find(filtro), { label: `envio de push "${tipo}"`, timeoutMs: 45_000 });
    const mensagens = entrega.messages ?? [];
    return {
      entrega,
      pt: mensagens.find((m) => m.tokens?.includes(web)),
      en: mensagens.find((m) => m.tokens?.includes(android)),
      todas: mensagens,
    };
  };
  const conferir = (envio, { tituloPt, textoPt, textoEn, caminho }) => {
    check(envio.todas.length === 2, `esperava 2 mensagens (uma por idioma), vieram ${envio.todas.length}`);
    check(envio.pt?.notification?.title === tituloPt, `título pt: "${envio.pt?.notification?.title}" (esperado "${tituloPt}")`);
    check(envio.pt?.notification?.body === textoPt, `texto pt: "${envio.pt?.notification?.body}" (esperado "${textoPt}")`);
    check(envio.en?.notification?.body === textoEn, `texto en: "${envio.en?.notification?.body}" (esperado "${textoEn}")`);
    check(envio.pt?.data?.path === caminho, `destino pt: ${envio.pt?.data?.path} (esperado ${caminho})`);
    check(envio.en?.data?.path === caminho.replace('/pt-BR/', '/en/'), `destino en: ${envio.en?.data?.path}`);
    check(envio.pt?.data?.url?.endsWith(caminho), `url completa: ${envio.pt?.data?.url}`);
    check(envio.pt?.android?.notification?.channelId === 'exelula_default' && envio.pt?.android?.priority === 'high', 'ajustes de Android faltando');
    check(envio.pt?.webpush?.fcmOptions?.link === envio.pt?.data?.url, 'o link do navegador não é o destino do toque');
  };

  await soft('A curte o post de B: "curtiu sua publicação" nos dois idiomas, abrindo o post', async () => {
    await fsSet(`posts/${postId}/likes/${A.uid}`, { userId: A.uid, createdAt: now() }, 'owner');
    conferir(await esperarEnvio('like_post'), {
      tituloPt: 'Nova curtida', textoPt: `${A.name} curtiu sua publicação.`, textoEn: `${A.name} liked your post.`, caminho: `/pt-BR/post/${postId}`,
    });
  }, { tag: 'funcional' });

  await soft('A comenta no post de B: o aviso mostra um trecho do comentário e abre o post', async () => {
    await fsSet(`posts/${postId}/comments/ca_${stamp}`, commentBase(A, postId, { text: 'Que ideia boa!' }), 'owner');
    conferir(await esperarEnvio('comment_on_post'), {
      tituloPt: 'Novo comentário', textoPt: `${A.name} comentou na sua publicação. “Que ideia boa!”`, textoEn: `${A.name} commented on your post. “Que ideia boa!”`, caminho: `/pt-BR/post/${postId}`,
    });
  }, { tag: 'funcional' });

  await step('B comenta no próprio post (para A responder e curtir esse comentário)', async () => {
    commentB = `cb_${stamp}`;
    await fsSet(`posts/${postId}/comments/${commentB}`, commentBase(B, postId, { text: 'Comentário de B' }), 'owner');
    return commentB;
  });

  await soft('A responde ao comentário de B: o toque abre o post NA ALTURA do comentário (#comment-...)', async () => {
    await fsSet(`posts/${postId}/comments/ra_${stamp}`, commentBase(A, postId, { parentCommentId: commentB, text: 'Concordo plenamente' }), 'owner');
    conferir(await esperarEnvio('reply_to_comment'), {
      tituloPt: 'Nova resposta', textoPt: `${A.name} respondeu ao seu comentário. “Concordo plenamente”`, textoEn: `${A.name} replied to your comment. “Concordo plenamente”`, caminho: `/pt-BR/post/${postId}#comment-${commentB}`,
    });
  }, { tag: 'funcional' });

  await soft('A curte o comentário de B: abre o comentário', async () => {
    await fsSet(`posts/${postId}/comments/${commentB}/likes/${A.uid}`, { userId: A.uid, createdAt: now() }, 'owner');
    const envio = await esperarEnvio('like_comment');
    check(envio.pt?.data?.path === `/pt-BR/post/${postId}#comment-${commentB}`, `destino: ${envio.pt?.data?.path}`);
    check(/curtiu seu comentário/.test(envio.pt?.notification?.body ?? ''), `texto: ${envio.pt?.notification?.body}`);
    check(/liked your comment/.test(envio.en?.notification?.body ?? ''), `texto en: ${envio.en?.notification?.body}`);
  }, { tag: 'funcional' });

  await soft('A reposta o post de B: "repostou sua publicação"', async () => {
    await fsSet(`posts/${postId}/reposts/${A.uid}`, { userId: A.uid, createdAt: now() }, 'owner');
    conferir(await esperarEnvio('repost', (entrega) => (entrega.messages?.[0]?.data?.path ?? '').endsWith(`/post/${postId}`)), {
      tituloPt: 'Novo repost', textoPt: `${A.name} repostou sua publicação.`, textoEn: `${A.name} reposted your post.`, caminho: `/pt-BR/post/${postId}`,
    });
  }, { tag: 'funcional' });

  await soft('A reposta o COMENTÁRIO de B: o toque abre o comentário (e não um "post" com o id do comentário)', async () => {
    await fsSet(`posts/${postId}/comments/${commentB}/reposts/${A.uid}`, { userId: A.uid, createdAt: now() }, 'owner');
    conferir(await esperarEnvio('repost', (entrega) => (entrega.messages?.[0]?.data?.path ?? '').includes('#comment-')), {
      tituloPt: 'Novo repost', textoPt: `${A.name} repostou seu comentário.`, textoEn: `${A.name} reposted your comment.`, caminho: `/pt-BR/post/${postId}#comment-${commentB}`,
    });
  }, { tag: 'funcional' });

  await soft('A cita o post de B: o aviso traz o texto da citação e o toque abre a CITAÇÃO', async () => {
    await fsSet(`posts/${quoteId}`, postBase(A, { type: 'quote', text: 'Citando com carinho', originalPostDetails: { id: postId, type: 'post', authorDetails: identidade(B) } }), 'owner');
    conferir(await esperarEnvio('quote'), {
      tituloPt: 'Nova citação', textoPt: `${A.name} citou sua publicação. “Citando com carinho”`, textoEn: `${A.name} quoted your post. “Citando com carinho”`, caminho: `/pt-BR/post/${quoteId}`,
    });
  }, { tag: 'funcional' });

  await soft('A menciona B num post: "mencionou você" e abre o post de A', async () => {
    const id = `ma_${stamp}`;
    const texto = `Oi @${B.username} veja isto`;
    await fsSet(`posts/${id}`, postBase(A, { type: 'original', text: texto }), 'owner');
    conferir(await esperarEnvio('mention_in_post'), {
      tituloPt: 'Você foi mencionado(a)', textoPt: `${A.name} mencionou você numa publicação. “${texto}”`, textoEn: `${A.name} mentioned you in a post. “${texto}”`, caminho: `/pt-BR/post/${id}`,
    });
  }, { tag: 'funcional' });

  await soft('A menciona B num comentário: "mencionou você num comentário" e abre o comentário', async () => {
    const id = `mc_${stamp}`;
    const texto = `Olha @${B.username} isso`;
    await fsSet(`posts/${postId}/comments/${id}`, commentBase(A, postId, { text: texto }), 'owner');
    const envio = await esperarEnvio('mention_in_comment');
    check(envio.pt?.data?.path === `/pt-BR/post/${postId}#comment-${id}`, `destino: ${envio.pt?.data?.path}`);
    check(envio.pt?.notification?.body === `${A.name} mencionou você num comentário. “${texto}”`, `texto: ${envio.pt?.notification?.body}`);
    check(envio.en?.notification?.body === `${A.name} mentioned you in a comment. “${texto}”`, `texto en: ${envio.en?.notification?.body}`);
  }, { tag: 'funcional' });

  await soft('A começa a seguir B: "começou a seguir você" e abre o PERFIL de A', async () => {
    await fsSet(`users/${B.uid}/followers/${A.uid}`, { userId: A.uid, createdAt: now() }, 'owner');
    conferir(await esperarEnvio('new_follower'), {
      tituloPt: 'Novo seguidor', textoPt: `${A.name} começou a seguir você.`, textoEn: `${A.name} started following you.`, caminho: `/pt-BR/profile/${A.uid}`,
    });
  }, { tag: 'funcional' });

  // ---------------------------------------------------------------------------------------------------------------
  section('notificacoes: mensagens diretas');
  const conversa = `conv_${stamp}`;
  const mensagem = (n, texto) => fsSet(`conversations/${conversa}/messages/m${n}`, { senderId: A.uid, text: texto, createdAt: now() }, 'owner');

  await soft('abrir o chat com B ("nova conversa") NÃO envia push: ainda não há mensagem para avisar', async () => {
    const [x, y] = [A.uid, B.uid].sort();
    await fsSet(`conversations/${conversa}`, { participantIds: [x, y], createdBy: A.uid, createdAt: now(), lastMessageAt: now(), unreadCounts: { [A.uid]: 0, [B.uid]: 0 } }, 'owner');
    // A notificação "nova conversa" nasce (lista dentro do app); o push, não.
    await eventually(async () => (await adminFind('notifications', { recipientId: B.uid, type: 'new_conversation' })).length > 0, { label: 'notificação "nova conversa"' });
    await esperar(3000);
    const envios = await adminFind('_pushOutbox', { recipientId: B.uid, type: 'new_conversation' });
    check(envios.length === 0, `"nova conversa" gerou ${envios.length} envio(s) de push`);
  }, { tag: 'funcional' });

  await soft('A manda a 1ª mensagem: o título é A e o CONTEÚDO da mensagem não vai no aviso', async () => {
    await mensagem(1, 'TEXTO-SECRETO-DA-MENSAGEM');
    const envio = await esperarEnvio('new_message', (entrega) => entrega.count === 1);
    check(envio.pt?.notification?.title === A.name, `título: ${envio.pt?.notification?.title}`);
    check(envio.pt?.notification?.body === 'Enviou uma mensagem para você', `texto pt: ${envio.pt?.notification?.body}`);
    check(envio.en?.notification?.body === 'Sent you a message', `texto en: ${envio.en?.notification?.body}`);
    check(envio.pt?.data?.path === `/pt-BR/messages/user/${A.uid}`, `destino: ${envio.pt?.data?.path}`);
    check(!JSON.stringify(envio.todas).includes('TEXTO-SECRETO'), 'o conteúdo da mensagem vazou para o aviso');
    check(envio.pt?.webpush?.headers?.Urgency === 'high', 'mensagem direta deveria ser entrega urgente');
  }, { tag: 'seg' });

  await soft('a 2ª e a 3ª mensagem seguidas (a notificação só é ATUALIZADA) avisam de novo, com a contagem certa', async () => {
    await mensagem(2, 'segunda');
    const segunda = await esperarEnvio('new_message', (entrega) => entrega.count === 2);
    check(segunda.pt?.notification?.body === '2 novas mensagens', `2ª (pt): ${segunda.pt?.notification?.body}`);
    check(segunda.en?.notification?.body === '2 new messages', `2ª (en): ${segunda.en?.notification?.body}`);
    await mensagem(3, 'terceira');
    const terceira = await esperarEnvio('new_message', (entrega) => entrega.count === 3);
    check(terceira.pt?.notification?.body === '3 novas mensagens', `3ª (pt): ${terceira.pt?.notification?.body}`);
    check(terceira.pt?.data?.tag === segunda.pt?.data?.tag, 'as mensagens da mesma conversa precisam ter a mesma tag (a nova substitui a anterior)');
  }, { tag: 'funcional' });

  await soft('depois que B lê a conversa, o aviso conta só as mensagens NÃO lidas (e não as do histórico da notificação)', async () => {
    await fsUpdate(`conversations/${conversa}`, { unreadCounts: { [A.uid]: 0, [B.uid]: 0 } }, 'owner');
    await mensagem(4, 'quarta');
    // A notificação agregada soma 4, mas B só tem 1 mensagem nova: o aviso diz isso, não "4 novas mensagens".
    const quarta = await esperarEnvio('new_message', (entrega) => String(entrega.__id).endsWith('-4'));
    check(quarta.entrega.count === 1, `contagem do aviso: ${quarta.entrega.count} (esperado 1)`);
    check(quarta.pt?.notification?.body === 'Enviou uma mensagem para você', `4ª (pt): ${quarta.pt?.notification?.body}`);
  }, { tag: 'funcional' });

  // ---------------------------------------------------------------------------------------------------------------
  section('notificacoes: regras do envio (quem recebe, spam, preferências)');
  await soft('curtidas agregadas não viram spam: a 2ª, 3ª e 4ª só somam no contador; a 5ª avisa de novo', async () => {
    const postal = `marcas_${stamp}`;
    await fsSet(`posts/${postal}`, postBase(B, { type: 'original', text: 'Post das marcas' }), 'owner');
    const fan = (n) => `fan${n}_${stamp}`;
    for (let n = 1; n <= 5; n++) {
      await fsSet(`users/${fan(n)}`, { name: `Fã ${n}`, username: `fa${n}_${stamp}`, avatarUrl: '/profile.png' }, 'owner');
    }
    const daqui = (entrega) => entrega.messages?.[0]?.data?.path?.endsWith(`/post/${postal}`);
    const total = async () => (await adminFind('notifications', { recipientId: B.uid, type: 'like_post', entityId: postal })).reduce((soma, n) => soma + (n.count ?? 0), 0);
    for (let n = 1; n <= 5; n++) {
      await fsSet(`posts/${postal}/likes/${fan(n)}`, { userId: fan(n), createdAt: now() }, 'owner');
      // Uma curtida por vez: duas funções ao mesmo tempo não enxergam a notificação uma da outra e criariam duas.
      await eventually(async () => (await total()) === n, { label: `notificação com ${n} curtida(s)` });
      if (n === 1) await esperarEnvio('like_post', daqui);
      if (n === 4) await esperar(3000);
    }
    const quinta = await esperarEnvio('like_post', (entrega) => daqui(entrega) && entrega.count === 5);
    check(quinta.pt?.notification?.body === 'Fã 1 e outras 4 pessoas curtiram sua publicação.', `texto da 5ª: ${quinta.pt?.notification?.body}`);
    const contagens = (await adminFind('_pushOutbox', { recipientId: B.uid, type: 'like_post' })).filter(daqui).map((entrega) => entrega.count).sort((a, b) => a - b);
    check(JSON.stringify(contagens) === '[1,5]', `avisos desta publicação com contagens ${JSON.stringify(contagens)} (esperado [1,5]: a 1ª curtida e a 5ª)`);
  }, { tag: 'funcional' });

  await soft('quem não tem aparelho cadastrado não recebe nada (e a Function não dá erro)', async () => {
    const postC = `semtoken_${stamp}`;
    await fsSet(`posts/${postC}`, postBase(C, { type: 'original', text: 'post de C' }), 'owner');
    await fsSet(`posts/${postC}/likes/${A.uid}`, { userId: A.uid, createdAt: now() }, 'owner');
    await eventually(async () => (await adminFind('notifications', { recipientId: C.uid, type: 'like_post' })).length > 0, { label: 'notificação para C criada' });
    await esperar(3000);
    const saidas = await adminFind('_pushOutbox', { recipientId: C.uid });
    check(saidas.length === 0, `C não tem aparelho, mas houve ${saidas.length} envio(s)`);
  }, { tag: 'funcional' });

  await soft('a preferência "curtidas" desligada em Configurações vale para o push; ao religar, volta a avisar', async () => {
    const conta = `users/${B.uid}/private/account`;
    const original = (await adminGetDoc(conta)).doc?.notificationPreferences;
    const postP = `pref_${stamp}`;
    await fsSet(`posts/${postP}`, postBase(B, { type: 'original', text: 'Post da preferência' }), 'owner');
    const envios = async () => (await adminFind('_pushOutbox', { recipientId: B.uid, type: 'like_post' })).filter((entrega) => entrega.messages?.[0]?.data?.path?.endsWith(`/post/${postP}`));
    const notificacoes = async () => adminFind('notifications', { recipientId: B.uid, type: 'like_post', entityId: postP });
    try {
      const desligar = await fsUpdate(conta, { notificationPreferences: { ...(original ?? {}), likes: false } }, 'owner');
      check(desligar.status === 200, `desligar a preferência -> HTTP ${desligar.status}`);
      await fsSet(`posts/${postP}/likes/${C.uid}`, { userId: C.uid, createdAt: now() }, 'owner');
      await eventually(async () => (await adminGetDoc(`posts/${postP}`)).doc?.likes === 1, { label: 'contador do post somar a curtida de C' });
      await esperar(3000);
      check((await notificacoes()).length === 0 && (await envios()).length === 0, 'com "curtidas" desligadas ainda houve notificação ou push');
    } finally {
      await fsUpdate(conta, { notificationPreferences: original ?? {} }, 'owner');
    }
    await fsSet(`posts/${postP}/likes/${A.uid}`, { userId: A.uid, createdAt: now() }, 'owner');
    await eventually(async () => (await envios()).length === 1, { label: 'push depois de religar a preferência', timeoutMs: 45_000 });
  }, { tag: 'funcional' });
}
