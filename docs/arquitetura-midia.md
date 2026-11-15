# URLs próprias para mídia (media.exercitodolula.app)

> Projeto e implementação. A implantação **não** está autorizada.

## 1. Diagnóstico: como está hoje

Todo upload vai para `user_uploads/{uid}/<tipo>/<uuid>.<ext>` e recebe `getDownloadURL()`, que produz uma URL do
tipo `firebasestorage.googleapis.com/v0/b/<bucket>/o/user_uploads%2F<UID>%2FpostMedia%2F...?alt=media&token=<uuid>`.

Essa URL é gravada no Firestore e é o que vai para o navegador, para o Open Graph e para qualquer lugar.

### Os quatro problemas, em ordem de gravidade

**1. O token de download é uma credencial permanente que ignora as regras.**
`storage.rules` tem um único bloco e a leitura é **só do dono** (`allow get: if request.auth.uid == userId`). Ou
seja: nada é público pelas regras. O que torna a mídia acessível é o `?token=`, que o Storage honra **sem login e
sem passar pelas regras**. Quem tiver a URL lê para sempre — mesmo deslogado, mesmo bloqueado, mesmo depois de o
post virar privado.

**2. Anexo de mensagem direta e arquivo pessoal usam o MESMO mecanismo.**
`directMessageMediaPathFactory` e `userFilesPathFactory` também chamam `getDownloadURL()`. Então conteúdo que a
pessoa considera privado **já é uma URL pública portadora de token**. Não há separação estrutural entre público e
privado: há o mesmo token para os dois.

**3. O UID aparece em toda URL de mídia.** É identificador interno de pessoa, exposto em cada imagem do feed e em
cada card compartilhado. Permite correlacionar todo o conteúdo de alguém.

**4. Trocar a visibilidade do post não revoga nada.** Tornar um post privado, ou apagá-lo, não invalida o token: a
mídia continua acessível por quem já tem o link.

## 2. Comparação das estratégias

`media.exercitodolula.app`, `www` e o apex resolvem todos para **35.219.200.4** — o mesmo backend do App Hosting.
Isso elimina parte das opções sem discussão: não existe bucket nem CDN separado, é o mesmo Next.js.

| | A. Rota no Next.js | B. Redirecionar para o Storage | C. Bucket com domínio próprio | D. Cloud CDN + Load Balancer |
|---|---|---|---|---|
| Esconde o host do Storage | **Sim** | **Não** — aparece na barra e no painel de rede | Parcial: o caminho vira a URL | Sim |
| Esconde UID e token | **Sim** | Não | Não, sem reorganizar o bucket | Sim |
| Público e privado separados | **Sim**, decidido a cada requisição | Não | **Não**: bucket público não tem controle por objeto | Sim |
| Range, ETag, CORS | Nossa responsabilidade, em código | Herdado do Storage | Herdado do GCS | Herdado |
| Custo por byte | CPU e egresso do Cloud Run, **mitigado pela CDN do App Hosting** | Quase zero | Baixo | Baixo, mais custo fixo do balanceador |
| Infra nova | **Nenhuma** | Nenhuma | HTTPS em domínio próprio exige balanceador | Balanceador, CDN e DNS |
| Autorização necessária | Não: já aponta para cá | — | **Mudança de DNS** | **Mudança de DNS** |
| Exclusão propagada | Origem responde 410 e a borda expira | Impossível revogar o token | Difícil | Purga da CDN |

**Decisão: A.** É a única que satisfaz a exigência de que conteúdo privado **nunca** vire URL pública, e a única que
não depende de infraestrutura nova nem de alteração de DNS. **B** está descartada por violar o requisito central.
**C** e **D** ficam como evolução se o volume crescer — e aí o desenho A continua valendo, porque a URL pública não
muda: muda apenas quem a serve.

**Sobre o custo de A, que é a objeção óbvia:** passar bytes por Cloud Run é caro se cada requisição chegar à origem.
O que torna A viável é a **CDN do App Hosting**: com `Cache-Control` adequado e `ETag`, a repetição é servida na
borda e a origem só é tocada na primeira vez por objeto, por região. O custo real fica próximo de uma CDN comum, com
o controle de acesso de um proxy.

## 3. Desenho

### Identificador opaco

Cada objeto ganha um `mediaId` aleatório e não sequencial, e a URL pública passa a ser
`https://media.exercitodolula.app/m/<mediaId>` — sem UID, sem caminho, sem token e sem extensão.

O `mediaId` não carrega informação: é uma chave para um documento nosso, e é ele que diz onde o objeto está e se pode
ser servido.

