// src/lib/media/mediaInventory.ts
// Classificação do inventário de mídia: cruza o que existe no Storage, o que existe em `media/{id}` e o que o
// conteúdo de fato referencia. Lógica pura e SEM imports — nem dos vizinhos — para o `npm run e2e:midia-inventario`
// exercitar todas as categorias com dados sintéticos, sem produção e sem emuladores.
//
// POR QUE EXISTE: a primeira versão deste cálculo era `objetos.filter(o => !referenciadoPorUrlLegada(o))`, e isso
// está errado desde o momento em que a migração trocou as URLs. Depois da migração NENHUM objeto migrado tem
// referência legada — ele é referenciado por `/mp/<id>`, resolvido pelo registro. O resultado foi chamar de "órfão"
// justamente o objeto mais corretamente administrado do bucket. Um inventário que erra assim não é só impreciso:
// ele é o insumo de uma decisão de LIMPEZA, e limpar por essa lista apagaria anexo vivo.
//
// A correção é contar a UNIÃO de três origens de "alguém depende deste objeto":
//   1. referência legada (URL do Firebase gravada no conteúdo);
//   2. `media/{id}.storagePath` válido (o registro é o que a rota usa para servir);
//   3. referência própria `/m/<id>` e `/mp/<id>` no conteúdo, resolvida pelo registro.

/** Visibilidade derivada do tipo. Quem monta a entrada já resolveu isso; aqui ela só é transportada. */
export type InventoryVisibility = 'public' | 'private';

/** Um objeto como o Storage o lista. */
export type InventoryObject = {
  path: string;
  kind: string;
  visibility: InventoryVisibility;
  hasToken: boolean;
  size?: number;
};

/** Um documento de `media/{id}`. `storagePath` vem como está no banco, inclusive ausente ou inválido. */
export type InventoryRegistration = {
  id: string;
  storagePath: string | null | undefined;
  visibility?: string;
  kind?: string;
  /** `deletedAt` presente. Tombstone é estado DESEJADO, não defeito: a rota responde 410 por causa dele. */
  tombstoned?: boolean;
};

/** Referência legada: URL do Firebase gravada no conteúdo, já resolvida para o caminho do objeto. */
export type LegacyReference = { storagePath: string; where: string };

/** Referência própria: `/m/<id>` ou `/mp/<id>` gravado no conteúdo, com o id já extraído. */
export type OwnReference = { id: string; visibility: InventoryVisibility; where: string };

export type InventoryInput = {
  objects: readonly InventoryObject[];
  registrations: readonly InventoryRegistration[];
  legacyReferences: readonly LegacyReference[];
  ownReferences: readonly OwnReference[];
  /** Validador do caminho. Injetado para este módulo não importar vizinho e seguir testável pelo `.mjs`. */
  isValidStoragePath: (path: string | null | undefined) => boolean;
};

/** Como um objeto do Storage foi classificado. As quatro categorias pedidas, mais o que distingue dentro delas. */
export type ObjectStatus =
  /** Tem referência de conteúdo apontando para ele. */
  | 'ativo-referenciado'
  /** Tem registro `media/{id}` válido, mas nenhum conteúdo aponta para ele. */
  | 'registrado-sem-referencia'
  /** Não tem referência NEM registro válido. É o único que é realmente órfão. */
  | 'orfao';

export type ClassifiedObject = InventoryObject & {
  status: ObjectStatus;
  /** Ids de `media/{id}` que apontam para este objeto. Mais de um é anomalia, e aparece no relatório. */
  registrationIds: string[];
  legacyReferenceCount: number;
  ownReferenceCount: number;
  /** Só faz sentido em `registrado-sem-referencia`: o registro está marcado como excluído. */
  tombstoned: boolean;
};

