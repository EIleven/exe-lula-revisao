#!/usr/bin/env node
/**
 * Testa a MODERAÇÃO e a ADMINISTRAÇÃO da federação (src/lib/activitypub/moderation.ts e admin.ts) com um Fediverso
 * simulado: remover seguidor, bloquear ator e servidor, e o painel de quem administra a rede.
 *   node e2e/ap-moderation-check.mjs        (ou: npm run e2e:ap-moderacao)
 *
 * O que se prova: que remover/bloquear tem efeito DE VERDADE (o vínculo some, o aviso sai assinado, o que vem depois
 * é descartado), que bloquear um servidor NÃO o contata, que uma pessoa só mexe nos próprios seguidores e que o painel
 * valida o que entra, deixa rastro e vale no envio.
 *
 * Sai com código 1 se algo falhar.
 */
import { signRequest, verifyHttpSignature } from '../src/lib/activitypub/signature.ts';
import { processInbox } from '../src/lib/activitypub/inbox.ts';
import { disableFederation, enableFederation, getFederationStatus, pauseFederation } from '../src/lib/activitypub/account.ts';
import { runWorker } from '../src/lib/activitypub/worker.ts';
import {
  MAX_BLOCKS, addBlock, listBlocks, listFollowersForUser, normalizeBlock, removeBlock, removeFollower,
} from '../src/lib/activitypub/moderation.ts';
import { adminOverview, adminSetInstanceRule, adminSetPlatform, diaUtc } from '../src/lib/activitypub/admin.ts';
import {
  HOST, ORIGEM, T0, comSeguidores, contador, criarRemoto, entregasDe, follow, montar, post, requisicao, tarefa,
} from './helpers/ap-fediverse.mjs';

const { confere, encerra } = contador();
const rodar = (ctx, over = {}) => runWorker(ctx.deps, { budgetMs: 10_000, maxJobs: 25, deliveryBatch: 8, ...over });
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rejects = (ctx) => [...ctx.teste.deliveries.values()].filter((d) => d.op === 'reject');
const seguem = async (ctx) => (await ctx.store.listFollowers('U_ANA', 100, null)).map((f) => f.actorId).sort();
const mod = (ctx) => ({ store: ctx.store, now: ctx.deps.now, ownHost: HOST, origin: ORIGEM, randomId: ctx.deps.randomId });

// ═════════════ 1. Listar seguidores ═════════════

{
  const ctx = await comSeguidores();
  const { bia, caio, duda } = ctx.remotos;
  const p1 = await listFollowersForUser(ctx.deps, 'U_ANA', 2, null);
  confere('SEGUIDORES · a primeira página respeita o limite e indica que há mais', p1.items.length === 2 && p1.next !== null, JSON.stringify(p1));
  const p2 = await listFollowersForUser(ctx.deps, 'U_ANA', 2, p1.next);
  confere('SEGUIDORES · a segunda página traz o resto e encerra', p2.items.length === 1 && p2.next === null, JSON.stringify(p2));
  const todos = [...p1.items, ...p2.items].map((i) => i.actorId).sort();
  confere('SEGUIDORES · as páginas juntas cobrem todos, sem repetir', igual(todos, [bia.id, caio.id, duda.id].sort()), JSON.stringify(todos));
  const item = p1.items.concat(p2.items).find((i) => i.actorId === duda.id);
  confere('SEGUIDORES · cada item traz o @ completo, o nome e o servidor', item.handle === 'duda@pleroma.exemplo.com.br' && item.name === 'duda em pleroma.exemplo.com.br' && item.domain === 'pleroma.exemplo.com.br', JSON.stringify(item));
  const vazio = await listFollowersForUser(ctx.deps, 'U_BIA', 50, null);
  confere('SEGUIDORES · outra pessoa não vê os seguidores da Ana', vazio.items.length === 0, JSON.stringify(vazio));
  const campos = Object.keys(item).sort().join(',');
  confere('SEGUIDORES · a lista NÃO expõe inbox, atividade de Follow nem chaves', campos === 'actorId,domain,handle,name,sinceMs', campos);
}

