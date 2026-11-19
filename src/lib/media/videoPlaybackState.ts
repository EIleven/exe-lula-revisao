// src/lib/media/videoPlaybackState.ts
// Onde cada vídeo ESTAVA (segundo, tocando ou não, volume), em memória, por post e mídia. É o que faz o vídeo que a pessoa abriu
// no feed continuar do MESMO segundo na página do post, sem voltar para 0:00. PURO (sem React nem DOM): e2e/video-playback-check.mjs
// prova cada regra.
//
// Só vive na aba (memória): nada vai para o servidor nem para o armazenamento do navegador. Entradas velhas (30 min) e o excesso
// (60 vídeos) saem sozinhas.

export type VideoPlaybackState = {
  currentTime: number;
  isPlaying: boolean;
  muted: boolean;
  volume: number;
  /** Duração conhecida, para não "retomar" um vídeo que já terminou. */
  duration?: number;
  updatedAt: number;
};

export type VideoPlaybackInput = Partial<Omit<VideoPlaybackState, 'updatedAt'>>;

export const PLAYBACK_TTL_MS = 30 * 60_000;
export const PLAYBACK_MAX_ENTRIES = 60;
/** Antes disso o vídeo "ainda não começou" e retomar não significa nada. */
export const MIN_RESUME_SECONDS = 1;
/** Se faltar menos que isto para o fim, ele contou como assistido: recomeça do início em vez de cair no último quadro. */
export const END_MARGIN_SECONDS = 1.5;
/**
 * "Passagem" de um player para o outro (feed → página do post): o vídeo só continua TOCANDO sozinho se foi deixado tocando há
 * poucos segundos. Passado isso, a posição é retomada mas o vídeo fica pausado (áudio inesperado de um vídeo que a pessoa já
 * largou seria pior do que um toque a mais).
 */
export const HANDOFF_MAX_AGE_MS = 15_000;
const MAX_SECONDS = 24 * 3600;

/** A chave do vídeo: o post e o endereço do arquivo SEM `?` nem `#` (o mesmo arquivo pode vir com token ou versão diferente). */
export function playbackKey(postId: string | null | undefined, mediaUrl: unknown): string | null {
  if (typeof mediaUrl !== 'string' || mediaUrl.length === 0 || mediaUrl.length > 2048) return null;
  const base = mediaUrl.split('#')[0].split('?')[0];
  return base ? `${postId || '-'}|${base}` : null;
}

const finito = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const limita = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function sanitize(raw: VideoPlaybackInput & { updatedAt?: number }, now: number): VideoPlaybackState {
  return {
    currentTime: finito(raw.currentTime) ? limita(raw.currentTime, 0, MAX_SECONDS) : 0,
    isPlaying: raw.isPlaying === true,
    muted: raw.muted === true,
    volume: finito(raw.volume) ? limita(raw.volume, 0, 1) : 1,
    ...(finito(raw.duration) && raw.duration > 0 ? { duration: limita(raw.duration, 0, MAX_SECONDS) } : {}),
    updatedAt: now,
  };
}

export type PlaybackStore = ReturnType<typeof createPlaybackStore>;

export function createPlaybackStore(now: () => number = () => Date.now()) {
  const entradas = new Map<string, VideoPlaybackState>();

  const podar = () => {
    const agora = now();
    for (const [chave, v] of entradas) if (agora - v.updatedAt > PLAYBACK_TTL_MS) entradas.delete(chave);
    // A ordem do Map é a de inserção; `save` reinsere no fim, então o que sai primeiro é o MENOS recente.
    while (entradas.size > PLAYBACK_MAX_ENTRIES) {
      const maisAntiga = entradas.keys().next().value;
      if (maisAntiga === undefined) break;
      entradas.delete(maisAntiga);
    }
  };

  return {
    /** Guarda (ou atualiza) o estado. O que não vier na chamada fica como estava. Chave nula é ignorada. */
    save(chave: string | null | undefined, input: VideoPlaybackInput): void {
      if (!chave) return;
      const anterior = entradas.get(chave);
      const proximo = sanitize({ ...anterior, ...input }, now());
      entradas.delete(chave);
      entradas.set(chave, proximo);
      podar();
    },
    /**
     * Grava só se NINGUÉM gravou depois de `vistoEm` (o `updatedAt` que este player viu por último). É o que impede o player
     * que ficou por baixo (página do post) de, ao sair, apagar a posição mais nova que o teatro de vídeo acabou de guardar.
     * Devolve se gravou.
     */
    saveUnlessNewer(chave: string | null | undefined, input: VideoPlaybackInput, vistoEm: number | null): boolean {
      if (!chave) return false;
      const atual = entradas.get(chave);
      if (atual && vistoEm !== null && atual.updatedAt > vistoEm) return false;
      this.save(chave, input);
      return true;
    },
    get(chave: string | null | undefined): VideoPlaybackState | null {
      if (!chave) return null;
      const v = entradas.get(chave);
      if (!v) return null;
      if (now() - v.updatedAt > PLAYBACK_TTL_MS) {
        entradas.delete(chave);
        return null;
      }
      return { ...v };
    },
    /** O segundo em que retomar, ou `null` (nada guardado, ainda no comecinho, ou já terminou). */
    resumePoint(chave: string | null | undefined): number | null {
      const v = this.get(chave);
      if (!v || v.currentTime < MIN_RESUME_SECONDS) return null;
      if (v.duration !== undefined && v.currentTime >= v.duration - END_MARGIN_SECONDS) return null;
      return v.currentTime;
    },
    /** O vídeo foi deixado TOCANDO há pouco (até HANDOFF_MAX_AGE_MS)? Então o próximo player continua tocando. */
    handoffPlaying(chave: string | null | undefined): boolean {
      const v = this.get(chave);
      return v !== null && v.isPlaying && now() - v.updatedAt <= HANDOFF_MAX_AGE_MS;
    },
    clear(chave: string | null | undefined): void {
      if (chave) entradas.delete(chave);
    },
    clearAll(): void {
      entradas.clear();
    },
    get size(): number {
      return entradas.size;
    },
  };
}

/** O armazenamento da aba, compartilhado por todos os players. */
export const videoPlaybackStore = createPlaybackStore();
