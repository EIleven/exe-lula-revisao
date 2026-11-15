#!/usr/bin/env node
/**
 * Testa functions/src/push.ts (montagem das mensagens de push) sem emuladores nem rede: importa a versão compilada
 * (functions/lib/push.js, gerada por `npm --prefix functions run build`).
 *   node e2e/push-payload-check.mjs
 * Confere, para CADA tipo de notificação e nos dois idiomas: o texto, o destino exato do toque (post, comentário, perfil,
 * conversa), a tag de agrupamento, que mensagem direta nunca leva o conteúdo, os ajustes de Android e de navegador e o
 * agrupamento dos aparelhos por idioma. Sai com código 1 se algo falhar.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// PUSH_LIB só existe para o teste dos testes (rodar contra uma versão propositalmente quebrada e ver se ele falha).
const { buildPushContent, buildPushMessages, buildMulticast, normalizeLocale, normalizePlatform, shouldPushOnUpdate, wantsPush, ANDROID_CHANNEL_ID } = require(process.env.PUSH_LIB ?? '../functions/lib/push.js');

let falhas = 0;
let total = 0;
const confere = (nome, condicao, detalhe = '') => {
  total++;
  if (condicao) console.log(`OK    ${nome}`);
  else {
    falhas++;
    console.log(`FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  }
};

const ana = { userId: 'uid-ana', name: 'Ana Souza', username: 'ana' };
const base = (extra) => ({ actors: [ana], count: 1, ...extra });

// [tipo, entrada, título pt, texto pt, caminho pt, texto en]
const casos = [
  ['like_post', base({ type: 'like_post', entityId: 'p1', entityType: 'post' }), 'Nova curtida', 'Ana Souza curtiu sua publicação.', '/pt-BR/post/p1', 'Ana Souza liked your post.'],
  ['like_post (várias)', base({ type: 'like_post', entityId: 'p1', entityType: 'post', count: 4 }), 'Nova curtida', 'Ana Souza e outras 3 pessoas curtiram sua publicação.', '/pt-BR/post/p1', 'Ana Souza and 3 other people liked your post.'],
  ['like_comment', base({ type: 'like_comment', entityId: 'c1', entityParentId: 'p1', entityType: 'comment', previewText: 'olha isso' }), 'Nova curtida', 'Ana Souza curtiu seu comentário. “olha isso”', '/pt-BR/post/p1#comment-c1', 'Ana Souza liked your comment. “olha isso”'],
  ['repost de post', base({ type: 'repost', entityId: 'p1', entityType: 'post' }), 'Novo repost', 'Ana Souza repostou sua publicação.', '/pt-BR/post/p1', 'Ana Souza reposted your post.'],
  ['repost de comentário', base({ type: 'repost', entityId: 'c1', entityParentId: 'p1', entityType: 'comment' }), 'Novo repost', 'Ana Souza repostou seu comentário.', '/pt-BR/post/p1#comment-c1', 'Ana Souza reposted your comment.'],
  // O toque numa citação abre a CITAÇÃO (newPostId), o que a pessoa escreveu; sem ela (documentos antigos), o original.
  ['citação de post', base({ type: 'quote', entityId: 'p1', entityType: 'post', previewText: 'concordo', newPostId: 'q1' }), 'Nova citação', 'Ana Souza citou sua publicação. “concordo”', '/pt-BR/post/q1', 'Ana Souza quoted your post. “concordo”'],
  ['citação de post (sem newPostId)', base({ type: 'quote', entityId: 'p1', entityType: 'post' }), 'Nova citação', 'Ana Souza citou sua publicação.', '/pt-BR/post/p1', 'Ana Souza quoted your post.'],
  ['citação de comentário', base({ type: 'quote', entityId: 'c1', entityParentId: 'p1', entityType: 'comment', newPostId: 'q2' }), 'Nova citação', 'Ana Souza citou seu comentário.', '/pt-BR/post/q2', 'Ana Souza quoted your comment.'],
  ['citação de comentário (sem newPostId)', base({ type: 'quote', entityId: 'c1', entityParentId: 'p1', entityType: 'comment' }), 'Nova citação', 'Ana Souza citou seu comentário.', '/pt-BR/post/p1#comment-c1', 'Ana Souza quoted your comment.'],
  ['comentário', base({ type: 'comment_on_post', entityId: 'p1', entityType: 'post', previewText: 'boa!' }), 'Novo comentário', 'Ana Souza comentou na sua publicação. “boa!”', '/pt-BR/post/p1', 'Ana Souza commented on your post. “boa!”'],
  ['resposta', base({ type: 'reply_to_comment', entityId: 'c1', entityParentId: 'p1', entityType: 'comment', previewText: 'verdade' }), 'Nova resposta', 'Ana Souza respondeu ao seu comentário. “verdade”', '/pt-BR/post/p1#comment-c1', 'Ana Souza replied to your comment. “verdade”'],
  ['seguidor', base({ type: 'new_follower', entityId: 'uid-ana', entityType: 'user' }), 'Novo seguidor', 'Ana Souza começou a seguir você.', '/pt-BR/profile/uid-ana', 'Ana Souza started following you.'],
  ['menção em post', base({ type: 'mention_in_post', entityId: 'p1', entityType: 'post', previewText: 'oi @bia' }), 'Você foi mencionado(a)', 'Ana Souza mencionou você numa publicação. “oi @bia”', '/pt-BR/post/p1', 'Ana Souza mentioned you in a post. “oi @bia”'],
  ['menção em comentário', base({ type: 'mention_in_comment', entityId: 'c1', entityParentId: 'p1', entityType: 'comment' }), 'Você foi mencionado(a)', 'Ana Souza mencionou você num comentário.', '/pt-BR/post/p1#comment-c1', 'Ana Souza mentioned you in a comment.'],
  ['publicação de quem você segue', base({ type: 'new_post_from_user', entityId: 'x', newPostId: 'p9', previewText: 'novidade' }), 'Nova publicação', 'Ana Souza publicou. “novidade”', '/pt-BR/post/p9', 'Ana Souza posted. “novidade”'],
];
for (const [nome, entrada, titulo, texto, caminho, textoEn] of casos) {
  const pt = buildPushContent(entrada, 'n1', 'pt-BR');
  confere(`${nome} (pt-BR): título "${titulo}" e texto "${texto}"`, pt.title === titulo && pt.body === texto, `${pt.title} | ${pt.body}`);
  confere(`${nome}: o toque abre ${caminho}`, pt.path === caminho, pt.path);
  const en = buildPushContent(entrada, 'n1', 'en');
  confere(`${nome} (en): "${textoEn}" e destino com /en`, en.body === textoEn && en.path === caminho.replace('/pt-BR/', '/en/'), `${en.body} | ${en.path}`);
}

// Mensagem direta: o título é o REMETENTE e o conteúdo da mensagem NUNCA vai para o aviso (tela bloqueada, serviços do Google).
{
  const dm = buildPushContent({ type: 'new_message', actors: [ana], count: 1, entityId: 'conv1', previewText: 'SEGREDO da mensagem' }, 'n2', 'pt-BR');
  confere('mensagem direta: título é o remetente e o texto não revela o conteúdo', dm.title === 'Ana Souza' && dm.body === 'Enviou uma mensagem para você' && !/SEGREDO/.test(JSON.stringify(dm)), JSON.stringify(dm));
  confere('mensagem direta: o toque abre a conversa com o remetente', dm.path === '/pt-BR/messages/user/uid-ana', dm.path);
  const varias = buildPushContent({ type: 'new_message', actors: [ana], count: 3, entityId: 'conv1' }, 'n2', 'en');
  confere('várias mensagens: conta em vez de repetir', varias.body === '3 new messages', varias.body);
}

// O que avisa e quando: "nova conversa" não avisa (nasce ao ABRIR o chat, antes de qualquer mensagem); uma notificação
// agregada reenvia o aviso a cada mensagem nova, mas curtidas e afins só nas marcas (5, 10, 25...), sem spam.
{
  confere('"nova conversa" não gera push; os demais tipos geram', wantsPush('new_conversation') === false && wantsPush('new_message') && wantsPush('like_post') && wantsPush('comment_on_post'));
  confere('mensagem direta agregada: TODA mensagem nova reenvia o aviso', shouldPushOnUpdate('new_message', 1, 2) && shouldPushOnUpdate('new_message', 7, 8));
  confere('mensagem agregada que não cresceu (ex.: só abriu e leu) não reenvia', !shouldPushOnUpdate('new_message', 3, 3) && !shouldPushOnUpdate('new_message', 3, 2));
  confere('curtidas agregadas: não avisam a 2ª, 3ª e 4ª (spam)', !shouldPushOnUpdate('like_post', 1, 2) && !shouldPushOnUpdate('like_post', 2, 3) && !shouldPushOnUpdate('like_comment', 3, 4));
  confere('curtidas agregadas: avisam ao chegar em 5, 10 e 25', shouldPushOnUpdate('like_post', 4, 5) && shouldPushOnUpdate('like_post', 9, 10) && shouldPushOnUpdate('repost', 24, 25));
  confere('um salto que atravessa uma marca também avisa, e uma marca só avisa uma vez', shouldPushOnUpdate('like_post', 3, 12) && !shouldPushOnUpdate('like_post', 5, 6) && !shouldPushOnUpdate('like_post', 11, 12));
  confere('"nova conversa" nunca reenvia', !shouldPushOnUpdate('new_conversation', 1, 5));
}

// Texto longo é recortado; quebras de linha viram espaço.
{
  const longo = buildPushContent(base({ type: 'comment_on_post', entityId: 'p1', previewText: `linha 1\n\nlinha 2 ${'x'.repeat(200)}` }), 'n3', 'pt-BR');
  confere('trecho longo é recortado com reticências e sem quebra de linha', longo.body.includes('…') && !longo.body.includes('\n') && longo.body.length < 160, longo.body);
}

// Tipo desconhecido e ator sem nome não quebram.
{
  const generico = buildPushContent({ type: 'tipo_novo', actors: [{ userId: 'x' }], count: 1 }, 'n4', 'pt-BR');
  confere('tipo desconhecido vira aviso genérico com destino /notifications', generico.title === 'Exe. Lula' && generico.path === '/pt-BR/notifications', JSON.stringify(generico));
  const semNome = buildPushContent({ type: 'like_post', actors: [{ userId: 'x' }], count: 1, entityId: 'p1' }, 'n5', 'pt-BR');
  confere('ator sem nome vira "Alguém"', semNome.body === 'Alguém curtiu sua publicação.', semNome.body);
}

// A tag agrupa o mesmo assunto.
{
  const a = buildPushContent(base({ type: 'like_post', entityId: 'p1' }), 'n6', 'pt-BR');
  const b = buildPushContent(base({ type: 'like_post', entityId: 'p1', count: 5 }), 'n7', 'pt-BR');
  const c = buildPushContent(base({ type: 'like_post', entityId: 'p2' }), 'n8', 'pt-BR');
  confere('mesmo tipo e mesmo post compartilham a tag (o novo aviso substitui o antigo)', a.tag === b.tag && a.tag !== c.tag, `${a.tag} | ${b.tag} | ${c.tag}`);
}

// A mensagem FCM em si.
{
  const content = buildPushContent(base({ type: 'comment_on_post', entityId: 'p1', previewText: 'oi' }), 'n9', 'pt-BR');
  const msg = buildMulticast(content, ['t1', 't2'], 'https://exercitodolula.app', { type: 'comment_on_post', notificationId: 'n9' });
  confere('FCM: notification com título e texto (o Android mostra sozinho com o app fechado)', msg.notification.title === content.title && msg.notification.body === content.body);
  confere('FCM: data leva o destino absoluto, o tipo e o id (todos texto)', msg.data.url === 'https://exercitodolula.app/pt-BR/post/p1' && msg.data.type === 'comment_on_post' && msg.data.notificationId === 'n9' && Object.values(msg.data).every((v) => typeof v === 'string'), JSON.stringify(msg.data));
  confere('FCM Android: prioridade alta, canal, tag e ícone próprio', msg.android.priority === 'high' && msg.android.notification.channelId === ANDROID_CHANNEL_ID && msg.android.notification.tag === content.tag && msg.android.notification.icon === 'ic_stat_notify', JSON.stringify(msg.android));
  confere('FCM navegador: link, ícone e tag', msg.webpush.fcmOptions.link === 'https://exercitodolula.app/pt-BR/post/p1' && msg.webpush.notification.tag === content.tag && /icon-192/.test(msg.webpush.notification.icon));
  confere('FCM: comentário comum é entrega "normal" e mensagem/menção é "high"', msg.webpush.headers.Urgency === 'normal' && buildMulticast(content, ['t'], 'https://x', { type: 'new_message', notificationId: 'n' }).webpush.headers.Urgency === 'high');
}

// Agrupamento por idioma.
{
  const tokens = [
    { token: 'a', locale: 'pt-BR', platform: 'web' },
    { token: 'b', locale: 'en', platform: 'android' },
    { token: 'c', locale: 'pt-BR', platform: 'android' },
  ];
  const msgs = buildPushMessages(base({ type: 'like_post', entityId: 'p1' }), 'n10', tokens, 'https://exercitodolula.app');
  const pt = msgs.find((m) => m.notification.body.includes('curtiu'));
  const en = msgs.find((m) => m.notification.body.includes('liked'));
  confere('um aparelho por token, UMA mensagem por idioma', msgs.length === 2 && JSON.stringify(pt.tokens) === '["a","c"]' && JSON.stringify(en.tokens) === '["b"]', JSON.stringify(msgs.map((m) => m.tokens)));
}

confere('idioma e plataforma desconhecidos viram os padrões (pt-BR, web)', normalizeLocale('fr') === 'pt-BR' && normalizeLocale('en-US') === 'en' && normalizeLocale(undefined) === 'pt-BR' && normalizePlatform('tv') === 'web' && normalizePlatform('android') === 'android');

console.log(`${total - falhas} de ${total} conferências passaram`);
console.log(falhas ? 'RESULTADO: HÁ FALHAS' : 'RESULTADO: PASSOU');
process.exitCode = falhas ? 1 : 0;
