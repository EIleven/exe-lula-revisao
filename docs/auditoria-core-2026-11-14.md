# Auditoria do core: identidade, sincronia com o Fediverso e feeds (2026-11-14)

Escopo: `@Breno` ↔ `@Breno@exercitodolula.app` (uma pessoa, um UID), sincronia bidirecional com contas locais, contas
federadas daqui e contas externas, e os feeds. Código em `feat/federacao` @ `5b63f2e`; produção `echo-b5aw9`, lida **só em
leitura**. Tudo o que está abaixo como "corrigido" está em commits da branch `audit/core-identidade-feeds`, testado
localmente e **sem deploy**. O que mexe em produção está em "Pendências que pedem decisão".

## 1. Estado real em produção (somente leitura)

| Fato | Valor |
|---|---|
| Plataforma de federação | **ligada** (`config/federation.enabled = true`, alterada em 2026-11-12 às 21:34 UTC; a nota de implantação ainda diz "etapa A, desligada") |
| UID do @Breno | `qdnRsBvLG8NdwrLv9GwiHDa1xi42` (`usernames/breno` e `ap_handles/breno` apontam para ele) |
| Seguidores do @Breno | 124 em `users/{uid}/followers` (leitura de 2026-11-14): 32 locais + 92 do Fediverso, de 38 servidores (organica.social 21, mastodon.social 15, ursal.zone 9) |
| Seguindo | 1.482: 61 locais + 1.421 do Fediverso |
| `ap_followers` do @Breno | 110 registros; **18 sem espelho** em `users/{uid}/followers` (recebem os posts, mas não aparecem na lista, não contam e não geram "Segue você"); nenhum espelho sem registro |
| `ap_following` do @Breno | 1.415 registros; **6** entradas do Fediverso em `following` sem registro em `ap_following` (um é o fantasma; os outros: `canaltech@flipboard.com` e quatro de `organica.social`) |
| **Fantasma do próprio domínio** (estado **antes** da correção) | `users/ap_2848a6996789df85f186cb55`, `remoteActorId = https://exercitodolula.app/ap/users/breno`; estava nos "seguindo" do próprio @Breno (e ele constava como seguidor do fantasma); 3 posts-cópia, o mais recente criado em 2026-11-14 às 10:58 UTC. **Removido** depois da publicação da correção (§3) |
| @Breno **depois** da reconciliação (leitura de 2026-11-14, 16:50 UTC) | 142 seguidores (32 locais + 110 do Fediverso, iguais aos 110 de `ap_followers`) e 1.496 seguindo (61 locais + 1.435 do Fediverso, iguais aos 1.435 de `ap_following`); o fantasma e as 3 cópias não existem mais |
| Posts remotos duplicados | lendo **todos** os 15.960 posts remotos (a primeira leitura parava nos 5.000 primeiros e mostrava 1 grupo em 1.500): **337 grupos** com mais de um id para a mesma página. Por evidência: 243 cópias REDUNDANTES (mesmo autor e texto) e 49 de AUTOR ERRADO, sem interação local; 45 pedem decisão manual |
| **Posts remotos com o autor errado** | **1.766 de 15.960 (11%)** gravados em nome de quem apenas **impulsionou** o post: o post de A aparece como se fosse de B (ex.: página `organica.social/@sr_renato/…` gravada como de `ivanzigoni@organica.social`; `mastodon.social/@zer0billionaires/…` como de `postman@mas.to`). Causa: o sincronismo de perfil antigo (corrigido) |
| Posts remotos sem `remoteInbox` | 336 (não dá para curtir nem responder a eles pela fila) |

## 2. Achados e o que foi feito

Severidade: **A** = segurança ou integridade dos dados; **B** = defeito funcional visível; **C** = custo, manutenção.
Linhas são as de `5b63f2e`, antes das correções.

### Identidade e segurança

