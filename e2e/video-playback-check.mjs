#!/usr/bin/env node
/**
 * Player autoral do Exe. Lula (Fase 1): a memória de onde cada vídeo estava, as contas/atalhos dos controles e as guardas de cor.
 *   node e2e/video-playback-check.mjs        (ou: npm run e2e:player-video)
 *
 * Regras (2026-11-14):
 *  - o vídeo aberto no feed continua do MESMO segundo na página do post (lib/media/videoPlaybackState.ts, só em memória);
 *  - a barra do player usa a cor da rede (`--primary` via bg-primary/text-primary/ring-primary/accent-primary), nunca azul/cinza fixo;
 *  - no FEED, tocar na superfície abre o post; na PÁGINA do post, tocar pausa/reproduz (onSurfaceClick só no feed);
 *  - mensagens, editor e a grade de mídia seguem com o player nativo (sem `themed`).
 * A parte de código-fonte é uma GUARDA contra o desfazer silencioso (um editor com o arquivo antigo aberto já sobrescreveu
 * correções aqui uma vez).
 * Sai com código 1 se algo falhar.
 */
import { readFileSync } from 'node:fs';
import {
  createPlaybackStore, playbackKey, PLAYBACK_TTL_MS, PLAYBACK_MAX_ENTRIES, MIN_RESUME_SECONDS, END_MARGIN_SECONDS, HANDOFF_MAX_AGE_MS, videoPlaybackStore,
} from '../src/lib/media/videoPlaybackState.ts';
import { clamp, formatClock, fractionOf, seekTarget, timeFromPointer, keyAction, nextVolume } from '../src/lib/media/videoControls.ts';
import {
  buildVideoQueue, findStartIndex, stepIndex, windowIndexes, compactCount, createQueueMemory, urlBase, QUEUE_MAX_ENTRIES, QUEUE_MEMORY_TTL_MS,
} from '../src/lib/media/videoQueue.ts';

let falhas = 0;
let total = 0;
const confere = (nome, condicao, motivo) => {
  total++;
  if (condicao) console.log(`OK    ${nome}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo ?? 'condição falsa'}`); }
};
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ───────── a chave do vídeo ─────────
const URL_A = 'https://exercitodolula.app/m/AbCdEfGhIjKlMnOpQrStUv';
confere('CHAVE · post + arquivo', playbackKey('p1', URL_A) === `p1|${URL_A}`, String(playbackKey('p1', URL_A)));
confere('CHAVE · ignora ?token e #fragmento (o mesmo arquivo vem com versão/token diferente)', playbackKey('p1', `${URL_A}?v=2&t=abc#x`) === playbackKey('p1', URL_A), String(playbackKey('p1', `${URL_A}?v=2&t=abc#x`)));
confere('CHAVE · posts diferentes não se misturam', playbackKey('p1', URL_A) !== playbackKey('p2', URL_A), 'mesma chave');
confere('CHAVE · mídias diferentes do mesmo post não se misturam', playbackKey('p1', URL_A) !== playbackKey('p1', `${URL_A}x`), 'mesma chave');
confere('CHAVE · sem post usa "-"', playbackKey(null, URL_A) === `-|${URL_A}` && playbackKey(undefined, URL_A) === `-|${URL_A}` && playbackKey('', URL_A) === `-|${URL_A}`, String(playbackKey(null, URL_A)));
for (const ruim of [null, undefined, '', 42, {}, [], '?so-query', '#so-fragmento']) {
  confere(`CHAVE · mídia inválida ${JSON.stringify(ruim)} → null`, playbackKey('p1', ruim) === null, String(playbackKey('p1', ruim)));
}
confere('CHAVE · endereço gigante (>2048) → null', playbackKey('p1', 'https://x.test/' + 'a'.repeat(2100)) === null, 'aceitou');

