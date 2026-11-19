#!/usr/bin/env node
/**
 * A conta da altura da tela de conversa:
 *   node e2e/altura-conversa-check.mjs        (ou: npm run e2e:altura)
 *
 * O que está em jogo: a área de conversa tem altura FIXA (ela não rola a página; quem rola é a lista de mensagens por
 * dentro). Essa altura é "a tela menos a moldura": menos o cabeçalho que fica em cima, menos a barra de abas que fica
 * por cima do rodapé. Quando esses dois números são copiados à mão para dentro de um `calc()`, basta a moldura mudar
 * em um lugar para sobrar — ou faltar — espaço no outro: foi exatamente assim que nasceu a faixa vazia entre o
 * compositor e o teclado (descontava 48px de cabeçalho + 56px de abas que já tinham saído de cena dentro da conversa).
 *
 * Então aqui não se testa aparência: testa-se que a conta existe UMA vez só, que quem monta a moldura declara a
 * própria altura, e que os números em arquivos diferentes continuam combinando entre si.
 *
 * Sai com código 1 se algo falhar.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = (caminho) => readFileSync(join(raiz, caminho), 'utf8');

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

const css = ler('src/app/globals.css');
const layoutMensagens = ler('src/app/[locale]/messages/layout.tsx');
const esqueleto = ler('src/app/[locale]/messages/loading.tsx');
const appLayout = ler('src/components/layout/AppLayout.tsx');
const shellChat = ler('src/components/layout/HiperChatShell.tsx');
const barraAbas = ler('src/components/layout/MobileBottomNavigationBar.tsx');
const cabecalho = ler('src/components/layout/AppHeader.tsx');
const compositor = ler('src/components/messages/MessageInputArea.tsx');
const layoutLocale = ler('src/app/[locale]/layout.tsx');
const manifesto = ler('android/app/src/main/AndroidManifest.xml');

/** O trecho de CSS de um seletor (até a primeira chave de fechamento). */
const regraDe = (seletor) => {
  const i = css.indexOf(seletor);
  if (i < 0) return '';
  const abre = css.indexOf('{', i);
  const fecha = css.indexOf('}', abre);
  return abre < 0 || fecha < 0 ? '' : css.slice(abre + 1, fecha);
};

// ───────────────────────── A conta mora num lugar só ─────────────────────────
const definicoes = css.split('.altura-da-conversa').length - 1;
confere('CONTA · a classe da altura é definida no CSS', definicoes >= 1, 'não encontrei .altura-da-conversa');
confere(
  'CONTA · definida uma vez só (duas definições voltam a divergir)',
  definicoes === 1,
  `${definicoes} ocorrências em globals.css`,
);

const regraAltura = regraDe('.altura-da-conversa');
confere(
  'CONTA · desconta a moldura pelas variáveis, não por número escrito à mão',
  regraAltura.includes('var(--chat-chrome-top') && regraAltura.includes('var(--chat-chrome-bottom'),
  regraAltura.trim(),
);
confere(
  'CONTA · tem reserva em svh para quem não conhece dvh',
  (regraAltura.match(/height:/g) || []).length === 2 &&
    regraAltura.includes('100svh') &&
    regraAltura.includes('100dvh'),
  'faltou uma das duas declarações de height',
);
confere(
  'CONTA · a declaração que vale (a última) é a dvh, que acompanha teclado e barra do navegador',
  regraAltura.lastIndexOf('100dvh') > regraAltura.lastIndexOf('100svh'),
  'svh ficou por último e o teclado volta a cobrir o compositor',
);

