#!/usr/bin/env node
/**
 * Prova a migração da mídia PÚBLICA de ponta a ponta, nos emuladores.
 *   npm run emulators        (noutro terminal)
 *   node e2e/media-public-migration-emulators.mjs
 *
 * POR QUE NÃO BASTA O DRY-RUN EM PRODUÇÃO: o `reescrever` só mapeia se os registros `media/{id}` já existirem, e
 * criá-los em produção é gravar. Então a cadeia inteira — backup, registrar, reescrever, conferir, rodar de novo —
 * só pode ser provada aqui. São 3953 documentos de produção em jogo; provar a mecânica antes não é zelo, é o
 * mínimo.
 *
 * O que fica provado:
 *   1. cobertura dos seis lugares exigidos: post (mídia e avatar do autor), comentário, avatar, capa, conversa,
 *      notificação — e também a URL EMBUTIDA no HTML do post;
 *   2. troca por substring preserva o resto do HTML;
 *   3. mídia PRIVADA não é tocada pelo escopo público;
 *   4. referência a objeto inexistente fica intacta e é relatada;
 *   5. objeto órfão NÃO ganha registro;
 *   6. registro existente é REUTILIZADO, não duplicado;
 *   7. token do Storage é PRESERVADO — a URL pública antiga continua servindo;
 *   8. rodar de novo não muda nada (idempotência);
 *   9. `revogar` ABORTA no escopo público;
 *  10. restaurar do backup devolve exatamente os valores anteriores.
 *
 * Sai com código 1 se algo falhar. Limpa o que criou.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const PROJECT = 'demo-soberan';
const DATABASE = 'echo-db-124325';
const BUCKET = ['demo-soberan', 'appspot', 'com'].join('.');
const FS = `http://${process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'}`;
const GCS = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:9199'}`;
const ROOT = `projects/${PROJECT}/databases/${DATABASE}/documents`;
const MEDIA_ORIGIN = 'https://media.exercitodolula.app';
const HOST_ANTIGO = ['firebasestorage', 'googleapis', 'com'].join('.');

const h = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
let falhas = 0;
const confere = (nome, condicao, motivo, detalhe) => {
  if (condicao) console.log(`OK    ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo}`); }
};

async function chamar(metodo, url, corpo) {
  const r = await fetch(url, { method: metodo, headers: h, body: corpo ? JSON.stringify(corpo) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${url.replace(FS, '').replace(GCS, '')} -> ${r.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
const docRef = (p) => `${FS}/v1/${ROOT}/${p}`;
const ler = (p) => chamar('GET', docRef(p)).catch(() => null);
const gravar = (p, fields) => chamar('PATCH', docRef(p), { fields });
const apagar = (p) => chamar('DELETE', docRef(p)).catch(() => null);

// ───────────── espera os emuladores ─────────────

try {
  const r = await fetch(`${FS}/`);
  if (!r.ok && r.status !== 404) throw new Error(String(r.status));
} catch {
  console.log('FALHA emuladores não respondem em ' + FS);
  console.log('      rode `npm run emulators` noutro terminal e tente de novo.');
  process.exit(1);
}
try { await fetch(`${GCS}/`); } catch {
  console.log('FALHA emulador de Storage não responde em ' + GCS);
  process.exit(1);
}

// ───────────── helpers de Storage ─────────────

const urlAntiga = (caminho, token) =>
  `https://${HOST_ANTIGO}/v0/b/${BUCKET}/o/${encodeURIComponent(caminho)}?alt=media&token=${token}`;

/**
 * Sobe pelo endpoint do FIREBASE (`/v0/b/.../o?name=`), e não pelo do GCS, por dois motivos:
 * o emulador responde 501 a `PATCH /storage/v1/.../o/...`, então não há como gravar metadado depois; e este é o
 * caminho que a aplicação de verdade usa, que é justamente o que gera `firebaseStorageDownloadTokens` sozinho.
 * O token volta na resposta, e é o token REAL que a migração tem de preservar.
 */
