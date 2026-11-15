// src/lib/utils/firestoreData.ts
// Preparação de dados para gravar no Firestore.
//
// O Firestore recusa `undefined` em qualquer ponto do documento ("Function addDoc() called with invalid data.
// Unsupported field value: undefined"). Basta um campo opcional sem valor, ou um `{ ...objeto, campo: undefined }`,
// para o envio inteiro falhar (foi o que derrubava todo comentário com imagem).

import type { Media } from '@/lib/types';

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/**
 * Remove, em qualquer profundidade, as chaves com valor `undefined` (e os `undefined` dentro de listas).
 * Só atravessa objetos simples e listas: valores especiais do Firestore (serverTimestamp, increment, Timestamp,
 * GeoPoint, referências), `Date` e instâncias de classes passam intactos.
 */
export function removeUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== undefined).map((item) => removeUndefinedDeep(item)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const clean: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) clean[key] = removeUndefinedDeep(item);
    }
    return clean as T;
  }
  return value;
}

/**
 * Mídia como é gravada: só os campos do tipo `Media`. A tela de envio acrescenta campos de controle (`uploadId`,
 * `status`, pré-visualização) que não podem ir para o banco; aqui tudo que não é do tipo é descartado.
 */
export function toStoredMedia(media: ReadonlyArray<Partial<Media> & { url: string; type: Media['type'] }> | null | undefined): Media[] | null {
  if (!media || media.length === 0) return null;
  return media.map((item) => removeUndefinedDeep({
    url: item.url,
    type: item.type,
    alt: item.alt,
    'data-ai-hint': item['data-ai-hint'],
  }));
}
