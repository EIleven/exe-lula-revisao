#!/usr/bin/env node
/**
 * Testa src/lib/utils/youtubeLinks.ts (link do YouTube colado num post vira vídeo dentro da publicação) sem app nem
 * emuladores: importa o módulo TypeScript direto (o Node 22 remove os tipos).
 *   node e2e/youtube-links-check.mjs
 * Confere as formas de endereço que a pessoa pode colar (inclusive AO VIVO e SHORTS, que ficavam de fora), que não
 * sobra pedaço do endereço no texto, que o texto em HTML não é corrompido e que o que NÃO é vídeo continua link.
 * Sai com código 1 se algo falhar.
 */
const { extractYoutubeVideoInfo, isYoutubeVideoUrl } = await import('../src/lib/utils/youtubeLinks.ts');

let falhas = 0;
const ID = '7YaEux-64_w';
const OUTRO = 'dQw4w9WgXcQ';

// [nome, texto colado, id esperado (undefined = continua texto), texto esperado depois (null = não confere)]
const casos = [
  ['vídeo comum', `https://www.youtube.com/watch?v=${ID}`, ID, ''],
  ['ao vivo', `https://www.youtube.com/live/${ID}?is=BPeyH0oCtrgElZYG`, ID, ''],
  ['ao vivo sem parâmetro', `https://www.youtube.com/live/${ID}`, ID, ''],
  ['shorts', `https://www.youtube.com/shorts/${ID}`, ID, ''],
  ['link curto', `https://youtu.be/${ID}`, ID, ''],
  ['link curto com tempo', `https://youtu.be/${ID}?t=42`, ID, ''],
  ['celular (m.youtube)', `https://m.youtube.com/watch?v=${ID}`, ID, ''],
  ['incorporado (embed)', `https://www.youtube.com/embed/${ID}`, ID, ''],
  ['antigo (/v/)', `https://www.youtube.com/v/${ID}`, ID, ''],
  ['com playlist', `https://www.youtube.com/watch?v=${ID}&list=PL123`, ID, ''],
  ['sem https', `www.youtube.com/watch?v=${ID}`, ID, ''],
  ['com texto em volta', `olha isso https://youtu.be/${ID}?t=9 muito bom`, ID, 'olha isso  muito bom'],
  ['dentro de HTML', `<p>veja https://www.youtube.com/live/${ID}?is=X</p>`, ID, '<p>veja </p>'],
  ['dentro de um link', `<a href="https://youtu.be/${ID}?t=1">vídeo</a>`, ID, '<a href="">vídeo</a>'],
  ['dois vídeos: vale o primeiro', `https://youtu.be/${ID} e https://youtu.be/${OUTRO}`, ID, null],
  ['canal não é vídeo', 'https://www.youtube.com/@CanalDoLula', undefined, null],
  ['playlist sem vídeo não é vídeo', 'https://www.youtube.com/playlist?list=PL1234567890', undefined, null],
  ['outro site não é vídeo', 'https://exercitodolula.app/pt-BR/post/abc', undefined, null],
  ['texto sem link', 'nada de vídeo aqui', undefined, 'nada de vídeo aqui'],
  ['texto vazio', '', undefined, ''],
];

for (const [nome, texto, idEsperado, textoEsperado] of casos) {
  const { videoId, cleanedText } = extractYoutubeVideoInfo(texto);
  const problemas = [];
  if (videoId !== idEsperado) {
    problemas.push(idEsperado ? `esperava o vídeo ${idEsperado}, veio ${videoId ?? 'nenhum'}` : `virou vídeo ${videoId} sem ser um`);
  }
  if (textoEsperado !== null && (cleanedText ?? '') !== textoEsperado) {
    problemas.push(`o texto ficou ${JSON.stringify(cleanedText)} (esperado ${JSON.stringify(textoEsperado)})`);
  }
  if (problemas.length) {
    falhas++;
    console.log(`FALHA ${nome} — ${problemas.join('; ')}`);
  } else {
    console.log(`OK    ${nome}${videoId ? ` — vídeo ${videoId}` : ' — continua texto'}`);
  }
}

// O endereço do vídeo nunca pode sair do YouTube (o <iframe> do post confia nele).
const { videoId: idFalso } = extractYoutubeVideoInfo('https://youtube.com.evil.example/watch?v=' + ID);
if (idFalso) {
  falhas++;
  console.log(`FALHA domínio parecido (youtube.com.evil.example) virou vídeo ${idFalso}`);
} else {
  console.log('OK    domínio parecido com o do YouTube não vira vídeo');
}

if (!isYoutubeVideoUrl(`https://www.youtube.com/watch?v=${ID}`) || isYoutubeVideoUrl('https://example.com/video')) {
  falhas++;
  console.log('FALHA classificação da prévia: YouTube e link comum foram confundidos');
} else {
  console.log('OK    classificação da prévia: YouTube usa somente o player próprio');
}
console.log(`${casos.length + 2 - falhas} de ${casos.length + 2} conferências passaram`);
console.log(falhas ? 'RESULTADO: HÁ FALHAS' : 'RESULTADO: PASSOU');
process.exitCode = falhas ? 1 : 0;
