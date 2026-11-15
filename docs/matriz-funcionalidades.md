# Matriz de funcionalidades e testes de segurança (emuladores)

**Atualização de 2026-10-25:** **268 verificações, 267 passam, 0 falham e 1 não está implementada** (a tela `/files`). Nova
seção **`cadastro`** (37 verificações): o **limite dos primeiros 500 usuários**, imposto no servidor com vagas históricas
(veja `docs/limite-de-cadastro.md`): 499 vagas com cadastros simultâneos entra exatamente 1, com 500 e-mail e Google são
recusados, excluir conta não libera vaga, a criação direta de perfil, `@` e dados pessoais pelo cliente é recusada nas regras
(testada pela REST e pelo SDK do Firebase de verdade) e o script de migração é idempotente. Guardas: PWA 166 URLs, XSS 6/6,
YouTube 21/21, SSRF e higienização passam.

**Atualização anterior (2026-10-24, noite):** 231 verificações, 230 passavam. O feed personalizado agora usa o mesmo motor paginado dos demais feeds, entrega posts/reposts permitidos de
perfis privados, elimina duplicatas entre páginas e isola o cache por conta sem persistir conteúdo restrito. Também há
conexões OAuth de Bluesky/X, seletor no compositor, publicação externa idempotente e bloqueio no servidor para impedir
que posts restritos saiam do círculo. Guardas extras: `npm run e2e:sanitize` (XSS, sem app), `npm run e2e:xss` (XSS no
navegador), `npm run e2e:safe-fetch` (SSRF), `npm run e2e:youtube` (link de vídeo vira vídeo) e `npm run e2e:pwa`
(instalação/offline/cache). O resultado integral está em `E:\Soberan\tools\logs\e2e\suite-feed-social-final-2`.

| Área | Verificações | Passam | Falham |
|---|---|---|---|
| preparação | 4 | 4 | 0 |
| social | 19 | 19 | 0 |
| interações | 44 | 44 | 0 |
| mensagens | 15 | 15 | 0 |
| artigos | 8 | 8 | 0 |
| mídia | 10 | 9 (+1 não implementada) | 0 |
| conta | 7 | 7 | 0 |
| perfil | 28 | 28 | 0 |
| autorização | 95 | 95 | 0 |
| cadastro | 37 | 37 | 0 |
| isolamento | 1 | 1 | 0 |
| **Total** | **268** | **267** | **0** |

### Como ficam as ações num PERFIL PRIVADO (decisão de produto, conferida na seção "interações")

| Ação sobre um post só para seguidores | Quem segue | Quem não segue |
|---|---|---|
| Ver o post e os comentários | sim | não ("Post indisponível") |
| Curtir, comentar, responder, salvar | sim (o autor é notificado) | não (recusado pelo servidor) |
| **Repostar e citar** | **não** | **não** |

Repost e citação levariam o conteúdo para fora do círculo do autor: as regras exigem `visibility == 'public'` para criar
o marcador de repost e `quotePost`/`quoteComment` recusam post ou comentário não público. A interface mostra as duas
opções **desabilitadas, com o motivo**, em vez de deixar clicar e falhar com erro de permissão.

### Corrigido em 2026-10-23/24

