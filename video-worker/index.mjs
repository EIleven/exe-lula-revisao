import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {applicationDefault, initializeApp} from 'firebase-admin/app';
import {FieldValue, getFirestore} from 'firebase-admin/firestore';
import {Storage} from '@google-cloud/storage';

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'echo-b5aw9';
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'echo-db-124325';
const BUCKET_NAME = process.env.STORAGE_BUCKET || 'echo-b5aw9.firebasestorage.app';
const MOUNT_ROOT = process.env.MEDIA_MOUNT || '/mnt/media';
const MEDIA_ID = process.env.VIDEO_MEDIA_ID || '';
const MAX_DURATION_SECONDS = 2 * 60 * 60 + 50 * 60;
const VALID_ID = /^[A-Za-z0-9_-]{22}$/;

// Caminho da fonte JÁ VALIDADO contra o registro (ver main). O tratamento de erro final vive fora de main() e precisa
// dele: declarar a variável só dentro de main() fazia esse tratamento estourar ReferenceError, o processo caía sem gravar
// "falhou" e o vídeo ficava em "processando" para sempre. Só vira não-nulo depois da validação, então um registro
// adulterado nunca leva o worker a apagar o caminho que ele aponta.
let validatedSourcePath = null;

const app = initializeApp({credential: applicationDefault(), projectId: PROJECT_ID});
const db = getFirestore(app, DATABASE_ID);
const storage = new Storage({projectId: PROJECT_ID});
const bucket = storage.bucket(BUCKET_NAME);

function safeMountedPath(storagePath) {
  if (
    typeof storagePath !== 'string' ||
    storagePath.startsWith('/') ||
    storagePath.includes('..') ||
    storagePath.includes('\\') ||
    storagePath.includes('//')
  ) throw new Error('unsafe-storage-path');
  const mounted = path.resolve(MOUNT_ROOT, storagePath);
  const root = path.resolve(MOUNT_ROOT) + path.sep;
  if (!mounted.startsWith(root)) throw new Error('unsafe-storage-path');
  return mounted;
}

