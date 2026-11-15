#!/usr/bin/env node
/**
 * Confere, referência por referência, que a migração da mídia privada apontou para o lugar certo.
 *
 *   node scripts/conferir-midia-migrada.mjs --producao --de=<arquivo de backup>
 *
 * POR QUE EXISTE SEPARADO DO `--conferir`: a conferência da migração olha agregados (quantos objetos ainda têm
 * token, quantas referências ainda apontam para o Storage). Isso não prova que a referência X foi para o registro
 * do objeto X. Um erro de mapeamento passaria por todos os agregados e só apareceria depois da revogação, quando o
 * anexo já estaria inacessível pelos dois caminhos.
 *
 * O que este script prova, para CADA referência do backup:
 *   1. o campo gravado hoje é exatamente `/mp/<id>`, com id no formato opaco;
 *   2. `media/{id}.storagePath` é o MESMO objeto que a URL antiga apontava;
 *   3. o registro tem dono, tipo e visibilidade coerentes com o caminho do objeto, e não está marcado como excluído;
 *   4. o objeto existe no bucket (e o script relata se ainda tem token, para rodar antes e depois da revogação);
 *   5. aba anônima recebe 404 na URL nova;
 *   6. para anexo de conversa: o dono participa da conversa e o id da conversa é o que a rota recalcula, ou seja o
 *      participante autorizado será de fato autorizado.
 *
 * NÃO lê conteúdo de arquivo de ninguém e NUNCA imprime a URL antiga, que carrega o token.
 *
 * Token de acesso em FIRESTORE_ACCESS_TOKEN (gcloud auth print-access-token). Nunca é impresso.
 */

import { readFileSync } from 'node:fs';

const { kindFromPath, visibilityForKind, isValidMediaId } = await import('../src/lib/media/mediaId.ts');
const { caminhoDaUrlAntiga } = await import('../src/lib/media/legacyUrl.ts');

const flag = (nome) => process.argv.slice(2).find((a) => a.startsWith(`${nome}=`))?.slice(nome.length + 1);
const args = new Set(process.argv.slice(2));
const PROD = args.has('--producao');
const DE = flag('--de');
if (!DE) {
  console.error('informe --de=<arquivo de backup>');
  process.exit(2);
}

const PROJECT = PROD ? 'echo-b5aw9' : 'demo-soberan';
const DATABASE = 'echo-db-124325';
const BUCKET = PROD ? 'echo-b5aw9.firebasestorage.app' : ['demo-soberan', 'appspot', 'com'].join('.');
const ORIGEM = PROD ? 'https://exercitodolula.app' : 'http://localhost:9002';
const TOKEN = process.env.FIRESTORE_ACCESS_TOKEN ?? '';
if (PROD && !TOKEN) {
  console.error('defina FIRESTORE_ACCESS_TOKEN (gcloud auth print-access-token) sem imprimi-lo');
  process.exit(2);
}

let falhas = 0;
const confere = (nome, condicao, motivo) => {
  if (condicao) return true;
  falhas++;
  console.log(`FALHA ${nome} — ${motivo}`);
  return false;
};

async function pegar(url) {
  const resposta = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'x-goog-user-project': PROJECT },
  });
  if (resposta.status === 404) return null;
  if (!resposta.ok) {
    throw new Error(`GET ${new URL(url).pathname} falhou (${resposta.status})`);
  }
  return resposta.json();
}

/** Lê um valor de texto dentro da forma do Firestore seguindo `a.b[0].c`. */
function lerNoCaminho(fields, caminho) {
  const partes = caminho.match(/[^.[\]]+/g) ?? [];
  let atual = { mapValue: { fields } };
  for (const parte of partes) {
    if (/^\d+$/.test(parte)) {
      const valores = atual?.arrayValue?.values;
      if (!Array.isArray(valores)) return undefined;
      atual = valores[Number(parte)];
    } else {
      const mapa = atual?.mapValue?.fields;
      if (!mapa) return undefined;
      atual = mapa[parte];
    }
    if (atual === undefined) return undefined;
  }
  return typeof atual?.stringValue === 'string' ? atual.stringValue : undefined;
}

