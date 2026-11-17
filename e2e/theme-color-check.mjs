#!/usr/bin/env node
/**
 * Cores do perfil: src/lib/utils/themeColor.ts e onde ela é usada (balão do perfil e página do perfil).
 *   node e2e/theme-color-check.mjs        (ou: npm run e2e:cores-perfil)
 *
 * Regras (2026-11-15):
 *  - quem tem uma cor escolhida mostra a SUA cor (balão e página do perfil dela);
 *  - quem NÃO escolheu não recebe estilo nenhum: o balão e a página HERDAM a cor da rede de quem está logado (`--primary` no
 *    :root). Antes o balão injetava o azul padrão e ficava azul até para quem escolheu vermelho;
 *  - os tons saem no formato `H S% L%` (com espaço): com vírgulas, `hsl(var(--primary) / 0.25)` é CSS inválido e o realce some.
 * A parte de código-fonte é uma GUARDA contra o desfazer silencioso (um editor com o arquivo antigo aberto já sobrescreveu
 * correções aqui uma vez).
 * Sai com código 1 se algo falhar.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let themeModule;
try {
  themeModule = await import('../src/lib/utils/themeColor.ts');
} catch {
  const esbuild = await import('esbuild');
  const tsPath = fileURLToPath(new URL('../src/lib/utils/themeColor.ts', import.meta.url));
  const res = await esbuild.build({
    entryPoints: [tsPath],
    bundle: false,
    format: 'esm',
    write: false,
  });
  const dataUri = 'data:text/javascript;base64,' + Buffer.from(res.outputFiles[0].text).toString('base64');
  themeModule = await import(dataUri);
}

const {
  getProfileAccentStyle,
  hexToHslComponents,
  getContrastForegroundHsl,
  isValidHexColor,
  PROFILE_ACCENT_PRESETS,
  applyDocumentAccentColor,
  isHighContrastDocument,
  HIGH_CONTRAST_THEME,
  OFFICIAL_NETWORK_PALETTE,
  getOfficialDynamicColor,
  getEffectiveAccentColor,
} = themeModule;

let falhas = 0;
let total = 0;
const confere = (nome, condicao, motivo) => {
  total++;
  if (condicao) console.log(`OK    ${nome}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo ?? 'condição falsa'}`); }
};

const VARS = ['--primary', '--primary-foreground', '--accent', '--accent-foreground', '--ring', '--sidebar-primary', '--sidebar-primary-foreground', '--sidebar-accent', '--sidebar-accent-foreground', '--sidebar-ring'];
const FORMATO = /^\d{1,3} \d{1,3}% \d{1,3}%$/;

for (const [hex, ok] of [['#dc2626', true], ['#DC2626', true], ['#2563eb', true], ['dc2626', false], ['#fff', false], ['#12345g', false], ['', false], [null, false], [undefined, false], ['#dc26261', false]]) {
  confere(`HEX · ${JSON.stringify(hex)} → ${ok}`, isValidHexColor(hex) === ok, String(isValidHexColor(hex)));
}
confere('HSL · vermelho #dc2626 → "0 72% 51%"', hexToHslComponents('#dc2626') === '0 72% 51%', hexToHslComponents('#dc2626'));
confere('HSL · azul #2563eb → "221 83% 53%"', hexToHslComponents('#2563eb') === '221 83% 53%', hexToHslComponents('#2563eb'));
confere('HSL · hex inválido → null', hexToHslComponents('vermelho') === null, String(hexToHslComponents('vermelho')));
confere('CONTRASTE · vermelho e azul usam texto claro, amarelo usa texto escuro', getContrastForegroundHsl('#dc2626') === '0 0% 98%' && getContrastForegroundHsl('#2563eb') === '0 0% 98%' && getContrastForegroundHsl('#fde047') === '0 0% 9%', `${getContrastForegroundHsl('#dc2626')} ${getContrastForegroundHsl('#fde047')}`);

// A ESCOLHA da pessoa
for (const preset of PROFILE_ACCENT_PRESETS) {
  const s = getProfileAccentStyle(preset.hex);
  confere(`ESCOLHA · ${preset.name} (${preset.hex}): as 10 variáveis, no formato "H S% L%"`, VARS.every((v) => typeof s?.[v] === 'string' && FORMATO.test(s[v])), JSON.stringify(s));
}
const vermelho = getProfileAccentStyle('#dc2626');
confere('ESCOLHA · vermelho: --primary é o vermelho dela (não o azul padrão)', vermelho['--primary'] === '0 72% 51%', vermelho['--primary']);

// SEM escolha: nenhum estilo (herda a cor de quem está logado)
for (const semCor of [undefined, null, '', 'azul', '#abc', 'rgb(1,2,3)']) {
  confere(`SEM ESCOLHA · ${JSON.stringify(semCor)} → nenhum estilo (herda a cor da rede)`, getProfileAccentStyle(semCor) === undefined, JSON.stringify(getProfileAccentStyle(semCor)));
}
const padrao = getProfileAccentStyle(undefined, { fallbackToDefault: true });
confere('PADRÃO · quem PEDE o padrão recebe o tom no formato certo (sem vírgulas, que quebrariam bg-primary/25)', VARS.every((v) => typeof padrao?.[v] === 'string' && !padrao[v].includes(',')), JSON.stringify(padrao));
confere('PADRÃO · e uma cor VÁLIDA nunca é trocada pelo padrão', getProfileAccentStyle('#dc2626', { fallbackToDefault: true })['--primary'] === '0 72% 51%', 'trocou');

// ───────── guardas no código-fonte ─────────
const lerSrc = (caminho) => readFileSync(new URL(`../src/${caminho}`, import.meta.url), 'utf8');
const balao = lerSrc('components/profile/UserProfileHoverCard.tsx');
const pagina = lerSrc('app/[locale]/profile/[userId]/ProfileClientPageContent.tsx');
const codigo = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
confere('BALÃO · usa a cor de quem está no balão e NÃO pede o padrão (o balão herdava azul)', /getProfileAccentStyle\(\s*liveUser\.accentColor\s*(?:,\s*\{[^}]*\})?\s*\)/.test(codigo(balao)) && !/fallbackToDefault/.test(codigo(balao)), 'voltou fallbackToDefault no balão');
confere('PÁGINA DO PERFIL · aplica a cor do DONO do perfil na raiz', /getProfileAccentStyle\(\s*profileUser\.accentColor\s*(?:,\s*\{[^}]*\})?\s*\)/.test(codigo(pagina)), 'a página do perfil não aplica a cor de quem é dono dela');
confere('PÁGINA DO PERFIL · sem mudar o layout (display: contents)', /display:\s*'contents'/.test(codigo(pagina)), 'a raiz entrou no layout');
confere('PÁGINA DO PERFIL · importa o utilitário', /import\s*\{\s*getProfileAccentStyle(?:\s*,\s*HIGH_CONTRAST_THEME)?\s*\}\s*from\s*'@\/lib\/utils\/themeColor'/.test(pagina), 'sem import');

// ───────── as cores-base da rede em src/app/globals.css (2026-11-15) ─────────
// Com VÍRGULAS (`228, 90%, 55%`) o Tailwind gera `hsl(var(--primary) / .25)` inválido: ~70 usos de `bg-primary/10`, `border-primary/50`,
// `hover:bg-primary/90`... sumiam para quem não escolheu cor (quem escolhe usa `applyDocumentAccentColor`, que já grava com espaços), e
// os gráficos do painel (`hsl(var(--chart-1) / 0.3)`) ficavam sem preenchimento. Tudo no MESMO formato `H S% L%` faz a cor da pessoa
// (ou o azul da rede, se ela não escolheu) valer igual em todo o app. O azul de identidade da rede e o amarelo do alto contraste NÃO mudam.
const css = lerSrc('app/globals.css').replace(/\r/g, '');
const declaracoes = [...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)].map((m) => ({ nome: m[1], valor: m[2].trim() }));
const TRIPLA = /^\d+(?:\.\d+)?[ ,]+\d+(?:\.\d+)?%[ ,]+\d+(?:\.\d+)?%$/;
const triplas = declaracoes.filter((d) => TRIPLA.test(d.valor));
confere('GLOBALS · há tons HSL declarados (a guarda enxerga o arquivo)', triplas.length >= 20, `${triplas.length} tons`);
const comVirgula = triplas.filter((d) => d.valor.includes(','));
confere('GLOBALS · nenhum tom HSL com vírgula (quebra `bg-primary/NN`, `border-primary/NN`, `hsl(var(--x) / a)`)', comVirgula.length === 0, comVirgula.slice(0, 4).map((d) => `${d.nome}: ${d.valor}`).join(' | '));
const corpo = (seletor) => (css.match(new RegExp(`${seletor}\\s*\\{([^}]*)\\}`)) ?? [])[1] ?? '';
const valorEm = (bloco, nome) => (bloco.match(new RegExp(`(?:^|\\s)${nome}\\s*:\\s*([^;]+);`)) ?? [])[1]?.trim();
const blocoRaiz = corpo(':root');
const blocoEscuro = corpo('\\.dark');
const blocoAltoContraste = corpo('\\.high-contrast');
for (const nome of ['--primary', '--ring', '--sidebar-primary', '--sidebar-ring']) {
  confere(`IDENTIDADE · ${nome} da rede continua o azul 228 90% 55% (padrão e escuro)`, valorEm(blocoRaiz, nome) === '228 90% 55%' && valorEm(blocoEscuro, nome) === '228 90% 55%', `${valorEm(blocoRaiz, nome)} / ${valorEm(blocoEscuro, nome)}`);
}
confere('IDENTIDADE · o alto contraste continua amarelo (60 100% 50%): acessibilidade não é cor de gosto', valorEm(blocoAltoContraste, '--primary') === '60 100% 50%' && valorEm(blocoAltoContraste, '--ring') === '60 100% 50%', `${valorEm(blocoAltoContraste, '--primary')} / ${valorEm(blocoAltoContraste, '--ring')}`);
confere('IDENTIDADE · o escuro mantém o accent neutro (4 0% 16%): a cor da pessoa só entra por ela escolher', valorEm(blocoEscuro, '--accent') === '4 0% 16%', String(valorEm(blocoEscuro, '--accent')));
// Quem escolhe a cor continua mandando em TODOS os tons de destaque, e o código que aplica usa o mesmo formato.
const estiloPessoa = getProfileAccentStyle('#dc2626');
confere('LIBERDADE · a cor escolhida cobre os mesmos 10 tons de destaque que o globals.css define', VARS.every((v) => estiloPessoa?.[v] !== undefined), VARS.filter((v) => estiloPessoa?.[v] === undefined).join(', '));
confere('LIBERDADE · o formato da escolha é o MESMO do globals.css (H S% L%, com espaço)', FORMATO.test(estiloPessoa['--primary']) && TRIPLA.test(valorEm(blocoRaiz, '--primary')) && !valorEm(blocoRaiz, '--primary').includes(','), `${estiloPessoa['--primary']} vs ${valorEm(blocoRaiz, '--primary')}`);

// ───────── ALTO CONTRASTE manda sobre a cor de destaque (2026-11-15: "o que prevalece é o contraste de acessibilidade") ─────────
// Quem liga o alto contraste pediu legibilidade: nem a cor escolhida por quem está logado, nem a do dono do perfil podem sobrepor o
// amarelo do tema (o estilo inline do <html> venceria a classe .high-contrast do globals.css).
confere('ALTO CONTRASTE · o tema se chama high-contrast (o do next-themes e o do globals.css)', HIGH_CONTRAST_THEME === 'high-contrast' && /\.high-contrast\s*\{/.test(css), HIGH_CONTRAST_THEME);
confere('ALTO CONTRASTE · ligado, a cor escolhida NÃO é aplicada (nem a de quem está logado, nem a do dono do perfil)', getProfileAccentStyle('#dc2626', { highContrast: true }) === undefined, JSON.stringify(getProfileAccentStyle('#dc2626', { highContrast: true })));
confere('ALTO CONTRASTE · nem pelo caminho do padrão (fallbackToDefault)', getProfileAccentStyle(undefined, { fallbackToDefault: true, highContrast: true }) === undefined && getProfileAccentStyle('#dc2626', { fallbackToDefault: true, highContrast: true }) === undefined, '');
confere('ALTO CONTRASTE · desligado (false ou ausente), a cor da pessoa volta a valer', getProfileAccentStyle('#dc2626', { highContrast: false })?.['--primary'] === '0 72% 51%' && getProfileAccentStyle('#dc2626', {})?.['--primary'] === '0 72% 51%', '');
// applyDocumentAccentColor com um <html> de mentira
const html = { vars: {}, classes: new Set() };
html.style = { setProperty: (k, v) => { html.vars[k] = v; }, removeProperty: (k) => { delete html.vars[k]; } };
html.classList = { contains: (c) => html.classes.has(c) };
globalThis.document = { documentElement: html };
applyDocumentAccentColor('#dc2626');
confere('APLICAR · sem alto contraste grava os 10 tons no <html>', VARS.every((v) => typeof html.vars[v] === 'string'), JSON.stringify(Object.keys(html.vars)));
applyDocumentAccentColor('#dc2626', { highContrast: true });
confere('APLICAR · com alto contraste TIRA os 10 tons do <html> (senão o estilo inline venceria a classe do tema)', Object.keys(html.vars).length === 0, JSON.stringify(Object.keys(html.vars)));
applyDocumentAccentColor('#dc2626', { highContrast: false });
confere('APLICAR · ao desligar o alto contraste a cor da pessoa volta', VARS.every((v) => typeof html.vars[v] === 'string'), '');
applyDocumentAccentColor(null);
confere('APLICAR · sem cor escolhida limpa tudo (como antes)', Object.keys(html.vars).length === 0, '');
confere('LER · isHighContrastDocument lê a classe do <html>', isHighContrastDocument() === false && (html.classes.add('high-contrast'), isHighContrastDocument()) === true && (html.classes.delete('high-contrast'), isHighContrastDocument()) === false, '');
delete globalThis.document;
confere('LER · sem document (servidor) não quebra e não é alto contraste', isHighContrastDocument() === false, '');
const layoutCodigo = codigo(lerSrc('components/layout/AppLayout.tsx'));
confere('COR DA REDE · o layout gerencia a cor dinâmica e reage ao alto contraste', /useDynamicOfficialColor\(\s*\{\s*userAccentColor:\s*currentUser\?\.accentColor,\s*isHighContrast:\s*theme\s*===\s*HIGH_CONTRAST_THEME,?\s*\}\s*\)/.test(layoutCodigo), 'o layout não aplicou useDynamicOfficialColor com alto contraste');

// ───────── PALETA OFICIAL DINÂMICA DO HIPERVERSO (2026-11-16: 5 em 5 min) ─────────
confere('PALETA · possui exatamente 12 cores equilibradas', OFFICIAL_NETWORK_PALETTE.length === 12, `${OFFICIAL_NETWORK_PALETTE.length}`);
for (const cor of OFFICIAL_NETWORK_PALETTE) {
  confere(`PALETA · ${cor.name} (${cor.hex}) é hex válido`, isValidHexColor(cor.hex), cor.hex);
  confere(`PALETA · ${cor.name} tem contraste claro para botões`, getContrastForegroundHsl(cor.hex) === '0 0% 98%', cor.hex);
}
const agora = Date.now();
const corAtual = getOfficialDynamicColor(agora);
const proximaCor = getOfficialDynamicColor(agora + 5 * 60 * 1000);
confere('ROTAÇÃO · bloco seguinte de 5 min salta para outro matiz', corAtual.hex !== proximaCor.hex, `${corAtual.name} vs ${proximaCor.name}`);
confere('ROTAÇÃO · usuário logado com cor própria preserva sua escolha', getEffectiveAccentColor('#ca8a04', agora) === '#ca8a04', '');
confere('ROTAÇÃO · visitante sem cor recebe a cor oficial dinâmica', getEffectiveAccentColor(undefined, agora) === corAtual.hex, '');
confere('ALTO CONTRASTE · a página do perfil não pinta o conteúdo com a cor do dono', /getProfileAccentStyle\(\s*profileUser\.accentColor,\s*\{\s*highContrast:\s*theme\s*===\s*HIGH_CONTRAST_THEME\s*\}\s*\)/.test(codigo(pagina)), 'a cor do dono do perfil venceria o alto contraste');
confere('ALTO CONTRASTE · o balão também respeita (lê a classe do <html>, sem assinar o tema em cada cartão)', /getProfileAccentStyle\(\s*liveUser\.accentColor,\s*\{\s*highContrast:\s*isHighContrastDocument\(\)\s*\}\s*\)/.test(codigo(balao)), 'o balão venceria o alto contraste');

console.log(`\n${total - falhas}/${total} verificações passaram.`);
if (falhas > 0) { console.log(`${falhas} FALHA(S).`); process.exit(1); }
