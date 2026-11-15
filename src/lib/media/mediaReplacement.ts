// src/lib/media/mediaReplacement.ts
// Decisão de quando marcar `media/{id}` como removido ao substituir avatar ou capa. Lógica pura e SEM imports, para
// `npm run e2e:midia-inventario` exercitar cada desfecho sem DOM, sem Firebase e sem emuladores.
//
// POR QUE EXISTE: o tombstone é a afirmação "este objeto não existe mais". Gravá-lo quando a exclusão FALHOU é
// mentir no banco, e a mentira é pior que o vazamento: o objeto continua no bucket, servindo pela URL antiga, e o
// inventário passa a dizer que aquilo foi removido. Fica invisível para a reconciliação, porque o registro já está
// marcado e ninguém mais olha.
//
// A versão anterior fazia exatamente isso: `deleteFileFromStorage(...).catch(() => {})` e depois o tombstone, sem
// nenhuma relação entre os dois.

/** O que de fato aconteceu com o objeto antigo. */
export type DeletionOutcome =
  /** O Storage confirmou a exclusão. */
  | 'excluido'
  /** O objeto já não existia. Também é certeza de ausência, e por isso também autoriza o tombstone. */
  | 'ja-ausente'
  /** Falha real: permissão, rede, limite de tentativas, desconhecido. NÃO autoriza o tombstone. */
  | 'falhou';

/** Resultado completo da limpeza, incluindo a atualização do registro depois da exclusão física. */
export type ReplacementOutcome = DeletionOutcome | 'registro-pendente';

/**
 * Códigos do Firebase Storage que significam "o objeto não está lá". `object-not-found` é o caso normal; os outros
 * dois aparecem quando o caminho aponta para um bucket ou projeto que não existe, e em todos a conclusão sobre o
 * objeto é a mesma: ausente.
 */
// Só `object-not-found` confirma a ausência do objeto no bucket correto. Bucket ou projeto inexistente também pode
// indicar configuração incorreta; nesse caso marcar tombstone esconderia um objeto que ainda pode existir.
const AUSENTE = ['storage/object-not-found'];

/** Lê o código de um erro do Firebase sem supor a forma do objeto de erro. */
function codigoDoErro(erro: unknown): string {
  if (typeof erro === 'object' && erro !== null && 'code' in erro) {
    const code = (erro as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return '';
}

/**
 * Classifica o desfecho de uma tentativa de exclusão. `erro` nulo significa sucesso.
 *
 * Qualquer coisa que não seja certeza de ausência é `falhou`. É deliberado: na dúvida, o registro fica ativo, e um
 * registro ativo apontando para objeto que existe é a única coisa que permite tentar de novo depois.
 */
export function classifyDeletionOutcome(erro: unknown | null): DeletionOutcome {
  if (erro === null || erro === undefined) return 'excluido';
  return AUSENTE.includes(codigoDoErro(erro)) ? 'ja-ausente' : 'falhou';
}

/** O tombstone só pode ser gravado com certeza de que o objeto não está mais lá. */
export function shouldTombstone(desfecho: DeletionOutcome): boolean {
  return desfecho === 'excluido' || desfecho === 'ja-ausente';
}

/**
 * Vale uma segunda tentativa? Só para falha que costuma ser passageira. Permissão não melhora tentando de novo, e
 * ausência não é falha.
 */
const PASSAGEIRO = [
  'storage/retry-limit-exceeded',
  'storage/canceled',
  'storage/server-file-wrong-size',
  'storage/unknown',
  '',
];
export function worthRetrying(erro: unknown): boolean {
  return PASSAGEIRO.includes(codigoDoErro(erro));
}
