#!/usr/bin/env node
/**
 * A tokenização e o ranking da busca (src/lib/search/indiceDeTexto.ts e ranking.ts):
 *   node e2e/busca-ranking-check.mjs        (ou: npm run e2e:busca)
 *
 * Duas coisas estão em jogo, e a segunda é a que importa de verdade.
 *
 * 1. ACHAR. Em português, acento e plural não podem separar palavras: quem digita "eleicao" tem de achar
 *    "eleições". Mas cortar demais junta palavras diferentes ("casa" e "casar") e a busca devolve lixo com cara de
 *    acerto — pior do que não achar, porque parece que funcionou.
 *
 * 2. NÃO VENDER POSIÇÃO. Este arquivo trava o compromisso de que o ranking é só por relevância: sem patrocínio, sem
 *    impulsionamento pago, sem peso por conta parceira. Há uma verificação que lê o código-fonte do ranking e falha
 *    se aparecer qualquer termo comercial. É proposital: a promessa fica difícil de quebrar em silêncio.
 *
 * Sai com código 1 se algo falhar.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  MAX_TOKENS_POR_DOC,
  PALAVRAS_VAZIAS,
  frasesExatas,
  linhaNormalizada,
  normalizar,
  palavras,
  radical,
  tokens,
  tokensDoDocumento,
} from '../src/lib/search/indiceDeTexto.ts';
import {
  BONUS_HANDLE_EXATO,
  BONUS_TITULO_EXATO,
  MEIA_VIDA_DIAS,
  TETO_ENGAJAMENTO,
  engajamento,
  idf,
  ordenarPorRelevancia,
  recencia,
  trechoComDestaque,
} from '../src/lib/search/ranking.ts';

let falhas = 0;
let total = 0;
const confere = (nome, condicao, motivo) => {
  total++;
  if (condicao) console.log(`OK    ${nome}`);
  else {
    falhas++;
    console.log(`FALHA ${nome} — ${motivo}`);
  }
};

// ───────────────────────── Achar em português ─────────────────────────
confere('TEXTO · acento não separa palavras', normalizar('Eleição') === 'eleicao', normalizar('Eleição'));
confere('TEXTO · maiúscula não separa', normalizar('LULA') === 'lula', normalizar('LULA'));
confere(
  'TEXTO · quem digita sem acento acha com acento',
  tokens('eleicao')[0] === tokens('eleição')[0],
  `${tokens('eleicao')[0]} vs ${tokens('eleição')[0]}`,
);
confere(
  'TEXTO · plural em -ões encontra o singular',
  radical('eleicoes') === radical('eleicao'),
  `${radical('eleicoes')} vs ${radical('eleicao')}`,
);
confere('TEXTO · jornais ↔ jornal', radical('jornais') === radical('jornal'), radical('jornais'));
confere('TEXTO · homens ↔ homem', radical('homens') === radical('homem'), radical('homens'));
confere('TEXTO · plural regular', radical('votos') === radical('voto'), radical('votos'));
confere('TEXTO · inglês: workers ↔ worker', radical('workers') === radical('worker'), radical('workers'));

// O limite do corte: o que NÃO pode ser juntado.
confere(
  'TEXTO · "casa" e "casar" continuam palavras diferentes (cortar demais devolve lixo)',
  radical('casa') !== radical('casar'),
  `${radical('casa')} == ${radical('casar')}`,
);
confere(
  'TEXTO · "povo" e "pobre" não se juntam',
  radical('povo') !== radical('pobre'),
  'radicalizou demais',
);
confere('TEXTO · palavra curta fica intacta', radical('voz') === 'voz' && radical('pai') === 'pai', 'cortou curta');
confere('TEXTO · "ss" final não perde letra', radical('acesso') === 'acesso', radical('acesso'));

confere('TOKENS · hashtag vira palavra buscável', tokens('#ReformaAgraria').length === 1, JSON.stringify(tokens('#ReformaAgraria')));
confere('TOKENS · arroba vira palavra buscável', tokens('@brenoramos').includes('brenoramo') || tokens('@brenoramos').length === 1, JSON.stringify(tokens('@brenoramos')));
confere('TOKENS · palavras vazias saem', tokens('o governo do povo').every((t) => !PALAVRAS_VAZIAS.has(t)), JSON.stringify(tokens('o governo do povo')));
confere('TOKENS · sem repetição', new Set(tokens('voto voto votos')).size === tokens('voto voto votos').length, 'repetiu');
confere('TOKENS · teto respeitado', tokens(Array.from({ length: 500 }, (_, i) => `palavra${i}`).join(' ')).length <= MAX_TOKENS_POR_DOC, 'passou do teto');
confere('TOKENS · texto vazio não quebra', tokens('').length === 0 && palavras(null ?? '').length === 0, 'quebrou com vazio');
confere(
  'TOKENS · emoji e pontuação não viram token',
  tokens('🔥🔥 !!! ...').length === 0,
  JSON.stringify(tokens('🔥🔥 !!! ...')),
);
confere(
  'TOKENS · documento junta título, autor, hashtag e corpo',
  (() => {
    const t = tokensDoDocumento({ titulo: 'Reforma', texto: 'terra', autorHandle: 'breno', hashtags: ['agraria'] });
    return ['reforma', 'terra', 'breno', 'agraria'].every((x) => t.includes(x));
  })(),
  JSON.stringify(tokensDoDocumento({ titulo: 'Reforma', texto: 'terra', autorHandle: 'breno', hashtags: ['agraria'] })),
);

confere('FRASE · aspas viram frase exata', JSON.stringify(frasesExatas('x "reforma agraria" y')) === '["reforma agraria"]', JSON.stringify(frasesExatas('x "reforma agraria" y')));
confere('FRASE · sem aspas, nenhuma frase', frasesExatas('reforma agraria').length === 0, 'inventou frase');
confere('FRASE · aspas sem par não quebram', frasesExatas('"solta').length === 0, 'quebrou');

// ───────────────────────── O ranking ─────────────────────────
const AGORA = Date.parse('2026-11-18T12:00:00Z');
const doc = (id, titulo, texto, extra = {}) => ({
  id,
  tokensTitulo: tokens(titulo),
  tokensCorpo: tokens(texto),
  tituloNormalizado: linhaNormalizada(titulo),
  linha: linhaNormalizada(`${titulo} ${texto}`),
  criadoEm: AGORA - 86_400_000,
  ...extra,
});

{
  const candidatos = [
    doc('a', 'Nota sobre economia', 'o texto cita reforma agraria uma vez'),
    doc('b', 'Reforma agraria', 'o plano completo da reforma agraria no pais'),
    doc('c', 'Futebol', 'nada a ver'),
  ];
  const r = ordenarPorRelevancia(candidatos, {
    termos: tokens('reforma agraria'),
    textoNormalizado: 'reforma agraria',
  }, AGORA);
  confere('RANKING · acerto no título vem primeiro', r[0].item.id === 'b', r.map((x) => x.item.id).join(','));
  confere('RANKING · quem não tem os termos fica por último', r[r.length - 1].item.id === 'c', r.map((x) => x.item.id).join(','));
  confere('RANKING · o bônus de título exato aparece na explicação', r[0].porque.tituloExato === BONUS_TITULO_EXATO, JSON.stringify(r[0].porque));
  confere('RANKING · toda nota vem acompanhada do porquê', r.every((x) => typeof x.porque.bm25 === 'number'), 'faltou explicação');
}
{
  const pessoa = { ...doc('p', 'Breno Ramos', 'bio'), handleNormalizado: 'brenoramos' };
  const outro = doc('o', 'Citação', 'falando de brenoramos por aí');
  const r = ordenarPorRelevancia([outro, pessoa], { termos: tokens('brenoramos'), textoNormalizado: 'brenoramos' }, AGORA);
  confere('RANKING · @handle exato ganha da citação', r[0].item.id === 'p', r.map((x) => x.item.id).join(','));
  confere('RANKING · e o bônus de handle é o maior deles', BONUS_HANDLE_EXATO > BONUS_TITULO_EXATO, 'handle vale menos que título');
}
{
  const comFrase = doc('f', 'Texto', 'aqui tem reforma agraria junto');
  const semFrase = doc('s', 'Texto', 'reforma de outra coisa e agraria separada');
  const r = ordenarPorRelevancia([semFrase, comFrase], {
    termos: tokens('reforma agraria'),
    frases: ['reforma agraria'],
  }, AGORA);
  confere('RANKING · frase exata entre aspas pesa', r[0].item.id === 'f', r.map((x) => x.item.id).join(','));
}
{
  const todos = doc('t', 'x', 'greve geral dos professores');
  const um = doc('u', 'x', 'greve greve greve greve greve greve');
  const r = ordenarPorRelevancia([um, todos], { termos: tokens('greve professores') }, AGORA);
  confere(
    'RANKING · ter TODOS os termos vale mais que repetir um',
    r[0].item.id === 't',
    r.map((x) => `${x.item.id}:${x.pontos.toFixed(2)}`).join(','),
  );
}
{
  const novo = doc('n', 'greve', 'greve', { criadoEm: AGORA - 3_600_000 });
  const velho = doc('v', 'greve', 'greve', { criadoEm: AGORA - 400 * 86_400_000 });
  const r = ordenarPorRelevancia([velho, novo], { termos: tokens('greve') }, AGORA);
  confere('RANKING · entre iguais, o mais novo vem antes', r[0].item.id === 'n', r.map((x) => x.item.id).join(','));
}
{
  const popular = doc('p', 'greve', 'greve', { curtidas: 5000 });
  const relevante = doc('r', 'greve dos professores', 'greve dos professores em todo o pais', { curtidas: 0 });
  const r = ordenarPorRelevancia([popular, relevante], { termos: tokens('greve professores') }, AGORA);
  confere(
    'RANKING · curtida é desempate, não atropela a relevância',
    r[0].item.id === 'r',
    r.map((x) => `${x.item.id}:${x.pontos.toFixed(2)}`).join(','),
  );
  confere('RANKING · engajamento tem teto', engajamento(10_000_000, 0) <= TETO_ENGAJAMENTO, String(engajamento(10_000_000, 0)));
  confere('RANKING · sem engajamento, sem bônus', engajamento(0, 0) === 0, 'deu bônus do nada');
  confere('RANKING · número negativo não vira bônus', engajamento(-50, -50) === 0, 'aceitou negativo');
}
{
  confere('RANKING · a meia-vida é de semanas, não de horas', MEIA_VIDA_DIAS >= 14, `${MEIA_VIDA_DIAS} dias`);
  confere('RANKING · hoje vale ~1 e uma meia-vida depois vale ~0,5',
    Math.abs(recencia(AGORA, AGORA) - 1) < 0.01 && Math.abs(recencia(AGORA - MEIA_VIDA_DIAS * 86_400_000, AGORA) - 0.5) < 0.01,
    `${recencia(AGORA, AGORA)} / ${recencia(AGORA - MEIA_VIDA_DIAS * 86_400_000, AGORA)}`);
  confere('RANKING · sem data não premia nem pune', recencia(undefined, AGORA) === 0, 'inventou recência');
  // No BM25 com +0,5 o termo onipresente não zera exatamente: fica em ~0,005. O que importa é a ORDEM de grandeza —
  // ele precisa ser desprezível perto de um termo raro, senão buscar "o governo" devolveria a rede inteira.
  confere(
    'RANKING · termo presente em tudo perde o poder de distinguir',
    idf(100, 100) < 0.01 && idf(100, 1) > idf(100, 100) * 100,
    `onipresente ${idf(100, 100).toFixed(4)} vs raro ${idf(100, 1).toFixed(4)}`,
  );
  confere('RANKING · e nunca fica negativo (termo comum não pode punir o documento)', idf(10, 10) >= 0, String(idf(10, 10)));
  confere('RANKING · termo raro vale mais que termo comum', idf(100, 1) > idf(100, 50), 'IDF invertido');
}
{
  const a = doc('aaa', 'greve', 'greve');
  const b = doc('bbb', 'greve', 'greve');
  const r1 = ordenarPorRelevancia([a, b], { termos: tokens('greve') }, AGORA).map((x) => x.item.id).join(',');
  const r2 = ordenarPorRelevancia([b, a], { termos: tokens('greve') }, AGORA).map((x) => x.item.id).join(',');
  confere('RANKING · a mesma busca devolve sempre a mesma ordem', r1 === r2, `${r1} vs ${r2}`);
}
confere('RANKING · lista vazia não quebra', ordenarPorRelevancia([], { termos: ['x'] }, AGORA).length === 0, 'quebrou');
confere(
  'RANKING · busca sem termos não quebra',
  ordenarPorRelevancia([doc('x', 'a', 'b')], { termos: [] }, AGORA).length === 1,
  'quebrou',
);

// ───────────────────────── O trecho mostrado ─────────────────────────
{
  const { trecho, marcas } = trechoComDestaque('A reforma agrária é o tema central do debate de hoje.', ['reforma']);
  confere('TRECHO · acha o termo mesmo com acento no original', marcas.length > 0, JSON.stringify(marcas));
  confere('TRECHO · o destaque cai sobre a palavra certa', trecho.slice(marcas[0][0], marcas[0][1]).toLowerCase() === 'reforma', trecho.slice(marcas[0][0], marcas[0][1]));
  confere(
    'TRECHO · o destaque sai como índices, não como HTML (nada de marcação vinda de terceiro)',
    !trecho.includes('<') && Array.isArray(marcas[0]),
    trecho,
  );
}
{
  const longo = `${'palavra '.repeat(80)}achado ${'palavra '.repeat(80)}`;
  const { trecho } = trechoComDestaque(longo, ['achado']);
  confere('TRECHO · texto longo é cortado em volta do termo', trecho.includes('achado') && trecho.length < 260, `${trecho.length} chars`);
  confere('TRECHO · corte no meio é sinalizado com reticências', trecho.startsWith('…'), trecho.slice(0, 10));
}
confere('TRECHO · texto vazio devolve vazio', trechoComDestaque('', ['x']).trecho === '', 'não devolveu vazio');
{
  const { marcas } = trechoComDestaque('greve greve', ['greve', 'grev']);
  const sobrepoe = marcas.some((m, i) => i > 0 && m[0] < marcas[i - 1][1]);
  confere('TRECHO · destaques não se sobrepõem', !sobrepoe, JSON.stringify(marcas));
}

// ───────────────────────── O compromisso, travado em teste ─────────────────────────
{
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
  const fonte = readFileSync(join(raiz, 'src/lib/search/ranking.ts'), 'utf8');
  // Procura-se no CÓDIGO, não nos comentários: o cabeçalho explica o compromisso e cita essas palavras de propósito.
  const codigo = fonte
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
    .join('\n')
    .toLowerCase();
  const proibidos = ['patrocin', 'sponsor', 'anuncio', 'anúncio', 'promoted', 'impulsion', 'boost', 'paga', 'premium', 'parceiro'];
  const achados = proibidos.filter((p) => codigo.includes(p));
  confere(
    'COMPROMISSO · nenhum termo comercial no código do ranking (sem patrocínio, sem impulso pago)',
    achados.length === 0,
    `apareceu: ${achados.join(', ')}`,
  );
  confere(
    'COMPROMISSO · o ranking não recebe campo de conta "parceira" nem multiplicador externo',
    !/multiplicador|pesoComercial|boostFactor/i.test(codigo),
    'apareceu um gancho para mexer no peso de fora',
  );
}

console.log('');
console.log(`${total} verificações.`);
if (falhas) {
  console.log(`${falhas} falha(s).`);
  process.exit(1);
}
console.log('Busca OK: acha com acento e plural, não radicaliza demais, e a ordem é só relevância — sem posição à venda.');
