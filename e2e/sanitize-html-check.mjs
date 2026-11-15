#!/usr/bin/env node
/**
 * Testa src/lib/security/sanitizeHtml.ts (HTML de artigos renderizado com dangerouslySetInnerHTML) sem app nem
 * emuladores: importa o módulo TypeScript direto (o Node 22 remove os tipos).
 *   node e2e/sanitize-html-check.mjs
 * Ataques XSS conhecidos precisam sair inofensivos; o HTML que o editor de artigos gera precisa continuar igual.
 * Sai com código 1 se algo falhar.
 */
const { sanitizeHtml, htmlToPlainText, safeJsonForScript } = await import('../src/lib/security/sanitizeHtml.ts');

let failures = 0;
const ok = (name, detail = '') => console.log(`OK    ${name}${detail ? ` — ${detail}` : ''}`);
const fail = (name, detail) => {
  failures++;
  console.log(`FALHA ${name} — ${detail}`);
};

// Sinais de código executável ou de fuga que NUNCA podem sobrar no resultado.
const DANGER = [
  /<script/i, /\son[a-z]+\s*=/i, /javascript:/i, /vbscript:/i, /<svg/i, /<math/i, /<object/i, /<embed/i,
  /<base/i, /<meta/i, /<form/i, /<style/i, /<link/i, /expression\s*\(/i, /position\s*:/i, /z-index/i,
  /url\s*\(/i, /srcdoc/i, /<iframe[^>]*src="(?!https:\/\/www\.youtube(-nocookie)?\.com\/embed\/|about:blank)/i,
];
const attacks = {
  'img onerror': '<img src=x onerror=alert(1)>',
  'script': '<script>alert(1)</script>texto',
  'href javascript:': '<a href="javascript:alert(1)">x</a>',
  'href com entidade': '<a href="&#106;avascript:alert(1)">x</a>',
  'href com espaço e maiúsculas': '<a href="  JaVaScRiPt:alert(1)">x</a>',
  'img src javascript:': "<IMG SRC=JaVaScRiPt:alert('XSS')>",
  'svg onload': '<svg onload=alert(1)><circle/></svg>',
  'mXSS math/style': '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
  'iframe de terceiros': '<iframe src="https://evil.example/x"></iframe>',
  'iframe srcdoc': '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  'iframe javascript:': '<iframe src="javascript:alert(1)"></iframe>',
  'css de sobreposição': '<p style="position:fixed;top:0;left:0;z-index:99;text-align:center">x</p>',
  'css url()': '<p style="background:url(javascript:alert(1))">x</p>',
  'classe do Tailwind (sobrepor a tela)': '<div class="fixed inset-0 z-50">x</div>',
  'comentário com payload': '<!-- <img src=x onerror=alert(1)> -->ok',
  'base href': '<base href="https://evil.example/">',
  'meta refresh': '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  'form': '<form action="https://evil.example"><input name=a></form>',
  'object': '<object data="javascript:alert(1)"></object>',
  'link stylesheet': '<link rel=stylesheet href="https://evil.example/x.css">',
  'atributo fecha a aspa': '<a href="https://ok.example/" title="x" onmouseover="alert(1)">x</a>',
  'texto que imita tag': '"><img src=x onerror=alert(1)>',
  'video poster javascript:': '<video src="https://ok.example/v.mp4" poster="javascript:alert(1)"></video>',
};
for (const [name, html] of Object.entries(attacks)) {
  const out = sanitizeHtml(html);
  const hit = DANGER.find((pattern) => pattern.test(out));
  if (hit) fail(`ataque: ${name}`, `sobrou ${hit} em ${JSON.stringify(out)}`);
  else ok(`ataque: ${name}`, JSON.stringify(out));
}

// Links: "//x" e "/\x" levam a outro site; target ganha rel seguro e o rel original é descartado.
const links = sanitizeHtml('<a href="//evil.example">a</a><a href="/\\evil.example">b</a><a href="https://ok.example" target="_top" rel="opener">c</a>');
if (/evil/.test(links)) fail('links para outro site via // ou /\\', links);
else ok('links para outro site via // ou /\\ são removidos');
if (!/target="_blank" rel="noopener noreferrer nofollow ugc"/.test(links) || /opener"/.test(links.replace('noopener', ''))) fail('target/rel', links);
else ok('target vira _blank com rel seguro', links.match(/<a href="https:[^>]*>/)?.[0]);

// HTML que o editor (TipTap) produz: precisa passar sem perder o essencial.
const editor = [
  ['parágrafo alinhado', '<p style="text-align: center">Olá <strong>mundo</strong> <em>!</em></p>', ['<p style="text-align:center;">', '<strong>mundo</strong>']],
  ['títulos e listas', '<h2>Título</h2><ul><li><p>um</p></li></ul><ol start="3"><li>três</li></ol><blockquote><p>citação</p></blockquote>', ['<h2>Título</h2>', '<ol start="3">', '<blockquote>']],
  ['imagem do editor', '<img src="https://firebasestorage.googleapis.com/v0/b/x/o/a.png?alt=media" width="100%" height="auto" class="rounded" data-text-align="center">', ['src="https://firebasestorage.googleapis.com/v0/b/x/o/a.png?alt=media"', 'width="100%"', 'data-text-align="center"']],
  ['vídeo do editor', '<video src="https://firebasestorage.googleapis.com/v.mp4" controls="true"></video>', ['<video src="https://firebasestorage.googleapis.com/v.mp4" controls="true">']],
  ['YouTube do editor', '<div data-youtube-video=""><div class="youtube-embed"><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" frameborder="0" allowfullscreen="true" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe></div></div>', ['class="youtube-embed"', 'src="https://www.youtube.com/embed/dQw4w9WgXcQ"', 'allowfullscreen']],
  ['link de anexo com estilo', '<p><a href="https://firebasestorage.googleapis.com/doc.pdf" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem; border: 1px solid hsl(var(--border)); border-radius: 0.5rem; text-decoration: none; margin-block: 1rem;">doc.pdf</a></p>', ['display:inline-flex', 'border-radius:0.5rem', '>doc.pdf</a>']],
  ['entidades e texto', '<p>A &amp; B &lt; C</p>', ['A &amp; B &lt; C']],
];
for (const [name, html, needles] of editor) {
  const out = sanitizeHtml(html);
  const missing = needles.filter((needle) => !out.includes(needle));
  if (missing.length) fail(`editor: ${name}`, `faltou ${JSON.stringify(missing)} em ${JSON.stringify(out)}`);
  else ok(`editor: ${name}`);
}

// Mesmo resultado sempre (servidor e navegador rodam o mesmo código de string: sem diferença na hidratação).
const sample = editor.map(([, html]) => html).join('');
if (sanitizeHtml(sample) !== sanitizeHtml(sample)) fail('determinismo', 'duas execuções deram resultados diferentes');
else ok('determinismo: mesma entrada, mesma saída');
if (sanitizeHtml(sanitizeHtml(sample)) !== sanitizeHtml(sample)) fail('idempotência', 'higienizar duas vezes muda o resultado');
else ok('idempotência: higienizar de novo não muda nada');

// Texto puro para prévias.
const plain = htmlToPlainText('<p>Olá&nbsp;<b>mundo</b> &amp; &lt;todos&gt; &#39;sim&#39;</p><script>x()</script>');
if (plain !== "Olá mundo & <todos> 'sim'") fail('htmlToPlainText', JSON.stringify(plain));
else ok('htmlToPlainText tira tags e decodifica entidades', JSON.stringify(plain));

// JSON-LD: um título com </script> não pode fechar a tag.
const json = safeJsonForScript({ headline: '</script><script>alert(1)</script>' });
if (/<\/script/i.test(json) || JSON.parse(json).headline !== '</script><script>alert(1)</script>') fail('safeJsonForScript', json);
else ok('safeJsonForScript escapa < e > sem mudar o dado', json);

console.log(failures ? `\n${failures} falha(s).` : '\nTudo certo.');
process.exitCode = failures ? 1 : 0;
