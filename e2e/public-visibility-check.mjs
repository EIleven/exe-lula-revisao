#!/usr/bin/env node
/**
 * A vitrine de quem NÃO tem conta: só português, nunca conteúdo com aviso.
 *   node e2e/public-visibility-check.mjs        (ou: npm run e2e:vitrine)
 * Núcleo: src/lib/feed/publicVisibility.ts (puro) + guardas no caminho de leitura e na página do post.
 * Sai com código 1 se algo falhar.
 */
import { readFileSync } from 'node:fs';
import { filterForVisitor, hasContentWarning, isPortuguese, isPublicSafe, isRemoteItem } from '../src/lib/feed/publicVisibility.ts';
import { detectarPortugues, MIN_PALAVRAS } from '../src/lib/feed/portugueseText.ts';

let falhas = 0;
let total = 0;
const confere = (nome, condicao, motivo) => {
  total++;
  if (condicao) console.log(`OK    ${nome}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo ?? 'condição falsa'}`); }
};

// ───────── idioma ─────────
for (const bom of ['pt', 'PT', 'pt-BR', 'pt-br', 'PT_BR', ' pt-PT ']) {
  confere(`IDIOMA · ${JSON.stringify(bom)} é português`, isPortuguese(bom) === true, 'recusou');
}
for (const ruim of ['en', 'en-US', 'es', 'pts', 'ptbr', '', '  ', null, undefined, 42, {}, ['pt']]) {
  confere(`IDIOMA · ${JSON.stringify(ruim)} não é português`, isPortuguese(ruim) === false, 'aceitou');
}

// ───────── aviso de conteúdo ─────────
confere('AVISO · marca `sensitive` conta', hasContentWarning({ sensitive: true }) === true, '');
confere('AVISO · texto de aviso conta', hasContentWarning({ contentWarning: 'relato de violência' }) === true, '');
confere('AVISO · aviso só com espaços não conta', hasContentWarning({ contentWarning: '   ' }) === false, '');
confere('AVISO · sem nada não conta', hasContentWarning({}) === false && hasContentWarning({ sensitive: false, contentWarning: null }) === false, '');

// ───────── de onde veio ─────────
confere('ORIGEM · id ap_ é remoto', isRemoteItem({ id: 'ap_abc' }) === true, '');
confere('ORIGEM · autor ap_ é remoto (post materializado)', isRemoteItem({ id: 'x', userId: 'ap_abc' }) === true, '');
confere('ORIGEM · a marca explícita vale', isRemoteItem({ id: 'x', isRemoteFediverse: true }) === true, '');
confere('ORIGEM · post nosso não é remoto', isRemoteItem({ id: 'abc123', userId: 'uid1' }) === false, '');

// ───────── a regra da vitrine ─────────
confere('VITRINE · post NOSSO, sem idioma declarado, entra (a rede é em português)', isPublicSafe({ id: 'p1', userId: 'u1' }) === true, '');
confere('VITRINE · post nosso declarado em inglês NÃO entra', isPublicSafe({ id: 'p1', userId: 'u1', language: 'en' }) === false, '');
confere('VITRINE · post remoto em português entra', isPublicSafe({ id: 'ap_1', language: 'pt-BR' }) === true, '');
confere('VITRINE · post remoto em inglês NÃO entra', isPublicSafe({ id: 'ap_1', language: 'en' }) === false, '');
confere('VITRINE · post remoto SEM idioma declarado e SEM texto reconhecível NÃO entra', isPublicSafe({ id: 'ap_1' }) === false && isPublicSafe({ id: 'ap_1', text: 'ok 👍' }) === false, '');
confere('VITRINE · post remoto SEM idioma declarado, mas escrito em português, ENTRA (é o caso comum do Fediverso)',
  isPublicSafe({ id: 'ap_1', text: 'o povo não aguenta mais isso, mas a gente segue de pé aqui' }) === true,
  'o texto em português ficou de fora');
confere('VITRINE · post remoto sem idioma declarado e escrito em inglês NÃO entra',
  isPublicSafe({ id: 'ap_1', text: 'the people just want to have a better life and that is what they will get' }) === false,
  'texto em inglês entrou');
confere('VITRINE · post com aviso NÃO entra, mesmo em português e mesmo sendo nosso', isPublicSafe({ id: 'p1', userId: 'u1', contentWarning: 'spoiler' }) === false && isPublicSafe({ id: 'ap_1', language: 'pt', sensitive: true }) === false, '');
confere('VITRINE · nulo/indefinido nunca entra', isPublicSafe(null) === false && isPublicSafe(undefined) === false, '');

