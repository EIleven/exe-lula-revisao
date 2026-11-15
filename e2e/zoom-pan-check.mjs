#!/usr/bin/env node
/**
 * Testa src/lib/gestures/zoomPan.ts (a matemática do visualizador de imagem: pinça, arrastar, toque duplo, puxar para fechar)
 * sem app nem emuladores: importa o módulo TypeScript direto (o Node 22 remove os tipos).
 *   node e2e/zoom-pan-check.mjs
 * Sai com código 1 se algo falhar.
 */
const {
  DISMISS_DISTANCE,
  DOUBLE_TAP_SCALE,
  IDENTITY,
  MAX_SCALE,
  clampState,
  dismissOpacity,
  doubleTap,
  pan,
  panLimits,
  pinch,
  settle,
  shouldDismiss,
} = await import('../src/lib/gestures/zoomPan.ts');

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
const perto = (a, b, tolerancia = 1e-6) => Math.abs(a - b) <= tolerancia;
const SIZE = { width: 400, height: 800 };

// Pinça
{
  const r = pinch(IDENTITY, { x: 50, y: 20 }, 100, { x: 50, y: 20 }, 200, SIZE);
  confere('pinça: dedos 2x mais afastados dobram a escala', perto(r.scale, 2), JSON.stringify(r));
  // O ponto da imagem que estava sob o meio dos dedos continua sob o meio dos dedos: p = (m0 - t0)/s0 = (50,20); t1 = m1 - p*2.
  confere('pinça: o ponto sob os dedos continua sob os dedos (o zoom vai para onde os dedos estão)', perto(r.x, -50) && perto(r.y, -20), JSON.stringify(r));
  const andou = pinch(IDENTITY, { x: 50, y: 20 }, 100, { x: 90, y: 60 }, 200, SIZE);
  confere('pinça: os dois dedos andando juntos arrastam a imagem junto', perto(andou.x, 90 - 50 * 2) && perto(andou.y, 60 - 20 * 2), JSON.stringify(andou));
  const demais = pinch(IDENTITY, { x: 0, y: 0 }, 50, { x: 0, y: 0 }, 5000, SIZE);
  confere(`pinça: nunca passa de ${MAX_SCALE}x`, perto(demais.scale, MAX_SCALE), JSON.stringify(demais));
  const menos = pinch({ scale: 2, x: 40, y: -30 }, { x: 0, y: 0 }, 200, { x: 0, y: 0 }, 20, SIZE);
  confere('pinça: aproximando os dedos além do tamanho original volta ao tamanho original e ao centro', menos.scale === 1 && menos.x === 0 && menos.y === 0, JSON.stringify(menos));
  const zero = pinch({ scale: 2, x: 10, y: 10 }, { x: 0, y: 0 }, 0, { x: 5, y: 5 }, 100, SIZE);
  confere('pinça com distância inicial zero não quebra (devolve o estado)', Number.isFinite(zero.scale) && Number.isFinite(zero.x), JSON.stringify(zero));
}

// Limites e arrastar
{
  confere('no tamanho original não há para onde arrastar', panLimits(1, SIZE).x === 0 && panLimits(1, SIZE).y === 0);
  confere('ampliada 3x pode andar (3*400-400)/2 = 400 para os lados', perto(panLimits(3, SIZE).x, 400) && perto(panLimits(3, SIZE).y, 800));
  const preso = pan(IDENTITY, 300, 300, SIZE);
  confere('arrastar no tamanho original não move a imagem', preso.x === 0 && preso.y === 0 && preso.scale === 1, JSON.stringify(preso));
  const livre = pan({ scale: 3, x: 0, y: 0 }, 100, -50, SIZE);
  confere('arrastar ampliada move a imagem junto com o dedo', livre.x === 100 && livre.y === -50, JSON.stringify(livre));
  const alem = pan({ scale: 3, x: 0, y: 0 }, 9999, -9999, SIZE);
  confere('arrastar além da borda para na borda (sem mostrar o vazio)', alem.x === 400 && alem.y === -800, JSON.stringify(alem));
  const fora = clampState({ scale: 2, x: 5000, y: 5000 }, SIZE);
  confere('um estado fora dos limites é trazido de volta', fora.x === 200 && fora.y === 400, JSON.stringify(fora));
}

// Toque duplo
{
  const ampliada = doubleTap(IDENTITY, { x: 100, y: -50 }, SIZE);
  confere(`toque duplo amplia ${DOUBLE_TAP_SCALE}x centrando no ponto tocado`, perto(ampliada.scale, DOUBLE_TAP_SCALE) && perto(ampliada.x, 100 * (1 - DOUBLE_TAP_SCALE)) && perto(ampliada.y, -50 * (1 - DOUBLE_TAP_SCALE)), JSON.stringify(ampliada));
  const volta = doubleTap(ampliada, { x: 0, y: 0 }, SIZE);
  confere('outro toque duplo volta ao tamanho original', volta.scale === 1 && volta.x === 0 && volta.y === 0, JSON.stringify(volta));
  const canto = doubleTap(IDENTITY, { x: 200, y: 400 }, SIZE);
  confere('toque duplo na borda não mostra o vazio de fora', canto.x >= -panLimits(canto.scale, SIZE).x && canto.y >= -panLimits(canto.scale, SIZE).y, JSON.stringify(canto));
}

// Soltar a pinça
{
  const quase = settle({ scale: 1.04, x: 8, y: 8 }, SIZE);
  confere('soltar a pinça perto do tamanho original encaixa nele', quase.scale === 1 && quase.x === 0, JSON.stringify(quase));
  const meio = settle({ scale: 1.6, x: 30, y: 30 }, SIZE);
  confere('soltar a pinça em 1,6x mantém o zoom', perto(meio.scale, 1.6) && meio.x === 30, JSON.stringify(meio));
}

// Puxar para fechar
{
  confere(`arrastar ${DISMISS_DISTANCE + 10} px fecha`, shouldDismiss(DISMISS_DISTANCE + 10, 0.1));
  confere('arrastar pouco e devagar não fecha (volta ao lugar)', !shouldDismiss(50, 0.2));
  confere('um arremesso rápido, mesmo curto, fecha', shouldDismiss(50, 0.9));
  confere('um tremor de 20 px, mesmo rápido, não fecha', !shouldDismiss(20, 3));
  confere('para cima fecha igual (sentido não importa)', shouldDismiss(-200, -0.1));
  confere('o fundo clareia aos poucos: 1 parado, 0,5 aos 200 px numa tela de 800', perto(dismissOpacity(0, 800), 1) && perto(dismissOpacity(200, 800), 0.5), `${dismissOpacity(200, 800)}`);
  confere('o fundo nunca some por completo', dismissOpacity(5000, 800) >= 0.35 - 1e-9, `${dismissOpacity(5000, 800)}`);
}

console.log(`${total - falhas} de ${total} conferências passaram`);
console.log(falhas ? 'RESULTADO: HÁ FALHAS' : 'RESULTADO: PASSOU');
process.exitCode = falhas ? 1 : 0;
