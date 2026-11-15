# Autenticacao de conta e e-mail

> Preparado em 2026-11-11. Nada deste documento autoriza deploy, alteracao de DNS ou mudanca no console do Firebase.

## O que o sistema comprova

- **Conta autenticada:** a pessoa apresentou uma credencial aceita pelo Firebase Auth.
- **E-mail confirmado:** a pessoa abriu um link enviado ao endereco. Isso comprova posse do e-mail naquele momento.
- **Identidade civil:** **nao e verificada**. Nao coletamos CPF, documento ou selfie para o cadastro comum.
- **Idade:** a data e uma declaracao da pessoa e o sistema aceita apenas 18 anos ou mais; nao e KYC.

## Barreiras implementadas

Publicar, editar conteudo, comentar, curtir, repostar, seguir, enviar mensagem, denunciar, votar, enviar arquivo e
conectar/publicar no Bluesky ou X exigem duas claims no ID token:

1. `email_verified: true`, mantida pelo Firebase;
2. `member: true`, concedida pela Function apenas quando existem o perfil e a vaga historica do cadastro.

Leitura, preferencias privadas, exportacao, canal do titular, desfazer interacoes, apagar arquivos e excluir a conta
continuam disponiveis para uma conta pendente. A claim `member` e necessaria porque as regras do Cloud Storage nao
conseguem consultar o banco Firestore nomeado `echo-db-124325`.

## Configuracao manual no Firebase Authentication

1. Em **Authentication > Settings > Authorized domains**, manter `exercitodolula.app` e os dominios realmente usados.
2. Em **Templates**, configurar verificacao, redefinicao de senha, reversao e troca de e-mail.
3. Em cada template, usar a URL de acao personalizada `https://exercitodolula.app/pt-BR/auth/action`. O aplicativo
   acrescenta o destino interno em lista fechada e rejeita redirecionamento externo.
4. Configurar o dominio personalizado conforme a tela do Firebase e copiar **exatamente** os registros DNS mostrados.
   Se ja houver SPF, mesclar o emissor no unico registro SPF; nunca publicar dois registros SPF.
5. Remetente recomendado: nome **Exe. Lula** e `noreply@exercitodolula.app`. O `Reply-To` deve ser um canal monitorado;
   nao usar `noreply` como contato de suporte ou do titular.
6. Definir a politica do Authentication com minimo de 8 caracteres. O app e a Function tambem recusam senha so
   numerica, obvia, repetida ou derivada do e-mail.
7. Enviar testes reais para Gmail, Outlook e outro provedor, conferindo remetente, SPF/DKIM/DMARC, idioma, spam e todos
   os quatro tipos de link.

`ActionCodeSettings` define o retorno ao aplicativo, mas sozinho nao altera remetente nem dominio exibido no e-mail.
Esses dois pontos dependem do console e do DNS.

## AVISO: o codigo e a producao divergem nas Functions

O codigo tem **35 Functions** e **nenhuma referencia a Mariana**: `agentMarianaPublisher` saiu no commit `bf21e23`
(remocao da IA). Mas em producao `agentMarianaPublisher` e `agentMarianaResponder` **continuam ativas**, porque o
deploy da rodada de autenticacao foi seletivo, nomeando apenas as 8 Functions alteradas.

**Consequencia pratica:** um `firebase deploy --only functions` sem filtro compara o codigo com a producao e propoe
**apagar as duas Functions da Mariana**. Aceitar isso derrubaria um recurso que o responsavel quer manter.

Regra desta rodada, dada pelo responsavel: **nao remover, nao substituir e nao publicar Functions da Mariana.**

Como publicar com seguranca:

1. Listar os nomes afetados pela mudanca em questao.
2. Montar o comando nomeando cada um:
   `firebase deploy --only functions:nomeA,functions:nomeB`
3. Ler a saida antes de confirmar. Se ela mencionar remocao de qualquer Function, **abortar**.
4. Conferir depois que a contagem de Functions em producao nao diminuiu.

Enquanto a Mariana existir so em producao, essa divergencia e permanente e precisa ser respeitada em todo deploy. Se
um dia a decisao for remove-la, isso pede roteiro proprio e autorizacao propria — nao pode acontecer como efeito
colateral de outro deploy.

## Implantacao segura (quando houver autorizacao explicita)

1. Fazer backup/diff das regras e registrar as configuracoes atuais do Auth.
2. Publicar as Functions **seletivamente**, nomeando uma a uma com `--only functions:nome1,functions:nome2`.
   Nunca publicar o conjunto inteiro: veja o aviso sobre a Mariana abaixo.