// ═════════════ 2. Remover seguidor ═════════════

{
  const ctx = await comSeguidores();
  const { bia, caio, duda } = ctx.remotos;
  const { store, teste, rede, deps } = ctx;

  const outra = await removeFollower(mod(ctx), 'U_BIA', duda.id, true);
  confere('REMOVER · uma pessoa NÃO remove seguidor de outra (responde como inexistente)', outra === 'inexistente' && (await seguem(ctx)).length === 3 && rejects(ctx).length === 0, `${outra}`);

  const r = await removeFollower(mod(ctx), 'U_ANA', duda.id, true);
  confere('REMOVER · remove o seguidor', r === 'removido' && igual(await seguem(ctx), [bia.id, caio.id].sort()), `${r} ${JSON.stringify(await seguem(ctx))}`);
  const st = await getFederationStatus(deps, 'U_ANA');
  confere('REMOVER · a contagem do status cai', st.followers === 2, String(st.followers));

  const fila = rejects(ctx);
  confere('REMOVER · enfileira UM Reject para o servidor dele', fila.length === 1 && fila[0].domain === 'pleroma.exemplo.com.br' && fila[0].targetInbox === duda.sharedInbox, JSON.stringify(fila.map((d) => [d.domain, d.targetInbox])));
  const corpo = JSON.parse(fila[0].body);
  confere('REMOVER · o Reject devolve o Follow original, do ator certo', corpo.type === 'Reject' && corpo.actor === `${ORIGEM}/ap/users/ana_silva` && corpo.object.type === 'Follow' && corpo.object.actor === duda.id && corpo.object.id === `https://${duda.host}/follows/duda-1`, JSON.stringify(corpo).slice(0, 160));

  const stats = await rodar(ctx);
  const env = entregasDe(rede);
  confere('REMOVER · o worker entrega o Reject', stats.sent === 1 && env.length === 1 && env[0].url === duda.sharedInbox && env[0].json.type === 'Reject', `${stats.sent} enviada(s), ${env.length} POST(s)`);
  const publica = teste.handles.get('ana_silva').publicKeyPem;
  const e = env[0];
  const cab = signRequest({ method: 'POST', url: e.url, body: e.body, privateKeyPem: e.sign.privateKeyPem, keyId: e.sign.keyId, now: deps.now() });
  const v = verifyHttpSignature({ method: 'POST', path: new URL(e.url).pathname, headers: cab, body: Buffer.from(e.body), now: deps.now() }, publica);
  confere('REMOVER · o Reject sai assinado com a chave do ator', v.ok && e.sign.keyId === `${ORIGEM}/ap/users/ana_silva#main-key`, JSON.stringify(v));

  const de_novo = await removeFollower(mod(ctx), 'U_ANA', duda.id, true);
  confere('REMOVER · remover de novo é "inexistente" e não gera outro Reject', de_novo === 'inexistente' && rejects(ctx).length === 1, `${de_novo} ${rejects(ctx).length}`);

  // depois de removida, a Duda deixa de receber o que a Ana publica
  deps.now = () => ctx.relogio.t;
  ctx.relogio.t += 1000;
  teste.seedPost(post(ctx.relogio, { id: 'P1' }));
  await store.enqueueJob(tarefa(ctx.relogio, 'create', 'P1'));
  rede.posts.length = 0;
  await rodar(ctx);
  const destinos = entregasDe(rede).map((x) => x.url).sort();
  confere('REMOVER · o post seguinte vai só para quem ainda segue', igual(destinos, [bia.sharedInbox]), JSON.stringify(destinos));
}

