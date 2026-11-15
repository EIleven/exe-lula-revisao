# Implantação da rodada de privacidade

**O que está autorizado:** em 2026-11-11 o responsável autorizou a publicação da rodada já preparada e testada,
incluindo Functions selecionadas, migração de claims, índices/TTL, regras e site. O deploy de Functions é seletivo:
as Functions da Mariana e as demais funções fora desta rodada devem permanecer intactas.

### Ponto de reversão anterior ao deploy de 2026-11-11

- Firestore nomeado `echo-db-124325`: ruleset `94d64cc6-2d60-4376-b129-dd8073d10753`
  (`sha256:3e3dd5d0ececbf9139fbb6c83bee59f7614d0dad636aadb24cdc651dae067ced`).
- Storage `echo-b5aw9.firebasestorage.app`: ruleset `bcba5e7a-6d39-4443-9cea-c2da63f46b8a`
  (`sha256:e33b349aef36cca66a484ab9c90576da9abd6cf7b47bbd4eaad96ab24367678c`).

### Resultado da publicação de 2026-11-11

- Commit publicado: `bbb3303`.
- Oito Functions da rodada publicadas, sem erro; `agentMarianaPublisher` e `agentMarianaResponder` permaneceram
  ativas e não foram alteradas.
- Claims: 55 membros elegíveis atualizados e conferidos; zero pendências; duas contas sem perfil/vaga intocadas.
- Firestore: ruleset `8a65d558-e236-4478-b116-eaea1465f61b` no banco nomeado.
- Storage: ruleset `68395ad2-315b-4acf-84af-b298fa8b4d16`.
- Cinco políticas de TTL conferidas como `ACTIVE`.
- Marcadores antigos: 3.241 documentos receberam apenas `expireAt`; conferência final com zero pendências e zero
  inválidos.
- App Hosting: build `build-2026-11-11-002`, estado `READY`, com rollout concluído no backend `studio`.
- Páginas `/pt-BR/auth/verify-email`, `/pt-BR/auth/action`, `/pt-BR/privacy` e `/pt-BR/settings/data-rights`
  responderam HTTP 200 no domínio público.

## A ordem não é preferência — é requisito

**Regras, índices e TTL primeiro. Frontend depois.** O motivo é concreto:

O cliente novo grava `expireAt` nos marcadores de visualização e de clique. A regra **antiga** em produção usa
`isValidMarker`, que faz `keys().hasOnly(['userId', 'createdAt'])` — ela **recusa** um documento com `expireAt`. Se o
site subir antes das regras, toda gravação de visualização passa a ser negada e **a contagem de visualizações para**.
Silenciosamente: o `analyticsService` engole o erro de permissão de propósito (é assim que ele trata "já visto antes").

O contrário é seguro: com as regras novas e o site antigo, `isExpiringMarker` recusaria o documento **sem** `expireAt`
— então **regras e site precisam subir juntos, ou as regras primeiro e o site em seguida, sem demora**. A janela entre
os dois deploys é uma janela sem contagem de visualizações. Nada além disso quebra.

## Antes de publicar

1. **Comparar as regras.** `firebase deploy --only firestore:rules` publica o **arquivo inteiro**, não o seu diff.
   Baixe as regras que estão em produção e compare com `firestore.rules`: se houver commit anterior ainda não
   publicado, ele vai junto. Já aconteceu nesta base (em 2026-10-25 o deploy levou o `1c4e0c7` sem ninguém pedir).
2. **Conferir o release correto.** O banco é nomeado (`echo-db-124325`). Confirme em
   `firebaserules.googleapis.com/v1/projects/echo-b5aw9/releases` que o alvo é `cloud.firestore/echo-db-124325`.
   O release `cloud.firestore` é o `(default)` antigo e não deve ser tocado.
3. **Rodar as suítes locais:** `npm run e2e:marcadores`, `npm run e2e:consent`, `npm run e2e:auth-links`,
   `npm run e2e:auth-backend`, `npm run check:domain`, e o build das Functions (`npm --prefix functions run build`).
