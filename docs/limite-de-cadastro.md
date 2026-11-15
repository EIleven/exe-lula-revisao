# Limite dos primeiros usuários (500 vagas históricas)

Atualizado em 2026-10-25. O cadastro aceita somente os **primeiros 500 usuários**. O limite é imposto **no servidor**, com
concorrência segura: esconder o formulário ou contar no navegador não protege nada.

## Como funciona

**Vagas históricas.** Cada UID que recebeu uma vaga a mantém **para sempre**. Excluir a conta **não** libera vaga para outra
pessoa, e repetir o pedido do mesmo UID não consome outra.

| Documento | Conteúdo |
|---|---|
| `_signup/control` | `limit` (500), `used` (vagas dadas), `createdAt`, `updatedAt` |
| `_signup/control/slots/{uid}` | a vaga de cada UID: `number`, `provider` (`password`, `google.com` ou `migration`), `createdAt` |

`used` é sempre igual ao número de documentos em `slots/`. Nenhum dos dois é legível nem gravável pelo cliente (regra
`match /_signup/{document=**} { allow read, write: if false; }`); só as Functions (Admin SDK) e o script administrativo.

**Uma transação só** (`claimSlotAndCreateProfile` em `functions/src/signup.ts`): lê o controle, a vaga do UID, o perfil e o `@`
e, se tudo estiver certo, grava de uma vez o contador, a vaga, `usernames/{@}`, `users/{uid}` e `users/{uid}/private/account`.
Se qualquer parte falhar, **nada é consumido nem fica pela metade**.

- Perfil que já existe: devolve `exists`, sem gravar nem consumir (idempotente).
- UID que já tem vaga (perfil apagado e recriado): reaproveita a vaga.
- Sem vaga e `used >= limit`: `resource-exhausted` (mensagem em português e inglês, `details.reason = "signup-closed"`).
- `@` ocupado por outra pessoa: `already-exists`, sem consumir.
- **Sem o documento de controle o cadastro FECHA** (`failed-precondition`), em vez de virar ilimitado.

**Os dois caminhos de cadastro usam a mesma transação:**

| Caminho | Function | O que faz |
|---|---|---|
| E-mail e senha | `createUserProfile` (pública) | valida a entrada (`@` com 3 a 15 letras, números ou `_`), confere limite e `@` ANTES de criar a conta, cria a conta no Auth, roda a transação e, se ela falhar, **apaga a conta nova** (sem órfã) |
| Primeiro acesso com o Google | `claimGoogleProfile` (exige login com o Google) | não recebe dado nenhum do cliente: nome, e-mail e foto vêm da conta no Auth; gera um `@` provisório único; se estiver lotado, **apaga a conta que o Google acabou de criar** (só se ela não tem perfil nem vaga) |
| Situação para a tela | `getSignupStatus` (pública) | devolve só `{ open, limit }`; **nunca o contador `used`** |

O navegador só cria o perfil do Google chamando `claimGoogleProfile`. A tela "Finalize seu Perfil" (escolher o `@` e informar o
nascimento) continua depois, pela Function `updateUserUsername` e por uma atualização de `private/account`.

## Regras do Firestore (`firestore.rules`)

| Caminho | Antes | Agora |
|---|---|---|
| `users/{uid}` criar | o dono, com 18 campos válidos | **ninguém** pelo cliente (só as Functions) |
| `usernames/{@}` | qualquer conta logada criava (e apagava o próprio) | só leitura; escrita **só** pelas Functions |
| `users/{uid}/private/account` criar | o dono | o dono **que tem vaga** em `_signup/control/slots/{uid}`; atualizar segue sendo do dono |
| `_signup/**` | (sem regra) | `read, write: if false` |

Antes, uma conta criada direto na API pública do Auth (a chave da web é pública) criava o próprio perfil, vários `@` e os dados
pessoais, sem passar pelo cadastro. Os testes mostram o contraste: contra as regras antigas essas escritas dão **HTTP 200** e o
SDK do Firebase é **permitido**; contra as novas, `permission-denied`.

