# Mídia: inventário de produção e roteiro de implantação

> Inventário **lido de produção** em 2026-11-11, somente leitura. **Nada publicado, migração não executada.**
> O único arquivo escrito foi o backup, em disco local, fora do repositório.

## 1. Correção de um número meu

O inventário anterior relatou **97** referências legadas. **Estava errado por um fator de 43.** Eu havia contado
quatro coleções à mão (`userFiles`, `messages`, `posts.media[]`, `comments.media[]`) e deixei de fora todo o resto.

A contagem foi trocada por um **caminhador recursivo** que percorre *todos* os valores de texto de *todos* os
documentos, em qualquer profundidade. Não existe mais lista de campos para alguém esquecer de atualizar — e foi
assim que apareceram os campos abaixo, que nenhuma lista manual teria previsto.

**Total real: 4233 referências legadas.**

## 2. Inventário

### Objetos no Storage — 169

| Tipo | Visibilidade | Objetos | Com token |
|---|---|---|---|
| `postMedia` | pública | 107 | 107 |
| `avatar` | pública | 25 | 25 |
| `cover` | pública | 18 | 18 |
| **`dm`** | **privada** | **17** | **17** |
| **`userFile`** | **privada** | **2** | **2** |

> **A exposição são 19 objetos**: 17 anexos de mensagem e 2 arquivos de "Meus Arquivos". Todos com token permanente,
> todos abrindo em aba anônima hoje. Os 150 públicos têm token também, mas ali não é vazamento.

### Referências legadas, por campo descoberto

| Campo | Refs |
|---|---|
| `notifications.actors[].avatarUrl` | **2450** |
| `posts.authorDetails.avatarUrl` | **1471** |
| `posts.originalPostDetails.authorDetails.avatarUrl` | 84 |
| **`posts.media[].url`** | **75** |
| `conversations.participantsInfo[].avatarUrl` | 69 |
| `users.avatarUrl` | 24 |
| **`messages.fileUrl`** | **19** |
| `users.coverImageUrl` | 18 |
| `posts.originalPostDetails.media[].url` | 12 |
| `posts.originalPostDetails.originalPostDetails.authorDetails.avatarUrl` | 4 |
| **`userFiles.url`** | **2** |
| `comments.media[].url` | 1 |
| outros aninhados (`...user.avatarUrl`, `...parentPostAuthorDetails.avatarUrl`, ...) | 4 |

**O volume não é mídia: é cópia desnormalizada de avatar.** A rede copia a URL do avatar do autor dentro de cada
post e de cada notificação. Isso explica 4000 das 4233.

### Por visibilidade do objeto apontado

| | Refs | Obrigatório? |
|---|---|---|
| Apontam para objeto **privado** | **21** | **Sim** — reescrever antes de revogar, senão o anexo quebra |
| Apontam para objeto público | 4212 | Não — o token delas **não** é revogado, continuam funcionando |

**É por isso que o script ganhou `--escopo`.** O padrão é `privado`: 21 referências, 21 documentos. Reescrever 4233
documentos para corrigir 19 objetos seria risco sem retorno. `--escopo=tudo` existe e pode rodar depois, com calma.

### Classificação e órfãos

| | |
|---|---|
| Referências com objeto existente | 4195 |
| Referências **sem** objeto no bucket | 38 (avatares de contas excluídas, em notificações e conversas — já são imagens quebradas) |
| Objetos órfãos (sem referência) | 32, **todos públicos** |
| Objetos privados órfãos | **0** |

Nenhum objeto privado está órfão ou sem classificação: os 19 estão todos referenciados e cobertos pelo escopo
`privado`.

## 3. Regras: o que precisa ser publicado

Comparação feita contra os rulesets **publicados**, pela API de Rules.

| Arquivo | Ruleset publicado | Linhas pub/local | Precisa publicar? |
|---|---|---|---|
| `firestore.rules` | `8a65d558-e236-4478-b116-eaea1465f61b` | 754 / 793 | **SIM** |
| `storage.rules` | `68395ad2-315b-4acf-84af-b298fa8b4d16` | 26 / 26 | **Não** — idêntica |

**O que falta no publicado:** o bloco `match /media/`. E isso tem uma consequência de ordem que precisa estar clara:

> **Publicar o site sem as regras QUEBRA TODOS OS UPLOADS.** O upload agora falha se o registro `media/{id}` não
> puder ser criado — de propósito, para nunca cair num caminho de recuo que gere token. Sem a regra publicada, o
> cliente não consegue criar o registro, e nenhum upload conclui.
>
> **As regras vão antes do site, ou junto. Nunca depois.**

Há um terceiro release, `cloud.firestore` (ruleset `5734b53d-…`), que é o banco `(default)` antigo. **Não tocar.**

Backups de reversão salvos em `~/soberan-backups/rules/`:
- `firestore.rules.publicado-8a65d558-...`
- `storage.rules.publicado-68395ad2-...`

## 4. Mudança de visibilidade: onde está ligado

