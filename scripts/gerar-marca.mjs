// scripts/gerar-marca.mjs
// Gera TODOS os ativos de marca do Exe. Lula a partir de um único desenho (a lula vermelha):
//   public/brand/*.svg, favicon (.ico e .png), apple-touch-icon, ícones do PWA (/icons), imagem de compartilhamento (OG),
//   ícones do app Android (quadrado/redondo antigos e o adaptativo em camadas: fundo, lula e versão monocromática para os
//   ícones temáticos) e o ícone da tela de abertura (android/app/src/main/res). Confere a zona segura de cada ícone.
//
// Uso:  npm run marca:gerar        (depois, para o Android:  npx cap sync android)
// Precisa do Chrome e do playwright-core (os mesmos dos testes E2E):
//   E2E_NODE_MODULES=<pasta com node_modules/playwright-core>   E2E_BROWSER=<caminho do chrome.exe>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BROWSER = process.env.E2E_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BG = '#0B0F14'; // fundo escuro da marca (também o background_color do PWA)
const OUT = '#3B050B'; // contorno da lula

// ---------------------------------------------------------------------------------------------------------------------
// Desenho: tentáculos são polígonos afunilados calculados a partir de curvas de Bézier.
// ---------------------------------------------------------------------------------------------------------------------
const mirror = (p) => [512 - p[0], p[1]];
const f = (n) => n.toFixed(1);
const bez = (P, t) => {
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * P[0][k] + 3 * u * u * t * P[1][k] + 3 * u * t * t * P[2][k] + t * t * t * P[3][k]);
};
const bezD = (P, t) => {
  const u = 1 - t;
  return [0, 1].map((k) => 3 * u * u * (P[1][k] - P[0][k]) + 6 * u * t * (P[2][k] - P[1][k]) + 3 * t * t * (P[3][k] - P[2][k]));
};
function taper(P, wf, N = 40) {
  const L = [];
  const R = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const c = bez(P, t);
    const d = bezD(P, t);
    const len = Math.hypot(d[0], d[1]) || 1;
    const n = [-d[1] / len, d[0] / len];
    const w = wf(t) / 2;
    L.push([c[0] + n[0] * w, c[1] + n[1] * w]);
    R.push([c[0] - n[0] * w, c[1] - n[1] * w]);
  }
  return `M${[...L, ...R.reverse()].map((p) => `${f(p[0])} ${f(p[1])}`).join(' L')} Z`;
}
const lin = (a, b) => (t) => a + (b - a) * t;
const club = (base, mid, tip, clubW) => (t) =>
  t < 0.6 ? base + (mid - base) * (t / 0.6) : t < 0.88 ? mid + (clubW - mid) * ((t - 0.6) / 0.28) : clubW + (tip - clubW) * ((t - 0.88) / 0.12);

const ARMS = [
  { c: [[330, 342], [362, 372], [404, 382], [440, 408]], w: lin(26, 3), fill: '#8F0F1A' },
  { c: [[314, 350], [330, 392], [364, 414], [410, 432]], w: lin(26, 3), fill: '#B5121F' },
  { c: [[294, 352], [300, 398], [322, 432], [356, 456]], w: lin(26, 3), fill: '#D01C2B' },
  { c: [[274, 352], [276, 412], [292, 452], [280, 498]], w: club(22, 9, 3, 25), fill: '#EA2B3C' }, // tentáculo longo, com clava
];

/**
 * @param {{ formato?: 'livre'|'arredondado'|'cheio'|'redondo', adesivo?: boolean, tamanho?: number }} opcoes
 *   livre = só a lula (fundo transparente); arredondado = ícone de app; cheio = quadrado inteiro; redondo = círculo.
 *   adesivo = borda clara em volta da silhueta (a lula "salta" em fundos escuros e em tamanhos pequenos).
 *   tamanho = escala da lula no quadro (padrão .95 livre e .8 com fundo); cada ícone usa a sua para caber na zona
 *   segura da máscara em que será recortado (conferida no fim, pelo raio máximo da lula a partir do centro).
 */