// ───────── a memória (com relógio controlado) ─────────
let agora = 1_000_000;
const novo = () => createPlaybackStore(() => agora);
{
  const s = novo();
  confere('MEMÓRIA · vazia: get → null, size 0', s.get('k') === null && s.size === 0, '');
  s.save('k', { currentTime: 42.5, isPlaying: true, muted: false, volume: 0.7, duration: 120 });
  const v = s.get('k');
  confere('MEMÓRIA · guarda e devolve o estado', v && v.currentTime === 42.5 && v.isPlaying === true && v.muted === false && v.volume === 0.7 && v.duration === 120 && v.updatedAt === agora, JSON.stringify(v));
  v.currentTime = 999;
  confere('MEMÓRIA · devolve CÓPIA (mexer no resultado não altera o guardado)', s.get('k').currentTime === 42.5, String(s.get('k').currentTime));
  s.save('k', { currentTime: 50 });
  const w = s.get('k');
  confere('MEMÓRIA · atualização parcial mantém o resto (volume, duração, tocando)', w.currentTime === 50 && w.volume === 0.7 && w.duration === 120 && w.isPlaying === true, JSON.stringify(w));
  s.save(null, { currentTime: 5 }); s.save(undefined, { currentTime: 5 }); s.save('', { currentTime: 5 });
  confere('MEMÓRIA · chave nula/vazia é ignorada', s.size === 1, String(s.size));
  confere('MEMÓRIA · get com chave nula/vazia → null', s.get(null) === null && s.get(undefined) === null && s.get('') === null, '');
}
{
  const s = novo();
  s.save('k', { currentTime: -5, volume: 7, isPlaying: 'sim', muted: 1, duration: -3 });
  const v = s.get('k');
  confere('VALIDAÇÃO · tempo negativo → 0, volume >1 → 1', v.currentTime === 0 && v.volume === 1, JSON.stringify(v));
  confere('VALIDAÇÃO · "tocando"/"mudo" só valem como booleano verdadeiro', v.isPlaying === false && v.muted === false, JSON.stringify(v));
  confere('VALIDAÇÃO · duração inválida é descartada', v.duration === undefined, JSON.stringify(v));
  s.save('n', { currentTime: NaN, volume: Infinity, duration: NaN });
  const n = s.get('n');
  confere('VALIDAÇÃO · NaN/Infinity viram 0 e volume padrão (1)', n.currentTime === 0 && n.volume === 1 && n.duration === undefined, JSON.stringify(n));
  s.save('g', { currentTime: 10 ** 9 });
  confere('VALIDAÇÃO · tempo absurdo é limitado a 24 h', s.get('g').currentTime === 24 * 3600, String(s.get('g').currentTime));
  s.save('v', { volume: -2 });
  confere('VALIDAÇÃO · volume negativo → 0', s.get('v').volume === 0, String(s.get('v').volume));
}
{
  const s = novo();
  agora = 5_000_000;
  s.save('velho', { currentTime: 30 });
  agora += PLAYBACK_TTL_MS;
  confere('TTL · no limite exato (30 min) ainda vale', s.get('velho') !== null, 'expirou cedo');
  agora += 1;
  confere('TTL · passou de 30 min → some', s.get('velho') === null, 'não expirou');
  confere('TTL · e sai da memória (size 0)', s.size === 0, String(s.size));
  s.save('a', { currentTime: 5 });
  agora += PLAYBACK_TTL_MS - 1000;
  s.save('a', { currentTime: 6 });
  agora += PLAYBACK_TTL_MS - 1000;
  confere('TTL · cada gravação renova o prazo', s.get('a') !== null && s.get('a').currentTime === 6, '');
}
{
  const s = novo();
  agora = 9_000_000;
  for (let i = 0; i < PLAYBACK_MAX_ENTRIES + 15; i++) { agora += 1; s.save(`k${i}`, { currentTime: i }); }
  confere(`TETO · nunca passa de ${PLAYBACK_MAX_ENTRIES} entradas`, s.size === PLAYBACK_MAX_ENTRIES, String(s.size));
  confere('TETO · sai o MENOS recente (k0 sumiu, o último ficou)', s.get('k0') === null && s.get(`k${PLAYBACK_MAX_ENTRIES + 14}`) !== null, '');
  agora += 1; s.save('k15', { currentTime: 999 });
  for (let i = 0; i < 10; i++) { agora += 1; s.save(`novo${i}`, { currentTime: i }); }
  confere('TETO · quem foi tocado de novo (k15) fica e quem estava parado sai antes', s.get('k15') !== null && s.get('k16') === null, `${s.get('k15') !== null} ${s.get('k16') === null}`);
}
{
  const s = novo();
  agora = 12_000_000;
  s.save('a', { currentTime: 1 }); s.save('b', { currentTime: 2 });
  s.clear('a');
  confere('LIMPAR · clear remove só a chave', s.get('a') === null && s.get('b') !== null, '');
  s.clear(null); s.clear(undefined); s.clear('nao-existe');
  confere('LIMPAR · clear de chave nula/inexistente não quebra nem apaga o resto', s.size === 1, String(s.size));
  s.clearAll();
  confere('LIMPAR · clearAll esvazia', s.size === 0, String(s.size));
}

// ───────── onde retomar ─────────
{
  const s = novo();
  agora = 20_000_000;
  confere('RETOMAR · nada guardado → null', s.resumePoint('k') === null, '');
  s.save('k', { currentTime: 0.4, duration: 100 });
  confere(`RETOMAR · antes de ${MIN_RESUME_SECONDS}s "ainda não começou" → null`, s.resumePoint('k') === null, String(s.resumePoint('k')));
  s.save('k', { currentTime: MIN_RESUME_SECONDS });
  confere(`RETOMAR · a partir de ${MIN_RESUME_SECONDS}s retoma`, s.resumePoint('k') === MIN_RESUME_SECONDS, String(s.resumePoint('k')));
  s.save('k', { currentTime: 73.25 });
  confere('RETOMAR · devolve o segundo guardado', s.resumePoint('k') === 73.25, String(s.resumePoint('k')));
  s.save('k', { currentTime: 100 - END_MARGIN_SECONDS });
  confere('RETOMAR · colado no fim (margem) conta como assistido → null (recomeça)', s.resumePoint('k') === null, String(s.resumePoint('k')));
  s.save('k', { currentTime: 100 - END_MARGIN_SECONDS - 0.01 });
  confere('RETOMAR · logo antes da margem ainda retoma', s.resumePoint('k') !== null, String(s.resumePoint('k')));
  s.save('k', { currentTime: 100 });
  confere('RETOMAR · terminou (100/100) → null', s.resumePoint('k') === null, String(s.resumePoint('k')));
  s.save('sem', { currentTime: 40 });
  confere('RETOMAR · sem duração conhecida retoma pelo tempo', s.resumePoint('sem') === 40, String(s.resumePoint('sem')));
  agora += PLAYBACK_TTL_MS + 1;
  confere('RETOMAR · depois do TTL → null', s.resumePoint('sem') === null, '');
}
// ───────── passagem feed → página do post: só continua TOCANDO se foi deixado tocando há pouco ─────────
{
  const s = novo();
  agora = 30_000_000;
  confere('PASSAGEM · nada guardado → não toca', s.handoffPlaying('k') === false && s.handoffPlaying(null) === false && s.handoffPlaying(undefined) === false, '');
  s.save('k', { currentTime: 30, isPlaying: true });
  confere('PASSAGEM · deixado tocando agora → continua tocando', s.handoffPlaying('k') === true, '');
  agora += HANDOFF_MAX_AGE_MS;
  confere(`PASSAGEM · no limite exato (${HANDOFF_MAX_AGE_MS / 1000}s) ainda continua`, s.handoffPlaying('k') === true, '');
  agora += 1;
  confere('PASSAGEM · um instante depois do limite → NÃO toca sozinho (retoma pausado)', s.handoffPlaying('k') === false, '');
  confere('PASSAGEM · e a posição continua retomável (só o "tocando" expirou)', s.resumePoint('k') === 30, String(s.resumePoint('k')));
  s.save('p', { currentTime: 30, isPlaying: false });
  confere('PASSAGEM · deixado PAUSADO → não toca', s.handoffPlaying('p') === false, '');
  s.save('k', { currentTime: 31, isPlaying: true });
  s.save('k', { volume: 0.5 });
  confere('PASSAGEM · atualização parcial (volume) preserva o "tocando" e renova o prazo', s.handoffPlaying('k') === true, '');
  agora += PLAYBACK_TTL_MS + 1;
  confere('PASSAGEM · entrada expirada (TTL) → não toca', s.handoffPlaying('k') === false, '');
  confere('PASSAGEM · o prazo da passagem é curto de propósito (≤ 30 s) e menor que o TTL', HANDOFF_MAX_AGE_MS > 0 && HANDOFF_MAX_AGE_MS <= 30_000 && HANDOFF_MAX_AGE_MS < PLAYBACK_TTL_MS, String(HANDOFF_MAX_AGE_MS));
}
confere('SINGLETON · videoPlaybackStore é um store compartilhado e funcional', (() => { videoPlaybackStore.save('s|x', { currentTime: 12 }); const ok = videoPlaybackStore.get('s|x')?.currentTime === 12; videoPlaybackStore.clear('s|x'); return ok; })(), '');

