/**
 * Um dedo de verdade para os testes: toques enviados ao Chrome por `Input.dispatchTouchEvent` (touchStart, vários touchMove,
 * touchEnd). O navegador trata essa sequência como o dedo de uma pessoa e ROLA a página pelo caminho nativo (compositor).
 *
 * Por que não `Input.synthesizeScrollGesture`: com `gestureSourceType: 'touch'` ele entrega os eventos de toque à página, mas
 * NÃO rola nada neste Chrome (a posição da página não muda, mesmo sem nenhuma regra de touch-action). Isso escondeu o problema
 * de rolagem: as medições "de rolagem" mediam toques que não rolavam. Sempre confira que a página andou.
 *
 * Um dedo não sai da tela: toques com coordenadas fora da janela são descartados pelo Chrome. Por isso um arrasto longo vira
 * vários arrastos seguidos (como uma pessoa que passa o dedo de novo), cada um dentro da tela.
 */
const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Maior caminho de um único arrasto, em px: acima disto o gesto vira vários arrastos seguidos. */
const CAMINHO_MAXIMO = 620;
const MARGEM = 24;

/** Desloca o ponto inicial o mínimo necessário para o caminho inicio..inicio+delta ficar dentro de [MARGEM, limite - MARGEM]. */
function caber(inicio, delta, limite) {
  const fim = inicio + delta;
  const menor = Math.min(inicio, fim);
  const maior = Math.max(inicio, fim);
  if (menor < MARGEM) return inicio + (MARGEM - menor);
  if (maior > limite - MARGEM) return inicio - (maior - (limite - MARGEM));
  return inicio;
}

/**
 * Um arrasto de (x, y) por (dx, dy) em `ms` milissegundos, em passos de ~16 ms (um quadro). O caminho precisa caber na tela.
 *   dy negativo = dedo PARA CIMA (a página rola para baixo); dx negativo = dedo para a esquerda.
 *   fling: solta o dedo ainda em movimento (a página continua por inércia); sem fling o dedo para antes de soltar.
 */
export async function deslizar(cdp, { x, y, dx = 0, dy = 0, ms = 300, fling = false, passoMs = 16 }) {
  const passos = Math.max(2, Math.round(ms / passoMs));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(x), y: Math.round(y) }] });
  for (let i = 1; i <= passos; i += 1) {
    const p = i / passos;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(x + dx * p), y: Math.round(y + dy * p) }] });
    await dormir(passoMs);
  }
  if (!fling) await dormir(140); // dedo parado antes de soltar: sem velocidade, sem inércia
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/**
 * Arrasta um dedo a partir de (x, y) por (dx, dy), à velocidade `speed` (px/s). Um gesto curto começa exatamente em (x, y); se o
 * caminho passaria da borda da tela, o dedo para na borda (a distância efetiva diminui). Um gesto mais longo que a tela vira
 * vários arrastos seguidos, cada um recomeçando de onde cabe (embaixo, se o dedo sobe; em cima, se desce).
 */
export async function dedo(cdp, { x = 206, y = 700, dx = 0, dy = 0, speed = 800, fling = false, largura = 412, altura = 915 }) {
  const total = Math.hypot(dx, dy);
  const partes = Math.max(1, Math.ceil(total / CAMINHO_MAXIMO));
  if (partes === 1) {
    const efetivoDx = Math.min(Math.max(x + dx, MARGEM), largura - MARGEM) - x;
    const efetivoDy = Math.min(Math.max(y + dy, MARGEM), altura - MARGEM) - y;
    const efetivo = Math.hypot(efetivoDx, efetivoDy);
    await deslizar(cdp, { x, y, dx: efetivoDx, dy: efetivoDy, ms: Math.max(80, Math.round((efetivo / speed) * 1000)), fling });
    return;
  }
  const parteDx = dx / partes;
  const parteDy = dy / partes;
  const msPorParte = Math.max(80, Math.round((total / partes / speed) * 1000));
  for (let i = 0; i < partes; i += 1) {
    const ultima = i === partes - 1;
    await deslizar(cdp, {
      x: caber(largura / 2, parteDx, largura),
      y: caber(parteDy < 0 ? altura - 110 : 150, parteDy, altura),
      dx: parteDx,
      dy: parteDy,
      ms: msPorParte,
      fling: ultima ? fling : true,
    });
  }
}
