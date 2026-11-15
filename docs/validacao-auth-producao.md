# Validação do fluxo de autenticação em produção

> **Roteiro, não execução.** Nada aqui foi rodado. Validar em produção mexe em dados reais e **custa uma vaga das
> 500** se a limpeza não for completa (ver o aviso abaixo). Depende de autorização explícita.

## AVISO: cada conta de teste queima uma vaga das 500

`onUserDeletedCleanup` apaga 12 coleções quando a conta é excluída — `users`, `usernames`, `bookmarks`,
`fcmTokens`, `followers`, `following`, `notifications`, `posts` e as quatro `social_*`. Ele **não toca em
`_signup`**, porque as vagas do limite de cadastro são **históricas por decisão de projeto**: um UID que recebeu
vaga a mantém para sempre, e excluir a conta não libera vaga para outra pessoa.

**Consequência:** sem o passo 9 da limpeza, a conta descartável consome permanentemente uma das 500 vagas. Já
aconteceu uma vez nesta base. Não pule esse passo.

## Pré-requisitos

1. **Endereço de e-mail que você realmente leia**, porque o teste exige clicar nos links. O melhor caminho é o
   *plus-addressing* do Gmail: `admlabra+auth1@gmail.com` chega na mesma caixa e é um endereço distinto para o
   Firebase. Não use serviço de e-mail temporário: alguns descartam a mensagem e você não saberá se o problema foi
   o envio.
2. **Token de acesso** para as verificações administrativas, só quando necessário:
   `gcloud auth print-access-token --account=<dono do projeto>` em `FIRESTORE_ACCESS_TOKEN`. **Nunca imprimir.**
3. Anotar antes de começar: `used` e `limit` em `_signup/control`, para conferir no fim.
4. Navegador limpo (janela anônima) para o cadastro, e um **segundo** navegador ou aparelho para o teste de
   confirmação cruzada.

## Roteiro

### 1. Cadastro

Pela tela real em `https://exercitodolula.app/pt-BR/register`, com o endereço do passo 1. Confirmar:

- a conta é criada e a sessão abre;
- a tela de **"Confira seu e-mail"** aparece;
- o e-mail chega. **Anotar**: remetente exibido, domínio do link, idioma, e se caiu na caixa de entrada ou no spam.

> Se o remetente ainda for o domínio padrão do Firebase, isso é o esperado até a configuração de domínio
> personalizado ser feita — ver `docs/autenticacao-email.md`.

### 2. Bloqueio antes da confirmação — pela interface

Com a conta **pendente**, tentar: publicar, comentar, curtir, repostar, seguir, enviar mensagem, votar em enquete,
enviar arquivo e conectar Bluesky. Esperado: bloqueio com aviso claro e caminho para confirmar.

Confirmar também que **continua funcionando**: ler o feed, abrir configurações, exportar dados, abrir pedido no
canal do titular, corrigir o e-mail, pedir reenvio e excluir a conta.

### 3. Bloqueio antes da confirmação — pelo backend (o que importa)

A interface não é a barreira. Provar no servidor, com o token da conta pendente:

1. Obter o `idToken`:
   `POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<NEXT_PUBLIC_FIREBASE_API_KEY>`
   com `{email, password, returnSecureToken: true}`.
2. **Escrita direta no Firestore** — tentar criar um post pela REST:
   `POST https://firestore.googleapis.com/v1/projects/echo-b5aw9/databases/echo-db-124325/documents/posts`
   com `Authorization: Bearer <idToken>`. **Esperado: 403.** Um 200 aqui é falha grave.
3. **Upload direto no Storage** — tentar `POST` no endpoint de upload do bucket com o mesmo token.
   **Esperado: 403.**
4. Conferir no token que `email_verified` é `false` e que **não há** claim `member` (decodificar o payload do JWT;
   não precisa de biblioteca, é base64url).

Tentativas recusadas não deixam nada atrás — é por isso que este teste é seguro.