| Caminho | Onde | Estado |
|---|---|---|
| Post apagado | `onPostDeleted` → `tombstoneMedia` | **Ligado** (servidor) |
| Perfil vira privado ou público | `onUserUpdated` → `applyMediaVisibilityByOwnerPosts` | **Ligado** (servidor) |
| Conta excluída | `onUserDeletedCleanup` → `tombstoneMediaByOwner` | **Ligado** (servidor) |
| Arquivo pessoal apagado | `fileService` → `tombstoneMediaDoc` | **Ligado** (cliente; o objeto sai do Storage, não há token a revogar) |
| Público → privado / privado → público por post | `POST /api/media/visibility` | **Rota pronta, sem tela** — ver abaixo |
| Bloqueio | — | **Não se aplica** |

**Sobre "edição de post":** não existe controle de visibilidade por post na interface — a busca por `visibility` em
`src/components/` e `src/hooks/` não encontra nada. A visibilidade do post **deriva do perfil** e é propagada por
`syncAuthorVisibility` dentro de `onUserUpdated`. Ou seja: o caminho existe e está ligado, **no servidor**. A rota
fica pronta para quando houver uma tela, e não inventei uma que não foi pedida.

**Sobre bloqueio:** bloquear não muda visibilidade de mídia. O acesso ao anexo é conferido **ao vivo** a cada
requisição (participação na conversa e bloqueio nos dois sentidos), então bloquear corta na hora sem tocar em
registro nenhum. Mudar visibilidade aqui seria errado: o anexo não deixou de ser daquela conversa.

**Sobre avatar e capa:** continuam **públicos** mesmo com perfil privado, porque o cartão do perfil é legível por
qualquer pessoa (`allow get: if true` em `users`). `applyMediaVisibilityByOwnerPosts` toca só a mídia de posts.

**A mudança não depende do navegador:** os três caminhos reais acontecem em Functions, e o teste verifica que as
três chamam os ganchos de mídia. A rota de servidor confere a posse (`dados.ownerUid !== uid`) antes de qualquer
alteração.

## 5. Backup e restauração

`--fase=backup` exporta **somente os documentos afetados pelo escopo**, um JSONL com cabeçalho:

- `documento` — caminho completo
- `campos` — os caminhos de campo alterados (`media[0].url`, `participantsInfo[1].avatarUrl`, …)
- `camposAnteriores` — fotografia do valor anterior do campo raiz inteiro, mantida para auditoria e conferência;
- `valoresAnteriores` — caminho, URL antiga e indicação de URL embutida em HTML. É esta lista que a restauração usa
  para fazer a substituição inversa sem apagar edições posteriores da pessoa.

Cabeçalho com `criadoEm`, `projeto`, `registros`, `referencias`, `escopo` e **`sha256`** do corpo.

**Executado e verificado em 2026-11-11:**

| | |
|---|---|
| Documentos afetados (escopo privado) | **21** |
| sha256 | `9f54af6743f989f28adb8b87a032daf303b5fd5fde9ce0af58f6cdfd6537f2bf` |
| Salvo em | `~/soberan-backups/backup-midia-echo-b5aw9-2026-11-11T16-34-22-523Z.jsonl` |
| Permissão | `600` (só o dono lê) |

**Proteções do arquivo:**
- salvo **fora do repositório** por padrão (`~/soberan-backups`), nunca em `./`;
- `.gitignore` recebeu `backup-midia-*.jsonl` e `.backup-midia/` como rede de segurança;
- **os tokens não aparecem em log nenhum** — o script imprime contagem, hash e caminho, e o token fica apenas
  dentro do arquivo.

**Restauração, testada em dry-run:**

```
node scripts/migrar-tokens-midia.mjs --producao --fase=restaurar --de="<arquivo>"
```

Sem `--aplicar` ela **não grava** e já serve de verificação: confere `sha256`, contagem e projeto. A detecção foi
provada acrescentando uma linha a uma cópia — resultado: `registros: 22 (cabeçalho diz 21)` e
`INTEGRIDADE FALHOU: restauração abortada`. Também aborta se o backup for de outro projeto.

A restauração não regrava mais o campo raiz inteiro. Ela relê o documento, troca somente a URL que a migração
escreveu e usa o `updateTime` dessa releitura como pré-condição. Se o valor mudou depois, ele não é tocado; se o
documento mudar entre a releitura e o commit, o lote é abortado e pode ser retomado de forma idempotente.

> **O banco pode ser restaurado; o token não.** Depois da revogação, restaurar o backup devolve as URLs antigas aos
> documentos, mas elas **não voltarão a funcionar**, porque o token que elas carregam foi destruído no Storage.
> **Para os arquivos privados isso é o objetivo, não um efeito colateral.**

## 6. Comando nominal das três Functions

```
firebase deploy --only functions:onPostDeleted,functions:onUserUpdated,functions:onUserDeletedCleanup
```

**Nunca** `--only functions` sem filtro: o código não tem as Functions da Mariana e um deploy geral proporia
**apagá-las**. Ler a saída antes de confirmar; se mencionar remoção de qualquer Function, **abortar**.

## 7. Ordem completa de publicação

