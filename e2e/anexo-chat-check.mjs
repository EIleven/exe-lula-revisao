#!/usr/bin/env node
/**
 * A política de anexo do chat (src/lib/messages/anexoPolitica.ts):
 *   node e2e/anexo-chat-check.mjs        (ou: npm run e2e:anexo)
 *
 * O que está em jogo: mandar foto, vídeo ou áudio numa conversa não pode falhar calado. O caminho tem uma armadilha
 * que ninguém vê: numa conversa protegida o arquivo é cifrado ANTES de subir e vira um bloco binário — deixa de
 * parecer vídeo, perde o caminho próprio dos vídeos e cai no teto de 5 MB da rota comum. Quem mandava um vídeo de
 * 30 segundos esperava a cifragem e recebia "não foi possível concluir o envio", sem motivo.
 *
 * Aqui se prova que a recusa acontece na ESCOLHA do arquivo, com o motivo escrito, e que a conversa comum continua
 * aceitando vídeo grande (ele sobe por outro caminho). Sai com código 1 se algo falhar.
 */
import {
  LIMITE_POR_ARQUIVO,
  LIMITE_PROTEGIDO,
  SOBRECARGA_DA_CIFRAGEM,
  avaliarAnexo,
  formatarTamanho,
  pareceVideo,
} from '../src/lib/messages/anexoPolitica.ts';

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

const MB = 1024 * 1024;
const arquivo = (name, size, type) => ({ name, size, type });

// ───────────────────────── Reconhecer vídeo ─────────────────────────
confere('VÍDEO · pelo tipo informado pelo sistema', pareceVideo(arquivo('a.bin', 10, 'video/mp4')) === true, 'não reconheceu');
confere('VÍDEO · pela extensão quando o tipo vem vazio (acontece em arquivo vindo de outro app)',
  pareceVideo(arquivo('ferias.MOV', 10, '')) === true, 'não reconheceu .MOV');
confere('VÍDEO · o bloco cifrado NÃO parece vídeo (é exatamente a armadilha)',
  pareceVideo(arquivo('8f3a.enc', 10, 'application/octet-stream')) === false, 'achou que era vídeo');
confere('VÍDEO · imagem não é vídeo', pareceVideo(arquivo('foto.jpg', 10, 'image/jpeg')) === false, 'confundiu');
confere('VÍDEO · nome ou tipo ausentes não quebram', pareceVideo({}) === false, 'lançou ou acertou por acaso');

// ───────────────────────── Conversa comum ─────────────────────────
{
  const v = avaliarAnexo(arquivo('foto.jpg', 2 * MB, 'image/jpeg'), { cifrada: false });
  confere('ABERTA · foto dentro do teto passa', v.ok === true, JSON.stringify(v));
}
{
  const v = avaliarAnexo(arquivo('doc.pdf', 9 * MB, 'application/pdf'), { cifrada: false });
  confere('ABERTA · arquivo acima do teto é recusado na escolha', v.ok === false && v.motivo === 'grande', JSON.stringify(v));
  confere('ABERTA · a recusa diz o teto e o tamanho real', !v.ok && v.mensagem.includes('5 MB') && v.mensagem.includes('9 MB'), !v.ok ? v.mensagem : '');
}
{
  const v = avaliarAnexo(arquivo('festa.mp4', 80 * MB, 'video/mp4'), { cifrada: false });
  confere('ABERTA · vídeo grande PASSA (tem caminho próprio, com transcodificação)', v.ok === true && v.ehVideo === true, JSON.stringify(v));
}

