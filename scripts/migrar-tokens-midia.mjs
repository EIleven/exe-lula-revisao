#!/usr/bin/env node
/**
 * Migra a mídia antiga para a camada de URLs próprias e REVOGA os tokens permanentes da mídia privada.
 *
 *   node scripts/migrar-tokens-midia.mjs                               emuladores, inventário (só lê)
 *   node scripts/migrar-tokens-midia.mjs --producao                    produção, inventário (só lê)
 *   node scripts/migrar-tokens-midia.mjs --producao --fase=backup      exporta o que vai mudar
 *   node scripts/migrar-tokens-midia.mjs --producao --fase=registrar   cria media/{id} do que falta
 *   node scripts/migrar-tokens-midia.mjs --producao --fase=reescrever  troca as URLs gravadas
 *   node scripts/migrar-tokens-midia.mjs --producao --fase=revogar     apaga o token dos PRIVADOS
 *   node scripts/migrar-tokens-midia.mjs --producao --fase=restaurar --de=<arquivo>
 *   node scripts/migrar-tokens-midia.mjs --producao --conferir         confere o estado final
 *
 *   --aplicar          sem isto NENHUMA fase grava: só mostra o plano
 *   --limite=2000      examina no máximo N objetos do Storage
 *   --saida=<pasta>    onde salvar o backup (padrão: fora do repositório)
 *
 * Em produção o token de acesso vem de FIRESTORE_ACCESS_TOKEN (gcloud auth print-access-token) e NUNCA é impresso.
 * O arquivo de backup contém as URLs antigas, e portanto os tokens de download: é dado sensível.
 *
 * POR QUE EXISTE: até 2026-11-11 todo upload recebia `getDownloadURL()`, que embute em
 * `firebaseStorageDownloadTokens` um token permanente. Esse token funciona sem login, ignora as regras do Storage,
 * não expira e não se revoga ao bloquear alguém ou excluir a conta.
 *
 * A ORDEM DAS FASES NÃO É OPCIONAL:  backup → registrar → reescrever → conferir à mão → revogar
 * Revogar o token de um objeto cuja URL antiga ainda está gravada quebra o anexo na hora; o script ABORTA se
 * mandarem fazer isso.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const { classifyMediaInventory, pseudonymizeStoragePath, pseudonymizeDocumentPath } = await import(
  '../src/lib/media/mediaInventory.ts'
);
const {
  preconditionFor,
  countUnprotected,
  conflictingDocuments,
  isPreconditionFailure,
  decideRevert,
} = await import('../src/lib/media/migrationSafety.ts');
const {
  kindFromPath,
  visibilityForKind,
  generateMediaId,
  privateMediaPath,
  publicMediaUrl,
  mediaIdFromUrl,
  isValidStoragePath,
} = await import(
  '../src/lib/media/mediaId.ts'
);
// A leitura da URL antiga vive em módulo próprio para o teste poder exercitá-la: este script tem efeito no topo e
// por isso não pode ser importado.
const { caminhoDaUrlAntiga } = await import('../src/lib/media/legacyUrl.ts');

const flag = (nome) => process.argv.slice(2).find((a) => a.startsWith(`${nome}=`))?.slice(nome.length + 1);
const args = new Set(process.argv.slice(2));
const PROD = args.has('--producao');
const APLICAR = args.has('--aplicar');
const CONFERIR = args.has('--conferir');
const LIMITE = Number(flag('--limite') ?? '0') || Infinity;
const FASE = CONFERIR ? 'conferir' : (flag('--fase') ?? 'inventario');
const DE = flag('--de');
/** Onde gravar o mapeamento um a um da reescrita. Sem isto, só sai uma amostra pseudonimizada no terminal. */
const MAPA = flag('--mapa');
/** Onde gravar o manifesto dos registros criados. Padrão: junto do backup, fora do repositório. */
const MANIFESTO = flag('--manifesto');
/**
 * Seam de teste: pausa antes do primeiro commit, para o teste poder editar um documento entre a leitura e a
 * escrita e provar que a pré-condição de `updateTime` detecta a colisão. Ignorado em produção, sempre.
 */
const PAUSA_ANTES_DO_COMMIT = PROD ? 0 : Number(process.env.MIGRAR_MIDIA_PAUSA_MS ?? '0') || 0;
/**
 * Escopo do backup e do reescrever. O caminhador recursivo revelou 4233 referencias legadas, e a esmagadora
 * maioria NAO e midia: e copia desnormalizada de avatar em posts, notificacoes e conversas. Reescrever 4233
 * documentos para corrigir 19 objetos privados seria risco sem retorno.
 *
 * 'privado' (padrao): so as referencias a objeto PRIVADO. Sao essas, e so essas, que PRECISAM ser reescritas antes
 *   da revogacao, porque revogar sem reescrever quebraria o anexo. Concluido em 2026-11-11.
 * 'publico': so as referencias a objeto PUBLICO. Troca a URL do Firebase pela nossa, e por isso para de expor UID,
 *   host do Storage e caminho interno em cada avatar, capa e midia de post. NAO revoga token: a URL publica antiga
 *   continua funcionando, e compartilhamento externo antigo nao quebra.
 * 'tudo': as duas.
 *
 * Em QUALQUER escopo, referencia cujo objeto nao existe mais fica FORA do alvo e e relatada a parte: registrar nao
 * tem o que registrar, reescrever apontaria para um registro que serviria 404, e a conferencia travaria para sempre.
 */
const ESCOPO = flag('--escopo') ?? 'privado';
if (!['privado', 'publico', 'tudo'].includes(ESCOPO)) {
  console.error("--escopo precisa ser 'privado', 'publico' ou 'tudo'");
  process.exit(2);
}

const FASES = ['inventario', 'backup', 'registrar', 'reescrever', 'revogar', 'restaurar', 'conferir'];
if (!FASES.includes(FASE)) {
  console.error(`--fase precisa ser uma de: ${FASES.join(', ')}`);
  process.exit(2);
}

const PROJECT = PROD ? 'echo-b5aw9' : 'demo-soberan';
const DATABASE = 'echo-db-124325';
// O nome do bucket do Storage Emulator é montado em partes porque o literal inteiro contém a sequência do domínio
// antigo e o `npm run check:domain` o reprova. Não é domínio nosso: é o nome lógico do emulador.
const BUCKET_EMULADOR = ['demo-soberan', 'appspot', 'com'].join('.');
const BUCKET = PROD ? 'echo-b5aw9.firebasestorage.app' : BUCKET_EMULADOR;
const FS_HOST = PROD
  ? 'https://firestore.googleapis.com'
  : `http://${process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'}`;
const GCS_HOST = PROD
  ? 'https://storage.googleapis.com'
  : `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:9199'}`;
const ROOT = `projects/${PROJECT}/databases/${DATABASE}/documents`;
const MEDIA_ORIGIN = 'https://media.exercitodolula.app';
const WRITES_PER_COMMIT = 400;

/** Fora do repositório de propósito: backup com token dentro não entra em Git nem por acidente. */
const BACKUP_PADRAO = join(homedir(), 'soberan-backups');
const SAIDA = flag('--saida') ?? BACKUP_PADRAO;

/**
 * Coleções varridas. A varredura é RECURSIVA por todos os campos de cada documento, então campo novo ou estrutura
 * diferente é encontrado sem precisar listar o campo aqui — foi assim que apareceram as URLs em `users.avatarUrl`,
 * que a contagem manual anterior deixou de fora.
 */
const COLECOES = ['users', 'posts', 'comments', 'messages', 'conversations', 'userFiles', 'drafts', 'notifications'];

/**
 * URL antiga embutida num texto maior. Para em espaço, aspas, `<`, `>` e `)` — o que delimita um atributo de HTML e
 * um link de Markdown. Não serve para validar: quem valida é `caminhoDaUrlAntiga`, que compara o hostname exato.
 * Isto só acha os candidatos dentro da string.
 */
