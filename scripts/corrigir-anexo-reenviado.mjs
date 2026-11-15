#!/usr/bin/env node
/**
 * Conserta UM caso legado: anexo reenviado cujo objeto pertence a um terceiro fora da conversa de destino.
 *
 *   node scripts/corrigir-anexo-reenviado.mjs --producao             mostra o plano
 *   node scripts/corrigir-anexo-reenviado.mjs --producao --aplicar   executa
 *
 * O QUE ACONTECEU: até julho de 2026 o app tinha reenvio de mensagem, e o cliente copiava a **URL** do anexo em vez
 * de copiar o arquivo. Com token permanente isso funcionava, porque o token não pergunta nada. A rota nova refaz a
 * autorização a cada pedido e procura a conversa entre quem pede e o **dono do objeto** — e a destinatária do
 * reenvio não está nela. O reenvio não existe mais no código (só `MessageInputArea` grava `fileUrl`, com upload do
 * próprio remetente), então este é um conserto de dado, não de funcionalidade.
 *
 * O CONSERTO: uma única cópia privada do objeto na pasta do remetente da conversa de destino, nascendo **sem**
 * `firebaseStorageDownloadTokens`, com registro `media/{id}` próprio; as duas mensagens passam a apontar para ela.
 * O objeto e o registro ORIGINAIS ficam intactos — quem participa da conversa original continua vendo o original.
 *
 * A cópia aumenta o total de objetos privados, mas **não** o que há para revogar: ela nasce sem token.
 *
 * Reverter é trocar `fileUrl` das duas mensagens de volta para a URL impressa no fim, e apagar a cópia.
 */

import { randomUUID } from 'node:crypto';

const { generateMediaId } = await import('../src/lib/media/mediaId.ts');

const args = new Set(process.argv.slice(2));
const PROD = args.has('--producao');
const APLICAR = args.has('--aplicar');

const PROJECT = PROD ? 'echo-b5aw9' : 'demo-soberan';
const DATABASE = 'echo-db-124325';
const BUCKET = PROD ? 'echo-b5aw9.firebasestorage.app' : ['demo-soberan', 'appspot', 'com'].join('.');
const RAIZ = `projects/${PROJECT}/databases/${DATABASE}/documents`;
const TOKEN = process.env.FIRESTORE_ACCESS_TOKEN ?? '';
if (!TOKEN) {
  console.error('defina FIRESTORE_ACCESS_TOKEN (gcloud auth print-access-token) sem imprimi-lo');
  process.exit(2);
}

// ───────────── o caso, nomeado ─────────────

/** Conversa de destino do reenvio. Quem a rota precisa autorizar: os dois participantes dela. */
const CONVERSA_DESTINO = 'G1haVbUWAiUbGQZ5sol7d3nuFFu1_fGGaAQ5Qh8dph83ruIWF6AwlHWH2';
/** Quem reenviou. É participante da conversa de destino, e passa a ser o dono da cópia. */
const REMETENTE = 'fGGaAQ5Qh8dph83ruIWF6AwlHWH2';
/** As duas mensagens que apontam para o objeto de terceiro. */
const MENSAGENS = ['CbBtNIvSmFoUlZTP5KYz', 'ta9VFZ6oO0vT5wiz6M7k'];
/** Registro atual, do dono original. Fica intacto. */
const MEDIA_ORIGINAL = 'rve0NGP09_Iu9odv-_de35';

const h = { Authorization: `Bearer ${TOKEN}`, 'x-goog-user-project': PROJECT };
const ABORTAR = (motivo) => { console.error(`\nABORTADO: ${motivo}`); process.exit(1); };