// Reject cancelado quando a situação mudou antes de sair
{
  const ctx = await comSeguidores();
  const { duda } = ctx.remotos;
  await removeFollower(mod(ctx), 'U_ANA', duda.id, true);
  // a Duda segue de novo ANTES de o aviso sair: um Reject atrasado desfaria o vínculo novo
  const refazer = await processInbox(ctx.deps, requisicao(duda, { atividade: follow(duda, 'ana_silva', `https://${duda.host}/follows/duda-2`), relogio: ctx.rel }));
  confere('REMOVER · ela pode voltar a seguir', refazer.reason === 'aceita-follow' && (await seguem(ctx)).includes(duda.id), JSON.stringify(refazer));
  ctx.rede.posts.length = 0;
  const stats = await rodar(ctx);
  const reject = rejects(ctx)[0];
  confere('REMOVER · o Reject atrasado é CANCELADO se ela voltou a seguir', reject.status === 'cancelled' && reject.lastDetail === 'seguidor-refeito' && !entregasDe(ctx.rede).some((x) => x.json.type === 'Reject'), `${reject.status}/${reject.lastDetail}`);
  confere('REMOVER · e o Accept do novo Follow sai normalmente', entregasDe(ctx.rede).some((x) => x.json.type === 'Accept' && x.url === duda.sharedInbox), JSON.stringify(entregasDe(ctx.rede).map((x) => x.json.type)));
}

// Reject com a conta pausada
{
  const ctx = await comSeguidores();
  await removeFollower(mod(ctx), 'U_ANA', ctx.remotos.bia.id, true);
  await pauseFederation(ctx.deps, 'U_ANA');
  ctx.rede.posts.length = 0;
  await rodar(ctx);
  const reject = rejects(ctx)[0];
  confere('REMOVER · conta pausada: o Reject NÃO sai (pausa é interrupção)', reject.status === 'cancelled' && reject.lastDetail === 'conta-inativa' && ctx.rede.posts.length === 0, `${reject.status}/${reject.lastDetail}`);
}

// ═════════════ 3. Bloquear ator ═════════════

{
  const ctx = await comSeguidores();
  const { bia, caio, duda } = ctx.remotos;
  const r = await addBlock(mod(ctx), 'U_ANA', { scope: 'actor', value: caio.id });
  confere('BLOQUEIO ATOR · bloqueia e remove o vínculo', r.ok && r.removedFollowers === 1 && igual(await seguem(ctx), [bia.id, duda.id].sort()), JSON.stringify(r));
  confere('BLOQUEIO ATOR · o bloqueio fica registrado', igual(await listBlocks(ctx.deps, 'U_ANA'), [{ scope: 'actor', value: caio.id }]), JSON.stringify(await listBlocks(ctx.deps, 'U_ANA')));
  confere('BLOQUEIO ATOR · avisa o servidor dele com um Reject', rejects(ctx).length === 1 && rejects(ctx)[0].domain === 'mastodon.social', JSON.stringify(rejects(ctx).map((d) => d.domain)));

  const tentativa = await processInbox(ctx.deps, requisicao(caio, { atividade: follow(caio, 'ana_silva', `https://${caio.host}/follows/caio-9`), relogio: ctx.rel }));
  confere('BLOQUEIO ATOR · um novo Follow dele é descartado', tentativa.reason === 'descartada-bloqueio' && !(await seguem(ctx)).includes(caio.id), JSON.stringify(tentativa));
  confere('BLOQUEIO ATOR · e nenhum Accept é enfileirado', ![...ctx.teste.deliveries.values()].some((d) => d.op === 'accept'), 'Accept foi enfileirado');

  const outroDoMesmoServidor = await processInbox(ctx.deps, requisicao(bia, { atividade: follow(bia, 'ana_silva', `https://${bia.host}/follows/bia-9`), relogio: ctx.rel }));
  confere('BLOQUEIO ATOR · bloquear UM ator não afeta os outros do mesmo servidor', outroDoMesmoServidor.reason === 'aceita-follow', JSON.stringify(outroDoMesmoServidor));

  const dupla = await addBlock(mod(ctx), 'U_ANA', { scope: 'actor', value: caio.id });
  confere('BLOQUEIO ATOR · bloquear de novo é idempotente (um registro só, nada removido)', dupla.ok && dupla.removedFollowers === 0 && (await listBlocks(ctx.deps, 'U_ANA')).length === 1, JSON.stringify(dupla));

  const sobDaBia = await listBlocks(ctx.deps, 'U_BIA');
  confere('BLOQUEIO ATOR · o bloqueio é só da Ana', sobDaBia.length === 0, JSON.stringify(sobDaBia));

  const des = await removeBlock(mod(ctx), 'U_ANA', { scope: 'actor', value: caio.id });
  const volta = await processInbox(ctx.deps, requisicao(caio, { atividade: follow(caio, 'ana_silva', `https://${caio.host}/follows/caio-10`), relogio: ctx.rel }));
  confere('BLOQUEIO ATOR · desbloquear permite seguir de novo', des.ok && volta.reason === 'aceita-follow', JSON.stringify([des, volta]));
}

