'use client';

import { auth, storage } from '@/lib/firebase';
import { deleteObject, ref, uploadBytesResumable, type StorageReference } from 'firebase/storage';
import imageCompression from 'browser-image-compression';
import { MAX_VIDEO_DURATION_SECONDS, isVideoDurationAllowed } from '@/lib/media/videoPolicy';

export type UploadPathFactory = (userId: string, file: File) => string;
export type UploadProgressCallback = (progress: number) => void;
export type UploadResult = {
  downloadURL: string;
  filePath: string;
  mediaId?: string;
  /** Vídeos entram na publicação imediatamente e ficam disponíveis quando o worker concluir o MP4. */
  processing?: boolean;
};

const VIDEO_EXTENSION = /\.(?:mp4|m4v|mov|mkv|webm|avi|mpeg|mpg|3gp|3g2|ts|mts|m2ts|ogv|wmv|flv)$/i;

export function isLikelyVideoFile(file: Pick<File, 'type' | 'name'>): boolean {
  return file.type.startsWith('video/') || VIDEO_EXTENSION.test(file.name);
}

export const avatarPathFactory: UploadPathFactory = (userId, file) => {
  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  return `user_uploads/${userId}/avatars/${crypto.randomUUID()}.${extension}`;
};

export const coverPathFactory: UploadPathFactory = (userId, file) => {
  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  return `user_uploads/${userId}/covers/cover_${Date.now()}.${extension}`;
};

export const postMediaPathFactory: UploadPathFactory = (userId, file) => {
  const extension = file.name.split('.').pop()?.toLowerCase() || 'bin';
  const mediaType = file.type.startsWith('image/')
    ? 'images'
    : isLikelyVideoFile(file)
      ? 'videos'
      : 'other';
  return `user_uploads/${userId}/postMedia/${mediaType}/${crypto.randomUUID()}.${extension}`;
};

export const directMessageMediaPathFactory: UploadPathFactory = (userId, file) => {
  const extension = file.name.split('.').pop()?.toLowerCase() || 'bin';
  const mediaType = file.type.startsWith('image/')
    ? 'images'
    : isLikelyVideoFile(file)
      ? 'videos'
      : file.type.startsWith('audio/')
        ? 'audio'
        : 'files';
  return `user_uploads/${userId}/dms/${mediaType}/${crypto.randomUUID()}.${extension}`;
};

export const userFilesPathFactory: UploadPathFactory = (userId, file) => {
  const extension = file.name.split('.').pop()?.toLowerCase() || 'bin';
  return `user_uploads/${userId}/user_files/${crypto.randomUUID()}.${extension}`;
};

interface UploadApiResponse {
  downloadURL?: unknown;
  filePath?: unknown;
  mediaId?: unknown;
}

interface VideoInitResponse extends UploadApiResponse {
  sourcePath?: unknown;
  status?: unknown;
  error?: unknown;
  maxDurationSeconds?: unknown;
}

async function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute('src');
      video.load();
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), 15_000);
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
      finish(duration);
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      // O navegador pode não conhecer o codec, enquanto o FFmpeg conhece. O worker faz a validação definitiva.
      finish(null);
    };
    video.src = objectUrl;
  });
}

async function uploadVideoForProcessing(
  userId: string,
  file: File,
  requestedPath: string,
  onProgress?: UploadProgressCallback,
): Promise<UploadResult> {
  const user = auth.currentUser;
  if (!user || user.uid !== userId) {
    throw new Error('A sessão da conta mudou. Entre novamente para enviar o vídeo.');
  }

  const durationSeconds = await readVideoDuration(file);
  if (!isVideoDurationAllowed(durationSeconds)) {
    const maxMinutes = Math.floor(MAX_VIDEO_DURATION_SECONDS / 60);
    throw new Error(`O vídeo ultrapassa o limite de ${maxMinutes} minutos.`);
  }

  const idToken = await user.getIdToken();
  const response = await fetch('/api/media/video/init', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      storagePath: requestedPath,
      contentType: file.type.startsWith('video/') ? file.type : 'video/mp4',
      size: file.size,
      durationSeconds,
    }),
  });

  let body: VideoInitResponse = {};
  try {
    body = await response.json() as VideoInitResponse;
  } catch {
    // A mensagem genérica abaixo também cobre proxy retornando HTML.
  }
  if (
    response.status !== 201 ||
    typeof body.sourcePath !== 'string' ||
    typeof body.downloadURL !== 'string' ||
    typeof body.filePath !== 'string' ||
    typeof body.mediaId !== 'string'
  ) {
    if (body.error === 'video-too-long') {
      throw new Error('O vídeo ultrapassa o limite de 2 horas e 50 minutos.');
    }
    throw new Error('Não foi possível preparar o envio do vídeo. Tente novamente.');
  }

  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(ref(storage, body.sourcePath as string), file, {
      contentType: file.type.startsWith('video/') ? file.type : 'video/mp4',
      customMetadata: {
        mediaId: body.mediaId as string,
        pipeline: 'ffmpeg-v1',
      },
    });
    task.on(
      'state_changed',
      (snapshot) => onProgress?.((snapshot.bytesTransferred / snapshot.totalBytes) * 100),
      () => reject(new Error('O envio do vídeo foi interrompido. Verifique a conexão e tente novamente.')),
      () => {
        onProgress?.(100);
        resolve();
      },
    );
  });

  return {
    downloadURL: body.downloadURL,
    filePath: body.filePath,
    mediaId: body.mediaId,
    processing: true,
  };
}

