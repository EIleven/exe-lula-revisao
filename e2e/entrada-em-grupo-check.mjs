#!/usr/bin/env node
/**
 * Quem pode ser colocado num grupo (src/lib/messages/entradaEmGrupo.ts):
 *   node e2e/entrada-em-grupo-check.mjs        (ou: npm run e2e:entrada-grupo)
 *
 * O defeito que isto fecha: a conversa 1:1 respeitava a escolha do outro lado (dmPreference e bloqueio nos dois
 * sentidos) e o grupo não respeitava nada. Quem fechou a caixa de entrada, ou bloqueou alguém, podia ser jogado por
 * essa mesma pessoa numa sala com centenas de desconhecidos -- a porta dos fundos era mais larga que a da frente.
 *
 * Por isso a verificação central aqui não é um caso, é uma PROPRIEDADE: para conta local, em TODA combinação de
 * sinais, se o grupo aceita então o 1:1 também aceitaria. Grupo expõe mais que DM, logo nunca pode ser mais frouxo.
 *
 * Sai com código 1 se algo falhar.
 */
import {
  MOTIVO_EM_PALAVRAS,
  entraNoGrupo,
  podeEntrarNoGrupo,
  triarEntradas,
} from '../src/lib/messages/entradaEmGrupo.ts';

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

const recusa = (sinais, motivoEsperado) => {
  const v = podeEntrarNoGrupo(sinais);
  return v.entra === false && v.motivo === motivoEsperado;
};

// ─────────────────────────── 1. Caixa de entrada aberta ───────────────────────────
confere('PADRÃO · sem sinal nenhum, entra', podeEntrarNoGrupo({}).entra === true, 'o caminho comum travou');
confere("PADRÃO · dmPreference 'everyone' entra", entraNoGrupo({ dmPreference: 'everyone' }), 'everyone foi barrado');
confere(
  'PADRÃO · dmPreference ausente vale como everyone',
  entraNoGrupo({ dmPreference: undefined }) && entraNoGrupo({ dmPreference: null }),
  'campo ausente barrou',
);
confere(
  'PADRÃO · valor desconhecido vale como everyone (igual ao get(...,"everyone") da regra)',
  entraNoGrupo({ dmPreference: 'banana' }),
  'um valor novo qualquer barraria gente sem motivo',
);

// ─────────────────────────── 2. Caixa fechada ───────────────────────────
confere("FECHADA · 'none' recusa", recusa({ dmPreference: 'none' }, 'caixa-fechada'), "'none' passou");
confere(
  "FECHADA · 'nobody' (valor legado) TAMBÉM recusa",
  recusa({ dmPreference: 'nobody' }, 'caixa-fechada'),
  'o valor legado abria um buraco: quem fechou antes da troca de nome voltaria a ser adicionável',
);

// ─────────────────────────── 3. Só quem ela segue ───────────────────────────
confere(
  "SEGUE · 'followed' com o alvo seguindo o ator, entra",
  entraNoGrupo({ dmPreference: 'followed', alvoSegueOAtor: true }),
  'quem segue foi barrado',
);
confere(
  "SEGUE · 'followed' sem seguir recusa",
  recusa({ dmPreference: 'followed' }, 'so-quem-ela-segue'),
  'estranho entrou em quem só aceita de quem segue',
);
confere(
  'SEGUE · o sentido é o alvo seguindo o ATOR, não o contrário',
  recusa({ dmPreference: 'followed', alvoSegueOAtor: false }, 'so-quem-ela-segue'),
  'o sentido do seguimento está invertido',
);

// ─────────────────────────── 4. Bloqueio vence tudo ───────────────────────────
confere(
  'BLOQUEIO · o alvo bloqueou o ator: recusa mesmo com a caixa aberta',
  recusa({ dmPreference: 'everyone', alvoBloqueouOAtor: true }, 'bloqueio'),
  'bloqueio não foi respeitado',
);
confere(
  'BLOQUEIO · o ator bloqueou o alvo: recusa também (os dois sentidos)',
  recusa({ dmPreference: 'everyone', atorBloqueouOAlvo: true }, 'bloqueio'),
  'só um sentido do bloqueio foi checado',
);
confere(
  'BLOQUEIO · é testado ANTES da preferência (a mensagem não revela a preferência de quem bloqueou)',
  recusa({ dmPreference: 'none', alvoBloqueouOAtor: true }, 'bloqueio'),
  'o motivo devolvido vaza qual era a configuração do outro lado',
);
confere(
  'BLOQUEIO · vence até a dispensa de conta remota',
  recusa({ ehRemoto: true, alvoBloqueouOAtor: true }, 'bloqueio'),
  'conta do Fediverso furou o bloqueio',
);