/** Por que um registro não corresponde a objeto nenhum. */
export type RegistrationProblem =
  /** `storagePath` ausente, vazio ou fora da forma aceita. Não serve nada, e nunca serviu. */
  | 'caminho-invalido'
  /** Caminho válido, objeto inexistente no bucket, registro marcado como excluído — fim de vida esperado. */
  | 'objeto-ausente-com-tombstone'
  /** Caminho válido, objeto inexistente, SEM tombstone — a rota responderia 404 e ninguém sabe por quê. */
  | 'objeto-ausente-sem-tombstone';

export type ClassifiedRegistration = InventoryRegistration & { problem: RegistrationProblem };

export type InventoryReport = {
  /** A união das três origens: todo caminho que alguém conhece. O complemento disso no bucket é o órfão real. */
  accountedPaths: Set<string>;

  // ── as quatro categorias pedidas ──
  /** Existe no Storage, mas não tem referência nem registro válido. */
  orphanObjects: ClassifiedObject[];
  /** Existe em `media/{id}`, mas o objeto não existe (ou o caminho é inválido). */
  orphanRegistrations: ClassifiedRegistration[];
  /** Objeto registrado, sem nenhuma referência de conteúdo. */
  registeredWithoutReference: ClassifiedObject[];
  /** Objeto ativo e corretamente referenciado. */
  activeObjects: ClassifiedObject[];

  // ── o que distingue dentro de "ativo" ──
  /** Referenciado por URL própria: o estado final desejado. */
  activeByOwnUrl: ClassifiedObject[];
  /** Referenciado SÓ por URL legada do Firebase: funciona, mas expõe UID e host. Decisão declarada. */
  activeByLegacyOnly: ClassifiedObject[];

  // ── anomalias que o inventário antigo não mostrava ──
  /** `/m/<id>` ou `/mp/<id>` gravado no conteúdo sem registro `media/{id}` nenhum: 404 para sempre. */
  danglingOwnReferences: OwnReference[];
  /** Referência própria cujo registro está com tombstone: a rota responde 410. Esperado após exclusão. */
  ownReferencesToTombstoned: OwnReference[];
  /** Referência própria cuja rota (`/m/` ou `/mp/`) discorda da visibilidade do registro. */
  ownReferencesWithWrongRoute: OwnReference[];
  /** Referência legada apontando para objeto que não existe mais. */
  legacyReferencesWithoutObject: LegacyReference[];
  /** Mais de um registro para o mesmo caminho. */
  duplicateRegistrationPaths: { storagePath: string; ids: string[] }[];
  /** Registros com tombstone, contados à parte: é estado desejado. */
  tombstonedRegistrations: InventoryRegistration[];
  /**
   * Objeto que TEM registro `media/{id}` e ainda carrega `firebaseStorageDownloadTokens`. Contradição: o registro
   * diz que o objeto é servido pela nossa rota, com autorização a cada pedido, e o token continua servindo o mesmo
   * objeto a quem tiver o link, sem login e sem passar por regra nenhuma. Vale para público e para privado — para
   * privado é exposição; para público é o token redundante que a decisão declarada mantém.
   */
  registeredWithToken: ClassifiedObject[];

  /** Todo objeto do Storage, classificado, na ordem de entrada. */
  objects: ClassifiedObject[];

  totals: {
    objects: number;
    registrations: number;
    validRegistrations: number;
    legacyReferences: number;
    ownReferences: number;
  };
};

