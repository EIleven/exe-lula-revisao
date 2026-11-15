#!/usr/bin/env node
/**
 * Migração da separação dos dados pessoais + recontagem dos contadores que agora só as Functions gravam.
 * Usa a API REST do Firestore (e a do Auth, para o e-mail de cada conta).
 *
 *   node scripts/migrar-dados-pessoais-e-recontar.mjs                       emuladores, só mostra o plano
 *   node scripts/migrar-dados-pessoais-e-recontar.mjs --aplicar             emuladores, grava
 *   node scripts/migrar-dados-pessoais-e-recontar.mjs --producao            produção, só mostra o plano
 *   node scripts/migrar-dados-pessoais-e-recontar.mjs --producao --aplicar  produção, grava (só com autorização)
 *
 * Em produção o token vem de FIRESTORE_ACCESS_TOKEN (gcloud auth print-access-token --account=<dono do projeto>) e
 * nunca é impresso. Ordem em produção: regras, Functions e site novos no ar e SÓ DEPOIS esta migração (o app antigo
 * ainda lê e-mail e preferências do perfil público).
 *
 * O que faz:
 *  1. users/{uid}: e-mail, nascimento, preferências, palavras silenciadas e não lidas vão para
 *     users/{uid}/private/account (o que já existir lá é mantido) e saem do perfil público. O e-mail gravado é o da
 *     conta no Auth (as regras exigem que seja igual ao do token, senão o dono não consegue mais salvar preferências).
 *  2. Recalcula followersCount, followingCount e postsCount de cada usuário; likes, reposts, commentsCount e
 *     quotesCount de cada post; likes, repliesCount e repostsCount de cada comentário, com as mesmas regras das
 *     Functions. Visualizações ficam como estão (eram um +1 livre; não há marcadores antigos para recontar).
 *  3. Visibilidade: cada post segue o perfil do autor (privado -> "followers", público -> "public"; "private" fica),
 *     as respostas guardam a visibilidade do post e as citações de posts de autores privados perdem a cópia do
 *     conteúdo (o app relê o original), como a Function onUserUpdated faz quando o perfil muda.
 * Grava só o que muda e não imprime dados pessoais (só os nomes dos campos movidos).
 */

const args = new Set(process.argv.slice(2));
const PROD = args.has('--producao');
const APPLY = args.has('--aplicar');
const PROJECT = PROD ? 'echo-b5aw9' : 'demo-soberan';
const DATABASE = 'echo-db-124325';
const FIRESTORE_HOST = PROD ? 'https://firestore.googleapis.com' : `http://${process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'}`;
const AUTH_HOST = PROD
  ? 'https://identitytoolkit.googleapis.com'
  : `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099'}/identitytoolkit.googleapis.com`;
const ROOT = `projects/${PROJECT}/databases/${DATABASE}/documents`;

// Mesma lista de src/lib/services/userPrivate.ts e de privateUserFields() nas regras.
const PRIVATE_FIELDS = ['email', 'dateOfBirth', 'notificationPreferences', 'mutedWords', 'displaySensitiveContent', 'tabPreferences', 'totalUnreadMessages'];

const token = PROD ? process.env.FIRESTORE_ACCESS_TOKEN : 'owner';
if (!token) {
  console.error('Defina FIRESTORE_ACCESS_TOKEN com um token de acesso da conta dona do projeto (o valor não é impresso).');
  process.exit(2);
}
const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  ...(PROD ? { 'x-goog-user-project': PROJECT } : {}),
};

async function call(method, url, body) {
  const response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* corpo não JSON */ }
  if (!response.ok) {
    const where = url.replace(FIRESTORE_HOST, '').replace(AUTH_HOST, '').replace(`/v1/${ROOT}`, '');
    throw new Error(`${method} ${where} -> HTTP ${response.status}: ${json?.error?.message ?? text.slice(0, 200)}`);
  }
  return json;
}
const firestore = (method, path, body) => call(method, `${FIRESTORE_HOST}/v1/${path}`, body);

const idOf = (doc) => doc.name.split('/').pop();
const relativePath = (doc) => doc.name.slice(doc.name.indexOf('/documents/') + '/documents/'.length);
const intOf = (value) => (value ? Number(value.integerValue ?? value.doubleValue ?? 0) : undefined);
const stringOf = (value) => (value && typeof value.stringValue === 'string' ? value.stringValue : undefined);
const boolOf = (value) => (value && typeof value.booleanValue === 'boolean' ? value.booleanValue : undefined);

/** Lista uma coleção inteira (paginada). `mask` limita os campos lidos. */
async function listAll(collectionPath, mask = []) {
  const docs = [];
  let pageToken = '';
  do {
    const query = new URLSearchParams({ pageSize: '300' });
    if (pageToken) query.set('pageToken', pageToken);
    for (const field of mask) query.append('mask.fieldPaths', field);
    const page = await firestore('GET', `${ROOT}/${collectionPath}?${query}`);
    docs.push(...(page?.documents ?? []));
    pageToken = page?.nextPageToken ?? '';
  } while (pageToken);
  return docs;
}

