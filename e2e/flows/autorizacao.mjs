/**
 * Seção "autorizacao": testes NEGATIVOS pela REST dos emuladores, com o ID token real de cada usuário (as regras do
 * Firestore, do Storage e do RTDB valem exatamente como para o app). Cada teste afirma o comportamento DESEJADO:
 *   negar  -> passa se a operação for recusada (HTTP 401/403); "FALHOU (seg)" significa que foi PERMITIDA;
 *   vazar  -> passa se a consulta NÃO devolver dado alheio;
 *   permitir (controle) -> prova que o teste funciona: a operação legítima precisa dar certo.
 * Os dados são semeados aqui com o administrador do emulador (que ignora regras), então a seção roda sozinha.
 * Usuários: A e B são donos dos dados; C é a conta "de fora" que tenta ler ou alterar o que não é dela.
 */
import {
  EMU,
  ADMIN,
  BUCKET,
  adminGetDoc,
  fsCreate,
  fsCreateAtServerTime,
  fsDelete,
  fsGetDoc,
  fsList,
  fsQuery,
  fsSet,
  fsUpdate,
  collectionQuery,
  whereEq,
  storageDelete,
  storageRead,
  storageUpload,
} from '../lib/harness.mjs';

const denied = (response) => response.status === 401 || response.status === 403;