export function classifyMediaInventory(input: InventoryInput): InventoryReport {
  const { objects, registrations, legacyReferences, ownReferences, isValidStoragePath } = input;

  const objectByPath = new Map<string, InventoryObject>();
  for (const objeto of objects) objectByPath.set(objeto.path, objeto);

  // ── registros: por id e por caminho, separando o que é válido do que nunca serviu ──
  const registrationById = new Map<string, InventoryRegistration>();
  const registrationIdsByPath = new Map<string, string[]>();
  const invalidRegistrations: ClassifiedRegistration[] = [];
  const tombstonedRegistrations: InventoryRegistration[] = [];
  let validRegistrations = 0;

  for (const registro of registrations) {
    registrationById.set(registro.id, registro);
    if (registro.tombstoned) tombstonedRegistrations.push(registro);
    if (!isValidStoragePath(registro.storagePath)) {
      invalidRegistrations.push({ ...registro, problem: 'caminho-invalido' });
      continue;
    }
    validRegistrations++;
    const caminho = registro.storagePath as string;
    const lista = registrationIdsByPath.get(caminho) ?? [];
    lista.push(registro.id);
    registrationIdsByPath.set(caminho, lista);
  }

  // ── referências próprias: resolvidas pelo registro, e cada falha de resolução é nomeada ──
  const ownRefCountByPath = new Map<string, number>();
  const danglingOwnReferences: OwnReference[] = [];
  const ownReferencesToTombstoned: OwnReference[] = [];
  const ownReferencesWithWrongRoute: OwnReference[] = [];

  for (const referencia of ownReferences) {
    const registro = registrationById.get(referencia.id);
    if (!registro) {
      danglingOwnReferences.push(referencia);
      continue;
    }
    if (registro.tombstoned) ownReferencesToTombstoned.push(referencia);
    if (registro.visibility && registro.visibility !== referencia.visibility) {
      ownReferencesWithWrongRoute.push(referencia);
    }
    if (!isValidStoragePath(registro.storagePath)) continue;
    const caminho = registro.storagePath as string;
    ownRefCountByPath.set(caminho, (ownRefCountByPath.get(caminho) ?? 0) + 1);
  }

  // ── referências legadas ──
  const legacyRefCountByPath = new Map<string, number>();
  const legacyReferencesWithoutObject: LegacyReference[] = [];
  for (const referencia of legacyReferences) {
    legacyRefCountByPath.set(referencia.storagePath, (legacyRefCountByPath.get(referencia.storagePath) ?? 0) + 1);
    if (!objectByPath.has(referencia.storagePath)) legacyReferencesWithoutObject.push(referencia);
  }

  // ── a união: todo caminho que alguém conhece ──
  const accountedPaths = new Set<string>();
  for (const caminho of legacyRefCountByPath.keys()) accountedPaths.add(caminho);
  for (const caminho of registrationIdsByPath.keys()) accountedPaths.add(caminho);
  for (const caminho of ownRefCountByPath.keys()) accountedPaths.add(caminho);

  // ── classifica cada objeto do Storage ──
  const classificados: ClassifiedObject[] = [];
  const orphanObjects: ClassifiedObject[] = [];
  const registeredWithoutReference: ClassifiedObject[] = [];
  const activeObjects: ClassifiedObject[] = [];
  const activeByOwnUrl: ClassifiedObject[] = [];
  const activeByLegacyOnly: ClassifiedObject[] = [];
  const registeredWithToken: ClassifiedObject[] = [];

  for (const objeto of objects) {
    const registrationIds = registrationIdsByPath.get(objeto.path) ?? [];
    const legacyReferenceCount = legacyRefCountByPath.get(objeto.path) ?? 0;
    const ownReferenceCount = ownRefCountByPath.get(objeto.path) ?? 0;
    const tombstoned = registrationIds.some((id) => registrationById.get(id)?.tombstoned === true);

    let status: ObjectStatus;
    if (legacyReferenceCount + ownReferenceCount > 0) status = 'ativo-referenciado';
    else if (registrationIds.length > 0) status = 'registrado-sem-referencia';
    else status = 'orfao';

    const classificado: ClassifiedObject = {
      ...objeto,
      status,
      registrationIds,
      legacyReferenceCount,
      ownReferenceCount,
      tombstoned,
    };
    classificados.push(classificado);
    if (registrationIds.length > 0 && objeto.hasToken) registeredWithToken.push(classificado);

    if (status === 'orfao') orphanObjects.push(classificado);
    else if (status === 'registrado-sem-referencia') registeredWithoutReference.push(classificado);
    else {
      activeObjects.push(classificado);
      if (ownReferenceCount > 0) activeByOwnUrl.push(classificado);
      else activeByLegacyOnly.push(classificado);
    }
  }

  // ── registros sem objeto ──
  const orphanRegistrations: ClassifiedRegistration[] = [...invalidRegistrations];
  for (const registro of registrations) {
    if (!isValidStoragePath(registro.storagePath)) continue;
    if (objectByPath.has(registro.storagePath as string)) continue;
    orphanRegistrations.push({
      ...registro,
      problem: registro.tombstoned ? 'objeto-ausente-com-tombstone' : 'objeto-ausente-sem-tombstone',
    });
  }

  const duplicateRegistrationPaths = [...registrationIdsByPath]
    .filter(([, ids]) => ids.length > 1)
    .map(([storagePath, ids]) => ({ storagePath, ids }));

  return {
    accountedPaths,
    orphanObjects,
    orphanRegistrations,
    registeredWithoutReference,
    activeObjects,
    activeByOwnUrl,
    activeByLegacyOnly,
    danglingOwnReferences,
    ownReferencesToTombstoned,
    ownReferencesWithWrongRoute,
    legacyReferencesWithoutObject,
    duplicateRegistrationPaths,
    tombstonedRegistrations,
    registeredWithToken,
    objects: classificados,
    totals: {
      objects: objects.length,
      registrations: registrations.length,
      validRegistrations,
      legacyReferences: legacyReferences.length,
      ownReferences: ownReferences.length,
    },
  };
}