function lulaSvg({ formato = 'livre', adesivo = false, tamanho } = {}) {
  const arms = ARMS.flatMap((a) => [
    `<path fill="${a.fill}" d="${taper(a.c, a.w)}"/>`,
    `<path fill="${a.fill}" d="${taper(a.c.map(mirror), a.w)}"/>`,
  ]).join('\n    ');
  const raio = { arredondado: 112, cheio: 0, redondo: 256 }[formato];
  const fundo =
    formato === 'livre'
      ? ''
      : `<defs><radialGradient id="glow" cx="256" cy="250" r="300" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#7A0A14" stop-opacity=".75"/><stop offset="1" stop-color="${BG}" stop-opacity="0"/></radialGradient></defs>
  <rect width="512" height="512" rx="${raio}" fill="${BG}"/><rect width="512" height="512" rx="${raio}" fill="url(#glow)"/>`;
  const s = String(tamanho ?? (formato === 'livre' ? 0.95 : 0.8)).replace(/^0\./, '.'); // ".95", como nos SVGs publicados
  const escala = `translate(256 256) scale(${s}) translate(-256 -${formato === 'livre' ? 262 : 258})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="gM" gradientUnits="userSpaceOnUse" x1="256" y1="0" x2="344" y2="0" spreadMethod="reflect">
      <stop offset="0" stop-color="#FF5460"/><stop offset=".5" stop-color="#E3202F"/><stop offset="1" stop-color="#9C0D19"/>
    </linearGradient>
    <linearGradient id="gFR" gradientUnits="userSpaceOnUse" x1="296" y1="80" x2="440" y2="200"><stop offset="0" stop-color="#D01824"/><stop offset="1" stop-color="#6E0710"/></linearGradient>
    <linearGradient id="gFL" gradientUnits="userSpaceOnUse" x1="216" y1="80" x2="72" y2="200"><stop offset="0" stop-color="#D01824"/><stop offset="1" stop-color="#6E0710"/></linearGradient>
    <radialGradient id="gEye" cx=".5" cy=".62" r=".65"><stop offset="0" stop-color="#FFF3B0"/><stop offset=".55" stop-color="#FFC93C"/><stop offset="1" stop-color="#F08A14"/></radialGradient>
    <filter id="adesivo" x="-8%" y="-8%" width="116%" height="116%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="7" result="b"/>
      <feComponentTransfer in="b" result="t"><feFuncA type="linear" slope="12" intercept="-1"/></feComponentTransfer>
      <feFlood flood-color="#FFEDE6" result="c"/><feComposite in="c" in2="t" operator="in" result="o"/>
      <feMerge><feMergeNode in="o"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <clipPath id="eyeR"><ellipse cx="310" cy="332" rx="28" ry="25"/></clipPath>
    <clipPath id="eyeL"><ellipse cx="202" cy="332" rx="28" ry="25"/></clipPath>
  </defs>
  ${fundo}
  <g transform="${escala}"${adesivo ? ' filter="url(#adesivo)"' : ''}>
  <g stroke="${OUT}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">
    ${arms}
    <path fill="url(#gFR)" d="M298 74 Q394 100 440 198 Q382 174 338 222 Z"/>
    <path fill="url(#gFL)" d="M214 74 Q118 100 72 198 Q130 174 174 222 Z"/>
    <path fill="url(#gM)" d="M256 26 C292 60 332 130 338 206 C342 254 324 292 302 314 L210 314 C188 292 170 254 174 206 C180 130 220 60 256 26 Z"/>
    <path fill="#D01C2B" d="M198 302 H314 C340 306 352 334 338 356 C328 368 308 366 298 360 H214 C204 366 184 368 174 356 C160 334 172 306 198 302 Z"/>
  </g>
  <path d="M238 60 C226 110 222 190 230 262" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="9" stroke-linecap="round"/>
  <g fill="none" stroke="#6E0710" stroke-width="10" stroke-linejoin="miter" stroke-linecap="round" opacity=".92">
    <path d="M214 116 L256 142 L298 116"/><path d="M206 164 L256 194 L306 164"/><path d="M205 212 L256 244 L307 212"/>
  </g>
  <g stroke-linecap="round">
    <ellipse cx="310" cy="332" rx="28" ry="25" fill="url(#gEye)" stroke="${OUT}" stroke-width="6"/>
    <ellipse cx="202" cy="332" rx="28" ry="25" fill="url(#gEye)" stroke="${OUT}" stroke-width="6"/>
    <rect x="291" y="336" width="40" height="14" rx="7" fill="#12070A"/><rect x="181" y="336" width="40" height="14" rx="7" fill="#12070A"/>
    <circle cx="300" cy="341" r="2.6" fill="#fff"/><circle cx="192" cy="341" r="2.6" fill="#fff"/>
    <g clip-path="url(#eyeR)"><polygon points="276,340 346,314 346,270 276,270" fill="#8F0F1A"/></g>
    <g clip-path="url(#eyeL)"><polygon points="236,340 166,314 166,270 236,270" fill="#8F0F1A"/></g>
    <path d="M272 342 L350 312" stroke="${OUT}" stroke-width="8"/><path d="M240 342 L162 312" stroke="${OUT}" stroke-width="8"/>
  </g>
  </g>
</svg>
`;
}

