# Mídia privada: fim do token permanente

> Implementado e testado localmente. **Nada publicado.** A migração **não** foi executada.

## 1. O que estava errado

Todo upload passava por `getDownloadURL()`, que grava em `firebaseStorageDownloadTokens` um token permanente e
devolve uma URL como `firebasestorage.googleapis.com/.../o/user_uploads%2F<UID>%2Fdms%2F...?alt=media&token=<uuid>`.

Essa URL era gravada no Firestore e usada em `<img>`. O problema é o que o token é:

| Propriedade do token | Consequência |
|---|---|
| Funciona **sem login** | Qualquer pessoa com o link lê |
| **Ignora** as regras do Storage | A regra `allow get: if request.auth.uid == userId` nunca era consultada |
| **Não expira** | Vale para sempre |
| **Não se revoga** ao bloquear | Bloquear alguém não tirava o acesso dele aos anexos já recebidos |
| **Não se revoga** ao excluir conta | Idem |
| **Não se revoga** ao tornar o post privado | A mídia do post seguia acessível |

Valia para **anexo de mensagem direta** e **arquivo pessoal**, ou seja: conteúdo que a pessoa considera privado já era,
na prática, uma URL pública portadora de credencial.

## 2. O que passou a valer

A URL privada é `/mp/<mediaId>` e **não carrega credencial nenhuma**. Ela é só um identificador opaco; a autorização
é **refeita a cada requisição**, contra o estado atual. Essa é a diferença essencial: um token concede para sempre no
instante em que é emitido; uma autorização por requisição para de conceder no instante em que o estado muda.

### Como o navegador se autentica

`<img>`, `<video>` e link de download **não mandam cabeçalho `Authorization`** — só cookie. Por isso existe uma
sessão de servidor:

- `POST /api/auth/session` troca o ID token do Firebase por um **cookie de sessão** (`createSessionCookie`);
- o cookie é `HttpOnly`, `Secure`, `SameSite=Strict`, **sem `domain`**;
- `src/lib/services/serverSession.ts` mantém o cookie alinhado no observador de estado de autenticação, então login
  por senha, login com Google, recarregamento e logout ficam cobertos num único ponto.

**O nome `__session` não é escolha.** É o único cookie que o Firebase Hosting e o App Hosting repassam ao backend;
com outro nome a CDN o remove e a rota responde 404 para todos. Não renomear.

**Sem `domain` também é decisão:** o cookie fica preso ao domínio principal e **não** é enviado para
`media.exercitodolula.app`, que serve conteúdo público com CORS aberto. Separar os dois domínios é o que impede a
sessão de passear junto do conteúdo público.

### A autorização

`verifySessionCookie(cookie, **true**)` — o `true` confere **revogação a cada requisição**. Custa uma verificação no
serviço de Auth por pedido, e é o preço de "parar na hora" para conta desativada, excluída ou com sessão revogada.
Com `false`, o cookie seguiria valendo até expirar.

Depois disso, por tipo:

| Tipo | Quem acessa |
|---|---|
| `dm` (anexo de mensagem) | o dono, **ou** quem está em `participantIds` da conversa — **e** ninguém bloqueado |
| `userFile`, `avatar`/`cover`/`postMedia` privados | só o dono |
| tipo desconhecido | ninguém (padrão seguro) |

A conversa é **derivada**, não guardada: as conversas desta rede são estritamente de dois participantes e o id é
`<menor uid>_<maior uid>` (ver `isValidNewConversation` em `firestore.rules`). Então dá para calcular a conversa a
partir do dono do arquivo e de quem pede, sem mais um campo para manter em sincronia.

**Toda negativa é 404, nunca 403.** Um 403 confirmaria que o id existe, e o id é a única coisa que alguém tentando
adivinhar tem em mãos.

### Divergência consciente em relação à regra de mensagens

A regra `canReadMessages()` autoriza leitura **só** por `participantIds`; ela **não** olha bloqueio. A mídia privada
é mais estrita: bloqueio corta nos dois sentidos.

Consequência prática: depois de um bloqueio, a pessoa continua vendo o **texto** das mensagens antigas e **deixa de
ver os anexos**. Isso foi pedido explicitamente. Para ficar consistente, a regra de mensagens também precisaria
considerar bloqueio — mas isso muda o comportamento de mensagens e é decisão própria, não efeito colateral desta
correção.

### Formatos

Imagem, vídeo, áudio e PDF abrem no navegador. **SVG e qualquer coisa com HTML vão como download, sempre.**

O motivo é concreto: a rota serve do **nosso** domínio, com a sessão da pessoa nos cookies. Um SVG é um documento que
executa script — servi-lo `inline` daria a um arquivo enviado por outra pessoa a chance de rodar no nosso contexto de
origem. XSS armazenado, pelo caminho mais curto. `?dl=1` força download para qualquer tipo.