// ───────── relógio e barra ─────────
for (const [entrada, esperado] of [[0, '0:00'], [5, '0:05'], [59.9, '0:59'], [60, '1:00'], [125, '2:05'], [3599, '59:59'], [3600, '1:00:00'], [3725, '1:02:05'], [36000, '10:00:00'], [-4, '0:00'], [NaN, '0:00'], [Infinity, '0:00'], [null, '0:00'], [undefined, '0:00'], ['12', '0:00']]) {
  confere(`RELÓGIO · ${String(entrada)} → ${esperado}`, formatClock(entrada) === esperado, formatClock(entrada));
}
confere('FRAÇÃO · metade', fractionOf(30, 60) === 0.5, String(fractionOf(30, 60)));
confere('FRAÇÃO · passou do fim → 1, antes do começo → 0', fractionOf(90, 60) === 1 && fractionOf(-5, 60) === 0, `${fractionOf(90, 60)} ${fractionOf(-5, 60)}`);
confere('FRAÇÃO · duração 0/NaN/Infinity (ao vivo) → 0', fractionOf(10, 0) === 0 && fractionOf(10, NaN) === 0 && fractionOf(10, Infinity) === 0, '');
confere('FRAÇÃO · tempo inválido → 0', fractionOf(NaN, 60) === 0 && fractionOf(undefined, 60) === 0 && fractionOf('3', 60) === 0, '');

// ───────── pular ─────────
confere('PULAR · +5 s', seekTarget(10, 5, 100) === 15, String(seekTarget(10, 5, 100)));
confere('PULAR · −5 s no começo trava em 0', seekTarget(2, -5, 100) === 0, String(seekTarget(2, -5, 100)));
confere('PULAR · +10 s perto do fim trava na duração', seekTarget(95, 10, 100) === 100, String(seekTarget(95, 10, 100)));
confere('PULAR · duração desconhecida (NaN/0/Infinity) não trava em 0', seekTarget(10, 5, NaN) === 15 && seekTarget(10, 5, 0) === 15 && seekTarget(10, 5, Infinity) === 15, `${seekTarget(10, 5, NaN)} ${seekTarget(10, 5, 0)} ${seekTarget(10, 5, Infinity)}`);
confere('PULAR · atual/delta inválidos são tratados como 0', seekTarget(NaN, 5, 100) === 5 && seekTarget(10, NaN, 100) === 10, `${seekTarget(NaN, 5, 100)} ${seekTarget(10, NaN, 100)}`);

// ───────── clique na barra ─────────
confere('BARRA · começo da trilha → 0', timeFromPointer(100, 100, 400, 80) === 0, String(timeFromPointer(100, 100, 400, 80)));
confere('BARRA · meio da trilha → metade do vídeo', timeFromPointer(300, 100, 400, 80) === 40, String(timeFromPointer(300, 100, 400, 80)));
confere('BARRA · fim da trilha → duração', timeFromPointer(500, 100, 400, 80) === 80, String(timeFromPointer(500, 100, 400, 80)));
confere('BARRA · arrastar para fora (antes/depois) trava nas pontas', timeFromPointer(-50, 100, 400, 80) === 0 && timeFromPointer(9999, 100, 400, 80) === 80, `${timeFromPointer(-50, 100, 400, 80)} ${timeFromPointer(9999, 100, 400, 80)}`);
confere('BARRA · largura 0 / duração inválida → 0 (sem dividir por zero)', timeFromPointer(300, 100, 0, 80) === 0 && timeFromPointer(300, 100, 400, 0) === 0 && timeFromPointer(300, 100, 400, NaN) === 0 && timeFromPointer(NaN, 100, 400, 80) === 0, '');

// ───────── atalhos ─────────
const acao = (tecla, mod) => keyAction(tecla, mod);
confere('ATALHO · espaço e K pausam/tocam', igual(acao(' '), { type: 'toggle' }) && igual(acao('k'), { type: 'toggle' }) && igual(acao('K'), { type: 'toggle' }), '');
confere('ATALHO · ←/→ pulam 5 s', igual(acao('ArrowLeft'), { type: 'seek', delta: -5 }) && igual(acao('ArrowRight'), { type: 'seek', delta: 5 }), '');
confere('ATALHO · J/L pulam 10 s (maiúscula também)', igual(acao('j'), { type: 'seek', delta: -10 }) && igual(acao('J'), { type: 'seek', delta: -10 }) && igual(acao('l'), { type: 'seek', delta: 10 }) && igual(acao('L'), { type: 'seek', delta: 10 }), '');
confere('ATALHO · ↑/↓ mudam o volume em 5%', igual(acao('ArrowUp'), { type: 'volume', delta: 0.05 }) && igual(acao('ArrowDown'), { type: 'volume', delta: -0.05 }), '');
confere('ATALHO · M silencia, F tela cheia', igual(acao('m'), { type: 'mute' }) && igual(acao('M'), { type: 'mute' }) && igual(acao('f'), { type: 'fullscreen' }) && igual(acao('F'), { type: 'fullscreen' }), '');
confere('ATALHO · Home volta ao início', igual(acao('Home'), { type: 'seek-fraction', fraction: 0 }), '');
confere('ATALHO · 0–9 vão a 0–90%', [0, 1, 5, 9].every((n) => igual(acao(String(n)), { type: 'seek-fraction', fraction: n / 10 })), '');
for (const mod of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
  confere(`ATALHO · com ${Object.keys(mod)[0]} é do navegador, não do player (null)`, acao('k', mod) === null && acao('ArrowLeft', mod) === null && acao('5', mod) === null && acao('f', mod) === null, '');
}
confere('ATALHO · shift não bloqueia (K maiúsculo)', acao('K', { shiftKey: true }) !== null, '');
for (const outra of ['a', 'Enter', 'Escape', 'Tab', '10', '-', '', 'Shift', 'x', 'ArrowUpp']) {
  confere(`ATALHO · tecla sem função ${JSON.stringify(outra)} → null`, acao(outra) === null, JSON.stringify(acao(outra)));
}