> **Isto é o que fecha o open proxy.** A URL nunca contém um caminho. Se contivesse, bastaria trocá-lo para ler
> qualquer objeto do bucket. O caminho vem sempre do nosso banco.

### Modelo de dados

A coleção `media/{mediaId}` guarda: `storagePath` (o caminho real, nunca exposto), `contentType` (conferido na
gravação, não deduzido da URL), `size`, `ownerUid`, `visibility` (`public` ou `private`), `kind` (`postMedia`,
`avatar`, `cover`, `dm`, `userFile`), `createdAt` e `deletedAt` (quando preenchido, a rota passa a responder 410).

Regra de ouro: **`visibility: public` só existe para `postMedia`, `avatar` e `cover`.** Anexo de mensagem e arquivo
pessoal nascem `private` e **não têm** URL pública — continuam sendo lidos pelo SDK autenticado, pelas regras do
Storage, como hoje.

### A rota

`GET` e `HEAD` em `/m/<id>`:

1. Resolve o documento. Não existe, **404**.
2. `deletedAt` preenchido, **410 Gone** — tombstone explícito, e não 404: diz que existiu e foi removido.
3. `visibility` diferente de `public`, **404** e não 403. Um 403 confirmaria que o id existe.
4. Objeto ausente no bucket, **404**.
5. Serve os bytes com os cabeçalhos abaixo, honrando `Range`.

| Cabeçalho | Valor | Por quê |
|---|---|---|
| `Content-Type` | do documento | Nunca deduzido da URL, que não tem extensão |
| `Accept-Ranges` | `bytes` | Vídeo e áudio precisam para buscar posição |
| `Content-Range` com **206** | quando há `Range` | Sem isso o vídeo não permite arrastar a linha do tempo |
| `ETag` | geração do objeto | Permite 304 e economiza banda |
| `Cache-Control` | `public, max-age=3600, s-maxage=3600` | Ver a nota abaixo |
| `Content-Disposition` | `inline` | Abrir no navegador, não baixar |
| `Access-Control-Allow-Origin` | `*` | Só para mídia pública; é o que permite incorporar fora do site |
| `Cross-Origin-Resource-Policy` | `cross-origin` | Mesma razão |
| `X-Content-Type-Options` | `nosniff` | Impede o navegador reinterpretar o tipo |

**Nota sobre exclusão e cache, com honestidade:** `s-maxage=3600` é uma escolha, não um padrão. Com cache longo
(`immutable`), um objeto apagado continuaria sendo servido pela borda por muito tempo, o que contradiz a exigência
de exclusão. Com cache curto, a origem é tocada mais vezes e o custo sobe. Uma hora equilibra: repetição no feed sai
de graça, e a exclusão propaga em até uma hora. **Isso precisa estar dito ao usuário**, como já dizemos sobre
backups e federação: apagar remove do site e da origem na hora, e das caches intermediárias em até uma hora.

### Compatibilidade com ActivityPub e AT Protocol

A URL `media.exercitodolula.app/m/<id>` é estável, pública, sem token e sem autenticação — exatamente o que um
`Document` do ActivityPub e um blob referenciado pelo AT Protocol precisam. Com o desenho atual, de token do Storage,
a federação seria impossível de fazer direito: a URL federada carregaria uma credencial permanente nossa.

## 4. Migração, sem quebrar nada

O ponto que torna a migração segura: **as URLs antigas continuam funcionando**, porque o token não é revogado. Logo
não existe janela de quebra.

| Fase | O que acontece | Posts antigos |
|---|---|---|
| 1 | Rota e coleção `media` publicadas; nada muda no que já existe | Funcionando pela URL antiga |
| 2 | Uploads **novos** passam a gravar `media/{id}` e a usar a URL nova | Funcionando pela URL antiga |
| 3 | Script cria `media/{id}` para objetos antigos, dry-run primeiro | Funcionando pela URL antiga |
| 4 | Script reescreve as URLs gravadas no Firestore para a forma nova | Passam a usar a URL nova |
| 5 | Só depois de 4 confirmado: avaliar revogar os tokens antigos | — |

A fase 5 é a única destrutiva e fica para decisão própria: revogar token é irreversível e quebraria qualquer cópia da
URL antiga que exista fora — um card já compartilhado num aplicativo de mensagens, por exemplo.

## 5. O que este projeto NÃO resolve

- **Não revoga** os tokens já emitidos. Enquanto a fase 5 não acontecer, quem tem uma URL antiga continua lendo.
- **Não torna privado** o que já foi público: a mídia de um post público é pública por definição.
- **Não impede** alguém de baixar e repostar em outro lugar. Nada impede isso.
