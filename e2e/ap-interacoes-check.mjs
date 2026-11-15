#!/usr/bin/env node
/**
 * Interações vindas do Fediverso (Like, Announce, Accept/Reject, Update, Delete, Create) no inbox, sem app, sem emuladores e
 * sem rede: um Fediverso simulado (servidores com chaves RSA reais) e o armazenamento em memória.
 *   node e2e/ap-interacoes-check.mjs        (ou: npm run e2e:ap-interacoes)
 *
 * O que precisa ser verdade, e antes não era:
 *   - curtir ou repostar um COMENTÁRIO nosso cai no comentário (e só nele), e o portão é o do autor DO COMENTÁRIO;
 *   - Undo de Like/Announce de comentário desfaz o marcador do comentário, não o do post;
 *   - Accept do nosso Follow o marca como aceito; Reject o desfaz (conta trancada que recusou não fica "Seguindo");
 *   - Update de um post/comentário remoto edita; Delete o transforma em túmulo; e SÓ o ator que o criou pode fazer isso;
 *   - a autoria é conferida: um Create cujo objeto mora em outro host, um Announce de objeto que não é o pedido e um Note
 *     servido por um host que diz ser de outra pessoa são recusados.
 *
 * Sai com código 1 se algo falhar.
 */
import { processInbox } from '../src/lib/activitypub/inbox.ts';
import { AS_PUBLIC } from '../src/lib/activitypub/gate.ts';
import { comSeguidores, contador, criarRemoto, ORIGEM, post, requisicao, T0 } from './helpers/ap-fediverse.mjs';

const { confere, encerra } = contador();
const CTX = 'https://www.w3.org/ns/activitystreams';

let seq = 0;
const idDe = (remoto, tipo) => `https://${remoto.host}/atividades/${tipo}-${++seq}`;
const enviar = (ctx, remoto, atividade) => processInbox(ctx.deps, requisicao(remoto, { atividade, relogio: ctx.rel }));

/** Casa com a Ana federando, um post federado (P1) e um comentário da Bia nele (C1). */
async function casa() {
  const ctx = await comSeguidores();
  const { teste, relogio } = ctx;
  teste.seedPost(post(relogio, { id: 'P1' }));
  teste.objects.set('P1', { postId: 'P1', uid: 'U_ANA', objectId: `${ORIGEM}/ap/notes/P1`, scope: 'public', state: 'federated', createdAtMs: T0, lastActivityAtMs: T0 });
  teste.seedComment({ postId: 'P1', id: 'C1', userId: 'U_BIA', text: 'um comentário da Bia' });
  return ctx;
}
const like = (remoto, objeto) => ({ '@context': CTX, id: idDe(remoto, 'like'), type: 'Like', actor: remoto.id, object: objeto });
const announce = (remoto, objeto) => ({ '@context': CTX, id: idDe(remoto, 'announce'), type: 'Announce', actor: remoto.id, object: objeto, to: [AS_PUBLIC], published: new Date(T0).toISOString() });
const undo = (remoto, interna) => ({ '@context': CTX, id: idDe(remoto, 'undo'), type: 'Undo', actor: remoto.id, object: interna });
const NOTA_P1 = `${ORIGEM}/ap/notes/P1`;
const COMENTARIO_C1 = `${ORIGEM}/ap/notes/P1/comments/C1`;