// ───────── volume ─────────
confere('VOLUME · +0.05 e −0.05', nextVolume(0.5, 0.05) === 0.55 && nextVolume(0.5, -0.05) === 0.45, `${nextVolume(0.5, 0.05)} ${nextVolume(0.5, -0.05)}`);
confere('VOLUME · arredonda (sem 0.15000000000000002)', nextVolume(0.1, 0.05) === 0.15 && nextVolume(0.7, 0.05) === 0.75, `${nextVolume(0.1, 0.05)} ${nextVolume(0.7, 0.05)}`);
confere('VOLUME · nunca passa de 1 nem de 0', nextVolume(0.98, 0.05) === 1 && nextVolume(0.02, -0.05) === 0 && nextVolume(1, 0.05) === 1 && nextVolume(0, -0.05) === 0, '');
confere('VOLUME · valor inválido: atual vira 1, delta vira 0', nextVolume(NaN, -0.05) === 0.95 && nextVolume(0.5, NaN) === 0.5, `${nextVolume(NaN, -0.05)} ${nextVolume(0.5, NaN)}`);
confere('VOLUME · subir 20 vezes de 0 chega em 1 sem sobrar', (() => { let v = 0; for (let i = 0; i < 20; i++) v = nextVolume(v, 0.05); return v === 1; })(), '');
confere('CLAMP · limita nas pontas', clamp(5, 0, 1) === 1 && clamp(-5, 0, 1) === 0 && clamp(0.3, 0, 1) === 0.3, '');

// ───────── sair sem apagar a posição mais nova (o player de baixo × o teatro) ─────────
{
  const s = novo();
  agora = 40_000_000;
  s.save('k', { currentTime: 10 });
  const visto = s.get('k').updatedAt;
  agora += 5;
  confere('SAIR · ninguém gravou depois: grava', s.saveUnlessNewer('k', { currentTime: 11 }, visto) === true && s.get('k').currentTime === 11, '');
  const visto2 = s.get('k').updatedAt;
  agora += 5;
  s.save('k', { currentTime: 50 }); // o teatro grava DEPOIS
  confere('SAIR · outro player gravou DEPOIS: NÃO sobrescreve a posição mais nova', s.saveUnlessNewer('k', { currentTime: 11 }, visto2) === false && s.get('k').currentTime === 50, String(s.get('k').currentTime));
  confere('SAIR · nada visto ainda (null) grava', s.saveUnlessNewer('novo', { currentTime: 3 }, null) === true && s.get('novo').currentTime === 3, '');
  confere('SAIR · entrada que não existe grava mesmo com "visto"', s.saveUnlessNewer('outra', { currentTime: 4 }, 123) === true && s.get('outra').currentTime === 4, '');
  confere('SAIR · chave nula/vazia não grava', s.saveUnlessNewer(null, { currentTime: 1 }, null) === false && s.saveUnlessNewer('', { currentTime: 1 }, null) === false, '');
  confere('SAIR · gravação no MESMO instante do visto ainda vale (não é "mais nova")', (() => { const t = s.get('k').updatedAt; return s.saveUnlessNewer('k', { currentTime: 60 }, t) === true && s.get('k').currentTime === 60; })(), '');
}