/** COUNT() de uma subcoleção (sem ler os documentos). */
async function countOf(parentPath, collectionId) {
  const rows = await firestore('POST', `${ROOT}/${parentPath}:runAggregationQuery`, {
    structuredAggregationQuery: {
      structuredQuery: { from: [{ collectionId }] },
      aggregations: [{ alias: 'n', count: {} }],
    },
  });
  return Number(rows?.[0]?.result?.aggregateFields?.n?.integerValue ?? 0);
}

/** E-mail de cada conta no Auth (fonte da verdade). */
async function authEmails(uids) {
  const emails = new Map();
  for (let i = 0; i < uids.length; i += 100) {
    const chunk = uids.slice(i, i + 100);
    const result = await call('POST', `${AUTH_HOST}/v1/projects/${PROJECT}/accounts:lookup`, { localId: chunk });
    for (const account of result?.users ?? []) {
      if (account.email) emails.set(account.localId, account.email);
    }
  }
  return emails;
}

/** PATCH só dos campos em `fields`; os de `remove` são apagados (estão na máscara e fora do corpo). */
async function patch(path, fields, remove = [], { mustExist = true } = {}) {
  const query = new URLSearchParams();
  for (const field of [...Object.keys(fields), ...remove]) query.append('updateMask.fieldPaths', field);
  if (mustExist) query.set('currentDocument.exists', 'true');
  await firestore('PATCH', `${ROOT}/${path}?${query}`, { fields });
}

const plan = [];
const note = (path, changes) => { if (changes.length) plan.push(`${path}: ${changes.join('; ')}`); };
const counterWrite = (current, expected, field, fields, changes) => {
  if (current !== expected) {
    fields[field] = { integerValue: String(expected) };
    changes.push(`${field} ${current ?? '(sem)'} -> ${expected}`);
  }
};

console.log(`${PROD ? 'PRODUÇÃO' : 'emuladores'} | projeto ${PROJECT} | banco ${DATABASE} | ${APPLY ? 'GRAVANDO' : 'só o plano (use --aplicar para gravar)'}`);

// ---------------------------------------------------------------------------------------------------------------------
// Leitura
const users = await listAll('users');
const posts = await listAll('posts', ['userId', 'type', 'isDeleted', 'visibility', 'originalPostDetails.id', 'originalPostDetails.authorDetails.userId', 'originalPostDetails.text', 'quotedCommentId', 'likes', 'reposts', 'commentsCount', 'quotesCount']);
const emails = await authEmails(users.map(idOf));
console.log(`${users.length} usuários, ${posts.length} posts`);

// Visibilidade: todo post segue o perfil do autor (privado -> followers; público -> public); "private" fica como está.
const privateAuthors = new Set(users.filter((u) => stringOf(u.fields?.profileVisibility) === 'private').map(idOf));
const expectedVisibility = (postFields) => {
  const current = stringOf(postFields.visibility);
  if (current === 'private') return 'private';
  return privateAuthors.has(stringOf(postFields.userId)) ? 'followers' : 'public';
};