| # | Defeito | Commit |
|---|---|---|
| R1 | E-mail, nascimento e preferências no perfil público, listável sem login | `2b08d67` (dados em `users/{uid}/private/account`; listar `users` exige login e limite 100) |
| R2 | `posts` listável com posts restritos; posts de perfil privado públicos | `e596970` (visibilidade nasce do perfil; regras exigem filtro; Function acompanha a troca de perfil) |
| R3 | Storage legível sem login pelo caminho (anexos de mensagens) | `4653263` |
| R4 | Contadores forjáveis (seguidores, visualizações, análises) | `f64dd34`, `3a7a095`, `cc8bf57` (só as Functions gravam, idempotentes) |
| R5 | `access_events` gravável sem login, com IP forjável e dados pessoais | `6a35a72` (Admin SDK, sem IP, navegador, sessão nem usuário) |
| R6 | `/guests` no RTDB público para ler e gravar qualquer coisa | `bf31fd9` |
| R7 | `/api/extract-article` sem login | `3c6bec4` (token conferido no servidor, limite por pessoa) |
| R8 | Presença "online para sempre" depois de sair da conta | `bf31fd9` |
| R9 | Perfil privado mostrava "User Not Found" | `54881a9` (aviso claro; posts, comentários e curtidas fechados) |
| — | **XSS armazenado** (HTML de artigos e citações sem higienização) | `ec85041` (também publicado em produção como hotfix, tag `producao-2026-10-24-xss`) |
| — | Respostas de post restrito listáveis (regra de grupo com `get(campo, padrão)`) | `e596970` |
| — | Citação de comentário sem conferência no servidor; citação de post restrito | `e596970` |
| — | Feed "Seguindo" e feeds personalizados quebravam com mais de 15 contas; feeds sem paginação | `e596970` |
| — | `onPostCreated` caía com evento sem documento e atrasava os outros gatilhos | `f2b262e` |
| — | Post de perfil privado abria "Página não encontrada" até para o dono e os seguidores (o servidor monta a página sem login) | `bd4d6ee` (carrega no navegador com o login; "não encontrado" só para post inexistente, com `noindex`) |
| — | Sessão só na aba em que a pessoa entrou ("Lembrar de mim" desmarcado por padrão, cadastro idem): aba nova aparecia como visitante | `e272567` |
| — | "Editar Perfil" zerava o formulário no meio da edição (o nome digitado voltava ao antigo) | `b1daa0e` |
| — | **Redirecionamento aberto no login** (`?redirect=https://site-falso` levava a pessoa a outro site logo depois de entrar) | `1d4434e` (só páginas do próprio site; teste novo na seção conta, que falhava antes da correção e passa depois: conta + perfil 40 de 40) |
| — | **Citar não funcionava**: "Postar" no diálogo de citação (de post e de comentário) não fazia nada, porque clicava num botão escondido de id fixo que só existe numa cópia morta do `CommentInputArea` | `deb2540` |
| — | Link de vídeo **ao vivo** (`/live/`) e **shorts** do YouTube não virava vídeo no post, e o resto do endereço (`?t=`, `&list=`) sobrava como texto | `9930ba4` (guarda `npm run e2e:youtube`) |
| — | **Não havia limite de cadastro** e o cliente criava o próprio perfil, `@` e dados pessoais direto no Firestore (uma conta criada pela API pública do Auth fazia isso sem passar pelo cadastro; qualquer conta juntava vários `@` ou apagava o próprio) | commit do limite dos 500 usuários (`docs/limite-de-cadastro.md`) |
| — | Primeiro acesso com o Google: a tela "Finalize seu Perfil" nunca aparecia (a tela de login é desmontada e remontada com o estado zerado enquanto a sessão carrega, e o aviso de "conta nova" se perdia): a pessoa ficava logada, com o `@` provisório e sem informar o nascimento | commit do limite dos 500 usuários (marcador na sessão da aba; teste pela tela) |
| — | Post e comentário só para seguidores ofereciam "Repostar"/"Citar", que o servidor recusa | `8fa2571` (opções desabilitadas, com o motivo) |

O restante deste documento é o registro de 2026-10-15/16.

Medido em 2026-10-15 e 2026-10-16 na branch `feat/lula-producao`, com a suíte `npm run e2e:fluxos`
(`e2e/flows-emulators.mjs` e `e2e/flows/*.mjs`). Tudo roda contra os emuladores do Firebase, com dados descartáveis; nada
tocou o projeto real. Resultado final: **148 verificações, 134 passam, 13 falham e 1 não está implementada**
(a tela `/files`). Antes de qualquer correção eram 144 verificações: 111 passavam e 32 falhavam.

## Como o teste funciona

- **Três usuários descartáveis (A, B e C)**, cadastrados pela interface real e mantidos em contextos de navegador
  separados, contra um build de produção em modo emulador (porta 9002).
- Cada verificação confere **o que a interface mostra** e **o que ficou gravado** (Firestore, Storage, RTDB e as Cloud
  Functions que reagem aos dados), lendo com o administrador do emulador, que ignora as regras.
- Os testes de **autorização** (seção `autorizacao`, ~70 verificações) chamam a REST dos emuladores com o **ID token real**
  de cada usuário, então as regras valem exatamente como para o app. Cada teste afirma o comportamento **desejado**: uma
  linha "FALHOU" significa que a operação indevida foi **permitida**. Há controles positivos (a operação legítima precisa dar
  certo) para provar que o teste enxerga alguma coisa.
- **Nada externo**: sem token de push, as Functions não chamam o FCM; as Functions agendadas não rodam nos emuladores; os
  artigos vêm de uma fixture em `127.0.0.1`; e a suíte verifica que o navegador não falou com nenhum host real do
  Google/Firebase.
- Quando algo falha, a suíte registra e **continua**, para medir tudo de uma vez. Para cada falha investigada há causa
  provável e um teste que a discrimina (listados abaixo).