| # | Passo | Comando / onde | Por que nesta ordem |
|---|---|---|---|
| 0 | Backup já feito e verificado | — | Feito em 2026-11-11, hash acima |
| 1 | **Publicar `firestore.rules`** | `firebase deploy --only firestore:rules` | **Antes do site**: sem `match /media/` todo upload falha |
| 2 | Conferir release `cloud.firestore/echo-db-124325` | API de Rules | Não tocar o release `cloud.firestore` do banco antigo |
| 3 | **Publicar as três Functions**, nominalmente | comando da seção 6 | Exclusão e troca de visibilidade passam a revogar token |
| 4 | **Publicar o site** | App Hosting | Uploads novos param de gerar token |
| 5 | **Testar upload novo**: arquivo pessoal, anexo de DM, mídia de post | navegador | Prova que o registro nasce e a URL nova serve |
| 6 | `--fase=registrar --aplicar` | script | Cria `media/{id}` para os 169 objetos antigos |
| 7 | `--fase=reescrever --aplicar` (escopo `privado`) | script | Troca as **21** referências privadas |
| 8 | **Conferir à mão** que os 17 anexos e os 2 arquivos abrem | navegador | **Última chance de voltar sem perda** |
| 9 | `--fase=revogar --aplicar` | script | Apaga o token dos **19 privados** |
| 10 | `--conferir` | script | Deve dizer "nenhuma referência a objeto privado aponta para o Storage" |
| 11 | Testar as URLs antigas | aba anônima | As 19 privadas devem falhar; as públicas seguem abrindo |

Opcional, depois e sem pressa: `--fase=reescrever --escopo=tudo --aplicar`, para tirar o Firebase e o UID das 4212
referências públicas.

**Dos passos 1 a 8 não há janela de quebra**: as URLs antigas continuam funcionando porque o token ainda existe.

## 8. Ponto irreversível

**Passo 9, no instante em que `--fase=revogar --aplicar` apaga `firebaseStorageDownloadTokens` do primeiro objeto.**

O token é um valor aleatório gerado pelo Storage; apagá-lo o destrói e não há como recriar o mesmo. Toda URL antiga
daquele objeto que exista fora da plataforma — histórico, link salvo, mensagem em outro aplicativo — para de
funcionar para sempre. Para os 19 privados é o objetivo. Para mídia pública seria estrago, e é por isso que o script
**não** revoga os 150 públicos.

Antes do passo 9 o script **aborta** se faltar registro ou se sobrar referência privada apontando para o Firebase.

## 9. Testes de produção posteriores

1. **Proprietário** abre arquivo pessoal → abre.
2. **Aba anônima** com a mesma URL `/mp/<id>` → **404**.
3. **Outra conta** autenticada com a mesma URL → **404**.
4. **Participante** abre anexo da conversa → abre, inclusive vídeo com busca de posição (`Range`).
5. **Não participante** → **404**.
6. **URL pública** `media.exercitodolula.app/m/<id>` → abre, inclusive deslogado e incorporada fora do site.
7. **Bloquear** a outra pessoa → o anexo dela para de abrir; o **texto** antigo continua visível (divergência
   declarada em `docs/midia-privada.md`).
8. **URL Firebase privada** copiada antes do passo 9 → abria antes, **deve falhar depois**.
9. **URL Firebase pública** copiada antes → **deve continuar abrindo**.
10. **Apagar** um arquivo pessoal → a URL dele passa a 404.
11. **Logout** e tentar a URL privada → **404**.
12. **Excluir conta** descartável → conferir nos logs `[CLEANUP] … midias, … tokens revogados`, e que as URLs
    antigas dela param de abrir.
13. Conferir que **nenhuma** mídia nova gravada no banco contém `firebasestorage.googleapis.com`.

## 10. Riscos

1. **4212 referências públicas continuam expondo UID e host do Firebase** nas URLs já gravadas. Aceito por decisão
   (não quebrar compartilhamento antigo), reversível a qualquer momento com `--escopo=tudo`.
2. **A rota de visibilidade não tem tela.** Hoje não há caso real: **0 posts restritos** em produção.
3. **32 órfãos públicos** seguem no bucket com token. Limpeza é decisão separada.
4. **`checkRevoked` custa uma verificação por requisição** na mídia privada. Com 19 objetos, irrelevante.
5. **Se as regras subirem e o site não**, uploads continuam como hoje (gerando token) — degradação, não quebra. O
   inverso é que quebra.
6. **O backup cobre só o escopo executado.** Se um dia rodar `--escopo=tudo`, fazer backup novo antes.

## 11. Execução em produção, 2026-11-11

Ordem executada, com a evidência de cada passo.

| # | Passo | Resultado |
|---|---|---|
| 1 | Backup verificado | 21 documentos, 21 referências, `sha256 9f54af67…f2bf`, ACL restrita ao dono, fora do Git |
| 2 | `firestore.rules` publicado | `released rules firestore.rules to cloud.firestore` |
| 3 | Conferência dos rulesets | só `cloud.firestore/echo-db-124325` mudou; `cloud.firestore` (banco antigo) e `firebase.storage` **inalterados** |
| 4 | Functions, seleção nominal | `onPostDeleted`, `onUserUpdated`, `onUserDeletedCleanup` ACTIVE; `agentMarianaPublisher` e `agentMarianaResponder` **intactas** |
| 5 | Site (App Hosting) | rollouts `build-2026-11-11-003/004/005` |
| 6 | Correção dos caminhos de upload | `f2d7cae` — as cinco fábricas de caminho tinham sido perdidas numa substituição multilinha |
| 7 | Upload sem token | `733723e` — o Firebase grava `firebaseStorageDownloadTokens` **no upload**, mesmo sem `getDownloadURL()`; o envio passou a ser pela rota autenticada |
| 8 | `--fase=registrar --aplicar` | 19 registros `media/{id}` gravados, **só privados** (escopo conferido no ensaio: "a registrar: 19") |
| 9 | `--fase=reescrever --aplicar` | 21 documentos, 21 de 21 referências trocadas, "COBERTURA TOTAL" |
| 10 | Portão antes de revogar | ver abaixo — **1 divergência, revogação não executada** |