async function chamar(metodo, url, corpo, aceitar404 = false) {
  const resposta = await fetch(url, {
    method: metodo,
    headers: { ...h, ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  if (aceitar404 && resposta.status === 404) return null;
  const texto = await resposta.text();
  if (!resposta.ok) {
    throw new Error(`${metodo} ${new URL(url).pathname} falhou (${resposta.status}): ${texto.slice(0, 300)}`);
  }
  return texto ? JSON.parse(texto) : null;
}
const s = (f) => f?.stringValue ?? '';
const arr = (f) => (f?.arrayValue?.values ?? []).map(s);
const doc = (caminho) => chamar('GET', `https://firestore.googleapis.com/v1/${RAIZ}/${caminho}`, undefined, true);
const objeto = (caminho) =>
  chamar('GET', `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(caminho)}`, undefined, true);

console.log(`alvo: ${PROD ? 'PRODUÇÃO' : 'emuladores'} · ${PROJECT} · bucket ${BUCKET}`);
console.log(`modo: ${APLICAR ? 'GRAVAR' : 'somente leitura'}\n`);

// ───────────── 1. confere a premissa inteira antes de tocar em nada ─────────────

const registroOriginal = await doc(`media/${MEDIA_ORIGINAL}`);
if (!registroOriginal) ABORTAR(`o registro media/${MEDIA_ORIGINAL} não existe`);
const campos = registroOriginal.fields ?? {};
const caminhoOriginal = s(campos.storagePath);
const donoOriginal = s(campos.ownerUid);
const contentType = s(campos.contentType);
console.log(`registro original ... media/${MEDIA_ORIGINAL}`);
console.log(`  objeto ............ ${caminhoOriginal}`);
console.log(`  dono .............. ${donoOriginal}`);
console.log(`  tipo/visibilidade . ${s(campos.kind)} / ${s(campos.visibility)} · ${contentType}`);
if (s(campos.kind) !== 'dm' || s(campos.visibility) !== 'private') ABORTAR('o registro original não é anexo privado');
if (campos.deletedAt !== undefined) ABORTAR('o registro original está marcado como excluído');

const conversa = await doc(`conversations/${CONVERSA_DESTINO}`);
if (!conversa) ABORTAR('a conversa de destino não existe');
const participantes = arr(conversa.fields?.participantIds);
console.log(`\nconversa de destino . ${CONVERSA_DESTINO}`);
console.log(`  participantes ..... ${participantes.join(', ')}`);
if (!participantes.includes(REMETENTE)) ABORTAR('o remetente não participa da conversa de destino');
if (participantes.includes(donoOriginal)) ABORTAR('o dono original PARTICIPA da conversa: não há nada a consertar');
if (CONVERSA_DESTINO !== [...participantes].sort().join('_')) {
  ABORTAR('o id da conversa não é o que a rota recalcula: a cópia não resolveria nada');
}

for (const id of MENSAGENS) {
  const m = await doc(`conversations/${CONVERSA_DESTINO}/messages/${id}`);
  if (!m) ABORTAR(`a mensagem ${id} não existe`);
  const url = s(m.fields?.fileUrl);
  if (url !== `/mp/${MEDIA_ORIGINAL}`) ABORTAR(`a mensagem ${id} aponta para ${url}, não para /mp/${MEDIA_ORIGINAL}`);
  if (s(m.fields?.senderId) !== REMETENTE) ABORTAR(`a mensagem ${id} foi enviada por outra pessoa`);
}
console.log(`\nmensagens ........... ${MENSAGENS.length}, as duas apontando para /mp/${MEDIA_ORIGINAL}, as duas do remetente`);

const origem = await objeto(caminhoOriginal);
if (!origem) ABORTAR('o objeto original não está no bucket');
console.log(`objeto original ..... ${origem.size} bytes · ${origem.contentType}`);
console.log(`  tem token ......... ${Boolean(origem.metadata?.firebaseStorageDownloadTokens)}  (fica como está; a revogação cuida dele)`);

// ───────────── 2. o plano ─────────────

const extensao = caminhoOriginal.includes('.') ? caminhoOriginal.split('.').pop() : 'bin';
const caminhoCopia = `user_uploads/${REMETENTE}/dms/images/${randomUUID()}.${extensao}`;
const novoId = generateMediaId();

console.log('\nplano:');
console.log(`  1. copiar o objeto para ${caminhoCopia}`);
console.log('  2. apagar firebaseStorageDownloadTokens da cópia e conferir que saiu');
console.log(`  3. criar media/${novoId} · dono ${REMETENTE} · kind dm · visibility private`);
console.log(`  4. apontar as ${MENSAGENS.length} mensagens para /mp/${novoId}`);
console.log(`\n  intactos: o objeto ${caminhoOriginal} e o registro media/${MEDIA_ORIGINAL}`);

if (!APLICAR) {
  console.log('\nnada gravado (falta --aplicar).');
  process.exit(0);
}

// ───────────── 3. executa ─────────────

console.log('\n--- executando ---');

const copia = await chamar(
  'POST',
  `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(caminhoOriginal)}` +
    `/copyTo/b/${BUCKET}/o/${encodeURIComponent(caminhoCopia)}`,
  {},
);
console.log(`1. copiado: ${copia.name} · ${copia.size} bytes`);

// O copyTo leva os metadados da origem, inclusive o token. Apagar a chave e CONFERIR: sem esta conferência a cópia
// poderia nascer com exatamente o problema que esta rodada existe para eliminar.
await chamar(
  'PATCH',
  `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(caminhoCopia)}`,
  { metadata: { firebaseStorageDownloadTokens: null } },
);
const depois = await objeto(caminhoCopia);
const tokenRestante = depois?.metadata?.firebaseStorageDownloadTokens;
if (tokenRestante) ABORTAR('a cópia FICOU com token permanente — apague-a à mão antes de seguir');
console.log('2. token removido da cópia e conferido ausente');

await chamar(
  'PATCH',
  `https://firestore.googleapis.com/v1/${RAIZ}/media/${novoId}?currentDocument.exists=false`,
  {
    fields: {
      storagePath: { stringValue: caminhoCopia },
      contentType: { stringValue: depois.contentType ?? contentType },
      size: { integerValue: String(depois.size ?? origem.size) },
      ownerUid: { stringValue: REMETENTE },
      visibility: { stringValue: 'private' },
      kind: { stringValue: 'dm' },
      createdAt: { timestampValue: new Date().toISOString() },
    },
  },
);
console.log(`3. registro criado: media/${novoId}`);

for (const id of MENSAGENS) {
  await chamar(
    'PATCH',
    `https://firestore.googleapis.com/v1/${RAIZ}/conversations/${CONVERSA_DESTINO}/messages/${id}` +
      '?updateMask.fieldPaths=fileUrl&currentDocument.exists=true',
    { fields: { fileUrl: { stringValue: `/mp/${novoId}` } } },
  );
  console.log(`4. mensagem ${id} -> /mp/${novoId}`);
}

console.log('\nPRONTO.');
console.log(`cópia ....... ${caminhoCopia}`);
console.log(`registro .... media/${novoId}`);
console.log(`para reverter: fileUrl das ${MENSAGENS.length} mensagens volta a /mp/${MEDIA_ORIGINAL}, e apague a cópia`);