## Resultado por área

| Área | Verificações | Antes: passou / falhou | Depois: passou / falhou |
|---|---|---|---|
| preparação | 4 | 4 / 0 | 4 / 0 |
| social | 19 | 18 / 0 | 19 / 0 |
| mensagens | 15 | 9 / 6 | 15 / 0 |
| artigos | 8 | 6 / 2 | 7 / 1 |
| mídia | 10 | 8 / 1 | 9 / 0 |
| perfil | 21 | 17 / 4 | 19 / 2 |
| autorização | 70 | 48 / 19 | 60 / 10 |
| isolamento | 1 | 1 / 0 | 1 / 0 |
| **Total** | **148** | **111 / 32** | **134 / 13** |

## O que foi corrigido

Cada linha tem o teste que reprovava e o commit que corrige. Os testes ficam em commits separados dos reparos.

| # | Defeito observado | Causa | Commit |
|---|---|---|---|
| 1 | Uma conta recém-criada gravava o próprio perfil com `isAdmin` e `isModerator` verdadeiros e passava a ler `access_agg_daily` e `trending_topics` | A regra de criação só exigia a presença dos campos | `4365159` |
| 2 | Qualquer usuário trocava o texto de comentário alheio, bastando somar +1 em `likes` na mesma gravação | Regra de comentário com `hasAny` em vez de `hasOnly` | `a074a44` |
| 3 | Qualquer usuário logado listava todas as conversas (com a última mensagem) e todas as notificações do sistema | As regras de `list` só pediam estar autenticado | `9cc2aed` |
| 4 | Um terceiro criava a conversa de dois outros e ocupava o id; C abria conversa e mandava mensagem a quem escolheu "ninguém" (o bloqueio também passou a valer nas regras) | Preferência de DM e bloqueio só eram conferidos no navegador | `5a011cc` |
| 5 | A conversa nunca guardava a última mensagem nem as não lidas: contador do menu, selo da lista e `totalUnreadMessages` ficavam sempre zerados | Só a callable `onMessageCreated` os escrevia e nenhum cliente a chamava | `38e3a8b` |
| 6 | Qualquer pessoa, sem login, forjava a prévia e o remetente de uma conversa e inflava as não lidas | A mesma callable era pública | `38e3a8b` (removida) |
| 7 | Preferências de notificação, bloqueios e contas silenciadas não tinham efeito | Nenhuma Function os lia | `38e3a8b` |
| 8 | A notificação "nova conversa" ia para quem iniciou, quando ele tinha o maior id | A Function usava `participantIds[0]` (lista ordenada) como "quem iniciou" | `38e3a8b`, `d7b16ae` |
| 9 | "Pessoas que você segue" liberava quem segue o alvo e barrava quem o alvo segue | O cliente conferia `followers/{eu}` em vez de `following/{eu}` | `d7b16ae` |
| 10 | A rota `/api/extract-article` devolvia o conteúdo de serviços internos (SSRF) | `fetch(url)` de qualquer URL, sem login e seguindo redirecionamentos | `ff88685` (teste: `d08fb42`) |
| 11 | Qualquer usuário somava +1 em `likes` de post ou comentário sem curtir | O contador liberado na regra, mas gravado só pelas Functions | `b8a166d` |
| 12 | A imagem de um post apagado continuava no Storage e legível sem login | `deletePost` não apagava a mídia; leitura pública em `user_uploads/` | `7e42fd2` |
| 13 | Sem login, listar `user_uploads/{uid}/` devolvia todos os arquivos do usuário, inclusive anexos de mensagens | `allow read: if true` também libera `list` | `5662c87` |
| 14 | Política de privacidade e termos mostravam e-mails de exemplo como contato real | `mailto:` fixo no código | `9fe0621` |
| 15 | O service worker nunca instalava, o manifest não era visto pelo Chrome e o cache guardava dados do Firestore e do Storage | Detalhes em `docs/pwa.md` | `6e58ce8`, `7edccf2`, `5ed57c4` |

## O que continua falhando

Nenhum item abaixo foi alterado por esta etapa: cada um precisa de uma decisão ou de uma mudança de desenho maior.
"Bloqueia a abertura" é a minha avaliação.