// ─────────────────────────── 5. Conta remota ───────────────────────────
// O stub de conta do Fediverso é criado localmente com dmPreference 'none' como PLACEHOLDER (ver
// MentionSuggestions). 'none' ali significa "não sei", não "ela recusou" -- então a dispensa é da preferência, e
// somente dela.
confere(
  "REMOTA · dispensa a preferência ('none' local é placeholder, não recusa dela)",
  entraNoGrupo({ ehRemoto: true, dmPreference: 'none' }),
  'conta do Fediverso ficou impossível de adicionar',
);
confere(
  "REMOTA · dispensa também o 'followed'",
  entraNoGrupo({ ehRemoto: true, dmPreference: 'followed', alvoSegueOAtor: false }),
  'conta do Fediverso barrada por um campo que não é dela',
);

// ─────────────────────────── 6. Triagem de lista ───────────────────────────
{
  const candidatos = [
    { id: 'a', pref: 'everyone' },
    { id: 'b', pref: 'none' },
    { id: 'c', pref: 'followed', segue: true },
    { id: 'd', pref: 'followed', segue: false },
    { id: 'e', pref: 'everyone', bloqueou: true },
  ];
  const { aceitos, recusados } = triarEntradas(candidatos, (c) => ({
    dmPreference: c.pref,
    alvoSegueOAtor: c.segue,
    alvoBloqueouOAtor: c.bloqueou,
  }));
  confere(
    'TRIAGEM · separa aceitos e recusados preservando a ordem',
    aceitos.map((c) => c.id).join(',') === 'a,c',
    `aceitou ${aceitos.map((c) => c.id).join(',')}`,
  );
  confere(
    'TRIAGEM · devolve o motivo de cada recusa (em vez de sumir com a pessoa calado)',
    recusados.map((r) => `${r.candidato.id}:${r.motivo}`).join(',') ===
      'b:caixa-fechada,d:so-quem-ela-segue,e:bloqueio',
    `motivos vieram como ${recusados.map((r) => `${r.candidato.id}:${r.motivo}`).join(',')}`,
  );
  confere(
    'TRIAGEM · lista vazia não explode',
    triarEntradas([], () => ({})).aceitos.length === 0,
    'lista vazia quebrou',
  );
  confere(
    'TRIAGEM · todo motivo tem texto para a pessoa',
    recusados.every(
      (r) => typeof MOTIVO_EM_PALAVRAS[r.motivo] === 'string' && MOTIVO_EM_PALAVRAS[r.motivo].length > 0,
    ),
    'um motivo ficaria sem mensagem na tela',
  );
}

// ─────────────────────── 7. PROPRIEDADE: grupo nunca mais frouxo que o 1:1 ───────────────────────
// Referência copiada de `isValidNewConversation` (firestore.rules), a trava que a conversa 1:1 já aplicava:
//   pref != 'none' && (pref != 'followed' || alvo segue ator) && sem bloqueio nos dois sentidos
const umDoisUmAceitaria = ({ dmPreference, alvoSegueOAtor, alvoBloqueouOAtor, atorBloqueouOAlvo }) => {
  const pref = dmPreference === undefined || dmPreference === null ? 'everyone' : dmPreference;
  return (
    pref !== 'none' &&
    (pref !== 'followed' || alvoSegueOAtor === true) &&
    alvoBloqueouOAtor !== true &&
    atorBloqueouOAlvo !== true
  );
};

{
  let violacoes = 0;
  let combinacoes = 0;
  for (const dmPreference of ['everyone', 'followed', 'none', 'nobody', undefined, 'banana']) {
    for (const alvoSegueOAtor of [true, false]) {
      for (const alvoBloqueouOAtor of [true, false]) {
        for (const atorBloqueouOAlvo of [true, false]) {
          combinacoes++;
          const sinais = { dmPreference, alvoSegueOAtor, alvoBloqueouOAtor, atorBloqueouOAlvo };
          // Conta LOCAL: a dispensa da conta remota é a única exceção prevista, provada no bloco 5.
          if (entraNoGrupo(sinais) && !umDoisUmAceitaria(sinais)) violacoes++;
        }
      }
    }
  }
  confere(
    `PROPRIEDADE · em ${combinacoes} combinações de conta local, grupo nunca aceita quem o 1:1 recusaria`,
    violacoes === 0,
    `${violacoes} combinação(ões) em que a porta dos fundos é mais larga que a da frente`,
  );
  confere(
    'PROPRIEDADE · e a referência do 1:1 não é vacuamente verdadeira (ela aceita alguém)',
    umDoisUmAceitaria({ dmPreference: 'everyone' }) === true &&
      umDoisUmAceitaria({ dmPreference: 'none' }) === false,
    'a função de referência está quebrada, logo a propriedade não provou nada',
  );
}

console.log('');
console.log(`${total} verificações.`);
if (falhas) {
  console.log(`${falhas} falha(s).`);
  process.exit(1);
}
console.log(
  'Entrada em grupo OK: bloqueio nos dois sentidos, caixa fechada respeitada (inclusive o valor legado) e grupo nunca mais frouxo que o 1:1.',
);