4. **Ler `docs/autenticacao-email.md`.** As novas regras exigem `email_verified` e a claim `member`; publicar regras
   antes das Functions e da migração de claims bloquearia contas antigas com sessão ainda aberta.

## Sequência

| # | Passo | Comando / onde | Como confirmar |
|---|---|---|---|
| 1 | Backup das regras de produção | API de rules ou console | Arquivo salvo e comparado com `firestore.rules` |
| 2 | Publicar **Functions selecionadas** | `--only` com os nomes desta rodada | Cadastro cria `member`; callables de reparo e nascimento existem; Functions da Mariana permanecem intactas |
| 3 | Migrar claims antigas | `npm run migrar:claims -- --producao` (dry-run), depois `--aplicar` e `--conferir` | Nenhum membro elegível sem `member`; claims existentes preservadas |
| 4 | Configurar e testar e-mail | Firebase Auth + DNS, conforme `docs/autenticacao-email.md` | Links e remetente no domínio próprio; SPF/DKIM/DMARC conferidos |
| 5 | Publicar **regras Firestore e Storage** | Deploy dos arquivos completos | Release correto; upload de conta pendente é negado |
| 6 | Publicar **índices e TTL** | `firebase deploy --only firestore:indexes` | Passo 7 |
| 7 | **Esperar os índices ficarem ativos** | Console do Firestore → Índices | Estado **Ativado**, não "Em construção" |
| 8 | Confirmar TTL | Console do Firestore → TTL | Cinco políticas: `views`, `profileClicks`, `_functionEvents`, `social_oauth_links`, `social_atproto_states` |
| 9 | Publicar o **site** | App Hosting (backend `studio`) | Passo 10 |
| 10 | Migrar marcadores e verificar produção | Dry-run, aplicar, conferir; depois roteiro abaixo | Sem marcador antigo fora do TTL |

## Como confirmar que os índices ficaram ativos (de verdade)

O emulador **não** valida índices, então isso só se verifica em produção, e com leitura apenas: um `POST` em
`.../databases/echo-db-124325/documents:runQuery` com `from: [{ collectionId: "comments", allDescendants: true }]` e um
`where` de igualdade em `userId`. Antes da publicação, isso responde **400 `FAILED_PRECONDITION`** nomeando o índice
que falta. Depois, responde normalmente. Repita para `likes` e `reposts`.

Enquanto esses três índices não estiverem ativos, `onUserDeletedCleanup` continua falhando e a **exclusão de conta não
se completa** — o prazo de 30 dias da política de retenção não é cumprível.

## Verificação depois do deploy do site

1. Abrir um post e conferir, no console do navegador, que a gravação da visualização **não** é negada.
2. No Firestore, abrir um documento novo em `posts/{id}/views/{uid}` e confirmar que tem `userId`, `createdAt` e
   `expireAt` ≈ 90 dias à frente.
3. Abrir a análise do post e confirmar que o número de **visualizações estimadas** subiu.
4. Com conta descartável, rodar o roteiro de exclusão de conta e confirmar nos logs que `onUserDeletedCleanup`
   **termina sem erro de índice** (antes: `[CLEANUP] Starting data cleanup for deleted user: <uid>` seguido de falha).
5. Conferir o aviso de cookies em aba nova: nenhum pedido a `googletagmanager.com` antes do aceite.

## Reversão

- **Regras:** republicar o arquivo de backup do passo 1.
- **Site:** voltar a versão anterior no App Hosting.
- **Índices:** remover um índice é operação separada e raramente desejável — índice a mais não quebra nada.
- **TTL:** desligar a política no console interrompe o apagamento. **Atenção:** o que já foi apagado não volta. Os
  marcadores apagados são apenas dedupe de visualização; o número agregado em `analytics/summary` não é afetado.

## O que este deploy NÃO faz

- Não publica documento legal com dado jurídico pendente.
- Não liga medição: `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` continua fora do `apphosting.yaml`, e o GTM só carrega com
  aceite.
- Não mexe em DNS nem em e-mail.
- Não remove nem publica `agentMarianaPublisher`, `agentMarianaResponder` ou qualquer outra Function fora da lista
  seletiva desta rodada.
