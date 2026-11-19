#!/usr/bin/env node
/**
 * As preferências e o histórico de busca (src/lib/search/preferenciasDeBusca.ts):
 *   node e2e/busca-preferencias-check.mjs        (ou: npm run e2e:busca-prefs)
 *
 * O que está em jogo: o histórico de busca é a coisa mais reveladora que uma rede guarda. "O que essa pessoa
 * procurou" diz mais do que o que ela publicou — e numa rede política isso é material. Por isso ele fica só no
 * aparelho, e por isso as duas regras abaixo são verificadas uma a uma:
 *
 *   - Desligar "guardar histórico" APAGA o que já existe, na hora. Deixar guardado o que a pessoa acabou de pedir
 *     para não guardar seria a pior forma possível de respeitar a escolha.
 *   - Com a opção desligada, nada é gravado. A escolha vale no lugar onde a gravação acontece, não só na tela.
 *
 * Sai com código 1 se algo falhar.
 */
import {
  MAX_HISTORICO,
  PREFERENCIAS_PADRAO,
  chaveDoHistorico,
  esquecerBusca,
  idiomaEfetivo,
  lerHistorico,
  lerPreferencias,
  limparHistorico,
  registrarBusca,
  salvarPreferencias,
} from '../src/lib/search/preferenciasDeBusca.ts';

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

const criarArmazenamento = (inicial = {}, quebrado = false) => {
  const mapa = new Map(Object.entries(inicial));
  return {
    getItem(c) {
      if (quebrado) throw new Error('bloqueado');
      return mapa.has(c) ? mapa.get(c) : null;
    },
    setItem(c, v) {
      if (quebrado) throw new Error('bloqueado');
      mapa.set(c, v);
    },
    removeItem(c) {
      if (quebrado) throw new Error('bloqueado');
      mapa.delete(c);
    },
    tem(c) {
      return mapa.has(c);
    },
  };
};

const UID = 'uid_breno';
const OUTRO = 'uid_outra_pessoa';

// ───────────────────────── Padrões ─────────────────────────
confere('PADRÃO · sem nada guardado vem o padrão', JSON.stringify(lerPreferencias(criarArmazenamento(), UID)) === JSON.stringify(PREFERENCIAS_PADRAO), 'padrão diferente');
confere('PADRÃO · o filtro de conteúdo sensível começa LIGADO', PREFERENCIAS_PADRAO.filtrarSensivel === true, 'começa desligado');
confere('PADRÃO · lixo guardado não quebra a busca', JSON.stringify(lerPreferencias(criarArmazenamento({ 'hv_busca_prefs:uid_breno': '{{{' }), UID)) === JSON.stringify(PREFERENCIAS_PADRAO), 'quebrou com lixo');
confere('PADRÃO · valor de outro tipo é ignorado', lerPreferencias(criarArmazenamento({ 'hv_busca_prefs:uid_breno': '"texto"' }), UID).resultadosWeb === PREFERENCIAS_PADRAO.resultadosWeb, 'aceitou tipo errado');
confere('PADRÃO · janela privada não quebra', lerPreferencias(criarArmazenamento({}, true), UID).idioma === PREFERENCIAS_PADRAO.idioma, 'deixou o erro subir');

// ───────────────────────── Guardar escolha ─────────────────────────
{
  const arm = criarArmazenamento();
  salvarPreferencias(arm, UID, { resultadosWeb: false });
  confere('ESCOLHA · desligar a aba Web é guardado', lerPreferencias(arm, UID).resultadosWeb === false, 'não guardou');
  confere('ESCOLHA · as outras escolhas não mudam junto', lerPreferencias(arm, UID).filtrarSensivel === true, 'mexeu no que não devia');
  salvarPreferencias(arm, UID, { idioma: 'en' });
  confere('ESCOLHA · idioma é guardado', lerPreferencias(arm, UID).idioma === 'en', 'não guardou idioma');
  salvarPreferencias(arm, UID, { idioma: 'klingon' });
  confere('ESCOLHA · idioma inventado é ignorado', lerPreferencias(arm, UID).idioma === 'en', 'aceitou idioma inválido');
  confere('ESCOLHA · guardada por pessoa', lerPreferencias(arm, OUTRO).resultadosWeb === true, 'vazou entre contas no mesmo aparelho');
}