3. Rodar `npm run migrar:claims -- --producao` em dry-run; depois, se o resultado estiver correto e houver autorizacao,
   repetir com `--aplicar` e confirmar com `--conferir`.
4. Ajustar templates/dominio/DNS no Firebase e validar os e-mails.
5. Publicar regras do Firestore, regras do Storage, indices e TTL conforme `docs/implantacao-privacidade.md`.
6. Publicar o site imediatamente depois das regras (a mudanca de `expireAt` dos marcadores exige coordenacao).
7. Testar conta nova por senha, Google, confirmacao em outro aparelho, reenvio, link usado/expirado, reset, troca de
   e-mail, TOTP, upload, publicacao, exportacao e exclusao.

## Reversao

- Site: voltar a versao anterior no App Hosting.
- Regras: republicar os backups exatos.
- Claims `member`: nao remover em massa numa reversao; sao inertes sem regras que as usem e podem coexistir com o site
  antigo. Remocao exige roteiro separado para nao apagar claims administrativas.
- DNS/templates: restaurar os valores registrados antes da mudanca.

## Testes locais

- `npm run e2e:auth-links`: destinos internos, links hostis e consistencia do handler.
- `npm run e2e:auth-backend`: emuladores de Auth, Firestore e Storage; prova que UI nao e a barreira.
- `npm --prefix functions run build`: compilacao das Functions.
- `npm run build`: build do aplicativo.

Os emuladores requerem Node 22 e JDK 21+ conforme `docs/emuladores.md`.

## Estado real do DNS hoje (consultado em 2026-11-11, leitura publica)

Levantado com consulta direta ao DNS publico, nao de memoria:

| Consulta | Resultado |
|---|---|
| `TXT exercitodolula.app` | `google-site-verification=gDPnI9boJShAG0CEshk57KwGIiRk0CNlurvaG6kW610` e `fah-claim=002-02-395aabaa-...` |
| **SPF** (`v=spf1` no apex) | **NAO EXISTE** |
| `MX exercitodolula.app` | **NAO EXISTE** (a resposta volta o SOA) |
| `TXT _dmarc.exercitodolula.app` | `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;` |
| `A exercitodolula.app` / `www` / `media` | todos `35.219.200.4` (mesmo backend do App Hosting) |

### ACHADO GRAVE: o DMARC atual derruba e-mail institucional

O dominio **ja tem DMARC com `p=quarantine`** (registro do GoDaddy, `rua` apontando para `onsecureserver.net`), e
**nao tem SPF nem DKIM proprios**.

Com `From: noreply@exercitodolula.app`, o DMARC confere alinhamento contra `exercitodolula.app`. Sem SPF que autorize
o emissor e sem DKIM assinando pelo nosso dominio, **SPF e DKIM falham os dois**, e `p=quarantine` manda o e-mail
para quarentena ou spam.

Consequencia pratica: **configurar o dominio personalizado no Firebase nao e acabamento, e pre-requisito.** Trocar o
remetente para `@exercitodolula.app` *antes* de publicar SPF e DKIM deixaria a confirmacao de conta pior do que esta
hoje — hoje ela sai pelo dominio do Firebase, que tem SPF e DKIM proprios e passa.

**Ordem obrigatoria:** publicar SPF e DKIM primeiro, confirmar que passam, e so entao trocar o remetente.

### Remetente: apex ou subdominio

| | `noreply@exercitodolula.app` (apex) | `noreply@mail.exercitodolula.app` (subdominio) |
|---|---|---|
| SPF | Criar no apex. **Nao ha conflito hoje**, porque nao existe SPF | Criar no subdominio; apex fica livre |
| Reputacao | Misturada com qualquer envio futuro do dominio | Isolada |
| DMARC | Alinha direto | **Tambem alinha**, porque o registro atual usa `aspf=r` e `adkim=r` (relaxado) |
| Risco futuro | Se entrar provedor de caixa postal, o SPF tera de ser **mesclado** num unico registro | Nenhum: o apex continua sem SPF |
| Complexidade | Menor | Um nivel a mais de DNS |

**Recomendacao:** comecar pelo **apex**, porque nao existe SPF nem MX para conflitar e o DMARC relaxado aceita os
dois. Se um dia entrar caixa postal no dominio, reavaliar — a partir dali o subdominio passa a valer mais, para o
envio transacional nao depender do mesmo SPF da caixa.

