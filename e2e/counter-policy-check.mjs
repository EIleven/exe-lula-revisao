#!/usr/bin/env node
/**
 * Quando confiar no contador que a instância de ORIGEM informa para um post remoto (src/lib/federation/counterPolicy.ts):
 *   node e2e/counter-policy-check.mjs        (ou: npm run e2e:contadores-remotos)
 *
 * O `Math.max(guardado, origem)` antigo nunca descia (quem descurtia no Fediverso continuava contado para sempre) e perpetuava
 * qualquer número inflado já gravado. A regra nova: a origem manda quando responde com número válido e recente, nunca se
 * mostra menos gente do que sabemos que reagiu (piso), queda para ZERO só com confirmação, leitura velha nunca vence.
 * Sai com código 1 se algo falhar.
 */
import { reconcileRemoteCount, SMALL_STORED } from '../src/lib/federation/counterPolicy.ts';

let falhas = 0;
let total = 0;
const confere = (nome, condicao, motivo, detalhe) => {
  total++;
  if (condicao) console.log(`OK    ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo}`); }
};
const eh = (entrada, valor, acao, motivo) => {
  const r = reconcileRemoteCount(entrada);
  return r.value === valor && r.action === acao && (motivo === undefined || r.reason === motivo) ? true : JSON.stringify(r);
};
const ok = (nome, entrada, valor, acao, motivo) => { const r = eh(entrada, valor, acao, motivo); confere(nome, r === true, `esperava ${valor}/${acao}${motivo ? `/${motivo}` : ''}, veio ${r}`); };

ok('SOBE · a origem tem mais gente: o contador sobe', { stored: 5, origin: 9 }, 9, 'raise', 'origem-maior');
ok('IGUAL · a origem concorda: nada muda', { stored: 5, origin: 5 }, 5, 'keep', 'igual');
ok('DESCE · alguém descurtiu no Fediverso: a origem tem menos e o contador acompanha (o Math.max antigo nunca descia)', { stored: 10, origin: 9 }, 9, 'lower', 'queda-aceita');
ok('PISO · a origem diz 7, mas sabemos de 9 pessoas que reagiram: nunca mostra menos que isso', { stored: 10, origin: 7, floor: 9 }, 9, 'lower', 'queda-aceita');
ok('PISO · as curtidas DAQUI ainda não chegaram à origem (origem 4, piso 6, guardado 5): sobe até o piso', { stored: 5, origin: 4, floor: 6 }, 6, 'raise', 'piso-maior');
ok('CURA · valor inflado por engano (guardado 10, origem 3, piso 3): volta ao verdadeiro', { stored: 10, origin: 3, floor: 3 }, 3, 'lower', 'queda-aceita');

ok('ZERO · a origem diz 0 e temos 25: SUSPEITO (instâncias que escondem contagem devolvem 0), mantém', { stored: 25, origin: 0 }, 25, 'keep', 'queda-a-zero-suspeita');
ok('ZERO · ...a menos que a lista de quem reagiu, enumerada, confirme que não há ninguém', { stored: 25, origin: 0, confirmedZero: true }, 0, 'lower', 'zero-confirmado');
ok('ZERO · ...ou que o guardado já fosse pequeno (3 ou menos): confiar custa pouco', { stored: SMALL_STORED, origin: 0 }, 0, 'lower', 'zero-confirmado');
ok('ZERO · guardado de 4 já é grande o bastante para desconfiar', { stored: SMALL_STORED + 1, origin: 0 }, SMALL_STORED + 1, 'keep', 'queda-a-zero-suspeita');
ok('ZERO · origem 0, mas há piso (3 marcadores): o alvo não é zero, então a queda é aceita até o piso', { stored: 25, origin: 0, floor: 3 }, 3, 'lower', 'queda-aceita');