| # | Verificação que falha | Observado | Causa | Plano | Bloqueia a abertura? |
|---|---|---|---|---|---|
| R1 | `users` não pode ser listado sem login; consulta com filtro não pode devolver perfil privado | Anônimo lista todos os perfis com **e-mail e data de nascimento**; uma consulta devolve até o perfil "privado" | `allow list: if true` em `users`, e o documento mistura dados públicos e privados (a busca e as menções dependem da listagem) | Dividir o perfil: dados públicos em `users/{uid}`; e-mail, data de nascimento, preferências e silenciados em `users/{uid}/private/...` (só o dono). Como o banco novo nasce vazio, não há migração. Mexe em `createUserProfile`, `authService`, `getUser`, configurações e regras | **Sim** (LGPD) |
| R2 | Listar `posts` não pode devolver posts privados nem "só seguidores" | Anônimo e logado listam posts privados | `allow list: if true` ("o cliente filtra") | Regra de `list` exigindo `visibility == 'public'` e as consultas do app passando a filtrar por isso, com listagens próprias para o dono e para seguidores | **Sim**, se "privado" e "só seguidores" forem funcionalidades anunciadas |
| R3 | Storage: sem login não se lê o arquivo de A | Quem conhece o endereço exato lê (a listagem já foi fechada) | `allow get: if true` em toda a pasta `user_uploads/` | Caminho próprio para anexos de mensagens e arquivos pessoais, com regra por participante (leitura cruzada com o Firestore) | Sim para anexos de mensagens; imagens públicas de perfil e post ficam como estão |
| R4 | Contadores `followersCount`, `views` e `analytics` forjáveis | Qualquer logado soma +1 ou grava análise no post de outro, quantas vezes quiser | O cliente grava esses contadores e as regras só conferem "+1" | Mover os contadores para Functions (como já é com curtidas) e as análises para um endpoint com limite | Não (integridade; monitorar) |
| R5 | `access_events` sem login | Qualquer pessoa cria eventos de acesso | `allow create: if true`; o limite de taxa existe só na rota e é contornável (o IP vem do corpo ou de `X-Forwarded-For`) | A rota gravar com Admin SDK, regra `create: if false`, validar formato e limitar por IP confiável | Não (custo/ruído), mas tratar antes de ter tráfego |
| R6 | RTDB: `/guests` público para leitura e escrita | Qualquer pessoa grava dado arbitrário de qualquer tamanho | Regra `.write: true` no nó inteiro, sem `.validate` | Ver `docs/presenca.md` (decisão sobre visitantes pendente) | Não, mas é abuso de custo |
| R7 | `/api/extract-article` exige login | Responde 200 a chamadas anônimas | A rota não verifica identidade nem limita taxa; segue servindo de proxy para a internet pública | Exigir ID token do Firebase (a verificar no servidor) e limite por usuário | Não (a parte de rede interna foi corrigida) |
| R8 | Presença depois de sair da conta | `/status/{uid}` fica `isOnline: true` para sempre | o `onDisconnect` registrado antes do `signOut` não chega a rodar e a escrita "offline" do app vem depois, sem credencial (negada pelas regras) | Já analisado em `docs/presenca.md`, aguardando decisão | Não |
| R9 | Perfil privado | Quem não segue vê "User Not Found" em inglês; não existe fluxo de "aprovar seguidores" que a tela promete | O perfil é ilegível pelas regras e a interface não trata o caso | Decisão de produto: pedido de seguir ou remover a promessa; ao menos uma mensagem clara | Não |

## Riscos que os testes não cobrem

- **Índices compostos do Firestore** (o emulador não os valida): as três consultas de `searchPosts` (`visibility` +
  `isDeleted` + ordenação, com e sem `category` e `likes`) não têm índice correspondente em `firestore.indexes.json`. Em
  produção a busca de posts e artigos tende a falhar com "requires an index". Verificar no projeto novo, com o Firestore real.
- **Índices de campo único de grupo de coleções**: as buscas `collectionGroup(...).where("userId", "==", ...)` sobre `comments`,
  `likes` e `reposts` (limpeza de conta e propagação de nome e foto) falham em produção com `FAILED_PRECONDITION`: os três
  índices não existem no banco `echo-db-124325` (confirmado em 2026-10-25 por consulta direta e pelos logs de
  `onUserDeletedCleanup`). Detalhes e a correção proposta em `docs/limite-de-cadastro.md`.
- **Cadastro em massa e enumeração**: `createUserProfile` e `checkAvailability` são públicas por desenho (o cadastro ainda não
  tem login), sem App Check nem captcha. Desde 2026-10-25 existe o limite das 500 primeiras vagas (`docs/limite-de-cadastro.md`),
  que impede passar de 500 contas, mas um robô ainda pode ocupar todas as vagas; `checkAvailability` revela se um e-mail ou
  nome já existe.
