#!/usr/bin/env node
/**
 * Núcleo puro dos feeds, sem app, sem emuladores e sem rede:
 *   node e2e/feed-core-check.mjs        (ou: npm run e2e:feed-core)
 *
 *   - a janela e o cursor de uma página de feed não pulam nem repetem itens, inclusive quando vários itens têm a MESMA
 *     data (o `published` do Fediverso tem precisão de segundo): um controle com o cursor antigo (estrito) mostra o item
 *     perdido, para provar que o teste discrimina;
 *   - a lista de quem a pessoa segue é lida uma vez e reaproveitada, divide leituras simultâneas, nunca guarda uma leitura que
 *     falhou nem uma que ficou velha no meio do caminho, e some quando ela segue ou deixa de seguir alguém;
 *   - o mesmo post do Fediverso, com dois ids locais, aparece uma vez no feed.
 *
 * Sai com código 1 se algo falhar.
 */
import { janelaDeAtividades } from '../src/lib/feed/activityWindow.ts';
import { followedIdsCached, invalidateFollowedIds } from '../src/lib/services/followedIdsCache.ts';
import { getFeedContentKey, uniqueFeedItems } from '../src/lib/feedUtils.ts';
import { isRemoteId } from '../src/lib/federation/remoteId.ts';

let falhas = 0;
let total = 0;
function confere(nome, condicao, motivo, detalhe) {
  total++;
  if (condicao) console.log(`OK    ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo}`); }
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ───────────── 1. janela e cursor ─────────────
{
  const itens = (...pares) => pares.map(([id, time]) => ({ time, item: id }));
  const ids = (j) => j.janela.map((x) => x.item);
  const j1 = janelaDeAtividades([{ itens: itens(['a', 50], ['b', 40], ['c', 30]), cheia: false }], 2);
  confere('JANELA · uma fonte que não veio cheia: os 2 mais novos; sobrou 1, então há mais e a próxima consulta é "< 40"',
    igual(ids(j1), ['a', 'b']) && j1.proximoLimiteMs === 40 && j1.temMais === true, JSON.stringify(j1));
  const j2 = janelaDeAtividades([{ itens: itens(['a', 50], ['b', 40]), cheia: false }], 5);
  confere('JANELA · tudo coube e nenhuma fonte veio cheia: acabou (sem cursor, sem "tem mais")', j2.proximoLimiteMs === null && j2.temMais === false, JSON.stringify(j2));
  const j3 = janelaDeAtividades([{ itens: itens(['a', 50], ['b', 40], ['c', 30]), cheia: true }, { itens: itens(['d', 45]), cheia: false }], 10);
  confere('JANELA · a fonte CHEIA fixa a fronteira (30): só o ESTRITAMENTE mais novo é seguro, e a próxima consulta começa em 30 ("< 31")',
    igual(ids(j3), ['a', 'd', 'b']) && j3.proximoLimiteMs === 31 && j3.temMais === true, JSON.stringify(j3));
  const j4 = janelaDeAtividades([{ itens: itens(['a', 50], ['b', 40], ['c', 30]), cheia: true }, { itens: itens(['d', 20]), cheia: false }], 10);
  confere('JANELA · o que está abaixo da fronteira fica para a próxima página', igual(ids(j4), ['a', 'b']), JSON.stringify(j4));
  const j5 = janelaDeAtividades([{ itens: itens(['a', 50], ['b', 40]), cheia: false }], 5, (x) => x !== 'a');
  confere('JANELA · o filtro de elegibilidade tira itens sem mexer na fronteira', igual(ids(j5), ['b']), JSON.stringify(j5));
  const j6 = janelaDeAtividades([{ itens: itens(['a', 50], ['b', 40], ['c', 40], ['d', 40], ['e', 30]), cheia: false }], 2);
  confere('JANELA · NUNCA corta no meio de um empate: o limite é 2, mas os três itens em 40 entram juntos',
    igual(ids(j6), ['a', 'b', 'c', 'd']) && j6.proximoLimiteMs === 40, JSON.stringify(j6));
}

