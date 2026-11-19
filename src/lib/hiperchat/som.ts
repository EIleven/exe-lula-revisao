/**
 * Aviso sonoro de mensagem nova — sintetizado na hora, nota por nota.
 *
 * Por que não um arquivo de áudio: um .mp3 de aviso é mais um pedido de rede, mais um byte no pacote do app e,
 * se vier de um CDN, mais um terceiro sabendo quando você recebe mensagem. Duas senoides curtas custam zero
 * byte, funcionam offline e são nossas.
 *
 * O módulo não importa nada e não conhece `window`: recebe o contexto de áudio pronto. Assim o teste consegue
 * provar o que foi agendado (frequências, volume, começo e fim de cada nota) sem navegador.
 */

export type OsciladorLike = {
  type: string;
  frequency: { setValueAtTime(valor: number, quando: number): void };
  connect(destino: unknown): void;
  start(quando: number): void;
  stop(quando: number): void;
};

export type GanhoLike = {
  gain: {
    setValueAtTime(valor: number, quando: number): void;
    exponentialRampToValueAtTime(valor: number, quando: number): void;
  };
  connect(destino: unknown): void;
};

export type ContextoDeAudioLike = {
  state: string;
  currentTime: number;
  destination: unknown;
  createOscillator(): OsciladorLike;
  createGain(): GanhoLike;
  resume?: () => unknown;
};

/** Duas notas curtas subindo: reconhecível sem ser alarme. */
export const NOTAS_HZ = [659.25, 880] as const;
/** Duração de cada nota, em segundos. */
export const DURACAO_NOTA = 0.085;
/** Intervalo entre o começo de uma nota e o da seguinte. */
export const INTERVALO_NOTA = 0.075;
/** Volume de pico. Aviso, não susto. */
export const VOLUME = 0.07;

/**
 * Agenda o aviso. Devolve `false` quando não dá para tocar (sem contexto, contexto fechado, navegador barrando) —
 * e nunca lança: um aviso que não sai não pode derrubar a tela de mensagens.
 */
export function tocarAviso(contexto: ContextoDeAudioLike | null | undefined): boolean {
  if (!contexto) return false;
  try {
    if (contexto.state === 'closed') return false;
    // Navegador só libera áudio depois de um toque. Se ainda está suspenso, pede para retomar e segue:
    // se a pessoa ainda não tocou em nada, o agendamento simplesmente não vira som.
    if (contexto.state === 'suspended' && typeof contexto.resume === 'function') contexto.resume();

    const inicio = contexto.currentTime;
    for (let i = 0; i < NOTAS_HZ.length; i += 1) {
      const t0 = inicio + i * INTERVALO_NOTA;
      const t1 = t0 + DURACAO_NOTA;
      const oscilador = contexto.createOscillator();
      const ganho = contexto.createGain();
      oscilador.type = 'sine';
      oscilador.frequency.setValueAtTime(NOTAS_HZ[i], t0);
      ganho.gain.setValueAtTime(VOLUME, t0);
      // Queda exponencial até quase zero: corta o "clique" de um fim seco.
      ganho.gain.exponentialRampToValueAtTime(0.0001, t1);
      oscilador.connect(ganho);
      ganho.connect(contexto.destination);
      oscilador.start(t0);
      oscilador.stop(t1);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Decide se um novo total de não lidas merece aviso. Fica aqui, e não no hook, porque é a regra que erra fácil:
 * a primeira leitura só calibra (senão o app apita ao abrir), e cair ou empatar nunca apita.
 */
export function deveAvisar(anterior: number | null, atual: number): boolean {
  if (anterior === null) return false;
  if (!Number.isFinite(atual) || !Number.isFinite(anterior)) return false;
  return atual > anterior;
}
