#!/usr/bin/env node
/**
 * Testa a lógica pura da rolagem sem app nem emuladores (o Node 22 remove os tipos do TypeScript):
 *   - src/lib/gestures/tabSwipe.ts  -> `tabSwipeDirection`: quando um arrasto de lado troca de aba;
 *   - src/lib/scrollChrome.ts       -> `startScrollChrome`: quando o cabeçalho e as barras somem e voltam ao rolar
 *                                      (com uma `window` falsa que o teste controla quadro a quadro).
 *   node e2e/scroll-logic-check.mjs
 * Os defeitos que isto cobre: a barra só voltava com um arremesso de mais de 50 px por quadro (e sumia com qualquer 1 px para
 * baixo), e um arrasto diagonal ou uma rolagem trocava de aba. Sai com código 1 se algo falhar.
 */
const { TAB_SWIPE, tabSwipeDirection } = await import('../src/lib/gestures/tabSwipe.ts');

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

// ----------------------------------------------------------------------------------------------- troca de aba arrastando
const base = { dx: 0, dy: 0, elapsed: 200, scrolled: 0 };
confere('arrasto de 230 px para a ESQUERDA leva à aba seguinte', tabSwipeDirection({ ...base, dx: -230 }) === 'next');
confere('arrasto de 230 px para a DIREITA leva à aba anterior', tabSwipeDirection({ ...base, dx: 230 }) === 'previous');
confere('um esbarrão de 30 px não troca', tabSwipeDirection({ ...base, dx: -30 }) === null);
confere(`logo abaixo do mínimo (${TAB_SWIPE.delta - 1} px) não troca; no mínimo troca`,
  tabSwipeDirection({ ...base, dx: -(TAB_SWIPE.delta - 1) }) === null && tabSwipeDirection({ ...base, dx: -TAB_SWIPE.delta }) === 'next');
confere('um arrasto lento demais (depois de 0,7 s) não troca', tabSwipeDirection({ ...base, dx: -230, elapsed: TAB_SWIPE.swipeDuration + 1 }) === null);
confere('um arrasto diagonal (120 de lado, 240 na vertical) não troca', tabSwipeDirection({ ...base, dx: -120, dy: -240 }) === null);
confere('um arrasto quase horizontal (230 de lado, 60 na vertical) troca', tabSwipeDirection({ ...base, dx: -230, dy: -60 }) === 'next');
confere('exatamente na proporção limite (1,5x) troca; um pouco abaixo não',
  tabSwipeDirection({ ...base, dx: -150, dy: -100 }) === 'next' && tabSwipeDirection({ ...base, dx: -149, dy: -100 }) === null);
confere('se a página rolou durante o gesto (foi rolagem), não troca', tabSwipeDirection({ ...base, dx: -230, scrolled: 120 }) === null);
confere('uma rolagem de até 8 px (tremida) ainda deixa trocar', tabSwipeDirection({ ...base, dx: -230, scrolled: 8 }) === 'next');
confere('rolagem para cima durante o gesto também invalida', tabSwipeDirection({ ...base, dx: 230, scrolled: -50 }) === null);

// ----------------------------------------------------------------------------------- barras que somem ao rolar (CSS)
const { startScrollChrome } = await import('../src/lib/scrollChrome.ts');

/** Uma `window` falsa: o teste decide onde a página está e quando o navegador desenha o próximo quadro. */
function janelaFalsa() {
  const ouvintes = new Map();
  let fila = [];
  let proximo = 1;
  const janela = {
    scrollY: 0,
    addEventListener: (tipo, fn) => { ouvintes.set(tipo, fn); },
    removeEventListener: (tipo) => { ouvintes.delete(tipo); },
    requestAnimationFrame: (fn) => { const id = proximo++; fila.push({ id, fn }); return id; },
    cancelAnimationFrame: (id) => { fila = fila.filter((q) => q.id !== id); },
  };
  return {
    janela,
    ouvintes,
    /** A pessoa rola a página até `y`; o navegador avisa e desenha UM quadro. */
    rolar: (y) => {
      janela.scrollY = y;
      ouvintes.get('scroll')?.();
      const pendentes = fila; fila = [];
      pendentes.forEach((q) => q.fn(0));
    },
    pendentes: () => fila.length,
  };
}

function novoCenario() {
  const mundo = janelaFalsa();
  globalThis.window = mundo.janela;
  const raiz = { dataset: {} };
  const controle = startScrollChrome(raiz);
  return { ...mundo, raiz, controle, estado: () => raiz.dataset.chrome };
}