/**
 * Versão monocromática (ícones temáticos do Android 13+): só a silhueta, em branco, que o sistema pinta com a cor do
 * tema. Os detalhes viram recortes: as listras do manto e os olhos "bravos" (a pálpebra cobre a parte de cima).
 */
function lulaMonoSvg({ tamanho = 0.95 } = {}) {
  const arms = ARMS.flatMap((a) => [taper(a.c, a.w), taper(a.c.map(mirror), a.w)]).map((d) => `<path d="${d}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <clipPath id="eyeR"><ellipse cx="310" cy="332" rx="28" ry="25"/></clipPath>
    <clipPath id="eyeL"><ellipse cx="202" cy="332" rx="28" ry="25"/></clipPath>
    <mask id="m" maskUnits="userSpaceOnUse" x="-512" y="-512" width="1536" height="1536">
      <g fill="#fff" stroke="#fff" stroke-width="7" stroke-linejoin="round">${arms}
        <path d="M298 74 Q394 100 440 198 Q382 174 338 222 Z"/><path d="M214 74 Q118 100 72 198 Q130 174 174 222 Z"/>
        <path d="M256 26 C292 60 332 130 338 206 C342 254 324 292 302 314 L210 314 C188 292 170 254 174 206 C180 130 220 60 256 26 Z"/>
        <path d="M198 302 H314 C340 306 352 334 338 356 C328 368 308 366 298 360 H214 C204 366 184 368 174 356 C160 334 172 306 198 302 Z"/>
      </g>
      <g fill="none" stroke="#000" stroke-width="12" stroke-linecap="round">
        <path d="M214 116 L256 142 L298 116"/><path d="M206 164 L256 194 L306 164"/><path d="M205 212 L256 244 L307 212"/>
      </g>
      <ellipse cx="310" cy="332" rx="26" ry="23" fill="#000"/><ellipse cx="202" cy="332" rx="26" ry="23" fill="#000"/>
      <g clip-path="url(#eyeR)"><polygon points="276,342 346,316 346,270 276,270" fill="#fff"/></g>
      <g clip-path="url(#eyeL)"><polygon points="236,342 166,316 166,270 236,270" fill="#fff"/></g>
    </mask>
  </defs>
  <g transform="translate(256 256) scale(${tamanho}) translate(-256 -262)">
    <rect x="-512" y="-512" width="1536" height="1536" fill="#fff" mask="url(#m)"/>
  </g>
</svg>
`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Renderização (Chrome headless) e gravação
// ---------------------------------------------------------------------------------------------------------------------
async function loadPlaywright() {
  const file = process.env.E2E_NODE_MODULES && path.join(process.env.E2E_NODE_MODULES, 'playwright-core', 'index.mjs');
  if (file && fs.existsSync(file)) return import(pathToFileURL(file).href);
  return import('playwright-core');
}
const write = (rel, data) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log(`  ${rel} (${Buffer.byteLength(data)} bytes)`);
};
const sized = (svg, w, h = w) => svg.replace('<svg ', `<svg width="${w}" height="${h}" `);

function ico(images) {
  // Contêiner ICO com PNGs dentro: cabeçalho + diretório + dados.
  const head = Buffer.alloc(6 + images.length * 16);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, png }, i) => {
    const o = 6 + i * 16;
    head.writeUInt8(size >= 256 ? 0 : size, o);
    head.writeUInt8(size >= 256 ? 0 : size, o + 1);
    head.writeUInt16LE(1, o + 4);
    head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(png.length, o + 8);
    head.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map((i) => i.png)]);
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ executablePath: BROWSER });
const page = await browser.newPage();
async function shot(html, w, h = w) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;background:transparent;overflow:hidden">${html}</body></html>`);
  return page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
}
const png = (svg, size) => shot(sized(svg, size), size);

// Coloca um SVG no centro de um quadro transparente de `lado` px, ocupando a fração `fracao` do lado.
const centro = (svg, lado, fracao) =>
  shot(`<div style="width:${lado}px;height:${lado}px;display:flex;align-items:center;justify-content:center">${sized(svg, Math.round(lado * fracao))}</div>`, lado);

