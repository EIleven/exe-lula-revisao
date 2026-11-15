#!/usr/bin/env node
/**
 * Testa src/lib/utils/firestoreData.ts (preparação de dados para gravar no Firestore) sem app nem emuladores:
 * importa o módulo TypeScript direto (o Node 22 remove os tipos).
 *   node e2e/firestore-data-check.mjs
 * O Firestore recusa `undefined` em qualquer ponto do documento. Todo comentário com imagem falhava porque a mídia era
 * gravada com `{ ...m, tempId: undefined, isLoading: undefined }`. Aqui se confere que o `undefined` sai em qualquer
 * profundidade, que valores especiais do Firestore (serverTimestamp e afins) passam intactos e que a mídia gravada só
 * tem os campos do tipo `Media`. Sai com código 1 se algo falhar.
 */
const { removeUndefinedDeep, toStoredMedia } = await import('../src/lib/utils/firestoreData.ts');

let falhas = 0;
let total = 0;
const confere = (nome, condicao, detalhe = '') => {
  total++;
  if (condicao) {
    console.log(`OK    ${nome}`);
  } else {
    falhas++;
    console.log(`FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  }
};

/** Procura `undefined` em objetos simples e listas, como o Firestore faz ao validar o documento. */
const temUndefined = (valor) => {
  if (valor === undefined) return true;
  if (Array.isArray(valor)) return valor.some(temUndefined);
  if (valor !== null && typeof valor === 'object' && Object.getPrototypeOf(valor) === Object.prototype) {
    return Object.values(valor).some(temUndefined);
  }
  return false;
};

// O defeito original: o mapeamento antigo deixava `undefined` na mídia (o detector precisa enxergá-lo).
const midiaAntiga = [{ url: 'https://exemplo/a.png', type: 'image', alt: '' }].map((m) => ({ ...m, tempId: undefined, isLoading: undefined }));
confere('o detector enxerga o defeito antigo (tempId/isLoading undefined)', temUndefined(midiaAntiga));
confere('removeUndefinedDeep limpa a mídia do defeito antigo', !temUndefined(removeUndefinedDeep(midiaAntiga)));
confere('...e mantém url, type e alt', JSON.stringify(removeUndefinedDeep(midiaAntiga)) === JSON.stringify([{ url: 'https://exemplo/a.png', type: 'image', alt: '' }]));

// Profundidade: objeto dentro de objeto dentro de lista (o post citado dentro do comentário tinha allowReposts undefined).
const aninhado = { a: 1, b: undefined, c: { d: undefined, e: [1, undefined, { f: undefined, g: 2 }], h: null }, i: [undefined, undefined] };
const limpo = removeUndefinedDeep(aninhado);
confere('remove undefined em objetos aninhados e dentro de listas', !temUndefined(limpo));
confere('estrutura esperada depois de limpar', JSON.stringify(limpo) === JSON.stringify({ a: 1, c: { e: [1, { g: 2 }], h: null }, i: [] }), JSON.stringify(limpo));
confere('não altera o objeto original', aninhado.b === undefined && 'b' in aninhado && aninhado.c.e.length === 3);

// Valores que NÃO são undefined precisam sobreviver: 0, '', false e null são dados válidos.
const validos = removeUndefinedDeep({ zero: 0, vazio: '', falso: false, nulo: null, lista: [0, '', false, null] });
confere('0, texto vazio, false e null permanecem', validos.zero === 0 && validos.vazio === '' && validos.falso === false && validos.nulo === null && validos.lista.length === 4);

// Valores especiais do Firestore são instâncias de classes: passam pela MESMA referência (se fossem copiados como objeto
// simples, serverTimestamp() deixaria de funcionar).
class ValorEspecial { constructor() { this.interno = undefined; } }
const sentinela = new ValorEspecial();
const data = new Date('2026-10-25T00:00:00Z');
const comEspeciais = removeUndefinedDeep({ createdAt: sentinela, quando: data, lista: [sentinela, data] });
confere('valor especial do Firestore (classe) passa intacto, pela mesma referência', comEspeciais.createdAt === sentinela && comEspeciais.lista[0] === sentinela);
confere('Date passa intacto, pela mesma referência', comEspeciais.quando === data && comEspeciais.lista[1] === data);
confere('objeto sem protótipo também é limpo', !temUndefined(removeUndefinedDeep(Object.assign(Object.create(null), { x: undefined, y: 1 }))));

// A mídia gravada tem só os campos do tipo Media.
const daTela = [
  { url: 'https://exemplo/b.png', type: 'image', alt: 'um gato', 'data-ai-hint': 'custom', uploadId: 'u1', status: 'ready', localPreviewUrl: 'data:image/png;base64,AAA', remoteUrl: 'https://exemplo/b.png', tempId: 't', isLoading: false },
  { url: 'https://exemplo/c.mp4', type: 'video', uploadId: 'u2', status: 'ready' },
];
const guardada = toStoredMedia(daTela);
const campos = new Set(guardada.flatMap((m) => Object.keys(m)));
confere('toStoredMedia só deixa campos do tipo Media', [...campos].every((c) => ['url', 'type', 'alt', 'data-ai-hint'].includes(c)), [...campos].join(', '));
confere('toStoredMedia não deixa undefined (vídeo sem alt)', !temUndefined(guardada) && !('alt' in guardada[1]));
confere('toStoredMedia mantém url, type, alt e dica', guardada[0].url === 'https://exemplo/b.png' && guardada[0].type === 'image' && guardada[0].alt === 'um gato' && guardada[0]['data-ai-hint'] === 'custom');
confere('toStoredMedia devolve null para lista vazia, null e undefined', toStoredMedia([]) === null && toStoredMedia(null) === null && toStoredMedia(undefined) === null);
confere('toStoredMedia não altera a lista de entrada', daTela[0].uploadId === 'u1' && 'tempId' in daTela[0]);

console.log(`${total - falhas} de ${total} conferências passaram`);
console.log(falhas ? 'RESULTADO: HÁ FALHAS' : 'RESULTADO: PASSOU');
process.exitCode = falhas ? 1 : 0;
