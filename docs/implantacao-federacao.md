# Implantação da federação (ActivityPub)

Complementa `docs/arquitetura-activitypub.md`. A publicação é **em duas etapas**: a etapa A coloca tudo no ar
**desligado**; a etapa B liga para as pessoas. Sem o documento `config/federation`, a plataforma vale **desligada**.

## Etapa A: tudo no ar, nada ligado (publicada em 2026-11-12)

| Peça | O que foi publicado | Como voltar atrás |
|---|---|---|
| Regras do Firestore (`echo-db-124325`) | `firestore.rules` com `federationOptIn`/`hasValidFederation` e a trava de apagar `private/federation`. Conjunto novo `e1d9bfc8-2a7d-4c44-aec1-35aa50a71875`. O diff contra produção mostrava **só** estas mudanças. | Republicar o conjunto anterior `93e66223-38ce-47af-8cdd-14b5209b9215`, que é idêntico ao `firestore.rules` do commit `20fb04a`. |
| Índice composto | `ap_deliveries (uid ASC, createdAtMs DESC)`, estado `READY`, criado com `gcloud firestore indexes composite create`. | `gcloud firestore indexes composite delete`. |
| TTL | `expireAt` em `ap_seen`, `ap_remote_actors`, `ap_audit`, `ap_flags`, `ap_deliveries`, `ap_outbound`, `ap_domain_health`, `ap_stats`, todos `ACTIVE`, com `gcloud firestore fields ttls update`. | `--disable-ttl` na mesma chamada. |
| Functions | `apPostFederation` (criada) e `onUserDeletedCleanup` (atualizada com o gancho de federação). Publicação **nominal**: 39 → 40 Functions, `agentMarianaPublisher` e `agentMarianaResponder` intactas. | `firebase functions:delete apPostFederation`; reimplantar `onUserDeletedCleanup` a partir do commit `10ae409`. |
| Site (App Hosting `studio`) | Build **`build-2026-11-12-002`**, gerado do commit `2812c98` (rollout `SUCCEEDED`): rotas `/.well-known/*`, `/ap/*`, `/nodeinfo/*`, `/api/ap/*` e a interface do Fediverso. | Novo rollout apontando para o build anterior, `build-2026-11-12-001`. |

**Por que índices e TTL por `gcloud` e não por `firebase deploy --only firestore:indexes`:** o arquivo de índices do
repositório também contém índices que **ainda não existem em produção** e que aguardam autorização própria. Publicar o
arquivo inteiro os criaria como efeito colateral. A federação só precisava do composto acima e dos TTLs.

**Por que o pipeline de vídeo ficou de fora nesta etapa:** ele depende de infraestrutura
que ainda não existe em produção (Cloud Run Job, contas de serviço, lifecycle do bucket). O site desta etapa sai do
branch da federação, que não o contém.

### O que a etapa A garante (e como foi conferido)

- Com a plataforma desligada, descoberta, actor, `Note` e caixas de entrada respondem **404**; a API de gestão exige
  token (401) e o painel e o worker respondem 404 a quem não deve vê-los.
- O compositor **não mostra** o seletor de alcance a ninguém (ele só aparece com plataforma ligada **e** conta ativada).
- Nenhuma pessoa consegue ativar: a ativação recusa com a plataforma desligada.
- Sem o segredo `AP_MASTER_KEY`, qualquer rota que assine responde **503** (erro de configuração, nunca um padrão).
- **Auditoria feita após o rollout:** 17 verificações HTTP em produção (descoberta, actor, outbox, coleções, `Note`,
  caixas de entrada, worker, API da conta, painel com e sem token, tela do Fediverso, home e política de privacidade),
  todas como projetado; nenhum erro nos logs do site e das duas Functions; as Functions da Mariana não foram tocadas.
- A Function `apPostFederation` roda a cada escrita em `posts`, mas sai logo (plataforma desligada ou conta sem
  federação) e só **enfileira**; não fala com servidor remoto.

## Etapa B: ligar para as pessoas

Pré-requisitos, **todos** necessários antes de ligar:

1. **Textos legais** (Política de Privacidade, Termos, Cookies, política de retenção, matriz de tratamentos, checklist
   LGPD) atualizados **só** para o que está implementado: transferência internacional por federação, replicação em
   servidores de terceiros, retenção (fila e entregas ≤ 30 dias depois do estado final, chaves destruídas até 3 dias
   depois de apagar a conta), exclusão **em melhor esforço** fora desta instância, responsabilidade dos servidores
   externos. Nada de CPF, documento, selfie ou treino de IA.
2. **Teste de interoperabilidade com um servidor real de terceiros** (Mastodon/Pleroma): seguir, receber o `Accept`,
   publicar, editar, apagar. Exige uma conta externa, que o responsável precisa fornecer.
3. **Segredos e infraestrutura:** `AP_MASTER_KEY`, `AP_SCHEDULER_SA`, Cloud Scheduler (abaixo).
4. **Parecer** do responsável sobre a transferência internacional por federação.

### Segredo, agendador e chave da plataforma