// Raio máximo da lula a partir do centro, em fração do lado: pixels opacos ou, num ícone de fundo opaco, o que é vermelho
// vivo ou a borda clara (o brilho do fundo é vermelho escuro). É o que precisa caber na zona segura de cada máscara; o
// gerador se recusa a gravar um ícone que passe dela (o 1.2.0 tinha a lula encostando na borda do círculo).
async function raio(pngBuffer, { fundoOpaco = false } = {}) {
  return page.evaluate(async ({ b64, fundoOpaco }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const size = img.naturalWidth;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, size, size);
    const c = (size - 1) / 2;
    let max = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const on = fundoOpaco ? data[i] > 140 || (data[i] > 200 && data[i + 1] > 200) : data[i + 3] > 16;
        if (on) max = Math.max(max, Math.hypot(x - c, y - c));
      }
    }
    return max / size;
  }, { b64: pngBuffer.toString('base64'), fundoOpaco });
}
async function dentroDaZona(nome, pngBuffer, limite, opcoes) {
  const r = await raio(pngBuffer, opcoes);
  if (r > limite) throw new Error(`${nome}: a lula vai até ${r.toFixed(3)} do lado, além da zona segura (${limite}).`);
  console.log(`  zona segura: ${nome} vai até ${r.toFixed(3)} do lado (limite ${limite})`);
  return pngBuffer;
}

const livre = lulaSvg(); // grande (OG, tela de abertura): sem borda
const logo = lulaSvg({ adesivo: true }); // pequena (cabeçalho, favicon, camada do ícone adaptativo): com borda clara
// Ícones: a lula menor que o quadro, para sobrar margem dentro da máscara que cada sistema aplica.
const app = lulaSvg({ formato: 'arredondado', adesivo: true, tamanho: 0.74 }); // quadrado arredondado (PWA, Android antigo)
const cheio = lulaSvg({ formato: 'cheio', adesivo: true, tamanho: 0.74 }); // apple-touch-icon (o iOS arredonda os cantos)
const mascaravel = lulaSvg({ formato: 'cheio', adesivo: true, tamanho: 0.68 }); // PWA maskable: zona segura = círculo de 80%
const redondo = lulaSvg({ formato: 'redondo', adesivo: true, tamanho: 0.7 });
const mono = lulaMonoSvg();

// Ícone pequeno das notificações (barra de status do Android): o Android pinta só o canal alfa, então é a silhueta
// branca da lula (a mesma dos ícones temáticos) num quadro de 24dp. A cor de destaque aparece no círculo do aviso.
// `MARCA_SO=notificacao npm run marca:gerar` gera SÓ este ícone, sem reescrever os demais ativos da marca.
async function gerarIconeDeNotificacao() {
  const res = 'android/app/src/main/res';
  console.log('Android (ícone das notificações):');
  for (const [d, k] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
    write(`${res}/drawable-${d}/ic_stat_notify.png`, await png(lulaMonoSvg({ tamanho: 0.9 }), 24 * k));
  }
  write(`${res}/values/notificacao.xml`, `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Cor de destaque dos avisos (o mesmo valor que o servidor manda em functions/src/push.ts). -->
    <color name="notificacao_cor">#D61F26</color>
</resources>
`);
}
if (process.env.MARCA_SO === 'notificacao') {
  await gerarIconeDeNotificacao();
  await browser.close();
  process.exit(0);
}

console.log('Site e PWA:');
write('public/brand/lula.svg', livre);
write('public/brand/lula-logo.svg', logo);
write('public/brand/lula-app.svg', app);
// PNG com fundo transparente: usado na imagem de compartilhamento do post (o gerador de imagem do servidor não
// desenha SVG), onde a lula precisa aparecer sobre o fundo da marca, sem quadrado atrás.
write('public/brand/lula.png', await png(logo, 512));
write('public/favicon-16x16.png', await png(logo, 16));
write('public/favicon-32x32.png', await png(logo, 32));
write('public/apple-touch-icon.png', await dentroDaZona('apple-touch-icon', await png(cheio, 180), 0.37, { fundoOpaco: true }));
write('public/icons/icon-192.png', await png(app, 192));
write('public/icons/icon-512.png', await dentroDaZona('PWA icon-512', await png(app, 512), 0.37, { fundoOpaco: true }));
write('public/icons/maskable-512.png', await dentroDaZona('PWA maskable-512 (círculo de 80%)', await png(mascaravel, 512), 0.36, { fundoOpaco: true }));
write('src/app/favicon.ico', ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, png: await png(logo, size) })))));

