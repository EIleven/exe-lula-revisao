/** Regras puras do pipeline de video. Mantidas fora do Firebase/Next para testes deterministas. */
export const MAX_VIDEO_DURATION_SECONDS = 2 * 60 * 60 + 50 * 60;
export const VIDEO_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

export type VideoProcessingStatus =
  | 'uploading'
  | 'queued'
  | 'dispatching'
  | 'processing'
  | 'ready'
  | 'failed';

export function isVideoDurationAllowed(durationSeconds: number | null | undefined): boolean {
  // Alguns contêineres não entregam a duração ao navegador. Nessa situação o FFprobe do worker decide depois;
  // não recusamos um vídeo válido só porque o aparelho não conseguiu ler os metadados.
  if (durationSeconds == null || !Number.isFinite(durationSeconds)) return true;
  return durationSeconds > 0 && durationSeconds <= MAX_VIDEO_DURATION_SECONDS;
}

export function videoOutputPath(storagePath: string, mediaId: string): string {
  const slash = storagePath.lastIndexOf('/');
  const directory = slash >= 0 ? storagePath.slice(0, slash) : storagePath;
  return `${directory}/${mediaId}.mp4`;
}

export function videoStagingPath(uid: string, mediaId: string): string {
  return `video_staging/${uid}/${mediaId}/source`;
}

/**
 * Onde mora um anexo CIFRADO e grande. Caminho proprio, separado de `user_uploads/`, por dois motivos: as regras de
 * `user_uploads` so aceitam ate 5 MB e tipos conhecidos (um borrao opaco nao e nenhum deles), e ter o caminho
 * dizendo "enc" deixa visivel, na inspecao do bucket, qual objeto o servidor nao consegue ler.
 */
export function encryptedMediaPath(uid: string, mediaId: string): string {
  return `user_uploads_enc/${uid}/${mediaId}`;
}

export function isEncryptedMediaPath(path: string): boolean {
  return /^user_uploads_enc\/[^/]+\/[A-Za-z0-9_-]{22}$/.test(path);
}

export function isVideoStagingPath(path: string): boolean {
  return /^video_staging\/[^/]+\/[A-Za-z0-9_-]{22}\/source$/.test(path);
}
