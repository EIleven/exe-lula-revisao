#!/usr/bin/env node
/**
 * Testa src/lib/poll.ts (validação, formato gravado, percentuais e prazo da enquete) sem app nem emuladores: importa o módulo
 * TypeScript direto (o Node 22 remove os tipos).
 *   node e2e/poll-check.mjs
 * Sai com código 1 se algo falhar.
 */
const {
  POLL_DEFAULT_DURATION_MINUTES,
  buildPoll,
  canVote,
  cleanOption,
  pollResults,
  pollTimeLeft,
  validatePoll,
} = await import('../src/lib/poll.ts');

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
const ok = (options, durationMinutes = POLL_DEFAULT_DURATION_MINUTES) => validatePoll({ options, durationMinutes });

// Validação
confere('2 opções preenchidas e prazo de 1 dia: válida', ok(['Sim', 'Não']) === null);
confere('4 opções: válida', ok(['a', 'b', 'c', 'd']) === null);
confere('só 1 opção: faltam opções', ok(['Sim', '']) === 'tooFew');
confere('opções em branco são ignoradas (2 preenchidas entre 4 campos)', ok(['Sim', '', 'Não', '   ']) === null);
confere('5 opções preenchidas: passa do máximo', ok(['a', 'b', 'c', 'd', 'e']) === 'tooMany');
confere('opção com 26 caracteres: longa demais', ok(['x'.repeat(26), 'Não']) === 'tooLong');
confere('opção com exatamente 25 caracteres: válida', ok(['x'.repeat(25), 'Não']) === null);
confere('emoji conta como 1 caractere (25 emojis cabem)', ok(['😀'.repeat(25), 'Não']) === null);
confere('opções repetidas (sem diferenciar maiúsculas): recusada', ok(['Sim', 'sim']) === 'duplicate');
confere('espaços extras viram um só e não escondem a repetição', ok(['a  b', 'A B']) === 'duplicate');
confere('prazo fora das opções oferecidas: recusado', ok(['Sim', 'Não'], 7) === 'duration');
confere('prazo de 7 dias (10080 min): válido', ok(['Sim', 'Não'], 10080) === null);
confere('cleanOption tira espaços das pontas e repetidos', cleanOption('  oi   tudo  bem ') === 'oi tudo bem');

// Formato gravado
{
  const agora = Date.UTC(2026, 9, 25, 12, 0, 0);
  const built = buildPoll({ options: ['  Sim ', 'Não', '', 'Talvez'], durationMinutes: 60 }, agora);
  confere('ids fixos a, b, c na ordem das opções preenchidas', JSON.stringify(built.poll.options) === '[{"id":"a","text":"Sim"},{"id":"b","text":"Não"},{"id":"c","text":"Talvez"}]', JSON.stringify(built.poll.options));
  confere('pollOptionIds acompanha as opções (as regras conferem o voto contra ele)', JSON.stringify(built.pollOptionIds) === '["a","b","c"]');
  confere('contadores nascem zerados', JSON.stringify(built.pollCounts) === '{"a":0,"b":0,"c":0}' && built.pollTotal === 0);
  confere('endsAt = agora + duração', built.poll.endsAt.getTime() === agora + 3_600_000);
  let lancou = false;
  try { buildPoll({ options: ['só uma'], durationMinutes: 60 }, agora); } catch { lancou = true; }
  confere('uma enquete inválida não é montada', lancou);
}

// Percentuais
{
  const opcoes = [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }];
  const soma = (linhas) => linhas.reduce((s, l) => s + l.percent, 0);
  const iguais = pollResults(opcoes, { a: 1, b: 1, c: 1 }, 3);
  confere('três votos iguais: 34+33+33 = 100 (e não 99)', soma(iguais) === 100 && iguais[0].percent === 34, JSON.stringify(iguais.map((l) => l.percent)));
  const sem = pollResults(opcoes, { a: 0, b: 0, c: 0 }, 0);
  confere('sem votos: tudo em 0%', soma(sem) === 0 && sem.every((l) => l.percent === 0));
  const semContadores = pollResults(opcoes, null, null);
  confere('sem contadores ainda (post antigo): tudo em 0%', soma(semContadores) === 0);
  const desigual = pollResults(opcoes, { a: 7, b: 2, c: 1 }, 10);
  confere('7, 2 e 1 votos: 70%, 20% e 10%', desigual.map((l) => l.percent).join(',') === '70,20,10', desigual.map((l) => l.percent).join(','));
  const arredonda = pollResults(opcoes, { a: 1, b: 2, c: 4 }, 7);
  confere('1, 2 e 4 de 7 votos somam 100', soma(arredonda) === 100, arredonda.map((l) => l.percent).join(','));
  const totalAtrasado = pollResults(opcoes, { a: 3, b: 0, c: 0 }, 2);
  confere('o total atrasado (menor que a soma) nunca passa de 100%', soma(totalAtrasado) === 100 && totalAtrasado[0].percent === 100, JSON.stringify(totalAtrasado.map((l) => l.percent)));
}

// Prazo e voto
{
  const fim = 10 * 24 * 3_600_000;
  const t1 = pollTimeLeft(fim, fim - (2 * 86_400_000 + 3 * 3_600_000 + 5 * 60_000));
  confere('2 dias, 3 horas e 5 minutos', t1.ended === false && t1.days === 2 && t1.hours === 3 && t1.minutes === 5, JSON.stringify(t1));
  const t2 = pollTimeLeft(fim, fim - 1000);
  confere('faltando 1 segundo ainda mostra 1 minuto (arredonda para cima)', t2.ended === false && t2.minutes === 1 && t2.hours === 0, JSON.stringify(t2));
  confere('no instante do fim: encerrada', pollTimeLeft(fim, fim).ended === true);
  confere('depois do fim: encerrada', pollTimeLeft(fim, fim + 5).ended === true);
  confere('pode votar: aberta e sem voto', canVote(fim, fim - 1, null) === true);
  confere('não pode votar de novo', canVote(fim, fim - 1, 'a') === false);
  confere('não pode votar depois do fim', canVote(fim, fim, null) === false);
}

console.log(`${total - falhas} de ${total} conferências passaram`);
console.log(falhas ? 'RESULTADO: HÁ FALHAS' : 'RESULTADO: PASSOU');
process.exitCode = falhas ? 1 : 0;