## Script administrativo: `scripts/inicializar-limite-cadastro.mjs`

Cria o documento de controle e uma vaga para cada perfil que já existe. **Idempotente**: rodar de novo só grava se algo mudou.

```
node scripts/inicializar-limite-cadastro.mjs                       emuladores, só o plano
node scripts/inicializar-limite-cadastro.mjs --aplicar             emuladores, grava
node scripts/inicializar-limite-cadastro.mjs --producao            produção, só o plano
node scripts/inicializar-limite-cadastro.mjs --producao --aplicar  produção, grava
        --limite=500    limite (padrão: o que já está no controle; se não existe, 500)
        --conferir      não grava; sai com código 1 se houver divergência
```

Em produção o token vem de `FIRESTORE_ACCESS_TOKEN` (`gcloud auth print-access-token --account=<dono>`) e nunca é impresso.
Tudo vai em **uma gravação atômica** com pré-condição no controle: se um cadastro entrar no meio, a gravação falha e o plano é
refeito (até 5 tentativas). Para **subir o limite** no futuro: `--limite=1000 --aplicar`.

## Ordem em produção

1. Script `--producao` (plano) e depois `--producao --aplicar`: cria o controle com o número real de perfis.
2. Publicar **só** as Functions `createUserProfile`, `claimGoogleProfile` e `getSignupStatus`
   (`firebase deploy --only functions:createUserProfile,functions:claimGoogleProfile,functions:getSignupStatus`).
3. Script `--producao --conferir` (nenhum cadastro pode ter escapado da contagem entre os passos 1 e 2).
4. Publicar o site (o cliente passa a chamar `claimGoogleProfile`).
5. **Por último**, as regras do Firestore (fecham a criação direta; antes disso o cliente antigo ainda a usava).

## O que esta proteção NÃO cobre (riscos que sobram)

- **Contas só-Auth.** Qualquer pessoa com a chave pública da web consegue criar uma conta no Auth sem passar pelo cadastro. Ela
  **não ganha perfil nem vaga** (as regras e `claimGoogleProfile` recusam), mas ainda pode escrever marcadores de curtida e de
  repost, que não exigem perfil. Fechar isso de vez pede uma Function de bloqueio de criação (`beforeUserCreated`), que depende
  do upgrade para o Identity Platform (o mesmo da verificação em duas etapas).
- **Robôs podem consumir as 500 vagas.** Não há captcha, App Check nem confirmação de e-mail antes de reservar a vaga:
  um script que chame `createUserProfile` em laço enche as vagas com contas falsas. Opções: App Check, reCAPTCHA, limite por IP,
  vaga só depois de confirmar o e-mail, ou convites. Não foi implementado por não ter sido pedido.

## Testes

`npm run e2e:fluxos` (seção `cadastro`, 37 verificações nos emuladores): 499 vagas com 6 cadastros simultâneos (e-mail e Google)
entra exatamente 1; com 500, e-mail e Google são recusados e a conta do Google não fica órfã; mesmo UID repetido não consome;
`@` repetido, e-mail repetido e `@` inválido não consomem; quem já tem conta continua entrando; excluir conta não libera vaga;
sem o controle o cadastro fecha; aviso em português e inglês; criação direta recusada (REST e SDK do Firebase de verdade); e
idempotência do script. O fluxo do Google também roda **pela tela**, pelo popup do Auth emulado.

## Validação em produção (2026-10-25)

Implantado na ordem acima: migração (7 perfis: `used` = 7 e 7 vagas `migration`), as 3 Functions, conferência, site
(`build-2026-10-25-002`) e, por último, as regras. Depois, um roteiro rodou **contra https://exercitodolula.app**, com contas
descartáveis e reversão completa (logs em `E:\Soberan\tools\logs\publicacao\validacao-producao-limite-*.txt`):

