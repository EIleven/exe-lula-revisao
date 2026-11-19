#!/usr/bin/env node
/**
 * Os operadores da Busca Avançada (src/lib/search/operadores.ts):
 *   node e2e/busca-operadores-check.mjs        (ou: npm run e2e:busca-operadores)
 *
 * Duas coisas que quebram a confiança de quem usa, e por isso são provadas aqui:
 *
 * 1. A BARRA E O PAINEL PRECISAM SER A MESMA COISA. Quem digita `de:@breno periodo:7d` e quem marca as caixinhas
 *    tem de chegar ao mesmo resultado, e o painel tem de saber escrever de volta na barra. Se a volta não for
 *    exata, a pessoa marca um filtro, a barra mostra outra coisa, e um dos dois está mentindo. Aqui a ida e volta
 *    é verificada termo a termo.
 *
 * 2. OPERADOR QUE NÃO EXISTE NÃO PODE VIRAR ERRO. Quem digita "preco: 10" está procurando preço, não escrevendo um
 *    comando. Tratar isso como sintaxe quebrada transforma um acerto em erro — e some com o resultado sem explicar.
 *
 * Sai com código 1 se algo falhar.
 */
import {
  BUSCA_VAZIA,
  escrever,
  interpretar,
  janelaEmMs,
  passaNoFiltro,
  temFiltro,
} from '../src/lib/search/operadores.ts';

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

// ───────────────────────── Ler a barra ─────────────────────────
{
  const b = interpretar('greve de:@breno #reforma periodo:7d tipo:artigo com:midia ordem:recentes -futebol "frase exata"');
  confere('BARRA · texto livre fica como texto', b.texto === 'greve', `"${b.texto}"`);
  confere('BARRA · de:@usuario vira autor (sem a arroba)', b.de[0] === 'breno', JSON.stringify(b.de));
  confere('BARRA · #tag vira tag', b.tags[0] === 'reforma', JSON.stringify(b.tags));
  confere('BARRA · periodo', b.periodo === '7d', b.periodo);
  confere('BARRA · tipo', b.tipos[0] === 'artigo', JSON.stringify(b.tipos));
  confere('BARRA · com:midia', b.com[0] === 'midia', JSON.stringify(b.com));
  confere('BARRA · ordenação', b.ordenacao === 'recentes', b.ordenacao);
  confere('BARRA · -termo vira exclusão', b.excluir[0] === 'futebol', JSON.stringify(b.excluir));
  confere('BARRA · "frase" vira frase exata', b.frases[0] === 'frase exata', JSON.stringify(b.frases));
}
confere('BARRA · instancia aceita domínio', interpretar('instancia:ursal.zone').instancias[0] === 'ursal.zone', 'não leu');
confere('BARRA · acento no operador não atrapalha (período)', interpretar('período:24h').periodo === '24h', 'não leu com acento');
confere('BARRA · nome em inglês também vale', interpretar('from:@ana type:post sort:curtidos').de[0] === 'ana', 'não aceitou inglês');
confere('BARRA · maiúscula não importa', interpretar('DE:@Ana').de[0] === 'ana', JSON.stringify(interpretar('DE:@Ana').de));
confere('BARRA · repetição não duplica', interpretar('de:@a de:@a').de.length === 1, 'duplicou');
confere('BARRA · dois autores são dois', interpretar('de:@a de:@b').de.length === 2, 'perdeu um');

// ───────────────────────── O que NÃO pode virar comando ─────────────────────────
{
  const b = interpretar('preco: 10 reais');
  confere(
    'TEXTO · operador inexistente volta a ser texto, não vira erro',
    b.texto.includes('preco:') && b.texto.includes('reais'),
    `"${b.texto}"`,
  );
}
confere(
  'TEXTO · valor fora do esperado não vira filtro (periodo:ontem)',
  interpretar('periodo:ontem').periodo === 'tudo' && interpretar('periodo:ontem').texto.includes('periodo:ontem'),
  JSON.stringify(interpretar('periodo:ontem')),
);
confere(
  'TEXTO · tipo inventado não vira filtro',
  interpretar('tipo:musica').tipos.length === 0,
  JSON.stringify(interpretar('tipo:musica').tipos),
);
{
  const b = interpretar('"de:@breno é texto aqui"');
  confere(
    'ASPAS · dentro de aspas, operador é texto comum',
    b.de.length === 0 && b.frases.length === 1,
    JSON.stringify(b),
  );
}
confere('ASPAS · aspas sem par não quebram', interpretar('"solta').texto.length >= 0, 'quebrou');
confere('BORDA · entrada vazia devolve busca vazia', interpretar('').texto === '', 'não devolveu vazio');
confere('BORDA · só espaços não quebra', interpretar('      ').texto === '', 'não devolveu vazio');
confere(
  'BORDA · entrada gigante é cortada e não trava',
  interpretar('a '.repeat(5000)).texto.length <= 500,
  String(interpretar('a '.repeat(5000)).texto.length),
);
confere('BORDA · hashtag sozinha (#) é ignorada', interpretar('#').tags.length === 0, 'aceitou vazia');
confere('BORDA · traço sozinho (-) é ignorado', interpretar('-').excluir.length === 0, 'aceitou vazio');