| # | Sev. | Achado | Onde | Correção |
|---|---|---|---|---|
| 1 | A | `resolveRemoteProfile` aceitava o `id` e o `inbox` que o servidor remoto declarasse: um servidor hostil podia gravar, por `merge`, dados dele no perfil em cache de OUTRO ator, inclusive o `remoteInbox`, para onde vão DMs, curtidas e respostas | `remoteProfile.ts:208,218-221` | `validateFetchedActor` (id = URL pedida, usuário, host, inbox no mesmo host); WebFinger só aponta para ator do domínio do handle e nunca para um nosso |
| 2 | A | `/api/ap/remote-profile` **gravava no banco sem login** (a identificação era opcional) | `remote-profile/route.ts:27-50` | exige login; limite por UID; `perfil-local` devolve o UID local |
| 3 | A | A sincronização reescrevia texto e autor de post remoto já guardado, mesmo de outro ator, e criava posts "de terceiros" só com o que o mensageiro afirmava (post-pai de resposta, original de repost) | `remoteMaterialize.ts:99-343` | só o MESMO ator atualiza; terceiro só entra depois de buscado no servidor do autor (`fetchVerifiedNote`) e com o autor validado por `resolveRemoteActor`; usuário de terceiro só é criado se não existir |
| 4 | A | `Announce`: o objeto buscado não precisava ter o id pedido nem morar no host do autor declarado; um Note servido por `evil.com` dizendo ser de outra pessoa ia para o feed com o nome dela | `inbox.ts:463-483` | id igual ao pedido e `host(objeto) = host(autor)` |
| 5 | A | O GET assinado usava a chave privada do **primeiro handle ativo** (`alexandre`), copiada em dois lugares, decifrada em cache na memória para sempre; todo servidor via as buscas como sendo dele | `remoteProfile.ts:75-95`, `federation.ts:62-86` | ator da instância (`/ap/actor`, Application) com chave própria, cifrada (AAD `@instance`) e única mesmo com criação simultânea |
| 6 | B | **Fantasma do @Breno** e posts-cópia: resposta ou repost do Fediverso a um post dele, ao sincronizar o perfil de quem respondeu, recriava post-pai e autor como `ap_…` | `remoteMaterialize.ts:138-196,243-300` | item do nosso domínio é ignorado (o inbox trata); `remoteIdentity` é a única fonte de "o que é nosso" |
| 7 | B | Abrir `@x@exercitodolula.app` (`/fediverse/[handle]`) dava `use-busca-local` em vez do perfil | `fediverse/[handle]/page.tsx` | abre `/profile/<uid>` (`ap_handles` primeiro, depois `usernames`) |
| 8 | C | O hash `ap_<sha256>` recalculado à mão em 25 pontos; a regra do domínio próprio existia só em dois lugares | `firestoreStore.ts`, `inbox.ts`, rotas, `remoteConnections.ts`, `remotePostInteractions.ts` | `remoteIdentity.ts`; a guarda do `e2e:ap-identidade` falha se alguém voltar a montar `ap_${hash}` |

### Sincronia bidirecional

| # | Sev. | Achado | Onde | Correção |
|---|---|---|---|---|
| 9 | B | Curtir ou repostar um **comentário** nosso contava como curtida do post e notificava a pessoa errada | `inbox.ts:306-317,351-366,405-420` | marcador no comentário; o portão é o do autor DO COMENTÁRIO |
| 10 | B | `Accept`, `Reject`, `Update` ignorados: o follow é gravado "Seguindo" por antecipação e conta trancada ficava "Seguindo" para sempre; edições remotas não chegavam | `inbox.ts:219` | Accept marca `ap_following` como aceito; Reject desfaz o vínculo; Update edita (só o autor) |
| 11 | B | `Delete` só removia comentário: post apagado na origem seguia nos feeds; conta removida deixava o conteúdo | `inbox.ts:343-349` | túmulo (fora dos feeds) para post e para o conteúdo do ator removido |
| 12 | B | O mesmo post remoto com dois ids (inbox pelo `uri`, perfil pela URL da página) aparecia duas vezes | `remoteMaterialize.ts:76`, `remoteProfile.ts:325` | id sai do `uri`, ids antigos são reconhecidos; o feed deduplica por `remoteUrl` |
| 13 | B | 18 seguidores remotos sem espelho em `users/{uid}/followers`: recebem os posts, mas não aparecem, não contam e não geram "Segue você" | `5603cc0` chegou depois deles | `scripts/reconciliar-federacao.mjs` (simulação por padrão) |
| 14 | C | A Function de posts enfileirava federação (um `Delete`) para post remoto apagado | `functions/src/federation.ts:180` | post `ap_` nunca enfileira (**pede deploy nominal de `apPostFederation`**) |

