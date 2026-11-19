#!/usr/bin/env node
/**
 * A cifragem de arquivo grande em pedaços (src/lib/crypto/e2eeMediaChunks.ts):
 *   node e2e/midia-cifrada-check.mjs        (ou: npm run e2e:midia-cifrada)
 *
 * Aqui não há dublê: usa-se o AES-GCM de verdade (WebCrypto do Node 22), e cada ataque é EXECUTADO contra os bytes
 * cifrados para ver se a abertura falha. Um teste que só confere nomes de função não provaria nada do que importa.
 *
 * O que está em jogo, em ordem de gravidade:
 *   1. IV repetido com a mesma chave entrega o XOR dos dois textos claros e destrói a autenticação. É o erro que
 *      transforma "criptografado" em enfeite.
 *   2. Sem a posição selada, quem controla o armazenamento reordena, repete ou CORTA O FIM do vídeo e nada falha —
 *      cada pedaço continua válido sozinho. Num vídeo, cortar o fim é censurar o conteúdo sem deixar rastro.
 *   3. A capa usa a mesma chave do vídeo: se o índice dela colidisse com o de um pedaço, seria o caso 1 por descuido.
 *
 * Sai com código 1 se algo falhar.
 */
import {
  BYTES_DA_ETIQUETA,
  INDICE_DA_CAPA,
  LIMITE_MIDIA_PROTEGIDA,
  TAMANHO_DO_PEDACO,
  aadDoPedaco,
  cifrarPedaco,
  decifrarPedaco,
  faixaCifradaDoPedaco,
  importarChave,
  ivDoPedaco,
  lerDescritorV2,
  novoSegredoDeArquivo,
  planoDePedacos,
  tamanhoCifrado,
} from '../src/lib/crypto/e2eeMediaChunks.ts';

let falhas = 0;
let total = 0;
const confere = (nome, condicao, motivo) => {
  total++;
  if (condicao) console.log(`OK    ${nome}`);
  else {
    falhas++;
    console.log(`FALHA ${nome} — ${motivo}`);
  }
};
/** Roda algo que DEVE falhar. Devolve true quando falhou (que é o resultado desejado). */
const recusa = async (fn) => {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
};
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');

// ───────────────────────── O plano de corte ─────────────────────────
confere('PLANO · arquivo menor que um pedaço vira 1 pedaço', planoDePedacos(10, 100).total === 1, 'errou a conta');
confere('PLANO · tamanho exato não cria pedaço vazio a mais', planoDePedacos(200, 100).total === 2, 'errou a conta');
confere('PLANO · sobra vira mais um pedaço', planoDePedacos(201, 100).total === 3, 'errou a conta');
confere('PLANO · arquivo vazio não tem pedaço', planoDePedacos(0, 100).total === 0, 'inventou pedaço');
confere(
  'PLANO · lixo no tamanho não quebra',
  [NaN, -5, Infinity, null].every((v) => planoDePedacos(v, 100).total === 0),
  'aceitou tamanho inválido',
);
confere(
  'PLANO · o cifrado cresce uma etiqueta por pedaço (e nada além disso)',
  tamanhoCifrado(250, 100) === 250 + 3 * BYTES_DA_ETIQUETA,
  String(tamanhoCifrado(250, 100)),
);
confere(
  'PLANO · as faixas do arquivo cifrado são contíguas (a Etapa 2 vai pedir por Range)',
  faixaCifradaDoPedaco(0, 100).fim + 1 === faixaCifradaDoPedaco(1, 100).inicio,
  'buraco entre os pedaços',
);
confere(
  'PLANO · o pedaço é grande o bastante para não virar milhares de idas à rede',
  TAMANHO_DO_PEDACO >= 1024 * 1024 && LIMITE_MIDIA_PROTEGIDA / TAMANHO_DO_PEDACO <= 64,
  `${LIMITE_MIDIA_PROTEGIDA / TAMANHO_DO_PEDACO} pedaços no arquivo máximo`,
);
confere('PLANO · o teto é 200 MB', LIMITE_MIDIA_PROTEGIDA === 200 * 1024 * 1024, String(LIMITE_MIDIA_PROTEGIDA));