async function subir(caminho, conteudo, contentType) {
  const r = await fetch(`${GCS}/v0/b/${BUCKET}/o?name=${encodeURIComponent(caminho)}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, Authorization: 'Bearer owner' },
    body: conteudo,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`upload ${caminho} -> ${r.status}: ${t.slice(0, 200)}`);
  const meta = JSON.parse(t);
  const token = (meta.downloadTokens ?? '').split(',')[0];
  if (!token) throw new Error(`o emulador não gerou token para ${caminho}`);
  return token;
}
/** Metadado pelo endpoint do Firebase: o do GCS não traz `downloadTokens` no emulador. */
const objeto = async (caminho) => {
  const r = await fetch(`${GCS}/v0/b/${BUCKET}/o/${encodeURIComponent(caminho)}`, { headers: h });
  if (!r.ok) return null;
  return r.json();
};
const apagarObjeto = (caminho) =>
  fetch(`${GCS}/v0/b/${BUCKET}/o/${encodeURIComponent(caminho)}`, { method: 'DELETE', headers: h })
    .catch(() => null);

// ───────────── o cenário ─────────────

const marca = `t${Date.now().toString(36)}`;
const DONO = `dono-${marca}`;
const OUTRO = `outro-${marca}`;

const C = {
  postMedia: `user_uploads/${DONO}/postMedia/images/post-${marca}.jpg`,
  avatar: `user_uploads/${DONO}/avatars/avatar-${marca}.webp`,
  capa: `user_uploads/${DONO}/covers/capa-${marca}.jpg`,
  comentario: `user_uploads/${OUTRO}/postMedia/images/comentario-${marca}.png`,
  embutida: `user_uploads/${DONO}/postMedia/images/dentro-do-html-${marca}.png`,
  jaRegistrada: `user_uploads/${DONO}/postMedia/images/ja-registrada-${marca}.jpg`,
  orfa: `user_uploads/${DONO}/postMedia/images/ninguem-usa-${marca}.jpg`,
  privada: `user_uploads/${DONO}/dms/images/anexo-${marca}.jpg`,
  inexistente: `user_uploads/${DONO}/postMedia/images/sumiu-${marca}.jpg`,
};
/** Preenchidos no `semear()`: o token vem do emulador, como em produção vem do Firebase. */
const TOKEN_DE = {};
const U = {};

const DOCS = {
  post: `posts/post-${marca}`,
  postHtml: `posts/html-${marca}`,
  postRegistrado: `posts/registrado-${marca}`,
  comentario: `comments/com-${marca}`,
  usuario: `users/${DONO}`,
  conversa: `conversations/${[DONO, OUTRO].sort().join('_')}`,
  notificacao: `notifications/not-${marca}`,
  mensagem: `${`conversations/${[DONO, OUTRO].sort().join('_')}`}/messages/msg-${marca}`,
  quebrada: `notifications/quebrada-${marca}`,
};

let HTML_ANTES = '';

const ID_PRE_REGISTRADO = 'PreRegistradoAbcdefghi';

async function semear() {
  for (const [k, caminho] of Object.entries(C)) {
    if (k === 'inexistente') {
      // Nunca sobe: é a referência cujo objeto não existe, e tem de ficar intacta.
      TOKEN_DE[k] = `tok-que-nao-existe-${marca}`;
    } else {
      TOKEN_DE[k] = await subir(caminho, `conteudo-${k}`, k === 'avatar' ? 'image/webp' : 'image/jpeg');
    }
    U[k] = urlAntiga(caminho, TOKEN_DE[k]);
  }

  HTML_ANTES =
    `<p>Texto antes da imagem.</p><figure><img src="${U.embutida}" alt="foto"></figure>` +
    '<p>Texto <strong>depois</strong>, com &amp; entidade e um link <a href="https://exemplo.test">aqui</a>.</p>';

  await gravar(DOCS.post, {
    text: { stringValue: 'post com midia anexada' },
    media: { arrayValue: { values: [{ mapValue: { fields: {
      url: { stringValue: U.postMedia }, type: { stringValue: 'image' },
    } } }] } },
    authorDetails: { mapValue: { fields: { avatarUrl: { stringValue: U.avatar } } } },
  });
  await gravar(DOCS.postHtml, { text: { stringValue: HTML_ANTES } });
  await gravar(DOCS.postRegistrado, {
    media: { arrayValue: { values: [{ mapValue: { fields: {
      url: { stringValue: U.jaRegistrada }, type: { stringValue: 'image' },
    } } }] } },
  });
  await gravar(DOCS.comentario, {
    media: { arrayValue: { values: [{ mapValue: { fields: { url: { stringValue: U.comentario } } } }] } },
  });
  await gravar(DOCS.usuario, {
    avatarUrl: { stringValue: U.avatar },
    coverImageUrl: { stringValue: U.capa },
  });
  await gravar(DOCS.conversa, {
    participantIds: { arrayValue: { values: [{ stringValue: DONO }, { stringValue: OUTRO }] } },
    participantsInfo: { arrayValue: { values: [
      { mapValue: { fields: { uid: { stringValue: DONO }, avatarUrl: { stringValue: U.avatar } } } },
      { mapValue: { fields: { uid: { stringValue: OUTRO }, avatarUrl: { stringValue: U.comentario } } } },
    ] } },
  });
  await gravar(DOCS.notificacao, {
    actors: { arrayValue: { values: [{ mapValue: { fields: { avatarUrl: { stringValue: U.avatar } } } }] } },
  });
  await gravar(DOCS.mensagem, { fileUrl: { stringValue: U.privada }, senderId: { stringValue: DONO } });
  await gravar(DOCS.quebrada, {
    actors: { arrayValue: { values: [{ mapValue: { fields: { avatarUrl: { stringValue: U.inexistente } } } }] } },
  });

  // Registro que JÁ existe: a fase registrar tem de reutilizá-lo, não criar um segundo para o mesmo caminho.
  await gravar(`media/${ID_PRE_REGISTRADO}`, {
    storagePath: { stringValue: C.jaRegistrada },
    contentType: { stringValue: 'image/jpeg' },
    size: { integerValue: '14' },
    ownerUid: { stringValue: DONO },
    visibility: { stringValue: 'public' },
    kind: { stringValue: 'postMedia' },
    createdAt: { timestampValue: new Date().toISOString() },
  });
}

/**
 * Limpa por PREFIXO de uid, não pela marca desta execução. Uma execução que falhe no meio deixa objeto para trás, e
 * no emulador esse resto vira "órfão" na execução seguinte — o que quebra a asserção de contagem de órfãos por um
 * motivo que não é defeito do código. Varrer `dono-t…` e `outro-t…` limpa o resto de qualquer execução.
 */
const DO_TESTE = (caminho) => /^user_uploads\/(dono|outro)-t[0-9a-z]+\//.test(caminho);

async function limpar() {
  for (const p of Object.values(DOCS)) await apagar(p);

  const pagina = await fetch(
    `${GCS}/storage/v1/b/${BUCKET}/o?prefix=user_uploads/&maxResults=1000`,
    { headers: h },
  ).then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] }));
  for (const item of pagina.items ?? []) {
    if (DO_TESTE(item.name)) await apagarObjeto(item.name);
  }

  const regs = await chamar('POST', `${FS}/v1/${ROOT}:runQuery`, {
    structuredQuery: { from: [{ collectionId: 'media', allDescendants: true }], limit: 500 },
  }).catch(() => []);
  for (const l of regs ?? []) {
    const nome = l.document?.name;
    if (!nome) continue;
    const caminho = l.document.fields?.storagePath?.stringValue ?? '';
    if (DO_TESTE(caminho) || nome.endsWith(ID_PRE_REGISTRADO)) {
      await chamar('DELETE', `${FS}/v1/${nome}`).catch(() => {});
    }
  }

  // Documentos de execuções anteriores que ficaram para trás.
  for (const colecao of ['users', 'posts', 'comments', 'conversations', 'notifications']) {
    const docs = await chamar('POST', `${FS}/v1/${ROOT}:runQuery`, {
      structuredQuery: { from: [{ collectionId: colecao }], limit: 300 },
    }).catch(() => []);
    for (const l of docs ?? []) {
      const nome = l.document?.name ?? '';
      if (/\/(users|posts|comments|conversations|notifications)\/[^/]*t[0-9a-z]{8,}/.test(nome) &&
          /(dono-t|outro-t|post-t|html-t|registrado-t|com-t|not-t|quebrada-t|conflitante-t|tranquilo-t)/.test(nome)) {
        await chamar('DELETE', `${FS}/v1/${nome}`).catch(() => {});
      }
    }
  }
}

// ───────────── roda o script ─────────────

const SAIDA = mkdtempSync(join(tmpdir(), 'midia-publica-'));
function rodar(args, extraEnv = {}) {
  return execFileSync(process.execPath, [join(RAIZ, 'scripts', 'migrar-tokens-midia.mjs'), ...args], {
    cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FIRESTORE_EMULATOR_HOST: FS.replace('http://', ''),
      FIREBASE_STORAGE_EMULATOR_HOST: GCS.replace('http://', ''), ...extraEnv },
  });
}
function rodarEsperandoFalha(args, extraEnv = {}) {
  try { rodar(args, extraEnv); return { ok: true, saida: '' }; }
  catch (erro) { return { ok: false, saida: `${erro.stdout ?? ''}${erro.stderr ?? ''}` }; }
}

/** Roda em segundo plano, para o teste poder escrever no banco enquanto o script está entre a leitura e o commit. */
function rodarEmParalelo(args, extraEnv = {}) {
  return new Promise((resolve) => {
    const filho = spawn(process.execPath, [join(RAIZ, 'scripts', 'migrar-tokens-midia.mjs'), ...args], {
      cwd: RAIZ,
      env: { ...process.env, FIRESTORE_EMULATOR_HOST: FS.replace('http://', ''),
        FIREBASE_STORAGE_EMULATOR_HOST: GCS.replace('http://', ''), ...extraEnv },
    });
    let saida = '';
    filho.stdout.on('data', (d) => { saida += d; });
    filho.stderr.on('data', (d) => { saida += d; });
    filho.on('close', (codigo) => resolve({ codigo, saida }));
  });
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const textoNo = (doc, caminho) => {
  const partes = caminho.match(/[^.[\]]+/g) ?? [];
  let atual = { mapValue: { fields: doc?.fields } };
  for (const parte of partes) {
    atual = /^\d+$/.test(parte) ? atual?.arrayValue?.values?.[Number(parte)] : atual?.mapValue?.fields?.[parte];
    if (atual === undefined) return undefined;
  }
  return atual?.stringValue;
};

try {
  await limpar();
  await semear();
  console.log(`cenário semeado (marca ${marca})\n`);

  // ── backup ──
  const saidaBackup = rodar(['--fase=backup', '--escopo=publico', '--aplicar', `--saida=${SAIDA}`]);
  confere('o alvo exclui a referência sem objeto',
    /fora do alvo por objeto inexistente: 1 referências/.test(saidaBackup),
    `esperava 1 fora do alvo:\n${saidaBackup.split('\n').filter((l) => l.includes('alvo')).join('\n')}`);
  confere('o alvo inclui a URL embutida no HTML',
    /do alvo, 1 estão EMBUTIDAS/.test(saidaBackup), 'a embutida não entrou no alvo');
  confere('o backup diz o tamanho antes de gravar', /tamanho do corpo \.+ \d/.test(saidaBackup), 'sem tamanho');
  const arquivoBackup = readdirSync(SAIDA).find((n) => n.startsWith('backup-midia-'));
  confere('o backup foi gravado fora do repositório', Boolean(arquivoBackup), 'arquivo não encontrado', arquivoBackup);

  // ── registrar ──
  const saidaRegistrar = rodar(['--fase=registrar', '--escopo=publico', '--aplicar', `--saida=${SAIDA}`]);
  confere('registrar REUTILIZA o registro que já existia',
    /registros reutilizados: 1/.test(saidaRegistrar), saidaRegistrar.split('\n').filter((l) => l.includes('reutiliz')).join(''));
  confere('registrar deixa o órfão de fora, e diz que é por falta de referência',
    /órfãos deixados de fora: 1 \(sem referência e sem registro\)/.test(saidaRegistrar),
    saidaRegistrar.split('\n').filter((l) => l.includes('órfão')).join(''));
  confere('registrar separa "órfão" de "fora deste escopo"',
    /fora deste escopo: 1/.test(saidaRegistrar),
    'o anexo privado não é órfão: ele é referenciado, só não por este escopo — juntar os dois esconde os dois');
  const regs1 = await chamar('POST', `${FS}/v1/${ROOT}:runQuery`, {
    structuredQuery: { from: [{ collectionId: 'media', allDescendants: true }], limit: 500 },
  });
  const porCaminho = new Map();
  for (const l of regs1 ?? []) {
    if (!l.document) continue;
    const c = l.document.fields?.storagePath?.stringValue;
    if (c?.includes(marca)) porCaminho.set(c, l.document);
  }
  confere('o objeto órfão NÃO recebeu registro', !porCaminho.has(C.orfa), 'órfão registrado é órfão dado por administrado');
  confere('a mídia privada NÃO recebeu registro neste escopo', !porCaminho.has(C.privada), 'o escopo público tocou o privado');
  confere('só um registro por caminho já registrado',
    (regs1 ?? []).filter((l) => l.document?.fields?.storagePath?.stringValue === C.jaRegistrada).length === 1,
    'registro duplicado para o mesmo objeto');
  for (const [nome, caminho] of [
    ['mídia de post', C.postMedia], ['avatar', C.avatar], ['capa', C.capa],
    ['mídia de comentário', C.comentario], ['embutida no HTML', C.embutida],
  ]) {
    const reg = porCaminho.get(caminho);
    confere(`registro criado para ${nome}`, Boolean(reg), 'faltou registro');
    if (reg) {
      confere(`  ${nome}: visibilidade pública`, reg.fields?.visibility?.stringValue === 'public',
        `veio ${reg.fields?.visibility?.stringValue}`);
      confere(`  ${nome}: dono é o do caminho`, reg.fields?.ownerUid?.stringValue === caminho.split('/')[1],
        `veio ${reg.fields?.ownerUid?.stringValue}`);
    }
  }

  // ── reescrever ──
  const mapaArquivo = join(SAIDA, 'mapa.jsonl');
  const saidaReescrever = rodar(['--fase=reescrever', '--escopo=publico', '--aplicar', `--mapa=${mapaArquivo}`, `--saida=${SAIDA}`]);
  confere('cobertura total do escopo público', /COBERTURA TOTAL do escopo publico/.test(saidaReescrever),
    saidaReescrever.split('\n').filter((l) => l.includes('trocada') || l.includes('COBERTURA')).join(' | '));
  confere('o mapeamento um a um foi gravado', readdirSync(SAIDA).includes('mapa.jsonl'), 'sem mapa');

  const idDe = (caminho) => porCaminho.get(caminho).name.split('/').pop();
  const novaDe = (caminho) => `${MEDIA_ORIGIN}/m/${idDe(caminho)}`;

  for (const [nome, documento, campo, caminho] of [
    ['post · mídia', DOCS.post, 'media[0].url', C.postMedia],
    ['post · avatar do autor', DOCS.post, 'authorDetails.avatarUrl', C.avatar],
    ['comentário · mídia', DOCS.comentario, 'media[0].url', C.comentario],
    ['usuário · avatar', DOCS.usuario, 'avatarUrl', C.avatar],
    ['usuário · capa', DOCS.usuario, 'coverImageUrl', C.capa],
    ['conversa · avatar do participante', DOCS.conversa, 'participantsInfo[0].avatarUrl', C.avatar],
    ['notificação · avatar do ator', DOCS.notificacao, 'actors[0].avatarUrl', C.avatar],
    ['post já registrado · reutiliza o id', DOCS.postRegistrado, 'media[0].url', C.jaRegistrada],
  ]) {
    const doc = await ler(documento);
    confere(`COBERTURA · ${nome}`, textoNo(doc, campo) === novaDe(caminho),
      `veio ${String(textoNo(doc, campo)).slice(0, 70)}`);
  }
  confere('post já registrado aponta para o id PRÉ-EXISTENTE',
    textoNo(await ler(DOCS.postRegistrado), 'media[0].url') === `${MEDIA_ORIGIN}/m/${ID_PRE_REGISTRADO}`,
    'criou id novo em vez de reutilizar');

  // ── embutida: substring, resto do HTML intacto ──
  const htmlDepois = textoNo(await ler(DOCS.postHtml), 'text');
  confere('EMBUTIDA · a URL antiga saiu do HTML', !htmlDepois.includes(HOST_ANTIGO), 'a URL antiga ficou');
  confere('EMBUTIDA · a URL nova entrou no HTML', htmlDepois.includes(novaDe(C.embutida)), 'a URL nova não entrou');
  confere('EMBUTIDA · o resto do HTML está intacto',
    htmlDepois === HTML_ANTES.replace(U.embutida, novaDe(C.embutida)),
    'o HTML mudou além da URL — trocar o valor inteiro apagaria o post');
  confere('EMBUTIDA · a entidade &amp; sobreviveu', htmlDepois.includes('&amp; entidade'), 'entidade corrompida');
  confere('EMBUTIDA · o link de terceiro sobreviveu', htmlDepois.includes('https://exemplo.test'), 'link perdido');

  const inventarioDepois = rodar(['--fase=inventario', '--escopo=publico']);
  confere('INVENTÁRIO PÓS-MIGRAÇÃO · URL própria embutida continua contando como referência',
    /registrado SEM referência de conteúdo\s+0/.test(inventarioDepois),
    inventarioDepois.split('\n').filter((l) => l.includes('registrado SEM')).join(''));

  // ── o que NÃO deve mudar ──
  confere('PRESERVADO · mídia privada intacta',
    textoNo(await ler(DOCS.mensagem), 'fileUrl') === U.privada, 'o escopo público mexeu no anexo privado');
  confere('PRESERVADO · referência a objeto inexistente intacta',
    textoNo(await ler(DOCS.quebrada), 'actors[0].avatarUrl') === U.inexistente,
    'reescrever o que não tem objeto aponta para um 404');
  for (const [nome, chave] of [['mídia de post', 'postMedia'], ['avatar', 'avatar'], ['capa', 'capa']]) {
    const o = await objeto(C[chave]);
    confere(`PRESERVADO · token do Storage de ${nome}`,
      (o?.downloadTokens ?? '').split(',').includes(TOKEN_DE[chave]),
      `o token mudou: a URL pública antiga pararia de servir (veio ${o?.downloadTokens ?? 'nada'})`);
    // A URL gravada tem o host de produção, que não existe aqui. O que se prova é o MECANISMO: o mesmo caminho e o
    // mesmo token continuam servindo depois da reescrita.
    const equivalente = `${GCS}/v0/b/${BUCKET}/o/${encodeURIComponent(C[chave])}?alt=media&token=${TOKEN_DE[chave]}`;
    const servindo = await fetch(equivalente);
    servindo.body?.cancel?.();
    confere(`PRESERVADO · caminho+token ANTIGOS de ${nome} ainda servem`, servindo.status === 200,
      `veio ${servindo.status}: compartilhamento externo antigo quebraria`);
  }

  // ── idempotência ──
  const r2Registrar = rodar(['--fase=registrar', '--escopo=publico', '--aplicar', `--saida=${SAIDA}`]);
  confere('IDEMPOTENTE · registrar de novo não cria nada', /a registrar: 0/.test(r2Registrar),
    r2Registrar.split('\n').filter((l) => l.includes('a registrar')).join(''));
  const r2Reescrever = rodar(['--fase=reescrever', '--escopo=publico', '--aplicar', `--saida=${SAIDA}`]);
  confere('IDEMPOTENTE · reescrever de novo não troca nada',
    /alvo desta fase \(escopo publico\): 0 referências/.test(r2Reescrever),
    r2Reescrever.split('\n').filter((l) => l.includes('alvo desta fase')).join(''));
  confere('IDEMPOTENTE · o HTML não mudou na segunda passada',
    textoNo(await ler(DOCS.postHtml), 'text') === htmlDepois, 'a segunda passada alterou o HTML');

  // ── revogar tem de abortar ──
  const revogarPublico = rodarEsperandoFalha(['--fase=revogar', '--escopo=publico', '--aplicar']);
  confere('revogar ABORTA no escopo público', !revogarPublico.ok &&
    /só existe para --escopo=privado/.test(revogarPublico.saida),
    'revogar aceitou escopo público: destruiria token que preserva compartilhamento externo');
  const revogarTudo = rodarEsperandoFalha(['--fase=revogar', '--escopo=tudo', '--aplicar']);
  confere('revogar ABORTA no escopo tudo', !revogarTudo.ok, 'escopo tudo abriria caminho para revogar público');

  // ── CONFLITO: edição concorrente durante a migração ──
  //
  // O caso que `currentDocument: { exists: true }` não pegava: entre a leitura e o commit a pessoa troca o avatar.
  // Com `exists` a pré-condição passa e a migração regrava o campo raiz LIDO ANTES, desfazendo a troca em silêncio.
  //
  // Para reproduzir de forma determinística, o script pausa antes do primeiro commit (seam que só existe fora de
  // produção) e o teste escreve nesse intervalo.
  const CONFLITO = `user_uploads/${DONO}/avatars/conflito-${marca}.webp`;
  const tokenConflito = await subir(CONFLITO, 'conteudo-conflito', 'image/webp');
  const urlConflito = urlAntiga(CONFLITO, tokenConflito);
  const DOC_CONFLITO = `users/conflitante-${marca}`;
  const DOC_TRANQUILO = `users/tranquilo-${marca}`;
  DOCS.conflito = DOC_CONFLITO;
  DOCS.tranquilo = DOC_TRANQUILO;
  await gravar(DOC_CONFLITO, { avatarUrl: { stringValue: urlConflito }, name: { stringValue: 'antes' } });
  await gravar(DOC_TRANQUILO, { avatarUrl: { stringValue: urlConflito } });

  rodar(['--fase=registrar', '--escopo=publico', '--aplicar', `--saida=${SAIDA}`]);
  const ESCOLHA_DA_PESSOA = 'https://exemplo.test/avatar-escolhido-pela-pessoa.png';
  const corrida = rodarEmParalelo(
    ['--fase=reescrever', '--escopo=publico', '--aplicar', `--saida=${SAIDA}`],
    { MIGRAR_MIDIA_PAUSA_MS: '4000' },
  );
  await esperar(2500);
  // A pessoa troca o avatar DEPOIS da leitura da migração e ANTES do commit.
  await chamar('PATCH', `${docRef(DOC_CONFLITO)}?updateMask.fieldPaths=avatarUrl`, {
    fields: { avatarUrl: { stringValue: ESCOLHA_DA_PESSOA } },
  });
  const resultadoCorrida = await corrida;

  confere('CONFLITO · a fase aborta com código de erro', resultadoCorrida.codigo === 1,
    `saiu com ${resultadoCorrida.codigo}: seguir depois de uma leitura desatualizada é gravar às cegas`);
  confere('CONFLITO · diz que foi escrita concorrente',
    /ABORTADO por escrita concorrente no lote/.test(resultadoCorrida.saida), 'o operador não saberia o motivo');
  confere('CONFLITO · diz que nada do lote foi gravado',
    /Nada deste lote foi gravado \(o commit é atômico\)/.test(resultadoCorrida.saida), 'falta a garantia explícita');
  confere('CONFLITO · lista o documento afetado',
    /Documentos alterados desde a leitura: 1/.test(resultadoCorrida.saida) &&
      /· alterado · lido /.test(resultadoCorrida.saida),
    `não listou o documento:\n${resultadoCorrida.saida.split('\n').filter((l) => l.includes('Documentos') || l.includes('alterado')).join('\n')}`);
  confere('CONFLITO · lista com o documento pseudonimizado',
    !resultadoCorrida.saida.includes(DOC_CONFLITO.split('/')[1]),
    'o relatório de conflito não deve despejar o id real do documento');
  confere('CONFLITO · manda rodar a mesma fase de novo',
    /Rode a MESMA fase de novo/.test(resultadoCorrida.saida), 'falta a instrução de retomada');

  confere('CONFLITO · a escolha da PESSOA sobreviveu',
    textoNo(await ler(DOC_CONFLITO), 'avatarUrl') === ESCOLHA_DA_PESSOA,
    'é exatamente o que a pré-condição existe para impedir');
  confere('CONFLITO · o campo vizinho não foi revertido',
    textoNo(await ler(DOC_CONFLITO), 'name') === 'antes', 'o campo raiz inteiro não pode voltar ao estado lido');
  confere('CONFLITO · o documento tranquilo do MESMO lote também não foi gravado',
    textoNo(await ler(DOC_TRANQUILO), 'avatarUrl') === urlConflito,
    'o commit é atômico: um conflito tem de abortar o lote inteiro, não parte dele');

  // ── RETOMADA idempotente depois do conflito ──
  const retomada = rodar(['--fase=reescrever', '--escopo=publico', '--aplicar', `--saida=${SAIDA}`]);
  const idConflito = (await chamar('POST', `${FS}/v1/${ROOT}:runQuery`, {
    structuredQuery: { from: [{ collectionId: 'media', allDescendants: true }], limit: 500 },
  })).filter((l) => l.document?.fields?.storagePath?.stringValue === CONFLITO)
    .map((l) => l.document.name.split('/').pop())[0];
  confere('RETOMADA · a segunda execução completa sem conflito',
    !/ABORTADO/.test(retomada) && /COBERTURA TOTAL/.test(retomada),
    retomada.split('\n').filter((l) => l.includes('trocada') || l.includes('ABORT')).join(' | '));
  confere('RETOMADA · o documento tranquilo foi migrado agora',
    textoNo(await ler(DOC_TRANQUILO), 'avatarUrl') === `${MEDIA_ORIGIN}/m/${idConflito}`,
    'o que o conflito impediu tem de ser retomado');
  confere('RETOMADA · a escolha da pessoa continua intacta',
    textoNo(await ler(DOC_CONFLITO), 'avatarUrl') === ESCOLHA_DA_PESSOA,
    'a retomada não pode reintroduzir a reescrita: aquela URL já não é mais legada');
  confere('RETOMADA · não cria registro novo para o mesmo objeto',
    (await chamar('POST', `${FS}/v1/${ROOT}:runQuery`, {
      structuredQuery: { from: [{ collectionId: 'media', allDescendants: true }], limit: 500 },
    })).filter((l) => l.document?.fields?.storagePath?.stringValue === CONFLITO).length === 1,
    'id novo para objeto já registrado faria duas URLs servirem o mesmo arquivo');

  // ── MANIFESTO ──
  const nomeManifesto = readdirSync(SAIDA).find((n) => n.startsWith('manifesto-midia-'));
  confere('MANIFESTO · foi gravado pelo registrar', Boolean(nomeManifesto), 'sem manifesto não há auditoria',
    nomeManifesto);
  if (nomeManifesto) {
    const linhasManifesto = readFileSync(join(SAIDA, nomeManifesto), 'utf8').split('\n').filter((l) => l.trim());
    const cab = JSON.parse(linhasManifesto[0]);
    const corpoManifesto = linhasManifesto.slice(1);
    confere('MANIFESTO · cabeçalho identifica o tipo, o projeto e o escopo',
      cab.tipo === 'manifesto-registros-midia' && cab.projeto === PROJECT && cab.escopo === 'publico',
      JSON.stringify({ tipo: cab.tipo, projeto: cab.projeto, escopo: cab.escopo }));
    confere('MANIFESTO · a contagem casa com as linhas',
      cab.registros === corpoManifesto.length, `${cab.registros} contra ${corpoManifesto.length}`);
    confere('MANIFESTO · o sha256 do corpo confere',
      createHash('sha256').update(corpoManifesto.join('\n')).digest('hex') === cab.sha256,
      'manifesto de auditoria sem integridade não serve de auditoria');
    confere('MANIFESTO · registra quantos registros foram reutilizados',
      typeof cab.reutilizados === 'number', 'a reconciliação precisa separar criado de preexistente');
    const primeira = JSON.parse(corpoManifesto[0]);
    confere('MANIFESTO · cada linha tem id, caminho, dono, tipo, visibilidade e tamanho',
      ['id', 'storagePath', 'ownerUid', 'kind', 'visibility', 'size', 'contentType', 'createdAt']
        .every((c) => primeira[c] !== undefined),
      `campos: ${Object.keys(primeira).join(', ')}`);
    confere('MANIFESTO · todo id do manifesto existe em media/',
      (await Promise.all(corpoManifesto.map(async (l) => Boolean(await ler(`media/${JSON.parse(l).id}`)))))
        .every(Boolean),
      'manifesto que lista registro inexistente desorienta a reconciliação');
    confere('MANIFESTO · não inclui o registro que já existia',
      !corpoManifesto.some((l) => JSON.parse(l).id === ID_PRE_REGISTRADO),
      'o manifesto é dos registros CRIADOS por esta migração');
  }

  // ── restaurar ──
  const restaurado = rodar(['--fase=restaurar', `--de=${join(SAIDA, arquivoBackup)}`, '--aplicar']);
  confere('o backup prova integridade antes de restaurar', /integridade OK/.test(restaurado), 'sem conferência');
  confere('RESTAURAR · a mídia do post voltou ao valor anterior',
    textoNo(await ler(DOCS.post), 'media[0].url') === U.postMedia, 'não voltou');
  confere('RESTAURAR · o HTML voltou byte a byte',
    textoNo(await ler(DOCS.postHtml), 'text') === HTML_ANTES, 'o HTML restaurado difere do original');
  confere('RESTAURAR · o avatar do usuário voltou',
    textoNo(await ler(DOCS.usuario), 'avatarUrl') === U.avatar, 'não voltou');
  confere('RESTAURAR · é por substituição inversa, e relata o que não tocou',
    /mudaram depois \(NÃO tocadas\)/.test(restaurado) && /referências a reverter/.test(restaurado),
    'reversão parcial silenciosa é pior que reversão que falha');

  // Reversão rodada DUAS vezes tem de ser inócua, e não pode reverter o que mudou depois.
  const DEPOIS_DA_MIGRACAO = 'https://exemplo.test/trocado-depois-da-migracao.png';
  await chamar('PATCH', `${docRef(DOCS.usuario)}?updateMask.fieldPaths=coverImageUrl`, {
    fields: { coverImageUrl: { stringValue: DEPOIS_DA_MIGRACAO } },
  });
  const segundaReversao = rodar(['--fase=restaurar', `--de=${join(SAIDA, arquivoBackup)}`, '--aplicar']);
  confere('RESTAURAR · rodar de novo não desfaz mudança POSTERIOR',
    textoNo(await ler(DOCS.usuario), 'coverImageUrl') === DEPOIS_DA_MIGRACAO,
    'é o motivo de não regravar o campo raiz do backup');
  confere('RESTAURAR · a segunda passada reconhece o que já estava revertido',
    /já estavam no valor anterior . \d/.test(segundaReversao) || /já estavam no valor anterior/.test(segundaReversao),
    'sem isso a segunda reversão pareceria falha');
  confere('RESTAURAR · e relata a que mudou depois',
    /mudaram depois \(NÃO tocadas\) . [1-9]/.test(segundaReversao),
    segundaReversao.split('\n').filter((l) => l.includes('mudaram')).join(''));
} finally {
  await limpar();
  rmSync(SAIDA, { recursive: true, force: true });
  console.log('\nlimpeza: documentos, objetos, registros e backup temporário removidos.');
}

if (falhas) { console.log(`\n${falhas} falha(s).`); process.exit(1); }
console.log('\nMigração pública provada de ponta a ponta: cobertura, substring, preservação, idempotência e volta.');
