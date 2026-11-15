#!/usr/bin/env node
/**
 * TESTE REAL do pipeline de vídeo em PRODUÇÃO, com contas descartáveis e reversão completa.
 *
 *   node scripts/validar-video-producao.mjs --producao [--manter]
 *
 * Usa FIRESTORE_ACCESS_TOKEN quando fornecido e o renova pelo gcloud antes de expirar. GCLOUD_ACCOUNT escolhe a conta.
 *
 * O que exercita, pela interface real (Chrome sem tela) e pelas APIs que ela chama:
 *   vídeo curto em post, comentário, citação, mensagem (chat) e arquivo pessoal ("Arquivos": a tela ainda é um aviso, então
 *   vai pela mesma API de envio); vídeo INVÁLIDO; acesso anônimo, de terceiro e do dono; exclusão; e o que NÃO dá para provar
 *   no emulador: o FFmpeg no Cloud Run Job, o objeto sem token no GCS real e a purga do bucket pelas Functions.
 *
 * Nenhum e-mail sai. No fim apaga as contas, os documentos, os registros e os objetos, e confere que o contador de vagas ficou igual.
 * Com --manter nada é apagado (para investigar), e o roteiro avisa o que ficou.
 *
 * Contas: criadas pela API administrativa (e-mail confirmado, claim de membro e os documentos do perfil), SEM passar pelo cadastro
 * público (App Check + vagas dos 500 primeiros): o contador de vagas nem é tocado, e o roteiro confere isso no fim. Depois
 * entram pela tela de login.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
// As capturas de tela são evidência do teste, não parte do repositório: vão para uma pasta de fora dele.
const SAIDA = process.env.VALIDACAO_SAIDA ?? tmpdir();
const PROJECT = 'echo-b5aw9';
const DATABASE = 'echo-db-124325';
const BUCKET = 'echo-b5aw9.firebasestorage.app';
const SITE = 'https://exercitodolula.app';
const REGION = 'southamerica-east1';
const PRODUCAO = process.argv.includes('--producao');
const MANTER = process.argv.includes('--manter');
const argumentosPermitidos = new Set(['--producao', '--manter']);
const argumentosDesconhecidos = process.argv.slice(2).filter((arg) => !argumentosPermitidos.has(arg));
if (!PRODUCAO || argumentosDesconhecidos.length) {
  throw new Error(
    `uso: node scripts/validar-video-producao.mjs --producao [--manter]${
      argumentosDesconhecidos.length ? `; argumento(s) desconhecido(s): ${argumentosDesconhecidos.join(', ')}` : ''
    }`,
  );
}
let tokenAtual = process.env.FIRESTORE_ACCESS_TOKEN || null;
let tokenObtidoEm = Date.now();
const GCLOUD = process.env.GCLOUD_BIN || (
  process.platform === 'win32'
    ? 'C:/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd'
    : 'gcloud'
);
const KEY = readFileSync(join(RAIZ, 'apphosting.yaml'), 'utf8').match(/NEXT_PUBLIC_FIREBASE_API_KEY\s*\r?\n\s*value:\s*"?([^"\r\n]+)"?/)?.[1];
if (!KEY) throw new Error('chave web do Firebase não encontrada em apphosting.yaml');
const PLAYWRIGHT = process.env.E2E_NODE_MODULES ?? 'E:/Soberan/tools/e2e/node_modules';
const CHROME = process.env.E2E_BROWSER ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const stamp = Date.now().toString(36);
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/documents`;
const H = { Authorization: '', 'x-goog-user-project': PROJECT, 'Content-Type': 'application/json' };
/** OAuth do operador dura cerca de uma hora; renova antes de cada etapa para a reversão nunca ficar sem credencial. */
const garantirTokenAtual = (forcar = false) => {
  if (!forcar && tokenAtual && Date.now() - tokenObtidoEm < 40 * 60_000) {
    H.Authorization = `Bearer ${tokenAtual}`;
    return tokenAtual;
  }
  const argumentos = ['auth', 'print-access-token', '--project', PROJECT];
  if (process.env.GCLOUD_ACCOUNT) {
    if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$/.test(process.env.GCLOUD_ACCOUNT)) {
      throw new Error('GCLOUD_ACCOUNT inválida');
    }
    argumentos.push(`--account=${process.env.GCLOUD_ACCOUNT}`);
  }
  const executavel = process.platform === 'win32' ? `"${GCLOUD}"` : GCLOUD;
  tokenAtual = execFileSync(executavel, argumentos, {
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32',
  }).trim();
  if (!tokenAtual) throw new Error('gcloud não devolveu um token de acesso');
  tokenObtidoEm = Date.now();
  H.Authorization = `Bearer ${tokenAtual}`;
  return tokenAtual;
};
garantirTokenAtual(!tokenAtual);
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────────── relato ─────────────
let falhas = 0;
let verificacoes = 0;
let interrupcaoSolicitada = null;
const ok = (cond, rotulo, detalhe = '') => {
  verificacoes++;
  if (!cond) falhas++;
  console.log(`${cond ? 'OK   ' : 'FALHA'} ${rotulo}${detalhe ? ` (${detalhe})` : ''}`);
  return Boolean(cond);
};
const nota = (texto) => console.log(`      ${texto}`);
const secao = (titulo) => console.log(`\n=== ${titulo}`);
const etapa = async (rotulo, fn) => {
  if (interrupcaoSolicitada) throw new Error(`execucao interrompida por ${interrupcaoSolicitada}`);
  try {
    garantirTokenAtual();
    const resultado = await fn();
    if (interrupcaoSolicitada) throw new Error(`execucao interrompida por ${interrupcaoSolicitada}`);
    return resultado;
  } catch (erro) {
    if (interrupcaoSolicitada) throw erro;
    falhas++; verificacoes++;
    console.log(`FALHA ${rotulo} — exceção: ${String(erro?.message ?? erro).split('\n')[0].slice(0, 260)}`);
    return null;
  }
};

// ───────────── Firestore (REST, como administrador) ─────────────
const plano = (v) => {
  if (v === undefined || v === null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(plano);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, plano(x)]));
  return v;
};
const docPlano = (d) => ({ __id: d.name.split('/').pop(), ...Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, v]) => [k, plano(v)])) });
const fsGet = async (caminho) => {
  const r = await fetch(`${FS}/${caminho}`, { headers: H });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`ler ${caminho}: HTTP ${r.status}`);
  return docPlano(await r.json());
};
const fsList = async (caminho, limite = 100) => {
  const r = await fetch(`${FS}/${caminho}?pageSize=${limite}`, { headers: H });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`listar ${caminho}: HTTP ${r.status}`);
  return ((await r.json()).documents ?? []).map(docPlano);
};
const fsQuery = async (colecao, campo, valor, limite = 50) => {
  const corpo = { structuredQuery: { from: [{ collectionId: colecao }], where: { fieldFilter: { field: { fieldPath: campo }, op: 'EQUAL', value: { stringValue: valor } } }, limit: limite } };
  const r = await fetch(`${FS}:runQuery`, { method: 'POST', headers: H, body: JSON.stringify(corpo) });
  if (!r.ok) throw new Error(`consulta em ${colecao}.${campo}: HTTP ${r.status}`);
  return (await r.json()).filter((x) => x.document).map((x) => docPlano(x.document));
};
const fsApagar = async (caminho) => {
  const r = await fetch(`${FS}/${caminho}`, { method: 'DELETE', headers: H });
  if (r.ok) return true;
  if (r.status === 404) return false;
  throw new Error(`apagar ${caminho}: HTTP ${r.status}`);
};
/** Consulta que NUNCA devolve "vazio" por causa de um erro: na verificação final, erro não pode virar "limpo". */
const fsQueryEstrita = async (colecao, campo, valor, operador = 'EQUAL') => {
  const corpo = { structuredQuery: { from: [{ collectionId: colecao }], where: { fieldFilter: { field: { fieldPath: campo }, op: operador, value: { stringValue: valor } } }, limit: 200 } };
  const r = await fetch(`${FS}:runQuery`, { method: 'POST', headers: H, body: JSON.stringify(corpo) });
  if (!r.ok) throw new Error(`consulta em ${colecao}.${campo} falhou: HTTP ${r.status}`);
  return (await r.json()).filter((x) => x.document).map((x) => docPlano(x.document));
};
const fsQueryContem = (colecao, campo, valor) => fsQueryEstrita(colecao, campo, valor, 'ARRAY_CONTAINS');
/** Só se apaga o que tem o UID ou o id de um dado deste teste no caminho (defesa contra um id vazio virar "apague tudo"). */
const marcasDoTeste = new Set();
const caminhoDoTeste = (caminho) => {
  const partes = caminho.split('/');
  if (partes.some((p) => !p || p === 'undefined' || p === 'null')) return false;
  return partes.some((p) => marcasDoTeste.has(p));
};
/** Apaga um documento e TUDO o que há abaixo dele (subcoleções, inclusive de documentos "fantasma"). Devolve quantos apagou. */
async function apagarArvore(caminhoDoc, nivel = 0) {
  if (!caminhoDoTeste(caminhoDoc)) throw new Error(`recusado: ${caminhoDoc} não pertence ao teste`);
  if (nivel > 6) throw new Error(`profundidade excessiva em ${caminhoDoc}`);
  let apagados = 0;
  const lista = await fetch(`${FS}/${caminhoDoc}:listCollectionIds`, { method: 'POST', headers: H, body: JSON.stringify({ pageSize: 100 }) });
  if (!lista.ok && lista.status !== 404) throw new Error(`listar subcolecoes de ${caminhoDoc}: HTTP ${lista.status}`);
  const colecoes = lista.ok ? ((await lista.json()).collectionIds ?? []) : [];
  for (const colecao of colecoes) {
    let pagina = null;
    for (let voltas = 0; voltas < 200; voltas++) {
      const q = `pageSize=100&showMissing=true${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ''}`;
      const l = await fetch(`${FS}/${caminhoDoc}/${colecao}?${q}`, { headers: H });
      if (l.status === 404) break;
      if (!l.ok) throw new Error(`listar ${caminhoDoc}/${colecao}: HTTP ${l.status}`);
      const corpo = await l.json();
      for (const d of corpo.documents ?? []) apagados += await apagarArvore(d.name.split('/documents/')[1], nivel + 1);
      pagina = corpo.nextPageToken ?? null;
      if (!pagina) break;
    }
  }
  if (await fsApagar(caminhoDoc)) apagados++;
  return apagados;
}