// ───────────── 1. Like e Announce: post x comentário ─────────────
{
  const ctx = await casa();
  const { teste, remotos } = ctx;
  const bia = remotos.bia;
  const r = await enviar(ctx, bia, like(bia, NOTA_P1));
  confere('LIKE · no POST: aceito, e o marcador vai para o post', r.reason === 'aceita-like' && teste.likes.has(`post:P1|${bia.id}`), JSON.stringify(r));

  const caio = remotos.caio;
  const c = await enviar(ctx, caio, like(caio, COMENTARIO_C1));
  confere('LIKE · no COMENTÁRIO: aceito como curtida do comentário', c.reason === 'aceita-like-comentario', JSON.stringify(c));
  confere('LIKE · o marcador vai para o COMENTÁRIO e o post NÃO ganha a curtida (antes ganhava, e notificava a pessoa errada)',
    teste.likes.has(`comment:P1/C1|${caio.id}`) && !teste.likes.has(`post:P1|${caio.id}`), JSON.stringify([...teste.likes.keys()]));

  const dup = await enviar(ctx, caio, like(caio, COMENTARIO_C1));
  confere('LIKE · repetir a curtida do comentário não duplica', dup.reason === 'ignorada-duplicado', JSON.stringify(dup));

  const u = await enviar(ctx, caio, undo(caio, { id: idDe(caio, 'like-original'), type: 'Like', actor: caio.id, object: COMENTARIO_C1 }));
  confere('UNDO · desfazer a curtida do comentário remove o marcador do COMENTÁRIO', u.reason === 'aceita-unlike' && !teste.likes.has(`comment:P1/C1|${caio.id}`), JSON.stringify(u));
  confere('UNDO · e não mexe na curtida do post de outra pessoa', teste.likes.has(`post:P1|${bia.id}`), 'apagou a curtida do post');

  const b = await enviar(ctx, remotos.duda, announce(remotos.duda, COMENTARIO_C1));
  confere('ANNOUNCE · de um COMENTÁRIO: aceito como repost do comentário', b.reason === 'aceita-announce-comentario' && teste.boosts.has(`comment:P1/C1|${remotos.duda.id}`) && !teste.boosts.has(`post:P1|${remotos.duda.id}`), JSON.stringify(b));
  const ub = await enviar(ctx, remotos.duda, undo(remotos.duda, { id: idDe(remotos.duda, 'ann-original'), type: 'Announce', actor: remotos.duda.id, object: COMENTARIO_C1 }));
  confere('UNDO · desfazer o repost do comentário remove o marcador do comentário', ub.reason === 'aceita-unannounce' && !teste.boosts.has(`comment:P1/C1|${remotos.duda.id}`), JSON.stringify(ub));
  const bp = await enviar(ctx, remotos.duda, announce(remotos.duda, NOTA_P1));
  confere('ANNOUNCE · do POST continua indo para o post', bp.reason === 'aceita-announce' && teste.boosts.has(`post:P1|${remotos.duda.id}`), JSON.stringify(bp));
}

// ───────────── 2. o portão do comentário: quem é protegido é o autor DELE ─────────────
{
  const ctx = await casa();
  const { teste, store, remotos } = ctx;
  const bia = remotos.bia;
  // a autora do COMENTÁRIO (U_BIA) bloqueou o domínio; a dona do post (Ana) não bloqueou ninguém
  await store.addUserBlock('U_BIA', { scope: 'domain', value: 'mastodon.social' });
  const r = await enviar(ctx, bia, like(bia, COMENTARIO_C1));
  confere('PORTÃO · quem a AUTORA DO COMENTÁRIO bloqueou não curte o comentário, mesmo sem a dona do post ter bloqueado', r.reason === 'descartada-bloqueio' && teste.likes.size === 0, JSON.stringify(r));
  const p = await enviar(ctx, bia, like(bia, NOTA_P1));
  confere('PORTÃO · e o POST da Ana continua aceitando (o bloqueio da Bia não é da Ana)', p.reason === 'aceita-like', JSON.stringify(p));

  teste.seedComment({ postId: 'P1', id: 'C2', userId: 'U_ANA', isDeleted: true });
  const caio = remotos.caio;
  const apagado = await enviar(ctx, caio, like(caio, `${ORIGEM}/ap/notes/P1/comments/C2`));
  confere('PORTÃO · curtir um comentário APAGADO é ignorado', apagado.reason === 'ignorada-alvo-inativo', JSON.stringify(apagado));
  const inexistente = await enviar(ctx, caio, like(caio, `${ORIGEM}/ap/notes/P1/comments/NAOEXISTE`));
  confere('PORTÃO · curtir um comentário que não existe é ignorado', inexistente.reason === 'ignorada-alvo-inativo', JSON.stringify(inexistente));
  teste.seedComment({ postId: 'P1', id: 'REM', userId: 'ap_x', isRemoteFediverse: true });
  const remoto = await enviar(ctx, caio, like(caio, `${ORIGEM}/ap/notes/P1/comments/REM`));
  confere('PORTÃO · comentário que NÃO é nosso (veio do Fediverso) não recebe curtida federada', remoto.reason === 'ignorada-alvo-inativo', JSON.stringify(remoto));
  teste.objects.set('P1', { ...teste.objects.get('P1'), state: 'deleted' });
  const semFederar = await enviar(ctx, caio, like(caio, COMENTARIO_C1));
  confere('PORTÃO · comentário de um post que NÃO está federado é ignorado', semFederar.reason === 'ignorada-alvo-inativo', JSON.stringify(semFederar));
}

