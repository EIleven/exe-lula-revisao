/**
 * Seção "mensagens": conversa privada entre A e B (interface + dados), não lidas, preferência de DM e bloqueios.
 * O acesso indevido de uma terceira conta (C) às conversas de A e B é testado na seção "autorizacao".
 */
import { adminFind, adminGetDoc, eventually, fsCall, fsUpdate } from '../lib/harness.mjs';

export async function run(ctx) {
  const { runner, users, BASE_URL, stamp, shot } = ctx;
  const { a: A, b: B, c: C } = users;
  const { section, soft, check } = runner;
  const pairId = (x, y) => [x.uid, y.uid].sort().join('_');
  const threadUrl = (otherUser) => `${BASE_URL}/pt-BR/messages/user/${otherUser.uid}`;
  const composer = (page) => page.getByPlaceholder('Digite sua mensagem...');
  const sendButton = (page) => page.locator('form:has(textarea[placeholder="Digite sua mensagem..."]) button[type=submit]');
  const lastNumber = (text) => {
    const found = String(text).match(/\d+/g);
    return found ? Number(found[found.length - 1]) : NaN;
  };
  const messagesOf = async (conversationId) =>
    (await adminFind('messages', {}, { allDescendants: true, limit: 500 })).filter((m) => m.__path?.startsWith(`conversations/${conversationId}/messages/`));
  // O total de não lidas é dado pessoal: fica em users/{uid}/private/account, fora do perfil público.
  const privateOf = (user) => `users/${user.uid}/private/account`;

  // ---------------------------------------------------------------------------------------------------------------
  section('mensagens: conversa entre A e B');
  const convId = pairId(A, B);
  const textA = `Olá B, mensagem privada de A ${stamp}`;
  const textB = `Oi A, resposta privada de B ${stamp}`;

  await soft('A abre a conversa com B, envia a mensagem e ela aparece na conversa', async () => {
    await A.page.goto(threadUrl(B), { waitUntil: 'domcontentloaded' });
    await composer(A.page).waitFor({ timeout: 90_000 });
    await composer(A.page).fill(textA);
    await sendButton(A.page).click();
    await A.page.getByText(textA).first().waitFor({ timeout: 60_000 });
    await shot(A.page, 'mensagens-01-enviada');
  });
  await soft('mensagem gravada: conversa A_B com os dois participantes e a mensagem de A na subcoleção', async () => {
    const conversation = await eventually(async () => (await adminGetDoc(`conversations/${convId}`)).doc, { label: 'documento da conversa' });
    check(
      JSON.stringify([...conversation.participantIds].sort()) === JSON.stringify([A.uid, B.uid].sort()),
      `participantIds inesperado: ${JSON.stringify(conversation.participantIds)}`,
    );
    const message = await eventually(async () => (await messagesOf(convId)).find((m) => m.text === textA), { label: 'mensagem de A no Firestore' });
    check(message.senderId === A.uid, `senderId da mensagem: ${message.senderId}`);
    return `mensagem ${message.__id}`;
  });
  await soft('a Function onDirectMessageCreated criou a notificação new_message para B', async () => {
    await eventually(async () => (await adminFind('notifications', { recipientId: B.uid, type: 'new_message' })).length >= 1, { label: 'new_message' });
  });
  await soft('o documento da conversa guarda a última mensagem e 1 não lida para B', async () => {
    const conversation = await eventually(async () => {
      const { doc } = await adminGetDoc(`conversations/${convId}`);
      return doc.lastMessageText && doc.unreadCounts?.[B.uid] === 1 ? doc : null;
    }, { label: 'lastMessageText e unreadCounts[B] = 1', timeoutMs: 15_000 });
    return `lastMessageText="${conversation.lastMessageText}"`;
  });
  await soft('B recebe: o contador de mensagens do menu mostra 1 e users/B/private/account.totalUnreadMessages = 1', async () => {
    await B.page.goto(`${BASE_URL}/pt-BR/messages`, { waitUntil: 'domcontentloaded' });
    await eventually(async () => (await adminGetDoc(privateOf(B))).doc?.totalUnreadMessages === 1, { label: 'totalUnreadMessages = 1', timeoutMs: 15_000 });
    const link = B.page.getByRole('link', { name: /Mensagens/ }).first();
    await eventually(async () => lastNumber(await link.innerText()) === 1, { label: 'contador do menu = 1', timeoutMs: 15_000 });
  });
  await soft('B vê a conversa com A na lista, com o texto da última mensagem e o selo de não lida', async () => {
    await B.page.getByText(textA).first().waitFor({ timeout: 30_000 });
    await shot(B.page, 'mensagens-02-lista-de-b');
    const badge = B.page.locator(`a[href$="/messages/user/${A.uid}"]`).first();
    check(/\b1\b/.test(await badge.innerText()), `o item da lista não mostra o selo de 1 não lida: "${(await badge.innerText()).replace(/\s+/g, ' ')}"`);
  });
  await soft('B abre a conversa, lê a mensagem e responde; A recebe a resposta em tempo real', async () => {
    await B.page.goto(threadUrl(A), { waitUntil: 'domcontentloaded' });
    await B.page.getByText(textA).first().waitFor({ timeout: 90_000 });
    await composer(B.page).fill(textB);
    await sendButton(B.page).click();
    await B.page.getByText(textB).first().waitFor({ timeout: 60_000 });
    await A.page.getByText(textB).first().waitFor({ timeout: 60_000 }); // A continua com a conversa aberta
    await shot(A.page, 'mensagens-03-resposta-recebida');
    const stored = await eventually(async () => (await messagesOf(convId)).find((m) => m.text === textB), { label: 'resposta de B no Firestore' });
    check(stored.senderId === B.uid, `senderId da resposta: ${stored.senderId}`);
  });
  await soft('ao abrir a conversa, B zera as não lidas: unreadCounts[B] = 0 e totalUnreadMessages = 0', async () => {
    await eventually(async () => {
      const [conversation, account] = await Promise.all([adminGetDoc(`conversations/${convId}`), adminGetDoc(privateOf(B))]);
      return (conversation.doc.unreadCounts?.[B.uid] ?? 0) === 0 && (account.doc?.totalUnreadMessages ?? 0) === 0;
    }, { label: 'não lidas de B zeradas', timeoutMs: 15_000 });
  });
  await soft('A volta à lista de conversas e vê a resposta de B como última mensagem', async () => {
    await A.page.goto(`${BASE_URL}/pt-BR/messages`, { waitUntil: 'domcontentloaded' });
    await A.page.getByText(textB).first().waitFor({ timeout: 30_000 });
  });
  // Teste discriminante da causa dos contadores: antes da correção, nenhum código chamava a callable onMessageCreated
  // (a única a atualizar lastMessage*/unreadCounts). Chamada à mão, sem login, ela faz exatamente o que faltou.
  // Vem por último porque altera a conversa; com a callable removida (404) o passo apenas registra isso.
  await soft('diagnóstico: chamar a callable onMessageCreated à mão atualiza a conversa (prova que só faltava alguém chamá-la)', async () => {
    const message = (await messagesOf(convId)).find((m) => m.text === textA);
    check(message, 'mensagem de A não encontrada');
    const response = await fetch('http://127.0.0.1:5001/demo-soberan/southamerica-east1/onMessageCreated', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { conversationId: convId, messageId: message.__id, senderId: A.uid, text: textA } }),
    });
    if (response.status === 404) return 'a callable não existe mais (removida pela correção)';
    check(response.ok, `a callable respondeu HTTP ${response.status}`);
    const conversation = await eventually(async () => {
      const { doc } = await adminGetDoc(`conversations/${convId}`);
      return doc.lastMessageText === textA.slice(0, 50) ? doc : null;
    }, { label: 'conversa atualizada pela callable' });
    // a cadeia seguinte existe e funciona: onConversationUpdated soma em users/B/private/account.totalUnreadMessages
    await eventually(async () => ((await adminGetDoc(privateOf(B))).doc?.totalUnreadMessages ?? 0) >= 1, {
      label: 'onConversationUpdated soma em totalUnreadMessages',
    });
    return `lastMessageText="${conversation.lastMessageText}"; a chamada anônima (sem login) foi aceita`;
  });

  // ---------------------------------------------------------------------------------------------------------------
  section('mensagens: preferência de DM e bloqueio (conversas novas de C com B)');
  const convCB = pairId(C, B);
  const tokenOf = async (user) => ctx.token(user);
  const setPreference = async (user, value) => {
    const { status } = await fsUpdate(`users/${user.uid}`, { dmPreference: value }, await tokenOf(user));
    check(status === 200, `não consegui definir dmPreference=${value}: HTTP ${status}`);
  };
  // Apagar uma conversa recém-criada, antes de as Functions de criação terminarem, faz o gatilho ler um documento que
  // não existe mais (nenhum usuário consegue apagar conversas; só o administrador do emulador): espera a Function acabar.
  const dropConversation = async (id) => {
    if ((await adminGetDoc(`conversations/${id}`)).doc) await new Promise((resolve) => setTimeout(resolve, 3500));
    return fsCall('DELETE', `conversations/${id}`, { token: 'owner' });
  };
  const attemptDirectMessage = async (fromUser, toUser) => {
    await fromUser.page.goto(threadUrl(toUser), { waitUntil: 'domcontentloaded' });
    // Espera o desfecho: o campo de mensagem (conversa criada) OU o aviso de recusa.
    await fromUser.page.waitForFunction(
      () => document.querySelector('textarea[placeholder="Digite sua mensagem..."]') || /não está aceitando|deve ser seguido|não pode enviar|permiss|insufficient|erro|error/i.test(document.body.innerText),
      null,
      { timeout: 30_000 },
    );
    const opened = (await composer(fromUser.page).count()) > 0;
    const conversationExists = Boolean((await adminGetDoc(`conversations/${pairId(fromUser, toUser)}`)).doc);
    return { opened, conversationExists };
  };

  await soft('B escolhe "ninguém": C não consegue iniciar uma conversa com B pela interface', async () => {
    await setPreference(B, 'none');
    const result = await attemptDirectMessage(C, B);
    check(!result.opened && !result.conversationExists, `C conseguiu iniciar a conversa (campo de mensagem: ${result.opened}, documento criado: ${result.conversationExists})`);
    await shot(C.page, 'mensagens-04-dm-nenhum');
  });
  await soft('B escolhe "pessoas que você segue": C, que B NÃO segue mas SEGUE B, não pode iniciar (ordem do filtro)', async () => {
    await dropConversation(convCB);
    await setPreference(B, 'followed');
    // C segue B (users/B/followers/C) e B NÃO segue C
    await fsCall('PATCH', `users/${B.uid}/followers/${C.uid}`, { token: 'owner', body: { fields: { userId: { stringValue: C.uid } } } });
    const result = await attemptDirectMessage(C, B);
    await shot(C.page, 'mensagens-05-dm-seguidos-c-segue-b');
    check(!result.opened && !result.conversationExists, 'C (que B não segue) conseguiu iniciar a conversa: o filtro conferiu followers/{C} em vez de following/{C}');
  });
  await soft('B escolhe "pessoas que você segue": C, que B SEGUE, deve conseguir iniciar a conversa', async () => {
    await dropConversation(convCB);
    await fsCall('DELETE', `users/${B.uid}/followers/${C.uid}`, { token: 'owner' });
    await fsCall('PATCH', `users/${B.uid}/following/${C.uid}`, { token: 'owner', body: { fields: { userId: { stringValue: C.uid } } } });
    const result = await attemptDirectMessage(C, B);
    await shot(C.page, 'mensagens-06-dm-seguidos-b-segue-c');
    check(result.opened || result.conversationExists, 'C (que B segue) foi impedido de iniciar a conversa');
  });
  // limpeza: estado neutro para as próximas seções
  await soft('limpeza: preferência de B volta a "todos" e as relações de teste são removidas', async () => {
    await dropConversation(convCB);
    await fsCall('DELETE', `users/${B.uid}/following/${C.uid}`, { token: 'owner' });
    await setPreference(B, 'everyone');
  });

  // A Function onConversationCreated precisa notificar quem RECEBE. Sem o campo createdBy ela usava participantIds[0]
  // (o MENOR id, pois a lista é ordenada), então quando o MAIOR id iniciava a conversa, a notificação "nova conversa"
  // ia para o próprio iniciador. O teste escolhe o par (menor id, maior id) para não depender da sorte e faz o maior
  // id iniciar pela interface real.
  section('mensagens: notificação de nova conversa');
  await soft('Function onConversationCreated: a notificação "nova conversa" vai para quem RECEBE, não para quem iniciou', async () => {
    const [low, , high] = [A, B, C].sort((x, y) => (x.uid < y.uid ? -1 : 1));
    const id = pairId(low, high);
    await dropConversation(id);
    // Este par pode ser o mesmo dos testes de preferência de DM acima (mesmo id de conversa): as notificações de nova
    // conversa que ficaram deles não valem aqui.
    for (const old of (await adminFind('notifications', { type: 'new_conversation' })).filter((n) => n.entityId === id)) {
      await fsCall('DELETE', `notifications/${old.__id}`, { token: 'owner' });
    }
    const result = await attemptDirectMessage(high, low); // o maior id INICIA, abrindo a conversa pela interface
    check(result.opened && result.conversationExists, `a conversa não foi criada (campo de mensagem: ${result.opened}, documento: ${result.conversationExists})`);
    const notifications = await eventually(
      async () => {
        const found = (await adminFind('notifications', { type: 'new_conversation' })).filter((n) => n.entityId === id);
        return found.length ? found : null;
      },
      { label: 'notificação new_conversation', timeoutMs: 45_000 }, // o emulador de Functions pode estar com fila depois dos outros fluxos
    );
    const recipients = notifications.map((n) => (n.recipientId === high.uid ? `${high.label.toUpperCase()} (quem iniciou)` : `${low.label.toUpperCase()} (quem recebe)`));
    check(
      notifications.every((n) => n.recipientId === low.uid),
      `${high.label.toUpperCase()} iniciou a conversa com ${low.label.toUpperCase()}, mas a notificação "nova conversa" foi para: ${recipients.join(', ')}`,
    );
    await dropConversation(id);
  }, { tag: 'funcional' });
}