### 4. Confirmação

Clicar no link do e-mail. Confirmar que cai em `https://exercitodolula.app/pt-BR/auth/action`, mostra sucesso e
oferece continuar. **Conferir que o domínio do Firebase não aparece na barra de endereço.**

### 5. Liberação

Na mesma sessão, repetir o passo 2: as ações sociais devem funcionar agora. Se ainda bloquear, o token não foi
renovado — é o ponto exato que `reload()` + `getIdToken(true)` resolve.

Repetir o passo 3: agora a escrita direta deve ser **aceita** (e o post criado deve ser apagado no fim).

### 6. Confirmação em outro navegador

Criar uma segunda conta descartável (`admlabra+auth2@gmail.com`), abrir o link **no segundo navegador**, e depois
voltar ao primeiro. Esperado: o primeiro ainda mostra pendente até usar **"Já confirmei, verificar de novo"**, que
deve liberar. Em seguida, reabrir o mesmo link: deve dar "link não vale mais" com o botão de verificar.

### 7. Reenvio

Pedir reenvio e confirmar: contagem regressiva no botão, segundo e-mail chega, e o link antigo **deixa de valer**.
Pedir várias vezes em sequência para ver a proteção contra abuso (`auth/too-many-requests` com mensagem clara).

### 8. Recuperação de senha e troca de e-mail

- **Recuperação**: pedir com o endereço da conta e com um endereço **inexistente**. As duas respostas devem ser
  **idênticas** — é a prova de que não há enumeração. Redefinir com senha fraca (recusada) e com senha boa (aceita),
  e entrar com a nova.
- **Troca de e-mail, confirmada**: pedir troca para `admlabra+auth3@gmail.com`. Antes de clicar, conferir que a
  conta **continua** com o endereço antigo e que `private/account` **não** mudou. Clicar e conferir que os dois
  passaram para o novo.
- **Troca de e-mail, abandonada**: pedir troca para `+auth4` e **não** clicar. Sair e entrar de novo. Esperado:
  conta segue com o endereço anterior, sem estado quebrado.

### 9. Exclusão completa e limpeza

1. Excluir a conta pela tela (Configurações › Conta), com reautenticação.
2. Conferir nos logs que `onUserDeletedCleanup` terminou **sem erro de índice**.
3. Conferir que sumiram: `users/<uid>`, `usernames/<@>`, `users/<uid>/private/account`.
4. Conferir que sumiram as `social_*` da conta, se o Bluesky foi conectado no passo 2.
5. **Confirmar que nenhum refresh token continua valendo**: tentar `accounts:lookup` ou um refresh com o token
   antigo. Esperado: recusa.
6. Apagar o nó de presença `status/<uid>` no RTDB (`echo-b5aw9-default-rtdb`), que a sessão deixa.
7. Conferir que nenhum arquivo ficou no Storage sob o caminho da conta.
8. Apagar o post criado no passo 5, se ainda existir.
9. **Apagar a vaga**: `_signup/control/slots/<uid>`, e reconciliar com
   `node scripts/inicializar-limite-cadastro.mjs --producao --aplicar`.
10. Repetir 1–9 para **cada** conta descartável criada (`+auth1` a `+auth4`).
11. Conferir no fim que `used` e `limit` em `_signup/control` voltaram aos valores anotados no pré-requisito 3.

## O que NÃO tocar durante o teste

- **Functions da Mariana** (`agentMarianaPublisher`, `agentMarianaResponder`): existem só em produção e não devem ser
  publicadas, substituídas nem removidas.
- Contas de outras pessoas, e as **2 contas sem perfil/vaga** que a migração de claims deixou intocadas de propósito.
- Qualquer coisa de DNS.

## Resultado

Registrar aqui, ao executar: data, quais passos passaram, o que falhou, e a confirmação de que `used`/`limit`
voltaram ao valor inicial. Enquanto esta seção estiver vazia, **o fluxo não foi validado em produção**.
