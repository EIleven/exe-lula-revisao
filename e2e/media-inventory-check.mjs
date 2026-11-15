#!/usr/bin/env node
/**
 * Testa a classificação do inventário de mídia sem produção, sem app e sem emuladores.
 *   node e2e/media-inventory-check.mjs
 *
 * O QUE ESTÁ EM JOGO: o inventário é o insumo de uma decisão de LIMPEZA. A versão anterior calculava órfão como
 * "objeto sem referência legada", e isso passou a estar errado no instante em que a migração trocou as URLs —
 * depois dela nenhum objeto migrado tem referência legada. O resultado foi apontar 54 órfãos, 20 deles privados,
 * quando os 20 privados eram justamente os objetos mais corretamente administrados do bucket. Apagar por aquela
 * lista teria apagado anexo vivo.
 *
 * Por isso o primeiro cenário aqui é o da regressão: objeto referenciado SÓ por `/mp/<id>` não é órfão.
 *
 * Sai com código 1 se algo falhar.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const {
  classifyMediaInventory,
  pseudonymizeStoragePath,
  pseudonymizeDocumentPath,
} = await import('../src/lib/media/mediaInventory.ts');

const { mediaIdFromUrl, isValidStoragePath, generateMediaId, isValidMediaId } = await import(
  '../src/lib/media/mediaId.ts'
);

const {
  classifyDeletionOutcome,
  shouldTombstone,
  worthRetrying,
} = await import('../src/lib/media/mediaReplacement.ts');

const {
  preconditionFor,
  countUnprotected,
  conflictingDocuments,
  isPreconditionFailure,
  decideRevert,
} = await import('../src/lib/media/migrationSafety.ts');

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
let falhas = 0;

function confere(nome, condicao, motivo, detalhe) {
  if (condicao) console.log(`OK    ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo}`); }
}

const ID_A = 'aaaaaaaaaaaaaaaaaaaaaa';
const ID_B = 'bbbbbbbbbbbbbbbbbbbbbb';
const ID_C = 'cccccccccccccccccccccc';
const ID_D = 'dddddddddddddddddddddd';
const ID_E = 'eeeeeeeeeeeeeeeeeeeeee';
const DONO = 'uidDoDono';
const OUTRO = 'uidDeOutro';

const caminho = (uid, pasta, nome) => `user_uploads/${uid}/${pasta}/${nome}`;

// ───────────── 1. mediaIdFromUrl ─────────────

confere(
  'mediaIdFromUrl lê /mp/<id> relativo como PRIVADA',
  JSON.stringify(mediaIdFromUrl(`/mp/${ID_A}`)) === JSON.stringify({ id: ID_A, visibility: 'private' }),
  'a referência própria privada não foi reconhecida, e o inventário não contaria anexo migrado',
);
confere(
  'mediaIdFromUrl lê /m/<id> relativo como PÚBLICA',
  mediaIdFromUrl(`/m/${ID_A}`)?.visibility === 'public',
  'confundir /m/ com /mp/ classificaria mídia privada como pública',
);
confere(
  'mediaIdFromUrl lê URL absoluta do domínio de mídia',
  mediaIdFromUrl(`https://media.exercitodolula.app/m/${ID_B}`)?.id === ID_B,
  'a URL pública gravada no banco é absoluta: não reconhecê-la zeraria a contagem de mídia de post',
);
confere(
  'mediaIdFromUrl tolera query e fragmento',
  mediaIdFromUrl(`/mp/${ID_B}?dl=1`)?.id === ID_B && mediaIdFromUrl(`/m/${ID_B}#x`)?.id === ID_B,
  'o cliente acrescenta ?dl=1 para download',
);
for (const [nome, valor] of [
  ['URL antiga do Firebase', 'https://firebasestorage.googleapis.com/v0/b/x/o/user_uploads%2Fa%2Fb.jpg?alt=media&token=t'],
  ['id curto', '/mp/abc'],
  ['id longo', `/mp/${ID_A}z`],
  ['caminho depois do id', `/mp/${ID_A}/extra`],
  ['outra rota parecida', `/media/${ID_A}`],
  ['vazio', ''],
  ['nulo', null],
]) {
  confere(
    `mediaIdFromUrl recusa: ${nome}`,
    mediaIdFromUrl(valor) === null,
    'um falso positivo aqui inventaria referência que não existe, e esconderia um órfão de verdade',
  );
}
confere(
  'mediaIdFromUrl aceita todo id que generateMediaId produz',
  Array.from({ length: 200 }, () => generateMediaId()).every((id) => mediaIdFromUrl(`/mp/${id}`)?.id === id),
  'o alfabeto do gerador e o da leitura divergiram',
);

// O regex das Functions e o do app precisam concordar: pacotes diferentes, duplicação deliberada.
const funcsMedia = readFileSync(join(RAIZ, 'functions', 'src', 'mediaAccess.ts'), 'utf8');
confere(
  'Functions e app concordam no formato do id',
  funcsMedia.includes('[A-Za-z0-9_-]{22}') &&
    readFileSync(join(RAIZ, 'src', 'lib', 'media', 'mediaId.ts'), 'utf8').includes('[A-Za-z0-9_-]{22}'),
  'o formato divergiu entre functions/ e src/',
);

// ───────────── 2. isValidStoragePath ─────────────

confere(
  'isValidStoragePath aceita os caminhos reais',
  [
    caminho(DONO, 'dms/images', 'a.jpg'),
    caminho(DONO, 'user_files', 'a.pdf'),
    caminho(DONO, 'postMedia/images', 'a.png'),
    caminho(DONO, 'avatars', 'a.webp'),
  ].every(isValidStoragePath),
  'um caminho real sendo recusado contaria registro bom como registro quebrado',
);
for (const [nome, valor] of [
  ['vazio', ''],
  ['nulo', null],
  ['número', 123],
  ['fora de user_uploads', 'outros/uid/a.jpg'],
  ['sem uid', 'user_uploads/a.jpg'],
  ['travessia', 'user_uploads/uid/../outro/a.jpg'],
  ['barra dupla', 'user_uploads/uid//a.jpg'],
  ['terminando em barra', 'user_uploads/uid/pasta/'],
  ['longo demais', `user_uploads/uid/${'a'.repeat(600)}.jpg`],
]) {
  confere(
    `isValidStoragePath recusa: ${nome}`,
    isValidStoragePath(valor) === false,
    'caminho inválido tratado como válido faria o registro contar como objeto administrado',
  );
}

// ───────────── 3. A REGRESSÃO: referência própria conta ─────────────

const soPorUrlPropria = classifyMediaInventory({
  objects: [{ path: caminho(DONO, 'dms/images', 'anexo.jpg'), kind: 'dm', visibility: 'private', hasToken: false }],
  registrations: [{ id: ID_A, storagePath: caminho(DONO, 'dms/images', 'anexo.jpg'), visibility: 'private', kind: 'dm' }],
  legacyReferences: [],
  ownReferences: [{ id: ID_A, visibility: 'private', where: 'conversations/c1/messages/m1 · fileUrl' }],
  isValidStoragePath,
});
confere(
  'REGRESSÃO · objeto referenciado SÓ por /mp/<id> NÃO é órfão',
  soPorUrlPropria.orphanObjects.length === 0,
  'é exatamente o erro que fez o inventário chamar os 20 privados migrados de órfãos',
);
confere(
  'REGRESSÃO · ele é classificado como ativo por URL própria',
  soPorUrlPropria.activeObjects.length === 1 && soPorUrlPropria.activeByOwnUrl.length === 1 &&
    soPorUrlPropria.activeByLegacyOnly.length === 0,
  'a referência própria não foi creditada ao objeto',
);
confere(
  'REGRESSÃO · o caminho do registro entra na união',
  soPorUrlPropria.accountedPaths.has(caminho(DONO, 'dms/images', 'anexo.jpg')),
  'a união precisa das três origens',
);

// ───────────── 4. as quatro categorias, uma de cada ─────────────

const P_ATIVO_PROPRIA = caminho(DONO, 'dms/images', 'ativo-proprio.jpg');
const P_ATIVO_LEGADA = caminho(DONO, 'postMedia/images', 'ativo-legado.png');
const P_REGISTRADO = caminho(DONO, 'user_files', 'registrado-sem-ref.pdf');
const P_ORFAO = caminho(OUTRO, 'postMedia/images', 'ninguem-conhece.png');
const P_REG_ORFAO = caminho(DONO, 'dms/images', 'objeto-sumiu.jpg');
const P_REG_TOMB = caminho(DONO, 'postMedia/images', 'apagado.png');

const completo = classifyMediaInventory({
  objects: [
    { path: P_ATIVO_PROPRIA, kind: 'dm', visibility: 'private', hasToken: false },
    { path: P_ATIVO_LEGADA, kind: 'postMedia', visibility: 'public', hasToken: true },
    { path: P_REGISTRADO, kind: 'userFile', visibility: 'private', hasToken: false },
    { path: P_ORFAO, kind: 'postMedia', visibility: 'public', hasToken: true },
  ],
  registrations: [
    { id: ID_A, storagePath: P_ATIVO_PROPRIA, visibility: 'private', kind: 'dm' },
    { id: ID_B, storagePath: P_REGISTRADO, visibility: 'private', kind: 'userFile' },
    { id: ID_C, storagePath: P_REG_ORFAO, visibility: 'private', kind: 'dm' },
    { id: ID_D, storagePath: P_REG_TOMB, visibility: 'public', kind: 'postMedia', tombstoned: true },
    { id: ID_E, storagePath: '', visibility: 'private', kind: 'dm' },
  ],
  legacyReferences: [
    { storagePath: P_ATIVO_LEGADA, where: 'posts/p1 · media[0].url' },
    { storagePath: caminho(DONO, 'avatars', 'sumiu.webp'), where: 'posts/p2 · authorDetails.avatarUrl' },
  ],
  ownReferences: [
    { id: ID_A, visibility: 'private', where: 'conversations/c1/messages/m1 · fileUrl' },
    { id: 'zzzzzzzzzzzzzzzzzzzzzz', visibility: 'private', where: 'conversations/c2/messages/m2 · fileUrl' },
    { id: ID_D, visibility: 'public', where: 'posts/p3 · media[0].url' },
  ],
  isValidStoragePath,
});

confere(
  'CATEGORIA · ativo e corretamente referenciado = 2',
  completo.activeObjects.length === 2 &&
    completo.activeByOwnUrl.map((o) => o.path).join() === P_ATIVO_PROPRIA &&
    completo.activeByLegacyOnly.map((o) => o.path).join() === P_ATIVO_LEGADA,
  `veio ${completo.activeObjects.length}`,
);
confere(
  'CATEGORIA · objeto registrado SEM referência de conteúdo = 1',
  completo.registeredWithoutReference.length === 1 &&
    completo.registeredWithoutReference[0].path === P_REGISTRADO,
  `veio ${completo.registeredWithoutReference.length}`,
);
confere(
  'CATEGORIA · objeto realmente órfão = 1',
  completo.orphanObjects.length === 1 && completo.orphanObjects[0].path === P_ORFAO,
  `veio ${completo.orphanObjects.length}: ${completo.orphanObjects.map((o) => o.path).join(', ')}`,
);
confere(
  'CATEGORIA · registro órfão = 3 (objeto sumiu, tombstone, caminho inválido)',
  completo.orphanRegistrations.length === 3,
  `veio ${completo.orphanRegistrations.length}`,
);
confere(
  'registro órfão distingue o motivo',
  completo.orphanRegistrations.find((r) => r.id === ID_C)?.problem === 'objeto-ausente-sem-tombstone' &&
    completo.orphanRegistrations.find((r) => r.id === ID_D)?.problem === 'objeto-ausente-com-tombstone' &&
    completo.orphanRegistrations.find((r) => r.id === ID_E)?.problem === 'caminho-invalido',
  'tombstone é fim de vida esperado e não pode aparecer como a mesma coisa que registro quebrado',
);
confere(
  'as quatro categorias de objeto somam o total do bucket',
  completo.activeObjects.length + completo.registeredWithoutReference.length + completo.orphanObjects.length ===
    completo.totals.objects,
  'objeto classificado duas vezes, ou nenhuma',
);
confere(
  'registro com caminho inválido não conta como registro válido',
  completo.totals.registrations === 5 && completo.totals.validRegistrations === 4,
  `${completo.totals.validRegistrations} válidos de ${completo.totals.registrations}`,
);

// ───────────── 5. referências que não resolvem ─────────────

confere(
  'referência legada para objeto inexistente é nomeada',
  completo.legacyReferencesWithoutObject.length === 1 &&
    completo.legacyReferencesWithoutObject[0].where === 'posts/p2 · authorDetails.avatarUrl',
  `veio ${completo.legacyReferencesWithoutObject.length}`,
);
confere(
  'referência própria SEM registro é nomeada (404 para sempre)',
  completo.danglingOwnReferences.length === 1 &&
    completo.danglingOwnReferences[0].id === 'zzzzzzzzzzzzzzzzzzzzzz',
  `veio ${completo.danglingOwnReferences.length}`,
);
confere(
  'referência própria para registro com tombstone é nomeada (410)',
  completo.ownReferencesToTombstoned.length === 1 && completo.ownReferencesToTombstoned[0].id === ID_D,
  `veio ${completo.ownReferencesToTombstoned.length}`,
);
confere(
  'referência própria na rota errada é nomeada',
  classifyMediaInventory({
    objects: [{ path: P_ATIVO_PROPRIA, kind: 'dm', visibility: 'private', hasToken: false }],
    registrations: [{ id: ID_A, storagePath: P_ATIVO_PROPRIA, visibility: 'private', kind: 'dm' }],
    legacyReferences: [],
    // mídia privada referenciada pela rota PÚBLICA: serviria 404, e é sintoma de registro ou gravação errada
    ownReferences: [{ id: ID_A, visibility: 'public', where: 'posts/p9 · media[0].url' }],
    isValidStoragePath,
  }).ownReferencesWithWrongRoute.length === 1,
  'privada referenciada por /m/ passaria sem aviso',
);
confere(
  'objeto registrado que AINDA tem token permanente é nomeado',
  completo.registeredWithToken.length === 0 &&
    classifyMediaInventory({
      objects: [{ path: P_ATIVO_PROPRIA, kind: 'dm', visibility: 'private', hasToken: true }],
      registrations: [{ id: ID_A, storagePath: P_ATIVO_PROPRIA, visibility: 'private', kind: 'dm' }],
      legacyReferences: [],
      ownReferences: [{ id: ID_A, visibility: 'private', where: 'conversations/c1/messages/m1 · fileUrl' }],
      isValidStoragePath,
    }).registeredWithToken.length === 1,
  'registro diz "servido pela nossa rota" e o token serve o mesmo objeto sem login: a contradição tem de aparecer',
);
confere(
  'objeto SEM registro e com token não entra nessa categoria',
  classifyMediaInventory({
    objects: [{ path: P_ATIVO_LEGADA, kind: 'postMedia', visibility: 'public', hasToken: true }],
    registrations: [],
    legacyReferences: [{ storagePath: P_ATIVO_LEGADA, where: 'posts/p1 · media[0].url' }],
    ownReferences: [],
    isValidStoragePath,
  }).registeredWithToken.length === 0,
  'mídia legada nunca migrada tem token por definição: contá-la aqui afogaria o sinal',
);
confere(
  'caminho com mais de um registro é nomeado',
  classifyMediaInventory({
    objects: [{ path: P_ATIVO_PROPRIA, kind: 'dm', visibility: 'private', hasToken: false }],
    registrations: [
      { id: ID_A, storagePath: P_ATIVO_PROPRIA },
      { id: ID_B, storagePath: P_ATIVO_PROPRIA },
    ],
    legacyReferences: [],
    ownReferences: [],
    isValidStoragePath,
  }).duplicateRegistrationPaths.length === 1,
  'dois registros para o mesmo objeto é anomalia e tem de aparecer',
);

// ───────────── 6. o caso real do conserto do reenvio ─────────────
//
// Três referências ao mesmo CONTEÚDO servidas por dois objetos: o original, na conversa original, e a cópia, na
// conversa de destino. Nenhum dos dois é órfão, e nenhum é "registrado sem referência".

const original = caminho('uidTerceiro', 'dms/images', 'original.jpg');
const copia = caminho(DONO, 'dms/images', 'copia.jpg');
const reenvio = classifyMediaInventory({
  objects: [
    { path: original, kind: 'dm', visibility: 'private', hasToken: false },
    { path: copia, kind: 'dm', visibility: 'private', hasToken: false },
  ],
  registrations: [
    { id: ID_A, storagePath: original, visibility: 'private', kind: 'dm' },
    { id: ID_B, storagePath: copia, visibility: 'private', kind: 'dm' },
  ],
  legacyReferences: [],
  ownReferences: [
    { id: ID_A, visibility: 'private', where: 'conversations/original/messages/m1 · fileUrl' },
    { id: ID_B, visibility: 'private', where: 'conversations/destino/messages/m2 · fileUrl' },
    { id: ID_B, visibility: 'private', where: 'conversations/destino/messages/m3 · fileUrl' },
  ],
  isValidStoragePath,
});
confere(
  'REENVIO · nem o original nem a cópia são órfãos',
  reenvio.orphanObjects.length === 0 && reenvio.registeredWithoutReference.length === 0,
  'o conserto do reenvio não pode produzir órfão no inventário',
);
confere(
  'REENVIO · a cópia aparece com as duas referências',
  reenvio.objects.find((o) => o.path === copia)?.ownReferenceCount === 2,
  'a contagem por objeto está errada',
);

// ───────────── 7. pseudonimização ─────────────

const caminhoReal = 'user_uploads/qdnRsBvLG8NdwrLv9GwiHDa1xi42/dms/images/699e17f9-230c-421f-987d-7ebe0d1f07b3.jpg';
const pseudo = pseudonymizeStoragePath(caminhoReal);
confere(
  'pseudonimização esconde o uid',
  !pseudo.includes('qdnRsBvLG8NdwrLv9GwiHDa1xi42'),
  'o relatório vazaria o identificador da pessoa',
);
confere(
  'pseudonimização esconde o nome do arquivo',
  !pseudo.includes('699e17f9-230c-421f-987d-7ebe0d1f07b3'),
  'o nome do arquivo é o que se usa para achar o objeto',
);
confere(
  'pseudonimização preserva a estrutura e a extensão',
  pseudo.startsWith('user_uploads/') && pseudo.includes('/dms/images/') && pseudo.endsWith('.jpg'),
  `a estrutura é o diagnóstico: ${pseudo}`,
  pseudo,
);
confere(
  'pseudonimização é estável',
  pseudonymizeStoragePath(caminhoReal) === pseudo,
  'rótulo instável impede ver que duas linhas falam da mesma pessoa',
);
confere(
  'uids diferentes dão rótulos diferentes',
  pseudonymizeStoragePath(caminho('uid1', 'dms/images', 'a.jpg')) !==
    pseudonymizeStoragePath(caminho('uid2', 'dms/images', 'a.jpg')),
  'colisão de rótulo juntaria pessoas diferentes na mesma linha',
);
const docPseudo = pseudonymizeDocumentPath('conversations/G1haVbUWAiUbGQZ5sol7d3nuFFu1_fGGa/messages/CbBt · fileUrl');
confere(
  'pseudonimização do documento preserva coleção e campo, esconde os ids',
  docPseudo.startsWith('conversations/') && docPseudo.includes('/messages/') &&
    docPseudo.endsWith(' · fileUrl') && !docPseudo.includes('G1haVbUWAiUbGQZ5sol7d3nuFFu1'),
  `saber a coleção e o campo é metade do diagnóstico: ${docPseudo}`,
  docPseudo,
);

// ───────────── 8. o script usa a classificação, e não o cálculo antigo ─────────────

const migracao = readFileSync(join(RAIZ, 'scripts', 'migrar-tokens-midia.mjs'), 'utf8');
confere(
  'o script chama classifyMediaInventory',
  migracao.includes('classifyMediaInventory({'),
  'a classificação voltou a ser feita à mão dentro do script',
);
confere(
  'o cálculo antigo de órfão não existe mais',
  !migracao.includes('inventario.filter((o) => !referenciados.has(o.caminho))'),
  'o filtro que só olhava referência legada precisa estar removido, não apenas contornado',
);
confere(
  'o script lê os registros media/ ANTES da classificação',
  migracao.indexOf("const registrosMedia = await grupoDeColecoes('media')") <
    migracao.indexOf('classifyMediaInventory({') &&
    migracao.indexOf("const registrosMedia = await grupoDeColecoes('media')") > 0,
  'sem os registros em mãos a classificação não tem a segunda das três origens',
);
confere(
  'o script colhe referência própria na mesma varredura',
  migracao.includes('mediaIdFromUrl(texto)') && migracao.includes('proprias.push({'),
  'sem colher /m/ e /mp/ o inventário volta a chamar objeto migrado de órfão',
);
confere(
  'os exemplos do relatório são pseudonimizados',
  migracao.includes('pseudonymizeStoragePath(') && migracao.includes('pseudonymizeDocumentPath('),
  'o relatório não pode despejar caminho de usuário real',
);
confere(
  'a fase de inventário continua sem gravar nada',
  /FASE === 'inventario'[\s\S]{0,300}nada foi alterado/.test(migracao),
  'inventário é leitura; se passar a gravar, deixa de ser seguro rodar à vontade',
);

// ───────────── 9. migração pública: escopo, objeto inexistente, órfãos e token ─────────────

confere(
  "o escopo 'publico' existe e é separado de 'tudo'",
  migracao.includes("['privado', 'publico', 'tudo'].includes(ESCOPO)") &&
    migracao.includes('refsPublicasMigraveis'),
  'sem escopo próprio, migrar o público exigiria --escopo=tudo e arrastaria o privado junto',
);
confere(
  'referência cujo objeto não existe fica FORA do alvo',
  migracao.includes('const refsSemObjeto = todas.filter((r) => !caminhosNoBucket.has(r.storagePath))') &&
    migracao.includes('refsPublicasMigraveis = refsPublicas.filter((r) => caminhosNoBucket.has(r.storagePath))'),
  'reescrever referência sem objeto apontaria para registro que serviria 404, e travaria a cobertura para sempre',
);
confere(
  'o alvo do escopo público exclui o privado',
  /ESCOPO === 'publico' \? refsPublicasMigraveis : refsPrivadasMigraveis/.test(migracao),
  'o escopo público não pode tocar em referência privada',
);
confere(
  'registrar deriva das REFERÊNCIAS, não do bucket inteiro',
  migracao.includes('const caminhosDoAlvo = new Set(alvo.map((r) => r.storagePath))') &&
    !migracao.includes("ESCOPO === 'privado'\n    ? inventario.filter((o) => o.visibility === 'private')"),
  'derivar do bucket criaria registro para os 32 órfãos e os daria por administrados',
);
confere(
  'registrar relata quantos registros foram REUTILIZADOS',
  migracao.includes('registros reutilizados'),
  'reutilizar sem dizer esconde se o script está criando registro duplicado',
);
confere(
  'revogar ABORTA em qualquer escopo que não seja privado',
  /if \(ESCOPO !== 'privado'\) \{[\s\S]{0,200}ABORTADO: --fase=revogar só existe para --escopo=privado/.test(migracao),
  'token público é preservado por decisão: revogá-lo quebraria compartilhamento externo já distribuído',
);
confere(
  'o backup diz o tamanho ANTES de gravar',
  migracao.includes('tamanho do corpo') && migracao.includes('maior linha'),
  'o escopo público multiplica o backup por quase duzentos; descobrir o tamanho no disco é tarde',
);
confere(
  'a reescrita entrega mapeamento um a um',
  migracao.includes('const mapa = []') && migracao.includes('mapeamento (amostra pseudonimizada)') &&
    migracao.includes('mapa completo ('),
  'sem mapa não há como revisar 4182 trocas antes de aplicá-las',
);
confere(
  'o mapa completo recebe a mesma ACL restrita do backup',
  migracao.includes('restringirAoDono(destinoMapa)'),
  'o mapa correlaciona documento, dono e objeto e não pode ficar só fora do Git',
);
confere(
  'a conferência separa pública legada de referência quebrada',
  migracao.includes('const publicasVivas') && migracao.includes('const publicasQuebradas'),
  'referência para objeto inexistente escondida atrás de "aceito por decisão" é defeito invisível',
);

// ───────────── 10. URL embutida em texto maior ─────────────

confere(
  'o varredor acha URL antiga EMBUTIDA em texto maior',
  migracao.includes('URL_ANTIGA_EMBUTIDA') && migracao.includes('embutida: true'),
  '`caminhoDaUrlAntiga` exige que a string inteira seja a URL: <img src> no HTML do post era invisível',
);
confere(
  'o varredor também acha URL PRÓPRIA embutida depois da migração',
  migracao.includes('URL_PROPRIA_EMBUTIDA') && migracao.includes('texto.match(URL_PROPRIA_EMBUTIDA)'),
  'sem isto, os objetos recém-migrados aparecem falsamente como registrados sem referência',
);
confere(
  'a troca de embutida é por SUBSTRING, não do valor inteiro',
  migracao.includes('trocarTextoNoCaminho(entrada.doc.fields, r.caminho, r.urlAntiga, nova)') &&
    migracao.includes('function trocarTextoNoCaminho'),
  'trocar o valor inteiro de posts.text apagaria o post',
);
confere(
  'a troca por substring troca UMA ocorrência por referência',
  migracao.includes('atual.replace(de, () => para)'),
  'trocar todas de uma vez descasaria da contagem de referências, que é uma por ocorrência',
);
confere(
  'a substituição não interpreta $& nem $1',
  migracao.includes('() => para'),
  'replace com string interpreta $& e corromperia a URL',
);

// ───────────── 11. a correção do avatar: o caminho antigo vem do REGISTRO ─────────────
//
// Sem isto, migrar os 42 avatares e capas quebraria em silêncio a exclusão da foto anterior: o parser antigo lia
// `/o/<caminho>` da URL do Firebase, e a URL migrada não tem isso. Cada troca de foto deixaria um órfão novo.

const dialogo = readFileSync(join(RAIZ, 'src', 'components', 'profile', 'EditProfileDialog.tsx'), 'utf8');
confere(
  'AVATAR · o parser que lia /o/<caminho> da URL foi removido',
  !dialogo.includes('getPathFromStorageUrl') && !dialogo.includes('isFirebaseStorageUrl'),
  'o parser antigo devolve null para URL própria, e a foto anterior fica no bucket para sempre',
);
confere(
  'AVATAR · resolve o caminho pelo registro media/{id}',
  dialogo.includes('mediaIdFromUrl(url)') && dialogo.includes("getDoc(doc(db, 'media', propria.id))") &&
    dialogo.includes('storagePath'),
  'é o registro que sabe o caminho quando a URL é própria',
);
confere(
  'AVATAR · ainda entende a URL antiga durante a transição',
  dialogo.includes('caminhoDaUrlAntiga(url)'),
  'enquanto houver avatar não migrado, a forma antiga tem de continuar funcionando',
);
confere(
  'AVATAR · usa o parser auditado, não um parser próprio',
  dialogo.includes("from '@/lib/media/legacyUrl'") && !dialogo.includes("hostname.includes('firebasestorage"),
  'o parser que estava aqui comparava o host com includes: host-falso.test passaria',
);
confere(
  'AVATAR · marca o registro da mídia substituída',
  dialogo.includes('midiasSubstituidas') && dialogo.includes('tombstoneMediaDoc(anterior.mediaId)'),
  'apagar o objeto sem marcar o registro cria `objeto-ausente-sem-tombstone`',
);
confere(
  'AVATAR · marca DEPOIS de apagar o objeto',
  dialogo.indexOf('await deleteFileFromStorage(anterior.caminho)') <
    dialogo.indexOf('tombstoneMediaDoc(anterior.mediaId)'),
  'nessa ordem não há token para revogar, e o tombstone direto pela regra do dono basta',
);
confere(
  'AVATAR · existe UM único lugar que marca tombstone',
  (dialogo.match(/tombstoneMediaDoc\(/g) ?? []).length === 1,
  'um segundo caminho de tombstone escaparia da guarda do desfecho',
);
confere(
  'AVATAR · resolve o anterior ANTES de subir o novo',
  dialogo.indexOf('resolverMidiaAtual(user.avatarUrl)') <
    dialogo.indexOf('uploadFileToStorage(user.id, croppedAvatarFile'),
  'depois do upload o payload já teria a URL nova, e o anterior se perderia',
);
confere(
  'AVATAR · trata também a REMOÇÃO da foto, não só a troca',
  dialogo.includes('if (croppedAvatarFile || avatarRemoved)') &&
    dialogo.includes('if (croppedCoverFile || coverRemoved)'),
  'remover a foto também precisa apagar o objeto anterior',
);

// ───────────── 12. tombstone só com certeza de ausência ─────────────
//
// O tombstone é a afirmação "este objeto não existe mais". Gravá-lo quando a exclusão FALHOU é mentir no banco, e a
// mentira é pior que o vazamento: o objeto continua servindo pela URL antiga e o registro marcado não é mais olhado
// por ninguém, então a reconciliação nunca o acha.

const erroFirebase = (code) => Object.assign(new Error(`firebase: ${code}`), { code });

confere(
  'TOMBSTONE · exclusão confirmada → marca',
  classifyDeletionOutcome(null) === 'excluido' && shouldTombstone('excluido'),
  'sucesso tem de autorizar o tombstone',
);
confere(
  'TOMBSTONE · storage/object-not-found → certeza de ausência, marca',
  classifyDeletionOutcome(erroFirebase('storage/object-not-found')) === 'ja-ausente' &&
    shouldTombstone('ja-ausente'),
  'objeto ausente é fim de vida esperado, e o registro deve refletir isso',
);
for (const code of [
  'storage/bucket-not-found',
  'storage/project-not-found',
  'storage/unauthorized',
  'storage/retry-limit-exceeded',
  'storage/canceled',
  'storage/quota-exceeded',
  'storage/unknown',
  'storage/invalid-argument',
]) {
  confere(
    `TOMBSTONE · ${code} → falha real, NÃO marca`,
    classifyDeletionOutcome(erroFirebase(code)) === 'falhou' && !shouldTombstone('falhou'),
    'marcar aqui esconderia do inventário um objeto que continua no bucket',
  );
}
for (const [nome, erro] of [
  ['erro sem code', new Error('rede caiu')],
  ['string solta', 'falhou'],
  ['objeto vazio', {}],
  ['code não-string', { code: 42 }],
]) {
  confere(
    `TOMBSTONE · ${nome} → falha real, NÃO marca`,
    classifyDeletionOutcome(erro) === 'falhou',
    'qualquer coisa que não seja certeza de ausência tem de ser tratada como falha',
  );
}
confere(
  'TOMBSTONE · só vale segunda tentativa para falha passageira',
  worthRetrying(erroFirebase('storage/retry-limit-exceeded')) === true &&
    worthRetrying(erroFirebase('storage/unknown')) === true &&
    worthRetrying(erroFirebase('storage/unauthorized')) === false,
  'permissão não melhora tentando de novo; insistir só atrasa a pessoa',
);
confere(
  'AVATAR · o diálogo decide o tombstone pelo DESFECHO, não por ter tentado',
  dialogo.includes('shouldTombstone(desfecho)') && dialogo.includes('classifyDeletionOutcome(erro)'),
  'o `.catch(() => {})` seguido de tombstone era exatamente o defeito',
);
confere(
  'AVATAR · a exclusão da mídia ANTERIOR não engole o erro',
  !/deleteFileFromStorage\(updatePayload\.old(Avatar|Cover)Path\)\.catch/.test(dialogo) &&
    dialogo.includes('await deleteFileFromStorage(anterior.caminho)'),
  'engolir o erro aqui é o que permitia o tombstone mentiroso; o rollback do arquivo NOVO pode continuar engolindo',
);
confere(
  'AVATAR · falha real deixa o registro ATIVO',
  dialogo.includes('if (anterior.mediaId && shouldTombstone(desfecho))') &&
    dialogo.includes('await tombstoneMediaDoc(anterior.mediaId)'),
  'registro ativo apontando para objeto existente é a única coisa que a reconciliação acha depois',
);
confere(
  'AVATAR · tenta de novo quando a falha é passageira',
  dialogo.includes('worthRetrying(erro)') && dialogo.includes('tentativa < 2'),
  'falha de rede resolvida numa segunda tentativa não deveria virar pendência',
);
confere(
  'AVATAR · informa a pessoa quando fica pendente',
  dialogo.includes("t('replacementCleanupDescription', { count: pendentes })") &&
    dialogo.includes("variant: 'destructive'"),
  'falha silenciosa faz a pessoa achar que a imagem anterior foi apagada',
);
confere(
  'AVATAR · falha do tombstone não aciona rollback da imagem nova',
  dialogo.includes("return 'registro-pendente'") &&
    dialogo.includes('Objeto anterior excluído, mas o tombstone ficou pendente'),
  'o perfil já foi salvo; propagar a falha faria o catch externo apagar a imagem nova em uso',
);
confere(
  'AVATAR · não mostra sucesso e pendência ao mesmo tempo',
  /if \(pendentes > 0\)[\s\S]*?replacementCleanupDescription[\s\S]*?} else \{[\s\S]*?updateSuccessDescription/.test(dialogo),
  'dois toasts contraditórios fariam o aviso de limpeza desaparecer',
);
confere(
  'AVATAR · sem caminho e com registro é tratado como falha, não como exclusão',
  /return anterior\.mediaId \? 'falhou' : 'excluido'/.test(dialogo),
  'registro cujo caminho não dá para resolver não pode ser marcado como removido',
);

// ───────────── 13. pré-condição de updateTime ─────────────

confere(
  'UPDATETIME · a pré-condição usa updateTime quando ele existe',
  JSON.stringify(preconditionFor('2026-11-11T20:00:00.000Z')) ===
    JSON.stringify({ updateTime: '2026-11-11T20:00:00.000Z' }),
  'sem updateTime a migração sobrescreve edição feita durante a execução',
);
for (const vazio of [null, undefined, '']) {
  confere(
    `UPDATETIME · sem updateTime (${JSON.stringify(vazio)}) cai em exists`,
    JSON.stringify(preconditionFor(vazio)) === JSON.stringify({ exists: true }),
    'é mais fraco, e por isso tem de ser contado e avisado',
  );
}
confere(
  'UPDATETIME · conta quantos ficaram sem proteção',
  countUnprotected(['a', null, 'b', '', undefined]) === 3,
  'sem a contagem, a fraqueza passa calada',
);
confere(
  'UPDATETIME · documento alterado é conflito',
  (() => {
    const c = conflictingDocuments(new Map([['d1', 't1']]), new Map([['d1', 't2']]));
    return c.length === 1 && c[0].tipo === 'alterado' && c[0].esperado === 't1' && c[0].atual === 't2';
  })(),
  'é o caso que a correção existe para pegar',
);
confere(
  'UPDATETIME · documento removido é conflito',
  (() => {
    const c = conflictingDocuments(new Map([['d1', 't1']]), new Map([['d1', null]]));
    return c.length === 1 && c[0].tipo === 'removido';
  })(),
  'documento apagado durante a migração também não pode ser regravado',
);
confere(
  'UPDATETIME · documento inalterado NÃO é conflito',
  conflictingDocuments(new Map([['d1', 't1']]), new Map([['d1', 't1']])).length === 0,
  'falso positivo faria a migração abortar sem motivo',
);
confere(
  'UPDATETIME · documento sem proteção não entra na lista',
  conflictingDocuments(new Map([['d1', null]]), new Map([['d1', 't9']])).length === 0,
  'não havia o que comparar: entrar na lista seria inventar um conflito',
);
confere(
  'UPDATETIME · ausente no mapa relido conta como removido',
  conflictingDocuments(new Map([['d1', 't1']]), new Map()).length === 1,
  'não reler é diferente de não existir, e o lado seguro é tratar como conflito',
);
confere(
  'UPDATETIME · reconhece a falha pelo status do corpo',
  isPreconditionFailure(Object.assign(new Error('HTTP 400: algo'), { firestoreStatus: 'FAILED_PRECONDITION' })),
  'o status do corpo é a fonte confiável; o texto varia',
);
confere(
  'UPDATETIME · reconhece a mensagem REAL do Firestore, que não diz "precondition"',
  isPreconditionFailure(new Error(
    'POST /projects/p/databases/d/documents:commit -> HTTP 400: ' +
    'the stored version (1794432805410150) does not match the required base version (1794432805390721)',
  )),
  'foi assim que o conflito passou como exceção genérica na primeira tentativa: casar por "precondition" não casa',
);
confere(
  'UPDATETIME · reconhece FAILED_PRECONDITION no texto',
  isPreconditionFailure(new Error('FAILED_PRECONDITION: no entity to update')),
  'algumas respostas trazem o status no texto',
);
confere(
  'UPDATETIME · NÃO confunde outra falha com conflito',
  !isPreconditionFailure(new Error('HTTP 503: backend unavailable')) &&
    !isPreconditionFailure(new Error('HTTP 403: permission denied')) &&
    !isPreconditionFailure(new Error('ECONNRESET')),
  'tratar falha de rede como conflito mandaria o operador caçar edição que não houve',
);

confere(
  'o script usa updateTime na reescrita, não exists',
  migracao.includes('currentDocument: preconditionFor(doc.updateTime)') &&
    migracao.includes('updateTimePorDocumento.set(doc.name, doc.updateTime)'),
  'exists: true não protege nada quando a leitura e o commit estão a minutos de distância',
);
confere(
  'o script ABORTA se qualquer documento vier sem updateTime',
  migracao.includes('Nenhuma reescrita será gravada sem proteção contra escrita concorrente') &&
    migracao.includes('Nenhuma restauração será gravada sem proteção contra escrita concorrente'),
  'avisar e continuar voltaria a permitir sobrescrita silenciosa',
);
confere(
  'o script ABORTA o lote e lista os documentos em conflito',
  migracao.includes('ABORTADO por escrita concorrente no lote') &&
    migracao.includes('conflictingDocuments(lidos, atuais)') &&
    migracao.includes('Nada deste lote foi gravado (o commit é atômico)'),
  'o Firestore não diz qual documento colidiu; sem a releitura o operador fica no escuro',
);
confere(
  'o script manda rodar de novo, e a retomada é idempotente',
  migracao.includes('Rode a MESMA fase de novo'),
  'sem a instrução, o operador pode achar que precisa restaurar o backup',
);
confere(
  'a pausa de teste é impossível em produção',
  migracao.includes('const PAUSA_ANTES_DO_COMMIT = PROD ? 0 :') &&
    migracao.includes('if (!PROD && PAUSA_ANTES_DO_COMMIT > 0'),
  'um seam de teste que funcione em produção é um defeito, não um teste',
);

// ───────────── 14. reversão por substituição inversa ─────────────

const ANTIGA = 'https://firebasestorage.googleapis.com/v0/b/x/o/user_uploads%2Fu%2Fa.jpg?alt=media&token=t';
const NOVA = 'https://media.exercitodolula.app/m/aaaaaaaaaaaaaaaaaaaaaa';

confere(
  'REVERTER · valor igual ao migrado volta ao anterior',
  JSON.stringify(decideRevert(NOVA, NOVA, ANTIGA)) === JSON.stringify({ acao: 'reverter', valor: ANTIGA }),
  'é a reversão normal',
);
confere(
  'REVERTER · valor já no anterior não é erro nem ação',
  decideRevert(ANTIGA, NOVA, ANTIGA).acao === 'ja-revertido',
  'rodar a reversão duas vezes tem de ser seguro',
);
confere(
  'REVERTER · valor mudado DEPOIS não é tocado',
  (() => {
    const d = decideRevert('https://media.exercitodolula.app/m/bbbbbbbbbbbbbbbbbbbbbb', NOVA, ANTIGA);
    return d.acao === 'mudou-depois';
  })(),
  'a pessoa trocou o avatar depois da migração: restaurar desfaria a escolha dela',
);
confere(
  'REVERTER · valor nulo ou ausente é tratado como mudou depois',
  decideRevert(null, NOVA, ANTIGA).acao === 'mudou-depois' &&
    decideRevert(undefined, NOVA, ANTIGA).acao === 'mudou-depois',
  'campo removido não pode ser recriado às cegas',
);
confere(
  'REVERTER · embutida troca só a substring, preservando o texto',
  (() => {
    const html = `<p>antes</p><img src="${NOVA}"><p>depois &amp; fim</p>`;
    const d = decideRevert(html, NOVA, ANTIGA, true);
    return d.acao === 'reverter' && d.valor === `<p>antes</p><img src="${ANTIGA}"><p>depois &amp; fim</p>`;
  })(),
  'regravar o campo raiz do backup desfaria qualquer edição feita no post',
);
confere(
  'REVERTER · embutida já revertida é reconhecida',
  decideRevert(`<p>x</p><img src="${ANTIGA}">`, NOVA, ANTIGA, true).acao === 'ja-revertido',
  'segunda passada tem de ser inócua também no HTML',
);
confere(
  'REVERTER · HTML editado depois, sem nenhuma das duas URLs, não é tocado',
  decideRevert('<p>o post foi reescrito pela pessoa</p>', NOVA, ANTIGA, true).acao === 'mudou-depois',
  'o post mudou: mexer nele agora apagaria o que a pessoa escreveu',
);
confere(
  'REVERTER · a substituição inversa não interpreta $&',
  (() => {
    const anteriorComDolar = 'https://firebasestorage.googleapis.com/v0/b/x/o/a.jpg?alt=media&token=$&x';
    const d = decideRevert(`<img src="${NOVA}">`, NOVA, anteriorComDolar, true);
    return d.acao === 'reverter' && d.valor.includes('token=$&x');
  })(),
  'replace com string interpreta $& e corromperia a URL restaurada',
);

confere(
  'a restauração usa substituição inversa, não o campo raiz do backup',
  migracao.includes('decideRevert(valorAgora, migrado, urlAntiga, embutida)') &&
    !migracao.includes('update: { name: r.documento, fields: r.camposAnteriores }'),
  'regravar o campo raiz desfaz edição posterior da pessoa junto com a URL',
);
confere(
  'a restauração também usa pré-condição de updateTime',
  /acao === 'mudou-depois'[\s\S]{0,2000}currentDocument: preconditionFor\(atual\.updateTime\)/.test(migracao),
  'a reversão corre o mesmo risco de concorrência que a migração',
);
confere(
  'a restauração relata o que NÃO reverteu',
  migracao.includes('mudaram depois (NÃO tocadas)') && migracao.includes('já estavam no valor anterior'),
  'reversão parcial silenciosa é pior que reversão que falha',
);
confere(
  'a restauração descobre o valor migrado pelo REGISTRO',
  migracao.includes('const registrosMediaRestaurar = await grupoDeColecoes') &&
    migracao.includes('idPorCaminho.get(caminhoObjeto)'),
  'o backup é anterior ao registrar e não conhece os ids: eles saem do registro',
);

// ───────────── 15. manifesto dos registros criados ─────────────

confere(
  'MANIFESTO · é gravado com id, caminho, dono, tipo e tamanho',
  migracao.includes("tipo: 'manifesto-registros-midia'") && migracao.includes('const criados = faltando.map'),
  'sem manifesto, saber depois quais registros nasceram nesta migração exige adivinhar pelo createdAt',
);
confere(
  'MANIFESTO · tem contagem e sha256',
  /tipo: 'manifesto-registros-midia'[\s\S]{0,400}sha256,/.test(migracao),
  'manifesto de auditoria sem integridade não serve de auditoria',
);
confere(
  'MANIFESTO · registra também quantos foram reutilizados',
  /tipo: 'manifesto-registros-midia'[\s\S]{0,400}reutilizados,/.test(migracao),
  'a reconciliação precisa separar o que foi criado do que já existia',
);
confere(
  'MANIFESTO · fica fora do repositório e com ACL restrita',
  migracao.includes('restringirAoDono(destino)') &&
    /MANIFESTO: \$\{destino\}/.test(migracao) &&
    migracao.includes("join(homedir(), 'soberan-backups')"),
  'correlaciona dono e caminho de objeto: é dado sensível',
);
confere(
  'MANIFESTO · o endurecimento de ACL é compartilhado com o backup',
  (migracao.match(/const permissao = restringirAoDono\(destino\);/g) ?? []).length === 2 &&
    migracao.includes('function restringirAoDono'),
  'duas cópias da mesma proteção divergem; a do backup já tinha sido corrigida uma vez',
);
confere(
  'MANIFESTO · só é gravado quando a fase aplica',
  migracao.includes('if (APLICAR && criados.length > 0)'),
  'manifesto de dry-run afirmaria que registros existem quando não existem',
);
confere(
  'MANIFESTO · registrar não sobrescreve registro existente',
  /currentDocument: \{ exists: false \}/.test(migracao),
  'sobrescrever um id faria duas mídias apontarem para o mesmo registro',
);

// ───────────── fim ─────────────

console.log('');
if (falhas) {
  console.log(`${falhas} falha(s).`);
  process.exit(1);
}
console.log('Inventário OK: órfão é só o que ninguém referencia nem registra.');
