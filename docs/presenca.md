# Presença (online/offline): auditoria e proposta

> **Implementado em 2026-10-24 (opção A)**, commit `bf31fd9`. O RTDB é a única fonte. Cada aba é uma conexão em
> `/status/{uid}/connections/{id}` (com `onDisconnect().remove()`), e `/status/{uid}/lastSeen` recebe a hora do
> servidor. Sair da conta marca offline **antes** do `signOut` (`presenceService.goOffline`). Não há mais gravação no
> Firestore. As regras do RTDB validam o formato, e `/guests` não tem leitura pública (o visitante grava só
> `/guests/{id}` com padrão de id e formato fixos, e o nó some quando a conexão cai). O ponto verde das conversas usa
> `useUserPresence` (RTDB em tempo real). O painel do admin conta online pela Function `getPresenceStats` (só
> administradores, a cada minuto). Decisões tomadas com os padrões recomendados abaixo:
> - visitantes: escrita restrita e validada, sem autenticação anônima;
> - visibilidade: qualquer usuário logado vê a presença de outro (como antes). Limitar quem vê continua possível depois.
>
> Testes: `perfil` (sair da conta deixa sem conexões e com `lastSeen`) e `autorizacao` (leitura anônima de `/guests`
> negada, lixo no próprio status negado, gravar no status de outra pessoa negado, controles positivos).

Auditoria **somente de leitura** feita em 2026-10-15 na branch `feat/lula-producao`, mais medições nos emuladores
(`e2e/presence-rtdb-diagnostico.mjs`). O texto abaixo é a análise original (antes da implementação).

## Conclusão

1. **O Realtime Database (RTDB) deve ser a única fonte de verdade da presença.** Ele é o único dos dois serviços que detecta
   desconexão no servidor (`onDisconnect`); o Firestore não tem isso, então um `isOnline: true` gravado lá nunca se desfaz
   sozinho quando a aba fecha ou a rede cai.
2. **Hoje o Firestore nunca recebe presença.** O cliente tenta `updateDoc(users/{uid}, { isOnline, lastSeen })`, a regra de
   `update` (`firestore.rules:115-149`) não lista esses campos e nega (`PERMISSION_DENIED`, a cada conexão e reconexão, sem
   `.catch`).
   Quem depende do campo no Firestore fica sempre sem dado: o ponto verde das conversas nunca aparece e o contador de
   "usuários ativos" do painel admin é sempre 0.
3. **Não liberar `isOnline`/`lastSeen` nas regras do Firestore.** Seria permitir que cada cliente afirme o próprio estado num
   campo que ninguém consegue manter correto (nem a aba que fecha de repente), criando uma segunda fonte de verdade que
   diverge da primeira.
4. **Há 3 defeitos reais no RTDB atual** (medidos, seção 3): sair da conta deixa o usuário "online para sempre"; duas abas
   do mesmo usuário se anulam; e `/guests` aceita leitura e escrita de qualquer pessoa, com qualquer conteúdo.

## 1. Quem escreve e quem lê