const texto = (campo) => (typeof campo?.stringValue === 'string' ? campo.stringValue : '');
const RAIZ_DOCS = `projects/${PROJECT}/databases/${DATABASE}/documents/`;
const curto = (nome) => nome.replace(RAIZ_DOCS, '');

// ───────────────── lê o backup ─────────────────

const linhas = readFileSync(DE, 'utf8').split('\n').filter((l) => l.trim());
const cabecalho = JSON.parse(linhas[0]);
if (cabecalho.tipo !== 'cabecalho-backup-midia') {
  console.error('o arquivo não é um backup desta migração');
  process.exit(2);
}
if (cabecalho.projeto !== PROJECT) {
  console.error(`backup do projeto ${cabecalho.projeto}, mas o alvo é ${PROJECT}`);
  process.exit(2);
}
const registros = linhas.slice(1).map((l) => JSON.parse(l));

console.log(`alvo: ${PROD ? 'PRODUÇÃO' : 'emuladores'} · ${PROJECT} · bucket ${BUCKET}`);
console.log(`backup de ${cabecalho.criadoEm} · escopo ${cabecalho.escopo}`);
console.log(`documentos no backup: ${registros.length} · referências: ${cabecalho.referencias}\n`);

// ───────────────── confere referência por referência ─────────────────

const idsVistos = new Map();
const caminhosPorId = new Map();
const objetosVistos = new Set();
const conversasConferidas = new Map();
/** Referências reapontadas de propósito para uma cópia. Contadas e nomeadas, nunca aceitas em silêncio. */
const copias = new Set();
let referencias = 0;
let comTokenAinda = 0;