// ───────────── 3. Accept / Reject do nosso Follow ─────────────
{
  const ctx = await casa();
  const { teste, remotos } = ctx;
  const bia = remotos.bia;
  const nossoFollow = (alvo, id = `${ORIGEM}/ap/users/ana_silva/activities/follow-abc-1`) => ({ id, type: 'Follow', actor: `${ORIGEM}/ap/users/ana_silva`, object: alvo.id });
  const resposta = (remoto, tipo, objeto) => ({ '@context': CTX, id: idDe(remoto, tipo.toLowerCase()), type: tipo, actor: remoto.id, object: objeto });

  teste.seedOutboundFollow('U_ANA', bia.id, 'pending');
  const aceito = await enviar(ctx, bia, resposta(bia, 'Accept', nossoFollow(bia)));
  confere('FOLLOW · Accept do Follow que a Ana mandou marca como ACEITO', aceito.reason === 'aceita-follow-aceito' && teste.outboundFollows.get(`U_ANA|${bia.id}`)?.status === 'accepted', JSON.stringify([aceito, [...teste.outboundFollows]]));

  const caio = remotos.caio;
  teste.seedOutboundFollow('U_ANA', caio.id, 'pending');
  const recusado = await enviar(ctx, caio, resposta(caio, 'Reject', nossoFollow(caio, `${ORIGEM}/ap/users/ana_silva/activities/follow-abc-2`)));
  confere('FOLLOW · Reject desfaz o "Seguindo" gravado por antecipação (conta trancada que recusou)', recusado.reason === 'aceita-follow-recusado' && !teste.outboundFollows.has(`U_ANA|${caio.id}`), JSON.stringify([recusado, [...teste.outboundFollows]]));

  const duda = remotos.duda;
  teste.seedOutboundFollow('U_ANA', duda.id, 'pending');
  const porId = await enviar(ctx, duda, resposta(duda, 'Accept', `${ORIGEM}/ap/users/ana_silva/activities/follow-abc-3`));
  confere('FOLLOW · Accept que traz só o ID do Follow (alguns servidores) também vale', porId.reason === 'aceita-follow-aceito' && teste.outboundFollows.get(`U_ANA|${duda.id}`)?.status === 'accepted', JSON.stringify(porId));

  const quemNaoSeguimos = await criarRemoto(ctx.rede, 'outro.com.br', 'zeca');
  const intruso = await enviar(ctx, quemNaoSeguimos, resposta(quemNaoSeguimos, 'Accept', nossoFollow(quemNaoSeguimos, `${ORIGEM}/ap/users/ana_silva/activities/follow-abc-4`)));
  confere('FOLLOW · Accept de quem a Ana NUNCA pediu para seguir é ignorado (não cria vínculo)', intruso.reason === 'ignorada-nao-seguia' && !teste.outboundFollows.has(`U_ANA|${quemNaoSeguimos.id}`), JSON.stringify(intruso));
  teste.seedOutboundFollow('U_ANA', quemNaoSeguimos.id, 'pending');
  const doutro = await enviar(ctx, quemNaoSeguimos, resposta(quemNaoSeguimos, 'Reject', { id: 'https://outro.com.br/follows/9', type: 'Follow', actor: 'https://outro.com.br/users/alguem', object: quemNaoSeguimos.id }));
  confere('FOLLOW · Reject de um Follow que NÃO é de alguém daqui é ignorado', doutro.reason === 'ignorada-alvo-desconhecido' && teste.outboundFollows.has(`U_ANA|${quemNaoSeguimos.id}`), JSON.stringify(doutro));
  const naoEFollow = await enviar(ctx, bia, resposta(bia, 'Accept', { id: 'https://mastodon.social/x/1', type: 'Like', actor: bia.id, object: 'https://mastodon.social/y' }));
  confere('FOLLOW · Accept de algo que não é Follow é ignorado', naoEFollow.reason === 'ignorada-tipo', JSON.stringify(naoEFollow));
}