// ═════════════ 4. Bloquear servidor ═════════════

{
  const ctx = await comSeguidores();
  const { duda } = ctx.remotos;
  // um seguidor num SUBDOMÍNIO do servidor que será bloqueado, e outro de um domínio apenas parecido
  const hugo = await criarRemoto(ctx.rede, 'mobile.mastodon.social', 'hugo');
  const vizinho = await criarRemoto(ctx.rede, 'notmastodon.social', 'ivo');
  for (const r0 of [hugo, vizinho]) await processInbox(ctx.deps, requisicao(r0, { atividade: follow(r0, 'ana_silva'), relogio: ctx.rel }));
  ctx.rede.posts.length = 0;
  const r = await addBlock(mod(ctx), 'U_ANA', { scope: 'domain', value: ' MASTODON.social. ' });
  confere('BLOQUEIO SERVIDOR · remove os seguidores do servidor E dos subdomínios (bia, caio, hugo), e só eles', r.ok && r.removedFollowers === 3 && igual(await seguem(ctx), [duda.id, vizinho.id].sort()), JSON.stringify(r) + JSON.stringify(await seguem(ctx)));
  confere('BLOQUEIO SERVIDOR · guarda o domínio normalizado', igual(await listBlocks(ctx.deps, 'U_ANA'), [{ scope: 'domain', value: 'mastodon.social' }]), JSON.stringify(await listBlocks(ctx.deps, 'U_ANA')));
  confere('BLOQUEIO SERVIDOR · NÃO enfileira aviso: quem foi bloqueado não é contatado', rejects(ctx).length === 0, `${rejects(ctx).length} Reject(s)`);
  await rodar(ctx);
  confere('BLOQUEIO SERVIDOR · nenhum POST sai para o servidor bloqueado', !ctx.rede.posts.some((p) => { const h = new URL(p.url).hostname; return h === 'mastodon.social' || h.endsWith('.mastodon.social'); }), JSON.stringify(ctx.rede.posts.map((p) => p.url)));

  const novo = await criarRemoto(ctx.rede, 'mastodon.social', 'eva');
  const sub = await criarRemoto(ctx.rede, 'mobile.mastodon.social', 'fabio');
  const e1 = await processInbox(ctx.deps, requisicao(novo, { atividade: follow(novo, 'ana_silva'), relogio: ctx.rel }));
  const e2 = await processInbox(ctx.deps, requisicao(sub, { atividade: follow(sub, 'ana_silva'), relogio: ctx.rel }));
  confere('BLOQUEIO SERVIDOR · um Follow novo do servidor é descartado', e1.reason === 'descartada-bloqueio', JSON.stringify(e1));
  confere('BLOQUEIO SERVIDOR · o bloqueio vale para os SUBDOMÍNIOS', e2.reason === 'descartada-bloqueio', JSON.stringify(e2));
  const parecido = await criarRemoto(ctx.rede, 'notmastodon.social', 'gil');
  const e3 = await processInbox(ctx.deps, requisicao(parecido, { atividade: follow(parecido, 'ana_silva'), relogio: ctx.rel }));
  confere('BLOQUEIO SERVIDOR · e NÃO pega domínio apenas parecido (notmastodon.social)', e3.reason === 'aceita-follow', JSON.stringify(e3));

  const des = await removeBlock(mod(ctx), 'U_ANA', { scope: 'domain', value: 'mastodon.social' });
  const e4 = await processInbox(ctx.deps, requisicao(novo, { atividade: follow(novo, 'ana_silva', `https://${novo.host}/follows/eva-2`), relogio: ctx.rel }));
  confere('BLOQUEIO SERVIDOR · desbloquear permite seguir de novo', des.ok && e4.reason === 'aceita-follow', JSON.stringify([des, e4]));
}