Contagens do inventário no momento da migração: **19 objetos privados com token** (2 `userFile` + 17 `dm`) e
**21 referências** a objeto privado — exatamente o portão acordado. Os públicos com token passaram de 150 para 152
(dois objetos do teste ao vivo, fora do escopo e não revogados).

### Portão do passo 10

| Verificação | Resultado |
|---|---|
| 21 referências apontam para a rota própria | OK — `messages.fileUrl` 19→0 e `userFiles.url` 2→0 no Storage |
| nenhuma referência privada aponta para o Firebase | OK |
| 19 objetos registrados | OK |
| aba anônima recebe 404 | OK, nos 19 ids reais |
| conta autenticada não autorizada recebe 404 | OK |
| dono e participantes conseguem acessar | **19 de 21 OK; 2 referências não** |

A matriz completa foi provada **em produção**, com contas descartáveis, por
`scripts/teste-midia-producao.mjs`: arquivo pessoal (dono 200, anônimo 404, outra conta 404), anexo (participante
200, estranho 404, removido da conversa 404, bloqueado 404, desbloqueio volta a 200), mídia pública (URL própria,
anônima 200, CORS externo), logout, tombstone e propagação da exclusão de conta (público 410, anexo 404). Nenhum
upload novo nasceu com token.

### A divergência: anexo reenviado de uma funcionalidade que não existe mais

`scripts/conferir-midia-migrada.mjs` confere **referência por referência** contra o backup — o que o `--conferir`
agregado não faz. Ele acusou 2 das 21:

```
conversations/G1ha…_fGGa…/messages/CbBtNIvSmFoUlZTP5KYz · fileUrl
conversations/G1ha…_fGGa…/messages/ta9VFZ6oO0vT5wiz6M7k · fileUrl
```

As duas mensagens, de 13/07/2026, apontam para **o mesmo objeto**, e esse objeto pertence a um **terceiro**, que não
participa daquela conversa. Uma delas tem `isForwarded: true`. É um anexo **reenviado**: o remetente recebeu a
imagem numa conversa e repassou para outra pessoa, e o cliente da época copiou a URL em vez de copiar o arquivo.
Com token permanente isso funcionava, porque o token não pergunta nada. Com autorização por requisição, a rota
procura a conversa entre quem pede e o **dono** do arquivo — e a destinatária do reenvio não está nela.

Delimitação, medida na base inteira (784 mensagens, 51 conversas):

- **19** mensagens com anexo, **todas as 19** já na URL própria, **nenhuma** na URL antiga;
- **17** objetos distintos; só **um** é referenciado por mais de uma mensagem (3 vezes);
- **2** referências com dono fora da conversa — as duas acima, a mesma imagem, uma conversa, uma pessoa afetada;
- **0** risco futuro: **não existe mais reenvio no código**. O único lugar que grava `fileUrl` é
  `MessageInputArea.tsx`, com o resultado de um upload do próprio remetente.

A migração mapeou essas duas referências **corretamente** — o registro aponta para o objeto certo. O que falta é uma
decisão de produto sobre quem pode ver um anexo reenviado, e ela não foi tomada aqui.

Revogar **não** fecha nenhuma das saídas: a rota serve pelo registro, não pelo token. Mesmo assim a revogação ficou
**parada**, porque a autorização era condicionada a as verificações permanecerem exatas, e esta não permaneceu.

### O conserto do reenvio

Decisão dele: **copiar o objeto**, uma única cópia, preservando o original. `scripts/corrigir-anexo-reenviado.mjs`
confere toda a premissa antes de tocar em nada — que o registro original é anexo privado sem tombstone, que o
remetente participa da conversa de destino, que o dono original **não** participa, que o id da conversa é o que a
rota recalcula, que as duas mensagens apontam para o registro esperado e são as duas do mesmo remetente — e aborta
em qualquer divergência.

Executado:

1. cópia do objeto para `user_uploads/fGGa…/dms/images/8db71e05-….jpg` (688147 bytes, `image/jpeg`);
2. `firebaseStorageDownloadTokens` **apagado e conferido ausente** — o `copyTo` do Storage leva os metadados da
   origem, token incluído, e sem essa conferência a cópia nasceria com exatamente o problema que esta rodada
   elimina;
3. registro `media/kUUZAOkOXhkWbs29WzkUkm`, dono o remetente, `kind: dm`, `visibility: private`;
4. as 2 mensagens apontando para `/mp/kUUZAOkOXhkWbs29WzkUkm`.

Intactos: o objeto e o registro originais. Quem participa da conversa original continua vendo o original.

Validação da cópia real, com os dados de produção (sem entrar na conta de ninguém — a decisão da rota é função pura
dos dados, e o caminho de servir foi provado ao vivo): registro correto nos 7 campos, objeto sem token, conteúdo
idêntico ao original, conversa encontrada onde a rota a procura, nenhum bloqueio entre os dois, e a decisão —
remetente **permitido**, destinatária do reenvio **permitida**, terceiro autenticado negado, sem sessão negado,
dono original negado nesta cópia, bloqueio negaria, tombstone negaria até o dono, removida da conversa negada.
Na rota ao vivo: aba anônima **404** na cópia e na original, inclusive com `Range`.