- **`/api/log-access`** confia em um IP que o cliente pode informar no corpo ou em `X-Forwarded-For`.
- Faltam cabeçalhos de segurança (CSP, nosniff, Referrer-Policy), o push web está incompleto e o painel de administração e
  de moderação, a exclusão de conta e a exportação de dados não foram exercitados.
- Telas não percorridas: rascunhos, feeds personalizados, hashtags e tendências, citação, repost de comentário, edição de
  post, ajustes de interação e mídia.

## Como reproduzir

Pré-requisitos em `docs/emuladores.md`.

```powershell
npm run emulators                      # terminal 1
# build de produção em modo emulador e `next start -p 9002` com REVALIDATE_SECRET e EXTRACT_ARTICLE_ALLOW_LOOPBACK (terminal 2)
$env:E2E_NODE_MODULES = 'E:\Soberan\tools\e2e\node_modules'; $env:E2E_BROWSER = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$env:E2E_RESET = '1'; $env:E2E_OUT = 'E:\Soberan\tools\logs\e2e\fluxos'
npm run e2e:fluxos                     # tudo; ou E2E_ONLY=social,mensagens,artigos,midia,perfil,autorizacao
npm run e2e:safe-fetch                 # SSRF, sem emuladores
```

Saída: `matrix.md` e `matrix.json` (cada verificação com resultado e detalhe), capturas de tela e o resumo no console.
Mudou `firestore.rules`? Reinicie os emuladores: o recarregamento a quente só atinge o banco `(default)`.

## Apêndice: todas as verificações

Antes = estado medido antes de qualquer correção (commit `9b53de7`); depois = estado atual da branch. "—" = verificação criada ou renomeada depois.


**preparação**

| Verificação | Antes | Depois |
|---|---|---|
| pré-checagem: emuladores no ar e app respondendo | passou | passou |
| cadastro pela interface do usuário A (e2e_mvaeczlfa) | — | passou |
| cadastro pela interface do usuário B (e2e_mvaeczlfb) | — | passou |
| cadastro pela interface do usuário C (e2e_mvaeczlfc) | — | passou |

**social: preparação**

| Verificação | Antes | Depois |
|---|---|---|
| B publica o post que receberá as interações | passou | passou |

**social: seguir e deixar de seguir**

| Verificação | Antes | Depois |
|---|---|---|
| A segue B pela interface: o botão vira "Seguindo" e o contador de seguidores de B mostra 1 | passou | passou |
| seguir: following/followers e os dois contadores gravados nos emuladores | passou | passou |
| seguir: a Function onUserFollowed criou a notificação new_follower para B (autor A) | passou | passou |
| A deixa de seguir B pela interface: o botão volta a "Seguir" | passou | passou |
| deixar de seguir: documentos removidos e contadores de volta a 0 nos emuladores | passou | passou |
| A volta a seguir B (estado usado pelas próximas seções) | passou | passou |

**social: curtir e descurtir**

| Verificação | Antes | Depois |
|---|---|---|
| A curte o post de B pela interface: botão pressionado e contador 1 | passou | passou |
| curtir: like gravado, contador do post = 1 (Function onPostLiked) e notificação like_post para B | passou | passou |
| A descurte: like removido e contador do post volta a 0 (Function onPostUnliked) | passou | passou |
| A curte de novo (estado usado pelas notificações) | passou | passou |

**social: repostar e desfazer**

| Verificação | Antes | Depois |
|---|---|---|
| A reposta o post de B pelo menu: botão pressionado e contador 1 | passou | passou |
| repostar: documento reposts/{A} e contador reposts = 1 gravados | passou | passou |
| A desfaz o repost: documento removido e contador volta a 0 | passou | passou |

**social: comentar**

| Verificação | Antes | Depois |
|---|---|---|
| A comenta no post de B: aparece na página e commentsCount = 1 | passou | passou |
| comentar: a Function onCommentCreated criou a notificação comment_on_post para B | passou | passou |
| curtir um comentário: like gravado e contador do comentário = 1 (Function onCommentLiked) | — | passou |

**social: notificações e contadores de B**

| Verificação | Antes | Depois |
|---|---|---|
| B vê no menu o contador de não lidas = total de notificações e a lista na página | passou | passou |
| B marca todas como lidas: contador do menu some e readAt gravado em todas | passou | passou |

**mensagens: conversa entre A e B**