// Ninguém mais pode calcular essa altura por fora: era a origem do bug.
const contaAMao = /100[sd]?vh\s*-\s*var\(--header-height/;
for (const [nome, fonte] of [
  ['tela de Mensagens', layoutMensagens],
  ['esqueleto de carregamento', esqueleto],
  ['HiperChatShell', shellChat],
  ['AppLayout', appLayout],
]) {
  confere(
    `CONTA · ${nome} não refaz a conta à mão`,
    !contaAMao.test(fonte),
    'voltou a descontar a moldura dentro do próprio arquivo',
  );
}

confere(
  'CONTA · a tela de Mensagens usa a classe compartilhada',
  layoutMensagens.includes('altura-da-conversa'),
  'não usa',
);
confere(
  'CONTA · o esqueleto de carregamento usa A MESMA classe (senão a tela pula ao carregar)',
  esqueleto.includes('altura-da-conversa'),
  'o esqueleto tem altura própria',
);

// ───────────────────────── Quem monta a moldura declara o que ocupa ─────────────────────────
confere(
  'MOLDURA · o padrão é cabeçalho do app + barra de abas do celular',
  /--chat-chrome-top:\s*var\(--header-height\)/.test(css) && /--chat-chrome-bottom:\s*3\.5rem/.test(css),
  'o padrão de :root mudou',
);
confere(
  'MOLDURA · a partir de 800px não há barra de abas',
  /@media \(min-width: 800px\)[\s\S]{0,160}--chat-chrome-bottom:\s*0px/.test(css),
  'continua descontando abas no desktop',
);

const regraConversa = regraDe("[data-hv-chat='conversa']");
confere(
  'HIPERCHAT · dentro da conversa a moldura inteira vale ZERO (é daí que vinha a faixa vazia)',
  /--chat-chrome-top:\s*0px/.test(regraConversa) && /--chat-chrome-bottom:\s*0px/.test(regraConversa),
  regraConversa.trim() || 'regra ausente',
);
confere(
  'HIPERCHAT · a conversa marca a si mesma com data-hv-chat="conversa"',
  shellChat.includes('data-hv-chat="conversa"'),
  'o atributo sumiu do shell e a regra do CSS nunca pega',
);
confere(
  'HIPERCHAT · a conversa ocupa a tela visível inteira, sem rolagem de página',
  shellChat.includes('h-[100dvh]') && shellChat.includes('overflow-hidden'),
  'voltou a usar só min-h-screen, que mede a tela sem a barra do navegador',
);
confere(
  'HIPERCHAT · a moldura normal se marca com data-hv-chat="moldura"',
  shellChat.includes('data-hv-chat="moldura"'),
  'o atributo sumiu',
);

// Os números que vivem em arquivos diferentes precisam combinar.
const regraMoldura = regraDe("[data-hv-chat='moldura']");
confere(
  'HIPERCHAT · a altura das abas no CSS bate com a altura das abas no shell (4.25rem)',
  /--chat-chrome-bottom:\s*4\.25rem/.test(regraMoldura) &&
    shellChat.includes('h-[4.25rem]') &&
    shellChat.includes('pb-[4.25rem]'),
  'CSS e shell discordam da altura da barra de abas',
);
confere(
  'HIPERCHAT · o cabeçalho próprio (h-14) é descontado como 3.5rem',
  /--chat-chrome-top:\s*3\.5rem/.test(regraMoldura) && shellChat.includes('h-14'),
  'o desconto do cabeçalho não bate com a altura dele',
);

confere(
  'HIPERVERSO · a conversa aberta se marca com data-hv-conversa',
  appLayout.includes("data-hv-conversa={emConversaAberta ? 'aberta' : undefined}"),
  'o atributo sumiu do AppLayout',
);
confere(
  'HIPERVERSO · no celular, a conversa aberta não desconta mais as abas (elas saem de cena)',
  /@media \(max-width: 799px\)[\s\S]{0,160}\[data-hv-conversa='aberta'\][\s\S]{0,80}--chat-chrome-bottom:\s*0px/.test(css),
  'a regra sumiu e a faixa vazia volta no HiperVerso',
);
confere(
  'HIPERVERSO · a barra de abas continua tendo 3.5rem (h-14), como o desconto padrão supõe',
  barraAbas.includes('h-14'),
  'mudou a altura das abas sem mudar --chat-chrome-bottom',
);
confere(
  'HIPERVERSO · o cabeçalho continua h-12/sm:h-14, como --header-height supõe (48px/56px)',
  cabecalho.includes('h-12') && cabecalho.includes('sm:h-14') &&
    /--header-height:\s*48px/.test(css) && /--header-height:\s*56px/.test(css),
  'cabeçalho e variável se desencontraram',
);
confere(
  'HIPERVERSO · nenhum aviso extra entra na conversa (empurraria o compositor para fora da tela)',
  /!emConversaAberta/.test(appLayout.slice(Math.max(0, appLayout.indexOf('Confirme seu e-mail') - 500), appLayout.indexOf('Confirme seu e-mail'))),
  'o aviso de e-mail voltou a aparecer dentro da conversa',
);
confere(
  'HIPERVERSO · a conversa aberta no celular tem altura exata, sem min-h-screen por cima',
  appLayout.includes('max-[799px]:h-[100dvh]') && appLayout.includes('max-[799px]:min-h-0'),
  'min-height da tela cheia venceria a altura exata e sobraria faixa',
);

// ───────────────────────── O compositor ─────────────────────────
confere(
  'COMPOSITOR · nunca é espremido quando a tela encolhe com o teclado',
  compositor.includes('shrink-0'),
  'sem shrink-0 o compositor pode encolher no lugar da lista',
);
confere(
  'COMPOSITOR · respeita a faixa de gestos do aparelho',
  compositor.includes('env(safe-area-inset-bottom)'),
  'o botão de enviar encosta na barra de gestos',
);

// ───────────────────────── O teclado ─────────────────────────
confere(
  'TECLADO · no navegador, o teclado encolhe a página em vez de cobri-la',
  /interactiveWidget:\s*'resizes-content'/.test(layoutLocale),
  'sem isso o compositor fica atrás do teclado no navegador',
);
confere(
  'TECLADO · no app Android, a janela é redimensionada (adjustResize)',
  manifesto.includes('android:windowSoftInputMode="adjustResize"'),
  'com adjustPan o teclado passa por cima do compositor',
);

console.log('');
console.log(`${total} verificações.`);
if (falhas) {
  console.log(`${falhas} falha(s).`);
  process.exit(1);
}
console.log('Altura OK: a conta mora num lugar só, quem monta a moldura declara o que ocupa e os números batem entre si.');