/**
 * Envia bytes para a API propria. O SDK Web do Firebase Storage nao e usado aqui: o backend dele cria uma URL com
 * token permanente mesmo quando o cliente nao chama getDownloadURL(). O Admin SDK grava sem esse token e registra o
 * objeto em media/{id}; privado volta como /mp/<id> e publico como media.exercitodolula.app/m/<id>.
 */
async function uploadThroughServer(
  userId: string,
  file: File,
  filePath: string,
  onProgress?: UploadProgressCallback,
): Promise<UploadResult> {
  const user = auth.currentUser;
  if (!user || user.uid !== userId) {
    throw new Error('A sessao da conta mudou. Entre novamente para enviar o arquivo.');
  }

  const idToken = await user.getIdToken();
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('storagePath', filePath);

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/media/upload');
    request.setRequestHeader('Authorization', `Bearer ${idToken}`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.((event.loaded / event.total) * 100);
    };
    request.onerror = () => reject(new Error('Falha de rede durante o envio do arquivo.'));
    request.onabort = () => reject(new Error('O envio do arquivo foi cancelado.'));
    request.onload = () => {
      let body: UploadApiResponse = {};
      try {
        body = JSON.parse(request.responseText) as UploadApiResponse;
      } catch {
        // A validacao abaixo produz uma mensagem segura mesmo se um proxy devolver HTML.
      }
      if (
        request.status !== 201 ||
        typeof body.downloadURL !== 'string' ||
        typeof body.filePath !== 'string' ||
        typeof body.mediaId !== 'string'
      ) {
        reject(new Error('Nao foi possivel concluir o envio do arquivo. Tente novamente.'));
        return;
      }
      onProgress?.(100);
      resolve({ downloadURL: body.downloadURL, filePath: body.filePath, mediaId: body.mediaId });
    };
    request.send(form);
  });
}

export async function optimizeImage(
  file: File,
  options = { maxSizeMB: 0.8, maxWidthOrHeight: 1280, useWebWorker: true },
): Promise<File> {
  let fileToProcess = file;
  const lowerName = file.name.toLowerCase();
  const isHeic = file.type === 'image/heic' || file.type === 'image/heif' ||
    lowerName.endsWith('.heic') || lowerName.endsWith('.heif');

  if (isHeic) {
    try {
      const heic2any = (await import('heic2any')).default;
      const conversionResult = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
      const resultBlob = Array.isArray(conversionResult) ? conversionResult[0] : conversionResult;
      fileToProcess = new File([resultBlob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), {
        type: 'image/jpeg',
        lastModified: Date.now(),
      });
    } catch (error) {
      console.error('Falha ao converter HEIC/HEIF para JPEG:', error);
      return file;
    }
  }

  const compressible = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!compressible.includes(fileToProcess.type)) return fileToProcess;
  try {
    return await imageCompression(fileToProcess, options);
  } catch (error) {
    console.error('Falha ao otimizar imagem; enviando o arquivo sem compressao:', error);
    return fileToProcess;
  }
}

export async function uploadFileToStorage(
  userId: string,
  file: File,
  pathFactory: UploadPathFactory,
  onProgress?: UploadProgressCallback,
  attemptOptimization: boolean = true,
): Promise<UploadResult> {
  if (!userId) throw new Error('User ID must be provided to upload files.');
  if (!file) throw new Error('No file provided for upload.');

  let fileToUpload = file;
  if (attemptOptimization && file.type.startsWith('image/')) {
    try {
      fileToUpload = await optimizeImage(file);
    } catch (error) {
      console.error('Falha ao otimizar imagem; enviando o arquivo original:', error);
    }
  }

  const filePath = pathFactory(userId, fileToUpload);
  if (isLikelyVideoFile(fileToUpload)) {
    return uploadVideoForProcessing(userId, fileToUpload, filePath, onProgress);
  }
  return uploadThroughServer(userId, fileToUpload, filePath, onProgress);
}

export async function deleteFileFromStorage(filePath: string): Promise<void> {
  if (!filePath) return;
  const storageRef: StorageReference = ref(storage, filePath);
  try {
    await deleteObject(storageRef);
  } catch (error: any) {
    console.error(`Erro ao excluir o arquivo ${filePath}:`, error);
    if (error.code === 'storage/unauthorized') {
      // O `code` é preservado de propósito: quem chama precisa distinguir "não existe mais" (fim de vida esperado)
      // de falha real, e sem o código só sobra a mensagem, que não serve para decidir.
      const reembalado: Error & { code?: string } = new Error(
        `Permission denied. You do not have access to delete the file at '${filePath}'.`,
      );
      reembalado.code = error.code;
      throw reembalado;
    }
    throw error;
  }
}