**`Reply-To`: ainda NAO pode ser `suporte@exercitodolula.app`.** Nao existe MX no dominio, logo resposta a esse
endereco **nao chega a ninguem**. Usar `admlabra@gmail.com` como `Reply-To` enquanto nao houver MX, ou deixar sem
`Reply-To`. Anunciar um endereco que nao recebe e pior que nao anunciar.

## Valores que PRECISAM ser obtidos (nao invente nenhum)

Estes valores so existem depois de iniciar a configuracao no console; cada um e gerado para este projeto e nao pode
ser deduzido:

| # | Onde obter | O que copiar |
|---|---|---|
| 1 | Firebase Console > Authentication > Templates > icone de edicao > **Customize domain** | A lista de registros DNS que a tela mostra, **exatamente** como aparece: nome, tipo e valor de cada um |
| 2 | Mesma tela | O valor de verificacao de propriedade do dominio (TXT) |
| 3 | Mesma tela | O(s) registro(s) de **DKIM** (o seletor e a chave, ou o CNAME, conforme a tela indicar) |
| 4 | Mesma tela | O trecho de **SPF** que o Firebase pedir para incluir |
| 5 | Firebase Console > Authentication > Settings > **Authorized domains** | Conferir que `exercitodolula.app` consta |

Depois de obtidos, o SPF do apex passa a ser **um unico registro** no formato
`v=spf1 <inclusao que o Firebase indicar> -all`. **Nunca publicar dois registros SPF**: um dominio com dois SPF falha
a validacao em vez de somar.

## Acoes manuais necessarias (ordem)

1. **No Firebase**: iniciar Customize domain e copiar os registros gerados.
2. **No GoDaddy** (zona atual, servidores `ns75`/`ns76.domaincontrol.com`): publicar verificacao, DKIM e **criar** o
   SPF. Preservar os TXT existentes (`google-site-verification` e `fah-claim`) — eles nao sao de e-mail e remove-los
   quebra a verificacao do Search Console e a reivindicacao do App Hosting.
3. **Aguardar propagacao** e confirmar no console do Firebase que o dominio ficou verificado.
4. **Conferir por consulta DNS** que SPF e DKIM respondem, e enviar teste real para Gmail, Outlook e um terceiro
   provedor, checando o cabecalho: `spf=pass`, `dkim=pass` e `dmarc=pass`.
5. **So entao** trocar remetente e nome exibido nos quatro modelos.
6. **Rever o DMARC**: o `rua` atual entrega os relatorios a um endereco do GoDaddy. Trocar para um endereco que voce
   leia, se quiser acompanhar. Manter `p=quarantine` **somente depois** de SPF e DKIM passando.

Nada disso deve ser feito sem autorizacao explicita, e nenhuma alteracao de DNS foi feita nesta rodada.

## Auditoria do fluxo publicado (2026-11-11)

### Enumeracao de contas

**Fechado onde da para fechar no codigo:**

- **Login** (`authService.ts`): `auth/invalid-credential`, `auth/user-not-found` e `auth/wrong-password` caem na
  **mesma** mensagem. Nao da para descobrir se o e-mail tem conta errando a senha.
- **Recuperacao de senha** (`accountSecurity.ts`): `auth/user-not-found` e tratado como **sucesso silencioso**. A
  resposta e identica para endereco com e sem conta.

**ACHADO: sobra enumeracao no cadastro, e ela NAO se resolve no nosso codigo.**

`createUserWithEmailAndPassword` devolve `auth/email-already-in-use` **direto ao navegador**, antes de qualquer
Function nossa. Generalizar a mensagem na nossa camada nao esconde nada: quem abrir o console do navegador ve o
codigo original. Logo um robo consegue testar uma lista de enderecos e descobrir quais tem conta.

Isso **so** se resolve com uma configuracao de console: **Email enumeration protection**, em
*Authentication > Settings* (Identity Platform). Com ela ligada, o Auth passa a devolver erro generico e o
vazamento acaba na origem.

**Custo de ligar, que precisa ser decidido:** a tela de cadastro deixa de poder dizer "este e-mail ja tem conta". A
saida honesta passa a ser uma mensagem neutra do tipo "nao foi possivel criar a conta com estes dados; se o endereco
ja for seu, use *Esqueci minha senha*". O codigo precisa tratar os dois mundos sem quebrar, porque o comportamento
muda no servidor sem mudar o cliente.

