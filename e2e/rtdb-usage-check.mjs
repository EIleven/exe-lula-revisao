#!/usr/bin/env node
/**
 * Guarda: nenhum arquivo do app pode chamar `getDatabase(` direto; o Realtime Database do navegador entra por
 * `src/lib/rtdbClient.ts` (`getRtdb()`), que nunca lança e nunca recebe endereço vazio.
 *   node e2e/rtdb-usage-check.mjs        (ou: npm run e2e:rtdb-uso)
 *
 * Por quê: o App Hosting entrega a configuração do Firebase com `databaseURL: ""`. O SDK só deduz o endereço padrão quando o
 * valor é `undefined`; com texto vazio ele LANÇA, e dentro de um efeito do React isso derruba a página inteira no cliente
 * ("Application error: a client-side exception"). A presença roda em TODA página, então um único `getDatabase()` solto basta.
 *
 * DÍVIDA CONHECIDA (lista abaixo): o canal P2P chama `getDatabase()` em 5 pontos; ele funciona hoje (a configuração do cliente
 * não leva `databaseURL`), e sai da lista quando o canal for portado para o motor novo (docs/auditoria-mensagens-...).
 * A lista só pode ENCOLHER: um arquivo novo com `getDatabase(` falha este teste.
 * Sai com código 1 se algo falhar.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'src');
const PERMITIDOS = new Map([
  ['lib/rtdbClient.ts', 'o ÚNICO ponto que cria a instância do RTDB no navegador'],
  ['lib/firebase-emulators.ts', 'só desenvolvimento: conecta o emulador antes de qualquer uso'],
  ['lib/server/firebaseAdmin.ts', 'servidor (Admin SDK), outro pacote'],
  ['lib/p2p/p2pChannel.ts', 'DÍVIDA: canal P2P; migra com o motor novo'],
  ['lib/p2p/p2pGroupChannel.ts', 'DÍVIDA: canal P2P de grupo'],
]);

function* arquivos(dir) {
  for (const nome of readdirSync(dir)) {
    const caminho = path.join(dir, nome);
    const st = statSync(caminho);
    if (st.isDirectory()) yield* arquivos(caminho);
    else if (/\.(ts|tsx)$/.test(nome)) yield caminho;
  }
}

let falhas = 0;
let total = 0;
const confere = (nome, ok, motivo) => {
  total++;
  if (ok) console.log(`OK    ${nome}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo}`); }
};

const achados = new Map();
for (const arquivo of arquivos(RAIZ)) {
  const rel = path.relative(RAIZ, arquivo).replace(/\\/g, '/');
  const texto = readFileSync(arquivo, 'utf8');
  // só código: ignora comentários de linha e de bloco, onde o nome aparece em explicações
  const semComentarios = texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const n = (semComentarios.match(/\bgetDatabase\s*\(/g) ?? []).length;
  if (n > 0) achados.set(rel, n);
}

for (const [rel, n] of achados) {
  confere(`${rel} (${n} chamada(s)): ${PERMITIDOS.get(rel) ?? '—'}`, PERMITIDOS.has(rel), 'chama getDatabase( direto: use getRtdb() de @/lib/rtdbClient');
}
for (const [rel, motivo] of PERMITIDOS) {
  if (!achados.has(rel)) console.log(`INFO  ${rel} já não chama getDatabase( (${motivo}): pode sair da lista PERMITIDOS`);
}
confere('o ponto único existe e trata erro (nunca lança)', /try\s*{[\s\S]*getDatabase[\s\S]*}\s*catch/.test(readFileSync(path.join(RAIZ, 'lib/rtdbClient.ts'), 'utf8')), 'rtdbClient.ts sem try/catch');

console.log(`\n${total - falhas}/${total} verificações passaram.`);
if (falhas > 0) { console.log(`${falhas} FALHA(S).`); process.exit(1); }