// ───────────────────────── Regra 1: um IV por pedaço, nunca repetido ─────────────────────────
{
  const base = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const vistos = new Set();
  for (let i = 0; i < 5000; i++) vistos.add(hex(ivDoPedaco(base, i)));
  confere('IV · 5000 pedaços, 5000 IVs diferentes', vistos.size === 5000, `${vistos.size} únicos`);
  confere('IV · tem 12 bytes (o tamanho que o AES-GCM espera)', ivDoPedaco(base, 0).length === 12, 'tamanho errado');
  confere(
    'IV · os 8 primeiros bytes são a base do arquivo',
    hex(ivDoPedaco(base, 7)).startsWith('0102030405060708'),
    hex(ivDoPedaco(base, 7)),
  );
  confere(
    'IV · a capa cai fora da faixa de qualquer pedaço de dado',
    hex(ivDoPedaco(base, INDICE_DA_CAPA)) !== hex(ivDoPedaco(base, 0)) &&
      INDICE_DA_CAPA * TAMANHO_DO_PEDACO > LIMITE_MIDIA_PROTEGIDA,
    'a capa poderia colidir com um pedaço de dado',
  );
  confere(
    'IV · base de tamanho errado é RECUSADA (completar com zeros é como se repete IV)',
    (() => { try { ivDoPedaco(new Uint8Array(4), 0); return false; } catch { return true; } })(),
    'aceitou base curta',
  );
  confere(
    'IV · índice fora da faixa é recusado',
    [-1, 1.5, 0x1_0000_0000].every((i) => { try { ivDoPedaco(base, i); return false; } catch { return true; } }),
    'aceitou índice inválido',
  );

  // Dois arquivos nunca compartilham chave nem base.
  const a = novoSegredoDeArquivo();
  const b = novoSegredoDeArquivo();
  confere('IV · cada arquivo sorteia a própria chave', hex(a.chave) !== hex(b.chave), 'chave repetida entre arquivos');
  confere('IV · cada arquivo sorteia a própria base', hex(a.base) !== hex(b.base), 'base repetida entre arquivos');
  confere('IV · a chave tem 256 bits', a.chave.length === 32, `${a.chave.length} bytes`);
}

// ───────────────────────── Ida e volta de verdade ─────────────────────────
const seg = novoSegredoDeArquivo();
const chaveCifrar = await importarChave(seg.chave, ['encrypt']);
const chaveAbrir = await importarChave(seg.chave, ['decrypt']);
const PEDACO = 64;
const claro = new Uint8Array(200);
crypto.getRandomValues(claro);
const { total: nPedacos } = planoDePedacos(claro.length, PEDACO);
const ctx = (i) => ({ fileId: seg.fileId, indice: i, total: nPedacos });

const cifrados = [];
for (let i = 0; i < nPedacos; i++) {
  cifrados.push(new Uint8Array(await cifrarPedaco(chaveCifrar, seg.base, claro.slice(i * PEDACO, (i + 1) * PEDACO), ctx(i))));
}

confere('VOLTA · o arquivo foi cortado em 4 pedaços', nPedacos === 4, String(nPedacos));
confere(
  'VOLTA · cada pedaço cresceu exatamente uma etiqueta',
  cifrados[0].length === PEDACO + BYTES_DA_ETIQUETA && cifrados[3].length === (200 % PEDACO) + BYTES_DA_ETIQUETA,
  `${cifrados[0].length} / ${cifrados[3].length}`,
);
confere(
  'VOLTA · o texto claro NÃO aparece nos bytes cifrados',
  !hex(cifrados[0]).includes(hex(claro.slice(0, 16))),
  'o conteúdo vazou em claro',
);
{
  const remontado = new Uint8Array(claro.length);
  let pos = 0;
  for (let i = 0; i < nPedacos; i++) {
    const aberto = new Uint8Array(await decifrarPedaco(chaveAbrir, seg.base, cifrados[i], ctx(i)));
    remontado.set(aberto, pos);
    pos += aberto.length;
  }
  confere('VOLTA · abre e devolve exatamente o arquivo original', hex(remontado) === hex(claro), 'os bytes mudaram');
}