O caminho de servir um objeto **copiado** entrou na matriz ao vivo (`teste-midia-producao.mjs`): cópia descartável
sem token, dono e participante 200, estranho e anônimo 404, `Range` 206.

### Passo 11, irreversível: executado

Portão reconferido imediatamente antes, item por item:

| Verificação | Resultado |
|---|---|
| referências conferidas uma a uma | **21 de 21 corretas** |
| objetos antigos distintos | 19 — o alvo |
| objetos servidos hoje | 20 (19 originais + 1 cópia) |
| reapontadas para cópia | 1, provada: mesmo conteúdo, original inteiro, sem token |
| referências privadas apontando para o Firebase | **0** |
| objetos privados sem registro | **0** |
| inventário | `dm` 18 objetos / 17 com token · `userFile` 2 / 2 → **19 privados com token**, inalterado |
| públicos com token | 152, intocados |

`--fase=revogar --aplicar` → **REVOGADOS: 19**. Preservados: 152 públicos.

### Auditoria final

| Prova | Resultado |
|---|---|
| `--conferir` | `PRIVADOS com token: 0` · nenhum objeto privado com token · todo objeto privado com registro · nenhuma referência privada no Storage · **"Migração completa"** |
| conferência uma a uma | 21 de 21, `objetos antigos com token: 0` |
| **as 19 URLs antigas privadas** | **HTTP 403 em todas as 19** — a exposição que ele reproduziu em aba anônima está fechada |
| URLs antigas públicas (amostra de 6) | HTTP 206 — compartilhamento antigo preservado |
| rota pública própria `/m/<id>` | HTTP 206 |
| matriz ao vivo, depois da revogação | 8 cenários, todos OK, nenhum upload novo com token |
| Functions | `onPostDeleted`, `onUserUpdated`, `onUserDeletedCleanup` e **`agentMarianaPublisher` + `agentMarianaResponder`** todas presentes |
| suítes | `e2e:midia` OK · `e2e:midia-privada` 111 verificações, 0 falhas · `check:domain` OK |

### O que mudou nos números finais

- objetos privados: **20** (19 antigos + a cópia), **nenhum** com token;
- objetos públicos: 152 com token, **preservados por decisão** — a URL pública legada continua funcionando;
- referências legadas restantes: 4220, **todas públicas**, aceitas por decisão e reversíveis com `--escopo=tudo`;
- órfãos no bucket: 54, dos quais 20 privados — "órfão" aqui significa "nenhuma URL legada do Firebase aponta para
  ele", e depois da migração isso é verdade para **todos** os privados, por construção. Limpeza dos órfãos
  **públicos** continua sendo decisão separada.

## 12. Inventário de órfãos: o cálculo estava errado

O número "54 órfãos, 20 privados" que apareceu depois da revogação era **falso**, e falso de um jeito perigoso: o
cálculo era `objeto sem referência LEGADA`, e isso passou a estar errado no instante em que a migração trocou as
URLs. Depois dela **nenhum** objeto migrado tem referência legada — ele é referenciado por `/mp/<id>`, resolvido
pelo registro. O resultado foi chamar de órfão justamente o objeto mais corretamente administrado do bucket.

Isso não é só imprecisão de relatório. O inventário de órfãos é o insumo de uma decisão de **limpeza**. Apagar por
aquela lista teria apagado os 20 anexos privados vivos, inclusive a cópia do conserto do reenvio, feita minutos
antes.

### O cálculo correto

Órfão passa a ser o complemento da **união** de três origens de "alguém depende deste objeto":

1. **referência legada** — URL do Firebase gravada no conteúdo;
2. **`media/{id}.storagePath` válido** — o registro é o que a rota usa para servir;
3. **referência própria** `/m/<id>` e `/mp/<id>` no conteúdo, **resolvida pelo registro**.

A classificação virou lógica pura em `src/lib/media/mediaInventory.ts`, sem nenhum import — nem dos vizinhos — para
`npm run e2e:midia-inventario` exercitar **todas** as categorias com dados sintéticos, sem produção e sem
emuladores. O primeiro cenário do teste é o da regressão: objeto referenciado só por `/mp/<id>` **não** é órfão.
Dois helpers novos em `mediaId.ts`, onde já vive a verdade sobre id e caminho: `mediaIdFromUrl` (que distingue
`/m/` de `/mp/`, porque confundi-los classificaria mídia privada como pública) e `isValidStoragePath`.

O script passou a ler os registros `media/` **junto** do inventário, e não depois dele, e a colher as duas formas de
referência na **mesma** varredura — oito grupos de coleções e milhares de documentos custam caro para varrer duas
vezes.

### Categorias, e o que cada uma quer dizer

| Categoria | O que é | Produção, 2026-11-11 |
|---|---|---|
| **ativo e corretamente referenciado** | algum conteúdo aponta para ele | **140** (20 privados) |
| ↳ por URL própria | `/m/` ou `/mp/` — o estado final desejado | 22 |
| ↳ só por URL legada | funciona, expõe UID e host; decisão declarada | 118 |
| **objeto registrado sem referência de conteúdo** | tem `media/{id}` válido, nada aponta para ele | **0** |
| **objeto realmente órfão** | existe no Storage, sem referência **e** sem registro | **32** (privados: **0**) |
| **registro órfão** | existe em `media/{id}`, objeto não existe | **0** |

