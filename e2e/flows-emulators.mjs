#!/usr/bin/env node
/**
 * Fluxos restantes do SOBERAN contra os EMULADORES do Firebase, com dados descartáveis e interface real.
 *
 * Seções (E2E_ONLY=chave1,chave2 roda só algumas): social, interacoes, mensagens, artigos, midia, autorizacao,
 * composicao, entrada, opcoes, resposta, seguir, vibracao, gestos, rolagem, previa, notificacoes, perfil, cadastro.
 *   social       seguir/deixar de seguir, curtir/descurtir, repostar/desfazer, comentários, notificações e contadores
 *   interacoes   repostar/citar post e comentário, responder, mencionar, salvar, cada um com a sua notificação, e o
 *                mesmo conjunto num perfil privado (quem segue faz tudo; quem não segue é recusado)
 *   mensagens    mensagens privadas entre duas contas, não lidas, e acesso indevido de uma terceira conta
 *   artigos      criar (a partir de uma URL de fixture local), ler e interagir
 *   midia        upload, leitura e exclusão no Storage (avatar, post, anexo de mensagem) e regras do Storage
 *   perfil       perfil, busca e configurações persistidas; sair da conta
 *   autorizacao  testes NEGATIVOS pela REST dos emuladores, com o token real de cada usuário
 *   composicao   modais de entrada (postar, comentar, responder, citar): imagem colada/anexada, múltiplas mídias,
 *                controles por toque, repetição de upload e preservação do conteúdo quando o envio falha
 *   entrada      fundo padrão preto, player único do YouTube, mídia por colar/arrastar e chat sem overflow/coluna lateral
 *   opcoes       emoji, município, enquete transacional e aviso de conteúdo sensível no compositor e no post
 *   rolagem      o feed num celular Android simulado: ouvintes passivos, começar o dedo em qualquer coisa só rola, o toque
 *                simples, puxar para atualizar e trocar de aba só com intenção clara, barras que somem ao rolar (por CSS) e
 *                orçamento de redesenhos (rolar, seguidor novo, notificação, mensagem e curtir não redesenham o feed)
 *   cadastro     limite dos primeiros usuários (vagas históricas) no servidor: 499/500 vagas, e-mail e Google, concorrência,
 *                regras contra a criação direta de perfil e idempotência do script de migração
 *   video        pipeline de vídeo sem o Cloud Run: início do envio, 425/422, regras do video_staging, gatilho e cancelamento
 *   fediverso    ativar com consentimento explicado, alcance no compositor, selo no post, moderação, pausar e desligar
 * Cada verificação confere o que a interface mostra E o que ficou gravado nos emuladores. Uma falha é registrada e o
 * teste continua; no fim sai a matriz (matrix.json / matrix.md em E2E_OUT) e o código de saída é 1 se algo falhou.
 *
 * Não dispara nada externo: sem tokens de push as Functions não chamam o FCM, e as Functions agendadas não rodam nos
 * emuladores. Pré-requisitos: `npm run emulators` e o app (build de produção ou `npm run dev -- -H localhost`) em modo
 * emulador na porta E2E_BASE_URL (padrão http://localhost:9002) com REVALIDATE_SECRET=local-only-secret.
 * Variáveis: E2E_NODE_MODULES, E2E_BROWSER, E2E_BASE_URL, E2E_OUT, E2E_RESET=1, E2E_ONLY.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  authAccounts,
  createRunner,
  emulatorsRunning,
  loadPlaywright,
  mapearMidiaPublicaParaLocal,
  matrixMarkdown,
  newUser,
  registerViaUi,
  resetEmulators,
  signInRest,
} from './lib/harness.mjs';

const BASE_URL = (process.env.E2E_BASE_URL ?? 'http://localhost:9002').replace(/\/+$/, '');
const ONLY = (process.env.E2E_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const stamp = Date.now().toString(36);
const outDir = path.resolve(process.env.E2E_OUT ?? path.join('e2e-output', `fluxos-${stamp}`));
mkdirSync(outDir, { recursive: true });

const runner = createRunner('fluxos');
const { log, check } = runner;

// "perfil" depois das demais seções que usam A: ela termina saindo da conta dessa pessoa.
// "cadastro" por último: mexe no documento de controle do limite de vagas (e o deixa coerente no fim).
const SECTIONS = ['social', 'interacoes', 'mensagens', 'artigos', 'midia', 'video', 'conta', 'autorizacao', 'composicao', 'entrada', 'opcoes', 'resposta', 'seguir', 'vibracao', 'gestos', 'rolagem', 'previa', 'notificacoes', 'fediverso', 'perfil', 'cadastro'];
const selected = SECTIONS.filter((key) => ONLY.length === 0 || ONLY.includes(key));

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER, headless: true });

// Qualquer host real do Google/Firebase contatado pelo navegador significa que algo escapou dos emuladores.
const REAL = /(^|\.)(googleapis\.com|firebaseio\.com|firebaseapp\.com|cloudfunctions\.net|google-analytics\.com|googletagmanager\.com|googlesyndication\.com|doubleclick\.net|gstatic\.com|google\.com)$/;
const SDK_PROBE = /^https:\/\/www\.google\.com\/images\/cleardot\.gif\?zx=[a-z0-9]+$/;
// O cartão de prévia de um link mostra o favicon do site pelo serviço de favicons do Google (imagem inerte, parte do produto):
// o navegador pede essa imagem ao abrir uma prévia, e isso não é um endpoint do Firebase "escapando" dos emuladores.
const FAVICON_SERVICE = /^https:\/\/(www\.google\.com\/s2\/favicons\?|t\d\.gstatic\.com\/faviconV2\?)/;
const realRequests = [];
const pageErrors = new Map();

async function openUser(label) {
  const user = { ...newUser(label, stamp), label };
  user.context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', serviceWorkers: 'block' });
  // As URLs públicas de mídia gravadas nos posts são as de produção: o navegador de teste as busca no app local.
  await mapearMidiaPublicaParaLocal(user.context, BASE_URL);
  user.page = await user.context.newPage();
  user.page.setDefaultTimeout(60_000);
  user.page.on('request', (request) => {
    const { hostname } = new URL(request.url());
    if (REAL.test(hostname) && !SDK_PROBE.test(request.url()) && !FAVICON_SERVICE.test(request.url())) realRequests.push(request.url());
  });
  // Últimas mensagens de erro/aviso do console desta pessoa: quando uma verificação falha, o motivo costuma estar aqui.
  user.consoleLog = [];
  user.page.on('console', (message) => {
    if (!['error', 'warning'].includes(message.type())) return;
    user.consoleLog.push(`${message.type()}: ${String(message.text()).replace(/\s+/g, ' ').slice(0, 220)}`);
    if (user.consoleLog.length > 30) user.consoleLog.shift();
  });
  user.page.on('pageerror', (error) => {
    const key = `${label}: ${String(error.message).slice(0, 160)}`;
    pageErrors.set(key, (pageErrors.get(key) ?? 0) + 1);
  });
  return user;
}

const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
const ctx = { BASE_URL, runner, outDir, browser, stamp, shot, users: {}, token: null };
ctx.token = async (user) => (await signInRest(user.email, user.password)).idToken;
ctx.profileUrl = (user) => `${BASE_URL}/pt-BR/profile/${user.uid}`;

try {
  if (process.env.E2E_RESET === '1') {
    await resetEmulators();
    log('Dados dos emuladores zerados (E2E_RESET=1).');
  }
  await runner.step('pré-checagem: emuladores no ar e app respondendo', async () => {
    const running = await emulatorsRunning();
    const response = await fetch(`${BASE_URL}/pt-BR/login`);
    check(response.status === 200, `/pt-BR/login retornou HTTP ${response.status}`);
    return `emuladores: ${running.join(', ')}`;
  });

  // ---------- 3 usuários descartáveis, cadastrados pela interface real ----------
  runner.section('preparação');
  for (const label of ['a', 'b', 'c']) {
    const user = await openUser(label);
    ctx.users[label] = user;
    await runner.step(`cadastro pela interface do usuário ${label.toUpperCase()} (${user.username})`, async () => {
      await registerViaUi(user.page, BASE_URL, user);
      const account = (await authAccounts()).find((a) => a.email === user.email);
      check(account, 'conta não encontrada no Auth emulado');
      user.uid = account.localId;
      return `uid ${user.uid}`;
    });
  }

  for (const key of selected) {
    const module = await import(`./flows/${key}.mjs`);
    await module.run(ctx);
  }
} catch (error) {
  process.exitCode = 1;
  log(`interrompido: ${String(error?.message ?? error).split('\n')[0]}`);
} finally {
  runner.section('isolamento');
  await runner.soft('o navegador não falou com nenhum endpoint real do Google/Firebase', async () => {
    check(realRequests.length === 0, `requisições a hosts REAIS: ${[...new Set(realRequests)].slice(0, 5).join(' , ')}`);
    return 'nenhuma (exceto a sonda de conectividade do SDK, que é só um GIF)';
  });
  for (const user of Object.values(ctx.users)) await user.context?.close().catch(() => {});
  await browser.close();
  const results = runner.results;
  writeFileSync(path.join(outDir, 'matrix.json'), JSON.stringify({ stamp, baseUrl: BASE_URL, results, pageErrors: Object.fromEntries(pageErrors) }, null, 2));
  writeFileSync(path.join(outDir, 'matrix.md'), matrixMarkdown(results) + '\n');
  const count = (status) => results.filter((r) => r.status === status).length;
  log(`Resumo: ${count('passou')} passaram, ${count('falhou')} falharam, ${count('não implementado')} não implementados (${results.length} no total).`);
  if (pageErrors.size) {
    log('Erros de página (pageerror) vistos nos navegadores:');
    for (const [message, times] of pageErrors) log(`  ${times}x ${message}`);
  }
  log(process.exitCode ? 'RESULTADO: HÁ FALHAS (veja matrix.md)' : 'RESULTADO: PASSOU');
}