| Verificação | Antes | Depois |
|---|---|---|
| A abre a conversa com B, envia a mensagem e ela aparece na conversa | passou | passou |
| mensagem gravada: conversa A_B com os dois participantes e a mensagem de A na subcoleção | passou | passou |
| a Function onDirectMessageCreated criou a notificação new_message para B | passou | passou |
| o documento da conversa guarda a última mensagem e 1 não lida para B | **FALHOU** | passou |
| B recebe: o contador de mensagens do menu mostra 1 e users/B.totalUnreadMessages = 1 | **FALHOU** | passou |
| B vê a conversa com A na lista, com o texto da última mensagem e o selo de não lida | **FALHOU** | passou |
| B abre a conversa, lê a mensagem e responde; A recebe a resposta em tempo real | passou | passou |
| ao abrir a conversa, B zera as não lidas: unreadCounts[B] = 0 e totalUnreadMessages = 0 | passou | passou |
| A volta à lista de conversas e vê a resposta de B como última mensagem | passou | passou |
| diagnóstico: chamar a callable onMessageCreated à mão atualiza a conversa (prova que só faltava alguém chamá-la) | passou | passou |

**mensagens: preferência de DM e bloqueio (conversas novas de C com B)**

| Verificação | Antes | Depois |
|---|---|---|
| B escolhe "ninguém": C não consegue iniciar uma conversa com B pela interface | passou | passou |
| B escolhe "pessoas que você segue": C, que B NÃO segue mas SEGUE B, não pode iniciar (ordem do filtro) | **FALHOU** | passou |
| B escolhe "pessoas que você segue": C, que B SEGUE, deve conseguir iniciar a conversa | **FALHOU** | passou |
| limpeza: preferência de B volta a "todos" e as relações de teste são removidas | passou | passou |

**mensagens: notificação de nova conversa**

| Verificação | Antes | Depois |
|---|---|---|
| Function onConversationCreated: a notificação "nova conversa" vai para quem RECEBE, não para quem iniciou | — | passou |

**artigos: criar a partir de uma URL**

| Verificação | Antes | Depois |
|---|---|---|
| A extrai o artigo da URL de fixture e a página mostra título e fonte | passou | passou |
| A compartilha como artigo (categoria + Publicar) e o artigo é gravado como category=news | passou | passou |

**artigos: ler e interagir**

| Verificação | Antes | Depois |
|---|---|---|
| B abre o artigo e vê título e corpo | passou | passou |
| B curte o artigo: like gravado e contador do artigo = 1 | passou | passou |
| B comenta o artigo e o comentário aparece | passou | passou |
| o dono A recebe as notificações de curtida e comentário do artigo | passou | passou |

**artigos: segurança da extração (/api/extract-article)**

| Verificação | Antes | Depois |
|---|---|---|
| a extração recusa redes internas e o servidor de metadados da nuvem (SSRF), sem tentar conectar | — | passou |
| a extração exige login (sem cookie nem token, qualquer pessoa usa o servidor para buscar páginas) | **FALHOU** | **FALHOU** |

**mídia: imagem em post**

| Verificação | Antes | Depois |
|---|---|---|
| A anexa uma imagem pela tela de postagem, espera o envio terminar e publica o post | — | passou |
| o arquivo foi para user_uploads/{A}/postMedia/images/ e o post guarda a URL do Storage | passou | passou |
| A e B enxergam a imagem do post na página do post (a imagem carrega de verdade) | passou | passou |

**mídia: anexo em mensagem privada**

| Verificação | Antes | Depois |
|---|---|---|
| A anexa uma imagem numa mensagem para B e ela aparece na conversa | passou | passou |
| o anexo foi para user_uploads/{A}/dms/images/ e a mensagem guarda fileUrl e fileType | passou | passou |
| B abre a conversa e vê a imagem anexada (carrega de verdade) | passou | passou |

**mídia: exclusão**

| Verificação | Antes | Depois |
|---|---|---|
| A deleta o post pela interface: o post some do Firestore (ou fica marcado como apagado) | passou | passou |
| apagar o post TAMBÉM apaga a imagem dele no Storage (senão ela fica pública e pagando armazenamento) | **FALHOU** | passou |
| post com resposta: apagar deixa um "túmulo" sem texto nem lista de mídia e apaga a imagem do Storage | — | passou |
| tela /files: enviar, listar e apagar arquivos pessoais | não implementado | não implementado |

**perfil: editar o próprio perfil**