| Onde | O que faz | Observação |
|---|---|---|
| `src/lib/services/presenceService.ts:44-48` | `onDisconnect(/status/{uid}).set(offline)`, `set(online)` no RTDB **e** `updateDoc` em `users/{uid}` | O RTDB funciona; o `updateDoc` é negado pelas regras |
| `presenceService.ts:95-112` (`goOffline`) | `set` offline no RTDB e `updateDoc` no Firestore | Chamado depois de o Auth já ter mudado: ambos negados |
| `src/contexts/CurrentUserContext.tsx:47-50,78,94` | Inicia a presença no login e chama `goOffline` quando `onAuthStateChanged` já entregou `null` | Veja E3 |
| `CurrentUserContext.tsx:56,84,96` e `presenceService.ts:56-93` | Presença de visitantes em `/guests/{id}` (RTDB) | Regra pública de leitura e escrita |
| `src/lib/services/authService.ts:288-295` (`logoutUser`) | `signOut(auth)` direto, sem escrever "offline" antes | Causa do E3 |
| `src/components/messages/ConversationListItem.tsx:55` | Ponto verde: `otherParticipant.isOnline` | `participantsInfo` vem de `getUser()` no Firestore (`conversationService.ts:37-41`), lido uma vez, sem tempo real |
| `src/lib/services/userService.ts:760-771` | `subscribeToActiveUsersCount`: `where("isOnline","==",true)` em `users` | Usado só por `AdminDashboard.tsx:192` ("usuários ativos") |
| `userService.ts:778-797` | `subscribeToGuestUsersCount`: lê **todo** `/guests` | `AdminDashboard.tsx:193` |
| `src/lib/types.ts:49-50` | `User.isOnline?`, `User.lastSeen?` | `lastSeen` não é lido por nenhuma tela |
| Cloud Functions (`functions/src`) | **Nenhum** uso de `isOnline`, `lastSeen` ou do RTDB | Sem gatilhos de presença |

Regras: `database.rules.json` libera `/status/{uid}` (leitura para qualquer autenticado, escrita só do próprio dono) e
`/guests` (leitura **e** escrita públicas, sem validação). O Firestore não tem regra para presença.

## 2. Consumidores legítimos de presença

Só dois, e ambos funcionam melhor a partir do RTDB do que do Firestore:

- **Ponto verde nas conversas** (tempo real, poucos usuários por vez): ouvir `/status/{id}` de cada interlocutor visível.
- **Painel admin** (contagens agregadas, uso raro): hoje `where isOnline == true` no Firestore (sempre 0) e leitura de todo
  `/guests`. O RTDB não deixa o cliente listar `/status` (correto), então a contagem precisa vir de código com credencial de
  servidor.

## 3. Medições nos emuladores (`e2e/presence-rtdb-diagnostico.mjs`)

| # | Resultado | Leitura |
|---|---|---|
| E1/E2/E2b | Online ao entrar; `onDisconnect` marca offline com `lastSeen` do servidor quando a conexão cai; volta a online ao reconectar | O desenho do RTDB funciona |
| E3 | Depois de `signOut`: `/status/A` continua `isOnline: true`; a escrita "offline" do app é **negada**; ao cair a conexão o `onDisconnect` registrado antes do `signOut` **não executa** | **Defeito:** quem sai da conta fica online para sempre |
| E4a-c,e | Outro usuário lê `/status/A` (permitido) e não escreve nela nem lista `/status`; sem login, nada é lido | Regras de `/status` corretas |
| E4d | Escrever no próprio `/status/B` um objeto de 300 KB com tipos errados é **permitido** | Falta `.validate` |
| E4f/E4g | Sem login, escrever dado arbitrário em `/guests/*` e ler todo `/guests` são **permitidos** | **Defeito:** abuso e custo; contagem de visitantes manipulável |
| E6 | Duas abas do mesmo usuário: fechar a 1ª marca o usuário offline com a 2ª aberta | **Defeito:** um único booleano por usuário |

Observação de privacidade (não é bug de implementação): qualquer usuário autenticado lê a presença de qualquer outro,
inclusive de quem bloqueou ou tem perfil privado, e não existe opção "não mostrar que estou online". As regras do RTDB não
enxergam o Firestore, então essa decisão precisa de dado espelhado ou de um nó próprio de visibilidade.

## 4. Alternativas avaliadas

