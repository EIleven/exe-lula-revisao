# Notificações (lista e push), vibração e resposta imediata das interações

Atualizado em 2026-10-25. Cobre três coisas que a pessoa sente no uso: **o aviso chega** (no navegador e no app), **o toque
responde na hora** (curtir um comentário não demora mais segundos) e **o celular vibra de leve** nas ações.

## 1. O caminho de uma notificação

```
ação da pessoa A (curtir, comentar...)  ->  marcador/documento no Firestore
  -> Function (onPostLiked, onCommentCreated...)  cria ou AGREGA  notifications/{id}      (lista dentro do app)
  -> onNotificationCreatedSendPush  /  onNotificationUpdatedSendPush                       (push)
  -> FCM  ->  navegador (firebase-messaging-sw.js)  ou  app Android (plugin nativo)
```

- **Quem avisa:** as Functions em `functions/src/index.ts`. Antes de criar a notificação, `shouldNotify` respeita as preferências
  da pessoa (Configurações > Notificações), bloqueio nos dois sentidos e contas silenciadas. **Sem notificação não há push.**
- **O texto, o destino e o agrupamento do aviso** são montados em `functions/src/push.ts`, uma mensagem **por idioma** dos
  aparelhos de quem recebe (pt-BR e en).
- **Aparelhos:** `users/{uid}/fcmTokens/{token}` (`platform`, `locale`, `registeredAt`, `updatedAt`, `userAgent`). Só o dono lê,
  grava e apaga (`firestore.rules`); as Functions leem e apagam o token que o FCM recusa. *(Sem esta regra o app nem conseguia
  guardar o token, e nenhum push chegou a ninguém.)*
- **Navegador:** `public/firebase-messaging-sw.js` (sem bibliotecas) mostra o aviso e, ao tocar, leva ao destino (a página já aberta
  navega sem recarregar). Se o app está aberto e em foco, não mostra aviso duplicado: a tela já atualiza em tempo real.
- **App Android:** plugin `@capacitor/push-notifications`; canal `exelula_default`, ícone `ic_stat_notify` (silhueta da lula) e cor
  `#D61F26` (`AndroidManifest.xml` e `res/values/notificacao.xml`). O toque abre o destino (`PushBridge`).
- **Convite para ligar:** cartão na tela inicial e na página de notificações (`PushPrompt`, "Agora não" some por 14 dias) e chave em
  Configurações > Notificações. No Android 13+ a permissão `POST_NOTIFICATIONS` é pedida ali.

### O que cada ação envia

| Ação | Quem recebe | Título (pt-BR) | O toque abre |
|---|---|---|---|
| Curtir post | autor | Nova curtida | o post |
| Curtir comentário | autor do comentário | Nova curtida | o post, na altura do comentário (`#comment-id`) |
| Comentar | autor do post | Novo comentário | o post |
| Responder comentário | autor do comentário | Nova resposta | o post, na altura do comentário |
| Repostar post / comentário | autor | Novo repost | o post / o comentário |
| Citar post / comentário | autor | Nova citação | **a citação** (o que a pessoa escreveu) |
| Mencionar (post ou comentário) | mencionado | Você foi mencionado(a) | o post / o comentário |
| Seguir | seguido | Novo seguidor | o **perfil** de quem seguiu |
| Post de quem você segue (sininho) | assinante | Nova publicação | o post |
| Mensagem direta | destinatário | (nome do remetente) | a conversa |

- **Mensagem direta nunca leva o conteúdo** no aviso ("Enviou uma mensagem para você", ou "3 novas mensagens"): ele apareceria na
  tela bloqueada e passaria pelos serviços do Google. A contagem é a de mensagens **não lidas** da conversa.
- **"Nova conversa" não envia push.** A conversa nasce quando alguém **abre** o chat, antes de escrever; a primeira mensagem já
  avisa. (A notificação dentro do app continua existindo.)
- **Agregação:** várias curtidas no mesmo post numa hora, ou várias mensagens da mesma conversa em 5 minutos, **somam numa única
  notificação**. O documento não é criado de novo, então o gatilho de criação não dispara. Por isso existe
  `onNotificationUpdatedSendPush`: **toda mensagem nova avisa** (o `tag` faz o aviso novo substituir o anterior, sem empilhar) e
  curtidas/reposts só avisam de novo nas marcas **5, 10, 25, 50, 100, 250, 500, 1000...** (`shouldPushOnUpdate`), para não virar spam.
- O `tag` agrupa o mesmo assunto (`tipo:id`); no Android ele também é a `collapseKey`. Mensagem e menção saem com urgência alta.

### Operação e testes