const URL_ANTIGA_EMBUTIDA = /https?:\/\/firebasestorage\.googleapis\.com\/[^\s"'<>)]+/g;
/** URL própria dentro de HTML. Sem isto, depois da migração os seis objetos embutidos parecem sem referência. */
const URL_PROPRIA_EMBUTIDA =
  /https?:\/\/media\.exercitodolula\.app\/m(?:p)?\/[A-Za-z0-9_-]{22}(?![A-Za-z0-9_-])/g;

const token = PROD ? process.env.FIRESTORE_ACCESS_TOKEN : 'owner';
if (!token) {
  console.error('Defina FIRESTORE_ACCESS_TOKEN com um token da conta dona do projeto (o valor não é impresso).');
  process.exit(2);
}
const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  ...(PROD ? { 'x-goog-user-project': PROJECT } : {}),
};

async function call(method, url, body) {
  const resposta = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const texto = await resposta.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* corpo não JSON */ }
  if (!resposta.ok) {
    const limpo = url.replace(GCS_HOST, '').replace(FS_HOST, '');
    const erro = new Error(`${method} ${limpo} -> HTTP ${resposta.status}: ${json?.error?.message ?? texto.slice(0, 200)}`);
    erro.status = resposta.status;
    // O `status` do CORPO (`FAILED_PRECONDITION`, `NOT_FOUND`, …) é a fonte confiável para distinguir colisão de
    // pré-condição de falha de rede. A mensagem do Firestore para colisão é "the stored version (…) does not match
    // the required base version (…)" e não contém a palavra "precondition", então texto sozinho não serve.
    erro.firestoreStatus = json?.error?.status;
    throw erro;
  }
  return json;
}
const firestore = (method, caminho, body) => call(method, `${FS_HOST}/v1/${caminho}`, body);

const str = (v) => v?.stringValue;
const idDe = (doc) => doc.name.split('/').pop();
const curto = (nome) => nome.replace(`${ROOT}/`, '');

// ───────────────── Caminhador recursivo ─────────────────

/**
 * Percorre TODOS os valores de texto de um documento, em qualquer profundidade, devolvendo o caminho de cada um
 * (`media[0].url`, `authorDetails.avatarUrl`, ...).
 *
 * É isto que garante que nenhuma referência fique de fora por diferença de estrutura: não existe lista de campos
 * para alguém esquecer de atualizar.
 */
function* valoresDeTexto(fields, prefixo = '') {
  for (const [chave, valor] of Object.entries(fields ?? {})) {
    yield* valorRecursivo(valor, prefixo ? `${prefixo}.${chave}` : chave);
  }
}

function* valorRecursivo(valor, caminho) {
  if (valor == null) return;
  if (valor.stringValue !== undefined) {
    yield { caminho, texto: valor.stringValue };
    return;
  }
  if (valor.mapValue) {
    yield* valoresDeTexto(valor.mapValue.fields, caminho);
    return;
  }
  if (valor.arrayValue) {
    const itens = valor.arrayValue.values ?? [];
    for (let i = 0; i < itens.length; i++) yield* valorRecursivo(itens[i], `${caminho}[${i}]`);
  }
}