console.log('Imagem de compartilhamento (OG):');
const og = `<div style="width:1200px;height:630px;position:relative;font-family:'Segoe UI','Arial',sans-serif;
  background:radial-gradient(900px 700px at 22% 55%,#5a0912 0%,#1a0a10 45%,${BG} 100%);color:#fff;display:flex;align-items:center">
  <div style="margin-left:70px;width:470px;height:520px;display:flex;align-items:center;justify-content:center">${sized(livre, 520)}</div>
  <div style="margin-left:30px">
    <div style="font:900 132px/1 Impact,'Arial Black',sans-serif;letter-spacing:2px;text-transform:uppercase;text-shadow:0 6px 0 #3B050B">Exe. <span style="color:#FF3B4A">Lula</span></div>
    <div style="margin-top:26px;font-size:36px;color:#d6dbe3;max-width:560px;line-height:1.3">Conectando vozes com soberania digital.</div>
    <div style="margin-top:34px;font-size:32px;font-weight:700;color:#FF5A66;letter-spacing:1px">exercitodolula.app</div>
  </div></div>`;
write('public/exe-lula-og.png', await shot(og, 1200, 630));

console.log('Android (ícones e tela de abertura):');
const res = 'android/app/src/main/res';
const densidades = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
// Fundo do ícone adaptativo (camada de 108dp): o mesmo brilho vermelho do ícone quadrado, no centro dos 72dp visíveis.
const fundoAdaptativo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108"><defs><radialGradient id="g" cx="54" cy="53" r="41" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#7A0A14" stop-opacity=".75"/><stop offset="1" stop-color="${BG}" stop-opacity="0"/></radialGradient></defs><rect width="108" height="108" fill="${BG}"/><rect width="108" height="108" fill="url(#g)"/></svg>`;
// Ícone da tela de abertura (288dp): o Android 12+ mostra só o círculo de 192dp do centro (raio 1/3 do lado).
const iconeAbertura = (lado) =>
  shot(`<div style="width:${lado}px;height:${lado}px;position:relative">
  <svg style="position:absolute;inset:0" width="${lado}" height="${lado}" viewBox="0 0 288 288"><defs><radialGradient id="a" cx="144" cy="144" r="92" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#7A0A14" stop-opacity=".6"/><stop offset="1" stop-color="#7A0A14" stop-opacity="0"/></radialGradient></defs><circle cx="144" cy="144" r="92" fill="url(#a)"/></svg>
  <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">${sized(livre, Math.round(lado * 0.6))}</div></div>`, lado);

for (const [d, k] of Object.entries(densidades)) {
  // Android 7.1 e anteriores (não recortam o ícone): quadrado arredondado e círculo de 48dp.
  write(`${res}/mipmap-${d}/ic_launcher.png`, await dentroDaZona(`ic_launcher ${d}`, await png(app, 48 * k), 0.37, { fundoOpaco: true }));
  write(`${res}/mipmap-${d}/ic_launcher_round.png`, await dentroDaZona(`ic_launcher_round ${d}`, await png(redondo, 48 * k), 0.36, { fundoOpaco: true }));
  // Android 8+: ícone adaptativo em camadas de 108dp que cada launcher recorta (círculo, gota, quadrado arredondado...).
  // Aparecem os 72dp do centro, e só os 66dp do centro (raio 0,306 do lado) aparecem em TODAS as máscaras: a lula fica
  // num raio de ~26dp, com folga, como os ícones do Google.
  const lado = 108 * k;
  write(`${res}/mipmap-${d}/ic_launcher_background.png`, await png(fundoAdaptativo, lado));
  write(`${res}/mipmap-${d}/ic_launcher_foreground.png`, await dentroDaZona(`ic_launcher_foreground ${d}`, await centro(logo, lado, 0.533), 0.27));
  // Android 13+ com "ícones temáticos": silhueta de uma cor só, um pouco menor, como os ícones temáticos do sistema.
  write(`${res}/mipmap-${d}/ic_launcher_monochrome.png`, await dentroDaZona(`ic_launcher_monochrome ${d}`, await centro(mono, lado, 0.48), 0.25));
  write(`${res}/drawable-${d}/splash_icone.png`, await dentroDaZona(`splash_icone ${d}`, await iconeAbertura(288 * k), 0.333));
}
const adaptativo = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
`;
write(`${res}/mipmap-anydpi-v26/ic_launcher.xml`, adaptativo);
write(`${res}/mipmap-anydpi-v26/ic_launcher_round.xml`, adaptativo);
write(`${res}/values/marca.xml`, `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Fundo da marca: tela de abertura, barras do sistema e o app enquanto o site carrega. -->
    <color name="marca_fundo">${BG}</color>
</resources>
`);
await gerarIconeDeNotificacao();

await browser.close();
console.log('Pronto. Para o app Android: npx cap sync android (e gerar um novo APK).');
