#!/usr/bin/env node
/**
 * As regras do HiperChat que não dependem de tela (src/lib/hiperchat/preferences.ts e badges.ts):
 *   node e2e/hiperchat-check.mjs        (ou: npm run e2e:hiperchat)
 *
 * O que está em jogo: as conversas FIXADAS e as preferências do aparelho são a única coisa do HiperChat que sobrevive a
 * fechar o app. Se a leitura engasgar com lixo no armazenamento, a tela de mensagens abre vazia ou quebrada — e quem usa
 * não tem como saber por quê. Então cada caminho torto é verificado aqui: JSON inválido, valor de outro tipo, lista com
 * repetição, id de conversa que não existe mais, armazenamento que lança (janela privada), teto de fixadas.
 *
 * Também se prova que o módulo NÃO toca na conta: o que ele grava é por usuário (a chave carrega o uid) e fica no aparelho.
 * Sai com código 1 se algo falhar.
 */
import {
  HIPERCHAT_FILTERS,
  HIPERCHAT_TEXT_SIZES,
  MAX_FIXADAS,
  PREFERENCIAS_PADRAO,
  alternarFixada,
  estaFixada,
  handleDeExibicao,
  lerFixadas,
  lerPreferencias,
  migrarPreferenciasAntigas,
  salvarPreferencias,
  separarFixadas,
} from '../src/lib/hiperchat/preferences.ts';
import { contarGruposNaoLidos, createBadgeStore } from '../src/lib/hiperchat/badges.ts';
import { DURACAO_NOTA, INTERVALO_NOTA, NOTAS_HZ, VOLUME, deveAvisar, tocarAviso } from '../src/lib/hiperchat/som.ts';