function run(command, args, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    let pending = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) onLine?.(line);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 64_000) stderr = stderr.slice(-64_000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({stdout, stderr});
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(-4000)}`));
    });
  });
}

/**
 * Formatos que este worker aceita abrir. Lista fechada de proposito.
 *
 * Sem ela, o FFmpeg aceita tambem demuxers de LISTA (concat, hls, m3u8) e protocolos de entrada (file:, http:).
 * Um arquivo que se diz video e e, na verdade, uma playlist pode mandar o FFmpeg ler arquivo local ou buscar URL
 * -- e este processo roda com a credencial de servico do projeto. O resultado sairia dentro do video transcodificado,
 * publicado pela propria rede. E um caminho conhecido de exfiltracao, nao uma hipotese.
 */
const FORMATOS_ACEITOS = 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mpegts,mpeg,ogg,flv,asf';
/** So arquivo local. Nada de http, nem concat, nem pipe de rede. */
const PROTOCOLOS_ACEITOS = 'file';

async function probeVideo(inputPath) {
  const {stdout} = await run('ffprobe', [
    '-v', 'error',
    '-format_whitelist', FORMATOS_ACEITOS,
    '-protocol_whitelist', PROTOCOLOS_ACEITOS,
    '-show_entries', 'format=duration:stream=index,codec_type,width,height,avg_frame_rate',
    '-of', 'json',
    inputPath,
  ]);
  const data = JSON.parse(stdout);
  const duration = Number(data?.format?.duration);
  const video = Array.isArray(data?.streams)
    ? data.streams.find((stream) => stream.codec_type === 'video')
    : null;
  if (!video || !Number.isFinite(duration) || duration <= 0) throw new Error('invalid-video');
  return {
    duration,
    width: Number(video.width || 0),
    height: Number(video.height || 0),
  };
}

async function main() {
  if (!VALID_ID.test(MEDIA_ID)) throw new Error('invalid-media-id');
  const uploadRef = db.collection('videoUploads').doc(MEDIA_ID);
  const mediaRef = db.collection('media').doc(MEDIA_ID);
  const [snapshot, initialMedia] = await Promise.all([uploadRef.get(), mediaRef.get()]);
  if (!snapshot.exists) throw new Error('upload-record-not-found');
  const data = snapshot.data() || {};
  if (data.status === 'ready') return;

  const ownerUid = String(data.ownerUid || '');
  const sourcePath = String(data.sourcePath || '');
  const outputPath = String(data.outputPath || '');
  if (
    sourcePath !== `video_staging/${ownerUid}/${MEDIA_ID}/source` ||
    !outputPath.startsWith(`user_uploads/${ownerUid}/`) ||
    !outputPath.endsWith(`/${MEDIA_ID}.mp4`)
  ) throw new Error('record-path-mismatch');
  if (initialMedia.data()?.deletedAt) {
    await bucket.file(sourcePath).delete({ignoreNotFound: true});
    await uploadRef.update({status: 'cancelled', updatedAt: FieldValue.serverTimestamp()});
    return;
  }

  validatedSourcePath = sourcePath;
  const input = safeMountedPath(sourcePath);
  const output = safeMountedPath(outputPath);
  await mkdir(path.dirname(output), {recursive: true});

  await Promise.all([
    uploadRef.update({
      status: 'processing',
      workerStartedAt: FieldValue.serverTimestamp(),
      workerAttempts: FieldValue.increment(1),
      progress: 0,
      updatedAt: FieldValue.serverTimestamp(),
    }),
    mediaRef.update({
      processingStatus: 'processing',
      processingProgress: 0,
      updatedAt: FieldValue.serverTimestamp(),
    }),
  ]);

  const probe = await probeVideo(input);
  if (probe.duration > MAX_DURATION_SECONDS + 1) {
    await Promise.all([
      uploadRef.update({
        status: 'failed',
        errorCode: 'video-too-long',
        measuredDuration: probe.duration,
        updatedAt: FieldValue.serverTimestamp(),
      }),
      mediaRef.update({
        processingStatus: 'failed',
        processingError: 'video-too-long',
        updatedAt: FieldValue.serverTimestamp(),
      }),
      bucket.file(sourcePath).delete({ignoreNotFound: true}),
    ]);
    return;
  }

  await bucket.file(outputPath).delete({ignoreNotFound: true}).catch(() => undefined);
  let lastProgressAt = 0;
  let progressWrite = Promise.resolve();
  await run('ffmpeg', [
    '-hide_banner', '-y',
    // As duas travas valem na ENTRADA, por isso vem antes do -i.
    '-format_whitelist', FORMATOS_ACEITOS,
    '-protocol_whitelist', PROTOCOLOS_ACEITOS,
    '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
    '-maxrate', '5M', '-bufsize', '10M', '-pix_fmt', 'yuv420p', '-fpsmax', '30',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000',
    '-movflags', '+faststart', '-max_muxing_queue_size', '2048',
    '-progress', 'pipe:1', '-nostats',
    output,
  ], (line) => {
    if (!line.startsWith('out_time_ms=')) return;
    const micros = Number(line.slice('out_time_ms='.length));
    const progress = Math.max(0, Math.min(99, Math.round((micros / 1_000_000 / probe.duration) * 100)));
    if (Date.now() - lastProgressAt < 15_000) return;
    lastProgressAt = Date.now();
    progressWrite = progressWrite.then(() => Promise.all([
      uploadRef.update({progress, updatedAt: FieldValue.serverTimestamp()}),
      mediaRef.update({processingProgress: progress, updatedAt: FieldValue.serverTimestamp()}),
    ])).then(() => undefined);
  });
  await progressWrite;

  const outputFile = bucket.file(outputPath);
  await outputFile.setMetadata({
    contentType: 'video/mp4',
    cacheControl: data.visibility === 'public' ? 'public,max-age=3600' : 'private,no-store',
    contentDisposition: 'inline',
    metadata: {
      processedBy: 'ffmpeg-v1',
      sourceMediaId: MEDIA_ID,
    },
  });
  const [metadata] = await outputFile.getMetadata();
  const finalSize = Number(metadata.size || 0);
  const latestMedia = await mediaRef.get();
  if (latestMedia.data()?.deletedAt) {
    await Promise.all([
      outputFile.delete({ignoreNotFound: true}),
      bucket.file(sourcePath).delete({ignoreNotFound: true}),
      uploadRef.update({status: 'cancelled', updatedAt: FieldValue.serverTimestamp()}),
    ]);
    return;
  }
  await Promise.all([
    uploadRef.update({
      status: 'ready',
      progress: 100,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      finalSize,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }),
    mediaRef.update({
      contentType: 'video/mp4',
      size: finalSize,
      processingStatus: 'ready',
      processingProgress: 100,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      processedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }),
    bucket.file(sourcePath).delete({ignoreNotFound: true}),
  ]);
}

main().catch(async (error) => {
  console.error('[video-worker]', error);
  if (VALID_ID.test(MEDIA_ID)) {
    await Promise.allSettled([
      db.collection('videoUploads').doc(MEDIA_ID).update({
        status: 'failed',
        errorCode: 'transcode-failed',
        errorMessage: String(error?.message || error).slice(0, 500),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      db.collection('media').doc(MEDIA_ID).update({
        processingStatus: 'failed',
        processingError: 'transcode-failed',
        updatedAt: FieldValue.serverTimestamp(),
      }),
      validatedSourcePath ? bucket.file(validatedSourcePath).delete({ignoreNotFound: true}) : Promise.resolve(),
    ]);
  }
  process.exitCode = 1;
});