| Fase | O que fez | Resultado |
|---|---|---|
| A | Só leitura e recusas: controle com limite 500 e `used` = vagas = perfis = 7; `getSignupStatus` aberto e sem o contador; `@` inválido recusado no servidor; `claimGoogleProfile` sem login e com token inválido → `UNAUTHENTICATED`; sem login, criar `users` e `usernames` e ler ou gravar o controle → recusado | 12 de 12 |
| B | Conta só-Auth criada pela API pública da web: criar o próprio perfil, um `@` ou os dados pessoais (sem vaga) → recusado; ler ou gravar o controle → recusado; `claimGoogleProfile` com conta de senha → `PERMISSION_DENIED`; conta apagada | 9 de 9 |
| C | Cadastro **real pela tela** do site (Chrome sem interface; o e-mail de confirmação foi abortado no navegador, nada saiu): o site novo chama `getSignupStatus` e abre o formulário; "Cadastro Realizado com Sucesso" e o feed abre; contador 7 → 8 e vaga 8 (`password`) gravada junto com perfil, `@` e dados pessoais; e-mail repetido e `@` repetido (em maiúsculas) → `ALREADY_EXISTS`, sem consumir vaga e sem conta órfã no Auth; login por e-mail e senha e pela tela; com conta própria, criar `@` extra, criar outro perfil, ler ou gravar o controle e apagar o próprio `@` → recusado, e atualizar os próprios dados pessoais → permitido | 23 de 26 (as 3 falhas não são do limite: veja os achados) |

**Reversão.** A conta de teste foi apagada no Auth, a vaga de teste foi apagada à mão (a única exceção à regra de que vaga nunca
sai: vale só para este artefato de validação), o nó de presença dela no Realtime Database também, e o contador foi reconciliado
com `inicializar-limite-cadastro.mjs --producao --aplicar`. Estado final igual ao inicial: limite 500, `used` 7, 7 vagas, 7
perfis, nenhuma conta `@example.test` no Auth.

**Não validado em produção.** (1) O caminho do Google de ponta a ponta, que exige uma conta Google real: em produção só foram
conferidas as recusas (sem login, token inválido, conta de senha); o caminho completo roda nos emuladores, por REST e pelo popup
do navegador. (2) O estado "500 preenchidas": só nos emuladores, porque baixar o limite em produção para testar recusaria
cadastros reais durante o teste.

**Junto com as regras foi publicado** o que já estava commitado e ainda não tinha ido para produção: `1c4e0c7` (o autor de um
perfil privado volta a repostar e citar o PRÓPRIO post e comentário; para as outras pessoas segue a recusa).

### Achados da validação (já existiam; não são do limite)

1. **A limpeza de conta não funciona em produção.** A Function `onUserDeletedCleanup` falhou com `FAILED_PRECONDITION` nas três
   exclusões de teste: falta, no banco `echo-db-124325`, o índice de campo único de grupo de coleções em `userId` para
   `comments`, `likes` e `reposts` (conferido por consulta direta aos três). Apagar a conta no Auth **não** apaga perfil, `@` e
   dados pessoais (e-mail e nascimento) e nada é anonimizado. A mesma busca em `comments.userId` está em `onUserUpdated`: trocar
   nome, foto ou `@` não chega aos posts e comentários já publicados (o lote de posts só é gravado depois dessa busca, que
   falha). Nenhuma conta real passou por isso ainda. O emulador não valida índices, por isso a suíte não vê. Correção proposta,
   **não aplicada**: declarar em `firestore.indexes.json`, em `fieldOverrides`, os três campos com `queryScope:
   COLLECTION_GROUP` e `order: ASCENDING` (mais os índices padrão do escopo `COLLECTION`, como no override de `createdAt` que já
   existe) e rodar `firebase deploy --only firestore:indexes`.
2. **Erros de permissão no console de quem acabou de entrar**, sem relação com as regras novas (as regras de leitura são
   idênticas antes e depois do deploy): o diálogo de análises de cada post lê `posts/{id}/analytics/summary` ao montar e a regra
   deixa só o autor ler (19 erros por carga do feed), e "contas sugeridas" consulta `users` antes de a sessão estar pronta (a
   listagem exige login; 1 erro).
3. O avatar padrão `/profile.png` dá 404: o arquivo nunca existiu em `public/`.
