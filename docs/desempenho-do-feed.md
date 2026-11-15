# Desempenho e rolagem do feed (celular e app)

Atualizado em 2026-10-26. Resultado de uma investigação medida da rolagem do feed no Android: por que o feed "prendia", o que foi
mudado, como medir de novo e as regras para não regredir. Os números são de **antes** (código publicado, commit `4fe7667`) e
**depois**, no mesmo computador, com a mesma suíte (`e2e/feed-scroll-perf.mjs`).

## 1. O sintoma e as duas causas

"A rolagem parece prender, perde fluidez ou disputa o gesto com algum componente." Havia **dois** problemas diferentes.

### Causa 1 (a que prende de verdade): `touch-action` no topo do feed

`FeedContainer` aplicava `touch-action: pan-x pan-up pinch-zoom` enquanto a página estava no topo (para "entregar ao app o puxão
para baixo"). Em CSS, **`pan-up` libera rolar a página para CIMA** (dedo para baixo), o contrário do que o comentário do código
dizia. Com isso, **a rolagem para baixo (dedo para cima) ficava bloqueada pelo navegador enquanto `scrollY` era 0**: a pessoa
abria o feed e o primeiro deslize não fazia nada. Fora do topo a regra saía e rolava normal, por isso parecia "prender".

Medido em **produção**, num Android 15 (emulador, Chrome 124), com dedos reais (`adb shell input swipe`), recarregando a página
antes de cada tentativa:

| | deslizes a partir do topo que rolaram a página |
|---|---|
| produção (`4fe7667`) | **0 de 4** (`scrollY` continua 0; `touch-action: ... pan-x pan-up pinch-zoom` no contêiner do feed) |
| correção (`ebfd1bb`) | **4 de 4** (`scrollY` ≈ 650 depois de um deslize) |

No **app** (WebView do Capacitor, versão 1.2.1, que abre o site) o mesmo: três deslizes no topo deixaram a tela idêntica
(captura de tela com o mesmo hash). Como o app abre o site, **publicar o site corrige o app, sem APK novo**.

A medição do navegador simulado (Playwright, 412x915 com toque) concorda: 0 de 10 arrastos a partir do topo rolaram no código
antigo, 10 de 10 no corrigido.

### Causa 2 (a que faz perder fluidez): rolar redesenhava o feed inteiro

Com a página fora do topo, cada mudança de direção da rolagem disparava estado do React em vários lugares (o cabeçalho no
`AppLayout`, a posição das abas no `HomeFeedTabs` e **um ouvinte de rolagem em cada cartão do feed**), e vários contextos mudavam
de valor a cada evento (o do feed, o do usuário). Num feed de 60 cartões isso redesenhava milhares de componentes por commit.
Medido com um gancho do DevTools do React (injetado só no navegador de teste), CPU 4x mais lenta:

| situação (60 cartões no DOM) | antes: commits do React / componentes redesenhados | antes: quadros > 50 ms / tarefas longas / atraso máx. de entrada |
|---|---|---|
| 20 inversões de direção da rolagem | 204 commits / **1,49 milhão** | 124 / 123 / 486 ms |
| rolagem contínua (6 descidas, 3 subidas) | 31 / 140 mil | 25 / 31 / 513 ms |
| rolar e parar (10 vezes) | 25 / 142 mil | 13 / 13 / 403 ms |
| um seguidor novo (perfil de quem está logado muda) | 8 / 39 mil | 5 / 4 / – |
| uma mensagem não lida (dados privados do perfil) | 7 / 39 mil | 4 / 3 / – |
| a barra de endereços do Chrome some e volta (altura da janela muda) | **1563 commits** / 5 mil | 6 / 6 / – |
| carregar mais 50 cartões (montar) | 53 / 153 mil | 29 / 33 / – |

Outras fontes de trabalho escondido, achadas lendo o que cada cartão faz ao montar:

- cada cartão trazia **sete diálogos sempre montados e fechados** (compartilhar, enviar por mensagem, citar, editar, estatísticas,
  visualizador de imagem, aviso de login), cada um com os seus ganchos; o de estatísticas **lia o servidor para todo cartão** que
  aparecia (`getPostAnalytics` → `getPostById` + `analytics/summary`), e os de citar e editar escutavam o `visualViewport` (o
  que explica os 1563 commits quando a barra do Chrome some e volta);
- cada cartão chamava `canUserReply`, que **baixava o post inteiro de novo** para decidir quem pode responder, e de novo a cada
  curtida (o efeito dependia do objeto `post`);
- cada cartão instanciava as interações de um comentário que nunca usava (ramo morto) e três cartões de perfil com `useFollowToggle`;
- o `AppLayout` baixava a primeira página de notificações só para mostrar o número da barra; a `RightSidebar` (escondida abaixo
  de 1100 px) buscava tendências, artigos e sugestões no celular e **de novo a cada seguidor novo**;
- `PwaInstallBanner`: tela cheia com `backdrop-blur` sobre o feed que rola por baixo (aparece 5 s depois de abrir no celular);
- mídia sensível era desfocada com `blur-2xl` (filtro caro a cada quadro) e já baixava a imagem escondida.

## 2. O que mudou

| Onde | O quê |
|---|---|
| `FeedContainer`, `usePullToRefresh`, `PullToRefresh` | **sem `touch-action`**; puxar para atualizar por toques **passivos** (nada é impedido), só no topo (folga de 1 px), fora de janelas/menus, mais vertical que horizontal; o indicador anda por escrita direta de estilo (sem estado do React a cada movimento); aba escondida não responde; o botão de voltar ao topo muda por atributo/CSS, sem render React, e escondido não recebe toque |
| `src/lib/scrollChrome.ts`, `ScrollChrome`, `globals.css` (`.chrome-*`) | cabeçalho, navegação inferior, barra de comentar e abas fixas somem/voltam por **CSS** (`transform`), comandados por um único ouvinte passivo que só escreve `data-chrome` em `<html>`; decisão pelo deslocamento acumulado (a barra volta com 36 px para cima, sem piscar com a acomodação do dedo; antes só com 50 px por quadro) |
| `FeedContext` | estado dos feeds **fora do React** (`FeedStore` + `useSyncExternalStore`): ações fixas, cada lista assina só o seu feed, a posição de rolagem é gravada sem avisar ninguém |
| `CurrentUserContext` | idem para o usuário: `useCurrentUser()` igual ao de antes; `useCurrentUserId`, `useCurrentUserSelector`, `useViewerSummary` assinam só o que usam; perfil igual ao guardado não avisa ninguém |
| `PostCard`, `CommentCard` | `React.memo`; sem o ouvinte de rolagem; hora calculada na renderização; quem pode responder decidido com o post que já tem (`canUserReplyToLoadedPost`); sem as interações mortas de comentário |
| `MountOnceOpened` | os sete diálogos do cartão só existem depois de abertos (e ficam, para não perder o texto digitado) |
| `HomeFeedTabs`, `ProfileContentTabs` | sem estado de rolagem; a aba só carrega o feed na **primeira** vez em que é aberta; troca de aba arrastando por `useTabSwipe` (toque, sem captura do ponteiro, sem `touch-action`) |
| `useToast`, `useIsMobile` | `useToast()` não assina mais (só o `Toaster` assina); "é celular?" é uma consulta de mídia compartilhada |
| `AppLayout`, `RightSidebar` | o elemento da página é memoizado; contagem de notificações por um gancho que só lê o número; a barra lateral só busca conteúdo quando aparece (≥ 1100 px) |
| `PostCardContent`, `TopNewsItem`, `PwaInstallBanner` | imagens com `loading=lazy`/`decoding=async` e reserva 4:3 até carregar; mídia sensível coberta não baixa a mídia (sem desfoque); `content-visibility: auto` nos cartões; sem `backdrop-blur` no convite de instalar |

## 3. Regras para não regredir

1. **Nunca restrinja a rolagem com `touch-action`** num contêiner de página (`pan-x pan-up`, `pan-down`...). `pan-up` e
   `pan-down` falam da direção em que a **página** anda, não do dedo. A rolagem vertical é sempre nativa.
2. **Nenhum estado do React muda por causa da rolagem.** Mostrar/esconder barras é atributo + CSS (`scrollChrome`).
3. Ouvintes de `scroll`, `touchstart`, `touchmove` e `wheel` são **passivos**; nada chama `preventDefault` na rolagem.
4. Dados que mudam muito (feeds, perfil de quem está logado) ficam em repositório externo com assinatura por pedaço.
5. O cartão do feed é `memo` e não assina nada que mude sem relação com ele; diálogos do cartão entram por `MountOnceOpened`.
6. Antes de publicar mexendo no feed: `node e2e/scroll-logic-check.mjs`, a seção `rolagem` (`E2E_ONLY=rolagem`) e a suíte inteira.

## 4. Como medir

- **Lógica pura** (troca de aba, barras que somem): `node e2e/scroll-logic-check.mjs` (sem app nem emuladores).
- **Navegador simulado**: `node e2e/feed-scroll-perf.mjs --rotulo depois --url http://localhost:9005 --posts 72 --cpu 4 --repeticoes 3`
  (emuladores no ar + build de produção em modo emulador). Mede quadros longos, tarefas longas, atraso de entrada, CLS e, pelo
  gancho do DevTools do React, commits e componentes redesenhados; recusa um cenário em que a página não rolou (`rolouPx`).
  `--so a,b` roda só alguns cenários; `--css "regras"` compara uma regra de CSS no mesmo build.
- **Aparelho Android** (emulador `Medium_Phone_API_35`): `--android [--visitante]` conecta ao Chrome do emulador
  (`adb forward tcp:9222 localabstract:chrome_devtools_remote`, `adb reverse` das portas do app e dos emuladores do Firebase; o
  servidor local precisa escutar em IPv4: `next start -H 0.0.0.0`). Deslizes reais: `adb shell input swipe`.
- **Seção E2E** `rolagem` (`E2E_ONLY=rolagem`): começar o dedo em qualquer coisa só rola, o toque simples continua valendo, puxar
  para atualizar só no topo, troca de aba só com intenção horizontal, barras, orçamento de redesenhos, mídia sensível,
  `content-visibility`, ouvintes passivos.

### Armadilha de medição (já nos custou uma rodada)

`Input.synthesizeScrollGesture` com `gestureSourceType: 'touch'` **entrega os toques à página mas não rola nada** neste Chrome. As
primeiras medições "de rolagem" mediam toques que não rolavam (e por isso não viam a Causa 1). Os testes usam
`e2e/lib/touch.mjs` (`Input.dispatchTouchEvent`), mantêm o dedo dentro da janela (toque fora dela é descartado) e conferem que
a página andou.

## 5. Resultado depois

Medição final em build de produção, 72 posts mistos, 60 cartões no DOM, tela 412x915 e CPU 4x mais lenta. A rodada completa está nos logs internos de medição de desempenho.

| cenário | antes | depois |
|---|---|---|
| rolagem contínua | 31 commits / 140.153 componentes; 25 quadros > 50 ms; 31 tarefas longas; entrada máx. 513 ms | **0 commits / 0 componentes; 0 quadros > 50 ms; 0 tarefas longas; entrada máx. 46,5 ms** |
| 20 inversões de direção | 204 commits / 1.488.870 componentes; 124 quadros > 50 ms; 123 tarefas longas; entrada máx. 486 ms | **2 commits / 5 componentes; 0 quadros > 50 ms; 0 tarefas longas; entrada máx. 20,9 ms** |
| rolar e parar 10 vezes | 25 commits / 141.688 componentes; 13 quadros > 50 ms; 13 tarefas longas; entrada máx. 403 ms | **1 commit / 5 componentes; 0 quadros > 50 ms; 0 tarefas longas; entrada máx. 12,3 ms** |
| primeiro arrasto a partir do topo | **0 de 10** rolaram | **10 de 10** rolaram, sem commit React |
| seguidor novo | 8 commits / 39.178 componentes | **3 commits / 346 componentes** |
| mensagem não lida | 7 commits / 39.179 componentes | **3 commits / 348 componentes** |
| barra do navegador muda de altura | 1.563 commits / 5.112 componentes | **12 commits / 72 componentes** |
| carregar aproximadamente 60 cartões | 53 commits / 153.493 componentes; 29 quadros > 50 ms; 33 tarefas longas | **40 commits / 9.579 componentes; 16 quadros > 50 ms; 11 tarefas longas** |

O CLS medido depois das correções é **0,0000**. O carregador de paginação fica fora do fluxo e não é empurrado pelos novos
cartões. A seção E2E específica de rolagem passou **37 de 37** verificações, inclusive começar o gesto sobre botão, imagem,
texto, avatar, menu, aba e área vazia; pull-to-refresh no topo; troca horizontal deliberada; paginação; resposta otimista e
ausência de `pageErrors`.

Na validação funcional final, a matriz somou **410 verificações aprovadas e nenhuma falha real**. A única marca não implementada
continua sendo a tela `/files`, que já exibe “Funcionalidade em Construção” e não faz parte desta mudança. Os testes também
confirmaram isolamento total dos emuladores, o limite transacional de 500 cadastros, mensagens, mídia, artigos, notificações,
perfil privado, enquetes, conteúdo sensível, vibração e gestos.