{
  const c = novoCenario();
  confere('ao começar, as barras aparecem', c.estado() === 'shown');
  confere('há um ouvinte de rolagem e ele é passivo-compatível (só agenda um quadro)', c.ouvintes.has('scroll'));
  c.controle.destroy();
}
{
  const c = novoCenario();
  for (let y = 0; y <= 56; y += 8) c.rolar(y);
  confere('rolando só até o topo da página (até 56 px) as barras seguem à mostra', c.estado() === 'shown');
  c.controle.destroy();
}
{
  const c = novoCenario();
  for (let y = 0; y <= 50; y += 10) c.rolar(y);
  c.rolar(60); c.rolar(70);
  confere('depois do topo, rolar 20 px para baixo ainda não esconde (precisa de uma rolagem de verdade)', c.estado() === 'shown', c.estado());
  c.rolar(80);
  confere('rolar 30 px para baixo, de pouco em pouco, esconde', c.estado() === 'hidden', c.estado());
  c.controle.destroy();
}
{
  const c = novoCenario();
  c.rolar(400); // um arremesso grande de uma vez
  confere('um arremesso grande para baixo esconde na hora', c.estado() === 'hidden', c.estado());
  c.rolar(388);
  c.rolar(374);
  confere('voltar 26 px (uma acomodação curta do dedo) NÃO revela', c.estado() === 'hidden', c.estado());
  c.rolar(362);
  confere('voltar 38 px, de pouco em pouco, JÁ revela (antes só um arremesso de mais de 50 px por quadro revelava)', c.estado() === 'shown', c.estado());
  c.controle.destroy();
}
{
  const c = novoCenario();
  c.rolar(300);
  for (let i = 0; i < 40; i++) { c.rolar(301); c.rolar(300); } // tremida de 1 px, 40 vezes
  confere('uma tremida de 1 px (para baixo e para cima), repetida, não faz as barras piscarem', c.estado() === 'hidden', c.estado());
  const antes = c.estado();
  for (let i = 0; i < 40; i++) { c.rolar(299); c.rolar(300); }
  confere('nem a tremida para cima revela (nunca acumula 36 px num sentido só)', c.estado() === antes, c.estado());
  c.controle.destroy();
}
{
  const c = novoCenario();
  c.rolar(900);
  c.rolar(30);
  confere('voltar de uma vez ao topo da página revela as barras', c.estado() === 'shown', c.estado());
  c.rolar(900);
  c.rolar(-20); // o efeito elástico do iOS dá valores negativos
  confere('rolagem negativa (elástico) conta como topo: revela', c.estado() === 'shown', c.estado());
  c.controle.destroy();
}
{
  const c = novoCenario();
  c.rolar(500);
  c.controle.reset();
  confere('reset() (troca de página) mostra as barras e esquece a direção', c.estado() === 'shown', c.estado());
  c.rolar(515); c.rolar(530);
  confere('depois do reset, descer de novo (30 px) esconde de novo', c.estado() === 'hidden', c.estado());
  c.controle.destroy();
}
{
  const c = novoCenario();
  c.rolar(300);
  c.janela.scrollY = 301;
  c.ouvintes.get('scroll')?.(); c.ouvintes.get('scroll')?.(); c.ouvintes.get('scroll')?.();
  confere('vários eventos de rolagem no mesmo quadro agendam UM só trabalho (um requestAnimationFrame)', c.pendentes() === 1, `pendentes: ${c.pendentes()}`);
  c.controle.destroy();
  confere('destroy() remove o ouvinte, cancela o quadro pendente e apaga o atributo', !c.ouvintes.has('scroll') && c.pendentes() === 0 && c.raiz.dataset.chrome === undefined);
}

// ------------------------------------------------------------------------------- contra-prova: o algoritmo ANTIGO
// O que existia antes (AppLayout/HomeFeedTabs/cada PostCard): decidia pelo quadro anterior. Estes dois casos mostram por que as
// verificações acima existem: o antigo falha exatamente nelas.
function algoritmoAntigo(ys) {
  let visivel = true;
  let ultimo = 0;
  for (const y of ys) {
    if (y <= 56) visivel = true;
    else if (y > ultimo && y > 56) visivel = false;
    else if (y < ultimo - 50) visivel = true;
    ultimo = y;
  }
  return visivel;
}
confere('contra-prova: o algoritmo antigo NÃO revelava ao voltar devagar (2 px por quadro, 22 px no total)',
  algoritmoAntigo([400, 398, 396, 394, 392, 390, 388, 386, 384, 382, 380, 378]) === false);
confere('contra-prova: o algoritmo antigo escondia com 1 px para baixo (a barra piscava com a tremida do dedo)',
  algoritmoAntigo([100, 101]) === false);

console.log(`\n${total - falhas} de ${total} verificações passaram.`);
process.exit(falhas ? 1 : 0);