- **Emuladores não têm FCM:** a Function grava o que **seria enviado** em `_pushOutbox/{id}` (só o servidor lê). Os testes conferem
  texto, idioma, destino, tag e ajustes de Android e navegador ali.
- `node e2e/push-payload-check.mjs` (`npm run e2e:push`, exige `npm --prefix functions run build`): 66 conferências do montador, sem
  emuladores. Foi validado com **mutantes** (8 versões quebradas de propósito, todas detectadas).
- Seção **`notificacoes`** da suíte de fluxos (24 verificações): regras dos aparelhos, cada ação nos dois idiomas, mensagens
  seguidas, marcas de curtidas, "nova conversa" sem push, quem não tem aparelho, preferência desligada.
- **Produção:** a Function só envia se houver token. Para validar sem usuários reais: conta descartável, ativar o push pela tela e
  gerar a ação com outra conta descartável, apagando tudo depois (roteiro em `docs/limite-de-cadastro.md`, seção de validação).
- **APK:** o push e a vibração **nativa** só existem a partir do APK com `@capacitor/push-notifications` e `@capacitor/haptics`
  (versão nova em `android/app/build.gradle`). No APK antigo a tela de notificações continua funcionando; ligar o push mostra erro
  claro e a vibração cai na Vibration API do WebView.

## 2. Resposta imediata das interações

**Defeito:** curtir um comentário "demorava alguns segundos". O contador público é somado por uma Function **depois** do toque; o
app relia o comentário quando o contador mudava e um dado **atrasado** do servidor sobrescrevia o toque. Além disso o botão ficava
desabilitado durante a gravação, uma recusa do servidor era engolida em silêncio e o repost de comentário só aparecia depois do
servidor.

**Solução** (`src/lib/interactions/optimisticToggle.ts`, `src/hooks/useOptimisticToggle.ts`):

- o toque muda a tela **na hora** (botão e contador) e a gravação segue em segundo plano, **uma por vez**, sempre do estado final
  (vários toques rápidos viram uma única gravação certa);
- um **dado atrasado do servidor não desfaz o toque**: enquanto há gravação pendente e durante uma janela de tolerância
  (`DEFAULT_GRACE_MS = 8 s`) a tela mostra o que a pessoa pediu; chegando o dado que concorda, a tela assenta;
- o botão **nunca fica desabilitado** esperando o servidor;
- se o servidor **recusar** (bloqueio, permissão), a tela volta ao último estado confirmado e avisa com texto claro;
- vale para curtir, repostar e salvar, em posts e comentários (`setPostLike`, `setCommentLike`... em `interactPostActions.ts`,
  gravações idempotentes de marcador).

Testes: `npm run e2e:optimistic` (20 verificações da lógica pura) e a seção **`resposta`** da suíte (conexão lenta simulada de
+600 ms: a curtida aparece em ~60 ms; dado atrasado não desfaz; toques rápidos; recusa pelo servidor; repost; menu aberto não
fecha quando um contador muda).

Também corrigido: o botão de repost do comentário era um componente declarado **dentro** de outro; a cada mudança de contador o
React o remontava, fechando o menu aberto e tirando o foco de quem escolhia.

## 3. Vibração leve

`src/lib/haptics.ts` (Vibration API no navegador do celular e no WebView; `@capacitor/haptics` no APK novo; iPhone não oferece e
nada acontece).

| Quando | Padrão (ms) |
|---|---|
| Toque em botão, menu, aba, interruptor (**todos**, pelo `installTapHaptics`) | 14 |
| Ligar/desligar uma opção, ao religar a vibração | 10 |
| Curtir, repostar | 10-40-16 |
| Publicou, enviou, ativou as notificações | 12-50-12 |
| Aviso de erro (toast destrutivo) | 30-50-30-50-30 |

- Só em resposta a um **toque** (mouse não vibra), só no clique (**rolar a tela por cima de um botão não vibra**) e sem dobrar: se a
  ação já vibrou de forma específica (curtir), o tique genérico não repete. `data-no-haptic` exclui um trecho.
- Durações acima do mínimo que o motor do celular reproduz (abaixo de ~10 ms muitos aparelhos, inclusive Samsung, nem vibram).
- **Configurações > Notificações > Vibração** liga e desliga (guardado no aparelho; some em aparelhos que não vibram).
- Seção **`vibracao`** da suíte: celular simulado (412x915, toque) com `navigator.vibrate` falso que anota os pedidos.

## 4. Lista de notificações dentro do app

`NotificationListItem.tsx`: textos traduzidos (pt-BR/en); "nova conversa" tem ícone, texto e destino (antes caía em "interagiu com
você" e na página inicial); o repost de **comentário** abre o comentário (antes abria `/post/{id do comentário}`, que não existe);
a citação abre a citação, igual ao aviso do celular.