### Feeds

| # | Sev. | Achado | Onde | Correção |
|---|---|---|---|---|
| 15 | B | Paginação perdia itens quando vários tinham a mesma data (o `published` do Fediverso tem precisão de segundo): a página cortava no meio do empate e o cursor `<` estrito deixava o resto para trás | `postReadService.ts:614-643` | `janelaDeAtividades` (pura, testada): nunca corta empate e a próxima consulta começa na fronteira. Em 162 cenários recuperáveis com muitos empates, o desenho antigo perdeu itens em 130 e o novo em 0 |
| 16 | B | `fetchActivityFeed` descartava itens que o cursor já tinha deixado para trás (teto de `limit` somando rodadas magras) | `postReadService.ts:667-673` | sem teto |
| 17 | C | `getFollowedUserIds` lia as 1.299 entradas de `following` a cada chamada, até 3 por página do Seguindo, e de novo a cada reinício do aviso de novos posts | `userService.ts:373-382`, `HomeFeedTabs.tsx:203,214` | cache de 60 s, com leitura única, sem guardar leitura que falhou nem a que ficou velha, invalidado por `dispatchFollowState` |
| 18 | C | ~130 ouvintes "só seguidores" para contas `ap_` (que nunca têm esse tipo de post) | `HomeFeedTabs.tsx:216-218` | só IDs locais |
| 19 | B | O aviso de novos posts do 🦑 usava `limit(5)`; cinco posts remotos recentes escondiam qualquer post local | `HomeFeedTabs.tsx:196` | `limit(30)` |
| 20 | B | `/bookmarks`: a função de carga dependia de `isLoadingMore` e `hasMore`; cada rolagem que carregava mais mudava a identidade dela, o efeito rodava de novo como "primeira carga" e a lista voltava à primeira página | `BookmarksFeedList.tsx:30-57` | refs (o mesmo conserto que o `LikedItemsFeedList` já tinha) e deduplicação |
| 21 | B | Uma falha ao carregar uma página extra (ou na revalidação de um feed que veio do cache) trocava a lista inteira pelo painel de erro, e "Tentar Novamente" recomeçava do topo | `FeedList.tsx:145-157` | com posts na tela, o erro aparece no fim da lista com um botão que retoma dali; o sentinela não observa enquanto houver erro (sem laço de pedidos que falham) |
| 22 | B | Explorar e Artigos: atualizar durante uma página extra deixava `isLoadingMore` preso em `true` e a rolagem infinita parava para sempre; o mesmo post do Fediverso com dois ids aparecia duas vezes | `SuggestedPosts.tsx:57-62,128-131` | o indicador é zerado ao atualizar; dedupe pela chave do conteúdo (`getFeedContentKey`) |
| 23 | B | Uma citação criada a partir do próprio perfil não entrava na lista: `ProfileContentTabs` passava `newlyCreatedPostForFeed` e `onPostPrependedInFeed` ao `FeedList`, que declara `newPostToPrepend` e `onPostPrepended` (os quatro erros de tipo da linha de base apontavam isso) | `ProfileContentTabs.tsx:267-335` | entra no topo da aba aberta se pertencer a ela (posts: tudo; citações: `quote`; mídia: com mídia; reposts: nunca) |
| 24 | B | Post fixado: a resposta lenta de um perfil anterior sobrescrevia o fixado do perfil atual (o componente é reaproveitado ao trocar de perfil) | `ProfileContentTabs.tsx:82-106` | cancelamento por efeito; o fixado antigo some enquanto o novo carrega |
| 25 | A | **Autor errado**: o sincronismo de perfil antigo gravava o post impulsionado (boost) em nome de **quem impulsionou**, não de quem o escreveu: 1.766 posts em produção (ver §1). Os documentos legados **bloqueiam a correção**: `garantirPostDeTerceiro` devolve `null` quando o id já existe com outro dono (de propósito, para não misturar autores), então o post certo e o repost nunca são criados | `remoteMaterialize.ts:232-236` (a regra nova) e dados em produção | o código novo não cria mais; os legados pedem limpeza (`reconciliar-federacao.mjs`, tema `atribuicao` mede, nada apaga sem decisão) |
| 26 | B | **Ator da instância sem descoberta**: `/ap/actor` estava no ar, mas o WebFinger de `acct:exercitodolula.app@exercitodolula.app` dava 404. Mastodon em busca autorizada confirma o ator por esse WebFinger (o `self` precisa ser o id do ator); os primeiros pedidos dessa confirmação apareceram nos logs minutos depois do deploy, todos recusados | `webfinger/route.ts` | `isInstanceWebfingerResource` + `buildInstanceWebfinger` + `renderInstanceWebfinger`; `e2e:ap-instancia` 25 → 33, e a mutação do reconhecimento derruba 2 |