// ───────────────────────── Histórico ─────────────────────────
{
  const arm = criarArmazenamento();
  registrarBusca(arm, UID, 'reforma agraria');
  registrarBusca(arm, UID, 'greve geral');
  confere('HISTÓRICO · a busca mais recente fica no topo', lerHistorico(arm, UID)[0] === 'greve geral', JSON.stringify(lerHistorico(arm, UID)));
  registrarBusca(arm, UID, 'reforma agraria');
  confere('HISTÓRICO · repetir uma busca a traz para cima, sem duplicar', JSON.stringify(lerHistorico(arm, UID)) === '["reforma agraria","greve geral"]', JSON.stringify(lerHistorico(arm, UID)));
  confere('HISTÓRICO · busca curta demais não entra', registrarBusca(arm, UID, 'a').length === 2, 'aceitou busca de 1 letra');

  for (let i = 0; i < 40; i++) registrarBusca(arm, UID, `consulta numero ${i}`);
  confere('HISTÓRICO · tem teto', lerHistorico(arm, UID).length <= MAX_HISTORICO, String(lerHistorico(arm, UID).length));

  esquecerBusca(arm, UID, lerHistorico(arm, UID)[0]);
  confere('HISTÓRICO · dá para esquecer um item só', lerHistorico(arm, UID).length === MAX_HISTORICO - 1, String(lerHistorico(arm, UID).length));

  limparHistorico(arm, UID);
  confere('HISTÓRICO · limpar apaga tudo', lerHistorico(arm, UID).length === 0, 'sobrou coisa');
  confere('HISTÓRICO · e some do armazenamento, não fica escondido', !arm.tem(chaveDoHistorico(UID)), 'a chave continua lá');
}
confere('HISTÓRICO · é por pessoa', (() => {
  const arm = criarArmazenamento();
  registrarBusca(arm, UID, 'algo bem especifico');
  return lerHistorico(arm, OUTRO).length === 0;
})(), 'vazou entre contas no mesmo aparelho');

// ───────────────────────── A regra que mais importa ─────────────────────────
{
  const arm = criarArmazenamento();
  registrarBusca(arm, UID, 'uma busca delicada');
  registrarBusca(arm, UID, 'outra busca delicada');
  confere('PRIVACIDADE · (preparo) havia histórico guardado', lerHistorico(arm, UID).length === 2, 'não guardou');

  salvarPreferencias(arm, UID, { guardarHistorico: false });
  confere(
    'PRIVACIDADE · desligar "guardar histórico" APAGA o que já existia, na hora',
    lerHistorico(arm, UID).length === 0 && !arm.tem(chaveDoHistorico(UID)),
    'o histórico antigo continuou guardado depois de a pessoa pedir para não guardar',
  );
  registrarBusca(arm, UID, 'busca depois de desligar');
  confere(
    'PRIVACIDADE · com a opção desligada, nada novo é gravado',
    lerHistorico(arm, UID).length === 0,
    'gravou mesmo desligado',
  );

  salvarPreferencias(arm, UID, { guardarHistorico: true });
  registrarBusca(arm, UID, 'voltou a guardar');
  confere('PRIVACIDADE · religar volta a guardar, do zero', JSON.stringify(lerHistorico(arm, UID)) === '["voltou a guardar"]', JSON.stringify(lerHistorico(arm, UID)));
}
confere(
  'PRIVACIDADE · janela privada: gravar não derruba a tela',
  (() => {
    try {
      registrarBusca(criarArmazenamento({}, true), UID, 'teste');
      limparHistorico(criarArmazenamento({}, true), UID);
      return true;
    } catch {
      return false;
    }
  })(),
  'deixou o erro subir',
);

// ───────────────────────── Idioma ─────────────────────────
confere('IDIOMA · auto segue a interface', idiomaEfetivo('auto', 'pt-BR') === 'pt', idiomaEfetivo('auto', 'pt-BR'));
confere('IDIOMA · auto em inglês', idiomaEfetivo('auto', 'en-US') === 'en', idiomaEfetivo('auto', 'en-US'));
confere('IDIOMA · "todos" não filtra', idiomaEfetivo('todos', 'pt-BR') === null, 'filtrou');
confere('IDIOMA · escolha explícita manda', idiomaEfetivo('es', 'pt-BR') === 'es', idiomaEfetivo('es', 'pt-BR'));
confere('IDIOMA · interface vazia não quebra', idiomaEfetivo('auto', '') === 'pt', String(idiomaEfetivo('auto', '')));

console.log('');
console.log(`${total} verificações.`);
if (falhas) {
  console.log(`${falhas} falha(s).`);
  process.exit(1);
}
console.log('Preferências OK: o histórico fica no aparelho, desligar apaga na hora, e nada é gravado depois disso.');