Antes: 54 órfãos, 20 privados. Depois: **32 órfãos, nenhum privado**. A diferença de 22 é exatamente o número de
objetos registrados — todos classificados como órfãos pelo cálculo antigo.

O registro órfão é subdividido porque os motivos não são a mesma coisa: `caminho-invalido` (nunca serviu),
`objeto-ausente-com-tombstone` (fim de vida **esperado**: a rota responde 410 por causa dele) e
`objeto-ausente-sem-tombstone` (anomalia: a rota responde 404 e ninguém sabe por quê).

### Anomalias que o inventário antigo não mostrava

| Sinal | Por que importa | Produção |
|---|---|---|
| referência legada sem objeto | imagem quebrada no conteúdo | 38 |
| referência própria **sem registro** | 404 para sempre, e nada indica a causa | 0 |
| referência própria para registro com tombstone | 410 — esperado após exclusão | 0 |
| referência própria na **rota errada** (`/m/` x `/mp/`) | privada pedida pela rota pública: sintoma de gravação errada | 0 |
| mais de um registro para o mesmo caminho | dois ids servindo o mesmo objeto | 0 |
| **objeto registrado que ainda tem token** | contradição: o registro diz "servido pela nossa rota, autorizando a cada pedido", e o token serve o mesmo objeto a quem tem o link, sem login | **2** (públicos) |

Os 2 com token são `postMedia` públicos criados às **17:54 e 17:56 de 2026-11-11**, antes de a rota de upload
autenticada entrar no ar. Não é regressão em curso: todo upload do teste ao vivo posterior nasceu sem token. Como
são públicos, caem na decisão declarada de **não revogar token público**, e ficam aqui como registro.

### Os exemplos são pseudonimizados

O relatório preserva a **estrutura** do caminho, que é o que se está diagnosticando, e troca o identificador da
pessoa e o nome do arquivo por um rótulo curto e estável:

```
user_uploads/u:f64d91a9/postMedia/images/#8d14fe58.png
conversations/8a392baa · participantsInfo[0].avatarUrl
```

O rótulo é estável dentro de um relatório, então dá para ver que duas linhas falam da mesma pessoa sem o relatório
carregar o identificador dela. É **pseudonimização, não anonimato**: quem já tem a lista de UIDs pode recalcular o
rótulo. Serve para o relatório não virar um despejo de dados pessoais, não como garantia de sigilo.

### Limpeza

Continua sendo **decisão separada** e não foi executada. O que o inventário corrigido muda é que agora existe uma
lista defensável: 32 objetos públicos que nenhum conteúdo referencia e nenhum registro conhece, zero privados. Antes
de qualquer exclusão, rodar o inventário de novo — um objeto recém-enviado fica órfão por alguns segundos, entre o
upload e a gravação da referência.

## 13. Migração da mídia PÚBLICA: diagnóstico e plano

Nada publicado, nada alterado em produção. Tudo abaixo é leitura em produção mais prova de ponta a ponta nos
emuladores.

### O que muda, e o que não muda

Troca a URL gravada no conteúdo, de
`https://firebasestorage.googleapis.com/v0/b/…/o/user_uploads%2F<UID>%2F…?alt=media&token=<uuid>`
para `https://media.exercitodolula.app/m/<mediaId>`.

O que isso resolve: cada avatar, capa e mídia de post hoje publica o **UID da pessoa**, o **host do Storage** e o
**caminho interno** em texto puro, em 4226 lugares do banco — inclusive em notificação e em conversa, que são
contexto privado. A URL nova não revela nada disso, e passa a ser revogável.

O que **não** muda, de propósito: o **token do objeto continua existindo**. A URL pública antiga continua servindo,
então print, link no WhatsApp e card já buscado por outra rede não quebram. Há uma trava dura no script:
`--fase=revogar` **aborta** em qualquer escopo que não seja `privado`.

### Contagens (produção, 2026-11-11)

| | |
|---|---|
| referências legadas, todas públicas | **4226** |
| ↳ **no alvo** (objeto existe) | **4188** |
| ↳ fora do alvo (objeto não existe) | **38** — relatadas, não tocadas |
| das 4188, **embutidas em HTML** | **6** |
| documentos a atualizar | **3953** |
| objetos públicos referenciados | **124** |
| ↳ registros a reutilizar | 0 |
| ↳ registros a criar | **124** |
| órfãos deixados de fora | **26** |
| fora deste escopo | **22** (20 privados + 2 já em URL própria) |
| backup | 3953 documentos · **3,90 MiB** · maior linha 9,7 KiB |

Reconciliação: 124 + 26 + 22 = **172** objetos, o bucket inteiro.

Por coleção: `notifications` 2396 docs / 2417 refs · `posts` 1481 / 1660 · `conversations` 51 / 68 ·
`users` 24 / 42 · `comments` 1 / 1.

Cobertura exigida, toda conferida: mídia de post (75), avatar do autor no post (1474+91 nas cópias aninhadas),
comentário (1), avatar (24), capa (18), conversa (68), notificação (2417).

### Dois achados que mudaram o diagnóstico