| Verificação | Antes | Depois |
|---|---|---|
| A edita nome e bio pelo diálogo "Editar Perfil" e vê o resultado na página | passou | passou |
| perfil editado: name, name_lowercase e bio gravados; B vê o nome novo na página de A | passou | passou |
| A troca o avatar (envio, recorte e salvar): objeto em user_uploads/{A}/avatars/ e avatarUrl aponta para ele | passou | passou |

**perfil: busca**

| Verificação | Antes | Depois |
|---|---|---|
| B busca pelo nome de A: a aba "Pessoas" lista A, com link para o perfil | passou | passou |
| a caixa de busca do cabeçalho sugere A ao digitar parte do @usuário | passou | passou |
| um artigo é encontrado pela aba "Artigos" da busca (por palavra do título) | passou | passou |

**perfil: configurações persistidas**

| Verificação | Antes | Depois |
|---|---|---|
| Privacidade: "Perfil Privado" grava profileVisibility = private | passou | passou |
| perfil privado: quem não segue vê um aviso claro de perfil privado (não "não encontrado") | **FALHOU** | **FALHOU** |
| Privacidade: "Perfil Privado" desligado volta a gravar public | passou | passou |
| Privacidade: a opção de mensagens "Ninguém" grava dmPreference = none (e "Todos" volta) | passou | passou |
| Notificações: desligar "curtidas" grava notificationPreferences.likes = false | passou | passou |
| Notificações: com "curtidas" desligadas, a curtida de B NÃO gera notificação para A (preferência respeitada) | **FALHOU** | passou |
| Notificações: religar "curtidas" (limpeza) | passou | passou |
| Conteúdo silenciado: adicionar uma palavra grava em mutedWords | passou | passou |
| Aparência: escolher "Escuro" aplica a classe dark e "Claro" a remove | passou | passou |
| Idiomas: trocar para English leva a /en e traduz a interface; voltar para Português | passou | passou |

**perfil: bloqueio e silenciar**

| Verificação | Antes | Depois |
|---|---|---|
| A bloqueia B pela interface: grava users/A/blockedUsers/B e B não consegue mais mandar notificação a A | passou | passou |
| bloqueado: a curtida de B em um post de A NÃO notifica A | **FALHOU** | passou |
| limpeza: A desbloqueia B | passou | passou |

**perfil: sair da conta**

| Verificação | Antes | Depois |
|---|---|---|
| Configurações → Sair → confirmar leva à tela de login e o app deixa de reconhecer o usuário | passou | passou |
| sair da conta: o status de presença de A no RTDB fica offline (senão A aparece online para sempre) | **FALHOU** | **FALHOU** |

**autorização: preparação dos dados (administrador do emulador)**

| Verificação | Antes | Depois |
|---|---|---|
| semear posts, comentário, conversas, mensagens, notificação, arquivo e objeto no Storage | passou | passou |

**autorização: usuários e perfis**

| Verificação | Antes | Depois |
|---|---|---|
| sem login, listar a coleção users NÃO devolve e-mails nem datas de nascimento | **FALHOU** | **FALHOU** |
| C, logado, consulta users com filtro e NÃO recebe o perfil PRIVADO de A (nem e-mail) | **FALHOU** | **FALHOU** |
| C lê (get) o documento do perfil PRIVADO de A | passou | passou |
| C altera o nome do perfil de A | passou | passou |
| C se promove a administrador (users/C.isAdmin = true) | passou | passou |
| C apaga o perfil de A | passou | passou |
| C infla os seguidores de A sem seguir ninguém (followersCount + 1) | **FALHOU** | **FALHOU** |
| uma conta recém-criada NÃO consegue gravar o próprio perfil com isAdmin = true (escalada de privilégio) | **FALHOU** | passou |

**autorização: posts, curtidas e comentários**

| Verificação | Antes | Depois |
|---|---|---|
| controle: sem login, qualquer um lê um post PÚBLICO | passou | passou |
| C lê (get) o post PRIVADO de B | passou | passou |
| C lê (get) o post só-para-seguidores de B sem seguir | passou | passou |
| C, ao LISTAR posts, NÃO recebe posts privados nem só-para-seguidores de B | **FALHOU** | **FALHOU** |
| sem login, a listagem de posts NÃO traz posts privados | **FALHOU** | **FALHOU** |
| C edita o texto do post de B | passou | passou |
| C apaga o post de B | passou | passou |
| C marca o post de B como apagado (isDeleted) | passou | passou |
| C cria um post em nome de B (userId = B) | passou | passou |
| C cria um like em nome de A | passou | passou |
| C apaga o like de A | passou | passou |
| C infla as curtidas do post de B sem curtir (likes + 1) | **FALHOU** | passou |
| C infla as curtidas do COMENTÁRIO de B sem curtir (likes + 1) | — | passou |
| C infla as visualizações do post de B (views + 1) | **FALHOU** | **FALHOU** |
| C grava na análise (analytics) do post de B, que só o dono deveria alimentar | **FALHOU** | **FALHOU** |
| C altera o TEXTO do comentário de B junto com um +1 em likes (regra hasAny) | **FALHOU** | passou |
| C altera só o texto do comentário de B | passou | passou |
| C apaga o comentário de B | passou | passou |