**Recomendacao:** ligar. O ganho de privacidade e maior que o custo de clareza, e a rede e politica — saber quem tem
conta aqui e informacao sensivel.

Observacao: "nome de usuario ja esta em uso", na tela de cadastro, **nao** e enumeracao de conta. O `@` e publico por
natureza (qualquer pessoa resolve um perfil pelo `@` sem login), e checar disponibilidade e necessario para o
cadastro funcionar.

### Expiracao, reutilizacao e tratamento dos codigos

| Situacao | Comportamento hoje | Avaliacao |
|---|---|---|
| Codigo valido | `applyActionCode`, depois `reload()` + `getIdToken(true)` | Correto: sem renovar o token as regras continuariam vendo `email_verified: false` |
| Codigo expirado | `auth/expired-action-code` > mensagem propria, com caminho para pedir outro | Correto |
| Codigo reutilizado | `auth/invalid-action-code` > tratado junto com "invalido", e a tela oferece **"Ja confirmei, verificar de novo"** | Correto, e e o caso comum de quem abre o e-mail no celular e volta ao computador |
| Confirmado em outro aparelho | O botao acima relê a conta e, se ja estiver confirmada, libera | Correto |
| Codigo ausente ou modo invalido | Cai em "invalido" sem tentar aplicar | Correto |
| Destino na URL | Passa por lista fechada; qualquer coisa fora dela cai no login | Correto, com 20 tentativas hostis cobertas em `npm run e2e:auth-links` |

**O prazo de validade do link e definido pelo Firebase, nao por nos**, e nao e configuravel por template. Nao
prometer prazo especifico nos textos: dizer "por tempo limitado".

## Modelos de e-mail (rascunho para colar no console)

O console aceita um texto por idioma. Os quatro modelos, com linguagem clara e **sem** afirmar verificacao de
identidade:

### Confirmacao de e-mail

- **pt-BR** — Assunto: `Confirme seu e-mail no Exe. Lula`
  Corpo: `Ola, %DISPLAY_NAME%. Para liberar sua conta no Exe. Lula, confirme este endereco: %LINK% . O link vale por
  tempo limitado e serve uma vez. Se nao foi voce que pediu, ignore este e-mail. Confirmar o e-mail mostra que voce
  tem acesso a esta caixa de entrada; nao verificamos nome, documento nem idade.`
- **en** — Subject: `Confirm your email on Exe. Lula`
  Body: `Hi %DISPLAY_NAME%. To unlock your Exe. Lula account, confirm this address: %LINK% . The link is valid for a
  limited time and works once. If you did not request it, ignore this email. Confirming your email shows you can
  access this inbox; we do not verify your name, documents or age.`

### Redefinicao de senha

- **pt-BR** — Assunto: `Redefinir sua senha no Exe. Lula`
  Corpo: `Recebemos um pedido para redefinir a senha de %EMAIL%. Para escolher uma nova: %LINK% . O link vale por
  tempo limitado e serve uma vez. Se nao foi voce, ignore este e-mail — sua senha atual continua valendo.`
- **en** — Subject: `Reset your Exe. Lula password`
  Body: `We received a request to reset the password for %EMAIL%. To choose a new one: %LINK% . The link is valid for
  a limited time and works once. If this was not you, ignore this email — your current password still works.`

### Troca de endereco (confirmacao do novo)

- **pt-BR** — Assunto: `Confirme seu novo e-mail no Exe. Lula`
  Corpo: `Para passar a usar este endereco na sua conta do Exe. Lula, confirme aqui: %LINK% . Enquanto voce nao
  confirmar, sua conta continua com o endereco anterior.`
- **en** — Subject: `Confirm your new Exe. Lula email`
  Body: `To start using this address on your Exe. Lula account, confirm here: %LINK% . Until you confirm, your
  account keeps the previous address.`

### Reversao de troca de endereco

- **pt-BR** — Assunto: `O e-mail da sua conta foi alterado`
  Corpo: `O endereco da sua conta do Exe. Lula passou a ser %NEW_EMAIL%. Se nao foi voce, desfaca agora: %LINK% e
  troque sua senha em seguida.`
- **en** — Subject: `Your account email was changed`
  Body: `Your Exe. Lula account address is now %NEW_EMAIL%. If this was not you, undo it now: %LINK% and change your
  password right after.`

As variaveis `%DISPLAY_NAME%`, `%EMAIL%`, `%NEW_EMAIL%` e `%LINK%` sao as do proprio Firebase; conferir na tela os
nomes exatos aceitos em cada modelo antes de salvar.