// ───────── a fila do teatro de vídeo (modo imersivo) ─────────
const V = (url) => ({ type: 'video', url });
const I = (url) => ({ type: 'image', url });
const P = (id, media, extra = {}) => ({ id, media, ...extra });
const A22 = '/m/aaaaaaaaaaaaaaaaaaaaaa';
{
  const posts = [
    P('a', [I('https://x.test/a.jpg'), V('https://x.test/a1.mp4'), V(A22)]),
    P('b', [I('https://x.test/b.jpg')]),
    P('c', [V('https://x.test/c.mp4?v=1#t')]),
  ];
  const q = buildVideoQueue(posts);
  confere('FILA · um vídeo por entrada, na ordem, ignorando imagens', q.length === 3 && q[0].key === 'a:1' && q[1].key === 'a:2' && q[2].key === 'c:0', JSON.stringify(q.map((e) => e.key)));
  confere('FILA · a entrada guarda o post, o índice da mídia e o endereço', q[0].postId === 'a' && q[0].mediaIndex === 1 && q[0].url === 'https://x.test/a1.mp4' && q[0].post === posts[0], '');
  confere('FILA · aceita endereço relativo próprio (/m/...) mas NÃO o protocolo-relativo (//host)', buildVideoQueue([P('r', [V('/m/abc'), V('//evil.test/x.mp4')])]).length === 1, '');
  for (const [nome, post] of [['apagado', P('d', [V('https://x.test/d.mp4')], { isDeleted: true })], ['com aviso de conteúdo sensível', P('s', [V('https://x.test/s.mp4')], { sensitive: true })], ['sem id', P('', [V('https://x.test/n.mp4')])], ['com id inválido', P(42, [V('https://x.test/n.mp4')])], ['sem mídia', P('m', null)], ['com mídia que não é lista', P('m2', 'video')]]) {
    confere(`FILA · post ${nome} fica de fora`, buildVideoQueue([post]).length === 0, '');
  }
  for (const ruim of [{ type: 'video', url: '' }, { type: 'video', url: 42 }, { type: 'video' }, { type: 'video', url: 'javascript:alert(1)' }, { type: 'video', url: 'data:video/mp4;base64,AAAA' }, { type: 'video', url: 'ftp://x.test/a.mp4' }, null, undefined, { type: 'video', url: 'https://x.test/' + 'a'.repeat(2100) }]) {
    confere(`FILA · mídia inválida ${String(JSON.stringify(ruim)).slice(0, 36)} fica de fora`, buildVideoQueue([P('z', [ruim])]).length === 0, '');
  }
  confere('FILA · o mesmo post duas vezes na lista (ex.: repost) conta uma vez', buildVideoQueue([posts[2], posts[2]]).length === 1, '');
  confere('FILA · lista nula/indefinida/que não é lista → vazia', buildVideoQueue(null).length === 0 && buildVideoQueue(undefined).length === 0 && buildVideoQueue('x').length === 0, '');
  confere('FILA · null dentro da lista é ignorado', buildVideoQueue([null, undefined, posts[2]]).length === 1, '');
  const muitos = Array.from({ length: QUEUE_MAX_ENTRIES + 30 }, (_, i) => P(`p${i}`, [V(`https://x.test/${i}.mp4`)]));
  confere(`FILA · no máximo ${QUEUE_MAX_ENTRIES} entradas`, buildVideoQueue(muitos).length === QUEUE_MAX_ENTRIES, String(buildVideoQueue(muitos).length));
  confere('FILA · urlBase ignora ? e #', urlBase('https://x.test/a.mp4?v=1#t') === 'https://x.test/a.mp4' && urlBase(null) === '' && urlBase(5) === '', '');

  confere('INÍCIO · o vídeo exato (post + arquivo)', findStartIndex(q, 'a', 'https://x.test/a1.mp4') === 0 && findStartIndex(q, 'a', A22) === 1, `${findStartIndex(q, 'a', 'https://x.test/a1.mp4')} ${findStartIndex(q, 'a', A22)}`);
  confere('INÍCIO · o mesmo arquivo com ?versão diferente ainda é achado', findStartIndex(q, 'c', 'https://x.test/c.mp4?v=99') === 2, String(findStartIndex(q, 'c', 'https://x.test/c.mp4?v=99')));
  confere('INÍCIO · sem o arquivo (ou arquivo desconhecido) cai no primeiro vídeo do post', findStartIndex(q, 'a') === 0 && findStartIndex(q, 'a', 'https://x.test/outro.mp4') === 0, '');
  confere('INÍCIO · post que não está na fila (ou sem id) → -1', findStartIndex(q, 'zzz') === -1 && findStartIndex(q, null) === -1 && findStartIndex(q, '') === -1 && findStartIndex([], 'a') === -1, '');
}
confere('PASSO · avança e volta', stepIndex(2, 1, 5) === 3 && stepIndex(2, -1, 5) === 1, '');
confere('PASSO · não dá a volta: no último fica, no primeiro fica', stepIndex(4, 1, 5) === 4 && stepIndex(0, -1, 5) === 0, '');
confere('PASSO · pulo grande trava nas pontas', stepIndex(1, 99, 5) === 4 && stepIndex(3, -99, 5) === 0, '');
confere('PASSO · fila vazia/inválida → 0; atual/delta inválidos viram 0', stepIndex(3, 1, 0) === 0 && stepIndex(3, 1, -2) === 0 && stepIndex(NaN, 1, 5) === 1 && stepIndex(2, NaN, 5) === 2, `${stepIndex(NaN, 1, 5)} ${stepIndex(2, NaN, 5)}`);
confere('PASSO · fracionário é truncado', stepIndex(1.9, 1.9, 5) === 2, String(stepIndex(1.9, 1.9, 5)));
const lista = (s) => [...s].sort((a, b) => a - b).join(',');
confere('JANELA · ativo no meio: ele e um vizinho de cada lado', lista(windowIndexes(5, 10, 1)) === '4,5,6', lista(windowIndexes(5, 10, 1)));
confere('JANELA · no começo e no fim não passa das pontas', lista(windowIndexes(0, 10, 1)) === '0,1' && lista(windowIndexes(9, 10, 1)) === '8,9', `${lista(windowIndexes(0, 10, 1))} | ${lista(windowIndexes(9, 10, 1))}`);
confere('JANELA · raio 0 é só o ativo; raio maior alarga', lista(windowIndexes(5, 10, 0)) === '5' && lista(windowIndexes(5, 10, 2)) === '3,4,5,6,7', '');
confere('JANELA · fila vazia → vazia; ativo fora da faixa é puxado para dentro', windowIndexes(0, 0).size === 0 && lista(windowIndexes(99, 4, 1)) === '2,3', lista(windowIndexes(99, 4, 1)));
for (const [n, esperado] of [[0, '0'], [7, '7'], [999, '999'], [1000, '1 mil'], [1234, '1,2 mil'], [2300, '2,3 mil'], [9999, '9,9 mil'], [10000, '10 mil'], [15400, '15 mil'], [999999, '999 mil'], [1000000, '1 mi'], [1250000, '1,2 mi'], [-5, '0'], [NaN, '0'], [Infinity, '0'], [null, '0'], ['12', '0'], [12.9, '12']]) {
  confere(`CONTADOR · ${String(n)} → ${esperado}`, compactCount(n) === esperado, compactCount(n));
}
{
  let t = 50_000_000;
  const m = createQueueMemory(() => t);
  const posts = [P('a', []), P('b', [])];
  confere('MEMÓRIA DA FILA · vazia: nada a lembrar', m.recall('a') === null, '');
  m.remember('explore', posts);
  const r = m.recall('a');
  confere('MEMÓRIA DA FILA · lembra a lista e o contexto quando o post está nela', r !== null && r.context === 'explore' && r.posts === posts, '');
  confere('MEMÓRIA DA FILA · post que NÃO está na lista → null (a fila vira só o post)', m.recall('zzz') === null && m.recall(null) === null && m.recall('') === null, '');
  t += QUEUE_MEMORY_TTL_MS;
  confere('MEMÓRIA DA FILA · no limite de 30 min ainda vale', m.recall('a') !== null, '');
  t += 1;
  confere('MEMÓRIA DA FILA · passou de 30 min → esquece', m.recall('a') === null, '');
  m.remember('x', posts); m.remember('y', []);
  confere('MEMÓRIA DA FILA · lembrar uma lista vazia limpa a memória', m.recall('a') === null, '');
  m.remember('z', null);
  confere('MEMÓRIA DA FILA · lista nula não quebra', m.recall('a') === null, '');
  m.remember('w', posts); m.clear();
  confere('MEMÓRIA DA FILA · clear esquece', m.recall('a') === null, '');
}