**1. URL antiga EMBUTIDA no HTML do post era invisível.** `caminhoDaUrlAntiga` exige que a string **inteira** seja
uma URL (`new URL(string)`), então `<img src="https://firebasestorage…">` dentro de `posts.text` nunca era
encontrado. São **6** URLs em 6 posts, e importam mais do que o número sugere: quando o post não tem mídia anexada,
é exatamente de lá que sai o `og:image` do card externo (`extractFirstMediaFromHtml`).

Consequência no inventário: **6 dos 32 "órfãos" não eram órfãos** — estavam referenciados dentro do HTML. Órfãos
reais: **26**. O inventário da seção 12 dizia 32; este número o corrige. Uma limpeza feita por aquela lista teria
apagado 6 imagens vivas de post.

Troca por **substring**, nunca do valor inteiro: `posts.text` é um documento de até 6 KB, e trocar o valor todo
apagaria o post. Uma ocorrência por referência, e a substituição vai por função para `$&` não ser interpretado.
O inventário também reconhece a URL própria já migrada quando ela está embutida no HTML; sem essa simetria os seis
objetos apareceriam falsamente como registrados sem referência após a migração.

**2. O inventário de "URL legada morta" era falso alarme meu.** Numa primeira leitura o `og:image` de um post
legado respondeu 403 e eu li isso como URL já quebrada. Era do meu teste: `&` em atributo HTML vira `&amp;`, e eu
não desfazia a entidade — a URL ia com `&amp;token=`. Desescapada dá 206, que é o que um crawler faz. Medido nos
120 objetos distintos: **118 de 118 servem** (os outros 2 são os inexistentes). Nenhuma URL pública legada está
morida. Benefício real, porém: a URL nova **não tem query string**, então essa classe de erro de escape deixa de
existir.

### Risco bloqueante: a troca de foto pararia de apagar a anterior

`EditProfileDialog` descobria o objeto do avatar/capa anterior **parseando a URL do Firebase** (`/o/<caminho>`), para
apagá-lo ao trocar de foto. Com a URL migrada:

- `isFirebaseStorageUrl(user.avatarUrl)` → **false**
- `oldAvatarPath` nunca é preenchido → `deleteFileFromStorage` nunca é chamado
- **toda troca de avatar ou capa deixaria o objeto anterior no bucket**, para sempre, sem erro aparecendo

Silencioso e cumulativo: geraria exatamente os órfãos que o inventário acabou de aprender a medir. Corrigido antes
de propor a migração:

- resolve o caminho pelo **registro** `media/{id}` quando a URL é própria (a regra deixa o dono ler o seu);
- continua entendendo a URL antiga pelo `caminhoDaUrlAntiga` — o parser **auditado**, que compara o hostname exato;
  o que estava ali usava `includes`, e `firebasestorage.googleapis.com.site-falso.test` passaria;
- resolve o anterior **antes** do upload do novo;
- cobre também a **remoção** da foto, não só a troca;
- marca o registro com tombstone **somente depois** da exclusão confirmada (ou `object-not-found`);
- falha real mantém o registro ativo, faz uma segunda tentativa automática e informa a pendência à pessoa;
- falha ao gravar o tombstone não cai no rollback da atualização já concluída, portanto nunca apaga a imagem nova.

**Esta correção precisa estar no ar ANTES da reescrita de avatares e capas.** É site, não regra nem Function.

### Validação da rota pública, contra produção

26 verificações, todas OK: GET anônimo 200, sem redirecionamento, `Content-Type` de imagem, `Content-Length`
casando com o corpo, `Access-Control-Allow-Origin: *`, `Cross-Origin-Resource-Policy: cross-origin`,
`Content-Disposition: inline`, `nosniff`, `Cache-Control` público, `Accept-Ranges`, **sem** `X-Robots-Tag`, **sem**
variar por `User-Agent`, **sem** cookie, `ETag` presente; `Range` 206 com 100 bytes exatos e `Content-Range`
correto, CORS mantido no 206, 416 com tamanho, `Range` malformado ignorado (200, como a especificação manda);
`If-None-Match` 304; id curto, travessia e id inexistente todos 404.

Open Graph, no post que já usa URL própria: `og:image` e `twitter:image` **absolutas**, no domínio de mídia,
1200x630 declarado, imagem abrindo sem login e com CORS aberto. Tombstone responde **410** e não 404 — consumidor de
Open Graph trata 410 como definitivo e para de tentar.

### Prova de ponta a ponta nos emuladores

`npm run e2e:midia-publica` — 83 verificações. Cenário semeado com objeto em cada forma, token gerado pelo próprio
emulador (como em produção o Firebase o gera no upload), e o ciclo inteiro: backup → registrar → reescrever →
rodar de novo → revogar (tem de abortar) → restaurar.

Fica provado: cobertura dos seis lugares; **registro existente reutilizado**, não duplicado; **órfão não ganha
registro**; **mídia privada intocada** pelo escopo público; **referência a objeto inexistente intacta**; URL
embutida trocada por substring com o resto do HTML **byte a byte igual**, entidade `&amp;` e link de terceiro
preservados; **token do Storage preservado** e caminho+token antigos ainda servindo; **idempotência** (segunda
passada: 0 a registrar, 0 a reescrever, HTML inalterado); `revogar` abortando em `publico` e em `tudo`; e a
restauração por substituição inversa; conflito de `updateTime` sem sobrescrever a escolha da pessoa; retomada
idempotente após conflito; e manifesto verificável dos registros criados. A lógica pura do inventário e das
proteções soma **137 verificações**.

