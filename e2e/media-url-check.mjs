#!/usr/bin/env node
/**
 * Testa a camada de URLs próprias de mídia, sem app nem emuladores.
 *   node e2e/media-url-check.mjs
 *
 * Dois perigos concretos que este teste existe para travar:
 *
 * 1. **Open proxy.** Se a URL pública algum dia carregar um caminho em vez de um id opaco, bastaria trocá-lo para ler
 *    qualquer objeto do bucket. `isValidMediaId` e as guardas de código abaixo garantem que o caminho sempre venha do
 *    nosso banco.
 * 2. **Privado virando público.** Anexo de mensagem e arquivo pessoal NUNCA podem receber URL pública. Antes desta
 *    camada os dois recebiam `getDownloadURL()`, que é uma credencial permanente. A amarração entre tipo e
 *    visibilidade é verificada aqui e também na regra do Firestore.
 *
 * Sai com código 1 se algo falhar.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const {
  MEDIA_CACHE_CONTROL,
  MEDIA_ID_LENGTH,
  PUBLIC_KINDS,
  canBePublic,
  generateMediaId,
  isValidMediaId,
  kindFromPath,
  mediaPath,
  parseRange,
  publicMediaUrl,
  rangeLength,
  visibilityForKind,
} = await import('../src/lib/media/mediaId.ts');
const {
  contentTypeMatchesMediaPath,
  isAllowedMediaContentType,
  isValidMediaStoragePath,
} = await import('../src/lib/media/uploadPolicy.ts');

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
let falhas = 0;

function confere(nome, condicao, motivo, detalhe) {
  if (condicao) console.log(`OK    ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo}`); }
}

// ───────────── 1. O identificador opaco ─────────────

const id = generateMediaId();
confere('o id tem 22 caracteres', id.length === MEDIA_ID_LENGTH && MEDIA_ID_LENGTH === 22, `veio ${id.length}`, id);
confere('o id é aceito pela própria validação', isValidMediaId(id), `${id} recusado`);

const gerados = new Set(Array.from({ length: 2000 }, () => generateMediaId()));
confere(
  'ids gerados não repetem',
  gerados.size === 2000,
  `2000 gerações produziram ${gerados.size} distintos`,
  `${gerados.size}/2000`,
);
confere(
  'todo id gerado é seguro em URL',
  [...gerados].every((v) => /^[A-Za-z0-9_-]{22}$/.test(v)),
  'algum id saiu com caractere que precisa de escape',
);

const IDS_HOSTIS = [
  ['vazio', ''],
  ['nulo', null],
  ['indefinido', undefined],
  ['travessia', '../../etc/passwd'],
  ['travessia curta', '..'],
  ['com barra', 'user_uploads/abc/x.jpg'],
  ['com barra codificada', 'a%2Fb'],
  ['curto', 'abc'],
  ['longo', 'a'.repeat(23)],
  ['com ponto', 'aaaaaaaaaaaaaaaaaaaa.a'],
  ['com espaço', 'aaaaaaaaaaaaaaaaaaaa a'],
  ['com nova linha', 'aaaaaaaaaaaaaaaaaaaa\n'],
  ['caminho absoluto', '/aaaaaaaaaaaaaaaaaaaaa'],
  ['curinga', '*'],
  ['com asterisco no meio', 'aaaaaaaaaa*aaaaaaaaaaa'],
  ['objeto', {}],
  ['número', 123],
];
for (const [nome, entrada] of IDS_HOSTIS) {
  confere(`id recusado: ${nome}`, isValidMediaId(entrada) === false, 'deveria ser recusado antes de tocar no banco');
}

// ───────────── 2. Privado nunca vira público ─────────────

confere(
  'só post, avatar e capa podem ser públicos',
  PUBLIC_KINDS.length === 3 && ['postMedia', 'avatar', 'cover'].every((k) => PUBLIC_KINDS.includes(k)),
  `a lista é ${PUBLIC_KINDS.join(', ')}`,
  PUBLIC_KINDS.join(', '),
);
confere(
  'anexo de mensagem NÃO pode ser público',
  canBePublic('dm') === false && visibilityForKind('dm') === 'private',
  'anexo de mensagem direta não pode ter URL pública',
);
confere(
  'arquivo pessoal NÃO pode ser público',
  canBePublic('userFile') === false && visibilityForKind('userFile') === 'private',
  'arquivo pessoal não pode ter URL pública',
);
for (const kind of PUBLIC_KINDS) {
  confere(`${kind} nasce público`, visibilityForKind(kind) === 'public', 'deveria ser público');
}

// Caminhos exatamente como as fábricas de mediaUploadService os geram.
const CAMINHOS = [
  ['post, imagem', 'user_uploads/UID1/postMedia/images/abc.jpg', 'postMedia', 'public'],
  ['post, vídeo', 'user_uploads/UID1/postMedia/videos/abc.mp4', 'postMedia', 'public'],
  ['avatar', 'user_uploads/UID1/avatars/abc.jpg', 'avatar', 'public'],
  ['capa', 'user_uploads/UID1/covers/cover_1.jpg', 'cover', 'public'],
  ['anexo de mensagem', 'user_uploads/UID1/dms/images/abc.jpg', 'dm', 'private'],
  ['anexo de áudio', 'user_uploads/UID1/dms/audio/abc.m4a', 'dm', 'private'],
  ['arquivo pessoal', 'user_uploads/UID1/user_files/abc.pdf', 'userFile', 'private'],
  ['caminho desconhecido', 'user_uploads/UID1/algo_novo/abc.bin', 'userFile', 'private'],
  ['vazio', '', 'userFile', 'private'],
];
for (const [nome, caminho, kindEsperado, visEsperada] of CAMINHOS) {
  const kind = kindFromPath(caminho);
  confere(
    `tipo pelo caminho: ${nome}`,
    kind === kindEsperado && visibilityForKind(kind) === visEsperada,
    `veio ${kind}/${visibilityForKind(kind)}, esperado ${kindEsperado}/${visEsperada}`,
    `${kind} → ${visEsperada}`,
  );
}
confere(
  'caminho desconhecido cai no lado PRIVADO',
  visibilityForKind(kindFromPath('user_uploads/x/qualquer/coisa')) === 'private',
  'na dúvida o padrão tem de ser não publicar',
);

const UID_UPLOAD = 'uidSeguro123';
const CAMINHOS_UPLOAD = [
  ['arquivo pessoal válido', `user_uploads/${UID_UPLOAD}/user_files/abc-123.pdf`, true],
  ['imagem de post válida', `user_uploads/${UID_UPLOAD}/postMedia/images/abc_123.jpg`, true],
  ['pasta de outro UID', 'user_uploads/outro/user_files/abc.pdf', false],
  ['travessia', `user_uploads/${UID_UPLOAD}/user_files/../segredo.pdf`, false],
  ['barra invertida', `user_uploads/${UID_UPLOAD}/user_files\\segredo.pdf`, false],
  ['pasta desconhecida', `user_uploads/${UID_UPLOAD}/qualquer/abc.pdf`, false],
  ['subpasta extra', `user_uploads/${UID_UPLOAD}/user_files/pasta/abc.pdf`, false],
];
for (const [nome, caminho, esperado] of CAMINHOS_UPLOAD) {
  confere(`caminho de upload: ${nome}`, isValidMediaStoragePath(caminho, UID_UPLOAD) === esperado, caminho);
}
for (const tipo of ['image/jpeg', 'video/mp4', 'audio/ogg', 'application/pdf', 'text/plain']) {
  confere(`tipo permitido no upload: ${tipo}`, isAllowedMediaContentType(tipo), tipo);
}
for (const tipo of ['text/html', 'image/svg+xml', 'application/javascript', 'application/octet-stream']) {
  confere(`tipo perigoso recusado: ${tipo}`, !isAllowedMediaContentType(tipo), tipo);
}
confere(
  'avatar exige imagem de verdade pelo Content-Type',
  contentTypeMatchesMediaPath(`user_uploads/${UID_UPLOAD}/avatars/a.pdf`, 'application/pdf') === false,
  'documento não pode ser servido como avatar',
);
confere(
  'pasta de vídeo exige Content-Type de vídeo',
  contentTypeMatchesMediaPath(`user_uploads/${UID_UPLOAD}/postMedia/videos/a.mp4`, 'image/jpeg') === false,
  'tipo e pasta precisam concordar',
);

// ───────────── 3. A URL pública ─────────────

const url = publicMediaUrl(id, 'https://media.exercitodolula.app');
confere('a URL fica no domínio de mídia', url === `https://media.exercitodolula.app/m/${id}`, `veio ${url}`, url);
confere('o caminho é só /m/<id>', mediaPath(id) === `/m/${id}`, `veio ${mediaPath(id)}`);
confere(
  'a URL não traz host do Storage, caminho, UID nem token',
  !/firebasestorage|user_uploads|token=|alt=media/.test(url),
  `a URL vazou algo: ${url}`,
);
confere(
  'o cache permite propagar exclusão em até uma hora',
  /max-age=3600/.test(MEDIA_CACHE_CONTROL) && /s-maxage=3600/.test(MEDIA_CACHE_CONTROL) && !/immutable/.test(MEDIA_CACHE_CONTROL),
  `cache "${MEDIA_CACHE_CONTROL}": immutable serviria objeto apagado por muito tempo`,
  MEDIA_CACHE_CONTROL,
);

// ───────────── 4. Range: vídeo e áudio ─────────────

const TAM = 1000;
const RANGES = [
  ['sem cabeçalho', null, 'full', null, null],
  ['vazio', '', 'full', null, null],
  ['do início ao fim', 'bytes=0-', 'partial', 0, 999],
  ['faixa no meio', 'bytes=100-199', 'partial', 100, 199],
  ['do 500 ao fim', 'bytes=500-', 'partial', 500, 999],
  ['últimos 200 bytes', 'bytes=-200', 'partial', 800, 999],
  ['últimos mais que o tamanho', 'bytes=-5000', 'partial', 0, 999],
  ['fim além do tamanho é aparado', 'bytes=900-99999', 'partial', 900, 999],
  ['um único byte', 'bytes=0-0', 'partial', 0, 0],
  ['último byte', 'bytes=999-999', 'partial', 999, 999],
  ['começa além do fim', 'bytes=1000-', 'unsatisfiable', null, null],
  ['começa muito além', 'bytes=99999-100000', 'unsatisfiable', null, null],
  ['fim antes do começo é ignorado', 'bytes=500-100', 'full', null, null],
  ['malformado é ignorado', 'bytes=abc', 'full', null, null],
  ['unidade errada é ignorada', 'items=0-10', 'full', null, null],
  ['várias faixas: serve inteiro', 'bytes=0-10,20-30', 'full', null, null],
  ['negativo malformado', 'bytes=--5', 'full', null, null],
  ['só o prefixo', 'bytes=', 'full', null, null],
];
for (const [nome, header, kindEsperado, startEsperado, endEsperado] of RANGES) {
  const r = parseRange(header, TAM);
  let ok = r.kind === kindEsperado;
  if (ok && kindEsperado === 'partial') ok = r.start === startEsperado && r.end === endEsperado;
  confere(
    `range: ${nome}`,
    ok,
    `veio ${JSON.stringify(r)}, esperado ${kindEsperado}${startEsperado !== null ? ` ${startEsperado}-${endEsperado}` : ''}`,
    r.kind === 'partial' ? `${r.start}-${r.end}` : r.kind,
  );
}
confere('tamanho da resposta inteira', rangeLength({ kind: 'full' }, TAM) === TAM, 'deveria ser o tamanho todo');
confere(
  'tamanho da faixa inclui os dois extremos',
  rangeLength({ kind: 'partial', start: 100, end: 199 }, TAM) === 100,
  'bytes=100-199 são 100 bytes, não 99',
);
confere('objeto vazio não quebra', parseRange('bytes=0-', 0).kind === 'full', 'tamanho zero deveria cair em inteiro');

// ───────────── 5. A rota faz o que foi desenhado ─────────────

const rota = readFileSync(join(RAIZ, 'src', 'app', 'm', '[id]', 'route.ts'), 'utf8');

confere(
  'a rota valida o id ANTES de tocar no banco',
  rota.indexOf('isValidMediaId(id)') < rota.indexOf("collection('media')"),
  'id malformado não deve nem gerar leitura',
);
confere(
  'o caminho vem do banco, nunca da URL',
  rota.includes('doc.storagePath') && !/file\(\s*id\s*\)|bucket\(\)\.file\(`/.test(rota),
  'se o caminho viesse da URL isto seria um open proxy',
);
confere(
  'conteúdo removido responde 410',
  /deletedAt[\s\S]{0,120}410/.test(rota),
  'tombstone precisa ser 410, para o consumidor parar de tentar',
);
confere(
  'conteúdo privado responde 404, NÃO 403',
  /visibility !== 'public'[\s\S]{0,80}404/.test(rota) && !/visibility[\s\S]{0,80}403/.test(rota),
  'um 403 confirmaria que o id existe',
);
for (const [nome, trecho] of [
  ['Accept-Ranges', "'Accept-Ranges': 'bytes'"],
  ['ETag', 'ETag: etag'],
  ['Content-Range com 206', "'Content-Range'"],
  ['416 quando a faixa é impossível', '416'],
  ['304 com If-None-Match', "if-none-match"],
  ['CORS para incorporar fora do site', "'Access-Control-Allow-Origin': '*'"],
  ['nosniff', "'X-Content-Type-Options': 'nosniff'"],
  ['HEAD atendido', 'export async function HEAD'],
  ['limite de abuso', 'takeRateLimit'],
]) {
  confere(`a rota trata ${nome}`, rota.includes(trecho), `falta ${trecho}`);
}
confere(
  'o Content-Type vem do registro, não da URL',
  rota.includes('doc.contentType'),
  'a URL não tem extensão; deduzir tipo dela seria errado',
);

// ───────────── 6. A regra do Firestore concorda ─────────────

const regras = readFileSync(join(RAIZ, 'firestore.rules'), 'utf8');
const bloco = regras.slice(regras.indexOf('match /media/{mediaId}'), regras.indexOf('match /userFiles/'));

confere('existe regra para media', bloco.length > 0, 'não achei o bloco de media');
confere(
  'a visibilidade é amarrada ao tipo pela REGRA',
  bloco.includes("publicKind(request.resource.data.kind) ? 'public' : 'private'"),
  'sem isso o cliente escolheria publicar um anexo privado',
);
confere(
  'o caminho é confinado à pasta da própria pessoa',
  bloco.includes("matches('user_uploads/' + request.auth.uid + '/.*')"),
  'sem isso alguém registraria o objeto de outra pessoa e ganharia URL pública para ele',
);
confere(
  'só os sete campos previstos entram',
  bloco.includes("hasOnly(\n                 ['storagePath', 'contentType', 'size', 'ownerUid', 'visibility', 'kind', 'createdAt'])") ||
    /hasOnly\(\s*\n?\s*\['storagePath', 'contentType', 'size', 'ownerUid', 'visibility', 'kind', 'createdAt'\]\)/.test(bloco),
  'a lista de campos permitidos mudou',
);
confere('ninguém lista a coleção', /allow list: if false;/.test(bloco), 'listar daria um mapa de todas as mídias');
confere('ninguém apaga o registro', /allow delete: if false;/.test(bloco), 'sem o registro o tombstone se perde');
confere(
  'depois de criado só o tombstone muda',
  bloco.includes("hasOnly(['deletedAt'])"),
  'o registro precisa ser imutável fora do tombstone',
);
confere(
  'criar exige conta confirmada',
  bloco.includes('isVerifiedMember()'),
  'upload é acao social e exige a barreira',
);

// ───────────── 7. O upload usa a camada ─────────────

const upload = readFileSync(join(RAIZ, 'src', 'lib', 'services', 'mediaUploadService.ts'), 'utf8');
const uploadRoute = readFileSync(join(RAIZ, 'src', 'app', 'api', 'media', 'upload', 'route.ts'), 'utf8');
confere(
  'o servidor registra a mídia',
  uploadRoute.includes("collection('media').doc(mediaId).create"),
  'sem registro não existe URL própria',
);
confere(
  'a visibilidade gravada vem da função, não do cliente',
  uploadRoute.includes('visibilityForKind(kind)'),
  'o cliente não pode escolher a visibilidade',
);
confere(
  'só tipo público recebe a URL própria',
  /canBePublic\(kind\)[\s\S]{0,160}publicMediaUrl/.test(uploadRoute),
  'privado não pode receber URL pública',
);
confere(
  'o navegador envia para a API própria',
  upload.includes("request.open('POST', '/api/media/upload')"),
  'o navegador não pode usar a API do Firebase Storage, que cria token',
);
confere(
  'o servidor grava bytes pelo bucket administrativo',
  uploadRoute.includes('adminBucket().file(storagePath)') && uploadRoute.includes('await object.save(bytes'),
  'sem o caminho administrativo o Firebase volta a criar token automaticamente',
);

if (falhas) {
  console.log(`\n${falhas} falha(s) na camada de mídia.`);
  process.exit(1);
}
console.log('\nCamada de mídia OK: id opaco, privado fora do público, Range correto.');