```
# 1. Chaveiro (32 bytes aleatórios; o formato é  kid:base64 ; nunca registrar o valor)
#    gcloud secrets create AP_MASTER_KEY --replication-policy=automatic
#    conceder roles/secretmanager.secretAccessor à conta de serviço do backend do App Hosting
# 2. apphosting.yaml: variável AP_MASTER_KEY (secret: AP_MASTER_KEY, RUNTIME) e AP_SCHEDULER_SA (valor: o e-mail da conta)
# 3. Conta de serviço do agendador e job do Cloud Scheduler:
#    POST https://exercitodolula.app/api/ap/worker, a cada minuto,
#    autenticação OIDC, audiência https://exercitodolula.app/api/ap/worker
# 4. Redeploy do site (o segredo só entra com um novo rollout)
# 5. Ligar em modo allowlist:  POST /api/ap/admin  {"action":"platform","enabled":true,"mode":"allowlist"}
#    e liberar poucos servidores:  {"action":"instance","domain":"...","rule":"allow"}
```

Abertura gradual: começar em `allowlist` com poucos servidores e poucas contas, acompanhar o painel (`GET /api/ap/admin`:
fila, mortas, contadores do dia) e só então passar a `open`.

## Estado em 2026-11-14

**A plataforma está ligada em produção:** `config/federation.enabled = true`, alterado em 2026-11-12 às 21:34 UTC (depois
da etapa A; esta nota não registrava a etapa B). Hoje o @Breno tem 92 seguidores do Fediverso e segue 1.421 contas de lá.

**Publicado em 2026-11-14** (correções de `docs/auditoria-core-2026-11-14.md`): a Function `apPostFederation` (16:33 UTC, só
ela, nominal; a Mariana ficou intacta), o site `build-2026-11-14-024` (16:34 UTC) e um build seguinte com o WebFinger do ator
da instância. Conferido em produção: `/ap/actor` (200, `Application`, chave pública, 302 para quem abre no navegador), o
WebFinger e o ator de `breno` resolvem para o UID local, `/api/ap/remote-profile` sem login devolve 401 `login-obrigatorio`,
e os logs do site e da Function estão sem erro nem 5xx. Nenhuma regra e nenhum índice mudaram.

**Como publicar o site sem derrubar o trabalho dos outros.** `firebase deploy --only apphosting:studio` zipa a **árvore de
trabalho**, e a produção costuma ser o último commit de `feat/federacao` **mais arquivos ainda não commitados** de quem
trabalha em paralelo (em 2026-11-14: 14 arquivos de Matrix, Nostr, `feed.xml`/`feed.json`, `syndication` e do banner do
Fediverso). Publicar de uma árvore limpa os tiraria do ar. Antes de publicar:

1. liste os rollouts (`firebaseapphosting.googleapis.com/v1/projects/echo-b5aw9/locations/us-central1/backends/studio/rollouts`)
   e confira que não há outro em andamento (um segundo `deploy` simultâneo recebe 409 "unable to queue the operation");
2. baixe a fonte do build ao vivo (`builds/<id>`, campo `source.archive.userStorageUri`, no bucket
   `firebaseapphosting-sources-<número do projeto>-us-central1`) e compare com a árvore que vai subir
   (`diff -r --strip-trailing-cr`: o Windows grava CRLF e quase tudo "difere" sem isso);
3. num worktree limpo do commit, sobreponha os arquivos não commitados que **estão no ar** e confirme que a **única** diferença
   para o ar é o que você quer publicar; só então `firebase deploy --only apphosting:studio --project echo-b5aw9`.

**Reconciliar os dados já gravados** (separado do deploy): `node scripts/reconciliar-federacao.mjs` (simulação, não escreve
nada) e, com autorização, `--aplicar`. Ordem: `--so=fantasmas,espelhos --uid=<UID do Breno> --aplicar` e depois
`--so=duplicatas --aplicar`. Apaga o fantasma `ap_2848…` e as cópias dele, cria os espelhos de seguidores que faltam e os
registros `ap_following`, e remove duplicatas **com evidência** e sem interação local. Pode ser repetido; leva em conta a
recontagem das Functions (espera 25 s antes de apagar posts, curtidas e comentários do fantasma). O tema `atribuicao` só lê.
Estado em 2026-11-14, 16:55 UTC: fantasma, espelhos e `ap_following` **já aplicados** (outra execução, com a primeira versão do
roteiro; o classificador de permissões do modo automático negou a minha); restam 262 duplicatas com evidência (220 redundantes
+ 42 de autor errado), 43 para decisão manual e ~1.760 posts gravados em nome de quem impulsionou, que pedem decisão.

O que mudou para as pessoas: o Fediverso curtir ou repostar um **comentário** conta no comentário (não no
post); `Accept`/`Reject` do servidor remoto fecham o follow; edição e remoção de post e de conta remota chegam (remoção vira
um túmulo, fora dos feeds); e a busca de perfil remoto exige login (a rota gravava no banco sem identificar quem pedia).

## Operação

- **Botão de emergência:** `POST /api/ap/admin {"action":"platform","killSwitch":true}`. Vale **na hora** (o cache
  da configuração é invalidado na mesma instância e expira em 10 s nas demais); a fila fica intacta e retoma ao desligar.
- **Observabilidade:** `GET /api/ap/admin` (configuração, regras, fila, entregas mortas, contadores de hoje e de ontem),
  coleção `ap_audit` (decisões, sem corpo de terceiros), logs com o prefixo `[federacao]`.
- **Entrega travada:** a pessoa vê em Configurações > Fediverso > Envios e pode mandar tentar de novo.

## Notas de execução

- `firebase deploy --only functions:...` estoura "Timeout after 10000" quando a máquina está carregada. Usar
  `FUNCTIONS_DISCOVERY_TIMEOUT=90`. Não muda o que é publicado.
- **Nunca** `firebase deploy --only functions` sem filtro: as Functions da Mariana existem só em produção e seriam
  propostas para remoção. Sempre nominal, e ler a saída antes de confirmar.
