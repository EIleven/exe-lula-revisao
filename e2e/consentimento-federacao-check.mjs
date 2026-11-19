#!/usr/bin/env node
/**
 * Consentimento na federação (src/lib/activitypub/consentimentoDeDominio.ts):
 *   node e2e/consentimento-federacao-check.mjs        (ou: npm run e2e:consentimento)
 *
 * O que está em jogo não é um número de retentativa. É o seguinte: quando uma instância nos desfedera, continuar
 * batendo na porta dela a cada post novo não é resiliência, é desrespeito — e do lado de lá é exatamente assim que
 * se parece. O disjuntor que já existia media só se o servidor estava DE PÉ, e dizia, em comentário, que 403 "não
 * conta porque não é queda". Está certo para disponibilidade e errado para consentimento.
 *
 * Mas o erro contrário também é grave, e é o mais fácil de cometer: UMA pessoa que nos bloqueia não pode derrubar a
 * entrega para o servidor inteiro, onde centenas de outras continuam nos recebendo. Por isso a contagem é de
 * recusas CONSECUTIVAS, e qualquer entrega aceita zera tudo. Metade das verificações abaixo é sobre esse cuidado.
 *
 * Sai com código 1 se algo falhar.
 */
import {
  ESCADA_DE_PAUSA_HORAS,
  LIMITE_DE_RECUSAS,
  aposEntregaAceita,
  aposRecusa,
  ehRecusaDeConsentimento,
  horasDePausa,
  pausaDeConsentimento,
} from '../src/lib/activitypub/consentimentoDeDominio.ts';

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

const AGORA = Date.parse('2026-11-19T12:00:00Z');
const HORA = 3_600_000;

// ───────────────────────── O que é recusa, e o que não é ─────────────────────────
confere('RECUSA · 403 é recusa ("sei quem você é e não quero")', ehRecusaDeConsentimento(403) === true, 'não reconheceu');
confere(
  'RECUSA · 401 NÃO é recusa — é assinatura, quase sempre problema nosso',
  ehRecusaDeConsentimento(401) === false,
  'tratou erro nosso como recusa deles',
);
confere(
  'RECUSA · 404, 410, 500, 429 e timeout não são recusa',
  [404, 410, 500, 503, 429, 408, null, undefined].every((s) => ehRecusaDeConsentimento(s) === false),
  'confundiu queda com recusa',
);

// ───────────────────────── Uma recusa não pausa nada ─────────────────────────
{
  let saude = aposRecusa(null, AGORA);
  confere('CONTAGEM · a primeira recusa só conta', saude.consecutiveRefusals === 1 && saude.refusedUntilMs === 0, JSON.stringify(saude));
  confere('CONTAGEM · e a entrega continua liberada', pausaDeConsentimento(saude, AGORA).pausado === false, 'pausou cedo demais');

  saude = aposRecusa(saude, AGORA);
  confere('CONTAGEM · a segunda também não pausa', pausaDeConsentimento(saude, AGORA).pausado === false, 'pausou na segunda');

  saude = aposRecusa(saude, AGORA);
  const d = pausaDeConsentimento(saude, AGORA);
  confere('CONTAGEM · na terceira recusa seguida, para', d.pausado === true, JSON.stringify(saude));
  confere('CONTAGEM · o limite é 3', LIMITE_DE_RECUSAS === 3, String(LIMITE_DE_RECUSAS));
  confere('CONTAGEM · a primeira pausa é de 1 dia', d.pausado && d.ate === AGORA + 24 * HORA, JSON.stringify(d));
}