// ───────────── Cloud Storage (JSON API, como administrador) ─────────────
const GCS = `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o`;
const gcsObjeto = async (nome) => {
  const r = await fetch(`${GCS}/${encodeURIComponent(nome)}`, { headers: H });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`ler objeto ${nome}: HTTP ${r.status}`);
  return r.json();
};
const gcsLista = async (prefixo) => {
  const r = await fetch(`${GCS}?prefix=${encodeURIComponent(prefixo)}&maxResults=200`, { headers: H });
  if (!r.ok) throw new Error(`listar objetos em ${prefixo}: HTTP ${r.status}`);
  return ((await r.json()).items ?? []).map((i) => i.name);
};
const gcsApagar = async (nome) => {
  const r = await fetch(`${GCS}/${encodeURIComponent(nome)}`, { method: 'DELETE', headers: H });
  if (r.ok || r.status === 404) return;
  throw new Error(`apagar objeto ${nome}: HTTP ${r.status}`);
};

// ───────────── Identity Toolkit ─────────────
const ID = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`;
const contaPorEmail = async (email) => {
  const r = await fetch(`${ID}:lookup`, { method: 'POST', headers: H, body: JSON.stringify({ email: [email] }) });
  if (!r.ok) throw new Error(`consultar conta ${email.replace(/^[^@]+/, '<teste>')}: HTTP ${r.status}`);
  return ((await r.json()).users ?? [])[0] ?? null;
};
const apagarConta = async (uid) => {
  const r = await fetch(`${ID}:delete`, { method: 'POST', headers: H, body: JSON.stringify({ localId: uid }) });
  if (r.ok) return;
  const corpo = await r.json().catch(() => ({}));
  if (r.status === 400 && corpo?.error?.message === 'USER_NOT_FOUND') return;
  throw new Error(`apagar conta ${uid}: HTTP ${r.status} ${corpo?.error?.message ?? ''}`);
};
const entrar = async (email, senha) => {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: senha, returnSecureToken: true }) });
  return (await r.json()).idToken ?? null;
};

// ───────────── navegador (Chrome sem tela, o site de produção) ─────────────
const { chromium } = await import(pathToFileURL(`${PLAYWRIGHT}/playwright-core/index.mjs`).href);
const navegador = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const usuarios = {};
const sanitizar = (t) => String(t).replace(/key=[^&\s"')]+/g, 'key=…').replace(/[\w.+-]+@example[.]test/g, '<email>').slice(0, 200);

async function abrirUsuario(rotulo) {
  const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', serviceWorkers: 'block', acceptDownloads: false });
  const pagina = await contexto.newPage();
  pagina.setDefaultTimeout(60_000);
  const visto = { erros: new Map(), respostasRuins: new Map(), emailsAbortados: 0 };
  const conta = (mapa, chave) => mapa.set(chave, (mapa.get(chave) ?? 0) + 1);
  await pagina.route('**/accounts:sendOobCode*', (rota) => { visto.emailsAbortados++; return rota.abort(); });
  pagina.on('console', (m) => { if (m.type() === 'error') conta(visto.erros, sanitizar(m.text())); });
  pagina.on('pageerror', (e) => conta(visto.erros, `pageerror: ${sanitizar(e.message)}`));
  pagina.on('response', (r) => {
    if (r.status() < 400) return;
    const u = new URL(r.url());
    conta(visto.respostasRuins, `${r.status()} ${u.host}${u.pathname}`.slice(0, 180));
  });
  const u = { rotulo, contexto, pagina, visto, senha: `Aa1!${randomBytes(9).toString('hex')}` };
  u.email = `exelula.video.${stamp}${rotulo}@example.test`;
  u.username = `vid${stamp}${rotulo}`.slice(0, 15);
  usuarios[rotulo] = u;
  return u;
}
const recusarCookies = async (pagina) => {
  const botao = pagina.getByRole('button', { name: 'Rejeitar tudo' });
  if (await botao.waitFor({ timeout: 10_000 }).then(() => true, () => false)) await botao.click();
};
/** Valor do Firestore REST a partir de um valor JS (só os tipos de que o roteiro precisa). */
const valorFs = (v) => {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(valorFs) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, valorFs(x)])) } };
};
const fsCriar = async (caminho, dados) => {
  const campos = Object.fromEntries(Object.entries(dados).map(([k, x]) => [k, valorFs(x)]));
  const r = await fetch(`${FS}/${caminho}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields: campos }) });
  if (!r.ok) throw new Error(`gravar ${caminho}: HTTP ${r.status}`);
};

/**
 * Conta de teste, criada pela API ADMINISTRATIVA (e-mail confirmado, claim de membro e os três documentos que a transação de
 * cadastro grava), SEM passar pelo cadastro público: este é protegido por App Check e consome vaga dos 500 primeiros, e
 * nenhum dos dois é o que se testa aqui. O roteiro de mídia anterior fazia o mesmo. Em seguida a pessoa ENTRA pela tela de
 * login real, e tudo o que importa (envio, exclusão, acesso) é exercitado pela interface.
 */