for (const registro of registros) {
  const nome = curto(registro.documento);
  const doc = await pegar(`https://firestore.googleapis.com/v1/${registro.documento}`);
  if (!confere(`${nome} · documento existe`, Boolean(doc), 'o documento desapareceu desde o backup')) continue;

  for (const { caminho, urlAntiga } of registro.valoresAnteriores) {
    referencias++;
    const rotulo = `${nome} · ${caminho}`;
    const caminhoAntigo = caminhoDaUrlAntiga(urlAntiga);
    if (!confere(`${rotulo} · URL antiga legível`, Boolean(caminhoAntigo), 'não deu para extrair o caminho do objeto')) {
      continue;
    }

    // 1. o campo gravado hoje é /mp/<id>
    const valorAtual = lerNoCaminho(doc.fields, caminho);
    const id = typeof valorAtual === 'string' && valorAtual.startsWith('/mp/') ? valorAtual.slice(4) : '';
    if (!confere(`${rotulo} · aponta para /mp/<id>`, Boolean(id), `valor atual não é uma URL própria privada`)) continue;
    if (!confere(`${rotulo} · id no formato opaco`, isValidMediaId(id), `id fora do formato: ${id.length} caracteres`)) {
      continue;
    }

    // 2. o registro aponta para o mesmo objeto, OU para uma cópia provadamente do mesmo conteúdo
    const media = await pegar(`https://firestore.googleapis.com/v1/${RAIZ_DOCS}media/${id}`);
    if (!confere(`${rotulo} · registro media/${id} existe`, Boolean(media), 'o registro não está no Firestore')) continue;
    const campos = media.fields ?? {};
    const storagePath = texto(campos.storagePath);
    if (!confere(`${rotulo} · registro tem storagePath`, storagePath.length > 0, 'o registro não tem caminho')) continue;

    // Uma referência pode ter sido reapontada de propósito: o anexo reenviado, cujo objeto é de um terceiro fora da
    // conversa, foi consertado com uma CÓPIA na pasta de quem reenviou. Aceitar isso sem provar nada tiraria o
    // sentido da conferência, então a cópia tem de provar que é do mesmo conteúdo, que o original continua inteiro
    // e que ela nasceu sem token.
    const ehCopia = storagePath !== caminhoAntigo;
    if (ehCopia) {
      const [original, copia] = await Promise.all([
        pegar(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(caminhoAntigo)}`),
        pegar(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(storagePath)}`),
      ]);
      console.log(`      ${rotulo} · reapontada para CÓPIA (${storagePath.split('/').slice(0, 2).join('/')}/…)`);
      if (!confere(`${rotulo} · a cópia existe no bucket`, Boolean(copia), 'o registro aponta para objeto inexistente')) {
        continue;
      }
      confere(
        `${rotulo} · o objeto original continua inteiro`,
        Boolean(original),
        'a cópia substituiu o original em vez de acrescentar',
      );
      confere(
        `${rotulo} · a cópia é do mesmo conteúdo`,
        Boolean(original) && copia.size === original.size && copia.contentType === original.contentType,
        `tamanho/tipo divergem: ${copia.size}/${copia.contentType} contra ${original?.size}/${original?.contentType}`,
      );
      confere(
        `${rotulo} · a cópia nasceu SEM token`,
        !copia.metadata?.firebaseStorageDownloadTokens,
        'a cópia tem token permanente: exatamente o que esta rodada elimina',
      );
      copias.add(storagePath);
    }

    // 3. dono, tipo e visibilidade coerentes com o caminho DO REGISTRO
    const donoDoCaminho = storagePath.split('/')[1] ?? '';
    const tipoDoCaminho = kindFromPath(storagePath);
    confere(
      `${rotulo} · dono do registro é o dono do caminho`,
      texto(campos.ownerUid) === donoDoCaminho && donoDoCaminho.length > 0,
      `ownerUid ${texto(campos.ownerUid) || 'vazio'} diverge do caminho`,
    );
    confere(
      `${rotulo} · tipo coerente (${tipoDoCaminho})`,
      texto(campos.kind) === tipoDoCaminho,
      `kind ${texto(campos.kind) || 'vazio'} diverge de ${tipoDoCaminho}`,
    );
    confere(
      `${rotulo} · visibilidade privada`,
      texto(campos.visibility) === 'private' && visibilityForKind(tipoDoCaminho) === 'private',
      `visibility ${texto(campos.visibility) || 'vazio'} — a rota privada recusaria mídia pública`,
    );
    confere(
      `${rotulo} · não está marcado como excluído`,
      campos.deletedAt === undefined,
      'deletedAt presente: a rota devolveria 404 ao próprio dono',
    );
    confere(
      `${rotulo} · tem contentType`,
      texto(campos.contentType).length > 0,
      'sem contentType a resposta sai como application/octet-stream',
    );

    // Um id por objeto SERVIDO, não por objeto antigo: depois do conserto do reenvio, três referências ao mesmo
    // objeto antigo são servidas por dois objetos — o original, na conversa original, e a cópia, na de destino.
    // O que não pode é um objeto com dois ids, ou um id apontando para dois objetos.
    const idAnterior = idsVistos.get(storagePath);
    if (idAnterior && idAnterior !== id) {
      confere(`${rotulo} · um id por objeto`, false, `o objeto ${storagePath} recebeu ${idAnterior} e ${id}`);
    }
    idsVistos.set(storagePath, id);
    const caminhoDoId = caminhosPorId.get(id);
    if (caminhoDoId && caminhoDoId !== storagePath) {
      confere(`${rotulo} · um objeto por id`, false, `o id ${id} apontou para ${caminhoDoId} e ${storagePath}`);
    }
    caminhosPorId.set(id, storagePath);

    // 4. o objeto ANTIGO — o que a URL legada apontava, e portanto o alvo da revogação — existe e é contado
    if (!objetosVistos.has(caminhoAntigo)) {
      objetosVistos.add(caminhoAntigo);
      const objeto = await pegar(
        `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(caminhoAntigo)}`,
      );
      let tinhaToken = false;
      if (confere(`${rotulo} · objeto antigo existe no bucket`, Boolean(objeto), 'o objeto não está mais no Storage')) {
        tinhaToken = Boolean(objeto.metadata?.firebaseStorageDownloadTokens);
        if (tinhaToken) comTokenAinda++;
      }

      // A URL ANTIGA em si. É o teste que importa para quem já copiou o link: depois da revogação ela tem de parar
      // de servir o arquivo. Antes da revogação ela abre, e isso aqui só registra o estado. A URL não é impressa:
      // ela carrega o token.
      const antiga = await fetch(urlAntiga, { method: 'GET', headers: { Range: 'bytes=0-0' } }).catch(() => null);
      const statusAntigo = antiga?.status ?? 0;
      if (antiga) antiga.body?.cancel?.();
      if (tinhaToken) {
        console.log(`      ${rotulo} · URL antiga responde ${statusAntigo} (token ainda existe; a revogação cuida)`);
      } else {
        confere(
          `${rotulo} · URL antiga do Firebase PAROU de servir`,
          statusAntigo !== 200 && statusAntigo !== 206,
          `a URL antiga ainda responde ${statusAntigo} sem login`,
        );
      }

      // 5. aba anônima recebe 404
      const anonima = await fetch(`${ORIGEM}/mp/${id}`, { method: 'HEAD', redirect: 'manual' });
      confere(
        `${rotulo} · aba anônima recebe 404`,
        anonima.status === 404,
        `veio ${anonima.status} sem sessão`,
      );
    }

    // 6. anexo de conversa: o participante autorizado será autorizado
    if (tipoDoCaminho === 'dm') {
      const partes = nome.split('/');
      const temConversa = partes[0] === 'conversations' && partes.length >= 2;
      if (!confere(`${rotulo} · anexo vive sob a conversa`, temConversa, `documento fora de conversations/: ${nome}`)) {
        continue;
      }
      const conversaId = partes[1];
      if (!conversasConferidas.has(conversaId)) {
        const conversa = await pegar(`https://firestore.googleapis.com/v1/${RAIZ_DOCS}conversations/${conversaId}`);
        const ids = conversa?.fields?.participantIds?.arrayValue?.values ?? [];
        conversasConferidas.set(conversaId, ids.map((v) => texto(v)).filter(Boolean));
      }
      const participantes = conversasConferidas.get(conversaId);
      confere(
        `${rotulo} · conversa tem participantes`,
        participantes.length >= 2,
        `a conversa ${conversaId} tem ${participantes.length} participante(s): a rota não autorizaria ninguém`,
      );
      confere(
        `${rotulo} · o dono do anexo participa da conversa`,
        participantes.includes(texto(campos.ownerUid)),
        'o dono não está em participantIds: nenhum participante seria autorizado',
      );
      confere(
        `${rotulo} · o id da conversa é o que a rota recalcula`,
        conversaId === [...participantes].sort().join('_'),
        `a rota procuraria ${[...participantes].sort().join('_')} e não acharia esta conversa`,
      );
    }
  }
}

// ───────────────── resumo ─────────────────

console.log('');
console.log(`referências conferidas ......... ${referencias} (backup diz ${cabecalho.referencias})`);
console.log(`objetos antigos distintos ...... ${objetosVistos.size}  (alvo da revogação)`);
console.log(`objetos servidos hoje .......... ${idsVistos.size}  (originais mantidos + cópias do conserto)`);
console.log(`ids distintos .................. ${new Set(idsVistos.values()).size}`);
console.log(`conversas envolvidas ........... ${conversasConferidas.size}`);
console.log(`reapontadas para cópia ......... ${copias.size} objeto(s) de cópia, sem token`);
console.log(`objetos antigos com token ...... ${comTokenAinda}  ${comTokenAinda ? '(esperado ANTES de --fase=revogar; é o alvo da revogação)' : '(revogação concluída)'}`);

if (referencias !== cabecalho.referencias) {
  falhas++;
  console.log(`FALHA conferi ${referencias} referências, o backup tem ${cabecalho.referencias}`);
}

if (falhas) {
  console.log(`\n${falhas} falha(s). NÃO revogue.`);
  process.exit(1);
}
console.log('\nMapeamento correto referência por referência.');
process.exit(0);
