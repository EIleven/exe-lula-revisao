#!/usr/bin/env node
/**
 * As regras da trava das mensagens (src/lib/seguranca/travaDeTela.ts):
 *   node e2e/trava-mensagens-check.mjs        (ou: npm run e2e:trava)
 *
 * O que está em jogo: uma trava erra para os dois lados, e os dois lados doem. Frouxa demais, as conversas abrem
 * para quem pegou o celular. Apertada demais, tranca a própria dona do lado de fora — e sem digital cadastrada
 * NÃO EXISTE como abrir. Por isso a regra central provada aqui é: sem digital cadastrada, a trava nunca liga,
 * aconteça o que acontecer.
 *
 * Sai com código 1 se algo falhar.
 */
import {
  MINUTOS_ATE_PEDIR_DE_NOVO,
  chaveDaPasskey,
  chaveDaTrava,
  lerEscolha,
  podeTravar,
  precisaPedirDeNovo,
  salvarEscolha,
  temDigitalCadastrada,
  travaAtiva,
} from '../src/lib/seguranca/travaDeTela.ts';

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

/** Um localStorage de mentira. `quebrado` imita janela privada: tudo que toca nele lança. */
const criarArmazenamento = (inicial = {}, quebrado = false) => {
  const mapa = new Map(Object.entries(inicial));
  return {
    getItem(c) {
      if (quebrado) throw new Error('armazenamento bloqueado');
      return mapa.has(c) ? mapa.get(c) : null;
    },
    setItem(c, v) {
      if (quebrado) throw new Error('armazenamento bloqueado');
      mapa.set(c, v);
    },
    removeItem(c) {
      if (quebrado) throw new Error('armazenamento bloqueado');
      mapa.delete(c);
    },
  };
};

const UID = 'uid_breno';
const OUTRO = 'uid_outra_pessoa';

// ───────────────────────── Digital cadastrada ─────────────────────────
confere(
  'DIGITAL · lê a mesma chave que a tela de Chaves grava',
  chaveDaPasskey(UID) === `idp2p_passkey_${UID}`,
  chaveDaPasskey(UID),
);
confere(
  'DIGITAL · reconhece quando existe',
  temDigitalCadastrada(criarArmazenamento({ [chaveDaPasskey(UID)]: 'cred-abc' }), UID) === true,
  'não reconheceu',
);
confere('DIGITAL · ausente é ausente', temDigitalCadastrada(criarArmazenamento(), UID) === false, 'inventou digital');
confere(
  'DIGITAL · valor vazio não conta como cadastrada',
  temDigitalCadastrada(criarArmazenamento({ [chaveDaPasskey(UID)]: '   ' }), UID) === false,
  'aceitou vazio',
);
confere(
  'DIGITAL · a digital é de cada pessoa, não do aparelho',
  temDigitalCadastrada(criarArmazenamento({ [chaveDaPasskey(UID)]: 'cred-abc' }), OUTRO) === false,
  'vazou entre contas no mesmo celular',
);
confere(
  'DIGITAL · janela privada (armazenamento que lança) não quebra',
  temDigitalCadastrada(criarArmazenamento({}, true), UID) === false,
  'deixou o erro subir',
);
confere('DIGITAL · sem usuário não há digital', temDigitalCadastrada(criarArmazenamento(), null) === false, 'aceitou uid nulo');

// ───────────────────────── Escolha da pessoa ─────────────────────────
confere('ESCOLHA · nunca escolheu devolve null', lerEscolha(criarArmazenamento(), UID) === null, 'não devolveu null');
{
  const arm = criarArmazenamento();
  salvarEscolha(arm, UID, false);
  confere('ESCOLHA · desligar é guardado', lerEscolha(arm, UID) === false, String(lerEscolha(arm, UID)));
  salvarEscolha(arm, UID, true);
  confere('ESCOLHA · religar é guardado', lerEscolha(arm, UID) === true, String(lerEscolha(arm, UID)));
  confere('ESCOLHA · guardada por pessoa', lerEscolha(arm, OUTRO) === null, 'vazou para a outra conta');
  confere('ESCOLHA · a chave carrega o uid', chaveDaTrava(UID).includes(UID), chaveDaTrava(UID));
}
confere(
  'ESCOLHA · lixo guardado é tratado como "nunca escolheu"',
  lerEscolha(criarArmazenamento({ [chaveDaTrava(UID)]: 'talvez' }), UID) === null,
  'aceitou lixo',
);
confere(
  'ESCOLHA · armazenamento que lança não derruba a gravação',
  (() => {
    try {
      salvarEscolha(criarArmazenamento({}, true), UID, true);
      return true;
    } catch {
      return false;
    }
  })(),
  'deixou o erro subir',
);

