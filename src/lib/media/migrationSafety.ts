// src/lib/media/migrationSafety.ts
// Segurança da migração de mídia contra escrita concorrente. Lógica pura e SEM imports, para
// `npm run e2e:midia-inventario` exercitar cada caso sem produção e sem emuladores.
//
// POR QUE EXISTE: a reescrita lê 3953 documentos, monta os writes e só então comita. Entre a leitura e o commit
// passam minutos, e nesses minutos uma pessoa pode trocar o próprio avatar, editar um post ou receber uma
// notificação. `currentDocument: { exists: true }` não protege nada disso: o documento existe, a pré-condição
// passa, e a migração grava o campo RAIZ inteiro lido ANTES da edição — desfazendo a edição da pessoa em silêncio.
//
// A pré-condição correta é `updateTime`: grava apenas se o documento não mudou desde a leitura. Em commit do
// Firestore a atomicidade é do lote inteiro, então um documento desatualizado aborta o lote todo — e isso é o
// comportamento desejado, porque nada pela metade é gravado. O que falta ao Firestore é dizer QUAL documento
// causou a falha; é o que `conflictingDocuments` resolve, comparando o lido com o relido.

/** Pré-condição de escrita do Firestore. `updateTime` é a forma otimista; `exists` só garante que existe. */
export type Precondition = { updateTime: string } | { exists: true };

/**
 * Pré-condição para um documento lido. Sem `updateTime` (documento vindo de uma leitura que não o trouxe) cai em
 * `exists: true`, que é mais fraco — e por isso quem monta o lote deve contar quantos ficaram sem proteção.
 */
export function preconditionFor(updateTime: string | null | undefined): Precondition {
  return typeof updateTime === 'string' && updateTime.length > 0 ? { updateTime } : { exists: true };
}

/** Quantos documentos de um lote não têm proteção otimista. Zero é o esperado. */
export function countUnprotected(updateTimes: readonly (string | null | undefined)[]): number {
  return updateTimes.filter((t) => !(typeof t === 'string' && t.length > 0)).length;
}

export type ConflictKind =
  /** Mudou desde a leitura: alguém escreveu no meio da migração. */
  | 'alterado'
  /** Desapareceu desde a leitura. */
  | 'removido';

export type Conflict = { documento: string; esperado: string; atual: string | null; tipo: ConflictKind };

/**
 * Quais documentos mudaram entre a leitura e a releitura. É o que transforma um `FAILED_PRECONDITION` genérico do
 * Firestore numa lista acionável.
 *
 * `lidos`: o `updateTime` que a migração usou na pré-condição. `atuais`: o `updateTime` relido agora, ou `null` se
 * o documento não existe mais.
 */
export function conflictingDocuments(
  lidos: ReadonlyMap<string, string | null | undefined>,
  atuais: ReadonlyMap<string, string | null>,
): Conflict[] {
  const conflitos: Conflict[] = [];
  for (const [documento, esperado] of lidos) {
    if (!(typeof esperado === 'string' && esperado.length > 0)) continue; // sem proteção, nada a comparar
    const atual = atuais.get(documento) ?? null;
    if (atual === null) conflitos.push({ documento, esperado, atual: null, tipo: 'removido' });
    else if (atual !== esperado) conflitos.push({ documento, esperado, atual, tipo: 'alterado' });
  }
  return conflitos;
}

/**
 * O erro do Firestore é de pré-condição? É o que distingue conflito de falha de rede, de permissão ou de cota.
 *
 * A fonte confiável é `error.status` do corpo da resposta (`FAILED_PRECONDITION`), que quem faz a chamada deve
 * carregar no erro como `firestoreStatus`. O texto é apenas o reforço, e **não** menciona "precondition": a
 * mensagem real é `the stored version (…) does not match the required base version (…)`. Casar só por "precondition"
 * deixava o conflito passar como exceção genérica, e o operador ficava sem a lista de documentos.
 */
export function isPreconditionFailure(erro: unknown): boolean {
  if (typeof erro === 'object' && erro !== null) {
    const status = (erro as { firestoreStatus?: unknown }).firestoreStatus;
    if (typeof status === 'string' && /FAILED_PRECONDITION/i.test(status)) return true;
  }
  const mensagem = typeof erro === 'object' && erro !== null && 'message' in erro
    ? String((erro as { message?: unknown }).message ?? '')
    : String(erro ?? '');
  if (/FAILED_PRECONDITION|failed-precondition/i.test(mensagem)) return true;
  return /does not match the required base version|stored version .*base version/i.test(mensagem);
}

// ───────────────────────── Reversão ─────────────────────────

export type RevertDecision =
  /** O campo tem exatamente o valor que a migração escreveu: pode voltar ao anterior. */
  | { acao: 'reverter'; valor: string }
  /** O campo já voltou a ter o valor anterior. Nada a fazer, e não é erro. */
  | { acao: 'ja-revertido' }
  /** O campo mudou depois da migração: NÃO tocar, e relatar. */
  | { acao: 'mudou-depois'; atual: string | null };

/**
 * Decide, por referência, se a reversão pode acontecer — e ela é por **substituição inversa**, não por regravar o
 * campo raiz lido no backup.
 *
 * O motivo é concreto: o backup guarda o campo raiz inteiro de antes da migração. Regravá-lo desfaz, junto com a
 * URL, qualquer coisa que a pessoa tenha mudado naquele campo depois — um post editado, um avatar trocado, um
 * participante entrando na conversa. A reversão correta troca **só** o valor que a migração escreveu, e só se ele
 * ainda estiver lá.
 *
 * `atual`: o que está no campo agora. `migrado`: o que a migração escreveu. `anterior`: o que havia antes.
 * `embutida`: o valor é uma URL dentro de um texto maior, e aí a comparação é por conter, não por igualdade.
 */
export function decideRevert(
  atual: string | null | undefined,
  migrado: string,
  anterior: string,
  embutida = false,
): RevertDecision {
  if (typeof atual !== 'string') return { acao: 'mudou-depois', atual: atual ?? null };

  if (embutida) {
    if (atual.includes(migrado)) return { acao: 'reverter', valor: atual.replace(migrado, () => anterior) };
    if (atual.includes(anterior)) return { acao: 'ja-revertido' };
    return { acao: 'mudou-depois', atual };
  }

  if (atual === migrado) return { acao: 'reverter', valor: anterior };
  if (atual === anterior) return { acao: 'ja-revertido' };
  return { acao: 'mudou-depois', atual };
}