// ───────── guardas no código-fonte ─────────
const lerSrc = (caminho) => readFileSync(new URL(`../src/${caminho}`, import.meta.url), 'utf8');
const codigo = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const controles = lerSrc('components/shared/HiperVersoVideoControls.tsx');
const player = lerSrc('components/shared/PlatformVideo.tsx');
const cartao = lerSrc('components/feed/PostCardContent.tsx');
const ctrlCodigo = codigo(controles);
const playerCodigo = codigo(player);
const cartaoCodigo = codigo(cartao);

confere('COR · a barra usa a cor da rede (bg-primary, text-primary, ring-primary, accent-primary)', ['bg-primary', 'hover:text-primary', 'ring-primary', 'accent-primary'].every((c) => ctrlCodigo.includes(c)), 'faltou uma classe da cor da rede');
confere('COR · nenhum azul/cinza fixo nos controles (nada de blue-/sky-/indigo-/hex/rgb/hsl literal)', !/\b(?:bg|text|border|ring|from|via|to|accent|fill|stroke)-(?:blue|sky|indigo|cyan|violet|slate|gray|zinc|neutral|stone)-\d{2,3}\b/.test(ctrlCodigo) && !/#[0-9a-fA-F]{3,8}\b/.test(ctrlCodigo) && !/\brgba?\(/.test(ctrlCodigo) && !/\bhsla?\(\s*\d/.test(ctrlCodigo), 'cor fixa nos controles');
confere('COR · o <video> sai sem controles nativos no player autoral (controls={false})', /<video[\s\S]*?controls=\{false\}/.test(playerCodigo), 'o player autoral voltou a mostrar os controles do navegador');
confere('PLAYER · só é autoral com `themed` E `controls` (mensagens, editor e grade seguem nativos)', /themed\s*&&\s*props\.controls/.test(playerCodigo), 'a condição themed && controls sumiu');
confere('PLAYER · só volta a TOCAR sozinho se pediram (autoplayOnResume === true) E foi deixado tocando há pouco (handoffPlaying)', /autoplayOnResume\s*===\s*true\s*&&\s*videoPlaybackStore\.handoffPlaying\(playbackKey\)/.test(playerCodigo) && /if\s*\(keepPlaying\)\s*void\s+video\.play\(\)/.test(playerCodigo), 'o vídeo voltaria a tocar sozinho em qualquer retomada');
confere('PLAYER · o ramo não autoral continua o <video> de sempre', /return\s*<video\s+src=\{src\}\s+className=\{cn\(FULLSCREEN_VIDEO,\s*className\)\}\s*\{\.\.\.props\}\s*\/>/.test(playerCodigo), 'o ramo nativo mudou');
confere('PLAYER · retoma ao carregar os metadados e guarda o ponto ao pausar/sair', /loadedmetadata/.test(playerCodigo) && /videoPlaybackStore\.resumePoint/.test(playerCodigo) && /videoPlaybackStore\.save/.test(playerCodigo), 'sem restauração/gravação do ponto');
confere('PLAYER · o `pause` causado por sair da tela não vira "estava pausado" (isConnected)', /isConnected/.test(playerCodigo), 'a guarda isConnected sumiu');
confere('PLAYER · clique na superfície não vaza para o cartão (stopPropagation)', /event\.stopPropagation\(\)/.test(playerCodigo), 'o clique no vídeo passaria para o cartão');
confere('PLAYER · sem `onSurfaceClick` o clique pausa/reproduz', /video\.paused\s*\|\|\s*video\.ended/.test(playerCodigo) && /video\.pause\(\)/.test(playerCodigo), 'o clique deixou de pausar/reproduzir');

// Cada <PlatformVideo ... /> inteiro (o `=>` do onClick impede um `[^>]*` simples).
const videosDoCartao = cartaoCodigo.match(/<PlatformVideo\b[\s\S]*?\/>/g) ?? [];
const autorais = videosDoCartao.filter((v) => /\bthemed\b/.test(v) && /playbackKey=\{playbackKey\(post\.id,\s*mediaItem\.url\)\}/.test(v) && /\bcontrols\b/.test(v));
confere('FEED · o cartão tem 2 vídeos e os DOIS usam o player autoral com a chave do post', videosDoCartao.length === 2 && autorais.length === 2, `vídeos: ${videosDoCartao.length}, autorais com chave: ${autorais.length}`);
confere('FEED · os dois vídeos usam o mesmo tratador do toque na superfície', (cartaoCodigo.match(/onSurfaceClick=\{surfaceHandler\(mediaItem\.url\)\}/g) ?? []).length === 2, 'um dos vídeos perdeu o toque na superfície');
confere('FEED · na PÁGINA DO POST o "segundo toque" abre o teatro (e só se o vídeo puder entrar nele)', /if\s*\(isSinglePostView\)\s*return\s+elegivel\s*\?\s*\(\)\s*=>\s*void\s+openTheater\(mediaUrl\)\s*:\s*undefined;/.test(cartaoCodigo), 'a página do post não abre o teatro (ou abriria conteúdo sensível)');
confere('FEED · na aba MÍDIA do perfil o toque abre o teatro ali mesmo', /queueSource\?\.context\s*===\s*PROFILE_MEDIA_CONTEXT\s*&&\s*openTheater\(mediaUrl\)/.test(cartaoCodigo), 'a aba Mídia não abre o teatro');
confere('FEED · nas outras listas o toque lembra a lista e abre o post (o teatro usa essa lista na página do post)', /videoQueueMemory\.remember\(\s*queueSource\?\.context\s*\?\?\s*'feed'/.test(cartaoCodigo) && /videoQueueMemory\.recall<Post>\(post\.id\)/.test(cartaoCodigo), 'a fila do feed não é lembrada');
confere('FEED · conteúdo sensível ou apagado nunca entra no teatro', /post\.sensitive\s*!==\s*true\s*&&\s*post\.isDeleted\s*!==\s*true/.test(cartaoCodigo), 'o teatro poderia exibir conteúdo sensível sozinho');
confere('FEED · com o teatro aberto os players do cartão ficam suspensos, e ao fechar são remontados para reler a posição', (cartaoCodigo.match(/suspended=\{theater\s*!==\s*null\}/g) ?? []).length === 2 && (cartaoCodigo.match(/key=\{`\$\{mediaItem\.url\}:\$\{videoEpoch\}`\}/g) ?? []).length === 2 && /setVideoEpoch\(\(e\)\s*=>\s*e\s*\+\s*1\)/.test(cartaoCodigo), 'dois players tocariam juntos, ou o vídeo de baixo não acompanharia o teatro');
confere('FEED · o teatro só é baixado quando alguém abre um (dynamic, sem SSR)', /dynamic\(\(\)\s*=>\s*import\('@\/components\/shared\/theater\/HiperVersoVideoTheater'\),\s*\{\s*ssr:\s*false\s*\}\)/.test(cartaoCodigo), 'o teatro pesaria em todo feed');
confere('FEED · só a PÁGINA DO POST continua tocando sozinha (autoplayOnResume={isSinglePostView}) nos dois vídeos', (cartaoCodigo.match(/autoplayOnResume=\{isSinglePostView\}/g) ?? []).length === 2, 'o feed voltaria a tocar vídeos sozinho (áudio inesperado ao voltar do post)');
confere('FEED · abre pela rota do post no idioma atual', /router\.push\(`\/\$\{locale\}\/post\/\$\{post\.id\}`\)/.test(cartaoCodigo), 'rota do post errada');

for (const [arquivo, motivo] of [['components/messages/MessageBubble.tsx', 'mensagens'], ['components/shared/MediaGrid.tsx', 'grade de mídia'], ['components/feed/EditPostDialogContent.tsx', 'edição do post'], ['components/editor/VideoNodeView.tsx', 'editor']]) {
  let texto = null;
  try { texto = codigo(lerSrc(arquivo)); } catch { /* tratado abaixo */ }
  if (texto === null) { confere(`NATIVO · ${motivo}: o arquivo existe`, false, `${arquivo} não foi encontrado (renomeado? atualize a guarda)`); continue; }
  const usos = texto.match(/<PlatformVideo\b[\s\S]*?\/>/g) ?? [];
  confere(`NATIVO · ${motivo} segue com o player nativo (sem \`themed\`)`, !usos.some((v) => /\bthemed\b/.test(v)), `${arquivo} passou a usar o player autoral sem combinar`);
}

// ───────── o player no teatro ─────────
confere('PLAYER · quem sai não apaga a posição mais nova (saveUnlessNewer) e o player SUSPENSO não grava', /videoPlaybackStore\.saveUnlessNewer\(/.test(playerCodigo) && /if\s*\(!video\s*\|\|\s*!playbackKey\s*\|\|\s*suspendedRef\.current\)\s*return;/.test(playerCodigo), 'o player de baixo apagaria a posição do teatro');
confere('PLAYER · `active` manda: o ativo toca e os outros pausam', /if\s*\(active\)\s*void\s+video\.play\(\)\.catch\(\(\)\s*=>\s*undefined\);\s*else\s+video\.pause\(\);\s*\}, \[active\]\);/.test(playerCodigo), 'o teatro não controlaria o play/pause');

// ───────── o teatro de vídeo (modo imersivo) ─────────
const teatro = codigo(lerSrc('components/shared/theater/HiperVersoVideoTheater.tsx'));
const trilho = codigo(lerSrc('components/shared/theater/TheaterActionRail.tsx'));
const gaveta = codigo(lerSrc('components/shared/theater/TheaterCommentsSheet.tsx'));
const feedLista = codigo(lerSrc('components/feed/FeedList.tsx'));
const contexto = codigo(lerSrc('contexts/VideoQueueContext.tsx'));
const todosTeatro = `${teatro}\n${trilho}\n${gaveta}`;

confere('TEATRO · botão VOLTAR sempre na tela, no canto superior esquerdo', /aria-label="Voltar"/.test(teatro) && /data-testid="theater-back"/.test(teatro) && /absolute left-3 top-\[max\(0\.75rem,env\(safe-area-inset-top\)\)\]/.test(teatro) && /onClick=\{\(\)\s*=>\s*onCloseRef\.current\(\)\}/.test(teatro), 'o teatro ficou sem botão de voltar');
confere('TEATRO · o "voltar" do navegador/Android fecha o teatro (entrada no histórico + popstate)', /history\.pushState\(/.test(teatro) && /addEventListener\('popstate'/.test(teatro) && /history\.back\(\)/.test(teatro), 'o botão voltar do aparelho fecharia a página de baixo');
confere('TEATRO · Esc fecha (primeiro login/gaveta, depois o teatro) sem atrapalhar a tela cheia', /e\.key\s*===\s*'Escape'/.test(teatro) && /document\.fullscreenElement/.test(teatro), 'Esc não fecha o teatro');
confere('TEATRO · ↑/↓ e PageUp/PageDown andam na fila, em fase de captura (ganham do volume do player)', /ArrowDown/.test(teatro) && /ArrowUp/.test(teatro) && /PageDown/.test(teatro) && /PageUp/.test(teatro) && /addEventListener\('keydown',\s*aoTeclar,\s*true\)/.test(teatro), 'as setas não andariam na fila');
confere('TEATRO · não rouba as teclas de quem digita (campo de comentário)', /TEXTAREA/.test(teatro) && /isContentEditable/.test(teatro), 'digitar um comentário viraria navegação');
confere('TEATRO · rolagem vertical com encaixe (um vídeo por tela)', /snap-y snap-mandatory/.test(teatro) && /snap-start/.test(teatro) && /h-\[100dvh\]/.test(teatro), 'a fila não rola de um em um');
confere('TEATRO · vídeo limpo (object-contain), em loop; só o ATIVO toca', /className="h-full w-full object-contain"/.test(teatro) && /\bloop\b/.test(teatro) && /active=\{i\s*===\s*active\}/.test(teatro), 'o vídeo cortaria as bordas, ou todos tocariam juntos');
confere('TEATRO · só o ativo e os vizinhos montam o <video> (fila de 200 não pesa)', /windowIndexes\(active,\s*total,\s*1\)/.test(teatro) && /janela\.has\(i\)/.test(teatro), 'todos os vídeos da fila ficariam montados');
confere('TEATRO · cliques e teclas do teatro não sobem para o cartão (que navegaria ao ser tocado)', /onClick=\{\(e\)\s*=>\s*e\.stopPropagation\(\)\}/.test(teatro) && /onKeyDown=\{\(e\)\s*=>\s*e\.stopPropagation\(\)\}/.test(teatro), 'tocar no teatro abriria o post por baixo');
confere('TEATRO · a página de baixo não rola enquanto está aberto, e o valor anterior é restaurado', /document\.body\.style\.overflow\s*=\s*'hidden'/.test(teatro) && /document\.body\.style\.overflow\s*=\s*anterior/.test(teatro), 'a página rolaria por baixo do teatro');
confere('TEATRO · abre já no vídeo certo, antes da primeira pintura', /useLayoutEffect/.test(teatro) && /el\.scrollTop\s*=\s*inicio\s*\*\s*el\.clientHeight/.test(teatro), 'o teatro piscaria o primeiro vídeo da fila');
confere('TEATRO · o som escolhido vale para os próximos vídeos da fila', /soundRef/.test(teatro) && /onVolumeChange=\{lembrarSom\}/.test(teatro), 'quem silenciou um vídeo ouviria o seguinte');
confere('TEATRO · cor da rede: nenhuma matiz fixa nem hex nos três arquivos do teatro', !/\b(?:bg|text|border|ring|from|via|to|accent|fill|stroke)-(?:blue|sky|indigo|cyan|violet|slate|gray|zinc|neutral|stone|red|green|pink|purple|yellow|orange|teal|emerald|rose|fuchsia|lime|amber)-\d{2,3}\b/.test(todosTeatro) && !/#[0-9a-fA-F]{3,8}\b/.test(todosTeatro) && /bg-primary/.test(trilho) && /text-primary/.test(trilho), 'cor fixa no teatro');
for (const nome of ['Curtir', 'Comentários', 'Repostar', 'Salvar', 'Velocidade de reprodução']) {
  confere(`AÇÕES · o ícone "${nome}" existe com nome acessível`, trilho.includes(`'${nome}'`) || trilho.includes(`"${nome}"`), 'ícone ausente');
}
confere('AÇÕES · reaproveitam os motores do cartão (curtir/repostar/salvar e seguir respondem na hora)', /usePostMainInteractions\(/.test(trilho) && /useFollowToggle\(/.test(trilho) && /interactions\.handleLikePost/.test(trilho) && /interactions\.handleRepostToggle/.test(trilho) && /interactions\.handleBookmarkPost/.test(trilho), 'o teatro reimplementaria as interações');
confere('AÇÕES · sem login pedem login em vez de falhar calados', /onNeedLogin\('seguir'\)/.test(trilho) && /role="alertdialog"/.test(teatro) && /openLoginPrompt:\s*onNeedLogin/.test(trilho), 'sem login o toque não faria nada');
confere('AÇÕES · velocidades de reprodução oferecidas', /PLAYBACK_SPEEDS\s*=\s*\[0\.5,\s*0\.75,\s*1,\s*1\.25,\s*1\.5,\s*2\]/.test(trilho), 'faltam velocidades');
confere('COMENTÁRIOS · a gaveta usa os MESMOS serviços da página do post (ler e gravar)', /from '@\/lib\/services\/comments\/commentReadService'/.test(gaveta) && /getCommentsForPost\(/.test(gaveta) && /from '@\/lib\/services\/comments\/commentWriteActions'/.test(gaveta) && /addCommentToPost\(/.test(gaveta) && /canUserReplyToLoadedPost\(/.test(gaveta), 'a gaveta usaria outro caminho de gravação');
confere('COMENTÁRIOS · Enter envia e Shift+Enter quebra a linha (sem enviar durante a composição do teclado)', /e\.key\s*===\s*'Enter'\s*&&\s*!e\.shiftKey\s*&&\s*!e\.nativeEvent\.isComposing/.test(gaveta), 'Enter não envia, ou envia no meio da composição');
confere('COMENTÁRIOS · a gaveta é própria (diálogos do app abririam ATRÁS do teatro) e tem saída para o post', /role="dialog"/.test(gaveta) && /Abrir o post/.test(gaveta), 'a gaveta não se sustenta por cima do teatro');
confere('FILA · o FeedList entrega a lista por um contexto ESTÁVEL (não redesenha os cartões a cada página)', /VideoQueueContext\.Provider/.test(feedLista) && /useMemo<VideoQueueSource>\(/.test(feedLista) && /\[queueContext\]\s*,?\s*\)/.test(feedLista) && /queuePostsRef\.current\s*=/.test(feedLista) && /getPosts:\s*\(\)\s*=>\s*queuePostsRef\.current/.test(feedLista), 'o contexto mudaria a cada página e redesenharia todos os cartões');
confere('FILA · a aba Mídia do perfil se identifica como profile_media', /PROFILE_MEDIA_CONTEXT\s*=\s*'profile_media'/.test(contexto), 'o contexto da aba Mídia mudou');

console.log(`\n${total - falhas}/${total} verificações passaram.`);
if (falhas) {
  console.log(`${falhas} FALHA(S).`);
  process.exit(1);
}