Limitação registrada: o emulador de Storage responde **501 a `PATCH /storage/v1/.../o/…`**, que é a chamada da
revogação. Revogação só se exercita em produção — e nesta rodada não se exercita em nenhum lugar.

### Plano exato, se autorizado

Cada passo é um comando, e nenhum passa adiante sem o anterior conferido.

| # | Passo | Comando | Reversível? |
|---|---|---|---|
| 1 | Publicar a correção do `EditProfileDialog` | deploy do SITE (App Hosting) | sim, rollback de rollout |
| 2 | Conferir no ar: trocar avatar de conta descartável e ver o objeto anterior sumir do bucket | manual | — |
| 3 | Backup verificado | `--producao --fase=backup --escopo=publico --aplicar` | — (só grava arquivo) |
| 4 | Conferir integridade do backup | `--fase=restaurar --de=<arquivo>` (sem `--aplicar`) | — |
| 5 | Criar os 124 registros e manifesto protegido | `--producao --fase=registrar --escopo=publico --aplicar` | sim, registros são aditivos |
| 6 | Ensaio da reescrita com mapa completo e ACL restrita | `--producao --fase=reescrever --escopo=publico --mapa=<arquivo>` | — (não grava) |
| 7 | Reescrever as 4188 referências | `--producao --fase=reescrever --escopo=publico --aplicar` | **sim**, pelo backup |
| 8 | Conferir | `--producao --conferir` + validação da rota + Open Graph num post migrado | — |

Passos 3 a 8 são **só banco**: não exigem deploy de regra, de Function nem do site. O passo 1 exige deploy do site.
**`revogar` não aparece neste plano e está travado no script.**

### Riscos

| Risco | Tamanho | Mitigação |
|---|---|---|
| **A correção do avatar não subir antes do passo 7** | alto: cada troca de foto deixa órfão, silenciosamente | o passo 1 vem antes, e o passo 2 confere no ar |
| 3953 documentos reescritos | o maior volume de escrita já feito aqui (o privado foram 21) | `updateTime` obrigatório; conflito aborta o lote sem sobrescrever; backup de 3,90 MiB e reversão seletiva |
| Cache da CDN e de clientes | durante alguns minutos, cliente com página aberta pode ter a URL velha em memória — e ela **continua funcionando**, porque o token não é revogado | nenhuma, por desenho: é o motivo de preservar o token |
| App Android | o wrapper atual usa `server.url=https://exercitodolula.app`, portanto carrega o mesmo site recém-publicado | não existe bundle web antigo nesta configuração; reavaliar apenas se no futuro o app passar a servir arquivos locais |
| Cópia desnormalizada de avatar | post antigo guarda o avatar da época; migrar não muda isso | comportamento igual ao de hoje |
| 38 referências a objeto inexistente | imagem quebrada, hoje e depois | ficam fora do alvo e são relatadas; consertar é decisão separada |
| 26 órfãos | ocupam espaço | **não serão excluídos**; limpeza é decisão separada |
| `media/{id}` cresce de 22 para 146 documentos | leitura por requisição na rota | já é um `get` por id, com CDN na frente |

### Benefício que não era o objetivo

Hoje as Functions descobrem a mídia de um post extraindo `/m/<id>` e `/mp/<id>` do conteúdo. Para os 124 objetos em
URL legada isso **não acha nada** — então apagar um post, tornar o perfil restrito ou excluir a conta **não**
alcança a mídia pública antiga. Depois da migração, alcança. A migração não é só cosmética: ela liga a propagação
de exclusão e de visibilidade para a mídia pública.

### Implantação da mídia pública — 2026-11-12

Implantação concluída com autorização explícita:

- App Hosting: `build-2026-11-12-001`, estado `READY`, rollout concluído no backend `studio`;
- backup: 3953 documentos / 4188 referências, corpo de 3,96 MiB, sha256
  `c12932e0c7959d83abe92911660992f622e84b4b1f3f41ae72060007c4cfe44a`, ACL restrita ao dono;
- 124 registros `media/{id}` criados; manifesto sha256
  `25a0a557fefcef8302eb10f61f2e10357767aa7d89a64557762f1c0ee636a993`, ACL restrita;
- mapa completo com 4188 linhas e ACL restrita;
- 3953 documentos reescritos sem conflito de `updateTime`;
- auditoria final: 146 objetos ativos pela URL própria, 0 registrados sem referência, 0 registros órfãos,
  0 referências próprias quebradas e 0 privados com token;
- preservados por decisão: 152 tokens de objetos públicos, 26 objetos públicos órfãos e 38 referências legadas
  que já apontavam para objetos inexistentes;
- verificação externa: 6/6 amostras da rota nova e 3/3 URLs públicas antigas responderam `206`; Open Graph de
  post migrado usa `media.exercitodolula.app`.

Durante a auditoria, o inventário foi corrigido para reconhecer URL própria embutida em HTML. Sem isso, os seis
objetos migrados dentro de `posts.text` apareciam falsamente como registrados sem referência. Provas finais:
`e2e:midia-inventario` 139/139 e `e2e:midia-publica` 84/84.