let falhas = 0;
let total = 0;
const confere = (nome, condicao, motivo, detalhe) => {
  total++;
  if (condicao) console.log(`OK    ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  else {
    falhas++;
    console.log(`FALHA ${nome} — ${motivo}`);
  }
};
const igual = (nome, obtido, esperado) =>
  confere(nome, JSON.stringify(obtido) === JSON.stringify(esperado), `esperava ${JSON.stringify(esperado)}, veio ${JSON.stringify(obtido)}`);

/** Um `localStorage` de mentira. `quebrado` imita janela privada: tudo que toca nele lança. */
const criarArmazenamento = (inicial = {}, quebrado = false) => {
  const mapa = new Map(Object.entries(inicial));
  return {
    escritas: 0,
    getItem(chave) {
      if (quebrado) throw new Error('armazenamento bloqueado');
      return mapa.has(chave) ? mapa.get(chave) : null;
    },
    setItem(chave, valor) {
      if (quebrado) throw new Error('armazenamento bloqueado');
      this.escritas++;
      mapa.set(chave, valor);
    },
    removeItem(chave) {
      if (quebrado) throw new Error('armazenamento bloqueado');
      mapa.delete(chave);
    },
    bruto: mapa,
  };
};

const UID = 'uid-breno';
const OUTRO = 'uid-helen';

// ───────────────────────── preferências ─────────────────────────

igual('PADRÃO · armazenamento vazio devolve os padrões', lerPreferencias(criarArmazenamento(), UID), PREFERENCIAS_PADRAO);
igual('PADRÃO · sem armazenamento (render no servidor) devolve os padrões', lerPreferencias(null, UID), PREFERENCIAS_PADRAO);
igual('PADRÃO · sem usuário (ninguém logado) devolve os padrões', lerPreferencias(criarArmazenamento(), null), PREFERENCIAS_PADRAO);
igual('PADRÃO · armazenamento que LANÇA não quebra a tela', lerPreferencias(criarArmazenamento({}, true), UID), PREFERENCIAS_PADRAO);

{
  const a = criarArmazenamento({ [`hv_hiperchat_prefs:${UID}`]: '{isso não é json' });
  igual('LIXO · JSON inválido vira os padrões', lerPreferencias(a, UID), PREFERENCIAS_PADRAO);
}
{
  const a = criarArmazenamento({ [`hv_hiperchat_prefs:${UID}`]: '[1,2,3]' });
  igual('LIXO · array onde devia ter objeto vira os padrões', lerPreferencias(a, UID), PREFERENCIAS_PADRAO);
}
{
  const a = criarArmazenamento({ [`hv_hiperchat_prefs:${UID}`]: 'null' });
  igual('LIXO · "null" vira os padrões', lerPreferencias(a, UID), PREFERENCIAS_PADRAO);
}
{
  // Cada campo é checado sozinho: um valor podre não leva os outros embora.
  const a = criarArmazenamento({
    [`hv_hiperchat_prefs:${UID}`]: JSON.stringify({ som: 'sim', previa: false, filtroInicial: 'inbox', tamanhoDoTexto: 'grande' }),
  });
  igual('LIXO · campo a campo: só o estragado volta ao padrão', lerPreferencias(a, UID), {
    som: true,
    previa: false,
    confirmacaoDeLeitura: true,
    filtroInicial: 'todas',
    tamanhoDoTexto: 'grande',
  });
}

{
  const a = criarArmazenamento();
  const salvo = salvarPreferencias(a, UID, { som: false, tamanhoDoTexto: 'pequeno' });
  igual('SALVAR · devolve o estado inteiro, não só o que mudou', salvo, {
    som: false,
    previa: true,
    confirmacaoDeLeitura: true,
    filtroInicial: 'todas',
    tamanhoDoTexto: 'pequeno',
  });
  igual('SALVAR · reler traz o que foi gravado', lerPreferencias(a, UID), salvo);
  confere('SALVAR · a chave carrega o uid (duas contas no mesmo aparelho não se misturam)', a.bruto.has(`hv_hiperchat_prefs:${UID}`), [...a.bruto.keys()].join(','));
  igual('SALVAR · a outra conta do mesmo aparelho segue nos padrões', lerPreferencias(a, OUTRO), PREFERENCIAS_PADRAO);
}
{
  const a = criarArmazenamento();
  salvarPreferencias(a, UID, { previa: false });
  const depois = salvarPreferencias(a, UID, { filtroInicial: 'grupos' });
  confere('SALVAR · mudança nova não apaga a anterior', depois.previa === false && depois.filtroInicial === 'grupos', JSON.stringify(depois));
}
{
  const a = criarArmazenamento();
  igual('SALVAR · valor inválido é ignorado e o atual fica', salvarPreferencias(a, UID, { filtroInicial: 'nao-existe', som: 1 }), PREFERENCIAS_PADRAO);
}
{
  const quebrado = criarArmazenamento({}, true);
  igual('SALVAR · em janela privada devolve o valor sem gravar e sem lançar', salvarPreferencias(quebrado, UID, { som: false }), {
    ...PREFERENCIAS_PADRAO,
    som: false,
  });
}
confere('SALVAR · sem usuário não grava nada', (() => {
  const a = criarArmazenamento();
  salvarPreferencias(a, null, { som: false });
  return a.bruto.size === 0;
})(), 'gravou com uid nulo');

for (const f of HIPERCHAT_FILTERS) {
  const a = criarArmazenamento();
  confere(`FILTRO · "${f}" é aceito e volta igual`, salvarPreferencias(a, UID, { filtroInicial: f }).filtroInicial === f);
}
for (const t of HIPERCHAT_TEXT_SIZES) {
  const a = criarArmazenamento();
  confere(`TEXTO · "${t}" é aceito e volta igual`, salvarPreferencias(a, UID, { tamanhoDoTexto: t }).tamanhoDoTexto === t);
}

// ───────────────────────── migração da versão anterior ─────────────────────────

{
  const a = criarArmazenamento({ hv_hiperchat_sound: '0', hv_hiperchat_preview: '0', hv_hiperchat_read_receipts: '1' });
  const migrado = migrarPreferenciasAntigas(a, UID);
  igual('MIGRAÇÃO · quem já usava o HiperChat não perde as escolhas', migrado, {
    som: false,
    previa: false,
    confirmacaoDeLeitura: true,
    filtroInicial: 'todas',
    tamanhoDoTexto: 'normal',
  });
  confere('MIGRAÇÃO · as chaves antigas continuam onde estavam (versão velha do app não se perde)', a.bruto.get('hv_hiperchat_sound') === '0');
}
{
  const a = criarArmazenamento({
    hv_hiperchat_sound: '0',
    [`hv_hiperchat_prefs:${UID}`]: JSON.stringify({ ...PREFERENCIAS_PADRAO, som: true }),
  });
  confere('MIGRAÇÃO · com preferência nova já gravada, a antiga NÃO sobrescreve', migrarPreferenciasAntigas(a, UID).som === true);
}
{
  const a = criarArmazenamento();
  igual('MIGRAÇÃO · instalação nova (nada antigo) fica nos padrões', migrarPreferenciasAntigas(a, UID), PREFERENCIAS_PADRAO);
}
{
  const a = criarArmazenamento({ hv_hiperchat_sound: 'talvez' });
  confere('MIGRAÇÃO · valor antigo fora de "0"/"1" é ignorado', migrarPreferenciasAntigas(a, UID).som === true);
}
igual('MIGRAÇÃO · armazenamento que lança devolve os padrões', migrarPreferenciasAntigas(criarArmazenamento({}, true), UID), PREFERENCIAS_PADRAO);

// ───────────────────────── fixadas ─────────────────────────

igual('FIXADAS · nada fixado é lista vazia', lerFixadas(criarArmazenamento(), UID), []);
igual('FIXADAS · sem armazenamento é lista vazia', lerFixadas(null, UID), []);
igual('FIXADAS · armazenamento que lança é lista vazia', lerFixadas(criarArmazenamento({}, true), UID), []);
igual('FIXADAS · JSON inválido é lista vazia', lerFixadas(criarArmazenamento({ [`hv_hiperchat_fixadas:${UID}`]: '{' }), UID), []);
igual('FIXADAS · objeto onde devia ter lista é lista vazia', lerFixadas(criarArmazenamento({ [`hv_hiperchat_fixadas:${UID}`]: '{"a":1}' }), UID), []);

{
  const sujo = JSON.stringify(['c1', 42, null, 'c1', '  c2  ', '', { id: 'c3' }, 'c4']);
  igual(
    'FIXADAS · a leitura limpa: tira o que não é texto, apara espaço, não repete',
    lerFixadas(criarArmazenamento({ [`hv_hiperchat_fixadas:${UID}`]: sujo }), UID),
    ['c1', 'c2', 'c4'],
  );
}
{
  const gigante = 'x'.repeat(201);
  igual(
    'FIXADAS · id absurdamente longo é descartado (não é id de conversa)',
    lerFixadas(criarArmazenamento({ [`hv_hiperchat_fixadas:${UID}`]: JSON.stringify([gigante, 'c1']) }), UID),
    ['c1'],
  );
}
{
  const demais = Array.from({ length: MAX_FIXADAS + 5 }, (_, i) => `c${i}`);
  confere(
    `FIXADAS · a leitura respeita o teto de ${MAX_FIXADAS}`,
    lerFixadas(criarArmazenamento({ [`hv_hiperchat_fixadas:${UID}`]: JSON.stringify(demais) }), UID).length === MAX_FIXADAS,
  );
}

{
  const a = criarArmazenamento();
  igual('FIXAR · a primeira entra', alternarFixada(a, UID, 'c1'), ['c1']);
  igual('FIXAR · a mais nova vai para o TOPO (é o que a pessoa acabou de marcar)', alternarFixada(a, UID, 'c2'), ['c2', 'c1']);
  igual('DESAFIXAR · o mesmo toque desfaz', alternarFixada(a, UID, 'c2'), ['c1']);
  igual('FIXAR · persiste entre leituras', lerFixadas(a, UID), ['c1']);
  confere('FIXAR · a chave carrega o uid', a.bruto.has(`hv_hiperchat_fixadas:${UID}`), [...a.bruto.keys()].join(','));
  igual('FIXAR · a outra conta do aparelho não vê as fixadas desta', lerFixadas(a, OUTRO), []);
}
{
  const a = criarArmazenamento();
  igual('FIXAR · id vazio não entra', alternarFixada(a, UID, '   '), []);
  confere('FIXAR · id vazio não grava nada', a.bruto.size === 0);
}
{
  const a = criarArmazenamento();
  for (let i = 0; i < MAX_FIXADAS; i++) alternarFixada(a, UID, `c${i}`);
  const cheia = lerFixadas(a, UID);
  const depois = alternarFixada(a, UID, 'nova');
  confere(`TETO · no limite, fixar a nova funciona e sai a mais antiga (nunca falha calado)`, depois.length === MAX_FIXADAS && depois[0] === 'nova' && !depois.includes(cheia[cheia.length - 1]), JSON.stringify(depois));
}
{
  const quebrado = criarArmazenamento({}, true);
  igual('FIXAR · em janela privada vale nesta tela e não lança', alternarFixada(quebrado, UID, 'c1'), ['c1']);
}

confere('ESTÁ FIXADA · encontra', estaFixada(['c1', 'c2'], 'c2') === true);
confere('ESTÁ FIXADA · não encontra', estaFixada(['c1'], 'c2') === false);
confere('ESTÁ FIXADA · id nulo é não', estaFixada(['c1'], null) === false);
confere('ESTÁ FIXADA · lista vazia é não', estaFixada([], 'c1') === false);

// ───────────────────────── separar em seções ─────────────────────────

{
  const conversas = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const r = separarFixadas(conversas, ['c', 'a']);
  igual('SEÇÕES · as fixadas sobem na ordem em que foram fixadas', r.fixadas.map((x) => x.id), ['c', 'a']);
  igual('SEÇÕES · o resto mantém a ordem que já vinha (mais recente primeiro)', r.demais.map((x) => x.id), ['b', 'd']);
  confere('SEÇÕES · ninguém aparece duas vezes', r.fixadas.length + r.demais.length === conversas.length);
  igual('SEÇÕES · a lista de entrada não é mexida', conversas.map((x) => x.id), ['a', 'b', 'c', 'd']);
}
{
  const r = separarFixadas([{ id: 'a' }], ['sumiu', 'a']);
  igual('SEÇÕES · fixada de conversa apagada (ou da qual saiu) é ignorada', r.fixadas.map((x) => x.id), ['a']);
  igual('SEÇÕES · e não sobra buraco no resto', r.demais, []);
}
igual('SEÇÕES · sem fixadas, tudo cai na lista comum', separarFixadas([{ id: 'a' }], []).demais.map((x) => x.id), ['a']);
igual('SEÇÕES · lista vazia não inventa nada', separarFixadas([], ['a']), { fixadas: [], demais: [] });

// ───────────────────────── de qual casa é a conta ─────────────────────────

igual('IDENTIDADE · conta daqui usa o nosso domínio de federação', handleDeExibicao({ username: 'breno' }, 'hiperverso.social'), {
  handle: '@breno@hiperverso.social',
  origem: 'hiperverso.social',
});
igual(
  'IDENTIDADE · quem entrou pelo Fediverso continua sendo de LÁ (mostrar o nosso domínio seria mentira)',
  handleDeExibicao({ username: 'breno', federatedLoginProvider: 'fediverse', federatedLoginHandle: 'ana@mastodon.social' }, 'hiperverso.social'),
  { handle: '@ana@mastodon.social', origem: 'mastodon.social' },
);
igual(
  'IDENTIDADE · com @ na frente, não dobra o arroba',
  handleDeExibicao({ username: 'breno', federatedLoginProvider: 'fediverse', federatedLoginHandle: '@ana@mastodon.social' }, 'hiperverso.social'),
  { handle: '@ana@mastodon.social', origem: 'mastodon.social' },
);
igual(
  'IDENTIDADE · Bluesky é dito pelo nome',
  handleDeExibicao({ username: 'breno', federatedLoginProvider: 'bluesky', federatedLoginHandle: 'ana.bsky.social' }, 'hiperverso.social'),
  { handle: '@ana.bsky.social', origem: 'Bluesky' },
);
igual(
  'IDENTIDADE · login federado sem handle gravado cai no nosso domínio, sem quebrar',
  handleDeExibicao({ username: 'breno', federatedLoginProvider: 'fediverse' }, 'hiperverso.social'),
  { handle: '@breno@hiperverso.social', origem: 'hiperverso.social' },
);
igual(
  'IDENTIDADE · handle do Fediverso sem domínio é incompleto: cai no nosso',
  handleDeExibicao({ username: 'breno', federatedLoginProvider: 'fediverse', federatedLoginHandle: 'ana' }, 'hiperverso.social'),
  { handle: '@breno@hiperverso.social', origem: 'hiperverso.social' },
);
confere('IDENTIDADE · conta nula não lança', handleDeExibicao(null, 'hiperverso.social').handle === '@hiperverso.social');

// ───────────────────────── os números da navegação ─────────────────────────

{
  const conversas = [
    { isGroup: true, participantIds: ['a', 'b', 'c'], unreadCounts: { [UID]: 3 } },
    { isGroup: true, participantIds: ['a', 'b', 'c'], unreadCounts: { [UID]: 0 } },
    { isGroup: false, participantIds: ['a', 'b'], unreadCounts: { [UID]: 9 } },
    { participantIds: ['a', 'b', 'c', 'd'], unreadCounts: { [UID]: 1 } },
    { isGroup: true, participantIds: ['a', 'b', 'c'], unreadCounts: { outro: 5 } },
  ];
  confere('GRUPOS · conta grupos com mensagem nova PARA MIM, e conversa de 2 não é grupo', contarGruposNaoLidos(conversas, UID) === 2, String(contarGruposNaoLidos(conversas, UID)));
  confere('GRUPOS · sem usuário, zero', contarGruposNaoLidos(conversas, null) === 0);
  confere('GRUPOS · lista inválida, zero', contarGruposNaoLidos(null, UID) === 0);
  confere('GRUPOS · documento sem unreadCounts não é contado', contarGruposNaoLidos([{ isGroup: true, participantIds: ['a', 'b', 'c'] }], UID) === 0);
}
{
  const store = createBadgeStore();
  let avisos = 0;
  const parar = store.subscribe(() => avisos++);
  igual('BADGES · começa em zero', store.get(), { grupos: 0, fixadas: 0 });
  store.publish({ grupos: 2 });
  igual('BADGES · publicar um campo não zera o outro', store.get(), { grupos: 2, fixadas: 0 });
  confere('BADGES · avisa quem está ouvindo', avisos === 1, `avisos=${avisos}`);
  const antes = store.get();
  store.publish({ grupos: 2 });
  confere('BADGES · publicar o MESMO número não avisa (nada re-renderiza em vão)', avisos === 1 && store.get() === antes);
  store.publish({ fixadas: -4 });
  igual('BADGES · número inválido vira zero', store.get(), { grupos: 2, fixadas: 0 });
  store.publish({ grupos: 10_000 });
  confere('BADGES · número absurdo é limitado a 999', store.get().grupos === 999, String(store.get().grupos));
  parar();
  const antesDeSair = avisos;
  store.publish({ grupos: 1 });
  confere('BADGES · depois de desinscrever, não avisa mais (sem vazamento ao sair da tela)', avisos === antesDeSair);
  store.reset();
  igual('BADGES · reset volta a zero', store.get(), { grupos: 0, fixadas: 0 });
}

// ───────────────────────── invariantes com entrada aleatória ─────────────────────────

{
  const violacoes = [];
  const ids = ['c1', 'c2', 'c3', 'c4', 'c5', '', '  ', 'c1'];
  for (let i = 0; i < 5000; i++) {
    const a = criarArmazenamento();
    const quantos = 1 + Math.floor(Math.random() * 20);
    for (let k = 0; k < quantos; k++) alternarFixada(a, UID, ids[Math.floor(Math.random() * ids.length)]);
    const lista = lerFixadas(a, UID);
    if (lista.length > MAX_FIXADAS) violacoes.push(`passou do teto: ${lista.length}`);
    if (new Set(lista).size !== lista.length) violacoes.push(`repetiu: ${lista.join(',')}`);
    if (lista.some((x) => typeof x !== 'string' || x.trim() === '')) violacoes.push(`id vazio: ${JSON.stringify(lista)}`);
    const conversas = lista.map((id) => ({ id }));
    const r = separarFixadas(conversas, lista);
    if (r.fixadas.length !== lista.length || r.demais.length !== 0) violacoes.push('separação perdeu conversa');
  }
  confere(
    'INVARIANTES · 5.000 sequências aleatórias de fixar/desafixar: nunca passa do teto, nunca repete, nunca guarda id vazio, e a separação em seções não perde ninguém',
    violacoes.length === 0,
    violacoes.slice(0, 3).join(' | '),
  );
}


// ───────────────────────── Aviso sonoro ─────────────────────────
{
  /** Contexto de áudio de mentira: anota tudo o que foi agendado, sem navegador. */
  const criarContexto = (estado = 'running', lancaNo = null) => {
    const agendado = [];
    let retomou = 0;
    const ctx = {
      state: estado,
      currentTime: 10,
      destination: { nome: 'saida' },
      resume() {
        retomou++;
      },
      createOscillator() {
        if (lancaNo === 'oscilador') throw new Error('sem oscilador');
        const o = { tipo: null, hz: null, inicio: null, fim: null, ligadoEm: null };
        agendado.push({ tipo: 'osc', dados: o });
        return {
          set type(v) {
            o.tipo = v;
          },
          get type() {
            return o.tipo;
          },
          frequency: { setValueAtTime: (hz, t) => { o.hz = hz; o.hzEm = t; } },
          connect: (d) => { o.ligadoEm = d; },
          start: (t) => { o.inicio = t; },
          stop: (t) => { o.fim = t; },
        };
      },
      createGain() {
        const g = { pico: null, picoEm: null, queda: null, quedaEm: null, ligadoEm: null };
        agendado.push({ tipo: 'gain', dados: g });
        return {
          gain: {
            setValueAtTime: (v, t) => { g.pico = v; g.picoEm = t; },
            exponentialRampToValueAtTime: (v, t) => { g.queda = v; g.quedaEm = t; },
          },
          connect: (d) => { g.ligadoEm = d; },
        };
      },
    };
    return { ctx, agendado, retomadas: () => retomou };
  };

  const { ctx, agendado } = criarContexto();
  const tocou = tocarAviso(ctx);
  const osciladores = agendado.filter((a) => a.tipo === 'osc').map((a) => a.dados);
  const ganhos = agendado.filter((a) => a.tipo === 'gain').map((a) => a.dados);

  confere('SOM · agenda o aviso quando o contexto está tocando', tocou === true, `veio ${tocou}`);
  confere('SOM · duas notas, uma por oscilador', osciladores.length === NOTAS_HZ.length, `veio ${osciladores.length}`);
  igual('SOM · as frequências são as duas notas do aviso', osciladores.map((o) => o.hz), [...NOTAS_HZ]);
  confere('SOM · a segunda nota começa depois da primeira', osciladores[1].inicio > osciladores[0].inicio, 'as duas no mesmo instante');
  igual(
    'SOM · a segunda nota entra no intervalo combinado',
    Number((osciladores[1].inicio - osciladores[0].inicio).toFixed(6)),
    INTERVALO_NOTA,
  );
  igual(
    'SOM · cada nota dura o combinado',
    osciladores.map((o) => Number((o.fim - o.inicio).toFixed(6))),
    [DURACAO_NOTA, DURACAO_NOTA],
  );
  confere('SOM · toda nota tem começo e fim marcados (nenhuma fica tocando para sempre)',
    osciladores.every((o) => typeof o.inicio === 'number' && typeof o.fim === 'number' && o.fim > o.inicio), 'nota sem fim');
  confere('SOM · é aviso, não susto: volume de pico baixo', ganhos.every((g) => g.pico === VOLUME && VOLUME <= 0.15), `pico ${ganhos[0]?.pico}`);
  confere('SOM · cada nota cai até quase zero (sem estalo no fim)', ganhos.every((g) => g.queda > 0 && g.queda < 0.001), `queda ${ganhos[0]?.queda}`);
  confere('SOM · nada começa antes do agora do contexto', osciladores.every((o) => o.inicio >= ctx.currentTime), 'agendou no passado');
  confere('SOM · o ganho é quem fala com a saída (o oscilador passa por ele)',
    ganhos.every((g) => g.ligadoEm === ctx.destination) && osciladores.every((o) => o.ligadoEm !== ctx.destination), 'ligação direta na saída');

  const suspenso = criarContexto('suspended');
  const tocouSuspenso = tocarAviso(suspenso.ctx);
  confere('SOM · contexto suspenso: pede para retomar e ainda agenda', tocouSuspenso === true && suspenso.retomadas() === 1, `retomadas ${suspenso.retomadas()}`);

  const fechado = criarContexto('closed');
  confere('SOM · contexto fechado: não agenda nada', tocarAviso(fechado.ctx) === false && fechado.agendado.length === 0, 'agendou em contexto fechado');

  confere('SOM · sem contexto nenhum não quebra', tocarAviso(null) === false && tocarAviso(undefined) === false, 'devia devolver false');

  const quebrado = criarContexto('running', 'oscilador');
  let explodiu = false;
  let r;
  try {
    r = tocarAviso(quebrado.ctx);
  } catch {
    explodiu = true;
  }
  confere('SOM · navegador que recusa áudio não derruba a tela de mensagens', !explodiu && r === false, 'deixou o erro subir');

  // A regra de quando apitar.
  confere('SOM · a primeira leitura só calibra (abrir o app não apita)', deveAvisar(null, 7) === false, 'apitou ao abrir');
  confere('SOM · apita quando o número de não lidas sobe', deveAvisar(2, 3) === true, 'não apitou');
  confere('SOM · não apita quando empata', deveAvisar(3, 3) === false, 'apitou à toa');
  confere('SOM · não apita quando cai (você leu as mensagens)', deveAvisar(5, 1) === false, 'apitou ao ler');
  confere('SOM · apita no salto de zero para muitas (voltou da rua)', deveAvisar(0, 12) === true, 'não apitou');
  confere('SOM · número inválido não apita', deveAvisar(1, Number.NaN) === false && deveAvisar(Number.NaN, 5) === false, 'apitou com NaN');
}

console.log('');
console.log(`${total} verificações.`);
if (falhas) {
  console.log(`${falhas} falha(s).`);
  process.exit(1);
}
console.log('HiperChat OK: fixadas e preferências por usuário, só no aparelho, resistentes a lixo no armazenamento.');