/** Campo de primeiro nível: `media[0].url` -> `media`. É o que o updateMask aceita. */
const campoRaiz = (caminho) => caminho.split(/[.[]/)[0];

/**
 * Troca UMA ocorrência de `de` por `para` DENTRO do texto que está no caminho. É o que a URL embutida em HTML
 * exige: o campo `posts.text` é um documento inteiro, e trocar o valor todo apagaria o post.
 *
 * Uma ocorrência por chamada, e não todas, porque cada ocorrência tem seu próprio registro de referência — é assim
 * que a contagem fecha e que o backup sabe quantas trocas esperar. A substituição vai por função para `$&` e
 * companhia não serem interpretados.
 */
function trocarTextoNoCaminho(fields, caminho, de, para) {
  const atual = lerTextoNoCaminho(fields, caminho);
  if (typeof atual !== 'string' || !atual.includes(de)) return false;
  return trocarNoCaminho(fields, caminho, atual.replace(de, () => para));
}

/** Lê o texto que está num caminho, para a troca parcial saber o que havia antes. */
function lerTextoNoCaminho(fields, caminho) {
  const partes = caminho.match(/[^.[\]]+/g) ?? [];
  let atual = { mapValue: { fields } };
  for (const parte of partes) {
    if (/^\d+$/.test(parte)) {
      const itens = atual?.arrayValue?.values;
      if (!Array.isArray(itens)) return undefined;
      atual = itens[Number(parte)];
    } else {
      const mapa = atual?.mapValue?.fields;
      if (!mapa) return undefined;
      atual = mapa[parte];
    }
    if (atual === undefined) return undefined;
  }
  return atual?.stringValue;
}

/** Troca o texto num caminho, dentro da estrutura do documento. Devolve true se trocou. */
function trocarNoCaminho(fields, caminho, novoTexto) {
  const partes = caminho.match(/[^.[\]]+/g) ?? [];
  let atual = { mapValue: { fields } };
  for (let i = 0; i < partes.length; i++) {
    const parte = partes[i];
    const ultimo = i === partes.length - 1;
    const indice = /^\d+$/.test(parte) ? Number(parte) : null;

    if (indice !== null) {
      const itens = atual?.arrayValue?.values;
      if (!itens || !itens[indice]) return false;
      if (ultimo) {
        if (itens[indice].stringValue === undefined) return false;
        itens[indice].stringValue = novoTexto;
        return true;
      }
      atual = itens[indice];
      continue;
    }

    const mapa = atual?.mapValue?.fields;
    if (!mapa || mapa[parte] === undefined) return false;
    if (ultimo) {
      if (mapa[parte].stringValue === undefined) return false;
      mapa[parte].stringValue = novoTexto;
      return true;
    }
    atual = mapa[parte];
  }
  return false;
}

// ───────────────── Leitura ─────────────────

async function* objetos() {
  let pageToken = '';
  let vistos = 0;
  do {
    const q = new URLSearchParams({ prefix: 'user_uploads/', maxResults: '500' });
    if (pageToken) q.set('pageToken', pageToken);
    const pagina = await call('GET', `${GCS_HOST}/storage/v1/b/${BUCKET}/o?${q}`);
    for (const item of pagina?.items ?? []) {
      if (vistos >= LIMITE) return;
      vistos++;
      yield item;
    }
    pageToken = pagina?.nextPageToken ?? '';
  } while (pageToken);
}

/** Grupo de coleções inteiro, com todos os campos (precisamos reescrever estruturas aninhadas). */
async function grupoDeColecoes(collectionId) {
  const docs = [];
  let cursor = null;
  for (;;) {
    const structuredQuery = {
      from: [{ collectionId, allDescendants: true }],
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: 200,
      ...(cursor ? { startAt: { values: [{ referenceValue: cursor }], before: false } } : {}),
    };
    let resposta;
    try {
      resposta = await firestore('POST', `${ROOT}:runQuery`, { structuredQuery });
    } catch (erro) {
      if (erro.status === 404) return docs;
      throw erro;
    }
    const pagina = (resposta ?? []).map((l) => l.document).filter(Boolean);
    if (pagina.length === 0) break;
    docs.push(...pagina);
    cursor = pagina[pagina.length - 1].name;
    if (pagina.length < 200) break;
  }
  return docs;
}

/**
 * Varre o conteúdo UMA vez e colhe as duas formas de referência:
 *
 * - **legada**: URL do Firebase com token embutido. É o que a migração troca.
 * - **própria**: `/m/<id>` ou `/mp/<id>`. É o estado final, e precisa ser contada — não contá-la foi exatamente o
 *   erro do inventário anterior, que depois da migração chamou de órfão todo objeto migrado.
 *
 * Um passo só porque o passo é caro: são oito grupos de coleções e milhares de documentos, e varrer duas vezes
 * dobraria o custo para ler os mesmos campos.
 */
async function lerReferencias() {
  const porColecao = new Map();
  const legadas = [];
  const proprias = [];
  for (const colecao of COLECOES) {
    const docs = await grupoDeColecoes(colecao);
    let achadasLegadas = 0;
    let achadasProprias = 0;
    let achadasEmbutidas = 0;
    for (const doc of docs) {
      for (const { caminho, texto } of valoresDeTexto(doc.fields)) {
        const storagePath = caminhoDaUrlAntiga(texto);
        if (storagePath) {
          legadas.push({ colecao, doc, caminho, urlAntiga: texto, storagePath, embutida: false });
          achadasLegadas++;
          continue;
        }
        const propria = mediaIdFromUrl(texto);
        if (propria) {
          proprias.push({
            colecao,
            doc,
            caminho,
            id: propria.id,
            visibility: propria.visibility,
            where: `${curto(doc.name)} · ${caminho}`,
          });
          achadasProprias++;
          continue;
        }
        // URL antiga DENTRO de um texto maior — `<img src="...">` no HTML do post. `caminhoDaUrlAntiga` exige que a
        // string inteira seja a URL (`new URL(string)`), então estas eram invisíveis para o inventário. Em produção
        // são poucas, mas são justamente as que alimentam o card externo quando o post não tem mídia anexada
        // (`extractFirstMediaFromHtml`). Uma referência por OCORRÊNCIA: é assim que a contagem fecha.
        for (const bruta of texto.match(URL_ANTIGA_EMBUTIDA) ?? []) {
          const caminhoEmbutido = caminhoDaUrlAntiga(bruta);
          if (!caminhoEmbutido) continue;
          legadas.push({
            colecao,
            doc,
            caminho,
            urlAntiga: bruta,
            storagePath: caminhoEmbutido,
            embutida: true,
          });
          achadasLegadas++;
          achadasEmbutidas++;
        }
        // A mesma cobertura precisa existir para o estado final. Depois que a URL antiga é trocada dentro do HTML,
        // `mediaIdFromUrl(texto inteiro)` não casa porque `texto` é o post completo. Sem esta segunda varredura o
        // inventário chama os objetos recém-migrados de "registrados sem referência".
        for (const bruta of texto.match(URL_PROPRIA_EMBUTIDA) ?? []) {
          const propriaEmbutida = mediaIdFromUrl(bruta);
          if (!propriaEmbutida) continue;
          proprias.push({
            colecao,
            doc,
            caminho,
            id: propriaEmbutida.id,
            visibility: propriaEmbutida.visibility,
            where: `${curto(doc.name)} · ${caminho} (embutida)`,
          });
          achadasProprias++;
          achadasEmbutidas++;
        }
      }
    }
    porColecao.set(colecao, {
      documentos: docs.length,
      referencias: achadasLegadas,
      proprias: achadasProprias,
      embutidas: achadasEmbutidas,
    });
  }
  return { porColecao, legadas, proprias };
}

async function gravar(writes) {
  if (!APLICAR || writes.length === 0) return 0;
  for (let i = 0; i < writes.length; i += WRITES_PER_COMMIT) {
    await firestore('POST', `${ROOT}:commit`, { writes: writes.slice(i, i + WRITES_PER_COMMIT) });
  }
  return writes.length;
}

/**
 * Grava em lotes com pré-condição de `updateTime`, e ABORTA na primeira colisão.
 *
 * O commit do Firestore é atômico por lote: um documento desatualizado reprova o lote inteiro e NADA dele é
 * gravado. Isso é o que se quer — o que falta é saber qual documento colidiu, porque a mensagem do Firestore não
 * diz. Então, ao reprovar, relemos os documentos daquele lote e comparamos o `updateTime` com o que usamos.
 *
 * Aborta a fase em vez de seguir: os lotes já comitados ficam, e rodar de novo retoma de onde parou, porque a
 * varredura só acha o que ainda está em URL antiga. Seguir adiante depois de uma colisão significaria gravar
 * baseado numa leitura que já se sabe desatualizada.
 */
async function gravarComPreCondicao(writes, updateTimePorDocumento) {
  if (!APLICAR || writes.length === 0) return { gravados: 0, conflitos: [], abortado: false };
  let gravados = 0;
  for (let i = 0; i < writes.length; i += WRITES_PER_COMMIT) {
    const lote = writes.slice(i, i + WRITES_PER_COMMIT);
    // Seam de teste, impossível em produção: dá tempo de o teste editar um documento entre a leitura e o commit.
    if (!PROD && PAUSA_ANTES_DO_COMMIT > 0 && i === 0) {
      console.log(`(pausa de teste: ${PAUSA_ANTES_DO_COMMIT} ms antes do primeiro commit)`);
      await new Promise((r) => setTimeout(r, PAUSA_ANTES_DO_COMMIT));
    }
    try {
      await firestore('POST', `${ROOT}:commit`, { writes: lote });
      gravados += lote.length;
    } catch (erro) {
      if (!isPreconditionFailure(erro)) throw erro;
      const nomes = lote.map((w) => w.update.name);
      const lidos = new Map(nomes.map((n) => [n, updateTimePorDocumento.get(n)]));
      const atuais = new Map();
      for (const nome of nomes) {
        const atual = await firestore('GET', nome).catch((erro) => {
          if (erro?.status === 404) return null;
          throw erro;
        });
        atuais.set(nome, atual?.updateTime ?? null);
      }
      const conflitos = conflictingDocuments(lidos, atuais);
      console.error('');
      console.error(`ABORTADO por escrita concorrente no lote ${Math.floor(i / WRITES_PER_COMMIT) + 1}.`);
      console.error(`Nada deste lote foi gravado (o commit é atômico). Lotes anteriores: ${gravados} documentos.`);
      console.error(`Documentos alterados desde a leitura: ${conflitos.length}`);
      for (const c of conflitos.slice(0, 20)) {
        console.error(`  ${pseudonymizeDocumentPath(curto(c.documento))} · ${c.tipo}` +
          ` · lido ${c.esperado} · agora ${c.atual ?? '(removido)'}`);
      }
      if (conflitos.length > 20) console.error(`  … e ${conflitos.length - 20} outros`);
      if (conflitos.length === 0) {
        console.error('  (nenhum updateTime divergiu: a colisão pode ter sido num documento sem proteção)');
      }
      console.error('');
      console.error('Rode a MESMA fase de novo: a leitura é refeita e só o que ainda está em URL antiga é tocado.');
      return { gravados, conflitos, abortado: true };
    }
  }
  return { gravados, conflitos: [], abortado: false };
}

const ownerDoCaminho = (caminho) => caminho.split('/')[1] ?? '';

/**
 * Restringe um arquivo ao dono. O `mode: 0o600` do `writeFileSync` é NO-OP no Windows: o NTFS não implementa
 * permissão POSIX e o arquivo sai legível por SISTEMA e por Administradores. O equivalente real é tirar a herança
 * da lista de controle de acesso e deixar só o usuário. Vale para o backup e para o manifesto: os dois correlacionam
 * dono e objeto.
 */
function restringirAoDono(destino) {
  if (process.platform !== 'win32') return 'posix 600';
  try {
    const BARRA = String.fromCharCode(92);
    const usuario = [process.env.USERDOMAIN, process.env.USERNAME].filter(Boolean).join(BARRA);
    execFileSync('icacls', [destino, '/inheritance:r', '/grant:r', `${usuario}:(R,W)`], { stdio: 'ignore' });
    return `ACL restrita a ${usuario}`;
  } catch {
    return 'FALHA ao restringir a ACL — proteja o arquivo a mao';
  }
}

console.log(`alvo: ${PROD ? 'PRODUÇÃO' : 'emuladores'} · ${PROJECT} · bucket ${BUCKET}`);
console.log(`fase: ${FASE} · modo: ${APLICAR ? 'GRAVAR' : 'somente leitura'}`);
if (LIMITE !== Infinity) console.log(`limite: ${LIMITE} objetos`);
if (['backup', 'registrar', 'reescrever'].includes(FASE)) console.log(`escopo: ${ESCOPO}`);
console.log('');

// ───────────────── Fase: restaurar (não varre o bucket; lê só os registros media/) ─────────────────

if (FASE === 'restaurar') {
  if (!DE || !existsSync(DE)) {
    console.error('Informe --de=<arquivo de backup>. O arquivo precisa existir.');
    process.exit(2);
  }
  const linhas = readFileSync(DE, 'utf8').split('\n').filter((l) => l.trim());
  let cabecalho;
  try { cabecalho = JSON.parse(linhas[0]); } catch { cabecalho = null; }
  if (cabecalho?.tipo !== 'cabecalho-backup-midia') {
    console.error('Arquivo não parece um backup desta migração (cabeçalho ausente).');
    process.exit(2);
  }
  const corpo = linhas.slice(1).join('\n');
  const registros = linhas.slice(1).map((l) => JSON.parse(l));
  const sha256 = createHash('sha256').update(corpo).digest('hex');

  console.log(`backup de ${cabecalho.criadoEm} · projeto ${cabecalho.projeto}`);
  console.log(`registros: ${registros.length} (cabeçalho diz ${cabecalho.registros})`);
  console.log(`sha256 calculado: ${sha256}`);
  console.log(`sha256 esperado:  ${cabecalho.sha256}`);
  if (sha256 !== cabecalho.sha256 || registros.length !== cabecalho.registros) {
    console.error('\nINTEGRIDADE FALHOU: o arquivo foi alterado. Restauração abortada.');
    process.exit(1);
  }
  if (cabecalho.projeto !== PROJECT) {
    console.error(`\nABORTADO: backup é do projeto ${cabecalho.projeto}, e o alvo é ${PROJECT}.`);
    process.exit(1);
  }
  console.log('integridade OK\n');

  // Reversão por SUBSTITUIÇÃO INVERSA, e não regravando o campo raiz do backup.
  //
  // O backup guarda o campo raiz inteiro de ANTES da migração. Regravá-lo desfaz, junto com a URL, tudo o que a
  // pessoa mudou naquele campo depois: post editado, avatar trocado de novo, participante que entrou na conversa.
  // Aqui lemos o documento AGORA, trocamos somente o valor que a migração escreveu, e só se ele ainda estiver lá.
  // Quem mudou depois é deixado em paz e relatado.
  //
  // Qual era o valor que a migração escreveu? Ele não está no backup — o backup é anterior ao `registrar`. Sai do
  // registro: o caminho do objeto é conhecido, e `media/{id}.storagePath` o traduz de volta para o id, e o id para
  // a URL. É também por isso que o manifesto do `registrar` existe.
  const registrosMediaRestaurar = await grupoDeColecoes('media');
  const idPorCaminho = new Map();
  for (const doc of registrosMediaRestaurar) {
    const caminho = str(doc.fields?.storagePath);
    if (caminho) idPorCaminho.set(caminho, { id: idDe(doc), visibility: str(doc.fields?.visibility) });
  }

  const writes = [];
  const updateTimePorDocumento = new Map();
  let revertidas = 0;
  let jaRevertidas = 0;
  const mudaramDepois = [];
  const semRegistro = [];
  const documentosSumidos = [];

  for (const r of registros) {
    const atual = await firestore('GET', r.documento).catch(() => null);
    if (!atual) { documentosSumidos.push(r.documento); continue; }
    const raizes = new Set();
    for (const { caminho, urlAntiga, embutida: embutidaNoBackup = false } of r.valoresAnteriores) {
      const caminhoObjeto = caminhoDaUrlAntiga(urlAntiga);
      const registro = caminhoObjeto ? idPorCaminho.get(caminhoObjeto) : null;
      if (!registro) { semRegistro.push(`${curto(r.documento)} · ${caminho}`); continue; }
      const migrado = registro.visibility === 'public'
        ? publicMediaUrl(registro.id, MEDIA_ORIGIN)
        : privateMediaPath(registro.id);
      const valorAgora = lerTextoNoCaminho(atual.fields, caminho);
      // Embutida: a URL vive dentro de um texto maior, então comparar por igualdade nunca casaria.
      // Backups novos registram isso explicitamente. A heurística mantém compatibilidade com backup antigo sem o
      // campo, reconhecendo tanto a URL migrada quanto a já restaurada dentro de um texto maior.
      const embutida = embutidaNoBackup || (
        typeof valorAgora === 'string' && valorAgora !== migrado && valorAgora !== urlAntiga &&
        (valorAgora.includes(migrado) || valorAgora.includes(urlAntiga))
      );
      const decisao = decideRevert(valorAgora, migrado, urlAntiga, embutida);
      if (decisao.acao === 'ja-revertido') { jaRevertidas++; continue; }
      if (decisao.acao === 'mudou-depois') {
        mudaramDepois.push(`${curto(r.documento)} · ${caminho}`);
        continue;
      }
      if (trocarNoCaminho(atual.fields, caminho, decisao.valor)) {
        raizes.add(campoRaiz(caminho));
        revertidas++;
      }
    }
    if (raizes.size === 0) continue;
    const fields = {};
    for (const raiz of raizes) fields[raiz] = atual.fields[raiz];
    updateTimePorDocumento.set(atual.name, atual.updateTime);
    writes.push({
      update: { name: atual.name, fields },
      updateMask: { fieldPaths: [...raizes] },
      currentDocument: preconditionFor(atual.updateTime),
    });
  }

  console.log(`referências a reverter ....... ${revertidas}`);
  console.log(`já estavam no valor anterior . ${jaRevertidas}`);
  console.log(`mudaram depois (NÃO tocadas) . ${mudaramDepois.length}`);
  for (const m of mudaramDepois.slice(0, 10)) console.log(`    ${pseudonymizeDocumentPath(m)}`);
  if (mudaramDepois.length > 10) console.log(`    … e ${mudaramDepois.length - 10} outras`);
  if (semRegistro.length) {
    console.log(`sem registro media/ .......... ${semRegistro.length} (não há como saber o que a migração escreveu)`);
  }
  if (documentosSumidos.length) console.log(`documentos que não existem mais ${documentosSumidos.length}`);
  console.log(`documentos a atualizar ....... ${writes.length}`);

  const restauracaoSemProtecao = countUnprotected(
    writes.map((w) => updateTimePorDocumento.get(w.update.name)),
  );
  if (restauracaoSemProtecao > 0) {
    console.error(`\nABORTADO: ${restauracaoSemProtecao} documentos sem updateTime na restauração.`);
    console.error('Nenhuma restauração será gravada sem proteção contra escrita concorrente.');
    process.exit(1);
  }

  if (!APLICAR) {
    console.log('\nnada gravado (falta --aplicar). Este dry-run já provou a integridade do arquivo.');
    process.exit(0);
  }
  const resultadoRestauracao = await gravarComPreCondicao(writes, updateTimePorDocumento);
  if (resultadoRestauracao.abortado) {
    console.log(`\nRESTAURADOS antes de abortar: ${resultadoRestauracao.gravados} documentos`);
    process.exit(1);
  }
  console.log(`RESTAURADOS: ${resultadoRestauracao.gravados} documentos · ${revertidas} referências`);
  console.log('\nATENÇÃO: restaurar o banco NÃO recupera token já revogado. Ver docs/midia-privada.md.');
  process.exit(0);
}

// ───────────────── Inventário ─────────────────

const inventario = [];
for await (const item of objetos()) {
  const caminho = item.name;
  const kind = kindFromPath(caminho);
  inventario.push({
    caminho,
    kind,
    visibility: visibilityForKind(kind),
    contentType: item.contentType ?? 'application/octet-stream',
    size: Number(item.size ?? 0),
    ownerUid: ownerDoCaminho(caminho),
    temToken: Boolean(item.metadata?.firebaseStorageDownloadTokens),
  });
}

const porTipo = {};
for (const o of inventario) {
  const chave = `${o.kind} (${o.visibility})`;
  porTipo[chave] ??= { total: 0, comToken: 0 };
  porTipo[chave].total++;
  if (o.temToken) porTipo[chave].comToken++;
}

console.log('objetos no Storage:');
for (const [chave, n] of Object.entries(porTipo).sort()) {
  console.log(`  ${chave.padEnd(22)} ${String(n.total).padStart(5)} objetos · ${String(n.comToken).padStart(5)} com token`);
}
const privadosComToken = inventario.filter((o) => o.visibility === 'private' && o.temToken);
const publicosComToken = inventario.filter((o) => o.visibility === 'public' && o.temToken);
console.log(`  ${'TOTAL'.padEnd(22)} ${String(inventario.length).padStart(5)} objetos`);
console.log('');
console.log(`PRIVADOS com token .... ${privadosComToken.length}  <- a exposição`);
console.log(`públicos com token .... ${publicosComToken.length}  <- redundante, NÃO revogado`);
console.log('');

const { porColecao, legadas: todas, proprias } = await lerReferencias();

// Os registros `media/{id}` são lidos AQUI, e não mais depois da fase de inventário. Eles são uma das três origens
// de "alguém depende deste objeto", e sem eles o inventário classificava como órfão justamente o objeto migrado.
const registrosMedia = await grupoDeColecoes('media');
const porCaminho = new Map();
const registrosParaClassificar = [];
for (const doc of registrosMedia) {
  const caminho = str(doc.fields?.storagePath);
  const id = idDe(doc);
  registrosParaClassificar.push({
    id,
    storagePath: caminho,
    visibility: str(doc.fields?.visibility) || undefined,
    kind: str(doc.fields?.kind) || undefined,
    tombstoned: doc.fields?.deletedAt !== undefined,
  });
  if (caminho) porCaminho.set(caminho, { id, visibility: str(doc.fields?.visibility) });
}

console.log('referências legadas no Firestore, por coleção:');
for (const [colecao, n] of porColecao) {
  const marca = n.referencias > 0 ? ' <-' : '';
  const nossas = n.proprias > 0 ? ` · ${String(n.proprias).padStart(4)} próprias` : '';
  console.log(
    `  ${colecao.padEnd(16)} ${String(n.documentos).padStart(6)} docs · ${String(n.referencias).padStart(4)} refs${marca}${nossas}`,
  );
}

const porCampo = new Map();
for (const r of todas) {
  const chave = `${r.colecao}.${r.caminho.replace(/\[\d+\]/g, '[]')}`;
  porCampo.set(chave, (porCampo.get(chave) ?? 0) + 1);
}
console.log('');
console.log('referências legadas por CAMPO (descoberto, não listado à mão):');
for (const [campo, n] of [...porCampo].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${campo.padEnd(36)} ${String(n).padStart(4)}`);
}
console.log('');
console.log(`TOTAL de referências legadas: ${todas.length}`);

console.log(`TOTAL de referências próprias (/m/ e /mp/): ${proprias.length}`);

// ───────────────── Classificação ─────────────────
//
// A conta de órfão era `objeto sem referência LEGADA`, e isso passou a estar errado no instante em que a migração
// trocou as URLs: depois dela nenhum objeto migrado tem referência legada. O cálculo correto cruza as três origens
// e vive em `src/lib/media/mediaInventory.ts`, como lógica pura, para o teste poder exercitar cada categoria.
const relatorio = classifyMediaInventory({
  objects: inventario.map((o) => ({
    path: o.caminho,
    kind: o.kind,
    visibility: o.visibility,
    hasToken: o.temToken,
    size: o.size,
  })),
  registrations: registrosParaClassificar,
  legacyReferences: todas.map((r) => ({ storagePath: r.storagePath, where: `${curto(r.doc.name)} · ${r.caminho}` })),
  ownReferences: proprias.map((r) => ({ id: r.id, visibility: r.visibility, where: r.where })),
  isValidStoragePath,
});

const privados = (lista) => lista.filter((o) => o.visibility === 'private').length;
const exemplos = (lista, quantos = 3) =>
  lista.slice(0, quantos).map((o) => `    ${pseudonymizeStoragePath(o.path ?? o.storagePath ?? '')}`);

console.log('');
console.log('registros media/ existentes: ' + relatorio.totals.registrations +
  `  (válidos: ${relatorio.totals.validRegistrations} · com tombstone: ${relatorio.tombstonedRegistrations.length})`);
console.log('');
console.log('CLASSIFICAÇÃO DE OBJETOS  (união de: referência legada + media.storagePath + /m/ e /mp/ resolvidas)');
console.log(`  ativo e corretamente referenciado ... ${String(relatorio.activeObjects.length).padStart(4)}  (privados: ${privados(relatorio.activeObjects)})`);
console.log(`    por URL própria (/m/ ou /mp/) ..... ${String(relatorio.activeByOwnUrl.length).padStart(4)}  <- estado final desejado`);
console.log(`    só por URL legada do Firebase ..... ${String(relatorio.activeByLegacyOnly.length).padStart(4)}  <- funciona, expõe UID e host; decisão declarada`);
console.log(`  registrado SEM referência de conteúdo ${String(relatorio.registeredWithoutReference.length).padStart(4)}  (privados: ${privados(relatorio.registeredWithoutReference)})`);
console.log(`  ÓRFÃO de verdade (sem ref, sem reg) . ${String(relatorio.orphanObjects.length).padStart(4)}  (privados: ${privados(relatorio.orphanObjects)})`);
console.log(`  ${'TOTAL'.padEnd(36)} ${String(relatorio.totals.objects).padStart(4)}`);

if (relatorio.orphanObjects.length) {
  console.log('  exemplos de órfão de verdade (caminho pseudonimizado):');
  for (const linha of exemplos(relatorio.orphanObjects, 5)) console.log(linha);
}
if (relatorio.registeredWithoutReference.length) {
  const comTombstone = relatorio.registeredWithoutReference.filter((o) => o.tombstoned).length;
  console.log(`  dos registrados sem referência, ${comTombstone} têm tombstone (exclusão pedida) e ` +
    `${relatorio.registeredWithoutReference.length - comTombstone} não`);
  for (const linha of exemplos(relatorio.registeredWithoutReference, 3)) console.log(linha);
}

if (relatorio.registeredWithToken.length) {
  console.log(`  dos objetos registrados, ${relatorio.registeredWithToken.length} AINDA têm token permanente ` +
    `(privados: ${privados(relatorio.registeredWithToken)})`);
  console.log('    contradição: o registro diz "servido pela nossa rota", e o token serve o mesmo objeto sem login');
  for (const o of relatorio.registeredWithToken.slice(0, 5)) {
    console.log(`    ${o.visibility.padEnd(7)} ${o.kind.padEnd(9)} ${pseudonymizeStoragePath(o.path)}`);
  }
}

console.log('');
console.log('CLASSIFICAÇÃO DE REGISTROS media/{id}');
console.log(`  registro órfão (objeto não existe) ... ${String(relatorio.orphanRegistrations.length).padStart(4)}`);
for (const motivo of ['caminho-invalido', 'objeto-ausente-com-tombstone', 'objeto-ausente-sem-tombstone']) {
  const quantos = relatorio.orphanRegistrations.filter((r) => r.problem === motivo).length;
  if (quantos) console.log(`    ${motivo.padEnd(32)} ${String(quantos).padStart(4)}`);
}
if (relatorio.orphanRegistrations.length) {
  console.log('  exemplos (id · caminho pseudonimizado · motivo):');
  for (const r of relatorio.orphanRegistrations.slice(0, 5)) {
    const caminho = r.storagePath ? pseudonymizeStoragePath(r.storagePath) : '(sem caminho)';
    console.log(`    ${r.id} · ${caminho} · ${r.problem}`);
  }
}
if (relatorio.duplicateRegistrationPaths.length) {
  console.log(`  ATENÇÃO: ${relatorio.duplicateRegistrationPaths.length} caminho(s) com mais de um registro`);
  for (const d of relatorio.duplicateRegistrationPaths.slice(0, 5)) {
    console.log(`    ${pseudonymizeStoragePath(d.storagePath)} · ids: ${d.ids.join(', ')}`);
  }
}

console.log('');
console.log('REFERÊNCIAS QUE NÃO RESOLVEM');
console.log(`  legada apontando para objeto inexistente .... ${String(relatorio.legacyReferencesWithoutObject.length).padStart(4)}`);
console.log(`  própria SEM registro media/ (404 para sempre) ${String(relatorio.danglingOwnReferences.length).padStart(4)}`);
console.log(`  própria para registro com tombstone (410) ... ${String(relatorio.ownReferencesToTombstoned.length).padStart(4)}`);
console.log(`  própria na rota errada (/m/ x /mp/) ......... ${String(relatorio.ownReferencesWithWrongRoute.length).padStart(4)}`);
for (const [nome, lista] of [
  ['legada sem objeto', relatorio.legacyReferencesWithoutObject],
  ['própria sem registro', relatorio.danglingOwnReferences],
  ['própria na rota errada', relatorio.ownReferencesWithWrongRoute],
]) {
  if (!lista.length) continue;
  console.log(`  exemplos · ${nome} (documento pseudonimizado):`);
  for (const r of lista.slice(0, 3)) console.log(`    ${pseudonymizeDocumentPath(r.where ?? '')}`);
}
console.log('');

// Divide por visibilidade do objeto apontado: e o que separa o obrigatorio do opcional.
const privadosNoBucketSet = new Set(inventario.filter((o) => o.visibility === 'private').map((o) => o.caminho));
const caminhosNoBucket = new Set(inventario.map((o) => o.caminho));
const refsPrivadas = todas.filter((r) => privadosNoBucketSet.has(r.storagePath));
const refsPublicas = todas.filter((r) => !privadosNoBucketSet.has(r.storagePath));
/**
 * Referência cujo objeto não existe mais. Fica FORA de qualquer alvo: não há o que registrar, reescrever apontaria
 * para um registro que serviria 404, e a conferência de cobertura travaria para sempre num item impossível.
 * Relatada à parte, nunca escondida — é imagem quebrada no conteúdo, e isso é informação.
 */
const refsSemObjeto = todas.filter((r) => !caminhosNoBucket.has(r.storagePath));
const refsPublicasMigraveis = refsPublicas.filter((r) => caminhosNoBucket.has(r.storagePath));
const refsPrivadasMigraveis = refsPrivadas.filter((r) => caminhosNoBucket.has(r.storagePath));

console.log('por visibilidade do objeto apontado:');
console.log(`  referências a objeto PRIVADO ... ${refsPrivadas.length}  <- obrigatório reescrever antes de revogar`);
console.log(`  referências a objeto público ... ${refsPublicas.length}  <- opcional; o token delas não é revogado`);
console.log('');

if (FASE === 'inventario') {
  console.log('nada foi alterado. Próxima fase: --fase=backup');
  console.log("Para o caminho crítico basta --escopo=privado (padrão); --escopo=tudo reescreve também as públicas.");
  process.exit(0);
}

/** O que backup e reescrever vao tratar, conforme o escopo. */
const alvo = ESCOPO === 'tudo'
  ? [...refsPrivadasMigraveis, ...refsPublicasMigraveis]
  : (ESCOPO === 'publico' ? refsPublicasMigraveis : refsPrivadasMigraveis);
console.log(`alvo desta fase (escopo ${ESCOPO}): ${alvo.length} referências`);
const foraDoAlvo = refsSemObjeto.filter((r) =>
  ESCOPO === 'tudo' ? true
    : (ESCOPO === 'publico' ? !privadosNoBucketSet.has(r.storagePath) : privadosNoBucketSet.has(r.storagePath)));
if (foraDoAlvo.length) {
  console.log(`fora do alvo por objeto inexistente: ${foraDoAlvo.length} referências (relatadas, não tocadas)`);
}
const embutidasNoAlvo = alvo.filter((r) => r.embutida).length;
if (embutidasNoAlvo) {
  console.log(`do alvo, ${embutidasNoAlvo} estão EMBUTIDAS em texto maior e serão trocadas por substring`);
}
console.log('');

// `registrosMedia` e `porCaminho` já foram lidos junto do inventário: eles são uma das três origens da
// classificação, e lê-los duas vezes custaria outro grupo de coleções inteiro.
console.log(`registros media/ aproveitados do inventário: ${porCaminho.size}`);
console.log('');

// ───────────────── Fase: backup ─────────────────

if (FASE === 'backup') {
  // Agrupado por documento: a restauração grava campos RAIZ inteiros, que é a única forma exata de desfazer
  // alteração dentro de array.
  const porDocumento = new Map();
  for (const r of alvo) {
    if (!porDocumento.has(r.doc.name)) {
      porDocumento.set(r.doc.name, { doc: r.doc, caminhos: [], raizes: new Set() });
    }
    const entrada = porDocumento.get(r.doc.name);
    entrada.caminhos.push({
      caminho: r.caminho,
      urlAntiga: r.urlAntiga,
      embutida: Boolean(r.embutida),
    });
    entrada.raizes.add(campoRaiz(r.caminho));
  }

  const linhas = [];
  for (const { doc, caminhos, raizes } of porDocumento.values()) {
    const camposAnteriores = {};
    for (const raiz of raizes) camposAnteriores[raiz] = doc.fields[raiz];
    linhas.push(JSON.stringify({
      documento: doc.name,
      campos: caminhos.map((c) => c.caminho),
      camposAnteriores,
      valoresAnteriores: caminhos,
    }));
  }

  const corpo = linhas.join('\n');
  const sha256 = createHash('sha256').update(corpo).digest('hex');
  const cabecalho = JSON.stringify({
    tipo: 'cabecalho-backup-midia',
    criadoEm: new Date().toISOString(),
    projeto: PROJECT,
    registros: linhas.length,
    referencias: alvo.length,
    escopo: ESCOPO,
    sha256,
    aviso: 'Contem URLs antigas com token de download. Dado sensivel: nao versionar, nao compartilhar.',
  });

  console.log(`documentos afetados .. ${linhas.length}`);
  console.log(`referências a salvar . ${alvo.length}`);
  console.log(`sha256 do corpo ...... ${sha256}`);
  // O escopo publico multiplica isto por quase duzentos em relacao ao privado: 21 documentos viraram milhares.
  // Dizer o tamanho ANTES de gravar evita descobrir no disco que o backup nao caberia ou nao seria revisavel.
  const mib = (corpo.length / 1024 / 1024).toFixed(2);
  console.log(`tamanho do corpo ..... ${mib} MiB (${corpo.length} bytes)`);
  const maiores = linhas.map((l) => l.length).sort((a, b) => b - a).slice(0, 3);
  console.log(`maior linha .......... ${((maiores[0] ?? 0) / 1024).toFixed(1)} KiB`);

  if (!APLICAR) {
    console.log('\nnada salvo (falta --aplicar).');
    process.exit(0);
  }

  mkdirSync(SAIDA, { recursive: true });
  const nome = `backup-midia-${PROJECT}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
  const destino = join(SAIDA, nome);
  writeFileSync(destino, `${cabecalho}\n${corpo}\n`, { encoding: 'utf8', mode: 0o600 });
  // O `mode: 0o600` acima e NO-OP no Windows: o NTFS nao implementa permissao POSIX e o arquivo sai 644.
  // O equivalente real e a lista de controle de acesso: tirar a heranca e deixar so o dono. Sem isto o backup
  // — que contem tokens — fica legivel por SISTEMA e por Administradores.
  const permissao = restringirAoDono(destino);

  console.log(`\nSALVO EM: ${destino}`);
  console.log(`registros: ${linhas.length} · sha256: ${sha256}`);
  console.log(`O arquivo contem tokens. Fora do Git, fora de compartilhamento. Protecao: ${permissao}`);
  console.log('\nTeste a restauração em dry-run ANTES de seguir:');
  console.log(`  node scripts/migrar-tokens-midia.mjs ${PROD ? '--producao ' : ''}--fase=restaurar --de="${destino}"`);
  process.exit(0);
}

// ───────────────── Fase: registrar ─────────────────

if (FASE === 'registrar') {
  // Os candidatos saem das REFERÊNCIAS do alvo, não do bucket inteiro. Três consequências, e todas são o que foi
  // pedido: registro existente é reutilizado (quem já está em `porCaminho` não entra), só o ausente é criado, e
  // objeto que ninguém referencia — os 32 órfãos — não ganha registro nenhum. Derivar do bucket registraria os
  // órfãos e os daria por administrados, que é o erro oposto ao do inventário antigo.
  const caminhosDoAlvo = new Set(alvo.map((r) => r.storagePath));
  const porCaminhoInventario = new Map(inventario.map((o) => [o.caminho, o]));
  const candidatos = [...caminhosDoAlvo]
    .map((c) => porCaminhoInventario.get(c))
    .filter(Boolean);
  const faltando = candidatos.filter((o) => !porCaminho.has(o.caminho));
  const reutilizados = candidatos.length - faltando.length;
  console.log(`objetos referenciados pelo alvo: ${candidatos.length}`);
  console.log(`  registros reutilizados: ${reutilizados}`);
  // As duas razões para um objeto ficar de fora são diferentes, e juntá-las numa conta só esconde as duas. A
  // contagem vem da classificação do inventário, não de uma subtração: subtração acerta o total e erra o motivo.
  console.log(`  órfãos deixados de fora: ${relatorio.orphanObjects.length} (sem referência e sem registro)`);
  console.log(`  fora deste escopo: ${Math.max(0, relatorio.activeObjects.length - candidatos.length)}` +
    ' (referenciados, mas de outra visibilidade ou já em URL própria)');
  console.log(`a registrar: ${faltando.length}`);
  const criados = faltando.map((o) => ({
    id: generateMediaId(),
    storagePath: o.caminho,
    contentType: o.contentType,
    size: o.size,
    ownerUid: o.ownerUid,
    visibility: o.visibility,
    kind: o.kind,
    createdAt: new Date().toISOString(),
  }));
  const writes = criados.map((r) => ({
    update: {
      name: `${ROOT}/media/${r.id}`,
      fields: {
        storagePath: { stringValue: r.storagePath },
        contentType: { stringValue: r.contentType },
        size: { integerValue: String(r.size) },
        ownerUid: { stringValue: r.ownerUid },
        visibility: { stringValue: r.visibility },
        kind: { stringValue: r.kind },
        createdAt: { timestampValue: r.createdAt },
      },
    },
    // `exists: false` é a pré-condição certa aqui: se já houver registro com este id, o lote reprova em vez de
    // sobrescrever. O id tem ~132 bits, então colidir é improvável — mas sobrescrever um registro apontaria duas
    // mídias para o mesmo id, e aí uma delas serviria o objeto da outra.
    currentDocument: { exists: false },
  }));
  const n = await gravar(writes);
  console.log(APLICAR ? `GRAVADOS: ${n}` : 'nada gravado (falta --aplicar)');

  // Manifesto: id, caminho, dono, tipo e tamanho de cada registro CRIADO. Serve para auditoria e para
  // reconciliação — sem ele, saber depois quais dos 146 registros nasceram nesta migração exigiria adivinhar pelo
  // `createdAt`. Protegido como o backup: fora do Git e com ACL restrita, porque correlaciona dono e caminho.
  if (APLICAR && criados.length > 0) {
    const corpo = criados.map((r) => JSON.stringify(r)).join('\n');
    const sha256 = createHash('sha256').update(corpo).digest('hex');
    const cabecalho = JSON.stringify({
      tipo: 'manifesto-registros-midia',
      criadoEm: new Date().toISOString(),
      projeto: PROJECT,
      escopo: ESCOPO,
      registros: criados.length,
      reutilizados,
      sha256,
      aviso: 'Correlaciona dono e caminho de objeto. Dado sensivel: nao versionar, nao compartilhar.',
    });
    const destino = MANIFESTO && (MANIFESTO.startsWith('/') || /^[A-Za-z]:/.test(MANIFESTO))
      ? MANIFESTO
      : join(SAIDA, MANIFESTO ?? `manifesto-midia-${PROJECT}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, `${cabecalho}\n${corpo}\n`, { encoding: 'utf8', mode: 0o600 });
    const permissao = restringirAoDono(destino);
    console.log(`\nMANIFESTO: ${destino}`);
    console.log(`registros: ${criados.length} · reutilizados: ${reutilizados} · sha256: ${sha256}`);
    console.log(`Proteção: ${permissao}`);
  } else if (!APLICAR) {
    console.log('(o manifesto é gravado quando a fase roda com --aplicar)');
  }

  console.log('próxima fase: --fase=reescrever');
  process.exit(0);
}

// ───────────────── Fase: reescrever ─────────────────

if (FASE === 'reescrever') {
  const porDocumento = new Map();
  /** Mapeamento um a um: documento, campo, objeto, id e URL nova. É o que o dry-run entrega para revisão. */
  const mapa = [];
  let semRegistro = 0;
  let naoTrocadas = 0;

  for (const r of alvo) {
    const reg = porCaminho.get(r.storagePath);
    if (!reg) { semRegistro++; continue; }
    const nova = reg.visibility === 'public' ? publicMediaUrl(reg.id, MEDIA_ORIGIN) : privateMediaPath(reg.id);
    if (!porDocumento.has(r.doc.name)) {
      porDocumento.set(r.doc.name, { doc: r.doc, raizes: new Set(), trocas: 0 });
    }
    const entrada = porDocumento.get(r.doc.name);
    // Embutida troca SÓ a substring: o campo é um texto maior (o HTML do post), e trocar o valor todo apagaria o
    // post. Direta troca o valor inteiro, como antes.
    const trocou = r.embutida
      ? trocarTextoNoCaminho(entrada.doc.fields, r.caminho, r.urlAntiga, nova)
      : trocarNoCaminho(entrada.doc.fields, r.caminho, nova);
    if (trocou) {
      entrada.raizes.add(campoRaiz(r.caminho));
      entrada.trocas++;
      mapa.push({
        documento: curto(r.doc.name),
        campo: r.caminho,
        embutida: Boolean(r.embutida),
        objeto: r.storagePath,
        mediaId: reg.id,
        visibilidade: reg.visibility,
        urlNova: nova,
      });
    } else {
      naoTrocadas++;
      if (naoTrocadas <= 5) console.log(`  não trocou: ${curto(r.doc.name)} · ${r.caminho}`);
    }
  }

  const writes = [];
  const updateTimePorDocumento = new Map();
  let trocasTotais = 0;
  for (const { doc, raizes, trocas } of porDocumento.values()) {
    if (trocas === 0) continue;
    const fields = {};
    for (const raiz of raizes) fields[raiz] = doc.fields[raiz];
    updateTimePorDocumento.set(doc.name, doc.updateTime);
    writes.push({
      update: { name: doc.name, fields },
      updateMask: { fieldPaths: [...raizes] },
      // `exists: true` NÃO protege nada aqui: entre a leitura e o commit passam minutos, e nesse intervalo a pessoa
      // pode trocar o avatar ou editar o post. Com `exists` a pré-condição passa e a migração grava o campo raiz
      // lido ANTES da edição, desfazendo a edição em silêncio. `updateTime` reprova o lote nesse caso.
      currentDocument: preconditionFor(doc.updateTime),
    });
    trocasTotais += trocas;
  }
  const semProtecao = countUnprotected([...updateTimePorDocumento.values()]);
  if (semProtecao) {
    console.error(`ABORTADO: ${semProtecao} documentos sem updateTime na leitura.`);
    console.error('Nenhuma reescrita será gravada sem proteção contra escrita concorrente.');
    process.exit(1);
  }

  console.log(`documentos a atualizar . ${writes.length}`);
  console.log(`referências trocadas ... ${trocasTotais} de ${alvo.length}`);
  const embutidasTrocadas = mapa.filter((m) => m.embutida).length;
  if (embutidasTrocadas) console.log(`  das quais embutidas ... ${embutidasTrocadas} (troca por substring)`);

  // Mapeamento um a um. Em stdout vai uma amostra pseudonimizada; o arquivo completo sai só se pedido, e fora do
  // repositório, porque ele correlaciona documento, dono e objeto.
  console.log('');
  console.log('mapeamento (amostra pseudonimizada):');
  for (const m of mapa.slice(0, 8)) {
    console.log(`  ${pseudonymizeDocumentPath(m.documento)} · ${m.campo}${m.embutida ? ' (embutida)' : ''}`);
    console.log(`    ${pseudonymizeStoragePath(m.objeto)}  ->  /m/${m.mediaId}`);
  }
  if (MAPA) {
    const destinoMapa = MAPA.startsWith('/') || /^[A-Za-z]:/.test(MAPA) ? MAPA : join(SAIDA, MAPA);
    mkdirSync(dirname(destinoMapa), { recursive: true });
    writeFileSync(destinoMapa, mapa.map((m) => JSON.stringify(m)).join('\n') + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    });
    const permissaoMapa = restringirAoDono(destinoMapa);
    console.log(`\nmapa completo (${mapa.length} linhas) em: ${destinoMapa}`);
    console.log(`Ele correlaciona documento, dono e objeto. Proteção: ${permissaoMapa}`);
  } else {
    console.log('\n(use --mapa=<arquivo> para gravar o mapeamento completo para revisão)');
  }

  if (semRegistro) console.log(`ATENÇÃO: ${semRegistro} sem registro media/. Rode --fase=registrar antes.`);
  if (naoTrocadas) console.log(`ATENÇÃO: ${naoTrocadas} não puderam ser trocadas na estrutura.`);
  if (trocasTotais === alvo.length) {
    console.log(`COBERTURA TOTAL do escopo ${ESCOPO}: nenhuma referência ficou de fora.`);
  }

  const resultado = await gravarComPreCondicao(writes, updateTimePorDocumento);
  if (resultado.abortado) {
    console.log(`\nGRAVADOS antes de abortar: ${resultado.gravados} documentos`);
    process.exit(1);
  }
  console.log(APLICAR ? `\nGRAVADOS: ${resultado.gravados} documentos` : '\nnada gravado (falta --aplicar)');
  console.log('próxima fase: conferir à mão que os anexos abrem, e só então --fase=revogar');
  process.exit(0);
}

// ───────────────── Fase: revogar ─────────────────

if (FASE === 'revogar') {
  // Trava dura: não existe escopo que revogue token público. A migração pública troca a URL gravada e PRESERVA o
  // token antigo de propósito, para não quebrar compartilhamento externo que já saiu daqui — link no WhatsApp,
  // print, card já buscado por outra rede. Sem esta trava, `--escopo=publico --fase=revogar` pareceria uma
  // continuação natural da migração e destruiria 152 tokens que ninguém pediu para destruir.
  if (ESCOPO !== 'privado') {
    console.error(`ABORTADO: --fase=revogar só existe para --escopo=privado, e veio '${ESCOPO}'.`);
    console.error('Token público é preservado por decisão: revogá-lo quebraria compartilhamento externo antigo.');
    process.exit(1);
  }
  const semRegistro = privadosComToken.filter((o) => !porCaminho.has(o.caminho));
  if (semRegistro.length) {
    console.error(`ABORTADO: ${semRegistro.length} objetos privados com token NÃO têm registro media/.`);
    console.error('Revogar agora deixaria o anexo inacessível pelos dois caminhos.');
    console.error('Rode --fase=registrar e --fase=reescrever primeiro.');
    process.exit(1);
  }
  const privadosNoBucket = new Set(inventario.filter((o) => o.visibility === 'private').map((o) => o.caminho));
  const aindaLegadas = todas.filter((r) => privadosNoBucket.has(r.storagePath));
  if (aindaLegadas.length) {
    console.error(`ABORTADO: ${aindaLegadas.length} referências a objeto PRIVADO ainda apontam para o Firebase.`);
    console.error('Rode --fase=reescrever antes: revogar agora quebraria esses anexos na hora.');
    process.exit(1);
  }

  console.log(`a revogar: ${privadosComToken.length} objetos PRIVADOS`);
  console.log(`preservados: ${publicosComToken.length} públicos (revogar quebraria compartilhamento antigo)`);

  if (!APLICAR) {
    console.log('\nnada revogado (falta --aplicar). Esta fase é IRREVERSÍVEL: o token não volta.');
    process.exit(0);
  }

  let revogados = 0;
  let falhas = 0;
  for (const o of privadosComToken) {
    const url = `${GCS_HOST}/storage/v1/b/${BUCKET}/o/${encodeURIComponent(o.caminho)}`;
    try {
      await call('PATCH', url, { metadata: { firebaseStorageDownloadTokens: null } });
      revogados++;
    } catch (erro) {
      falhas++;
      if (falhas <= 5) console.error(`  falhou em ${o.caminho}: ${erro.message}`);
    }
  }
  console.log(`REVOGADOS: ${revogados}${falhas ? ` · falhas: ${falhas}` : ''}`);
  console.log('confira agora com --conferir');
  process.exit(falhas ? 1 : 0);
}

// ───────────────── Conferência final ─────────────────

let problemas = 0;

if (privadosComToken.length) {
  problemas++;
  console.log(`FALHA ${privadosComToken.length} objetos privados AINDA têm token permanente`);
} else {
  console.log('OK    nenhum objeto privado tem token permanente');
}

const privadosSemRegistro = inventario.filter((o) => o.visibility === 'private' && !porCaminho.has(o.caminho));
if (privadosSemRegistro.length) {
  problemas++;
  console.log(`FALHA ${privadosSemRegistro.length} objetos privados sem registro media/`);
} else {
  console.log('OK    todo objeto privado tem registro media/');
}

if (refsPrivadas.length) {
  problemas++;
  console.log(`FALHA ${refsPrivadas.length} referências a objeto PRIVADO ainda apontam para o Storage`);
} else {
  console.log('OK    nenhuma referência a objeto privado aponta para o Storage');
}
// Publica legada nao e problema: o token dela nao e revogado, e a URL continua funcionando. Mas depois da migracao
// publica o que sobra aqui sao as referencias a objeto INEXISTENTE, e isso e outra coisa — e imagem quebrada no
// conteudo, nao decisao. Separar as duas, senao a segunda se esconde atras da primeira.
const publicasVivas = refsPublicas.filter((r) => caminhosNoBucket.has(r.storagePath));
const publicasQuebradas = refsPublicas.filter((r) => !caminhosNoBucket.has(r.storagePath));
if (publicasVivas.length) {
  console.log(`      ${publicasVivas.length} referências públicas legadas continuam (aceito por decisão)`);
}
if (publicasQuebradas.length) {
  console.log(`      ${publicasQuebradas.length} referências apontam para objeto que NÃO existe mais ` +
    '(imagem quebrada; migração não as toca)');
}

console.log(`\npúblicos com token (esperado): ${publicosComToken.length}`);
if (problemas) {
  console.log(`\n${problemas} problema(s). A migração não está completa.`);
  process.exit(1);
}
console.log('\nMigração completa.');
process.exit(0);
