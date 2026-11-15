# Migração dos marcadores antigos de visualização e de clique

> **NÃO EXECUTADA.** Preparada em 2026-11-11 e aguardando o "publica" explícito do responsável, junto com a
> implantação coordenada de `docs/implantacao-privacidade.md`.

## O problema

A mudança de 2026-11-11 passou a gravar `expireAt` nos marcadores de visualização (`posts/{id}/views/{uid}`) e de
clique no perfil (`posts/{id}/profileClicks/{uid}`), e declarou políticas de TTL para apagá-los em 90 dias.

**Isso só resolve o futuro.** Os marcadores gravados antes têm apenas `createdAt`. A política de TTL do Firestore só
enxerga documento que **tem** o campo de expiração — então todo o passado continuaria guardado para sempre, que é
exatamente o que a mudança pretendia encerrar.

E o cliente não pode consertar: as regras permitem **apenas `create`** nessas coleções, nunca `update`. Tem de ser
migração administrativa.

## O que a migração faz

`scripts/migrar-expireat-marcadores.mjs` varre os dois grupos de coleções e, para cada marcador **sem** `expireAt`,
grava `expireAt = createdAt + 90 dias`.

| Propriedade | Como é garantida |
|---|---|
| **Dry-run por padrão** | Só grava com `--aplicar`. Sem a flag, apenas conta e relata |
| **Idempotente** | Quem já tem `expireAt` é ignorado. Rodar de novo não grava nada |
| **Não mexe no agregado** | Grava com `updateMask` restrito a `expireAt`. O número do post vive em outro documento, que o script nem abre |
| **Não re-dispara contador** | Os gatilhos que somam são `onDocumentCreated`. **Atualizar** um marcador existente não os aciona, então a contagem do post não muda |
| **Não ressuscita documento** | Pré-condição `currentDocument: { exists: true }`: se o TTL apagou entre a leitura e a gravação, não recriamos |
| **Não adivinha data** | `createdAt` ausente ou de tipo errado é relatado como **inválido** e deixado intacto |
| **Leitura enxuta** | Projeção de campos: lê só `createdAt` e `expireAt`, não o documento inteiro |

### Por que marcador antigo é apagado logo

Para quase tudo, `createdAt + 90 dias` já está **no passado** — o TTL apaga na varredura seguinte (o Firestore não
promete o instante; costuma ser em até alguns dias). O relatório separa esses como "já vencidos", para não haver
surpresa: a maior parte da base antiga **vai desaparecer**, e é esse o objetivo.

O agregado não é afetado: o número de visualizações estimadas do post continua onde está.

## Como rodar

```powershell
. E:\Soberan\tools\activate-env.ps1   # Node 22

# 1. Emuladores primeiro, sempre (ver a verificação abaixo)
npm run migrar:marcadores

# 2. Produção, só relatório — NÃO grava
$env:FIRESTORE_ACCESS_TOKEN = (gcloud auth print-access-token --account=<dono do projeto>)
npm run migrar:marcadores -- --producao

# 3. Primeira rodada cautelosa: examina 2000 documentos e para
npm run migrar:marcadores -- --producao --limite=2000

# 4. Aplicar (SÓ com autorização explícita)
npm run migrar:marcadores -- --producao --aplicar

# 5. Conferir que não sobrou nada (sai com código 1 se sobrou)
npm run migrar:marcadores -- --producao --conferir
```

O token **nunca** é impresso pelo script. `--colecao=views` ou `--colecao=profileClicks` restringe a uma das duas.

## Ordem em relação ao resto da implantação

A migração **depende** de nada e **não atrapalha** nada: ela grava um campo que, antes do deploy das políticas de
TTL, simplesmente ninguém lê. Pode rodar antes ou depois das políticas. O que **não** deve acontecer é publicar as
políticas de TTL, concluir que o passado foi tratado e nunca rodar a migração — é precisamente a lacuna que ela
cobre.