// ───────────────────────── A ida e volta entre barra e painel ─────────────────────────
{
  const original = {
    ...BUSCA_VAZIA,
    texto: 'greve geral',
    frases: ['reforma agraria'],
    excluir: ['futebol'],
    de: ['breno'],
    instancias: ['ursal.zone'],
    tags: ['reforma'],
    tipos: ['artigo'],
    periodo: '7d',
    com: ['midia'],
    ordenacao: 'curtidos',
  };
  const voltou = interpretar(escrever(original));
  const campos = ['texto', 'periodo', 'ordenacao'];
  const listas = ['frases', 'excluir', 'de', 'instancias', 'tags', 'tipos', 'com'];
  const iguais =
    campos.every((c) => voltou[c] === original[c]) &&
    listas.every((c) => JSON.stringify(voltou[c]) === JSON.stringify(original[c]));
  confere(
    'VOLTA · o painel escreve na barra e a barra devolve o mesmo filtro',
    iguais,
    `${escrever(original)} => ${JSON.stringify(voltou)}`,
  );
}
confere(
  'VOLTA · filtro no padrão não polui a barra',
  escrever(BUSCA_VAZIA) === '',
  `"${escrever(BUSCA_VAZIA)}"`,
);
confere(
  'VOLTA · relevância e "tudo" são o padrão e ficam implícitos',
  !escrever({ ...BUSCA_VAZIA, texto: 'x' }).includes('ordem:') && !escrever({ ...BUSCA_VAZIA, texto: 'x' }).includes('periodo:'),
  escrever({ ...BUSCA_VAZIA, texto: 'x' }),
);
confere('VOLTA · temFiltro é falso na busca limpa', temFiltro(BUSCA_VAZIA) === false, 'achou filtro onde não há');
confere('VOLTA · temFiltro é verdadeiro com um filtro só', temFiltro({ ...BUSCA_VAZIA, de: ['a'] }) === true, 'não viu o filtro');
confere('VOLTA · só texto não conta como filtro avançado', temFiltro({ ...BUSCA_VAZIA, texto: 'oi' }) === false, 'contou texto como filtro');

// ───────────────────────── O filtro aplicado ─────────────────────────
const AGORA = Date.parse('2026-11-18T12:00:00Z');
const item = (extra) => ({
  tipo: 'post',
  autorHandle: 'breno',
  instancia: 'hiperverso.social',
  tags: ['reforma'],
  criadoEm: AGORA - 3_600_000,
  temMidia: false,
  temFonte: false,
  linha: 'texto do post sobre reforma',
  ...extra,
});

confere('FILTRO · sem filtro, tudo passa', passaNoFiltro(item(), BUSCA_VAZIA, AGORA) === true, 'barrou sem filtro');
confere('FILTRO · autor certo passa', passaNoFiltro(item(), { ...BUSCA_VAZIA, de: ['breno'] }, AGORA) === true, 'barrou o autor certo');
confere('FILTRO · autor errado não passa', passaNoFiltro(item(), { ...BUSCA_VAZIA, de: ['outro'] }, AGORA) === false, 'passou autor errado');
confere('FILTRO · tipo errado não passa', passaNoFiltro(item(), { ...BUSCA_VAZIA, tipos: ['artigo'] }, AGORA) === false, 'passou tipo errado');
confere('FILTRO · instância confere', passaNoFiltro(item(), { ...BUSCA_VAZIA, instancias: ['ursal.zone'] }, AGORA) === false, 'passou instância errada');
confere(
  'FILTRO · tags exigem TODAS as pedidas (e não qualquer uma)',
  passaNoFiltro(item({ tags: ['reforma'] }), { ...BUSCA_VAZIA, tags: ['reforma', 'terra'] }, AGORA) === false,
  'bastou uma tag',
);
confere(
  'FILTRO · período corta o que é mais velho',
  passaNoFiltro(item({ criadoEm: AGORA - 10 * 86_400_000 }), { ...BUSCA_VAZIA, periodo: '24h' }, AGORA) === false,
  'passou item velho',
);
confere(
  'FILTRO · período mantém o que é recente',
  passaNoFiltro(item(), { ...BUSCA_VAZIA, periodo: '24h' }, AGORA) === true,
  'barrou item recente',
);
confere(
  'FILTRO · item sem data não entra em filtro de período (não inventar data)',
  passaNoFiltro(item({ criadoEm: undefined }), { ...BUSCA_VAZIA, periodo: '7d' }, AGORA) === false,
  'inventou data',
);
confere(
  'FILTRO · com:midia exige mídia',
  passaNoFiltro(item(), { ...BUSCA_VAZIA, com: ['midia'] }, AGORA) === false &&
    passaNoFiltro(item({ temMidia: true }), { ...BUSCA_VAZIA, com: ['midia'] }, AGORA) === true,
  'filtro de mídia errado',
);
confere(
  'FILTRO · -termo remove quem contém o termo',
  passaNoFiltro(item(), { ...BUSCA_VAZIA, excluir: ['reforma'] }, AGORA) === false,
  'não excluiu',
);
confere(
  'FILTRO · -termo não remove quem não contém',
  passaNoFiltro(item(), { ...BUSCA_VAZIA, excluir: ['futebol'] }, AGORA) === true,
  'excluiu demais',
);
confere(
  'JANELA · os períodos têm a duração que dizem ter',
  janelaEmMs('24h') === 86_400_000 && janelaEmMs('7d') === 7 * 86_400_000 && janelaEmMs('30d') === 30 * 86_400_000 && janelaEmMs('tudo') === null,
  'duração errada',
);

console.log('');
console.log(`${total} verificações.`);
if (falhas) {
  console.log(`${falhas} falha(s).`);
  process.exit(1);
}
console.log('Operadores OK: a barra e o painel dizem a mesma coisa, e o que não é comando continua sendo busca.');
