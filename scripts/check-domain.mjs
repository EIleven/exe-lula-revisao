#!/usr/bin/env node
/**
 * Trava de regressão do domínio (uso: `npm run check:domain`).
 *
 * 1. Falha se o domínio antigo (soberan.app) reaparecer em arquivos rastreados pelo Git.
 *    O id de pacote Android "com.soberan.app" NÃO é URL e é ignorado.
 * 2. Confere que o padrão do domínio oficial nas Functions (outro pacote, que não importa de src/)
 *    é idêntico a OFFICIAL_ORIGIN em src/config/site.ts.
 * 3. Falha se algum arquivo de src/ tiver um mailto: com e-mail de exemplo (exemplo.com, example.com...): os contatos
 *    vêm de ContactEmail/siteConfig.contact e só aparecem quando as caixas existem.
 *
 * Fonte única do domínio: src/config/site.ts. Veja docs/dominio.md.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const OLD_DOMAIN = /(?<!com\.)soberan\.app/gi;
const PLACEHOLDER_MAILTO = /mailto:[^"'\s>]*@[^"'\s>]*(?:exemplo|example)\.(?:com|org|net)/i;
// Nome lógico do bucket usado SOMENTE pelo Storage Emulator. A URL continua apontando para EMU.storage (127.0.0.1),
// mas o bucket precisa conservar o sufixo legado appspot.com para coincidir com a configuração dos fixtures.
const LOCAL_EMULATOR_STORAGE = /\$\{EMU\.storage\}\/v0\/b\/demo-soberan\.appspot\.com\//;
const LOCAL_EMULATOR_BUCKET = /demo-soberan\.appspot\.com/;
const LOCAL_EMULATOR_BUCKET_FILES = new Set([
  'e2e/flows/video.mjs',
  'e2e/video-worker-failure-check.mjs',
  'functions/.env.demo-soberan',
]);

// Onde o domínio antigo pode aparecer: documentação e histórico, saída de build do APK antigo e este
// próprio script.
const ALLOWED = [
  /^docs\//,
  /^android\/app\/release\//,
  /^package-lock\.json$/,
  /^functions\/package-lock\.json$/,
  /^scripts\/check-domain\.mjs$/,
];

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\0')
  .filter(Boolean);

const violations = [];
for (const file of tracked) {
  if (ALLOWED.some((pattern) => pattern.test(file))) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // removido do disco mas ainda no índice: nada a verificar
  }
  if (text.includes('\u0000')) continue; // binário
  text.split(/\r?\n/).forEach((line, index) => {
    const bucketLocalPermitido = LOCAL_EMULATOR_BUCKET_FILES.has(file) && LOCAL_EMULATOR_BUCKET.test(line);
    if (OLD_DOMAIN.test(line) && !LOCAL_EMULATOR_STORAGE.test(line) && !bucketLocalPermitido) {
      violations.push(`${file}:${index + 1}: ${line.trim().slice(0, 140)}`);
    }
    OLD_DOMAIN.lastIndex = 0;
    // Contato de exemplo (ex.: soberan-app.exemplo.com) em mailto: o código deve usar ContactEmail/siteConfig.contact.
    if (file.startsWith('src/') && PLACEHOLDER_MAILTO.test(line)) {
      violations.push(`${file}:${index + 1}: e-mail de exemplo em mailto: (use ContactEmail): ${line.trim().slice(0, 120)}`);
    }
  });
}

// 2) O padrão do domínio nas Functions precisa ser igual ao oficial de site.ts.
const site = readFileSync('src/config/site.ts', 'utf8').match(/OFFICIAL_ORIGIN\s*=\s*['"]([^'"]+)['"]/)?.[1];
const fn = readFileSync('functions/src/index.ts', 'utf8').match(/process\.env\.SITE_URL\s*\|\|\s*["']([^"']+)["']/)?.[1];
if (!site || !fn) {
  violations.push('não foi possível ler o domínio oficial em src/config/site.ts e/ou functions/src/index.ts');
} else if (site !== fn) {
  violations.push(`domínio oficial divergente: site.ts="${site}" x functions/src/index.ts="${fn}"`);
}

if (violations.length > 0) {
  console.error(`[check:domain] ${violations.length} problema(s):\n` + violations.map((v) => `  - ${v}`).join('\n'));
  process.exit(1);
}
console.log(`[check:domain] OK: nenhuma referência ao domínio antigo (${tracked.length} arquivos rastreados); oficial = ${site}.`);
