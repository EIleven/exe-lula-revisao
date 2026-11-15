import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  MAX_VIDEO_DURATION_SECONDS,
  isVideoDurationAllowed,
  isVideoStagingPath,
  videoOutputPath,
  videoStagingPath,
} from '../src/lib/media/videoPolicy.ts';

let checks = 0;
const ok = (value, message) => {
  assert.ok(value, message);
  checks += 1;
};
const equal = (actual, expected, message) => {
  assert.equal(actual, expected, message);
  checks += 1;
};

equal(MAX_VIDEO_DURATION_SECONDS, 10_200, 'limite deve ser 2h50');
ok(isVideoDurationAllowed(10_200), 'aceita exatamente 2h50');
ok(!isVideoDurationAllowed(10_200.01), 'recusa acima de 2h50');
ok(isVideoDurationAllowed(null), 'codec desconhecido no navegador segue para FFprobe');
equal(
  videoStagingPath('u1', 'A'.repeat(22)),
  `video_staging/u1/${'A'.repeat(22)}/source`,
  'fonte fica fora de user_uploads',
);
ok(isVideoStagingPath(`video_staging/u1/${'A'.repeat(22)}/source`), 'reconhece staging válido');
ok(!isVideoStagingPath('../source'), 'rejeita travessia');
equal(
  videoOutputPath('user_uploads/u1/postMedia/videos/original.mov', 'B'.repeat(22)),
  `user_uploads/u1/postMedia/videos/${'B'.repeat(22)}.mp4`,
  'saída é MP4 com id opaco',
);

const files = await Promise.all(Object.entries({
  service: 'src/lib/services/mediaUploadService.ts',
  init: 'src/app/api/media/video/init/route.ts',
  storage: 'storage.rules',
  functions: 'functions/src/index.ts',
  worker: 'video-worker/index.mjs',
  publicRoute: 'src/app/m/[id]/route.ts',
  privateRoute: 'src/app/mp/[id]/route.ts',
  player: 'src/components/shared/PlatformVideo.tsx',
  postContent: 'src/components/feed/PostCardContent.tsx',
  comments: 'src/components/comments/CommentInputArea.tsx',
  feedComments: 'src/components/feed/CommentInputArea.tsx',
  messages: 'src/components/messages/MessageInputArea.tsx',
  files: 'src/lib/services/fileService.ts',
}).map(async ([name, path]) => [name, await readFile(path, 'utf8')]));
const source = Object.fromEntries(files);

ok(source.service.includes('uploadBytesResumable'), 'vídeo usa upload retomável');
ok(source.service.includes('isLikelyVideoFile(fileToUpload)'), 'serviço central reconhece vídeo');
ok(!source.init.includes('MAX_MEDIA_FILE_SIZE'), 'inicialização de vídeo não herda teto de 5 MB');
ok(source.storage.includes('match /video_staging/{userId}/{mediaId}/source'), 'staging tem regra própria');
ok(source.storage.includes('allow get, list: if false'), 'original transitório não é legível');
ok(source.functions.includes('onVideoSourceUploaded'), 'finalização dispara o worker');
ok(source.functions.includes('dispatchQueuedVideoTranscodes'), 'fila tem recuperação automática');
ok(source.worker.includes("'-crf', '23'"), 'FFmpeg usa compressão por qualidade');
ok(source.worker.includes("'-fpsmax', '30'"), 'FFmpeg limita desperdício de quadros');
ok(source.worker.includes("'min(1920,iw)'"), 'FFmpeg limita largura a 1080p');
ok(source.worker.includes('MAX_DURATION_SECONDS'), 'worker mede duração novamente');
ok(source.worker.includes("contentType: 'video/mp4'"), 'saída é MP4 interoperável');
ok(source.publicRoute.includes('vazio(425'), 'rota pública sinaliza processamento');
ok(source.privateRoute.includes("status: 425"), 'rota privada sinaliza processamento');
ok(source.player.includes("method: 'HEAD'"), 'player acompanha o estado sem baixar bytes');
ok(source.player.includes('Compactando vídeo em 1080p'), 'usuário recebe estado claro');
ok(source.postContent.includes("querySelectorAll<HTMLVideoElement>('video[src]')"), 'vídeo dentro de artigo acompanha a fila');
ok(!source.comments.includes('MAX_VIDEO_BYTES'), 'comentários não limitam vídeo por MB');
ok(!source.comments.includes('videoEl.duration > 60'), 'comentários não mantêm limite de 1 minuto');
ok(!source.feedComments.includes('videoEl.duration > 60'), 'composer alternativo não limita a 1 minuto');
ok(source.messages.includes("!selectedFile.type.startsWith('video/')"), 'chat exclui vídeo do teto genérico');
ok(source.files.includes('uploadFileToStorage'), 'Arquivos usa o mesmo pipeline central');

console.log(`[e2e:video] ${checks} verificações, 0 falhas.`);