// ═════════════ 5. Validação dos bloqueios ═════════════

{
  const ruins = [
    [{ scope: 'domain', value: 'localhost' }, 'valor-invalido'],
    [{ scope: 'domain', value: 'https://mastodon.social' }, 'valor-invalido'],
    [{ scope: 'domain', value: 'a b.com' }, 'valor-invalido'],
    [{ scope: 'domain', value: '' }, 'valor-invalido'],
    [{ scope: 'domain', value: 42 }, 'valor-invalido'],
    [{ scope: 'domain', value: HOST }, 'proprio-dominio'],
    [{ scope: 'domain', value: `www.${HOST}` }, 'proprio-dominio'],
    [{ scope: 'actor', value: 'http://mastodon.social/users/x' }, 'valor-invalido'],
    [{ scope: 'actor', value: 'https://user:senha@mastodon.social/users/x' }, 'valor-invalido'],
    [{ scope: 'actor', value: 'nao é url' }, 'valor-invalido'],
    [{ scope: 'actor', value: `https://${HOST}/ap/users/bia` }, 'proprio-dominio'],
    [{ scope: 'actor', value: `https://${'a'.repeat(2100)}.com/x` }, 'valor-invalido'],
    [{ scope: 'tudo', value: 'mastodon.social' }, 'valor-invalido'],
    [{ scope: undefined, value: 'mastodon.social' }, 'valor-invalido'],
    [{ scope: {}, value: {} }, 'valor-invalido'],
  ];
  const ctx = await comSeguidores();
  let tudoRecusado = true;
  let detalhe = '';
  for (const [entrada, motivo] of ruins) {
    const r = await addBlock(mod(ctx), 'U_ANA', entrada);
    const n = normalizeBlock(entrada, HOST);
    if (r.ok || r.reason !== motivo || n.ok) { tudoRecusado = false; detalhe += ` ${JSON.stringify(entrada).slice(0, 50)}→${JSON.stringify(r)}`; }
  }
  confere(`VALIDAÇÃO · ${ruins.length} entradas inválidas recusadas com o motivo certo`, tudoRecusado, detalhe);
  confere('VALIDAÇÃO · e nada foi gravado nem removido por elas', (await listBlocks(ctx.deps, 'U_ANA')).length === 0 && (await seguem(ctx)).length === 3, 'sobrou efeito');

  const bom = normalizeBlock({ scope: 'actor', value: '  https://mastodon.social/users/bia  ' }, HOST);
  confere('VALIDAÇÃO · o id do ator é guardado EXATO (sem espaços), porque é com esse texto que casamos', bom.ok && bom.block.value === 'https://mastodon.social/users/bia', JSON.stringify(bom));

  // teto de bloqueios por pessoa
  const cheio = await comSeguidores();
  for (let i = 0; i < MAX_BLOCKS; i++) await cheio.store.addUserBlock('U_ANA', { scope: 'domain', value: `d${i}.exemplo.com.br` });
  const estoura = await addBlock(mod(cheio), 'U_ANA', { scope: 'domain', value: 'um-a-mais.exemplo.com.br' });
  confere('VALIDAÇÃO · acima do teto de bloqueios, recusa', !estoura.ok && estoura.reason === 'limite', JSON.stringify(estoura));
  const repetido = await addBlock(mod(cheio), 'U_ANA', { scope: 'domain', value: 'd5.exemplo.com.br' });
  confere('VALIDAÇÃO · mas repetir um que já existe continua valendo (idempotente no teto)', repetido.ok, JSON.stringify(repetido));
}