// ───────────────────────── Regra 2: mexer na ordem, no total ou no conteúdo tem de falhar ─────────────────────────
confere(
  'ATAQUE · trocar DOIS pedaços de lugar falha (sem isso, dá para embaralhar o vídeo)',
  await recusa(() => decifrarPedaco(chaveAbrir, seg.base, cifrados[1], ctx(0))),
  'o pedaço errado abriu no lugar certo',
);
confere(
  'ATAQUE · repetir o mesmo pedaço em outra posição falha',
  await recusa(() => decifrarPedaco(chaveAbrir, seg.base, cifrados[0], ctx(2))),
  'dá para repetir um trecho',
);
confere(
  'ATAQUE · dizer que o arquivo tem menos pedaços falha (cortar o fim do vídeo)',
  await recusa(() => decifrarPedaco(chaveAbrir, seg.base, cifrados[0], { fileId: seg.fileId, indice: 0, total: nPedacos - 1 })),
  'dá para cortar o fim sem deixar rastro',
);
confere(
  'ATAQUE · pedaço de OUTRO arquivo não entra neste',
  await recusa(() => decifrarPedaco(chaveAbrir, seg.base, cifrados[0], { fileId: 'outroarquivo', indice: 0, total: nPedacos })),
  'dá para costurar arquivos diferentes',
);
confere(
  'ATAQUE · virar um bit do conteúdo falha',
  await recusa(() => {
    const adulterado = cifrados[0].slice();
    adulterado[3] ^= 0x01;
    return decifrarPedaco(chaveAbrir, seg.base, adulterado, ctx(0));
  }),
  'aceitou conteúdo adulterado',
);
confere(
  'ATAQUE · virar um bit da etiqueta falha',
  await recusa(() => {
    const adulterado = cifrados[0].slice();
    adulterado[adulterado.length - 1] ^= 0x01;
    return decifrarPedaco(chaveAbrir, seg.base, adulterado, ctx(0));
  }),
  'aceitou etiqueta adulterada',
);
confere(
  'ATAQUE · outra chave não abre',
  await recusa(async () => {
    const outra = await importarChave(novoSegredoDeArquivo().chave, ['decrypt']);
    return decifrarPedaco(outra, seg.base, cifrados[0], ctx(0));
  }),
  'abriu com chave errada',
);
confere(
  'ATAQUE · base de IV diferente não abre',
  await recusa(() => decifrarPedaco(chaveAbrir, novoSegredoDeArquivo().base, cifrados[0], ctx(0))),
  'abriu com IV errado',
);

// ───────────────────────── Regra 3: a capa ─────────────────────────
{
  const capa = new Uint8Array([9, 8, 7, 6, 5]);
  const ctxCapa = { fileId: seg.fileId, indice: INDICE_DA_CAPA, total: nPedacos };
  const capaCifrada = await cifrarPedaco(chaveCifrar, seg.base, capa, ctxCapa);
  const capaAberta = new Uint8Array(await decifrarPedaco(chaveAbrir, seg.base, capaCifrada, ctxCapa));
  confere('CAPA · abre com a mesma chave do vídeo', hex(capaAberta) === hex(capa), 'não abriu');
  confere(
    'CAPA · não pode ser usada no lugar de um pedaço do vídeo',
    await recusa(() => decifrarPedaco(chaveAbrir, seg.base, capaCifrada, ctx(0))),
    'a capa passou por pedaço de dado',
  );
}

// ───────────────────────── O descritor que chega do outro lado ─────────────────────────
const bom = {
  v: 2,
  k: 'A'.repeat(44),
  ivBase: 'AAAAAAAAAAA=',
  fileId: 'abc123xyz',
  mime: 'video/mp4',
  size: 1000,
  chunk: 400,
  count: 3,
};
confere('DESCRITOR · um descritor correto passa', lerDescritorV2(bom) !== null, 'recusou o correto');
confere(
  'DESCRITOR · total que não bate com tamanho/pedaço é recusado (seria cortar o fim pelo descritor)',
  lerDescritorV2({ ...bom, count: 2 }) === null,
  'aceitou total inconsistente',
);
confere(
  'DESCRITOR · tamanho acima do teto é recusado',
  lerDescritorV2({ ...bom, size: LIMITE_MIDIA_PROTEGIDA + 1, chunk: LIMITE_MIDIA_PROTEGIDA + 1, count: 1 }) === null,
  'aceitou arquivo acima do teto',
);
confere(
  'DESCRITOR · versão 1 não entra por aqui',
  lerDescritorV2({ ...bom, v: 1 }) === null,
  'misturou as versões',
);
confere(
  'DESCRITOR · lixo não derruba',
  [null, undefined, 'x', 42, [], {}].every((v) => lerDescritorV2(v) === null),
  'aceitou lixo',
);
confere(
  'DESCRITOR · fileId estranho é recusado (ele entra na selagem de cada pedaço)',
  ['', 'A'.repeat(40), 'com espaço', 'MAIUSCULA'].every((f) => lerDescritorV2({ ...bom, fileId: f }) === null),
  'aceitou fileId fora do formato',
);
confere(
  'DESCRITOR · devolve cópia limpa (campo desconhecido não atravessa)',
  (() => {
    const d = lerDescritorV2({ ...bom, surpresa: 'x', __proto__: { mal: 1 } });
    return d !== null && !('surpresa' in d);
  })(),
  'campo estranho passou',
);
confere(
  'DESCRITOR · a AAD carrega versão, arquivo, posição e total',
  new TextDecoder().decode(aadDoPedaco('arq', 2, 9)) === 'e2ee-v2|arq|2|9',
  new TextDecoder().decode(aadDoPedaco('arq', 2, 9)),
);

console.log('');
console.log(`${total} verificações.`);
if (falhas) {
  console.log(`${falhas} falha(s).`);
  process.exit(1);
}
console.log('Mídia cifrada OK: IV único por pedaço, posição e total selados, e reordenar/cortar/adulterar falha de verdade.');