// ───────────────────────── A regra central ─────────────────────────
confere(
  'TRAVA · SEM digital cadastrada nunca liga, mesmo com chave e escolha ligada',
  travaAtiva({ temChaveE2ee: true, temDigital: false, escolha: true }) === false,
  'trancaria a pessoa do lado de fora, sem como abrir',
);
confere(
  'TRAVA · sem chave E2EE não liga (não há o que proteger aqui)',
  travaAtiva({ temChaveE2ee: false, temDigital: true, escolha: true }) === false,
  'ligou sem chave',
);
confere(
  'TRAVA · com chave e digital, quem nunca escolheu começa COM a trava',
  travaAtiva({ temChaveE2ee: true, temDigital: true, escolha: null }) === true,
  'começou destrancado',
);
confere(
  'TRAVA · quem desligou continua desligado',
  travaAtiva({ temChaveE2ee: true, temDigital: true, escolha: false }) === false,
  'ignorou a escolha',
);
confere(
  'TRAVA · quem ligou fica ligado',
  travaAtiva({ temChaveE2ee: true, temDigital: true, escolha: true }) === true,
  'não ligou',
);
confere(
  'TRAVA · podeTravar exige as duas coisas',
  podeTravar({ temChaveE2ee: true, temDigital: true }) === true &&
    podeTravar({ temChaveE2ee: true, temDigital: false }) === false &&
    podeTravar({ temChaveE2ee: false, temDigital: true }) === false,
  'regra frouxa',
);

// ───────────────────────── Voltar do segundo plano ─────────────────────────
const MIN = 60_000;
confere(
  'VOLTA · app que não saiu da frente não pede de novo',
  precisaPedirDeNovo({ escondidoDesde: null, agora: 1_000_000 }) === false,
  'pediu à toa',
);
confere(
  'VOLTA · saiu e voltou na hora não pede de novo',
  precisaPedirDeNovo({ escondidoDesde: 1_000_000, agora: 1_000_000 + 5_000 }) === false,
  'pediu cedo demais',
);
confere(
  'VOLTA · passou do tempo pede de novo',
  precisaPedirDeNovo({ escondidoDesde: 1_000_000, agora: 1_000_000 + MINUTOS_ATE_PEDIR_DE_NOVO * MIN + 1 }) === true,
  'não pediu',
);
confere(
  'VOLTA · exatamente no limite já pede',
  precisaPedirDeNovo({ escondidoDesde: 1_000_000, agora: 1_000_000 + MINUTOS_ATE_PEDIR_DE_NOVO * MIN }) === true,
  'deixou passar',
);
confere(
  'VOLTA · minutos=0 pede sempre que o app voltou',
  precisaPedirDeNovo({ escondidoDesde: 1_000_000, agora: 1_000_001, minutos: 0 }) === true,
  'não pediu com 0',
);
confere(
  'VOLTA · relógio maluco (NaN) não tranca nem destranca por acidente',
  precisaPedirDeNovo({ escondidoDesde: Number.NaN, agora: 1_000_000 }) === false &&
    precisaPedirDeNovo({ escondidoDesde: 1_000_000, agora: Number.NaN }) === false,
  'decidiu com NaN',
);
confere(
  'VOLTA · o tempo até pedir de novo é curto (minutos, não horas)',
  MINUTOS_ATE_PEDIR_DE_NOVO > 0 && MINUTOS_ATE_PEDIR_DE_NOVO <= 5,
  `${MINUTOS_ATE_PEDIR_DE_NOVO} min`,
);

// ───────────────────────── Dois donos no mesmo celular ─────────────────────────
{
  const arm = criarArmazenamento({ [chaveDaPasskey(UID)]: 'cred-abc' });
  salvarEscolha(arm, UID, true);
  const dona = travaAtiva({
    temChaveE2ee: true,
    temDigital: temDigitalCadastrada(arm, UID),
    escolha: lerEscolha(arm, UID),
  });
  const visita = travaAtiva({
    temChaveE2ee: true,
    temDigital: temDigitalCadastrada(arm, OUTRO),
    escolha: lerEscolha(arm, OUTRO),
  });
  confere('DUAS CONTAS · a dona tranca', dona === true, 'não trancou');
  confere(
    'DUAS CONTAS · quem não cadastrou digital entra (e não fica refém da trava alheia)',
    visita === false,
    'trancou quem não tem como abrir',
  );
}

console.log('');
console.log(`${total} verificações.`);
if (falhas) {
  console.log(`${falhas} falha(s).`);
  process.exit(1);
}
console.log('Trava OK: sem digital cadastrada ela nunca liga, a escolha é por pessoa e o retorno do segundo plano pede de novo.');