// ───────────────────────── O cuidado que mais importa ─────────────────────────
{
  // Cenário real: um contato nos bloqueia (403), mas o resto daquele servidor continua nos recebendo.
  let saude = aposRecusa(aposRecusa(null, AGORA), AGORA); // duas recusas daquela pessoa
  saude = { ...saude, ...aposEntregaAceita() }; // uma entrega para OUTRA pessoa do mesmo servidor deu certo
  confere(
    'UMA PESSOA · entrega aceita zera as recusas (um bloqueio não derruba o servidor inteiro)',
    saude.consecutiveRefusals === 0 && saude.refusedUntilMs === 0,
    JSON.stringify(saude),
  );
  saude = aposRecusa(saude, AGORA);
  confere(
    'UMA PESSOA · depois de zerar, a contagem recomeça do zero',
    saude.consecutiveRefusals === 1 && pausaDeConsentimento(saude, AGORA).pausado === false,
    JSON.stringify(saude),
  );
}
{
  // E o caso em que parar está CERTO: aquele contato é o único que temos lá, então só vêm recusas.
  let saude = null;
  for (let i = 0; i < 3; i++) saude = aposRecusa(saude, AGORA);
  confere(
    'ÚNICO CONTATO · só recusas, nenhuma aceita: aí sim para',
    pausaDeConsentimento(saude, AGORA).pausado === true,
    JSON.stringify(saude),
  );
}

// ───────────────────────── A pausa tem prazo, e cresce ─────────────────────────
{
  let saude = null;
  for (let i = 0; i < 3; i++) saude = aposRecusa(saude, AGORA);
  const primeira = pausaDeConsentimento(saude, AGORA);
  saude = aposRecusa(saude, AGORA);
  const segunda = pausaDeConsentimento(saude, AGORA);
  confere('ESCADA · insistir em recusar aumenta a pausa', segunda.ate > primeira.ate, `${primeira.ate} -> ${segunda.ate}`);
  confere('ESCADA · a escada começa em 1 dia e termina em 30', ESCADA_DE_PAUSA_HORAS[0] === 24 && ESCADA_DE_PAUSA_HORAS[ESCADA_DE_PAUSA_HORAS.length - 1] === 720, JSON.stringify(ESCADA_DE_PAUSA_HORAS));
  confere('ESCADA · e não cresce para sempre (teto de 30 dias)', horasDePausa(999) === 720, String(horasDePausa(999)));
}
{
  let saude = null;
  for (let i = 0; i < 3; i++) saude = aposRecusa(saude, AGORA);
  const ate = pausaDeConsentimento(saude, AGORA).ate;
  confere(
    'PRAZO · passado o prazo, a entrega volta SOZINHA (banimento por heurística ninguém desfaz depois)',
    pausaDeConsentimento(saude, ate + 1).pausado === false,
    'a pausa ficou permanente',
  );
  confere('PRAZO · um minuto antes do prazo ainda está pausado', pausaDeConsentimento(saude, ate - 60_000).pausado === true, 'soltou cedo');
  confere(
    'PRAZO · e quem voltar a nos aceitar zera tudo na hora',
    (() => { const s = { ...saude, ...aposEntregaAceita() }; return pausaDeConsentimento(s, AGORA).pausado === false; })(),
    'continuou pausado depois de uma entrega aceita',
  );
}

// ───────────────────────── Bordas ─────────────────────────
confere('BORDA · domínio sem histórico nenhum está liberado', pausaDeConsentimento(null, AGORA).pausado === false, 'pausou sem motivo');
confere('BORDA · registro antigo (sem os campos novos) está liberado', pausaDeConsentimento({ consecutiveFailures: 9 }, AGORA).pausado === false, 'pausou registro legado');
confere(
  'BORDA · valor corrompido não vira pausa eterna nem contagem negativa',
  pausaDeConsentimento({ refusedUntilMs: Number.NaN }, AGORA).pausado === false &&
    aposRecusa({ consecutiveRefusals: -5 }, AGORA).consecutiveRefusals === 1,
  'aceitou lixo',
);
confere('BORDA · relógio quebrado não pausa', pausaDeConsentimento({ refusedUntilMs: AGORA + HORA }, Number.NaN).pausado === false, 'decidiu com NaN');

console.log('');
console.log(`${total} verificações.`);
if (falhas) {
  console.log(`${falhas} falha(s).`);
  process.exit(1);
}
console.log('Consentimento OK: quem nos recusa para de receber, uma pessoa não derruba o servidor, e a pausa tem prazo.');