/**
 * Pseudonimiza um caminho para o relatório: preserva a ESTRUTURA, que é o que se está diagnosticando, e troca o
 * identificador da pessoa e o nome do arquivo por um rótulo curto e estável.
 *
 *   user_uploads/qdnRs…/dms/images/699e17f9-….jpg  ->  user_uploads/u:4b1c7f2a/dms/images/#9e3d0a11.jpg
 *
 * O rótulo é estável dentro de um relatório, então dá para ver que duas linhas falam da mesma pessoa, sem o
 * relatório carregar o identificador dela. É pseudonimização, não anonimato: quem já tem a lista de UIDs pode
 * recalcular o rótulo. Serve para o relatório não virar um despejo de dados pessoais, não como garantia de sigilo.
 */
export function pseudonymizeStoragePath(path: string): string {
  const partes = (path ?? '').split('/');
  if (partes.length < 3) return `${rotulo('?', path ?? '')}`;
  const [raiz, uid, ...resto] = partes;
  const arquivo = resto.pop() ?? '';
  const ponto = arquivo.lastIndexOf('.');
  const extensao = ponto > 0 ? arquivo.slice(ponto) : '';
  const pseudoArquivo = `${rotulo('#', arquivo)}${extensao}`;
  return [raiz, rotulo('u:', uid), ...resto, pseudoArquivo].join('/');
}

/**
 * Pseudonimiza o nome de um documento do Firestore, preservando os nomes de coleção — que são o diagnóstico — e
 * trocando só os ids. Um sufixo ` · campo` é preservado: saber que o problema está em `fileUrl` ou em
 * `media[0].url` é metade da informação, e o nome do campo não identifica ninguém.
 */
export function pseudonymizeDocumentPath(name: string): string {
  const [caminho, ...resto] = (name ?? '').split(' · ');
  const partes = caminho.split('/');
  const pseudo = partes.map((parte, i) => (i % 2 === 0 ? parte : rotulo('', parte))).join('/');
  return [pseudo, ...resto].join(' · ');
}

/** FNV-1a de 32 bits. Escolhido por ser curto e sem dependência: o rótulo é de leitura, não de segurança. */
function rotulo(prefixo: string, valor: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < valor.length; i++) {
    hash ^= valor.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${prefixo}${hash.toString(16).padStart(8, '0')}`;
}