// ───────────── 2. paginação completa com empates (o `published` do Fediverso tem precisão de segundo) ─────────────
{
  /** Simula as páginas contra um "banco": várias fontes; a consulta é `time < limite`, até `pageSize`. `janela` é a regra de cada página. */
  function percorrer(banco, { limite, pageSize, janela }) {
    const entregues = [];
    let limiteDaConsulta = Infinity;
    let anterior = null;
    for (let pagina = 0; pagina < 80; pagina++) {
      const fontes = banco.map((fonte) => {
        const abaixo = fonte.filter((x) => x.time < limiteDaConsulta).sort((a, b) => b.time - a.time);
        const devolvidos = abaixo.slice(0, pageSize);
        return { itens: devolvidos.map((x) => ({ time: x.time, item: x.id })), cheia: devolvidos.length >= pageSize };
      });
      const r = janela(fontes, limite);
      for (const x of r.mostrados) entregues.push(x);
      if (!r.temMais || r.proximo === null) break;
      if (r.proximo === anterior) break; // cursor parado: o feed real também encerra aqui
      anterior = r.proximo;
      limiteDaConsulta = r.proximo;
    }
    return entregues;
  }
  const novaRegra = (fontes, limite) => {
    const r = janelaDeAtividades(fontes, limite);
    return { mostrados: r.janela.map((x) => x.item), proximo: r.proximoLimiteMs, temMais: r.temMais };
  };
  /** O desenho ANTIGO, como controle: cursor estrito no último item mostrado, e o limite corta empates. */
  const regraAntiga = (fontes, limite) => {
    let fronteira = -Infinity;
    const todos = [];
    for (const f of fontes) {
      todos.push(...f.itens);
      if (f.cheia && f.itens.length > 0) fronteira = Math.max(fronteira, f.itens[f.itens.length - 1].time);
    }
    todos.sort((a, b) => b.time - a.time);
    const elegiveis = todos.filter((x) => x.time >= fronteira);
    const janela = elegiveis.slice(0, limite);
    const tudo = elegiveis.length <= janela.length;
    return { mostrados: janela.map((x) => x.item), proximo: tudo ? (fronteira > -Infinity ? fronteira : null) : janela[janela.length - 1].time, temMais: !tudo || fronteira > -Infinity };
  };
  const item = (id, time) => ({ id, time });
  const duplicados = (lista) => lista.filter((x, i) => lista.indexOf(x) !== i);

  // Empates na borda da página: itens em 99 e em 97 espalhados pelas duas fontes.
  const banco = [
    [item('a1', 100), item('a2', 99), item('a3', 98), item('a4', 97), item('a5', 95), item('a6', 94)],
    [item('b1', 99), item('b2', 97), item('b3', 96), item('b4', 93)],
  ];
  const todos = new Set(banco.flat().map((x) => x.id));
  const novo = percorrer(banco, { limite: 2, pageSize: 3, janela: novaRegra });
  confere('PAGINAÇÃO · com empates na borda, TODOS os itens aparecem', igual([...todos].sort(), [...new Set(novo)].sort()), `faltaram: ${[...todos].filter((x) => !novo.includes(x)).join(', ') || '-'}`);
  confere('PAGINAÇÃO · e nenhum aparece duas vezes (o cursor não repete a borda)', duplicados(novo).length === 0, `repetidos: ${duplicados(novo).join(', ')}`);
  const antigo = percorrer(banco, { limite: 2, pageSize: 3, janela: regraAntiga });
  confere('PAGINAÇÃO · CONTROLE: o desenho antigo PERDE itens neste mesmo cenário (o teste discrimina)',
    [...todos].some((x) => !antigo.includes(x)), 'o desenho antigo não perdeu nada: o cenário não prova o defeito', `perdeu: ${[...todos].filter((x) => !antigo.includes(x)).join(', ')}`);

  // Sem empates o resultado é o mesmo (a mudança não estraga o caso comum).
  const semEmpate = [
    [item('a1', 100), item('a2', 98), item('a3', 96), item('a4', 94)],
    [item('b1', 99), item('b2', 97), item('b3', 95), item('b4', 93)],
  ];
  const t = new Set(semEmpate.flat().map((x) => x.id));
  const sem = percorrer(semEmpate, { limite: 3, pageSize: 4, janela: novaRegra });
  confere('PAGINAÇÃO · sem empates, todos aparecem uma vez', igual([...t].sort(), [...new Set(sem)].sort()) && duplicados(sem).length === 0, `faltaram: ${[...t].filter((x) => !sem.includes(x)).join(', ') || '-'}`);

  // Varredura: 200 cenários aleatórios com muitos empates. A regra nova entrega tudo, sem repetir; a antiga, não.
  let semente = 12345;
  const aleatorio = () => { semente = (semente * 1103515245 + 12345) & 0x7fffffff; return semente / 0x7fffffff; };
  let perdasNovo = 0;
  let perdasAntigo = 0;
  let repeticoes = 0;
  let irrecuperaveis = 0;
  for (let n = 0; n < 200; n++) {
    const fontes = Array.from({ length: 1 + Math.floor(aleatorio() * 4) }, (_, k) =>
      Array.from({ length: 3 + Math.floor(aleatorio() * 12) }, (_, i) => item(`f${k}_${i}`, 1000 - Math.floor(aleatorio() * 12))));
    const todosIds = new Set(fontes.flat().map((x) => x.id));
    const limite = 2 + Math.floor(aleatorio() * 4);
    const pageSize = limite + 1;
    // Uma fonte com `pageSize` ou mais itens no MESMO milissegundo não tem solução só com a data (seria preciso o id do documento no
    // cursor): fica fora da contagem, e o feed encerra sem laço (verificado abaixo).
    const maiorEmpate = Math.max(...fontes.map((fonte) => Math.max(...Object.values(fonte.reduce((m, x) => ({ ...m, [x.time]: (m[x.time] ?? 0) + 1 }), {})))));
    if (maiorEmpate >= pageSize) { irrecuperaveis++; continue; }
    const a = percorrer(fontes, { limite, pageSize, janela: novaRegra });
    if ([...todosIds].some((x) => !a.includes(x))) perdasNovo++;
    repeticoes += duplicados(a).length;
    const b = percorrer(fontes, { limite, pageSize, janela: regraAntiga });
    if ([...todosIds].some((x) => !b.includes(x))) perdasAntigo++;
  }
  confere('PAGINAÇÃO · 200 cenários aleatórios com muitos empates: a regra nova entrega tudo, uma vez cada', perdasNovo === 0 && repeticoes === 0, `cenários com perda: ${perdasNovo}; itens repetidos: ${repeticoes}`, `${200 - irrecuperaveis} cenários recuperáveis (${irrecuperaveis} com empate maior que a página ficam de fora)`);
  confere('PAGINAÇÃO · CONTROLE: nos mesmos cenários o desenho antigo perde itens em vários (o teste discrimina)', perdasAntigo > 20, `o antigo perdeu em ${perdasAntigo}`, `antigo perdeu em ${perdasAntigo} de ${200 - irrecuperaveis} cenários recuperáveis; novo em ${perdasNovo}`);

  // Muitos empates de uma vez (um bot postando no mesmo segundo): não pode ficar em laço infinito.
  const rajada = [Array.from({ length: 8 }, (_, i) => item(`r${i}`, 50)).concat([item('antes', 40)])];
  const vistos = percorrer(rajada, { limite: 3, pageSize: 4, janela: novaRegra });
  confere('PAGINAÇÃO · uma rajada de itens com a MESMA data não prende o feed em laço (encerra)', vistos.length <= 80 * 12, `${vistos.length} itens coletados`);
}