// ═════════════ 6. Administração: plataforma ═════════════

{
  const ctx = await comSeguidores();
  const admin = { store: ctx.store, now: ctx.deps.now, ownHost: HOST };

  const nada = await adminSetPlatform(admin, 'U_ADM', { naoExiste: true, outro: 1 });
  confere('ADMIN · campos desconhecidos são ignorados: sem campo válido, "nada a mudar"', !nada.ok && nada.reason === 'nada-a-mudar', JSON.stringify(nada));
  for (const ruim of [{ enabled: 'true' }, { enabled: 1 }, { killSwitch: 'sim' }, { mode: 'qualquer' }, { mode: null }]) {
    const r = await adminSetPlatform(admin, 'U_ADM', ruim);
    confere(`ADMIN · valor inválido ${JSON.stringify(ruim)} é recusado`, !r.ok && r.reason === 'valor-invalido', JSON.stringify(r));
  }
  confere('ADMIN · e a recusa não mudou nada', igual(await ctx.store.getPlatform(), { enabled: true, killSwitch: false, mode: 'open' }), JSON.stringify(await ctx.store.getPlatform()));

  // o botão de emergência vale de verdade: com ele ligado o worker não entrega nada e a fila fica intacta
  ctx.relogio.t += 1000;
  ctx.teste.seedPost(post(ctx.relogio, { id: 'P1' }));
  await ctx.store.enqueueJob(tarefa(ctx.relogio, 'create', 'P1'));
  const botao = await adminSetPlatform(admin, 'U_ADM', { killSwitch: true });
  confere('ADMIN · liga o botão de emergência', botao.ok && botao.platform.killSwitch === true, JSON.stringify(botao));
  ctx.rede.posts.length = 0;
  await rodar(ctx);
  const tarefaParada = [...ctx.teste.jobs.values()][0];
  confere('ADMIN · com o botão ligado NADA sai e a fila fica intacta', ctx.rede.posts.length === 0 && tarefaParada.state === 'pending', `${ctx.rede.posts.length} POST(s), tarefa ${tarefaParada.state}`);
  await adminSetPlatform(admin, 'U_ADM', { killSwitch: false });
  await rodar(ctx);
  confere('ADMIN · desligado o botão, a fila segue de onde parou', entregasDe(ctx.rede).filter((x) => x.json.type === 'Create').length === 2, `${ctx.rede.posts.length} POST(s)`);
  const desliga = await adminSetPlatform(admin, 'U_ADM', { killSwitch: false, mode: 'allowlist' });
  confere('ADMIN · desligar o botão e mudar o modo na mesma chamada', desliga.ok && desliga.platform.killSwitch === false && desliga.platform.mode === 'allowlist', JSON.stringify(desliga));
  confere('ADMIN · a política da casa acompanha o modo', (await ctx.store.getInstancePolicy()).mode === 'allowlist', JSON.stringify(await ctx.store.getInstancePolicy()));

  const trilha = ctx.teste.audit.filter((a) => a.kind === 'policy' && a.decision === 'plataforma-alterada');
  confere('ADMIN · toda mudança deixa rastro (quem e o quê)', trilha.length === 3 && trilha.every((a) => a.uid === 'U_ADM') && trilha[0].reason === 'killSwitch=true', JSON.stringify(trilha));
}

// ═════════════ 7. Administração: regras por servidor ═════════════