for (const origem of [undefined, null, Number.NaN, '7', -1, Infinity, 1e15, {}, [], true]) {
  ok(`ORIGEM INVÁLIDA · ${JSON.stringify(origem) ?? String(origem)} não mexe no contador`, { stored: 8, origin: origem }, 8, 'keep', 'origem-sem-numero');
}
ok('ORIGEM INVÁLIDA · mas o piso ainda pode subir o contador (o que sabemos que existe)', { stored: 2, origin: undefined, floor: 5 }, 5, 'raise', 'piso-maior');
ok('ORIGEM INVÁLIDA · e o piso nunca o faz descer', { stored: 8, origin: undefined, floor: 5 }, 8, 'keep', 'origem-sem-numero');

ok('ORDEM · uma leitura mais antiga que a já aplicada nunca vence', { stored: 10, origin: 3, fetchedAtMs: 1000, storedFetchedAtMs: 2000 }, 10, 'keep', 'leitura-antiga');
ok('ORDEM · mesma hora ou mais nova vale', { stored: 10, origin: 3, fetchedAtMs: 2000, storedFetchedAtMs: 2000 }, 3, 'lower', 'queda-aceita');
ok('ORDEM · sem hora aplicada antes (documento antigo), a leitura vale', { stored: 10, origin: 3, fetchedAtMs: 1000, storedFetchedAtMs: null }, 3, 'lower', 'queda-aceita');

ok('ENTRADA RUIM · guardado inválido (NaN, texto, negativo) conta como 0', { stored: Number.NaN, origin: 4 }, 4, 'raise', 'origem-maior');
ok('ENTRADA RUIM · decimal da origem é arredondado para baixo', { stored: 1, origin: 4.9 }, 4, 'raise', 'origem-maior');

// invariantes sobre muitas entradas aleatórias (semente fixa: reproduzível)
let semente = 42;
const rnd = () => { semente = (semente * 1664525 + 1013904223) % 4294967296; return semente / 4294967296; };
const pick = (n) => (rnd() < 0.15 ? undefined : Math.floor(rnd() * n));
let violacoes = [];
for (let i = 0; i < 20_000; i++) {
  const e = { stored: pick(50) ?? 0, origin: rnd() < 0.1 ? 'x' : pick(50), floor: pick(30), confirmedZero: rnd() < 0.2, fetchedAtMs: pick(10), storedFetchedAtMs: rnd() < 0.3 ? null : pick(10) };
  const r = reconcileRemoteCount(e);
  const floor = e.floor ?? 0;
  const falha =
    !Number.isInteger(r.value) || r.value < 0 ? 'valor inválido'
    : r.action === 'keep' && r.value !== e.stored ? 'keep mudou o valor'
    : r.action === 'raise' && r.value <= e.stored ? 'raise não subiu'
    : r.action === 'lower' && r.value >= e.stored ? 'lower não desceu'
    : r.action === 'lower' && r.value < floor ? 'desceu abaixo do piso'
    : r.action === 'lower' && r.value === 0 && e.stored > SMALL_STORED && !e.confirmedZero ? 'zero sem confirmação'
    : r.action !== 'keep' && typeof e.origin === 'number' && typeof e.fetchedAtMs === 'number' && typeof e.storedFetchedAtMs === 'number' && e.fetchedAtMs < e.storedFetchedAtMs ? 'leitura antiga venceu'
    : null;
  if (falha) violacoes.push(`${falha}: ${JSON.stringify(e)} → ${JSON.stringify(r)}`);
  // idempotência: reaplicar a mesma leitura ao valor já decidido não muda mais nada
  const de = reconcileRemoteCount({ ...e, stored: r.value });
  if (r.action !== 'keep' && de.action !== 'keep') violacoes.push(`não idempotente: ${JSON.stringify(e)}`);
}
confere('INVARIANTES · 20.000 entradas aleatórias: valor inteiro e não negativo; raise sobe, lower desce, keep não mexe; nunca abaixo do piso; zero só confirmado; leitura velha nunca vence; reaplicar não muda mais nada', violacoes.length === 0, violacoes.slice(0, 3).join(' | '));

console.log('');
console.log(`${total} verificações.`);
if (falhas) { console.log(`${falhas} falha(s).`); process.exit(1); }
console.log('Regra de contadores remotos OK: a origem manda quando é confiável, o piso protege, o zero precisa de confirmação.');