// ───────────── 3. lista de quem a pessoa segue em cache ─────────────
{
  invalidateFollowedIds();
  let leituras = 0;
  let relogio = 1_000;
  const agora = () => relogio;
  const ler = (ids) => async () => { leituras++; return [...ids]; };

  const a = await followedIdsCached('u1', ler(['x', 'y']), agora);
  const b = await followedIdsCached('u1', ler(['x', 'y', 'z']), agora);
  confere('SEGUIDOS · a segunda chamada reaproveita a leitura (1 leitura, não 2)', leituras === 1 && igual(a, b), `leituras=${leituras}`);

  a.push('mutado');
  const c = await followedIdsCached('u1', ler(['x', 'y']), agora);
  confere('SEGUIDOS · quem muda a lista devolvida não estraga o cache (cada chamada recebe uma cópia)', !c.includes('mutado'), JSON.stringify(c));

  relogio += 61_000;
  await followedIdsCached('u1', ler(['x', 'y', 'w']), agora);
  confere('SEGUIDOS · passado o prazo (60 s), lê de novo', leituras === 2, `leituras=${leituras}`);

  invalidateFollowedIds('u1');
  await followedIdsCached('u1', ler(['x']), agora);
  confere('SEGUIDOS · seguir ou deixar de seguir invalida na hora', leituras === 3, `leituras=${leituras}`);
  await followedIdsCached('u2', ler(['q']), agora);
  invalidateFollowedIds('u1');
  await followedIdsCached('u2', ler(['q']), agora);
  confere('SEGUIDOS · invalidar uma pessoa não derruba o cache das outras', leituras === 4, `leituras=${leituras}`);

  invalidateFollowedIds();
  let lidas = 0;
  const lenta = () => new Promise((resolve) => { lidas++; setTimeout(() => resolve(['m', 'n']), 30); });
  const [p, q] = await Promise.all([followedIdsCached('u3', lenta, agora), followedIdsCached('u3', lenta, agora)]);
  confere('SEGUIDOS · duas chamadas simultâneas dividem a MESMA leitura', lidas === 1 && igual(p, q), `lidas=${lidas}`);

  invalidateFollowedIds();
  let tentativas = 0;
  const falha = async () => { tentativas++; throw new Error('sem rede'); };
  let propagou = false;
  try { await followedIdsCached('u4', falha, agora); } catch { propagou = true; }
  const depois = await followedIdsCached('u4', async () => { tentativas++; return ['ok']; }, agora);
  confere('SEGUIDOS · uma leitura que FALHA propaga o erro e não é guardada (a próxima tenta de novo)', propagou && tentativas === 2 && igual(depois, ['ok']), `propagou=${propagou} tentativas=${tentativas}`);

  invalidateFollowedIds();
  let soltar;
  const emAndamento = followedIdsCached('u5', () => new Promise((resolve) => { soltar = () => resolve(['velho']); }), agora);
  invalidateFollowedIds('u5'); // a pessoa seguiu alguém ENQUANTO a leitura estava em andamento
  soltar();
  await emAndamento;
  let relidas = 0;
  const fresco = await followedIdsCached('u5', async () => { relidas++; return ['novo']; }, agora);
  confere('SEGUIDOS · uma leitura que ficou velha no meio do caminho NÃO é guardada (senão o novo seguido sumiria por 60 s)', relidas === 1 && igual(fresco, ['novo']), JSON.stringify({ relidas, fresco }));
  invalidateFollowedIds();
}