// ───────── a lista ─────────
{
  const lista = [
    { id: 'p1', userId: 'u1' },
    { id: 'p2', userId: 'u1', sensitive: true },
    { id: 'ap_3', language: 'pt-BR' },
    { id: 'ap_4', language: 'en' },
    { id: 'ap_5' },
    { id: 'p6', userId: 'u1', contentWarning: 'gatilho' },
  ];
  const visitante = filterForVisitor(lista, null);
  confere('LISTA · visitante recebe só o que a vitrine mostra', JSON.stringify(visitante.map((x) => x.id)) === JSON.stringify(['p1', 'ap_3']), JSON.stringify(visitante.map((x) => x.id)));
  const logado = filterForVisitor(lista, 'uid-logado');
  confere('LISTA · quem tem conta recebe a lista INTEIRA, e é a mesma lista (sem cópia)', logado === lista && logado.length === 6, String(logado.length));
  confere('LISTA · vazia não quebra', filterForVisitor([], null).length === 0, '');
}


// ───────── detecção própria de português (contagem de palavras, sem modelo e sem rede) ─────────
for (const [texto, esperado] of [
  ['o povo não aguenta mais isso, mas a gente segue de pé', 'pt'],
  ['quando você olha para o que está acontecendo aqui, dá para entender', 'pt'],
  ['the people just want to have a better life and that is what they will get', 'outro'],
  ['die Leute wollen nicht mehr und das ist auch gut so mit allem', 'outro'],
  ['oi', 'indefinido'],
  ['', 'indefinido'],
  [null, 'indefinido'],
  [42, 'indefinido'],
  ['https://exemplo.org/muito/longo/endereco @alguem@outra.org #tag', 'indefinido'],
]) {
  confere(`IDIOMA PRÓPRIO · ${JSON.stringify(String(texto).slice(0, 38))} → ${esperado}`, detectarPortugues(texto) === esperado, detectarPortugues(texto));
}
confere(`IDIOMA PRÓPRIO · texto com menos de ${MIN_PALAVRAS} palavras nunca é afirmado`, detectarPortugues('não é bem assim') === 'indefinido', detectarPortugues('não é bem assim'));
confere('IDIOMA PRÓPRIO · endereço e menção não contam como palavra', detectarPortugues('https://a.org/que/nao/para/com/mais @que@nao.org') === 'indefinido', detectarPortugues('https://a.org/que/nao/para/com/mais @que@nao.org'));

// ───────── guardas no código ─────────
const lerSrc = (c) => readFileSync(new URL(`../src/${c}`, import.meta.url), 'utf8');
const sem = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const leitura = sem(lerSrc('lib/services/postReadService.ts'));
const pagina = sem(lerSrc('app/[locale]/post/[postId]/page.tsx'));
const cliente = sem(lerSrc('app/[locale]/post/[postId]/PostPageClientContent.tsx'));
const inbox = sem(lerSrc('lib/activitypub/inbox.ts'));

confere('FEED · o recorte é aplicado numa saída só, e só para quem não tem conta', /filterForVisitor\(resposta\.posts, activeUserId\)/.test(leitura) && /if \(activeUserId\) return resposta;/.test(leitura), 'o feed não recorta para visitante');
confere('FEED · a busca interna continua existindo (o recorte envolve, não substitui)', /async function buscarPaginaDePosts\(/.test(leitura), 'a busca sumiu');
confere('POST · buscador e prévia de link não recebem post com aviso', /!isPublicSafe\(post\)/.test(pagina) && /robots: \{ index: false, follow: false \}/.test(pagina), 'o conteúdo com aviso vazaria para fora');
confere('POST · visitante abrindo o endereço direto também não vê', /viewerId \? true : isPublicSafe\(fetchedPost\)/.test(cliente), 'o endereço direto furava a vitrine');
confere('IDIOMA · o idioma declarado pela origem é lido na ingestão (contentMap ou language)', /export function extractLanguage\(/.test(inbox) && /contentMap/.test(inbox), 'o idioma do post remoto não é guardado');

console.log(`\n${total - falhas}/${total} verificações passaram.`);
if (falhas > 0) { console.log(`${falhas} FALHA(S).`); process.exit(1); }