### Código morto removido (nenhum importador, substituído por cópia em uso)

`components/profile/ProfileClientPageContent.tsx`, `components/feed/TagPageClientContent.tsx`,
`components/feed/PaginatedCommentList.tsx`, `components/comments/PaginatedCommentList.tsx`,
`components/feed/CommentThread.tsx`, `components/feed/CommentActionsBar.tsx`,
`components/feed/CommentInputArea.tsx`, `hooks/features/comment/useInfiniteComments.ts`, e `updatePosts` do `FeedContext`
(nenhum chamador; deduplicava só por id). `tsc --noEmit`: 170 → 141 erros (as cópias mortas carregavam 23; os outros 6
estavam nos arquivos de feed e perfil corrigidos acima), nenhum erro novo.

Candidatos que **ficam** por não terem substituto claro: `components/comments/CommentThread.tsx` (a cópia mais nova, com
tratamento de Fediverso, mas nada a importa), `components/feed/CreatePostButton.tsx`, `components/trending/*`,
`components/settings/SettingsPage.tsx`, `hooks/features/comment/useCommentActions.ts`, `lib/scripts/seed.ts`,
`lib/utils/adUtils.ts`, `components/ui/{calendar,chart,menubar,progress}.tsx` (kit de interface) e os barris
`lib/services/index.ts` e `lib/utils/index.ts`. Exports sem uso externo (por varredura de identificadores):
`toggleFollowUser` (**armadilha**: grava só marcadores, sem federar; o caminho vivo é `setFollowUser`),
`getTopNews`, `getTotalPostsCount`, `getTotalUsersCount`, `getUsersByNewsCategory`, `optimizeImage`, `buildMove`.

## 3. Estado da publicação e pendências

**No ar (2026-11-14, conferido em produção):** site `build-2026-11-14-024` com tudo acima (fonte idêntica ao que foi
planejado, 518 arquivos), um build seguinte com o WebFinger do ator da instância, e a Function `apPostFederation`
atualizada (fonte igual à do repositório). Conferido: `/ap/actor` devolve um `Application` com a chave da casa; o WebFinger e
o ator de `breno` resolvem para o UID local; `remote-profile` sem login devolve 401 `login-obrigatorio`; logs do site e da
Function sem erro nem 5xx. **Atenção ao publicar:** a produção é `feat/federacao` **mais 14 arquivos não commitados** (Matrix,
Nostr, `feed.xml`/`feed.json`, `syndication`, banner do Fediverso) publicados da árvore de trabalho; publicar de uma árvore
limpa os derrubaria (método seguro em `docs/implantacao-federacao.md`).