async function cadastrar(u) {
  const p = u.pagina;
  const criada = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ email: u.email, password: u.senha, displayName: `Validação ${u.rotulo}`, emailVerified: true }),
  });
  const corpo = await criada.json().catch(() => ({}));
  if (!criada.ok || !corpo.localId) throw new Error(`o Auth recusou a conta de teste: HTTP ${criada.status} ${corpo.error?.message ?? ''}`);
  u.uid = corpo.localId;
  marcasDoTeste.add(u.uid);
  marcasDoTeste.add(u.username.toLowerCase());
  const claim = await fetch(`${ID}:update`, { method: 'POST', headers: H, body: JSON.stringify({ localId: u.uid, customAttributes: JSON.stringify({ member: true }) }) });
  if (!claim.ok) throw new Error(`claim de membro: HTTP ${claim.status}`);
  const agora = new Date();
  const nome = `Validação ${u.rotulo}`;
  await fsCriar(`usernames/${u.username.toLowerCase()}`, { userId: u.uid });
  await fsCriar(`users/${u.uid}`, {
    name: nome, username: u.username, name_lowercase: nome.toLowerCase(), avatarUrl: '/profile.png', 'data-ai-hint': 'default profile avatar',
    bio: '', followersCount: 0, followingCount: 0, postsCount: 0, dmPreference: 'everyone', isAdmin: false, isModerator: false,
    createdAt: agora, coverImageUrl: null, 'cover-image-ai-hint': null, profileVisibility: 'public', allowTagging: 'everyone', pinnedPostId: null,
  });
  await fsCriar(`users/${u.uid}/private/account`, {
    email: u.email, dateOfBirth: '1990-01-01', displaySensitiveContent: false,
    notificationPreferences: { likes: true, comments: true, reposts: true, newFollowers: true, mentions: true, directMessages: true },
    createdAt: agora,
  });
  await p.goto(`${SITE}/pt-BR/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await p.locator('#email').waitFor();
  await recusarCookies(p);
  await p.fill('#email', u.email);
  await p.fill('#password', u.senha);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  await p.getByText('Login bem-sucedido').first().waitFor({ timeout: 90_000 });
  await p.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 60_000 });
  await p.waitForTimeout(3000);
  await recusarCookies(p);
  u.idToken = await entrar(u.email, u.senha);
}
const cookieDe = async (u) => {
  const c = (await u.contexto.cookies()).find((x) => x.name === '__session');
  return c ? `__session=${c.value}` : null;
};

/** Gera, DENTRO do Chrome, um vídeo curto real (MP4 H.264 + áudio se o navegador permitir, senão WebM). */
async function gerarVideo(pagina, segundos = 3) {
  return pagina.evaluate(async (seg) => {
    const tela = document.createElement('canvas');
    tela.width = 640; tela.height = 360;
    const c = tela.getContext('2d');
    const fluxo = tela.captureStream(30);
    const audio = new AudioContext();
    const osc = audio.createOscillator();
    const destino = audio.createMediaStreamDestination();
    osc.connect(destino); osc.start();
    destino.stream.getAudioTracks().forEach((t) => fluxo.addTrack(t));
    const candidatos = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
    const mime = candidatos.find((m) => MediaRecorder.isTypeSupported(m));
    const gravador = new MediaRecorder(fluxo, { mimeType: mime, videoBitsPerSecond: 800_000 });
    const pedacos = [];
    gravador.ondataavailable = (e) => { if (e.data.size) pedacos.push(e.data); };
    const parou = new Promise((resolve) => { gravador.onstop = resolve; });
    gravador.start(250);
    const t0 = performance.now();
    await new Promise((resolve) => {
      const quadro = () => {
        const t = (performance.now() - t0) / 1000;
        c.fillStyle = `hsl(${(t * 90) % 360},70%,45%)`; c.fillRect(0, 0, 640, 360);
        c.fillStyle = '#fff'; c.font = '44px sans-serif'; c.fillText(`Exe. Lula teste ${t.toFixed(1)}s`, 40, 190);
        if (t < seg) requestAnimationFrame(quadro); else resolve();
      };
      quadro();
    });
    gravador.stop(); await parou; osc.stop(); audio.close();
    const blob = new Blob(pedacos, { type: mime });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { mime: (blob.type || mime).split(';')[0], base64: btoa(bin), tamanho: bytes.length, codec: mime };
  }, segundos);
}
const arquivoDe = (video, nome) => ({ name: nome, mimeType: video.mime, buffer: Buffer.from(video.base64, 'base64') });

// ───────────── leitura de mídia pelas rotas do site, sem navegador ─────────────
const lerMidia = async (id, { privada = false, cookie = null, range = null, metodo = 'GET' } = {}) => {
  const r = await fetch(`${SITE}/${privada ? 'mp' : 'm'}/${id}`, { method: metodo, redirect: 'manual', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(range ? { Range: range } : {}) } });
  const bytes = metodo === 'HEAD' ? null : Buffer.from(await r.arrayBuffer());
  return { status: r.status, headers: Object.fromEntries(r.headers.entries()), bytes };
};

/** Lê as caixas de nível superior de um MP4 e diz se o moov vem ANTES do mdat (faststart) e se há H.264 e AAC. */
function analisarMp4(bytes) {
  const caixas = [];
  let pos = 0;
  while (pos + 8 <= bytes.length && caixas.length < 50) {
    let tamanho = bytes.readUInt32BE(pos);
    const tipo = bytes.toString('latin1', pos + 4, pos + 8);
    if (tamanho === 1) tamanho = Number(bytes.readBigUInt64BE(pos + 8));
    if (tamanho === 0) tamanho = bytes.length - pos;
    if (tamanho < 8) break;
    caixas.push({ tipo, pos, tamanho });
    pos += tamanho;
  }
  const ordem = caixas.map((c) => c.tipo);
  const moov = caixas.find((c) => c.tipo === 'moov');
  const corpoMoov = moov ? bytes.subarray(moov.pos, moov.pos + moov.tamanho).toString('latin1') : '';
  return {
    ordem,
    ehMp4: ordem[0] === 'ftyp',
    faststart: ordem.indexOf('moov') >= 0 && ordem.indexOf('mdat') > ordem.indexOf('moov'),
    h264: corpoMoov.includes('avc1') || corpoMoov.includes('avc3'),
    aac: corpoMoov.includes('mp4a'),
    fragmentado: ordem.includes('moof'),
  };
}

/** Espera o vídeo sair de "processando" (425) e registra a linha do tempo. Devolve { status, ms, linha }. */
async function aguardarProcessamento(id, opcoes, limiteMs = 9 * 60_000) {
  const inicio = Date.now();
  const linha = [];
  let ultimo = '';
  while (Date.now() - inicio < limiteMs) {
    if (interrupcaoSolicitada) throw new Error(`execucao interrompida por ${interrupcaoSolicitada}`);
    const r = await lerMidia(id, { ...opcoes, metodo: 'HEAD' });
    const marca = `${r.status}${r.headers['x-media-status'] ? ':' + r.headers['x-media-status'] : ''}`;
    if (marca !== ultimo) { linha.push(`${Math.round((Date.now() - inicio) / 1000)}s ${marca}`); ultimo = marca; }
    if (r.status !== 425) return { status: r.status, ms: Date.now() - inicio, linha };
    await dorme(5000);
  }
  return { status: 425, ms: Date.now() - inicio, linha, esgotou: true };
}

/** Tudo o que precisa ser verdade depois que o FFmpeg terminou um vídeo VÁLIDO. */
async function verificarVideoPronto(rotulo, id, { privada = false, cookieDono = null, donoUid }) {
  const espera = await aguardarProcessamento(id, { privada, cookie: cookieDono });
  nota(`${rotulo}: ${espera.linha.join(' → ')} (${Math.round(espera.ms / 1000)}s)`);
  if (!ok(espera.status === 200, `${rotulo}: o vídeo ficou pronto (a rota respondeu 200)`, `terminou em ${espera.status}${espera.esgotou ? ' — tempo esgotado' : ''}`)) return null;
  const media = await fsGet(`media/${id}`);
  const envio = await fsGet(`videoUploads/${id}`);
  ok(media?.processingStatus === 'ready' && media.contentType === 'video/mp4' && media.size > 0, `${rotulo}: media/${id.slice(0, 6)}… pronto, video/mp4, tamanho final gravado`, `${media?.processingStatus} ${media?.contentType} ${media?.size}`);
  ok(media?.duration > 0 && media.width > 0 && media.height > 0, `${rotulo}: duração e dimensões medidas pelo ffprobe`, `${media?.duration?.toFixed?.(2)}s ${media?.width}x${media?.height}`);
  ok(envio?.status === 'ready' && envio.finalSize === media?.size, `${rotulo}: videoUploads "ready" com o mesmo tamanho final`, `${envio?.status}`);
  ok(media?.deletedAt === undefined || media.deletedAt === null, `${rotulo}: sem tombstone`);
  const objeto = media ? await gcsObjeto(media.storagePath) : null;
  ok(objeto && objeto.contentType === 'video/mp4', `${rotulo}: o MP4 está no bucket com content-type video/mp4`, objeto ? objeto.contentType : 'objeto ausente');
  ok(objeto && !objeto.metadata?.firebaseStorageDownloadTokens, `${rotulo}: o objeto de saída NÃO tem token de download (GCS real)`, JSON.stringify(objeto?.metadata ?? {}).slice(0, 120));
  const cacheEsperado = privada ? /private/ : /public/;
  ok(objeto && cacheEsperado.test(objeto.cacheControl ?? ''), `${rotulo}: cache-control do objeto coerente com a visibilidade`, objeto?.cacheControl);
  const fonte = await gcsObjeto(`video_staging/${donoUid}/${id}/source`);
  ok(fonte === null, `${rotulo}: a fonte transitória foi APAGADA do bucket`, fonte ? `ainda existe (${fonte.size} bytes)` : '');
  const completo = await lerMidia(id, { privada, cookie: cookieDono });
  const mp4 = completo.bytes ? analisarMp4(completo.bytes) : null;
  ok(mp4?.ehMp4 && mp4.faststart && !mp4.fragmentado, `${rotulo}: contêiner MP4 com faststart (moov antes do mdat)`, mp4 ? mp4.ordem.join(',') : 'sem corpo');
  ok(mp4?.h264, `${rotulo}: vídeo H.264`);
  nota(`${rotulo}: ${mp4?.aac ? 'com áudio AAC' : 'sem faixa de áudio detectada'}; ${completo.bytes?.length} bytes servidos`);
  ok(completo.headers['content-type'] === 'video/mp4' && completo.headers['accept-ranges'] === 'bytes', `${rotulo}: a rota serve video/mp4 com Accept-Ranges`);
  const parcial = await lerMidia(id, { privada, cookie: cookieDono, range: 'bytes=0-99' });
  ok(parcial.status === 206 && parcial.headers['content-range']?.startsWith('bytes 0-99/') && parcial.bytes?.length === 100, `${rotulo}: Range responde 206 com 100 bytes`, `${parcial.status} ${parcial.headers['content-range']}`);
  return { media, envio, espera };
}

// ───────────── ações pela interface ─────────────
const idDaUrl = (url) => /\/(?:m|mp)\/([A-Za-z0-9_-]{22})(?:[?#]|$)/.exec(String(url ?? ''))?.[1] ?? null;
const esperar = async (fn, rotulo, limiteMs = 60_000) => {
  const inicio = Date.now();
  while (Date.now() - inicio < limiteMs) {
    if (interrupcaoSolicitada) throw new Error(`execucao interrompida por ${interrupcaoSolicitada}`);
    const v = await fn();
    if (v) return v;
    await dorme(2000);
  }
  throw new Error(`${rotulo} não aconteceu em ${Math.round(limiteMs / 1000)}s`);
};
async function anexarVideo(escopo, pagina, arquivo) {
  await escopo.locator('input[type=file]').first().setInputFiles(arquivo);
  await escopo.locator('[data-status]').first().waitFor({ timeout: 60_000 });
  await escopo.locator('[data-status="uploading"]').waitFor({ state: 'detached', timeout: 240_000 });
  const falhou = await escopo.locator('[data-status="failed"]').count();
  if (falhou) throw new Error('a interface marcou o envio do vídeo como falho');
}
async function abrirCompositor(u) {
  await u.pagina.goto(`${SITE}/pt-BR`, { waitUntil: 'domcontentloaded' });
  await u.pagina.getByRole('button', { name: 'Postar', exact: true }).first().click();
  const dialogo = u.pagina.getByRole('dialog');
  await dialogo.waitFor();
  return dialogo;
}
async function publicarPostComVideo(u, texto, arquivo) {
  const dialogo = await abrirCompositor(u);
  await dialogo.getByPlaceholder('E aí?').fill(texto);
  await anexarVideo(dialogo, u.pagina, arquivo);
  await dialogo.getByRole('button', { name: 'Postar', exact: true }).click();
  await u.pagina.getByText('Post Enviado!').first().waitFor({ timeout: 90_000 });
  return esperar(async () => (await fsQuery('posts', 'userId', u.uid)).find((p) => String(p.text ?? '').includes(texto)), `post "${texto}"`);
}
const urlDoPost = (postId) => `${SITE}/pt-BR/post/${postId}`;

// ───────────── os testes ─────────────
const ids = { post: null, comentario: null, citacao: null, mensagem: null, arquivo: null, invalido: null };
const donos = {};
let video;
let postDeA;
let controleAntes = null;
let reversaoConcluida = false;

const RTDB = `https://${PROJECT}-default-rtdb.firebaseio.com`;
const residuos = [];
/** O que uma consulta pelo UID de teste devolve é, por definição, do teste: passa a poder ser apagado. */
const adotar = (documento) => { marcasDoTeste.add(documento.__id); return documento; };

/**
 * Reverte somente recursos marcados por UIDs, nomes e ids criados nesta execução.
 * É idempotente e também roda no `finally`, portanto uma exceção ou Ctrl+C não deixa contas e objetos de teste para trás.
 */
async function reverter() {
  try {
    garantirTokenAtual(true);
  } catch (erro) {
    if (!tokenAtual) throw erro;
    H.Authorization = `Bearer ${tokenAtual}`;
    console.error(
      `AVISO: não foi possível renovar o token antes da reversão; tentando concluir com a credencial atual: ${String(
        erro?.message ?? erro,
      ).split('\n')[0].slice(0, 220)}`,
    );
  }
  for (const u of Object.values(usuarios)) {
    if (u.uid) marcasDoTeste.add(u.uid);
    if (u.username) marcasDoTeste.add(u.username.toLowerCase());
  }
  for (const valor of [...Object.values(ids), postDeA?.__id]) {
    if (typeof valor === 'string' && valor) marcasDoTeste.add(valor);
  }
  const uids = Object.values(usuarios).map((u) => u.uid).filter(Boolean);
  const erros = [];
  const tentar = async (rotulo, fn, fallback = null) => {
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      try {
        garantirTokenAtual(tentativa === 2);
        return await fn();
      } catch (erro) {
        if (tentativa === 1) {
          await dorme(1_000);
          continue;
        }
        const mensagem = `${rotulo}: ${String(erro?.message ?? erro).split('\n')[0].slice(0, 220)}`;
        erros.push(mensagem);
        console.error(`FALHA NA REVERSÃO ${mensagem}`);
      }
    }
    return fallback;
  };

  for (const u of Object.values(usuarios)) {
    if (u.uid) await tentar(`Auth ${u.rotulo}`, () => apagarConta(u.uid));
  }
  if (uids.length) {
    nota('contas descartáveis apagadas no Auth; esperando as Functions de limpeza terminarem');
    await dorme(40_000);
  }

  let apagados = 0;
  for (const uid of uids) {
    const posts = await tentar(`listar posts de ${uid}`, () => fsQueryEstrita('posts', 'userId', uid), []);
    const conversas = await tentar(`listar conversas de ${uid}`, () => fsQueryContem('conversations', 'participantIds', uid), []);
    const notificacoes = await tentar(`listar notificações de ${uid}`, () => fsQueryEstrita('notifications', 'recipientId', uid), []);
    const midias = await tentar(`listar mídias de ${uid}`, () => fsQueryEstrita('media', 'ownerUid', uid), []);
    for (const p of posts.map(adotar)) apagados += await tentar(`apagar post ${p.__id}`, () => apagarArvore(`posts/${p.__id}`), 0);
    for (const c of conversas.map(adotar)) apagados += await tentar(`apagar conversa ${c.__id}`, () => apagarArvore(`conversations/${c.__id}`), 0);
    for (const n of notificacoes.map(adotar)) apagados += await tentar(`apagar notificação ${n.__id}`, () => apagarArvore(`notifications/${n.__id}`), 0);
    for (const m of midias.map(adotar)) apagados += await tentar(`apagar mídia ${m.__id}`, () => apagarArvore(`media/${m.__id}`), 0);
    apagados += await tentar(`apagar perfil ${uid}`, () => apagarArvore(`users/${uid}`), 0);
    apagados += await tentar(`apagar vaga ${uid}`, () => apagarArvore(`_signup/control/slots/${uid}`), 0);
    for (const prefixo of [`user_uploads/${uid}/`, `video_staging/${uid}/`]) {
      const objetos = await tentar(`listar Storage ${prefixo}`, () => gcsLista(prefixo), []);
      for (const nome of objetos) await tentar(`apagar objeto ${nome}`, () => gcsApagar(nome));
    }
    await tentar(`apagar RTDB status/${uid}`, async () => {
      const rt = await fetch(`${RTDB}/status/${uid}.json`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${garantirTokenAtual()}` },
      });
      if (!rt.ok && rt.status !== 404) throw new Error(`HTTP ${rt.status}`);
    });
  }
  for (const u of Object.values(usuarios)) {
    if (u.username) {
      apagados += await tentar(
        `apagar username ${u.username}`,
        () => apagarArvore(`usernames/${u.username.toLowerCase()}`),
        0,
      );
    }
  }
  for (const id of [ids.post, ids.comentario, ids.citacao, ids.mensagem, ids.arquivo, ids.invalido]) {
    if (!id) continue;
    apagados += await tentar(`apagar media/${id}`, () => apagarArvore(`media/${id}`), 0);
    apagados += await tentar(`apagar videoUploads/${id}`, () => apagarArvore(`videoUploads/${id}`), 0);
  }
  nota(`${apagados} documentos apagados pela reversão`);
  if (erros.length) throw new AggregateError(erros, `reversão terminou com ${erros.length} erro(s)`);
}

const solicitarInterrupcao = (sinal) => {
  if (interrupcaoSolicitada) return;
  interrupcaoSolicitada = sinal;
  console.error(`\nInterrupção ${sinal} recebida; encerrando o navegador e iniciando a reversão segura…`);
  void navegador.close().catch(() => {});
};
process.once('SIGINT', () => solicitarInterrupcao('SIGINT'));
process.once('SIGTERM', () => solicitarInterrupcao('SIGTERM'));

try {

secao('0. Preparação: o que existe na nuvem, e três contas descartáveis');
await etapa('infraestrutura', async () => {
  controleAntes = await fsGet('_signup/control');
  if (!controleAntes) throw new Error('preflight: _signup/control não existe ou não pôde ser lido');
  const job = await fetch(`https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs/video-transcoder`, { headers: H });
  if (!job.ok) throw new Error(`preflight: Cloud Run Job video-transcoder respondeu HTTP ${job.status}`);
  const corpo = await job.json();
  if (corpo?.template?.template?.containers?.[0]?.resources?.limits?.cpu !== '4') {
    throw new Error('preflight: Cloud Run Job video-transcoder não está configurado com 4 CPU');
  }
  ok(true, 'Cloud Run Job video-transcoder existe (4 CPU)', `HTTP ${job.status}`);
  for (const nome of ['onVideoSourceUploaded', 'dispatchQueuedVideoTranscodes']) {
    const funcao = await fetch(
      `https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/functions/${nome}`,
      { headers: H },
    );
    if (!funcao.ok) throw new Error(`preflight: Function ${nome} respondeu HTTP ${funcao.status}`);
    const dados = await funcao.json();
    if (dados.state !== 'ACTIVE') throw new Error(`preflight: Function ${nome} está em ${dados.state ?? 'estado desconhecido'}`);
    ok(true, `Function ${nome} está ACTIVE`);
  }
  const home = await fetch(`${SITE}/pt-BR`);
  if (home.status !== 200) throw new Error(`preflight: o site respondeu HTTP ${home.status}`);
  ok(true, 'o site responde', `HTTP ${home.status}`);
  const rotaVideo = await fetch(`${SITE}/api/media/video/init`, { method: 'GET', redirect: 'manual' });
  if (rotaVideo.status === 404) throw new Error('preflight: o site publicado ainda não contém /api/media/video/init');
  ok(true, 'o site publicado contém a rota de inicialização de vídeo', `HTTP ${rotaVideo.status}`);
});
if (falhas) throw new Error('preflight falhou; nenhuma conta descartável será criada');
for (const rotulo of ['a', 'b', 'c']) {
  await etapa(`cadastro ${rotulo}`, async () => {
    const u = await abrirUsuario(rotulo);
    await cadastrar(u);
    ok(Boolean(u.uid && u.idToken), `conta ${rotulo.toUpperCase()} criada pela tela de produção, e-mail confirmado pela API administrativa e sessão aberta`, u.uid);
    donos[rotulo] = u.uid;
  });
}
const [A, B, C] = [usuarios.a, usuarios.b, usuarios.c];
await etapa('vídeo de teste', async () => {
  video = await gerarVideo(A.pagina, 3);
  ok(video.tamanho > 5_000, `vídeo curto gerado no Chrome (${video.codec})`, `${video.tamanho} bytes, ${video.mime}`);
});

secao('1. Vídeo curto em POST (pela tela de postagem)');
await etapa('post', async () => {
  if (!A?.uid || !video) throw new Error('sem conta A ou sem vídeo');
  postDeA = await publicarPostComVideo(A, `Post com vídeo da validação ${stamp}`, arquivoDe(video, `clipe-${stamp}.mp4`));
  ids.post = idDaUrl(postDeA.media?.[0]?.url);
  ok(/^https:\/\/media[.]exercitodolula[.]app\/m\/[A-Za-z0-9_-]{22}$/.test(postDeA.media?.[0]?.url ?? ''), 'o post guarda a URL pública opaca /m/<id> (e nenhuma URL do Storage)', postDeA.media?.[0]?.url);
  const logo = await lerMidia(ids.post, { metodo: 'HEAD' });
  nota(`logo após publicar: ${logo.status}${logo.headers['x-media-status'] ? ' ' + logo.headers['x-media-status'] : ''} (progresso ${logo.headers['x-media-progress'] ?? '-'})`);
  ok([425, 200].includes(logo.status), 'o post já mostra o vídeo como "processando" (425) ou pronto, nunca erro', `HTTP ${logo.status}`);
  const r = await verificarVideoPronto('post', ids.post, { privada: false, donoUid: A.uid });
  if (r) {
    await A.pagina.goto(urlDoPost(postDeA.__id), { waitUntil: 'domcontentloaded' });
    const tocou = await A.pagina.waitForFunction(() => { const v = document.querySelector('video'); return Boolean(v && v.readyState >= 2 && v.videoWidth > 0); }, null, { timeout: 90_000 }).then(() => true, () => false);
    ok(tocou, 'a página do post carrega o vídeo no player (readyState >= 2, com dimensões)');
    await A.pagina.screenshot({ path: join(SAIDA, `validacao-video-post-${stamp}.png`) });
  }
});

secao('2. Vídeo curto em COMENTÁRIO (B comenta o post de A)');
await etapa('comentário', async () => {
  if (!postDeA || !video) throw new Error('sem post-base');
  const texto = `Comentário com vídeo ${stamp}`;
  await B.pagina.goto(urlDoPost(postDeA.__id), { waitUntil: 'domcontentloaded' });
  await B.pagina.getByText('Escreva um comentário...').first().click();
  const dialogo = B.pagina.getByRole('dialog');
  await dialogo.waitFor({ timeout: 30_000 });
  await anexarVideo(dialogo, B.pagina, arquivoDe(video, `comentario-${stamp}.mp4`));
  await dialogo.getByPlaceholder('Escreva um comentário...').fill(texto);
  await dialogo.getByRole('button', { name: 'Responder', exact: true }).click();
  await dialogo.waitFor({ state: 'detached', timeout: 90_000 });
  const comentario = await esperar(async () => (await fsList(`posts/${postDeA.__id}/comments`)).find((c) => String(c.text ?? '').includes(texto)), 'comentário');
  ids.comentario = idDaUrl(comentario.media?.[0]?.url);
  ok(Boolean(ids.comentario), 'o comentário guarda a URL opaca do vídeo', comentario.media?.[0]?.url);
  ids.comentarioDoc = comentario.__id;
  await verificarVideoPronto('comentário', ids.comentario, { privada: false, donoUid: B.uid });
});

secao('3. Vídeo curto em CITAÇÃO (B cita o post de A)');
await etapa('citação', async () => {
  if (!postDeA || !video) throw new Error('sem post-base');
  const texto = `Citação com vídeo ${stamp}`;
  await B.pagina.goto(urlDoPost(postDeA.__id), { waitUntil: 'domcontentloaded' });
  await B.pagina.locator('main button:has(svg.lucide-repeat2)').first().click();
  await B.pagina.getByRole('menuitem', { name: 'Citar postagem' }).click();
  const dialogo = B.pagina.getByRole('dialog');
  await dialogo.waitFor({ timeout: 30_000 });
  await anexarVideo(dialogo, B.pagina, arquivoDe(video, `citacao-${stamp}.mp4`));
  await dialogo.getByPlaceholder('E aí...').fill(texto);
  await dialogo.getByRole('button', { name: 'Postar', exact: true }).click();
  await B.pagina.getByText('Post Enviado!').first().waitFor({ timeout: 90_000 }).catch(() => {});
  const citacao = await esperar(async () => (await fsQuery('posts', 'userId', B.uid)).find((p) => String(p.text ?? '').includes(texto)), 'citação');
  ids.citacao = idDaUrl(citacao.media?.[0]?.url);
  ids.citacaoDoc = citacao.__id;
  ok(citacao.type === 'quote' && Boolean(ids.citacao), 'a citação guarda o vídeo próprio (URL opaca) e é do tipo quote', `${citacao.type}`);
  await verificarVideoPronto('citação', ids.citacao, { privada: false, donoUid: B.uid });
  const original = await fsGet(`media/${idDaUrl(postDeA.media?.[0]?.url)}`);
  ok(original && !original.deletedAt, 'o vídeo do post ORIGINAL continua intacto (a citação não mexe nele)');
});

secao('4. Vídeo curto em CHAT (A envia a B; C é de fora)');
/** A conversa entre A e B, achada pelos participantes (não se depende do formato do id). */
const conversaDeAeB = async () => (await fsQueryContem('conversations', 'participantIds', A.uid)).find((c) => (c.participantIds ?? []).includes(B.uid)) ?? null;
await etapa('chat', async () => {
  if (!video) throw new Error('sem vídeo');
  const texto = `Vídeo no chat ${stamp}`;
  await A.pagina.goto(`${SITE}/pt-BR/messages/user/${B.uid}`, { waitUntil: 'domcontentloaded' });
  await A.pagina.getByPlaceholder('Digite sua mensagem...').waitFor({ timeout: 90_000 });
  await A.pagina.locator('input[type=file][accept*="audio"]').setInputFiles(arquivoDe(video, `chat-${stamp}.mp4`));
  await dorme(2500);
  await A.pagina.getByPlaceholder('Digite sua mensagem...').fill(texto);
  await A.pagina.locator('form:has(textarea[placeholder="Digite sua mensagem..."]) button[type=submit]').click();
  await A.pagina.getByText(texto).first().waitFor({ timeout: 240_000 });
  const conversa = await esperar(conversaDeAeB, 'conversa entre A e B');
  ids.conversa = conversa.__id;
  const mensagem = await esperar(async () => (await fsList(`conversations/${conversa.__id}/messages`)).find((m) => m.text === texto), 'mensagem');
  ids.mensagem = idDaUrl(mensagem.fileUrl);
  ids.mensagemDoc = mensagem.__id;
  ok(/^\/mp\/[A-Za-z0-9_-]{22}$/.test(mensagem.fileUrl ?? ''), 'a mensagem guarda /mp/<id> (privado), nunca URL do Storage', mensagem.fileUrl);
  const cookieA = await cookieDe(A);
  await verificarVideoPronto('chat', ids.mensagem, { privada: true, cookieDono: cookieA, donoUid: A.uid });
  await B.pagina.goto(`${SITE}/pt-BR/messages/user/${A.uid}`, { waitUntil: 'domcontentloaded' });
  const vendo = await B.pagina.waitForFunction((id) => { const v = [...document.querySelectorAll('video')].find((x) => (x.currentSrc || x.src || '').includes(`/mp/${id}`)); return Boolean(v && v.readyState >= 2 && v.videoWidth > 0); }, ids.mensagem, { timeout: 90_000 }).then(() => true, () => false);
  ok(vendo, 'B (participante) vê e carrega o vídeo na conversa');
  await B.pagina.screenshot({ path: join(SAIDA, `validacao-video-chat-${stamp}.png`) });
});

secao('5. Vídeo curto em ARQUIVOS (kind userFile; a tela ainda não existe, então vai pela API de envio que ela vai chamar)');
async function enviarFonteComoPessoa(u, caminho, mediaId, bytes, tipo) {
  const inicio = await fetch(`https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o?name=${encodeURIComponent(caminho)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(bytes.length), 'X-Goog-Upload-Header-Content-Type': tipo, Authorization: `Firebase ${u.idToken}` },
    body: JSON.stringify({ name: caminho, contentType: tipo, metadata: { mediaId, pipeline: 'ffmpeg-v1' } }),
  });
  if (inicio.status !== 200) return { ok: false, etapa: 'start', status: inicio.status };
  const url = inicio.headers.get('x-goog-upload-url');
  const fim = await fetch(url, { method: 'POST', headers: { 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0', Authorization: `Firebase ${u.idToken}` }, body: bytes });
  return { ok: fim.status === 200, etapa: 'finalize', status: fim.status };
}
async function enviarFonteComoAdmin(caminho, mediaId, bytes, tipo) {
  const limite = `limite${randomBytes(6).toString('hex')}`;
  const corpo = Buffer.concat([
    Buffer.from(`--${limite}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ name: caminho, contentType: tipo, metadata: { mediaId, pipeline: 'ffmpeg-v1' } })}\r\n--${limite}\r\nContent-Type: ${tipo}\r\n\r\n`),
    bytes, Buffer.from(`\r\n--${limite}--`),
  ]);
  const r = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=multipart`, { method: 'POST', headers: { Authorization: `Bearer ${garantirTokenAtual()}`, 'x-goog-user-project': PROJECT, 'Content-Type': `multipart/related; boundary=${limite}` }, body: corpo });
  return { ok: r.ok, etapa: 'admin', status: r.status };
}
await etapa('arquivos', async () => {
  if (!video) throw new Error('sem vídeo');
  const bytes = Buffer.from(video.base64, 'base64');
  const init = await fetch(`${SITE}/api/media/video/init`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${A.idToken}` },
    body: JSON.stringify({ storagePath: `user_uploads/${A.uid}/user_files/arquivo-${stamp}.mp4`, contentType: video.mime, size: bytes.length, durationSeconds: 3 }),
  });
  const corpo = await init.json().catch(() => ({}));
  ok(init.status === 201 && /^\/mp\/[A-Za-z0-9_-]{22}$/.test(corpo.downloadURL ?? ''), 'init de arquivo pessoal responde /mp/<id> (privado)', `${init.status} ${corpo.downloadURL}`);
  ids.arquivo = corpo.mediaId;
  let envio = await enviarFonteComoPessoa(A, corpo.sourcePath, corpo.mediaId, bytes, video.mime);
  ok(envio.ok, 'o envio da fonte com o token da PESSOA (como o SDK faz) é aceito pelas regras do Storage', `${envio.etapa} ${envio.status}`);
  if (!envio.ok) {
    nota('o envio com o token da pessoa foi recusado; o restante do teste usa um envio administrativo (a regra do Storage é coberta pelo teste do post, que usa o SDK de verdade)');
    envio = await enviarFonteComoAdmin(corpo.sourcePath, corpo.mediaId, bytes, video.mime);
  }
  await verificarVideoPronto('arquivo pessoal', ids.arquivo, { privada: true, cookieDono: await cookieDe(A), donoUid: A.uid });
});

secao('6. Vídeo INVÁLIDO (um arquivo .mp4 que não é vídeo)');
await etapa('inválido', async () => {
  const lixo = { name: `invalido-${stamp}.mp4`, mimeType: 'video/mp4', buffer: Buffer.from('isto nao e um video de verdade. '.repeat(2000)) };
  const post = await publicarPostComVideo(A, `Post com vídeo inválido ${stamp}`, lixo);
  ids.invalido = idDaUrl(post.media?.[0]?.url);
  ids.invalidoPost = post.__id;
  const espera = await aguardarProcessamento(ids.invalido, {});
  nota(`vídeo inválido: ${espera.linha.join(' → ')} (${Math.round(espera.ms / 1000)}s)`);
  ok(espera.status === 422, 'o vídeo inválido termina em 422 (failed) e NÃO fica "processando" para sempre', `HTTP ${espera.status}${espera.esgotou ? ' — tempo esgotado' : ''}`);
  const cabeca = await lerMidia(ids.invalido, { metodo: 'HEAD' });
  ok(cabeca.headers['x-media-status'] === 'failed', 'a rota informa x-media-status: failed', cabeca.headers['x-media-status']);
  const media = await fsGet(`media/${ids.invalido}`);
  const envio = await fsGet(`videoUploads/${ids.invalido}`);
  ok(media?.processingStatus === 'failed' && media.processingError === 'transcode-failed', 'media/<id> registra a falha (transcode-failed)', `${media?.processingStatus}/${media?.processingError}`);
  ok(envio?.status === 'failed' && envio.errorCode === 'transcode-failed', 'videoUploads/<id> registra a falha com o código e a mensagem', `${envio?.status}/${envio?.errorCode}`);
  nota(`mensagem do ffprobe guardada: ${String(envio?.errorMessage ?? '').replace(/\s+/g, ' ').slice(0, 160)}`);
  ok((await gcsObjeto(`video_staging/${A.uid}/${ids.invalido}/source`)) === null, 'a fonte inválida foi apagada do bucket (a correção do tratamento de erro do worker)');
  ok(media && (await gcsObjeto(media.storagePath)) === null, 'nenhum MP4 de saída foi criado para o vídeo inválido');
  const execs = await fetch(`https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs/video-transcoder/executions?pageSize=12`, { headers: H }).then((r) => r.json()).catch(() => ({}));
  const resumo = (execs.executions ?? []).slice(0, 8).map((e) => `${e.name.split('/').pop().slice(-8)}: ok=${e.succeededCount ?? 0} falhas=${e.failedCount ?? 0}`);
  nota(`execuções recentes do job: ${resumo.join(' | ')}`);
  await A.pagina.goto(urlDoPost(post.__id), { waitUntil: 'domcontentloaded' });
  await A.pagina.waitForTimeout(5000);
  await A.pagina.screenshot({ path: join(SAIDA, `validacao-video-invalido-${stamp}.png`) });
});

secao('7. Acesso anônimo, de terceiro e do dono (rotas do site e Storage direto)');
await etapa('privacidade', async () => {
  const cookie = { a: await cookieDe(A), b: await cookieDe(B), c: await cookieDe(C) };
  ok(cookie.a && cookie.b && cookie.c, 'as três contas têm sessão (cookie __session)');
  const quer = async (rotulo, id, opcoes, esperado) => {
    if (!id) { ok(false, `${rotulo}: sem id (o teste anterior falhou)`); return; }
    const r = await lerMidia(id, { ...opcoes, metodo: 'HEAD' });
    ok(r.status === esperado, rotulo, `HTTP ${r.status} (esperado ${esperado})`);
  };
  // públicos (post, comentário, citação): qualquer pessoa, sem login
  for (const [nome, id] of [['post', ids.post], ['comentário', ids.comentario], ['citação', ids.citacao]]) {
    await quer(`${nome} (público): anônimo lê em /m`, id, {}, 200);
    await quer(`${nome} (público): anônimo em /mp recebe 404`, id, { privada: true }, 404);
  }
  // chat: só os dois participantes
  await quer('chat (privado): anônimo em /mp recebe 404', ids.mensagem, { privada: true }, 404);
  await quer('chat (privado): anônimo em /m recebe 404', ids.mensagem, {}, 404);
  await quer('chat (privado): C (de fora) em /mp recebe 404', ids.mensagem, { privada: true, cookie: cookie.c }, 404);
  await quer('chat (privado): cookie inválido recebe 404', ids.mensagem, { privada: true, cookie: '__session=isto-nao-e-uma-sessao' }, 404);
  await quer('chat (privado): A (autor) lê', ids.mensagem, { privada: true, cookie: cookie.a }, 200);
  await quer('chat (privado): B (participante) lê', ids.mensagem, { privada: true, cookie: cookie.b }, 200);
  // arquivo pessoal: só o dono
  await quer('arquivo pessoal: anônimo em /mp recebe 404', ids.arquivo, { privada: true }, 404);
  await quer('arquivo pessoal: anônimo em /m recebe 404', ids.arquivo, {}, 404);
  await quer('arquivo pessoal: B recebe 404', ids.arquivo, { privada: true, cookie: cookie.b }, 404);
  await quer('arquivo pessoal: C recebe 404', ids.arquivo, { privada: true, cookie: cookie.c }, 404);
  await quer('arquivo pessoal: A (dono) lê', ids.arquivo, { privada: true, cookie: cookie.a }, 200);
  // Storage direto: nem a fonte transitória nem a saída são legíveis por quem não é o dono
  const mediaChat = ids.mensagem ? await fsGet(`media/${ids.mensagem}`) : null;
  if (mediaChat) {
    const url = (token) => `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(mediaChat.storagePath)}?alt=media`;
    const acesso = async (rotulo, token, esperado) => {
      const r = await fetch(url(), { headers: token ? { Authorization: `Firebase ${token}` } : {} });
      ok(r.status === esperado, `Storage direto, anexo do chat: ${rotulo}`, `HTTP ${r.status} (esperado ${esperado})`);
    };
    await acesso('anônimo recebe 403', null, 403);
    await acesso('C (de fora) recebe 403', C.idToken, 403);
    await acesso('B (participante, mas não dono do objeto) recebe 403', B.idToken, 403);
  }
  const lista = await fetch(`https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o?prefix=${encodeURIComponent(`video_staging/${A.uid}/`)}`, { headers: { Authorization: `Firebase ${A.idToken}` } });
  ok(lista.status === 403, 'Storage direto: nem a dona consegue LISTAR video_staging/', `HTTP ${lista.status}`);
});

secao('8. Exclusão: o vídeo sai do ar E do bucket (Functions de produção, com o bucket corrigido)');
const apagouDoBucket = async (rotulo, id, privada) => {
  if (!id) { ok(false, `${rotulo}: sem id`); return; }
  const media = await fsGet(`media/${id}`);
  const caminho = media?.storagePath;
  // Sem o caminho não há como provar que o objeto saiu: isso é falha, nunca "sumiu" por engano.
  if (!caminho) { ok(false, `${rotulo}: media/<id> sem storagePath (não dá para conferir o bucket)`, media ? 'registro sem caminho' : 'registro ausente'); return; }
  await esperar(async () => (await fsGet(`media/${id}`))?.deletedAt, `${rotulo}: tombstone`, 120_000).catch(() => null);
  const depois = await fsGet(`media/${id}`);
  ok(Boolean(depois?.deletedAt), `${rotulo}: media/<id> virou tombstone (deletedAt)`);
  const r = await lerMidia(id, { metodo: 'HEAD', privada: false });
  ok(privada ? r.status === 404 : r.status === 410, `${rotulo}: /m/<id> responde ${privada ? '404' : '410'}`, `HTTP ${r.status}`);
  const sumiu = await esperar(async () => (await gcsObjeto(caminho)) === null, `${rotulo}: objeto removido`, 120_000).then(() => true, () => false);
  ok(sumiu, `${rotulo}: o objeto saiu do BUCKET (antes ficava guardado para sempre)`, caminho);
};
await etapa('exclusão do post (com comentário e citação: vira "túmulo")', async () => {
  if (!postDeA) throw new Error('sem post');
  await A.pagina.goto(urlDoPost(postDeA.__id), { waitUntil: 'domcontentloaded' });
  await A.pagina.getByText(`Post com vídeo da validação ${stamp}`).first().waitFor({ timeout: 90_000 });
  await A.pagina.getByRole('button', { name: 'More options' }).first().click();
  A.pagina.once('dialog', (d) => d.accept());
  await A.pagina.getByRole('menuitem', { name: /Deletar post/ }).click();
  const tumulo = await esperar(async () => { const p = await fsGet(`posts/${postDeA.__id}`); return !p || p.isDeleted === true ? (p ?? { removido: true }) : null; }, 'post apagado ou tombado', 90_000);
  ok(tumulo.removido || (tumulo.isDeleted && !tumulo.media?.length), 'o post saiu (túmulo sem texto nem mídia, ou apagado de vez)', tumulo.removido ? 'apagado' : 'tombado');
  await apagouDoBucket('post', ids.post, false);
});
await etapa('exclusão do comentário (pela conta de B, como o app faz)', async () => {
  const r = await fetch(`${FS}/posts/${postDeA.__id}/comments/${ids.comentarioDoc}`, { method: 'DELETE', headers: { Authorization: `Bearer ${B.idToken}` } });
  ok(r.ok, 'B apaga o próprio comentário (regras do Firestore)', `HTTP ${r.status}`);
  await apagouDoBucket('comentário', ids.comentario, false);
});
await etapa('exclusão da citação (pela conta de B)', async () => {
  const r = await fetch(`${FS}/posts/${ids.citacaoDoc}`, { method: 'DELETE', headers: { Authorization: `Bearer ${B.idToken}` } });
  ok(r.ok, 'B apaga a própria citação (regras do Firestore)', `HTTP ${r.status}`);
  await apagouDoBucket('citação', ids.citacao, false);
});
await etapa('exclusão da mensagem com vídeo (pela tela, a correção do conversationId)', async () => {
  await A.pagina.goto(`${SITE}/pt-BR/messages/user/${B.uid}`, { waitUntil: 'domcontentloaded' });
  const bolha = A.pagina.locator('[id^="message-bubble-"]').filter({ hasText: `Vídeo no chat ${stamp}` }).first();
  await bolha.waitFor({ timeout: 90_000 });
  await bolha.hover();
  await bolha.locator('button[aria-haspopup="menu"]').first().click();
  await A.pagina.getByRole('menuitem', { name: 'Apagar' }).click();
  await A.pagina.getByRole('alertdialog').getByRole('button', { name: 'Apagar' }).click();
  await bolha.waitFor({ state: 'detached', timeout: 30_000 });
  ok(true, 'a tela apagou a mensagem (antes estourava "indexOf" de undefined)');
  await apagouDoBucket('mensagem do chat', ids.mensagem, true);
  ok((await lerMidia(ids.mensagem, { privada: true, cookie: await cookieDe(B) , metodo: 'HEAD' })).status === 404, 'o participante também deixou de ver o anexo apagado');
});

secao('9. Exclusão da CONTA de A: o que sobrou (arquivo pessoal e vídeo inválido) sai junto, do ar e do bucket');
await etapa('exclusão da conta', async () => {
  if (!A?.uid) throw new Error('sem conta A');
  const antes = ids.arquivo ? await fsGet(`media/${ids.arquivo}`) : null;
  ok(Boolean(antes) && !antes.deletedAt, 'antes: o arquivo pessoal de A existe e está ativo', antes ? 'ativo' : 'ausente');
  const r = await fetch(`${ID}:delete`, { method: 'POST', headers: H, body: JSON.stringify({ localId: A.uid }) });
  ok(r.ok, 'a conta de A foi apagada no Auth (Identity Toolkit)', `HTTP ${r.status}`);
  await apagouDoBucket('arquivo pessoal (exclusão da conta)', ids.arquivo, true);
  await apagouDoBucket('vídeo inválido (exclusão da conta)', ids.invalido, false);
  const perfilSumiu = await esperar(async () => (await fsGet(`users/${A.uid}`)) === null, 'perfil de A apagado', 120_000).then(() => true, () => false);
  ok(perfilSumiu, 'users/<uid> de A foi apagado pelo onUserDeletedCleanup');
  ok((await fsGet(`usernames/${A.username.toLowerCase()}`)) === null, 'usernames/<@> de A foi apagado');
  ok((await lerMidia(ids.arquivo, { privada: true, cookie: await cookieDe(A), metodo: 'HEAD' })).status === 404, 'o cookie de A (sessão antiga) já não abre o arquivo pessoal');
});

secao('10. Reversão: nada do teste fica em produção (somente caminhos dos 3 UIDs e dos ids deste teste)');
if (MANTER) {
  secao('REVERSÃO PULADA (--manter): ficou em produção, para você investigar e apagar depois');
  for (const u of Object.values(usuarios)) nota(`conta ${u.rotulo}: ${u.email} (uid ${u.uid})`);
  nota(`ids de mídia: ${JSON.stringify(ids)}`);
} else {
  await reverter();
  reversaoConcluida = true;
  ok(true, 'reversão concluída sem esconder erro de exclusão');
  // As contas de teste NÃO consomem vaga (foram criadas pela API administrativa, não pelo cadastro público). Se o contador
  // mudou durante o teste, só pode ter sido cadastro real de alguém: isso é anotado, não é falha do roteiro.
  await etapa('contador de vagas intocado pelo roteiro', async () => {
    const depois = await fsGet('_signup/control');
    const igual = controleAntes && depois && ['limit', 'used', 'issued'].every((k) => controleAntes[k] === depois[k]);
    if (igual) ok(true, 'o contador de vagas (limit/used/issued) ficou exatamente igual', JSON.stringify({ limit: depois.limit, used: depois.used, issued: depois.issued }));
    else nota(`o contador mudou durante o teste (antes ${JSON.stringify({ used: controleAntes?.used, issued: controleAntes?.issued })}, depois ${JSON.stringify({ used: depois?.used, issued: depois?.issued })}): o roteiro não cria vagas, então foram cadastros reais no intervalo`);
    const slots = await Promise.all(Object.values(usuarios).filter((u) => u.uid).map((u) => fsGet(`_signup/control/slots/${u.uid}`)));
    ok(slots.every((x) => x === null), 'nenhuma conta de teste tem vaga em _signup/control/slots');
  });
  await etapa('verificação final: nenhum resíduo', async () => {
    await dorme(15_000);
    const uids = Object.values(usuarios).map((u) => u.uid).filter(Boolean);
    for (const u of Object.values(usuarios)) {
      const conta = await contaPorEmail(u.email);
      if (conta) residuos.push(`conta no Auth: ${u.rotulo}`);
      if (u.uid && (await fsGet(`users/${u.uid}`))) residuos.push(`users/${u.uid}`);
      if (u.uid && (await fsGet(`_signup/control/slots/${u.uid}`))) residuos.push(`vaga de ${u.rotulo}`);
      if ((await fsGet(`usernames/${u.username.toLowerCase()}`))) residuos.push(`usernames/${u.username}`);
    }
    for (const uid of uids) {
      for (const p of await fsQueryEstrita('posts', 'userId', uid)) residuos.push(`posts/${p.__id}`);
      for (const c of await fsQueryContem('conversations', 'participantIds', uid)) residuos.push(`conversations/${c.__id}`);
      for (const n of await fsQueryEstrita('notifications', 'recipientId', uid)) residuos.push(`notifications/${n.__id}`);
      for (const m of await fsQueryEstrita('media', 'ownerUid', uid)) residuos.push(`media/${m.__id}`);
      for (const prefixo of [`user_uploads/${uid}/`, `video_staging/${uid}/`]) for (const nome of await gcsLista(prefixo)) residuos.push(`objeto ${nome}`);
      const rt = await fetch(`${RTDB}/status/${uid}.json`, { headers: { Authorization: `Bearer ${garantirTokenAtual()}` } }).then((r) => r.ok ? r.json() : 'erro').catch(() => 'erro');
      if (rt !== null) residuos.push(`RTDB status/${uid}: ${rt === 'erro' ? 'não deu para ler' : 'ainda existe'}`);
    }
    for (const id of [ids.post, ids.comentario, ids.citacao, ids.mensagem, ids.arquivo, ids.invalido]) {
      if (id && (await fsGet(`media/${id}`))) residuos.push(`media/${id}`);
      if (id && (await fsGet(`videoUploads/${id}`))) residuos.push(`videoUploads/${id}`);
    }
    ok(residuos.length === 0, 'nenhum resíduo do teste em produção (contas, perfis, @, vagas, posts, mensagens, mídia, objetos, presença)', residuos.join(', '));
  });
}

secao('Resumo');
for (const u of Object.values(usuarios)) {
  const erros = [...u.visto.erros.entries()].slice(0, 6).map(([k, n]) => `${n}x ${k}`);
  const ruins = [...u.visto.respostasRuins.entries()].slice(0, 8).map(([k, n]) => `${n}x ${k}`);
  nota(`${u.rotulo}: e-mails abortados no navegador=${u.visto.emailsAbortados}; erros no console=${u.visto.erros.size}; respostas 4xx/5xx=${u.visto.respostasRuins.size}`);
  if (erros.length) nota(`   console: ${erros.join(' | ')}`);
  if (ruins.length) nota(`   http: ${ruins.join(' | ')}`);
}
nota(`capturas de tela em ${SAIDA}`);
console.log(`\n${verificacoes - falhas}/${verificacoes} verificações OK, ${falhas} falha(s).`);
} finally {
  try {
    if (MANTER) {
      console.error('ATENÇÃO: --manter ativo; a reversão automática foi desabilitada explicitamente.');
      for (const u of Object.values(usuarios)) {
        if (u.uid) console.error(`recurso mantido: conta ${u.rotulo}, uid=${u.uid}, username=${u.username}`);
      }
      console.error(`ids mantidos: ${JSON.stringify(ids)}`);
    } else if (!reversaoConcluida) {
      nota('finally: executando reversão obrigatória após falha ou interrupção');
      await reverter();
      reversaoConcluida = true;
      ok(true, 'reversão de emergência concluída');
    }
  } catch (erro) {
    falhas++;
    verificacoes++;
    console.error(`FALHA CRÍTICA na reversão: ${String(erro?.message ?? erro).split('\n')[0].slice(0, 300)}`);
  } finally {
    await navegador.close().catch(() => {});
  }
}
process.exitCode = falhas ? 1 : 0;