{
  const ctx = await comSeguidores();
  const admin = { store: ctx.store, now: ctx.deps.now, ownHost: HOST };
  const { bia, duda } = ctx.remotos;

  for (const [dom, acao, motivo] of [
    ['localhost', 'suspend', 'dominio-invalido'], ['http://x.com', 'suspend', 'dominio-invalido'], [42, 'suspend', 'dominio-invalido'],
    [HOST, 'suspend', 'proprio-dominio'], [`sub.${HOST}`, 'allow', 'proprio-dominio'],
    ['mastodon.social', 'bloquear', 'valor-invalido'], ['mastodon.social', undefined, 'valor-invalido'], ['mastodon.social', 7, 'valor-invalido'],
  ]) {
    const r = await adminSetInstanceRule(admin, 'U_ADM', dom, acao);
    confere(`ADMIN REGRA · ${JSON.stringify(dom)} + ${JSON.stringify(acao)} é recusado (${motivo})`, !r.ok && r.reason === motivo, JSON.stringify(r));
  }
  confere('ADMIN REGRA · e as recusas não gravaram regra', Object.keys((await ctx.store.getInstancePolicy()).rules).length === 0, JSON.stringify(await ctx.store.getInstancePolicy()));

  // suspender um servidor: a entrada fecha e a saída que estava na fila é cancelada
  ctx.relogio.t += 1000;
  ctx.teste.seedPost(post(ctx.relogio, { id: 'P1' }));
  await ctx.store.enqueueJob(tarefa(ctx.relogio, 'create', 'P1'));
  const r = await adminSetInstanceRule(admin, 'U_ADM', ' Pleroma.Exemplo.com.br ', 'suspend');
  confere('ADMIN REGRA · suspende um servidor (domínio normalizado)', r.ok && igual((await ctx.store.getInstancePolicy()).rules, { 'pleroma.exemplo.com.br': { action: 'suspend' } }), JSON.stringify(await ctx.store.getInstancePolicy()));
  ctx.rede.posts.length = 0;
  await rodar(ctx);
  const destinos = entregasDe(ctx.rede).map((x) => x.url);
  confere('ADMIN REGRA · o servidor suspenso não recebe o que estava na fila', igual(destinos, [bia.sharedInbox]), JSON.stringify(destinos));
  const doDuda = entregasDe(ctx.rede).length;
  const entregaSuspensa = [...ctx.teste.deliveries.values()].find((d) => d.domain === 'pleroma.exemplo.com.br');
  confere('ADMIN REGRA · a entrega fica cancelada, com o motivo', !entregaSuspensa || (entregaSuspensa.status === 'cancelled' && entregaSuspensa.lastDetail === 'dominio-recusado'), JSON.stringify(entregaSuspensa && [entregaSuspensa.status, entregaSuspensa.lastDetail]));
  const entra = await processInbox(ctx.deps, requisicao(duda, { atividade: follow(duda, 'ana_silva', `https://${duda.host}/follows/duda-7`), relogio: ctx.rel }));
  confere('ADMIN REGRA · e o que chega dele é descartado', entra.reason === 'descartada-suspensa', JSON.stringify(entra));

  const tira = await adminSetInstanceRule(admin, 'U_ADM', 'pleroma.exemplo.com.br', null);
  confere('ADMIN REGRA · null remove a regra', tira.ok && Object.keys((await ctx.store.getInstancePolicy()).rules).length === 0, JSON.stringify(tira));
  const silencia = await adminSetInstanceRule(admin, 'U_ADM', 'mastodon.social', 'silence');
  confere('ADMIN REGRA · silenciar é uma regra distinta de suspender', silencia.ok && (await ctx.store.getInstancePolicy()).rules['mastodon.social'].action === 'silence', JSON.stringify(await ctx.store.getInstancePolicy()));

  const trilha = ctx.teste.audit.filter((a) => a.kind === 'policy' && a.domain);
  confere('ADMIN REGRA · cada mudança fica na trilha, com o domínio e quem fez', trilha.length === 3 && trilha.every((a) => a.uid === 'U_ADM') && igual(trilha.map((a) => a.decision), ['regra-suspend', 'regra-removida', 'regra-silence']), JSON.stringify(trilha.map((a) => a.decision)));
  void doDuda;
}