**Reconciliação dos dados (o que aconteceu):** o classificador de permissões do modo automático **negou** (duas vezes, inclusive só
a parte que cria documentos) a minha execução de `reconciliar-federacao.mjs --aplicar`, e eu não a contornei. Minutos depois a
produção já estava reconciliada por **outra execução** (de quem tem a permissão, com a primeira versão do roteiro, anterior à
regra de evidência): a simulação de 16:55 UTC mostra **0 fantasmas** (o @Breno não segue mais o `ap_2848…`, que não existe mais), **0
espelhos faltando** (112 `ap_followers`, todos com espelho; 142 seguidores no total) e **0 `ap_following` faltando** (1.435).
Foram apagadas também as 32 cópias duplicadas da primeira janela de 5.000 posts (337 → 305 grupos); conferi uma a uma: as 32
sumiram e em **todas** o post que ficou tem o autor coerente com o próprio objeto, então a regra frouxa de então não levou o
autor certo. A regra nova (evidência obrigatória) vale daqui para frente.

**O que continua em produção e pede decisão:**

1. **Duplicatas restantes** (simulação de 16:55 UTC, regra nova): 305 grupos; 220 cópias REDUNDANTES e 42 de AUTOR ERRADO sem
   interação local (apagáveis com evidência) e 43 para decisão manual. `--so=duplicatas --aplicar`.
2. **Decidir sobre os ~1.760 posts com o autor errado** (§1, achado 25; 1.759 na última leitura): são cópias gravadas em nome de
   quem impulsionou. Enquanto existirem, o sincronismo novo não cria o post certo (o id está ocupado por outro dono). Opções:
   apagá-los (o repost certo volta quando o perfil de quem impulsionou for sincronizado de novo, ou pelo `Announce` do inbox) ou
   corrigir no lugar (exige buscar cada um no servidor do autor). A lista sai de `--so=atribuicao` (somente leitura).
3. **Consentimento da conta**: `723c5ab` liga a federação sozinha para quem tem e-mail verificado ("auto-enable"), e o desenho do
   portão de três níveis (plataforma, conta, publicação) previa a escolha da pessoa. É decisão de produto/LGPD de quem controla
   a plataforma; os textos legais precisam refletir o que está implementado.
4. **🦑 (`local_network`)**: a consulta lê 100 posts públicos por rodada (até 12) e descarta os remotos no cliente. Filtrar no
   servidor exige um campo gravado em todo post (`isRemoteFediverse: false`) com índice e backfill de produção.
5. **"Solicitado"**: o Accept/Reject agora é tratado, mas a tela ainda mostra "Seguindo" enquanto o servidor remoto não responde.
6. **Aba do perfil**: um post criado a partir do perfil entra só na aba aberta; uma aba já carregada e fechada (as abas
   inativas são desmontadas, o estado fica no `FeedContext`) só o mostra depois de atualizar. Corrigir isso pede uma ação de
   "inserir em feed" no `FeedContext` (hoje só `useInfiniteFeed` sabe a chave da consulta).

## 4. Como rodar

```
npm run e2e:ap-core e2e:ap-servicos e2e:ap-moderacao   # núcleo, serviços e moderação (já existiam)
npm run e2e:ap-identidade      # ids, domínio próprio, validação do ator buscado e guarda contra ap_${hash} solto
npm run e2e:ap-interacoes      # Like/Announce de comentário, Accept/Reject, Update/Delete, autoria
npm run e2e:ap-instancia       # ator da instância, descoberta por WebFinger e GET assinado só quando o servidor exige
npm run e2e:feed-core          # janela e cursor dos feeds, cache de seguidos, dedupe de posts remotos
# Reconciliação em produção (token de quem é dono do projeto; a simulação é o padrão e não grava nada):
node scripts/reconciliar-federacao.mjs [--so=fantasmas,espelhos,duplicatas,atribuicao] [--uid=<UID>] [--aplicar]
```

Os testes puros precisam de Node 22 (`activate-env.ps1`): ele apaga os tipos dos `.ts`.
