#!/usr/bin/env node
/**
 * Testa src/lib/interactions/optimisticToggle.ts (a lógica de curtir/repostar/salvar com resposta imediata) sem app nem
 * emuladores: importa o módulo TypeScript direto (o Node 22 remove os tipos).
 *   node e2e/optimistic-toggle-check.mjs
 * O defeito que isto cobre: a curtida num comentário "demorava alguns segundos" para aparecer, porque um dado atrasado do
 * servidor (o contador só é gravado por uma Function depois do toque) SOBRESCREVIA o que a pessoa tinha acabado de fazer.
 * Sai com código 1 se algo falhar.
 */
const {
  AGREE_RELEASE_MS,
  DEFAULT_GRACE_MS,
  displayState,
  expectedServerAfterWrite,
  flipOverlay,
  markWritten,
  needsWrite,
  startOverlay,
} = await import('../src/lib/interactions/optimisticToggle.ts');

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
const T0 = 1_000_000;

// 1. O toque vale na hora.
{
  const overlay = flipOverlay(startOverlay({ active: false, count: 5 }, T0), T0);
  const shown = displayState(overlay, { active: false, count: 5 }, T0);
  confere('curtir: a tela mostra curtido e o contador +1 NO INSTANTE do toque', shown.active === true && shown.count === 6 && shown.release === false, JSON.stringify(shown));
}

// 2. O defeito: o servidor ainda mostra o estado antigo (dado atrasado) e NÃO pode desfazer o toque.
{
  const overlay = flipOverlay(startOverlay({ active: false, count: 5 }, T0), T0);
  for (const atraso of [100, 1000, 3000, 6000]) {
    const shown = displayState(overlay, { active: false, count: 5 }, T0 + atraso);
    confere(`dado atrasado do servidor ${atraso} ms depois do toque NÃO desfaz a curtida`, shown.active === true && shown.count === 6, JSON.stringify(shown));
  }
}

// 3. O servidor alcança: passa a valer o contador dele e, gravado e de acordo, o overlay é solto.
{
  let overlay = flipOverlay(startOverlay({ active: false, count: 5 }, T0), T0);
  overlay = markWritten(overlay, true);
  const servidor = { active: true, count: 6 };
  const cedo = displayState(overlay, servidor, T0 + 300);
  confere('servidor alcançou: mostra o contador do servidor (6), sem somar duas vezes', cedo.active === true && cedo.count === 6 && cedo.release === false, JSON.stringify(cedo));
  const tarde = displayState(overlay, servidor, T0 + AGREE_RELEASE_MS + 1);
  confere('gravado e de acordo com o servidor: o overlay é solto', tarde.release === true && tarde.count === 6, JSON.stringify(tarde));
}

// 4. Toques rápidos viram UMA gravação do estado final.
{
  let overlay = startOverlay({ active: false, count: 5 }, T0);
  overlay = flipOverlay(overlay, T0 + 10); // curtiu
  overlay = flipOverlay(overlay, T0 + 20); // descurtiu
  overlay = flipOverlay(overlay, T0 + 30); // curtiu de novo
  confere('3 toques rápidos: o estado final é curtido', overlay.desired === true);
  confere('3 toques rápidos: há o que gravar (curtido)', needsWrite(overlay));
  overlay = markWritten(overlay, true); // a gravação em andamento terminou com o estado final
  confere('depois de gravar o estado final não sobra nada a gravar', !needsWrite(overlay) && overlay.settled);
}

// 5. Descurtir enquanto a gravação anterior estava em andamento: a fila grava os dois, em ordem.
{
  let overlay = startOverlay({ active: false, count: 5 }, T0);
  overlay = flipOverlay(overlay, T0); // curtiu (gravação de "true" em andamento)
  overlay = flipOverlay(overlay, T0 + 50); // descurtiu antes de terminar
  overlay = markWritten(overlay, true); // terminou o "true"
  confere('descurtir no meio da gravação: sobra gravar "false"', needsWrite(overlay) && overlay.desired === false && !overlay.settled);
  overlay = markWritten(overlay, false);
  confere('...e depois de gravar "false" a fila para', !needsWrite(overlay));
  const shown = displayState(overlay, { active: false, count: 5 }, T0 + 100);
  confere('curtiu e descurtiu: volta ao contador original (5), sem cair para 4', shown.active === false && shown.count === 5, JSON.stringify(shown));
}

// 6. Outra pessoa curtiu antes: o número só sobe, nunca desce.
{
  let overlay = flipOverlay(startOverlay({ active: false, count: 5 }, T0), T0);
  overlay = markWritten(overlay, true);
  const mostrado = [];
  mostrado.push(displayState(overlay, { active: false, count: 5 }, T0 + 100).count); // 6 (otimista)
  mostrado.push(displayState(overlay, { active: true, count: 6 }, T0 + 2000).count); // servidor: a outra pessoa (ainda sem a nossa)
  mostrado.push(displayState(overlay, { active: true, count: 7 }, T0 + 4000).count); // servidor: as duas
  confere('contador mostrado só sobe quando outra pessoa curte junto', mostrado.join(',') === '6,6,7', mostrado.join(','));
}

