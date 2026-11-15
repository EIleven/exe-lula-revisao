/**
 * Seção "fediverso": a interface do Fediverso de ponta a ponta, com navegador real contra os emuladores.
 *
 * Plataforma desligada (a tela só explica), consentimento claro ANTES de ativar, o endereço federado, o seletor de
 * alcance no compositor (padrão "só aqui"), o campo gravado no post e a tarefa enfileirada pela Function, o selo no post
 * federado, a moderação dos seguidores e dos bloqueios, e pausar/desligar com o seletor sumindo do compositor.
 *
 * Pré-requisito: o app precisa estar com AP_MASTER_KEY configurada (a ativação assina com a chave da conta).
 */
import { createHash } from 'node:crypto';
import { adminFind, adminGetDoc, eventually, fsDelete, fsSet } from '../lib/harness.mjs';

const dorme = (ms) => new Promise((res) => setTimeout(res, ms));
const sha = (t) => createHash('sha256').update(t).digest('hex');

export async function run(ctx) {
  const { runner, users, BASE_URL, stamp, shot } = ctx;
  const { a: A } = users;
  const { section, soft, check } = runner;
  const pagina = `${BASE_URL}/pt-BR/settings/fediverse`;

  section('fediverso: ativar, escolher o alcance, moderar, pausar e desligar');

  // Esta seção roda sozinha, com uma pessoa nova: o banner de cookies (parte de baixo da tela) cobriria os botões.
  // As outras seções já passaram por ele. Recusar tudo é a escolha que não grava nada além do necessário.
  await A.page.goto(BASE_URL + '/pt-BR', { waitUntil: 'domcontentloaded' });
  const recusar = A.page.getByRole('button', { name: 'Rejeitar tudo' });
  if (await recusar.waitFor({ timeout: 20_000 }).then(() => true, () => false)) await recusar.click();

  // O app guarda a configuração da casa em cache por 10 s: depois de mexer nela, espera.
  const configurar = async (dados) => {
    if (dados === null) await fsDelete('config/federation', 'owner');
    else await fsSet('config/federation', dados, 'owner');
    await dorme(11_000);
  };

  await soft('com a plataforma desligada a tela só explica: não há como ativar', async () => {
    await configurar(null);
    await A.page.goto(pagina, { waitUntil: 'domcontentloaded' });
    await A.page.getByText('ainda não está ligado nesta rede').waitFor({ timeout: 60_000 });
    check((await A.page.getByRole('button', { name: 'Ativar Fediverso' }).count()) === 0, 'o botão de ativar apareceu com a plataforma desligada');
    await shot(A.page, 'fediverso-01-plataforma-desligada');
  }, { tag: 'funcional' });

  await soft('o consentimento é explicado ANTES de ativar, e cancelar não ativa nada', async () => {
    await configurar({ enabled: true, killSwitch: false, mode: 'open' });
    await A.page.reload({ waitUntil: 'domcontentloaded' });
    await A.page.getByText('Antes de ativar, saiba o que muda').waitFor({ timeout: 60_000 });
    for (const trecho of ['Posts de antes da ativação nunca são enviados', 'não temos como garantir que todos obedeçam', 'Mensagens privadas, arquivos pessoais']) {
      check((await A.page.getByText(trecho, { exact: false }).count()) > 0, `a tela não diz: "${trecho}"`);
    }
    await shot(A.page, 'fediverso-02-antes-de-ativar');
    await A.page.getByRole('button', { name: 'Ativar Fediverso' }).click();
    const dialogo = A.page.getByRole('alertdialog');
    await dialogo.waitFor();
    check((await dialogo.innerText()).includes('fora do nosso controle'), 'a confirmação não avisa que as cópias saem do nosso controle');
    await dialogo.getByRole('button', { name: 'Cancelar' }).click();
    await dialogo.waitFor({ state: 'hidden' });
    const conta = await adminGetDoc(`users/${A.uid}/private/federation`);
    check(conta.status === 404, `cancelar gravou o estado da federação (HTTP ${conta.status})`);
  }, { tag: 'funcional' });

  let acct = null;
  await soft('ativar mostra o endereço federado e grava só o necessário (conta e handle reservado)', async () => {
    await A.page.getByRole('button', { name: 'Ativar Fediverso' }).click();
    await A.page.getByRole('alertdialog').getByRole('button', { name: 'Ativar', exact: true }).click();
    const campo = A.page.getByTestId('fediverse-acct');
    await campo.waitFor({ timeout: 60_000 });
    acct = (await campo.innerText()).trim();
    check(/^@[a-z0-9_]+@[a-z0-9.-]+\.[a-z]+$/.test(acct), `endereço fora do formato usuario@servidor: ${acct}`);
    const conta = await adminGetDoc(`users/${A.uid}/private/federation`);
    check(conta.doc?.enabled === true && conta.doc?.paused === false && typeof conta.doc?.eligibleSince === 'number', `estado gravado: ${JSON.stringify(conta.doc)}`);
    const handles = await adminFind('ap_handles', { uid: A.uid });
    check(handles.length === 1 && handles[0].state === 'active', `reserva do handle: ${JSON.stringify(handles.map((h) => [h.__id, h.state]))}`);
    check(acct.startsWith(`@${handles[0].__id}@`), `o endereço (${acct}) não bate com a reserva (${handles[0].__id})`);
    check(!JSON.stringify(handles[0]).includes('PRIVATE'), 'a reserva do handle contém chave privada');
    await shot(A.page, 'fediverso-03-ativo');
    return acct;
  }, { tag: 'funcional' });

  await soft('o painel ativo explica o que acontece e oferece pausar e desligar', async () => {
    const texto = await A.page.locator('body').innerText();
    check(texto.includes('Ativo'), 'o selo "Ativo" não aparece');
    check(texto.includes('Nenhum seguidor do Fediverso ainda'), 'a contagem de seguidores não aparece');
    check((await A.page.getByRole('button', { name: 'Pausar' }).count()) === 1 && (await A.page.getByRole('button', { name: 'Desligar' }).count()) === 1, 'faltam os botões Pausar/Desligar');
  }, { tag: 'funcional' });

  const publicar = async (texto, alcance) => {
    await A.page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await A.page.getByRole('button', { name: 'Postar', exact: true }).first().click();
    const dialog = A.page.getByRole('dialog');
    await dialog.waitFor();
    const gatilho = dialog.getByTestId('federation-reach-trigger');
    await gatilho.waitFor({ timeout: 60_000 });
    if (alcance) {
      await gatilho.click();
      await A.page.getByTestId(`federation-reach-${alcance}`).click();
      check((await A.page.getByTestId(`federation-reach-${alcance}`).getAttribute('aria-checked')) === 'true', `a opção ${alcance} não ficou marcada`);
      await A.page.keyboard.press('Escape');
    }
    await dialog.getByPlaceholder('E aí?').fill(texto);
    await dialog.getByRole('button', { name: 'Postar', exact: true }).click();
    await A.page.getByText('Post Enviado!').first().waitFor({ timeout: 90_000 });
    return eventually(
      async () => (await adminFind('posts', { userId: A.uid })).find((p) => String(p.text ?? '').includes(texto)),
      { label: `post com "${texto}"`, timeoutMs: 60_000 },
    );
  };

  let postLocal;
  let postFederado;
  const textoLocal = `Fediverso local ${stamp}`;
  const textoFed = `Fediverso publico ${stamp}`;

  await soft('o compositor oferece o alcance com "só aqui" como padrão; sem escolher, o post não leva o campo', async () => {
    await A.page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await A.page.getByRole('button', { name: 'Postar', exact: true }).first().click();
    const dialog = A.page.getByRole('dialog');
    await dialog.waitFor();
    const gatilho = dialog.getByTestId('federation-reach-trigger');
    await gatilho.waitFor({ timeout: 60_000 });
    check((await gatilho.innerText()).includes('Só aqui'), `o padrão do seletor não é "Só aqui": ${await gatilho.innerText()}`);
    await gatilho.click();
    for (const alcance of ['local', 'public', 'unlisted', 'followers']) {
      check((await A.page.getByTestId(`federation-reach-${alcance}`).count()) === 1, `falta a opção ${alcance}`);
    }
    check((await A.page.getByText('Outros servidores guardam uma cópia', { exact: false }).count()) === 0, 'o aviso de cópias apareceu com "só aqui" marcado');
    await shot(A.page, 'fediverso-04-seletor');
    await A.page.keyboard.press('Escape');
    await dialog.getByPlaceholder('E aí?').fill(textoLocal);
    await dialog.getByRole('button', { name: 'Postar', exact: true }).click();
    await A.page.getByText('Post Enviado!').first().waitFor({ timeout: 90_000 });
    postLocal = await eventually(async () => (await adminFind('posts', { userId: A.uid })).find((p) => String(p.text ?? '').includes(textoLocal)), { label: 'post local', timeoutMs: 60_000 });
    check(!('federation' in postLocal) || postLocal.federation === 'local', `o post local gravou federation=${postLocal.federation}`);
    await dorme(5000);
    const tarefas = await adminFind('ap_outbound', { postId: postLocal.__id });
    check(tarefas.length === 0, `o post local gerou ${tarefas.length} tarefa(s) de federação`);
  }, { tag: 'funcional' });

  await soft('escolher "Fediverso: público" mostra o aviso de cópias, grava o alcance e a Function enfileira o Create', async () => {
    postFederado = await publicar(textoFed, 'public');
    check(postFederado.federation === 'public', `federation gravado: ${postFederado.federation}`);
    const tarefas = await eventually(async () => {
      const t = await adminFind('ap_outbound', { postId: postFederado.__id });
      return t.length ? t : null;
    }, { label: 'tarefa de Create na fila', timeoutMs: 60_000 });
    check(tarefas.length === 1 && tarefas[0].op === 'create' && tarefas[0].uid === A.uid, `tarefas: ${JSON.stringify(tarefas.map((t) => [t.op, t.state]))}`);
  }, { tag: 'funcional' });

  await soft('o post federado mostra o selo; o local não', async () => {
    await A.page.goto(`${BASE_URL}/pt-BR/post/${postFederado.__id}`, { waitUntil: 'domcontentloaded' });
    const selo = A.page.getByTestId('federation-badge').first();
    await selo.waitFor({ timeout: 60_000 });
    check((await selo.getAttribute('aria-label')) === 'Enviado ao Fediverso (público)', `rótulo do selo: ${await selo.getAttribute('aria-label')}`);
    await shot(A.page, 'fediverso-05-selo');
    await A.page.goto(`${BASE_URL}/pt-BR/post/${postLocal.__id}`, { waitUntil: 'domcontentloaded' });
    await A.page.getByText(textoLocal).first().waitFor({ timeout: 60_000 });
    check((await A.page.getByTestId('federation-badge').count()) === 0, 'o post local mostra o selo de Fediverso');
  }, { tag: 'funcional' });

  const dominioSeguidor = `seguidor-${stamp}.ap-inexistente.net`;
  const actorSeguidor = `https://${dominioSeguidor}/users/dani`;

  await soft('seguidores: aparece para a dona, "Remover" tira o vínculo e enfileira o aviso (Reject)', async () => {
    await fsSet(`ap_followers/${A.uid}__${sha(actorSeguidor)}`, {
      uid: A.uid, actorId: actorSeguidor, inbox: `${actorSeguidor}/inbox`, sharedInbox: null, domain: dominioSeguidor,
      createdAtMs: Date.now(), followActivityJson: JSON.stringify({ id: `${actorSeguidor}/follow/1`, type: 'Follow', actor: actorSeguidor, object: 'x' }),
    }, 'owner');
    await A.page.goto(pagina, { waitUntil: 'domcontentloaded' });
    await A.page.getByRole('tab', { name: 'Seguidores e bloqueios' }).click();
    const linha = A.page.getByTestId('fediverse-follower');
    await linha.waitFor({ timeout: 60_000 });
    check((await linha.innerText()).includes(dominioSeguidor), `a linha não mostra o servidor: ${await linha.innerText()}`);
    check(!(await linha.innerText()).includes('/inbox'), 'a linha expõe o endereço da caixa de entrada');
    await shot(A.page, 'fediverso-06-seguidores');
    await linha.getByRole('button', { name: 'Remover' }).click();
    await linha.waitFor({ state: 'hidden', timeout: 30_000 });
    const resta = await adminGetDoc(`ap_followers/${A.uid}__${sha(actorSeguidor)}`);
    check(resta.status === 404, `o vínculo continua gravado (HTTP ${resta.status})`);
    const entregas = await eventually(async () => {
      const e = (await adminFind('ap_deliveries', { uid: A.uid })).filter((d) => d.op === 'reject');
      return e.length ? e : null;
    }, { label: 'Reject na fila', timeoutMs: 30_000 });
    check(entregas[0].domain === dominioSeguidor && entregas[0].status === 'pending', `Reject: ${JSON.stringify([entregas[0].domain, entregas[0].status])}`);
  }, { tag: 'funcional' });

  await soft('bloqueios: servidor inválido é recusado com mensagem; válido entra normalizado e sai ao desbloquear', async () => {
    const campo = A.page.locator('#fediverse-block-domain');
    await campo.fill('localhost');
    await A.page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await A.page.getByText('Esse valor não é válido.').first().waitFor({ timeout: 30_000 });
    check((await A.page.getByTestId('fediverse-block').count()) === 0, 'um servidor inválido foi gravado como bloqueio');
    await campo.fill('  Spam.Exemplo.ORG ');
    await A.page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    const bloqueio = A.page.getByTestId('fediverse-block');
    await bloqueio.waitFor({ timeout: 30_000 });
    const texto = await bloqueio.innerText();
    check(texto.includes('spam.exemplo.org') && texto.includes('Servidor inteiro'), `o bloqueio não aparece normalizado: ${texto}`);
    const gravados = await adminFind('ap_user_blocks', { uid: A.uid });
    check(gravados.length === 1 && gravados[0].scope === 'domain' && gravados[0].value === 'spam.exemplo.org', `bloqueios gravados: ${JSON.stringify(gravados.map((b) => [b.scope, b.value]))}`);
    await shot(A.page, 'fediverso-07-bloqueios');
    await bloqueio.getByRole('button', { name: 'Desbloquear' }).click();
    await bloqueio.waitFor({ state: 'hidden', timeout: 30_000 });
    check((await adminFind('ap_user_blocks', { uid: A.uid })).length === 0, 'o bloqueio continua gravado depois de desbloquear');
  }, { tag: 'funcional' });

  await soft('envios: a tela lista o que foi enfileirado, sem corpo nem endereço de caixa', async () => {
    await A.page.getByRole('tab', { name: 'Envios' }).click();
    const item = A.page.getByTestId('fediverse-delivery').first();
    await item.waitFor({ timeout: 30_000 });
    const texto = await A.page.locator('body').innerText();
    check(texto.includes('Remoção de seguidor') && texto.includes('Na fila'), 'a lista não mostra a remoção de seguidor na fila');
    check(!texto.includes('"@context"') && !texto.includes('/inbox'), 'a lista expõe o corpo da atividade ou o endereço da caixa');
    await shot(A.page, 'fediverso-08-envios');
  }, { tag: 'funcional' });

  await soft('pausar: o selo muda, o seletor some do compositor; retomar traz o seletor de volta', async () => {
    await A.page.getByRole('button', { name: 'Pausar' }).click();
    await A.page.getByText('Pausado', { exact: true }).first().waitFor({ timeout: 30_000 });
    const pausada = await adminGetDoc(`users/${A.uid}/private/federation`);
    check(pausada.doc?.paused === true, `paused gravado: ${pausada.doc?.paused}`);
    await A.page.goto(`${BASE_URL}/pt-BR`, { waitUntil: 'domcontentloaded' });
    await A.page.getByRole('button', { name: 'Postar', exact: true }).first().click();
    const dialog = A.page.getByRole('dialog');
    await dialog.waitFor();
    await dorme(4000);
    check((await dialog.getByTestId('federation-reach-trigger').count()) === 0, 'o seletor de alcance continua no compositor com a federação pausada');
    await A.page.keyboard.press('Escape');
    await A.page.goto(pagina, { waitUntil: 'domcontentloaded' });
    await A.page.getByRole('button', { name: 'Retomar' }).click();
    await A.page.getByText('Ativo', { exact: true }).first().waitFor({ timeout: 30_000 });
    const retomada = await adminGetDoc(`users/${A.uid}/private/federation`);
    check(retomada.doc?.paused === false && retomada.doc.eligibleSince > pausada.doc.eligibleSince, 'retomar não avançou a janela de elegibilidade');
  }, { tag: 'funcional' });

  await soft('desligar: confirma com o aviso honesto, volta ao estado inicial e enfileira a saída do Fediverso', async () => {
    await A.page.getByRole('button', { name: 'Desligar' }).click();
    const dialogo = A.page.getByRole('alertdialog');
    await dialogo.waitFor();
    check((await dialogo.innerText()).includes('não temos como garantir que todos apaguem'), 'a confirmação não avisa que cópias remotas podem continuar');
    await dialogo.getByRole('button', { name: 'Desligar' }).click();
    await A.page.getByText('Antes de ativar, saiba o que muda').waitFor({ timeout: 30_000 });
    const conta = await adminGetDoc(`users/${A.uid}/private/federation`);
    check(conta.doc?.enabled === false, `enabled gravado: ${conta.doc?.enabled}`);
    const tarefas = await adminFind('ap_outbound', { uid: A.uid });
    check(tarefas.some((t) => t.op === 'delete-actor'), `sem a tarefa de saída do Fediverso: ${JSON.stringify(tarefas.map((t) => t.op))}`);
    const handles = await adminFind('ap_handles', { uid: A.uid });
    check(handles.length === 1, 'o handle deixou de estar reservado depois de desligar');
    await shot(A.page, 'fediverso-09-desligado');
  }, { tag: 'funcional' });
}