// ═════════════ 8. Administração: visão geral ═════════════

{
  const ctx = await comSeguidores();
  const admin = { store: ctx.store, now: ctx.deps.now, ownHost: HOST };
  await adminSetInstanceRule(admin, 'U_ADM', 'zeta.exemplo.com.br', 'suspend');
  await adminSetInstanceRule(admin, 'U_ADM', 'alfa.exemplo.com.br', 'silence');
  const v = await adminOverview(admin);
  confere('PAINEL · mostra o estado da plataforma', igual(v.platform, { enabled: true, killSwitch: false, mode: 'open' }), JSON.stringify(v.platform));
  confere('PAINEL · lista as regras em ordem alfabética', igual(v.rules, [{ domain: 'alfa.exemplo.com.br', action: 'silence' }, { domain: 'zeta.exemplo.com.br', action: 'suspend' }]), JSON.stringify(v.rules));
  confere('PAINEL · mostra a fila (tarefas, entregas e mortas)', typeof v.queue.jobs === 'number' && typeof v.queue.deliveries === 'number' && v.queue.dead === 0, JSON.stringify(v.queue));
  confere('PAINEL · mostra os contadores do dia', v.counters.today['seguidores.novos'] === 3 && v.counters.today['admin.regra-de-instancia'] === 2, JSON.stringify(v.counters.today));
  confere('PAINEL · mostra contas e objetos federados', v.counts.accounts >= 0 && v.counts.publicObjects >= 0, JSON.stringify(v.counts));
  confere('PAINEL · o dia é UTC, no formato yyyymmdd', diaUtc(Date.UTC(2026, 10, 12, 23, 59)) === '20261112' && diaUtc(Date.UTC(2026, 0, 1, 0, 0)) === '20260101', diaUtc(T0));
  confere('PAINEL · não expõe seguidores, chaves nem conteúdo', !JSON.stringify(v).match(/mastodon\.social\/users|PRIVATE|publicKeyPem/), 'vazou dado');
}

// ═════════════ 9. Desligar a federação com seguidores ═════════════

{
  const ctx = await comSeguidores();
  const { bia, duda } = ctx.remotos;
  await disableFederation(ctx.deps, 'U_ANA');
  // Entre desligar e o worker limpar, os vínculos ainda existem (o worker os remove DEPOIS de levantar os destinos do
  // Delete do ator). Remover um seguidor nesse intervalo não pode contatá-lo: a conta já está desligada.
  const entre = await removeFollower(mod(ctx), 'U_ANA', bia.id, true);
  ctx.rede.posts.length = 0;
  await rodar(ctx);
  confere('DESLIGAR · remover seguidor com a conta já desligada não o contata (nem enfileira Reject)', entre === 'removido' && rejects(ctx).length === 0 && !entregasDe(ctx.rede).some((x) => x.json.type === 'Reject'), `${entre} ${rejects(ctx).length} Reject(s)`);
  const deletes = entregasDe(ctx.rede).filter((x) => x.json.type === 'Delete');
  confere('DESLIGAR · quem seguia recebe o Delete do ator', deletes.some((x) => x.url === duda.sharedInbox), JSON.stringify(deletes.map((x) => x.url)));

  const depois = await removeFollower(mod(ctx), 'U_ANA', duda.id, true);
  confere('DESLIGAR · depois da limpeza não há seguidores a remover', depois === 'inexistente' && (await seguem(ctx)).length === 0, depois);
  const b = await addBlock(mod(ctx), 'U_ANA', { scope: 'domain', value: 'mastodon.social' });
  confere('DESLIGAR · bloquear continua possível (e é inócuo, não há ninguém a remover)', b.ok && b.removedFollowers === 0, JSON.stringify(b));
}

encerra('Moderação e administração OK: o que se remove ou bloqueia some de fato, o servidor bloqueado não é contatado e o painel deixa rastro.');
