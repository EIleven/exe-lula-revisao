#!/usr/bin/env node
/**
 * Caminho de FALHA do worker de video (video-worker/index.mjs), executado de verdade contra os emuladores.
 *   npm run emulators   (Firestore e Storage)
 *   node e2e/video-worker-failure-check.mjs        (ou: npm run e2e:video-falha)
 *
 * Por que existe: o tratamento de erro final do worker usava uma variavel declarada so dentro de main(), entao qualquer
 * falha de transcodificacao estourava ReferenceError fora do try, o processo caia sem gravar "falhou" e o video ficava em
 * "processando" para sempre (e a fonte nunca era apagada). Os testes de politica pura nao passam por esse caminho.
 *
 * Aqui a fonte e um arquivo que NAO e video: o ffprobe falha (ou nem existe na maquina) e o worker precisa terminar com
 * codigo de saida diferente de zero (para o Cloud Run registrar a falha) E com o estado "falhou" gravado nos dois
 * documentos. Tambem confere que um registro com caminho adulterado NAO faz o worker apagar o que o registro apontar.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fsGetDoc, fsSet } from './lib/harness.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
let falhas = 0;
let total = 0;
const confere = (nome, ok, motivo) => {
  total++;
  if (ok) console.log(`OK    ${nome}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo}`); }
};

const novoId = () => randomBytes(16).toString('base64url'); // 22 caracteres [A-Za-z0-9_-]

function rodarWorker(mediaId, montagem) {
  return new Promise((resolve) => {
    const filho = spawn(process.execPath, ['--no-warnings', join(RAIZ, 'video-worker', 'index.mjs')], {
      env: {
        ...process.env,
        VIDEO_MEDIA_ID: mediaId,
        GOOGLE_CLOUD_PROJECT: 'demo-soberan',
        FIRESTORE_DATABASE_ID: 'echo-db-124325',
        FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080',
        STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199',
        STORAGE_BUCKET: 'demo-soberan.appspot.com',
        MEDIA_MOUNT: montagem,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let saida = '';
    filho.stdout.on('data', (c) => { saida += c; });
    filho.stderr.on('data', (c) => { saida += c; });
    const relogio = setTimeout(() => filho.kill(), 60_000);
    filho.on('close', (codigo) => { clearTimeout(relogio); resolve({ codigo, saida }); });
  });
}

async function semear({ uid, mediaId, montagem, sourcePath, conteudo }) {
  const outputPath = `user_uploads/${uid}/postMedia/videos/${mediaId}.mp4`;
  await fsSet(`media/${mediaId}`, { ownerUid: uid, kind: 'postMedia', visibility: 'public', storagePath: outputPath, contentType: 'video/mp4', size: 0, processingStatus: 'queued' }, 'owner');
  await fsSet(`videoUploads/${mediaId}`, { mediaId, ownerUid: uid, kind: 'postMedia', visibility: 'public', sourcePath, outputPath, status: 'queued', attempts: 0 }, 'owner');
  if (conteudo !== null) {
    const arquivo = join(montagem, sourcePath);
    mkdirSync(dirname(arquivo), { recursive: true });
    writeFileSync(arquivo, conteudo);
  }
}

const montagem = mkdtempSync(join(tmpdir(), 'video-mount-'));
try {
  // 1. fonte que não é vídeo: o worker falha, e a falha precisa ser REGISTRADA
  {
    const uid = 'u_video_falha';
    const mediaId = novoId();
    await semear({ uid, mediaId, montagem, sourcePath: `video_staging/${uid}/${mediaId}/source`, conteudo: 'isto não é um vídeo' });
    const r = await rodarWorker(mediaId, montagem);
    confere('FALHA · o worker termina com código diferente de zero (o Cloud Run precisa ver a falha)', r.codigo !== 0, `código ${r.codigo}`);
    confere('FALHA · não estoura ReferenceError no tratamento de erro', !/ReferenceError/.test(r.saida), r.saida.split('\n').filter((l) => /ReferenceError/.test(l)).join(' | '));
    const up = await fsGetDoc(`videoUploads/${mediaId}`, 'owner');
    const md = await fsGetDoc(`media/${mediaId}`, 'owner');
    confere('FALHA · o upload fica com status "failed" e o código transcode-failed', up.doc?.status === 'failed' && up.doc?.errorCode === 'transcode-failed', `status=${up.doc?.status} erro=${up.doc?.errorCode}`);
    confere('FALHA · a mídia fica "failed" (a página mostra o erro em vez de "processando" para sempre)', md.doc?.processingStatus === 'failed' && md.doc?.processingError === 'transcode-failed', `processingStatus=${md.doc?.processingStatus}`);
  }

  // 2. registro com caminho adulterado: recusado, e o tratamento de erro NÃO apaga o caminho do registro
  {
    const uid = 'u_video_adulterado';
    const mediaId = novoId();
    await semear({ uid, mediaId, montagem, sourcePath: `video_staging/outro_usuario/${mediaId}/source`, conteudo: null });
    const r = await rodarWorker(mediaId, montagem);
    const up = await fsGetDoc(`videoUploads/${mediaId}`, 'owner');
    confere('ADULTERADO · o worker recusa o registro (record-path-mismatch) e também registra a falha', r.codigo !== 0 && up.doc?.status === 'failed', `código ${r.codigo} status=${up.doc?.status}`);
    confere('ADULTERADO · o motivo registrado é o do worker, sem vazar caminho do registro', /record-path-mismatch/.test(up.doc?.errorMessage ?? ''), up.doc?.errorMessage);
  }
} finally {
  rmSync(montagem, { recursive: true, force: true });
}

console.log('');
console.log(`${total} verificações.`);
if (falhas) { console.log(`${falhas} falha(s).`); process.exit(1); }
console.log('Worker de vídeo OK: toda falha de transcodificação é registrada e o processo termina com erro.');
