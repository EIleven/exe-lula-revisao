// src/lib/interactions/optimisticToggle.ts
// Lógica pura (sem React nem Firebase) das interações de liga/desliga com contador: curtir, repostar, salvar.
//
// O problema que isto resolve: o contador público (likes, reposts) é calculado por uma Function alguns segundos depois do
// toque, e o app relê o item quando o contador muda. Sem cuidado, qualquer dado atrasado do servidor SOBRESCREVE o que a
// pessoa acabou de fazer e a curtida parece "não ter pegado" por alguns segundos. Aqui o toque vale NA HORA e continua
// valendo até o servidor confirmar (ou até um limite de tempo), qualquer que seja a ordem dos dados que chegam.

/** O que o servidor mostra de um item. */
export type ServerToggleState = { active: boolean; count: number };

/** O que a pessoa fez e ainda não foi confirmado. */
export type ToggleOverlay = {
  /** O que a pessoa quer agora (o último toque). */
  desired: boolean;
  /** Estado do servidor quando ela mexeu pela primeira vez: o ponto de partida para calcular o contador e desfazer. */
  baseActive: boolean;
  baseCount: number;
  /** Último estado gravado com sucesso no servidor (por padrão, o de partida). */
  written: boolean;
  /** A fila de gravação está parada (tudo o que foi pedido já foi gravado). */
  settled: boolean;
  /** Hora do último toque. */
  lastChangeAt: number;
};

/** Quanto tempo, depois do último toque, o servidor ainda pode estar atrasado antes de confiarmos só nele. */
export const DEFAULT_GRACE_MS = 8000;
/** Depois de gravado, e se o servidor já concorda, basta este tempo para soltar o overlay. */
export const AGREE_RELEASE_MS = 1200;

export function startOverlay(server: ServerToggleState, now: number): ToggleOverlay {
  return {
    desired: server.active,
    baseActive: server.active,
    baseCount: server.count,
    written: server.active,
    settled: true,
    lastChangeAt: now,
  };
}

/** O toque: inverte o que a pessoa quer. */
export function flipOverlay(overlay: ToggleOverlay, now: number): ToggleOverlay {
  return { ...overlay, desired: !overlay.desired, settled: false, lastChangeAt: now };
}

/** Há algo a gravar? (a fila grava o estado FINAL, não cada toque). */
export function needsWrite(overlay: ToggleOverlay): boolean {
  return overlay.written !== overlay.desired;
}

export type DisplayResult = ServerToggleState & {
  /** O overlay já cumpriu o papel e pode ser descartado. */
  release: boolean;
};

/**
 * O estado a MOSTRAR agora, dado o overlay e o que o servidor diz.
 *
 * - `active` é sempre o que a pessoa quer, enquanto o overlay existir.
 * - O contador começa em (contador de partida + efeito do toque). Assim que o servidor mostra um contador DIFERENTE do de
 *   partida, ele já considerou a ação (a Function rodou) e passa a valer o dele, sem nunca mostrar um valor menor que o
 *   que a pessoa viu (se outra pessoa curtir antes, o servidor soma a dela e depois a nossa: o número só sobe).
 * - O overlay é solto quando a gravação terminou e (o servidor concorda ou o tempo de tolerância acabou).
 */
export function displayState(overlay: ToggleOverlay | null, server: ServerToggleState, now: number, graceMs = DEFAULT_GRACE_MS): DisplayResult {
  if (!overlay) return { ...server, release: false };
  const delta = (overlay.desired ? 1 : 0) - (overlay.baseActive ? 1 : 0);
  const serverMoved = server.count !== overlay.baseCount;
  const count = serverMoved ? server.count : Math.max(0, overlay.baseCount + delta);
  const sinceChange = now - overlay.lastChangeAt;
  const agrees = server.active === overlay.desired && (delta === 0 || serverMoved);
  const release = overlay.settled && ((agrees && sinceChange >= AGREE_RELEASE_MS) || sinceChange >= graceMs);
  return { active: overlay.desired, count, release };
}

/** Marca o resultado da fila de gravação. */
export function markWritten(overlay: ToggleOverlay, written: boolean): ToggleOverlay {
  const next = { ...overlay, written };
  next.settled = !needsWrite(next);
  return next;
}

/**
 * O que o servidor passa a ter depois que o estado `written` foi gravado: o estado gravado e o contador de partida corrigido
 * pelo efeito dele. Serve a telas SEM listener ao vivo (o botão de seguir): nada avisa quando o servidor alcança o toque, e
 * sem isto, passada a tolerância, a tela voltaria ao estado antigo de partida mesmo com a gravação confirmada.
 */
export function expectedServerAfterWrite(overlay: ToggleOverlay, written: boolean): ServerToggleState {
  const delta = (written ? 1 : 0) - (overlay.baseActive ? 1 : 0);
  return { active: written, count: Math.max(0, overlay.baseCount + delta) };
}