// Contagens que vêm dos próprios posts (mesmas regras de postLifecycleTargets nas Functions)
const postsByAuthor = new Map();
const quotesByPost = new Map();
const quotesByComment = new Map();
const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
for (const post of posts) {
  const f = post.fields ?? {};
  if (boolOf(f.isDeleted) === true) continue;
  const type = stringOf(f.type);
  const authorId = stringOf(f.userId);
  if (authorId && (type === 'original' || type === 'quote' || !type)) bump(postsByAuthor, authorId);
  if (type === 'quote') {
    const originalId = stringOf(f.originalPostDetails?.mapValue?.fields?.id);
    const quotedComment = stringOf(f.quotedCommentId) ?? '';
    if (originalId && !originalId.startsWith('http')) bump(quotesByPost, originalId);
    else if (quotedComment.includes('/')) bump(quotesByComment, quotedComment);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// 1 + 2a. Usuários: dados pessoais e contadores
let movedUsers = 0;
for (const user of users) {
  const uid = idOf(user);
  const f = user.fields ?? {};
  const changes = [];
  const publicFields = {};

  const toMove = PRIVATE_FIELDS.filter((key) => key in f);
  const privateDoc = await firestore('GET', `${ROOT}/users/${uid}/private/account`).catch((error) => {
    if (String(error.message).includes('HTTP 404')) return null;
    throw error;
  });
  const existing = privateDoc?.fields ?? {};
  const privateFields = {};
  for (const key of toMove) {
    if (key === 'email' || key in existing) continue; // o que já está em private/account é mais novo
    privateFields[key] = f[key];
  }
  const authEmail = emails.get(uid);
  if (authEmail && stringOf(existing.email) !== authEmail) privateFields.email = { stringValue: authEmail };
  if (!authEmail && 'email' in existing) changes.push('ATENÇÃO: conta sem e-mail no Auth, mas private/account tem e-mail');

  counterWrite(intOf(f.followersCount), await countOf(`users/${uid}`, 'followers'), 'followersCount', publicFields, changes);
  counterWrite(intOf(f.followingCount), await countOf(`users/${uid}`, 'following'), 'followingCount', publicFields, changes);
  counterWrite(intOf(f.postsCount), postsByAuthor.get(uid) ?? 0, 'postsCount', publicFields, changes);

  const privateKeys = Object.keys(privateFields);
  if (privateKeys.length) changes.push(`grava em private/account: ${privateKeys.join(', ')}`);
  if (toMove.length) changes.push(`remove do perfil público: ${toMove.join(', ')}`);
  note(`users/${uid}`, changes);

  if (APPLY && privateKeys.length) {
    const stamp = { timestampValue: new Date().toISOString() };
    const extra = privateDoc ? { updatedAt: stamp } : { createdAt: stamp, updatedAt: stamp };
    await patch(`users/${uid}/private/account`, { ...privateFields, ...extra }, [], { mustExist: false });
  }
  if (APPLY && (Object.keys(publicFields).length || toMove.length)) {
    await patch(`users/${uid}`, publicFields, toMove);
  }
  if (toMove.length) movedUsers++;
}

// ---------------------------------------------------------------------------------------------------------------------
// 2b. Posts e comentários: contadores
for (const post of posts) {
  const postId = idOf(post);
  const path = relativePath(post);
  const f = post.fields ?? {};
  const changes = [];
  const fields = {};

  const comments = await listAll(`${path}/comments`, ['parentCommentId', 'likes', 'repliesCount', 'repostsCount', 'postVisibility']);
  const visibility = expectedVisibility(f);
  if (stringOf(f.visibility) !== visibility) {
    fields.visibility = { stringValue: visibility };
    changes.push(`visibility ${stringOf(f.visibility) ?? '(sem)'} -> ${visibility}`);
  }
  // Citação de post de autor privado (feita por outra pessoa): a cópia do conteúdo sai; a tela relê o original.
  const quotedAuthor = stringOf(f.originalPostDetails?.mapValue?.fields?.authorDetails?.mapValue?.fields?.userId);
  const scrubQuote = stringOf(f.type) === 'quote' && quotedAuthor && privateAuthors.has(quotedAuthor)
    && quotedAuthor !== stringOf(f.userId) && stringOf(f.originalPostDetails?.mapValue?.fields?.text) !== undefined;
  if (scrubQuote) changes.push('limpa a cópia do post citado (autor privado)');
  counterWrite(intOf(f.likes), await countOf(path, 'likes'), 'likes', fields, changes);
  counterWrite(intOf(f.reposts), await countOf(path, 'reposts'), 'reposts', fields, changes);
  counterWrite(intOf(f.commentsCount), comments.length, 'commentsCount', fields, changes);
  counterWrite(intOf(f.quotesCount), quotesByPost.get(postId) ?? 0, 'quotesCount', fields, changes);
  note(path, changes);
  if (APPLY && Object.keys(fields).length) await patch(path, fields);
  if (APPLY && scrubQuote) {
    // Só os subcampos do conteúdo, por caminho (o resto da cópia, como autor e data, fica).
    const scrub = {
      text: { nullValue: null }, media: { nullValue: null }, youtubeVideoId: { nullValue: null }, headline: { nullValue: null },
      hasMedia: { booleanValue: false }, originalPostDetails: { nullValue: null }, visibility: { stringValue: 'followers' },
    };
    const query = new URLSearchParams();
    for (const key of Object.keys(scrub)) query.append('updateMask.fieldPaths', `originalPostDetails.${key}`);
    query.set('currentDocument.exists', 'true');
    await firestore('PATCH', `${ROOT}/${path}?${query}`, { fields: { originalPostDetails: { mapValue: { fields: scrub } } } });
  }

  const repliesByParent = new Map();
  for (const comment of comments) {
    const parentId = stringOf(comment.fields?.parentCommentId);
    if (parentId) bump(repliesByParent, parentId);
  }
  for (const comment of comments) {
    const commentId = idOf(comment);
    const commentPath = relativePath(comment);
    const cf = comment.fields ?? {};
    const commentChanges = [];
    const commentFields = {};
    const reposts = (await countOf(commentPath, 'reposts')) + (quotesByComment.get(`${postId}/${commentId}`) ?? 0);
    counterWrite(intOf(cf.likes), await countOf(commentPath, 'likes'), 'likes', commentFields, commentChanges);
    counterWrite(intOf(cf.repliesCount), repliesByParent.get(commentId) ?? 0, 'repliesCount', commentFields, commentChanges);
    if (stringOf(cf.postVisibility) !== visibility) {
      commentFields.postVisibility = { stringValue: visibility };
      commentChanges.push(`postVisibility ${stringOf(cf.postVisibility) ?? '(sem)'} -> ${visibility}`);
    }
    counterWrite(intOf(cf.repostsCount), reposts, 'repostsCount', commentFields, commentChanges);
    note(commentPath, commentChanges);
    if (APPLY && Object.keys(commentFields).length) await patch(commentPath, commentFields);
  }
}

console.log(plan.length ? plan.map((line) => `  ${line}`).join('\n') : '  nada a mudar');
console.log(`${plan.length} documento(s) ${APPLY ? 'atualizados' : 'a atualizar'}; ${movedUsers} perfil(is) com dados pessoais no documento público.`);