// ───────────────────────── Conversa protegida ─────────────────────────
{
  // Era aqui que o vídeo morria: recusado na escolha porque, cifrado, ele perdia o caminho de vídeo e batia nos
  // 5 MB da rota comum. Agora ele TEM caminho — cifragem em pedaços — e o que se prova é que vai por ele.
  const v = avaliarAnexo(arquivo('festa.mp4', 80 * MB, 'video/mp4'), { cifrada: true });
  confere('PROTEGIDA · vídeo grande passa pelo caminho em pedaços',
    v.ok === true && v.caminho === 'protegido-grande', JSON.stringify(v));
  confere('PROTEGIDA · e continua sendo reconhecido como vídeo (a capa depende disso)',
    v.ok === true && v.ehVideo === true, JSON.stringify(v));
}
{
  // O teto não sumiu, mudou de lugar: 200 MB.
  const v = avaliarAnexo(arquivo('filme.mp4', 300 * MB, 'video/mp4'), { cifrada: true });
  confere('PROTEGIDA · acima de 200 MB é recusado NA ESCOLHA, não depois de cifrar',
    v.ok === false && v.motivo === 'cifrado-grande', JSON.stringify(v));
  confere('PROTEGIDA · a recusa diz o limite de verdade (200 MB) e o tamanho do arquivo',
    !v.ok && v.mensagem.includes('200 MB') && v.mensagem.includes('300 MB'), !v.ok ? v.mensagem : '');
  confere('PROTEGIDA · o título fala em vídeo quando é vídeo', !v.ok && v.titulo.toLowerCase().includes('vídeo'), !v.ok ? v.titulo : '');
  confere('PROTEGIDA · exatamente no teto ainda passa',
    avaliarAnexo(arquivo('no-limite.mp4', LIMITE_PROTEGIDO, 'video/mp4'), { cifrada: true }).ok === true, 'recusou no limite');
}
{
  const v = avaliarAnexo(arquivo('foto.jpg', 1 * MB, 'image/jpeg'), { cifrada: true });
  confere('PROTEGIDA · foto pequena passa normalmente, pela rota comum',
    v.ok === true && v.caminho === 'comum', JSON.stringify(v));
}
{
  // A sobrecarga da cifragem entra na conta: sem ela o arquivo passaria aqui e o servidor recusaria depois.
  const quaseNoTeto = LIMITE_POR_ARQUIVO - Math.floor(SOBRECARGA_DA_CIFRAGEM / 2);
  const v = avaliarAnexo(arquivo('quase.bin', quaseNoTeto, 'application/pdf'), { cifrada: true });
  confere('PROTEGIDA · arquivo que só estouraria DEPOIS de cifrado vai pelo caminho em pedaços',
    v.ok === true && v.caminho === 'protegido-grande', JSON.stringify(v));

  const folgado = LIMITE_POR_ARQUIVO - SOBRECARGA_DA_CIFRAGEM - 1;
  const w = avaliarAnexo(arquivo('cabe.bin', folgado, 'application/pdf'), { cifrada: true });
  confere('PROTEGIDA · o que cabe depois de cifrado continua indo pela rota comum (sem complicar o simples)',
    w.ok === true && w.caminho === 'comum', JSON.stringify(w));
}

// ───────────────────────── Bordas ─────────────────────────
for (const [nome, entrada] of [
  ['tamanho zero', arquivo('vazio.jpg', 0, 'image/jpeg')],
  ['tamanho ausente', { name: 'x.jpg', type: 'image/jpeg' }],
  ['tamanho negativo', arquivo('x.jpg', -5, 'image/jpeg')],
  ['tamanho não numérico', arquivo('x.jpg', Number.NaN, 'image/jpeg')],
]) {
  const v = avaliarAnexo(entrada, { cifrada: false });
  confere(`BORDA · ${nome} é recusado como arquivo vazio, sem quebrar`, v.ok === false && v.motivo === 'vazio', JSON.stringify(v));
}
confere('BORDA · objeto sem nada não lança', (() => {
  try {
    return avaliarAnexo({}, { cifrada: true }).ok === false;
  } catch {
    return false;
  }
})(), 'lançou');

// ───────────────────────── Como o tamanho é escrito ─────────────────────────
confere('TAMANHO · em português, com vírgula decimal', formatarTamanho(Math.round(4.2 * MB)) === '4,2 MB', formatarTamanho(Math.round(4.2 * MB)));
confere('TAMANHO · arquivo grande sem casa decimal', formatarTamanho(80 * MB) === '80 MB', formatarTamanho(80 * MB));
confere('TAMANHO · abaixo de 1 MB vira KB', formatarTamanho(300 * 1024) === '300 KB', formatarTamanho(300 * 1024));
confere('TAMANHO · pouquíssimos bytes viram B', formatarTamanho(512) === '512 B', formatarTamanho(512));
confere('TAMANHO · zero e lixo não viram "NaN MB"', formatarTamanho(0) === '0 KB' && formatarTamanho(Number.NaN) === '0 KB', 'escreveu lixo');

console.log('');
console.log(`${total} verificações.`);
if (falhas) {
  console.log(`${falhas} falha(s).`);
  process.exit(1);
}
console.log('Anexo do chat OK: a recusa acontece na escolha, com motivo, e vídeo grande só é barrado onde ele realmente não cabe.');