`Range` é honrado (206 e `Content-Range`), então vídeo e áudio permitem arrastar a linha do tempo. O nome do arquivo
no download é montado por nós a partir do tipo — **nunca** o nome original, que com aspas ou nova linha permitiria
injetar cabeçalho na resposta.

### Cabeçalhos

`Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow, noimageindex, noarchive`,
`Cross-Origin-Resource-Policy: same-origin`, **sem** `Access-Control-Allow-Origin`, `X-Content-Type-Options: nosniff`
e `Vary: Cookie, Range`.

`no-store` e não `private, max-age`: com cache, revogar deixaria de ter efeito imediato — que é a propriedade que
esta camada existe para garantir. O custo é a origem ser tocada sempre, aceitável porque conversa privada não tem o
volume de um feed público.

## 3. Post público que vira privado

Era o caso que o token deixava aberto: a mídia continuava acessível por **dois** caminhos.

`POST /api/media/visibility` fecha os dois, nesta ordem:

1. marca o registro como `private` — a rota pública `/m/<id>` passa a responder 404;
2. **apaga o token** do objeto no Storage — a URL antiga deixa de conceder acesso.

Sem o passo 2 o passo 1 é decorativo. Só o dono muda a própria mídia, e a operação é idempotente.

**Pendência de ligação:** a rota existe e está testada, mas ainda **não é chamada** pelas telas que mudam a
visibilidade de um post. Ligar isso é o próximo passo e precisa de atenção ao caso em que a visibilidade muda pelo
servidor (a Function que acompanha a troca de perfil privado).

## 4. Migração

`scripts/migrar-tokens-midia.mjs`, em fases, **somente leitura por padrão**:

| Fase | O que faz |
|---|---|
| `inventario` (padrão) | Conta objetos por tipo e quantos têm token. **Só lê.** |
| `registrar` | Cria `media/{id}` para objetos sem registro |
| `reescrever` | Troca as URLs gravadas em `userFiles.url` e `messages.fileUrl` |
| `revogar` | Apaga `firebaseStorageDownloadTokens` dos objetos **privados** |
| `--conferir` | Confere o estado final; sai com código 1 se faltar algo |

**A ordem não é opcional.** Revogar o token de um objeto cuja URL antiga ainda está gravada quebra o anexo na hora.
O script **aborta** se mandarem revogar antes de registrar.

**Só os privados são revogados.** Mídia pública mantém o token: ela é pública de qualquer forma, e revogar quebraria
um card já compartilhado fora, onde não temos como corrigir.

A fase `revogar` é **irreversível**: o token não volta.

## 5. Testes

`npm run e2e:midia-privada` — 67 verificações, cobrindo os nove cenários pedidos: acesso autorizado, deslogado,
participante removido, usuário bloqueado (nos dois sentidos), post que vira privado, token antigo copiado antes da
migração, exclusão de conteúdo e de conta, tentativa de enumerar ids, e dezesseis formatos de anexo.

`npm run e2e:midia` — 87 verificações da camada pública.

## 6. Riscos e pendências

- **A rota de visibilidade ainda não é chamada** pelas telas (seção 3).
- **Mídia pública segue com token** até a fase 5 da migração pública, que é decisão separada.
- **Latência:** `checkRevoked` custa uma verificação por requisição. Numa conversa com muitos anexos isso soma. Se
  virar problema, a alternativa é cookie de vida curta com `checkRevoked: false` — troca imediatismo por velocidade,
  e seria uma regressão no requisito.
- **Sem a sessão, a mídia privada não carrega.** Se `POST /api/auth/session` falhar, o anexo não aparece. O código
  tenta de novo na próxima mudança de estado, e o resto da rede continua funcionando.

## 7. Publicação e reversão

**Ordem:** publicar o site (rotas novas e upload sem token) **antes** de qualquer fase da migração. Enquanto a
migração não roda, as URLs antigas continuam funcionando — não há janela de quebra.

1. Publicar o site.
2. Conferir: anexo novo em conversa abre; `/mp/<id>` de outra conta responde 404; deslogado responde 404.
3. `--fase=inventario --producao` e ler os números.
4. `--fase=registrar --aplicar`, depois `--fase=reescrever --aplicar`.
5. Conferir que anexos antigos abrem pela URL nova.
6. **Só então** `--fase=revogar --aplicar`, e `--conferir`.

**Reversão:** voltar a versão anterior do site restaura o comportamento antigo **desde que a fase `revogar` não tenha
rodado**. Depois dela não há volta: o token não é recuperável, e os anexos antigos dependem da rota nova. Por isso a
fase `revogar` só deve ser executada depois de o site novo estar estável e verificado.
