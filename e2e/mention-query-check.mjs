#!/usr/bin/env node
/**
 * Menção a um endereço LOCAL (`@usuario@exercitodolula.app`): src/lib/mentions/localAddress.ts
 *   node e2e/mention-query-check.mjs        (ou: npm run e2e:mencao-local)
 *
 * Antes: o texto inteiro ia para a busca local (o `username` só guarda `ExercitoDoLula`) e depois ao resolvedor do Fediverso,
 * que responde "perfil-local"; a lista dizia "Nenhum resultado encontrado" para uma conta que existe. Aqui se prova a leitura
 * do que a pessoa digita: o que é daqui, o que é de outro servidor e o que ainda está sendo digitado.
 * Sai com código 1 se algo falhar.
 */
import { parseLocalMentionQuery, plainLocalHandle } from '../src/lib/mentions/localAddress.ts';

let falhas = 0;
let total = 0;
const confere = (nome, condicao, motivo) => {
  total++;
  if (condicao) console.log(`OK    ${nome}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo ?? 'condição falsa'}`); }
};
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const DOM = ['exercitodolula.app', 'www.exercitodolula.app'];
const casos = [
  ['o caso do relato (com @ da frente, caixa mista)', '@ExercitoDoLula@exercitodolula.app', { handle: 'exercitodolula', complete: true }],
  ['sem o @ da frente', 'ExercitoDoLula@exercitodolula.app', { handle: 'exercitodolula', complete: true }],
  ['domínio em maiúsculas', '@ana@EXERCITODOLULA.APP', { handle: 'ana', complete: true }],
  ['com www', '@ana@www.exercitodolula.app', { handle: 'ana', complete: true }],
  ['espaços em volta', '  @ana@exercitodolula.app  ', { handle: 'ana', complete: true }],
  ['digitando o domínio: só o @', '@ExercitoDoLula@', { handle: 'exercitodolula', complete: false }],
  ['digitando o domínio: "e"', '@ana@e', { handle: 'ana', complete: false }],
  ['digitando o domínio: "exercito"', '@ana@exercito', { handle: 'ana', complete: false }],
  ['digitando o domínio: "exercitodolula."', '@ana@exercitodolula.', { handle: 'ana', complete: false }],
  ['digitando o domínio: "w"', '@ana@w', { handle: 'ana', complete: false }],
  ['handle curto enquanto digita', '@a@exercitodolula.app', { handle: 'a', complete: true }],
  ['com sublinhado e número', '@Maria_2026@exercitodolula.app', { handle: 'maria_2026', complete: true }],
  // o que NÃO é local
  ['outro servidor', '@fulano@mastodon.social', null],
  ['outro servidor com o mesmo começo letra a letra', '@fulano@exemplo.com', null],
  ['domínio que contém o nosso, mas não é o nosso', '@ana@exercitodolula.app.evil.com', null],
  ['domínio que termina com o nosso', '@ana@evil-exercitodolula.app', null],
  ['subdomínio nosso que não existe', '@ana@media.exercitodolula.app', null],
  ['sem @ no meio: é uma busca comum', '@ExercitoDoLula', null],
  ['busca comum por nome', 'Exército do Lula', null],
  ['dois @ no domínio', '@ana@exercitodolula.app@x', null],
  ['parte local com caractere inválido', '@a.b@exercitodolula.app', null],
  ['parte local grande demais', '@aaaaaaaaaaaaaaaa@exercitodolula.app', null],
  ['parte local vazia', '@@exercitodolula.app', null],
  ['vazio', '', null],
  ['só espaços', '   ', null],
];
for (const [nome, entrada, esperado] of casos) {
  const obtido = parseLocalMentionQuery(entrada, DOM);
  confere(`LOCAL · ${nome}: ${JSON.stringify(entrada)}`, igual(obtido, esperado), `esperava ${JSON.stringify(esperado)}, veio ${JSON.stringify(obtido)}`);
}
for (const estranho of [null, undefined, 0, 42, {}, [], true]) {
  let r;
  try { r = parseLocalMentionQuery(estranho, DOM); } catch (e) { r = `LANÇOU ${e}`; }
  confere(`LOCAL · valor que não é texto (${typeof estranho}) devolve null sem lançar`, r === null, String(r));
}
confere('LOCAL · sem domínios configurados nada é local', parseLocalMentionQuery('@ana@exercitodolula.app', []) === null, 'tratou como local');
confere('LOCAL · domínio configurado com maiúsculas também vale', igual(parseLocalMentionQuery('@ana@exercitodolula.app', ['ExercitoDoLula.App']), { handle: 'ana', complete: true }), 'ignorou');

for (const [entrada, esperado] of [['ExercitoDoLula', 'exercitodolula'], ['@Ana', 'ana'], ['  bia  ', 'bia'], ['ab', null], ['abcdefghijklmnop', null], ['a b', null], ['ana@exercitodolula.app', null], ['#tag', null], ['', null], [null, null], [42, null]]) {
  confere(`PURO · ${JSON.stringify(entrada)} → ${JSON.stringify(esperado)}`, plainLocalHandle(entrada) === esperado, String(plainLocalHandle(entrada)));
}

console.log(`\n${total - falhas}/${total} verificações passaram.`);
if (falhas > 0) { console.log(`${falhas} FALHA(S).`); process.exit(1); }