// ───────────── 4. Update e Delete de conteúdo remoto: só o ator que o criou ─────────────
{
  const ctx = await casa();
  const { teste, remotos } = ctx;
  const bia = remotos.bia;
  const caio = remotos.caio;
  const objeto = `https://mastodon.social/users/bia/statuses/10`;
  teste.seedRemotePost({ apObjectId: objeto, actorId: bia.id, text: 'versão 1' });

  const nota = (conteudo, id = objeto) => ({ id, type: 'Note', attributedTo: bia.id, content: conteudo, to: [AS_PUBLIC] });
  const up = (remoto, obj) => ({ '@context': CTX, id: idDe(remoto, 'update'), type: 'Update', actor: remoto.id, object: obj });

  const r = await enviar(ctx, bia, up(bia, nota('<p>versão 2</p>')));
  confere('UPDATE · o autor edita o post que guardamos', r.reason === 'aceita-edicao-post' && teste.remotePosts.get(objeto).text === 'versão 2', JSON.stringify([r, teste.remotePosts.get(objeto)]));
  const alheio = await enviar(ctx, caio, up(caio, { id: objeto, type: 'Note', attributedTo: caio.id, content: 'sequestrado', to: [AS_PUBLIC] }));
  confere('UPDATE · outro ator NÃO consegue editar o post de alguém (e o host do objeto não é o dele)', alheio.reason.startsWith('ignorada') && teste.remotePosts.get(objeto).text === 'versão 2', JSON.stringify(alheio));
  const mesmoHost = await enviar(ctx, caio, up(caio, { id: `https://mastodon.social/users/caio/statuses/77`, type: 'Note', attributedTo: caio.id, content: 'x', to: [AS_PUBLIC] }));
  confere('UPDATE · edição de um id que não guardamos é ignorada', mesmoHost.reason === 'ignorada-sem-conteudo-local', JSON.stringify(mesmoHost));
  const foraDoHost = await enviar(ctx, bia, up(bia, nota('x', 'https://evil.com.br/notes/1')));
  confere('UPDATE · objeto que mora em OUTRO host é recusado já na validação (401, não edita nada)', foraDoHost.status === 401 && foraDoHost.reason === 'falsificacao-id-de-outro-host', JSON.stringify(foraDoHost));
  const semTexto = await enviar(ctx, bia, up(bia, nota('<p></p>')));
  confere('UPDATE · sem texto é ignorado', semTexto.reason === 'ignorada-sem-conteudo', JSON.stringify(semTexto));

  const del = (remoto, objetoId) => ({ '@context': CTX, id: idDe(remoto, 'delete'), type: 'Delete', actor: remoto.id, object: objetoId });
  const alheioDel = await enviar(ctx, caio, del(caio, objeto));
  confere('DELETE · outro ator NÃO apaga o post de alguém', alheioDel.reason === 'ignorada-sem-conteudo-local' && teste.remotePosts.get(objeto).isDeleted === false, JSON.stringify(alheioDel));
  const apagou = await enviar(ctx, bia, del(bia, { id: objeto, type: 'Tombstone' }));
  confere('DELETE · o autor apaga: o post guardado vira túmulo (some dos feeds)', apagou.reason === 'aceita-post-removido' && teste.remotePosts.get(objeto).isDeleted === true, JSON.stringify([apagou, teste.remotePosts.get(objeto)]));

  // conta removida na origem: o que guardamos dele também vira túmulo
  teste.seedRemotePost({ apObjectId: 'https://mastodon.social/users/bia/statuses/11', actorId: bia.id, text: 'outro' });
  teste.seedRemotePost({ apObjectId: 'https://mastodon.social/users/bia/statuses/12', actorId: bia.id, text: 'mais um' });
  const conta = await enviar(ctx, bia, del(bia, bia.id));
  confere('DELETE · conta removida na origem: o conteúdo dela que guardamos vira túmulo',
    conta.reason === 'aceita-ator-removido' && [...teste.remotePosts.values()].filter((p) => p.actorId === bia.id).every((p) => p.isDeleted), JSON.stringify(conta));
}