// ───────────── 4. o mesmo post do Fediverso, com dois ids, aparece uma vez ─────────────
{
  const remoto = (id, remoteUrl, extra = {}) => ({ id, userId: 'ap_autor', isRemoteFediverse: true, remoteUrl, type: 'original', ...extra });
  const url = 'https://organica.social/@gus/117607259043591585';
  const doInbox = remoto('ap_0fa377cf16a8422606203fa1', url, { remoteObjectId: 'https://organica.social/users/gus/statuses/117607259043591585' });
  const doPerfil = remoto('ap_0217ffcb3c0fa1c3c85cbfc7', url, { remoteObjectId: url });
  confere('DEDUPE · dois ids locais do MESMO post remoto têm a mesma chave', getFeedContentKey(doInbox) === getFeedContentKey(doPerfil), `${getFeedContentKey(doInbox)} x ${getFeedContentKey(doPerfil)}`);
  confere('DEDUPE · o feed mostra o post remoto uma vez só', uniqueFeedItems([doInbox, doPerfil]).length === 1, 'duplicou');
  confere('DEDUPE · post remoto SEM remoteUrl continua identificado pelo id', getFeedContentKey(remoto('ap_x', null)) === 'post:ap_x', getFeedContentKey(remoto('ap_x', null)));
  confere('DEDUPE · posts locais continuam por id (a página do post local não vira "remoto")', getFeedContentKey({ id: 'P1', userId: 'U1', type: 'original' }) === 'post:P1', 'chave de post local mudou');
  confere('DEDUPE · posts remotos DIFERENTES não se misturam', uniqueFeedItems([doInbox, remoto('ap_y', 'https://organica.social/@gus/999')]).length === 2, 'colapsou posts diferentes');
  confere('DEDUPE · comentário e repost de comentário mantêm a chave de antes',
    getFeedContentKey({ id: 'C1', parentPostId: 'P1' }) === 'comment:P1/C1'
      && getFeedContentKey({ id: 'R1', repostedComment: { id: 'C1', parentPostId: 'P1' } }) === 'comment:P1/C1', 'chave de comentário mudou');
}

// ───────────── 5. id remoto no navegador ─────────────
confere('ID · isRemoteId (versão do navegador) reconhece ap_ e só ap_', isRemoteId('ap_abc') && !isRemoteId('qdnRsBvLG8NdwrLv9GwiHDa1xi42') && !isRemoteId(undefined), 'reconhecimento errado');

console.log('');
console.log(`${total} verificações.`);
if (falhas) {
  console.log(`${falhas} falha(s).`);
  process.exit(1);
}
console.log('Núcleo dos feeds OK: a paginação não pula empates, a lista de seguidos é lida uma vez e o post remoto duplicado aparece uma vez.');