// 7. O servidor nunca reflete (a Function falhou): depois da tolerância vale o que ele diz.
{
  let overlay = flipOverlay(startOverlay({ active: false, count: 5 }, T0), T0);
  overlay = markWritten(overlay, true);
  const dentro = displayState(overlay, { active: false, count: 5 }, T0 + DEFAULT_GRACE_MS - 100);
  const depois = displayState(overlay, { active: false, count: 5 }, T0 + DEFAULT_GRACE_MS + 100);
  confere('dentro da tolerância o toque continua valendo', dentro.release === false && dentro.active === true);
  confere('passada a tolerância, o overlay é solto (a tela volta a mostrar o servidor)', depois.release === true);
}

// 8. Descurtir um item já curtido.
{
  const overlay = flipOverlay(startOverlay({ active: true, count: 3 }, T0), T0);
  const shown = displayState(overlay, { active: true, count: 3 }, T0);
  confere('descurtir: não curtido e contador -1', shown.active === false && shown.count === 2, JSON.stringify(shown));
}

// 9. O contador nunca fica negativo.
{
  const overlay = flipOverlay(startOverlay({ active: true, count: 0 }, T0), T0);
  const shown = displayState(overlay, { active: true, count: 0 }, T0);
  confere('contador nunca negativo (item curtido com contador 0 atrasado)', shown.count === 0, JSON.stringify(shown));
}

// 10. Enquanto ainda grava, o overlay não é solto, mesmo que o servidor concorde por acaso.
{
  const overlay = flipOverlay(startOverlay({ active: false, count: 5 }, T0), T0); // settled = false
  const shown = displayState(overlay, { active: true, count: 6 }, T0 + 5000);
  confere('com gravação em andamento o overlay não é solto', shown.release === false);
}

// 11. Sem overlay, vale o servidor como veio.
{
  const shown = displayState(null, { active: true, count: 9 }, T0);
  confere('sem toque da pessoa, mostra o servidor', shown.active === true && shown.count === 9 && shown.release === false);
}

// 12. Tela SEM listener ao vivo (o botão de seguir): depois de gravar, o estado esperado vira o do servidor e a tela NÃO volta
// ao estado de partida quando passa a tolerância. Sem isto "seguir" parecia desfazer sozinho 8 s depois.
{
  let overlay = flipOverlay(startOverlay({ active: false, count: 10 }, T0), T0); // seguiu: 10 seguidores -> 11
  overlay = markWritten(overlay, true);
  const esperado = expectedServerAfterWrite(overlay, true);
  confere('seguir: o servidor passa a ter o estado gravado e o contador esperado (11)', esperado.active === true && esperado.count === 11, JSON.stringify(esperado));
  const semAviso = displayState(overlay, { active: false, count: 10 }, T0 + DEFAULT_GRACE_MS + 100);
  // Solto o overlay, quem pinta é o estado do servidor que o hook guarda: sem o esperado ele seguiria sendo o de partida
  // (não segue, 10) e "seguir" parecia desfazer sozinho depois de 8 s.
  confere('(o defeito) sem o estado esperado, passada a tolerância o overlay é solto e a tela cai no estado de partida', semAviso.release === true, JSON.stringify(semAviso));
  const cedo = displayState(overlay, esperado, T0 + 300);
  confere('com o estado esperado a tela mostra seguindo e 11 logo após gravar', cedo.active === true && cedo.count === 11 && cedo.release === false, JSON.stringify(cedo));
  const solto = displayState(overlay, esperado, T0 + AGREE_RELEASE_MS + 1);
  confere('...e solta o overlay mostrando seguindo e 11 (e não o estado de partida)', solto.release === true && solto.active === true && solto.count === 11, JSON.stringify(solto));
}
{
  let overlay = flipOverlay(startOverlay({ active: true, count: 10 }, T0), T0); // deixou de seguir: 10 -> 9
  overlay = markWritten(overlay, false);
  const esperado = expectedServerAfterWrite(overlay, false);
  confere('deixar de seguir: o contador esperado é 9', esperado.active === false && esperado.count === 9, JSON.stringify(esperado));
  const zerado = expectedServerAfterWrite(flipOverlay(startOverlay({ active: true, count: 0 }, T0), T0), false);
  confere('o contador esperado nunca fica negativo', zerado.count === 0, JSON.stringify(zerado));
}
{
  // Seguiu e desseguiu: a fila termina em "não segue" e o esperado volta ao contador original, sem ficar em 11.
  let overlay = startOverlay({ active: false, count: 10 }, T0);
  overlay = flipOverlay(overlay, T0);
  overlay = flipOverlay(overlay, T0 + 20);
  overlay = markWritten(overlay, false);
  const esperado = expectedServerAfterWrite(overlay, overlay.written);
  confere('seguiu e desseguiu: o esperado volta a "não segue" com 10', esperado.active === false && esperado.count === 10, JSON.stringify(esperado));
}

console.log(`${total - falhas} de ${total} conferências passaram`);
console.log(falhas ? 'RESULTADO: HÁ FALHAS' : 'RESULTADO: PASSOU');
process.exitCode = falhas ? 1 : 0;