// ───────────── 5. autoria: o objeto só vale se o servidor do autor o servir ─────────────
{
  const ctx = await casa();
  const { teste, rede, remotos } = ctx;
  const booster = await criarRemoto(rede, 'mastodon.social', 'impulsionadora');
  const autora = await criarRemoto(rede, 'mastodon.social', 'gargron');
  const hostil = await criarRemoto(rede, 'evil.com.br', 'mallory');
  teste.seedOutboundFollow('U_ANA', booster.id);
  teste.seedOutboundFollow('U_ANA', hostil.id);
  const servir = (url, json) => rede.atores.set(url, () => ({ status: 200, json }));
  const nota = (id, autor, extra = {}) => ({ '@context': CTX, id, type: 'Note', attributedTo: autor.id, content: '<p>texto</p>', to: [AS_PUBLIC], cc: [], published: new Date(T0).toISOString(), ...extra });

  const legitima = 'https://mastodon.social/users/gargron/statuses/1';
  servir(legitima, nota(legitima, autora));
  const ok = await enviar(ctx, booster, announce(booster, legitima));
  confere('AUTORIA · repost de um Note servido pelo host do próprio autor: aceito', ok.reason === 'aceita-announce-remoto' && teste.ingeridos.some((i) => i.tipo === 'announce' && i.autorId === autora.id), JSON.stringify([ok, teste.ingeridos]));

  const forjada = 'https://evil.com.br/notas/1';
  servir(forjada, nota(forjada, autora));
  const f = await enviar(ctx, hostil, announce(hostil, forjada));
  confere('AUTORIA · Note servido por evil.com.br dizendo ser da Gargron é recusado (não vai para o feed com o nome dela)', f.reason === 'ignorada-autoria-de-outro-host' && !teste.ingeridos.some((i) => i.apObjectId === forjada), JSON.stringify([f, teste.ingeridos]));

  const pedida = 'https://evil.com.br/notas/2';
  servir(pedida, nota('https://evil.com.br/notas/OUTRA-COISA', hostil));
  const d = await enviar(ctx, hostil, announce(hostil, pedida));
  confere('AUTORIA · objeto devolvido com id DIFERENTE do pedido é recusado', d.reason === 'ignorada-objeto-divergente' && !teste.ingeridos.some((i) => i.apObjectId === pedida), JSON.stringify([d, teste.ingeridos]));

  // Create
  const bia = remotos.bia;
  teste.seedOutboundFollow('U_ANA', bia.id);
  const criar = (remoto, objetoId) => ({ '@context': CTX, id: idDe(remoto, 'create'), type: 'Create', actor: remoto.id, to: [AS_PUBLIC], object: { id: objetoId, type: 'Note', attributedTo: remoto.id, content: '<p>oi</p>', to: [AS_PUBLIC], published: new Date(T0).toISOString() } });
  const alheio = await enviar(ctx, bia, criar(bia, 'https://outro.com.br/notas/77'));
  confere('CREATE · objeto cujo id mora em OUTRO host é recusado já na validação (reservaria o id de um post alheio)', alheio.status === 401 && alheio.reason === 'falsificacao-id-de-outro-host' && !teste.remotePosts.has('https://outro.com.br/notas/77'), JSON.stringify(alheio));
  const proprio = await enviar(ctx, bia, criar(bia, 'https://mastodon.social/users/bia/statuses/500'));
  confere('CREATE · objeto do próprio host do ator: aceito', proprio.reason === 'aceita-post-remoto', JSON.stringify(proprio));
}

encerra('Interações do Fediverso OK: comentário é comentário, Accept/Reject fecham o Follow, edição e remoção só valem para o autor, e a autoria é conferida.');