Recomendado: rodar **depois** de regras, índices e TTL publicados e confirmados, e **antes** de declarar a rodada
encerrada.

## Teste e verificação

### Teste automatizado

`npm run e2e:marcadores` cobre a decisão documento por documento, sem tocar em banco: idempotência (quem já tem
`expireAt`), marcador de hoje, de 89 dias, de 90 dias, de um ano, e os cinco casos de `createdAt` inutilizável
(ausente, nulo, `NaN`, zero, texto). Também varre o próprio script e reprova se ele perder o dry-run, a máscara
restrita a `expireAt`, a pré-condição de existência, ou se passar a mencionar agregado ou contador.

### Verificação nos emuladores — **executada em 2026-11-11, passou**

Não é só roteiro: foi rodada de ponta a ponta contra o Emulator Suite (projeto `demo-soberan`), porque o teste de
lógica cobre a decisão mas **não** cobre a parte REST — cursor, formato do `runQuery`, formato do `commit` — que é
onde um erro apareceria só em produção.

O que foi semeado em `posts/migTest/`: `views/antigo` (createdAt de 200 dias, sem `expireAt`), `views/jaTem` (já com
`expireAt`), `views/semData` (sem `createdAt`) e `profileClicks/antigoClique` (120 dias).

| Passo | Resultado observado |
|---|---|
| `npm run migrar:marcadores` (dry-run) | `views`: 3 examinados, 1 já tem, 1 a atualizar (1 vencido), 1 inválido. `profileClicks`: 1 a atualizar. **Nada gravado**, e o inválido listado com o caminho |
| `-- --aplicar` | **GRAVADOS: 2** |
| `-- --conferir` | 4 examinados, **já têm 3**, **a atualizar 0**, saída **código 0** |
| `-- --aplicar` de novo | **GRAVADOS: 0** (idempotência) |

Conferência documento por documento depois da gravação:

- `views/antigo`: ganhou `expireAt` = `createdAt` + 90 dias, **já vencido**, e os campos ficaram exatamente
  `createdAt, expireAt, userId` — `createdAt` intacto, nada extra acrescentado.
- `views/jaTem`: `expireAt` **preservado**, não sobrescrito.
- `views/semData`: **intocado**, segue só com `userId`.
- `profileClicks/antigoClique`: migrado igual ao primeiro.

> Nota de método: na primeira tentativa o conferidor acusou falsa sobrescrita em `views/jaTem`, porque ele havia sido
> semeado com `createdAt` de −10 dias e `expireAt` de +80 — diferença de exatamente 90 dias, indistinguível de um
> documento migrado. O defeito era do dado de teste, não da migração (o dry-run já havia contado aquele documento
> como "já tem"). Re-semeado com diferença de 30 dias, a preservação ficou demonstrada.

### Repetir a verificação

1. `npm run emulators`
2. Semear os quatro marcadores acima — **com `expireAt` de diferença diferente de 90 dias** no caso "já tem".
3. Dry-run, `--aplicar`, `--conferir`, `--aplicar` outra vez, e conferir os campos de cada documento.

### Verificação em produção, depois de aplicar

1. `--conferir` sai com código 0.
2. Abrir um marcador antigo no console e confirmar `expireAt` coerente com o `createdAt` dele.
3. Conferir que o número de visualizações estimadas de um post conhecido **não mudou**.
4. Depois de alguns dias, confirmar que os marcadores vencidos sumiram e que o número do post segue intacto.

## Decisão pendente

**Marcadores inválidos.** Se o relatório apontar algum `createdAt` ausente ou corrompido, o script não os toca por
princípio — chutar a data seria inventar quando a pessoa viu o post, e errar para mais guardaria o rastro além do
prazo. Com o número em mãos, decidir entre: apagar (são dedupe de visualização, não há perda de métrica), marcar com
`expireAt` imediato, ou investigar a origem. Até lá eles permanecem.