export async function run(ctx) {
  const { runner, users, stamp } = ctx;
  const { a: A, b: B, c: C } = users;
  const { section, soft, check } = runner;
  const tk = { a: await ctx.token(A), b: await ctx.token(B), c: await ctx.token(C) };
  const now = new Date();
  const pubId = `pub_${stamp}`;
  const privId = `priv_${stamp}`;
  const folId = `fol_${stamp}`;
  const commentId = `c1_${stamp}`;
  const convAB = [A.uid, B.uid].sort().join('_');
  const convAC = [A.uid, C.uid].sort().join('_');
  const convBC = [B.uid, C.uid].sort().join('_');
  const secretDm = `SEGREDO-DM-${stamp}`;
  const secretNotification = `SEGREDO-NOTIF-${stamp}`;
  const aObject = `user_uploads/${A.uid}/privado-${stamp}.png`;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const postBase = { userId: B.uid, text: 'post de B', visibility: 'public', likes: 0, reposts: 0, commentsCount: 0, quotesCount: 0, views: 0, isDeleted: false, allowReposts: true, replyPermission: 'everyone', createdAt: now, category: 'echo' };

  /** negar: passa se recusado */
  const deny = (name, call, options) =>
    soft(name, async () => {
      const response = await call();
      check(denied(response), `a operação foi PERMITIDA (HTTP ${response.status})`);
      return `recusado (HTTP ${response.status})`;
    }, { tag: 'seg', ...options });
  /** permitir (controle): passa se der certo */
  const allow = (name, call) =>
    soft(name, async () => {
      const response = await call();
      check(response.status >= 200 && response.status < 300, `o controle legítimo falhou (HTTP ${response.status})`);
      return `ok (HTTP ${response.status})`;
    }, { tag: 'controle' });

  // ---------------------------------------------------------------------------------------------------------------
  section('autorização: preparação dos dados (administrador do emulador)');
  await soft('semear posts, comentário, conversas, mensagens, notificação, arquivo e objeto no Storage', async () => {
    // fsSet é idempotente (cria ou substitui): a seção roda sozinha ou depois das outras, que já criaram conversas.
    const creates = [
      fsSet(`posts/${pubId}`, postBase, 'owner'),
      fsSet(`posts/${privId}`, { ...postBase, visibility: 'private', text: `SEGREDO-POST-PRIVADO-${stamp}` }, 'owner'),
      fsSet(`posts/${folId}`, { ...postBase, visibility: 'followers', text: `SEGREDO-POST-SEGUIDORES-${stamp}` }, 'owner'),
      fsSet(`posts/${pubId}/comments/${commentId}`, { userId: B.uid, postId: pubId, text: 'comentário de B', postVisibility: 'public', postAuthorId: B.uid, likes: 0, repostsCount: 0, repliesCount: 0, createdAt: now, isDeleted: false }, 'owner'),
      fsSet(`conversations/${convAB}`, { participantIds: [A.uid, B.uid].sort(), lastMessageText: secretDm, lastMessageSenderId: A.uid, lastMessageAt: now, createdAt: now, unreadCounts: { [A.uid]: 0, [B.uid]: 0 }, userLeftAt: {} }, 'owner'),
      fsSet(`conversations/${convAB}/messages/m1_${stamp}`, { senderId: A.uid, text: secretDm, createdAt: now, readAt: null }, 'owner'),
      fsSet(`conversations/${convBC}`, { participantIds: [B.uid, C.uid].sort(), lastMessageText: `SEGREDO-BC-${stamp}`, lastMessageSenderId: B.uid, lastMessageAt: now, createdAt: now, unreadCounts: { [B.uid]: 0, [C.uid]: 0 }, userLeftAt: {} }, 'owner'),
      fsSet(`notifications/n_${stamp}`, { recipientId: B.uid, type: 'like_post', actors: [{ id: A.uid, name: 'A' }], count: 1, readAt: null, createdAt: now, previewText: secretNotification, entityId: pubId }, 'owner'),
      fsSet(`userFiles/f_${stamp}`, { userId: A.uid, name: 'segredo.pdf', url: 'x', createdAt: now }, 'owner'),
      // a conversa A_C precisa NÃO existir para os testes de criação indevida
      fsDelete(`conversations/${convAC}`, 'owner').then(() => ({ status: 200 })),
    ];
    const results = await Promise.all(creates);
    const bad = results.filter((r) => r.status !== 200);
    check(bad.length === 0, `falhou ao semear: ${bad.map((r) => `${r.status} ${JSON.stringify(r.json?.error?.message ?? '')}`).join(' | ')}`);
    const upload = await storageUpload(aObject, png, 'image/png', 'owner');
    check(upload.status === 200, `upload do objeto de A pelo administrador: HTTP ${upload.status}`);
    const made = await fsUpdate(`users/${A.uid}`, { profileVisibility: 'private' }, tk.a);
    check(made.status === 200, `A não conseguiu ficar com perfil privado: HTTP ${made.status}`);
  });

  // ---------------------------------------------------------------------------------------------------------------
  section('autorização: usuários e perfis');
  await soft('sem login, listar a coleção users NÃO devolve e-mails nem datas de nascimento', async () => {
    const { status, docs } = await fsList('users', undefined, 100);
    check(status === 403, `a listagem anônima de users foi PERMITIDA: ${docs.length} perfis, ${docs.filter((d) => d.email).length} com e-mail e ${docs.filter((d) => d.dateOfBirth).length} com data de nascimento`);
  }, { tag: 'seg' });
  // O perfil público é um cartão (nome, @, foto, bio, números) que qualquer um vê, inclusive o de um perfil privado; os
  // dados pessoais ficam em users/{uid}/private/account, que só o dono lê.
  const PERSONAL_KEYS = ['email', 'dateOfBirth', 'notificationPreferences', 'mutedWords', 'displaySensitiveContent', 'tabPreferences', 'totalUnreadMessages'];
  const personalKeysIn = (doc) => PERSONAL_KEYS.filter((key) => doc && key in doc);
  await soft('C, logado, busca users por @ (com limite) e recebe o cartão de A SEM e-mail, nascimento ou preferências', async () => {
    const { status, docs } = await fsQuery(collectionQuery('users', { where: whereEq('username', A.username), limit: 10 }), tk.c);
    check(status === 200, `a busca legítima por @ foi recusada (HTTP ${status})`);
    const card = docs.find((d) => d.__id === A.uid);
    check(card, 'a busca por @ não trouxe o cartão de A');
    check(personalKeysIn(card).length === 0, `o cartão público de A traz dados pessoais: ${personalKeysIn(card).join(', ')}`);
  }, { tag: 'seg' });
  await deny('C, logado, lista users SEM limite (varredura da base de membros)', () => fsQuery(collectionQuery('users', {}), tk.c));
  await soft('C lê o cartão do perfil PRIVADO de A, mas sem nenhum dado pessoal', async () => {
    const { status, doc } = await fsGetDoc(`users/${A.uid}`, tk.c);
    check(status === 200, `o cartão público de A foi recusado (HTTP ${status})`);
    check(personalKeysIn(doc).length === 0, `o cartão público de A traz dados pessoais: ${personalKeysIn(doc).join(', ')}`);
  }, { tag: 'seg' });
  await deny('C lê os dados pessoais de A (users/A/private/account)', () => fsGetDoc(`users/${A.uid}/private/account`, tk.c).then((r) => ({ status: r.status })));
  await deny('sem login, lê os dados pessoais de A', () => fsGetDoc(`users/${A.uid}/private/account`, undefined).then((r) => ({ status: r.status })));
  await deny('C grava nos dados pessoais de A', () => fsSet(`users/${A.uid}/private/account`, { mutedWords: ['adulterado'] }, tk.c));
  await soft('controle: A lê os próprios dados pessoais, com o e-mail da conta', async () => {
    const { status, doc } = await fsGetDoc(`users/${A.uid}/private/account`, tk.a);
    check(status === 200, `A não conseguiu ler os próprios dados pessoais (HTTP ${status})`);
    check(doc?.email === A.email, `e-mail em private/account = ${doc?.email}`);
  }, { tag: 'controle' });
  await deny('A grava nos próprios dados pessoais um e-mail diferente do da conta', () => fsUpdate(`users/${A.uid}/private/account`, { email: `outro.${stamp}@example.test` }, tk.a));
  await deny('A altera direto o próprio contador de mensagens não lidas (só as Functions gravam)', () => fsUpdate(`users/${A.uid}/private/account`, { totalUnreadMessages: 999 }, tk.a), { tag: 'integridade' });
  await deny('A grava e-mail ou data de nascimento no perfil PÚBLICO', () => fsUpdate(`users/${A.uid}`, { email: A.email, dateOfBirth: '1990-01-01' }, tk.a));
  await deny('C altera o nome do perfil de A', () => fsUpdate(`users/${A.uid}`, { name: 'adulterado' }, tk.c));
  await deny('C se promove a administrador (users/C.isAdmin = true)', () => fsUpdate(`users/${C.uid}`, { isAdmin: true }, tk.c));
  await deny('C apaga o perfil de A', () => fsDelete(`users/${A.uid}`, tk.c));
  await deny('C infla os seguidores de A sem seguir ninguém (followersCount + 1)', async () => {
    const { doc } = await adminGetDoc(`users/${A.uid}`);
    return fsUpdate(`users/${A.uid}`, { followersCount: (doc.followersCount ?? 0) + 1 }, tk.c);
  });
  await soft('uma conta recém-criada NÃO consegue gravar o próprio perfil com isAdmin = true (escalada de privilégio)', async () => {
    const email = `escalada.${stamp}@example.test`;
    const signUp = await fetch(`${EMU.auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Teste!123456', returnSecureToken: true }),
    });
    const account = await signUp.json();
    check(account.idToken, 'não consegui criar a conta de teste no Auth emulado');
    const profile = {
      name: 'Atacante', name_lowercase: 'atacante', username: `atacante_${stamp}`, email, dateOfBirth: '1990-01-01', avatarUrl: '/profile.png',
      'data-ai-hint': 'x', bio: '', followersCount: 0, followingCount: 0, postsCount: 0, dmPreference: 'everyone', isAdmin: true, createdAt: new Date(),
      profileVisibility: 'public', notificationPreferences: {}, allowTagging: 'everyone', isModerator: true, displaySensitiveContent: false,
      pinnedPostId: null, coverImageUrl: null, 'cover-image-ai-hint': null,
    };
    const created = await fsCreate('users', account.localId, profile, account.idToken);
    if (denied(created)) return `recusado (HTTP ${created.status})`;
    const power = await fsList('access_agg_daily', account.idToken, 5);
    const trending = await fsList('trending_topics', account.idToken, 5);
    throw new Error(`o perfil com isAdmin=true e isModerator=true foi CRIADO (HTTP ${created.status}); com ele a conta lê access_agg_daily (HTTP ${power.status}) e trending_topics (HTTP ${trending.status}), que são só de administrador`);
  }, { tag: 'seg' });

  // ---------------------------------------------------------------------------------------------------------------
  section('autorização: posts, curtidas e comentários');
  await allow('controle: sem login, qualquer um lê um post PÚBLICO', () => fsGetDoc(`posts/${pubId}`, undefined).then((r) => ({ status: r.status })));
  await deny('C lê (get) o post PRIVADO de B', () => fsGetDoc(`posts/${privId}`, tk.c).then((r) => ({ status: r.status })));
  await deny('C lê (get) o post só-para-seguidores de B sem seguir', () => fsGetDoc(`posts/${folId}`, tk.c).then((r) => ({ status: r.status })));
  await soft('C, ao LISTAR posts, NÃO recebe posts privados nem só-para-seguidores de B', async () => {
    const { status, docs } = await fsQuery(collectionQuery('posts', { limit: 100 }), tk.c);
    const leaked = docs.filter((d) => d.visibility === 'private' || d.visibility === 'followers');
    check(status === 403 || leaked.length === 0, `a listagem devolveu ${leaked.length} post(s) não públicos, entre eles "${leaked[0]?.text}"`);
  }, { tag: 'seg' });
  await soft('sem login, a listagem de posts NÃO traz posts privados', async () => {
    const { status, docs } = await fsQuery(collectionQuery('posts', { limit: 100 }), undefined);
    const leaked = docs.filter((d) => d.visibility === 'private' || d.visibility === 'followers');
    check(status === 403 || leaked.length === 0, `a listagem anônima devolveu ${leaked.length} post(s) não públicos`);
  }, { tag: 'seg' });
  await deny('C edita o texto do post de B', () => fsUpdate(`posts/${pubId}`, { text: 'adulterado', isEdited: true }, tk.c));
  await deny('C apaga o post de B', () => fsDelete(`posts/${pubId}`, tk.c));
  await deny('C marca o post de B como apagado (isDeleted)', () => fsUpdate(`posts/${pubId}`, { isDeleted: true }, tk.c));
  await deny('C cria um post em nome de B (userId = B)', () => fsCreate('posts', `falso_${stamp}`, { ...postBase, userId: B.uid }, tk.c));
  await deny('C cria um like em nome de A', () => fsCreate(`posts/${pubId}/likes`, A.uid, { userId: A.uid, createdAt: now }, tk.c));
  await deny('C apaga o like de A', async () => {
    await fsCreate(`posts/${pubId}/likes`, A.uid, { userId: A.uid, createdAt: now }, 'owner');
    return fsDelete(`posts/${pubId}/likes/${A.uid}`, tk.c);
  });
  await deny('C infla as curtidas do post de B sem curtir (likes + 1)', async () => {
    const { doc } = await adminGetDoc(`posts/${pubId}`);
    return fsUpdate(`posts/${pubId}`, { likes: doc.likes + 1 }, tk.c);
  }, { tag: 'integridade' });
  await deny('C infla as curtidas do COMENTÁRIO de B sem curtir (likes + 1)', () => fsUpdate(`posts/${pubId}/comments/${commentId}`, { likes: 1 }, tk.c), { tag: 'integridade' });
  await deny('C infla as visualizações do post de B (views + 1)', async () => {
    const { doc } = await adminGetDoc(`posts/${pubId}`);
    return fsUpdate(`posts/${pubId}`, { views: doc.views + 1 }, tk.c);
  }, { tag: 'integridade' });
  await deny('C grava na análise (analytics) do post de B, que só o dono deveria alimentar', () => fsCreate(`posts/${pubId}/analytics`, `x_${stamp}`, { qualquer: 'coisa' }, tk.c), { tag: 'integridade' });
  await deny('C altera o TEXTO do comentário de B junto com um +1 em likes (regra hasAny)', () => fsUpdate(`posts/${pubId}/comments/${commentId}`, { text: 'COMENTÁRIO ADULTERADO', likes: 1 }, tk.c));
  await deny('C altera só o texto do comentário de B', () => fsUpdate(`posts/${pubId}/comments/${commentId}`, { text: 'adulterado' }, tk.c));
  await deny('C apaga o comentário de B', () => fsDelete(`posts/${pubId}/comments/${commentId}`, tk.c));

  // ---------------------------------------------------------------------------------------------------------------
  // Perfil privado: todo post dele é "followers" (só seguidores). Listar posts exige uma consulta que garanta a
  // visibilidade; citar copiaria o conteúdo para fora do círculo, então só se cita post público.
  section('autorização: posts só para seguidores, listagens e citações');
  const and = (...filters) => ({ compositeFilter: { op: 'AND', filters } });
  const inList = (field, values) => ({ fieldFilter: { field: { fieldPath: field }, op: 'IN', value: { arrayValue: { values: values.map((v) => ({ stringValue: v })) } } } });
  const userCard = async (user) => (await adminGetDoc(`users/${user.uid}`)).doc;
  const newPost = async (author, extra = {}) => {
    const card = await userCard(author);
    return {
      userId: author.uid, text: `post de teste ${stamp}`, type: 'original', category: 'echo', isDeleted: false,
      likes: 0, reposts: 0, commentsCount: 0, quotesCount: 0, views: 0, allowReposts: true, replyPermission: 'everyone',
      authorDetails: { userId: author.uid, name: card.name, username: card.username, avatarUrl: card.avatarUrl ?? null },
      createdAt: 'servidor', ...extra,
    };
  };
  await allow('controle: C lista posts PÚBLICOS (visibility == public)', () =>
    fsQuery(collectionQuery('posts', { where: whereEq('visibility', 'public'), limit: 20 }), tk.c));
  await deny('C, que NÃO segue B, lista os posts só-para-seguidores de B', () =>
    fsQuery(collectionQuery('posts', { where: and(whereEq('userId', B.uid), whereEq('visibility', 'followers')), limit: 20 }), tk.c));
  await deny('C lista os posts de B sem filtro de visibilidade', () =>
    fsQuery(collectionQuery('posts', { where: whereEq('userId', B.uid), limit: 20 }), tk.c));
  await soft('A passa a seguir B e lista os posts só-para-seguidores de B (consulta do feed "Seguindo")', async () => {
    await fsSet(`users/${B.uid}/followers/${A.uid}`, { userId: A.uid, createdAt: now }, 'owner');
    try {
      const { status, docs } = await fsQuery(collectionQuery('posts', {
        where: and(inList('userId', [B.uid]), whereEq('visibility', 'followers'), whereEq('isDeleted', false)), limit: 20,
      }), tk.a);
      check(status === 200, `a consulta do seguidor foi recusada (HTTP ${status})`);
      check(docs.some((d) => d.__id === folId), 'o post só-para-seguidores de B não veio para A, que segue B');
    } finally {
      await fsDelete(`users/${B.uid}/followers/${A.uid}`, 'owner');
    }
  }, { tag: 'controle' });
  await deny('C lista as respostas do post só-para-seguidores de B', () => fsList(`posts/${folId}/comments`, tk.c, 20));
  await deny('A, com perfil PRIVADO, cria um post público (vazaria para quem não segue)', async () =>
    fsCreateAtServerTime('posts', `pub_de_privado_${stamp}`, await newPost(A, { visibility: 'public' }), tk.a));
  await allow('controle: A, com perfil privado, cria um post só-para-seguidores', async () =>
    fsCreateAtServerTime('posts', `fol_de_privado_${stamp}`, await newPost(A, { visibility: 'followers' }), tk.a));
  await allow('controle: C cita o post PÚBLICO de B', async () =>
    fsCreateAtServerTime('posts', `cita_pub_${stamp}`, await newPost(C, {
      visibility: 'public', type: 'quote',
      originalPostDetails: { id: pubId, type: 'original', text: 'post de B', authorDetails: { userId: B.uid } },
    }), tk.c));
  await deny('C cita o post só-para-seguidores de B (copiaria o conteúdo)', async () =>
    fsCreateAtServerTime('posts', `cita_fol_${stamp}`, await newPost(C, {
      visibility: 'public', type: 'quote',
      originalPostDetails: { id: folId, type: 'original', text: 'copia', authorDetails: { userId: B.uid } },
    }), tk.c));
  await deny('C cita um comentário de um post só-para-seguidores', async () => {
    await fsSet(`posts/${folId}/comments/c_fol_${stamp}`, { userId: B.uid, postId: folId, text: 'resposta restrita', postVisibility: 'followers', postAuthorId: B.uid, likes: 0, repostsCount: 0, repliesCount: 0, createdAt: now, isDeleted: false }, 'owner');
    return fsCreateAtServerTime('posts', `cita_coment_fol_${stamp}`, await newPost(C, {
      visibility: 'public', type: 'quote', quotedCommentId: `${folId}/c_fol_${stamp}`,
    }), tk.c);
  });
  await deny('C cita um comentário que não existe (o servidor não conferia nada)', async () =>
    fsCreateAtServerTime('posts', `cita_coment_falso_${stamp}`, await newPost(C, {
      visibility: 'public', type: 'quote', quotedCommentId: `${pubId}/nao_existe_${stamp}`,
    }), tk.c));
  await deny('C muda a visibilidade do próprio post (só acompanha o perfil)', async () => {
    const created = await fsCreateAtServerTime('posts', `vis_${stamp}`, await newPost(C, { visibility: 'public' }), tk.c);
    check(created.status === 200, `não consegui criar o post de C para o teste (HTTP ${created.status})`);
    return fsUpdate(`posts/vis_${stamp}`, { visibility: 'followers' }, tk.c);
  });

  // ---------------------------------------------------------------------------------------------------------------
  section('autorização: mensagens privadas');
  await deny('C lê (get) a conversa entre A e B', () => fsGetDoc(`conversations/${convAB}`, tk.c).then((r) => ({ status: r.status })));
  await soft('C, ao LISTAR conversas, NÃO recebe conversas alheias (nem a última mensagem delas)', async () => {
    const { status, docs } = await fsQuery(collectionQuery('conversations', { limit: 50 }), tk.c);
    const foreign = docs.filter((d) => !(d.participantIds ?? []).includes(C.uid));
    check(status === 403 || foreign.length === 0, `a listagem devolveu ${foreign.length} conversa(s) alheia(s); texto da última mensagem de A e B: "${foreign.find((d) => d.__id === convAB)?.lastMessageText}"`);
  }, { tag: 'seg' });
  await deny('C lista as mensagens da conversa entre A e B', () => fsList(`conversations/${convAB}/messages`, tk.c).then((r) => ({ status: r.status })));
  await deny('C lê (get) uma mensagem da conversa entre A e B', () => fsGetDoc(`conversations/${convAB}/messages/m1_${stamp}`, tk.c).then((r) => ({ status: r.status })));
  await deny('C escreve uma mensagem na conversa entre A e B (senderId = C)', () => fsCreate(`conversations/${convAB}/messages`, `x1_${stamp}`, { senderId: C.uid, text: 'intruso', createdAt: now }, tk.c));
  await deny('C escreve uma mensagem na conversa entre A e B se passando por A (senderId = A)', () => fsCreate(`conversations/${convAB}/messages`, `x2_${stamp}`, { senderId: A.uid, text: 'falso', createdAt: now }, tk.c));
  await deny('C apaga uma mensagem de A', () => fsDelete(`conversations/${convAB}/messages/m1_${stamp}`, tk.c));
  await deny('C altera a prévia (lastMessageText) da conversa entre A e B', () => fsUpdate(`conversations/${convAB}`, { lastMessageText: 'adulterado' }, tk.c));
  await deny('A (de fora) lê as mensagens da conversa entre B e C', () => fsList(`conversations/${convBC}/messages`, tk.a).then((r) => ({ status: r.status })));
  await allow('controle: B (participante) lê as mensagens da conversa com A', () => fsList(`conversations/${convAB}/messages`, tk.b).then((r) => ({ status: r.status })));
  await soft('B, de fora, NÃO consegue criar a conversa A_C (id de dois outros usuários) e ocupar o lugar dela', async () => {
    const squat = await fsCreate('conversations', convAC, { participantIds: [B.uid, 'qualquer-uid'], createdAt: now, lastMessageAt: now, unreadCounts: {}, userLeftAt: {} }, tk.b);
    check(denied(squat), `a conversa ${convAC} foi criada por quem não é participante (HTTP ${squat.status}); A e C não conseguirão mais conversar`);
  }, { tag: 'seg' });
  await soft('C NÃO consegue abrir conversa com A que escolheu "ninguém" nas mensagens (preferência imposta pelas regras)', async () => {
    const set = await fsUpdate(`users/${A.uid}`, { dmPreference: 'none' }, tk.a);
    check(set.status === 200, `não consegui definir dmPreference=none (HTTP ${set.status})`);
    await fsDelete(`conversations/${convAC}`, 'owner');
    const created = await fsCreate('conversations', convAC, { participantIds: [A.uid, C.uid].sort(), createdAt: now, lastMessageAt: now, unreadCounts: {}, userLeftAt: {} }, tk.c);
    let message = { status: 0 };
    if (!denied(created)) message = await fsCreate(`conversations/${convAC}/messages`, `spam_${stamp}`, { senderId: C.uid, text: 'mensagem indesejada', createdAt: now }, tk.c);
    await fsUpdate(`users/${A.uid}`, { dmPreference: 'everyone' }, tk.a);
    check(denied(created), `a conversa foi criada (HTTP ${created.status}) e a mensagem foi ${denied(message) ? 'recusada' : `ENVIADA (HTTP ${message.status})`}: a preferência só é conferida pelo navegador`);
  }, { tag: 'seg' });
  await soft('C NÃO consegue abrir conversa com A, que bloqueou C (o bloqueio também vale nas regras)', async () => {
    await fsSet(`users/${A.uid}/blockedUsers/${C.uid}`, { userId: C.uid, createdAt: now }, 'owner');
    await fsDelete(`conversations/${convAC}`, 'owner');
    const created = await fsCreate('conversations', convAC, { participantIds: [A.uid, C.uid].sort(), createdAt: now, lastMessageAt: now, unreadCounts: {}, userLeftAt: {} }, tk.c);
    await fsDelete(`users/${A.uid}/blockedUsers/${C.uid}`, 'owner');
    check(denied(created), `a conversa foi criada por quem foi bloqueado (HTTP ${created.status})`);
  }, { tag: 'seg' });
  await soft('chamar a callable onMessageCreated SEM login, forjando remetente e texto, é recusado', async () => {
    const response = await fetch(`${EMU.functions}/demo-soberan/southamerica-east1/onMessageCreated`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { conversationId: convAB, messageId: `forjada_${stamp}`, senderId: B.uid, text: 'TEXTO FORJADO POR QUEM NÃO TEM LOGIN' } }),
    });
    const { doc } = await adminGetDoc(`conversations/${convAB}`);
    // 404 = a função não existe mais (foi removida: quem atualiza a conversa agora é o gatilho do servidor)
    check(denied(response) || response.status === 404, `a chamada anônima foi ACEITA (HTTP ${response.status}); a prévia da conversa de A e B virou "${doc.lastMessageText}" e o remetente "${doc.lastMessageSenderId === B.uid ? 'B (forjado)' : doc.lastMessageSenderId}"`);
  }, { tag: 'seg' });

  // ---------------------------------------------------------------------------------------------------------------
  section('autorização: notificações');
  await soft('C NÃO consegue listar as notificações de B', async () => {
    const { status, docs } = await fsQuery(collectionQuery('notifications', { where: whereEq('recipientId', B.uid) }), tk.c);
    const leaked = docs.find((d) => d.previewText === secretNotification);
    check(status === 403 || !leaked, `a consulta devolveu ${docs.length} notificação(ões) de B, com o texto "${leaked?.previewText}"`);
  }, { tag: 'seg' });
  await soft('sem limite, C NÃO consegue listar TODAS as notificações do sistema', async () => {
    const { status, docs } = await fsQuery(collectionQuery('notifications', {}), tk.c);
    check(status === 403 || docs.length === 0, `a listagem sem filtro devolveu ${docs.length} notificação(ões) de outros usuários`);
  }, { tag: 'seg' });
  await deny('C lê (get) uma notificação de B', () => fsGetDoc(`notifications/n_${stamp}`, tk.c).then((r) => ({ status: r.status })));
  await deny('C marca como lida a notificação de B', () => fsUpdate(`notifications/n_${stamp}`, { readAt: new Date() }, tk.c));
  await deny('C cria uma notificação para B', () => fsCreate('notifications', `forjada_${stamp}`, { recipientId: B.uid, type: 'like_post', count: 1, readAt: null, createdAt: now }, tk.c));
  await deny('B altera o texto da própria notificação (só readAt pode mudar)', () => fsUpdate(`notifications/n_${stamp}`, { previewText: 'mudei' }, tk.b));
  await allow('controle: B marca a própria notificação como lida', () => fsUpdate(`notifications/n_${stamp}`, { readAt: new Date() }, tk.b));

  // ---------------------------------------------------------------------------------------------------------------
  section('autorização: arquivos, Storage e outras coleções');
  await deny('C lê (get) o registro de arquivo de A (userFiles)', () => fsGetDoc(`userFiles/f_${stamp}`, tk.c).then((r) => ({ status: r.status })));
  await deny('C lista os arquivos de A (userFiles)', () => fsQuery(collectionQuery('userFiles', { where: whereEq('userId', A.uid) }), tk.c));
  await deny('C cria um registro de arquivo em nome de A', () => fsCreate('userFiles', `forjado_${stamp}`, { userId: A.uid, name: 'x', url: 'x', createdAt: now }, tk.c));
  await deny('C apaga o registro de arquivo de A', () => fsDelete(`userFiles/f_${stamp}`, tk.c));
  await deny('Storage: C grava um arquivo na pasta de A', () => storageUpload(`user_uploads/${A.uid}/invasor-${stamp}.png`, png, 'image/png', tk.c));
  await deny('Storage: C apaga o arquivo de A', () => storageDelete(aObject, tk.c));
  await deny('Storage: sem login ninguém grava', () => storageUpload(`user_uploads/${C.uid}/anonimo-${stamp}.png`, png, 'image/png', undefined));
  await deny('Storage: gravar fora de user_uploads/ é recusado', () => storageUpload(`qualquer/${stamp}.png`, png, 'image/png', tk.c));
  await deny('Storage: arquivo acima de 5 MB é recusado', () => storageUpload(`user_uploads/${C.uid}/grande-${stamp}.bin`, Buffer.alloc(5 * 1024 * 1024 + 1), 'application/octet-stream', tk.c));
  await allow('controle: C grava na própria pasta do Storage', () => storageUpload(`user_uploads/${C.uid}/proprio-${stamp}.png`, png, 'image/png', tk.c));
  await soft('Storage: sem login NÃO se lê o arquivo privado de A (anexos de mensagens e arquivos pessoais)', async () => {
    const read = await storageRead(aObject, undefined);
    check(read.status !== 200, 'qualquer pessoa, sem login, lê o arquivo de A: a regra do Storage é "read: if true" para toda a pasta user_uploads');
  }, { tag: 'privacidade' });
  await soft('Storage: sem login NÃO se listam os arquivos de um usuário (o id é público: daria para baixar todos os anexos de mensagens)', async () => {
    const response = await fetch(`${EMU.storage}/v0/b/${BUCKET}/o?prefix=${encodeURIComponent(`user_uploads/${A.uid}/`)}`);
    const body = await response.json().catch(() => ({}));
    check(denied(response), `a listagem anônima de user_uploads/${A.uid}/ foi PERMITIDA (HTTP ${response.status}) e devolveu ${(body.items ?? []).length} objeto(s); "read: if true" inclui list`);
  }, { tag: 'privacidade' });
  await deny('trending_topics: C (não administrador) não lê', () => fsList('trending_topics', tk.c, 5));
  await deny('access_agg_daily: C (não administrador) não lê', () => fsList('access_agg_daily', tk.c, 5));
  await deny('access_events: C (não administrador) não lê', () => fsList('access_events', tk.c, 5));
  await soft('access_events: qualquer pessoa, sem login, NÃO grava eventos de acesso falsos direto no Firestore', async () => {
    const created = await fsCreate('access_events', `lixo_${stamp}`, { path: '/falso', userId: null, ts: now }, undefined);
    check(denied(created), `evento criado sem login (HTTP ${created.status}); a limitação de taxa existe só na rota /api/log-access, não nas regras`);
  }, { tag: 'integridade' });
  await deny('reports: C não lê denúncias', () => fsList('reports', tk.c, 5));
  await deny('reports: C cria denúncia em nome de outro usuário (reporterId = A)', () => fsCreate('reports', `r_${stamp}`, { reporterId: A.uid, postId: pubId, reason: 'x', createdAt: now }, tk.c));
  await deny('usernames: C reserva um nome de usuário em nome de A', () => fsCreate('usernames', `nome_${stamp}`, { userId: A.uid }, tk.c));
  await deny('Functions: updateUserUsername sem login é recusada', () =>
    fetch(`${EMU.functions}/demo-soberan/southamerica-east1/updateUserUsername`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { newUsername: 'invasor' } }) }).then((r) => ({ status: r.status })));
  await soft('RTDB: sem login ninguém grava dado arbitrário em /guests', async () => {
    const response = await fetch(`${EMU.database}/guests/lixo_${stamp}.json?ns=demo-soberan-default-rtdb`, { method: 'PUT', body: JSON.stringify({ qualquer: 'coisa', grande: 'x'.repeat(50_000) }) });
    await fetch(`${EMU.database}/guests/lixo_${stamp}.json?ns=demo-soberan-default-rtdb`, { method: 'DELETE', headers: ADMIN });
    check(denied(response), `a gravação anônima em /guests foi PERMITIDA (HTTP ${response.status}); veja docs/presenca.md`);
  }, { tag: 'seg' });
  const rtdb = (path, init = {}) => fetch(`${EMU.database}/${path}.json?ns=demo-soberan-default-rtdb${init.auth ? `&auth=${init.auth}` : ''}`, init);
  await deny('RTDB: sem login, ler a lista de visitantes (/guests)', () => rtdb('guests'));
  await allow('controle: um visitante registra a própria presença no formato certo', async () => {
    const guestId = `guest_${Date.now()}_${stamp.slice(0, 8)}`;
    const response = await rtdb(`guests/${guestId}`, { method: 'PUT', body: JSON.stringify({ isOnline: true, lastSeen: Date.now() }) });
    await rtdb(`guests/${guestId}`, { method: 'DELETE', headers: ADMIN });
    return response;
  });
  await deny('RTDB: A grava lixo grande no próprio status de presença', () =>
    rtdb(`status/${A.uid}`, { method: 'PUT', auth: tk.a, body: JSON.stringify({ isOnline: 'sim', lixo: 'x'.repeat(50_000) }) }));
  await deny('RTDB: C grava no status de presença de A', () =>
    rtdb(`status/${A.uid}/connections/forjada`, { method: 'PUT', auth: tk.c, body: 'true' }));
  await allow('controle: A registra uma conexão de presença própria', async () => {
    const response = await rtdb(`status/${A.uid}/connections/teste_${stamp}`, { method: 'PUT', auth: tk.a, body: 'true' });
    await rtdb(`status/${A.uid}/connections/teste_${stamp}`, { method: 'DELETE', headers: ADMIN });
    return response;
  });

  // ---------------------------------------------------------------------------------------------------------------
  await soft('limpeza: o perfil de A volta a ser público', async () => {
    const response = await fsUpdate(`users/${A.uid}`, { profileVisibility: 'public' }, tk.a);
    check(response.status === 200, `HTTP ${response.status}`);
  });
}