**autorização: mensagens privadas**

| Verificação | Antes | Depois |
|---|---|---|
| C lê (get) a conversa entre A e B | passou | passou |
| C, ao LISTAR conversas, NÃO recebe conversas alheias (nem a última mensagem delas) | **FALHOU** | passou |
| C lista as mensagens da conversa entre A e B | passou | passou |
| C lê (get) uma mensagem da conversa entre A e B | passou | passou |
| C escreve uma mensagem na conversa entre A e B (senderId = C) | passou | passou |
| C escreve uma mensagem na conversa entre A e B se passando por A (senderId = A) | passou | passou |
| C apaga uma mensagem de A | passou | passou |
| C altera a prévia (lastMessageText) da conversa entre A e B | passou | passou |
| A (de fora) lê as mensagens da conversa entre B e C | passou | passou |
| controle: B (participante) lê as mensagens da conversa com A | passou | passou |
| B, de fora, NÃO consegue criar a conversa A_C (id de dois outros usuários) e ocupar o lugar dela | **FALHOU** | passou |
| C NÃO consegue abrir conversa com A que escolheu "ninguém" nas mensagens (preferência imposta pelas regras) | **FALHOU** | passou |
| C NÃO consegue abrir conversa com A, que bloqueou C (o bloqueio também vale nas regras) | — | passou |
| chamar a callable onMessageCreated SEM login, forjando remetente e texto, é recusado | **FALHOU** | passou |

**autorização: notificações**

| Verificação | Antes | Depois |
|---|---|---|
| C NÃO consegue listar as notificações de B | **FALHOU** | passou |
| sem limite, C NÃO consegue listar TODAS as notificações do sistema | **FALHOU** | passou |
| C lê (get) uma notificação de B | passou | passou |
| C marca como lida a notificação de B | passou | passou |
| C cria uma notificação para B | passou | passou |
| B altera o texto da própria notificação (só readAt pode mudar) | passou | passou |
| controle: B marca a própria notificação como lida | passou | passou |

**autorização: arquivos, Storage e outras coleções**

| Verificação | Antes | Depois |
|---|---|---|
| C lê (get) o registro de arquivo de A (userFiles) | passou | passou |
| C lista os arquivos de A (userFiles) | passou | passou |
| C cria um registro de arquivo em nome de A | passou | passou |
| C apaga o registro de arquivo de A | passou | passou |
| Storage: C grava um arquivo na pasta de A | passou | passou |
| Storage: C apaga o arquivo de A | passou | passou |
| Storage: sem login ninguém grava | passou | passou |
| Storage: gravar fora de user_uploads/ é recusado | passou | passou |
| Storage: arquivo acima de 5 MB é recusado | passou | passou |
| controle: C grava na própria pasta do Storage | passou | passou |
| Storage: sem login NÃO se lê o arquivo privado de A (anexos de mensagens e arquivos pessoais) | **FALHOU** | **FALHOU** |
| Storage: sem login NÃO se listam os arquivos de um usuário (o id é público: daria para baixar todos os anexos de mensagens) | — | passou |
| trending_topics: C (não administrador) não lê | passou | passou |
| access_agg_daily: C (não administrador) não lê | passou | passou |
| access_events: C (não administrador) não lê | passou | passou |
| access_events: qualquer pessoa, sem login, NÃO grava eventos de acesso falsos direto no Firestore | **FALHOU** | **FALHOU** |
| reports: C não lê denúncias | passou | passou |
| reports: C cria denúncia em nome de outro usuário (reporterId = A) | passou | passou |
| usernames: C reserva um nome de usuário em nome de A | passou | passou |
| Functions: updateUserUsername sem login é recusada | passou | passou |
| RTDB: sem login ninguém grava dado arbitrário em /guests | **FALHOU** | **FALHOU** |
| limpeza: o perfil de A volta a ser público | passou | passou |

**isolamento**

| Verificação | Antes | Depois |
|---|---|---|
| o navegador não falou com nenhum endpoint real do Google/Firebase | passou | passou |