| Opção | Resumo | Veredito |
|---|---|---|
| **A. RTDB único** (recomendada) | Cliente escreve só no RTDB; ponto verde ouve o RTDB; contagens do admin saem de uma Function chamável que lê o RTDB com credencial de servidor | Uma fonte de verdade; sem regra nova no Firestore; correções de E3/E6 no mesmo lugar |
| B. Espelho no Firestore por Function | Gatilho `onValueWritten('/status/{uid}')` grava `isOnline`/`lastSeen` em `users/{uid}` com Admin SDK | Duas fontes (eventualmente consistentes); cada mudança de presença é 1 invocação + 1 escrita; o `onSnapshot` do próprio perfil (`CurrentUserContext.tsx:63`) dispararia `getUser` a cada reconexão; a leitura do ponto verde continuaria sem tempo real |
| C. Liberar os campos nas regras | Acrescentar `isOnline`/`lastSeen` a `allowedKeys` | **Rejeitada:** valor forjável, nunca limpo em queda de rede, segunda fonte de verdade |
| D. Remover a presença | Apagar o ponto verde e o contador | Possível se a funcionalidade não importar; perde-se um indicador que o produto já anuncia |

## 5. Proposta A, em passos pequenos (nada implementado)

1. **Cliente (presenceService).** Remover os dois `updateDoc` (e o erro de página). Trocar o booleano único por conexões:
   `/status/{uid}/connections/{connId}: true` com `onDisconnect(...).remove()` e `/status/{uid}/lastOnline` com
   `onDisconnect(...).set(serverTimestamp())` (padrão da documentação do Firebase). "Online" passa a ser "tem ao menos uma
   conexão", o que resolve E6.
2. **Sair da conta.** `logoutUser` remove a conexão e grava `lastOnline` **antes** de `signOut` (resolve E3); o `goOffline`
   chamado depois da troca de credencial deixa de existir.
3. **Ponto verde.** Um hook `useUserPresence(userId)` com `onValue` em `/status/{id}`; `ConversationListItem` o usa no lugar
   de `isOnline`. Para a lista de conversas, um listener por interlocutor visível (RTDB suporta isso sem custo relevante).
4. **Painel admin.** Function chamável `getPresenceStats` (confere `users/{uid}.isAdmin` com Admin SDK e conta `/status` e
   `/guests` com credencial de servidor); o painel consulta a cada 30-60 s em vez de `onSnapshot`. Sem gatilho, sem contador
   com concorrência, sem deriva. Custa O(N) por consulta, aceitável no tamanho inicial da rede; se ela crescer, trocar por um
   contador mantido por gatilho.
5. **Regras do RTDB.** `.validate` em `/status/$uid` (forma, tipos e tamanho). `/guests`: tirar a leitura pública (só a
   Function lê) e restringir a escrita a `/guests/$id` com padrão de id e `{ isOnline: boolean, lastSeen: número }`; a
   alternativa mais forte é usar autenticação anônima do Firebase para visitantes (muda o fluxo de visitante, por isso fica
   como decisão).
6. **Firestore.** Nenhuma mudança de regra. `User.isOnline`/`lastSeen` deixam de ser campos persistidos (podem continuar no
   tipo como valores derivados na interface).
7. **Testes.** Transformar `presence-rtdb-diagnostico.mjs` em asserções (E2/E3/E6 e as negativas de E4 viram critérios) e
   acrescentar a checagem na interface real: sair da conta deixa `/status/{uid}` offline, e o ponto verde segue o RTDB.

Esforço estimado: pequeno-médio (um serviço, um hook, um componente, uma Function e as regras do RTDB). Risco principal: a
decisão de visibilidade (quem pode ver que eu estou online) e o tratamento de visitantes.

## 6. Decisões pedidas

1. Aprovar a opção A (RTDB como única fonte, sem tocar nas regras do Firestore)?
2. Visitantes: manter `/guests` com escrita restrita e validada, ou autenticação anônima?
3. Visibilidade: manter "qualquer usuário autenticado vê a presença de qualquer outro" no lançamento, ou já limitar (por
   exemplo, só entre quem se segue ou tem conversa)? Limitar exige um nó de visibilidade sincronizado por Function.

Enquanto isso não for decidido, o erro `PERMISSION_DENIED` da regra `L149` continua aparecendo a cada conexão nos testes com
emuladores (conhecido e tolerado nos testes de fluxo).
