# Arquitetura AT Protocol / Atmosphere

> Diferente do ActivityPub, **aqui já existe código em produção**. Este documento começa pelo diagnóstico do que está
> no ar, segue pelos defeitos que encontrei lendo, e só então propõe. Nada foi alterado nesta rodada.

## 1. O que já existe, de fato

A integração é mais séria do que eu esperava, e vale registrar o que está certo antes de apontar o que falta.

| Peça | Onde | Avaliação |
|---|---|---|
| Cliente OAuth | `src/lib/server/blueskyOAuth.ts` | `@atproto/oauth-client-node` com `private_key_jwt`, **ES256** e **tokens DPoP-bound**. É o modo correto e o mais forte disponível |
| Metadados do cliente | `/api/social/bluesky/client-metadata` e `/api/social/bluesky/jwks` | Servidos pelo **nosso domínio**, com `tos_uri` e `policy_uri` apontando para as nossas páginas legais |
| Escopo | `atproto transition:generic` | Amplo, mas é o que o Bluesky oferece hoje |
| Chave privada | `ATPROTO_PRIVATE_JWK` | **Secret Manager**, `availability: RUNTIME` apenas. Nunca no repositório nem no cliente. Aceita JWK em JSON ou base64 |
| Estado de OAuth | `social_oauth_links`, `social_atproto_states` | Chave **hasheada** antes de virar id de documento, e consumida **em transação** — ou seja, **à prova de replay**. Expira em 10 min |
| Sessão | `social_atproto_sessions` | Guardada por `hash(sub)` |
| Idempotência de publicação | `claimPublication` / `finishPublication` | Transação, janela de "pendente" de 2 min, contador de tentativas. **Não duplica post** |
| Composição | `src/lib/server/socialPublish.ts` | HTML convertido para texto puro, truncado a 290 **grafemas** com `Intl.Segmenter` (correto para emoji e escrita composta), `RichText.detectFacets` para menções e links, e `app.bsky.embed.external` apontando para a URL canônica no nosso domínio |
| Exposição ao cliente | — | As coleções `social_*` **não aparecem em `firestore.rules`**, logo são negadas por padrão: só o Admin SDK as toca. Correto |

**Resumo:** identidade por DID, publicação sob OAuth do próprio usuário, chave em cofre, replay fechado e
idempotência real. A base está boa.

## 2. Os defeitos que encontrei

### D1 — Excluir a conta **não** remove a integração (grave)

`onUserDeletedCleanup` (`functions/src/index.ts`) apaga `users/{uid}`, `usernames/{@}`, `private/account`, posts,
comentários e marcadores. Ele **não menciona nenhuma coleção `social_*`**.

Consequência: depois de a pessoa excluir a conta, continuam no banco:

- `social_connections/{uid}_bluesky` — com `did`, e para o X também `accessToken` e `refreshToken`;
- `social_atproto_sessions/{hash(sub)}` — **uma sessão OAuth ainda válida**, com capacidade de renovação;
- `social_publications/*` — histórico de publicações.

Isso é, ao mesmo tempo, retenção indevida (contradiz o prazo de 30 dias da política) e problema de segurança
(credencial viva de conta que não existe mais). **É o item que eu corrigiria primeiro de toda esta página.**

### D2 — `expiresAt` sem TTL, outra vez

`social_oauth_links` e `social_atproto_states` gravam `expiresAt` e **não há política de TTL** para eles em
`firestore.indexes.json`. O `get` do state store apaga sob demanda quando encontra vencido, mas quem nunca é lido de
novo — o caso comum de um fluxo OAuth abandonado — **fica para sempre**.

É o mesmo padrão de `_functionEvents`, corrigido nesta rodada. Correção: declarar TTL em `expiresAt` para as duas.

### D3 — Token de terceiro em texto claro no Firestore

`StoredSocialConnection` guarda `accessToken` e `refreshToken` (usados pelo X; o Bluesky usa a sessão DPoP). Estão
protegidos das regras, mas ficam legíveis a qualquer coisa com credencial de Admin, e entram nos backups. Opções, em
ordem de preferência: mover para o Secret Manager por usuário; ou cifrar em repouso com chave do cofre; ou aceitar o
risco **documentado** na matriz de tratamentos.

### D4 — Não há revogação do lado do provedor

`deleteConnection` apaga o registro local. Não chama revogação no servidor de autorização, então o consentimento
pode continuar listado na conta do Bluesky da pessoa. Desconectar deveria **também** revogar lá.

### D5 — Falta o inventário na matriz

T23 cobre a publicação, mas `social_atproto_sessions`, `social_oauth_links` e `social_publications` não estão
listados em `docs/matriz-de-tratamentos.md` com prazo próprio.

## 3. Identidade: DID e handle

O AT Protocol separa **identificador estável** (DID) de **nome legível** (handle), e é isso que torna a portabilidade
real: trocar de servidor mantém o DID, e os seguidores seguem.

| Conceito | Hoje | Proposta |
|---|---|---|
| DID | Vem do Bluesky (`did:plc:…`) e é guardado em `social_connections` | Continuar. A rede é **cliente**, não emissora de identidade |
| Handle | O do Bluesky | Oferecer, **opcionalmente**, verificar `usuario.exercitodolula.app` como handle via `_atproto` TXT no DNS |
| PDS | O do Bluesky | **Não** virar PDS nesta fase (ver ADR-AT-2) |

A identidade da rede continua sendo o Firebase Auth. O DID é um vínculo, não um substituto — quem nunca conectar o
Bluesky não perde nada.

## 4. Consentimento granular

Hoje é tudo-ou-nada: conectou, pode publicar. Proposta — por conta **e** por tipo de conteúdo:

```
users/{uid}.atproto = {
  connected: boolean,
  did: string,
  publish: {
    posts: false,        // padrão false em todos
    articles: false,
    comments: false,     // provavelmente nunca: comentário fora de contexto
    profile: false,      // nome, bio e avatar espelhados
  },
  autoPublish: false,    // publicar automaticamente OU só com botão
}
```

**Decisão:** padrão `false` em tudo, inclusive depois de conectar. Conectar a conta e autorizar publicação são duas
escolhas diferentes, e hoje estão fundidas.

## 5. O que não sai, por padrão

Mensagens diretas, posts `private` ou "só seguidores", e-mail e data de nascimento, denúncias e dados de moderação,
métricas e registros de acesso, e conteúdo de conta não confirmada. Igual ao ActivityPub, pela mesma razão.

## 6. Sincronização e conflitos

A rede é a **fonte da verdade** do conteúdo local; o registro no repositório AT é uma **projeção**.

| Situação | Decisão |
|---|---|
| Editou aqui | Atualizar lá em melhor esforço |
| Editou lá | **Não** importar de volta. Evita loop e conflito de autoria |
| Apagou aqui | `deleteRecord` em melhor esforço |
| Apagou lá | Não apagar aqui. O post local é nosso |
| Falhou lá | Registrar em `social_publications` e **não** reverter o post local |

Sem merge automático: duas direções de escrita sobre o mesmo objeto é fonte de dado corrompido.

## 7. Exclusão e seus limites, dito sem rodeio

Apagar um post aqui dispara `deleteRecord` lá, em **melhor esforço**. Mas o AT Protocol tem **relays e appviews** que
já indexaram o registro, e o repositório é um log assinado: o que foi publicado circulou. **Não prometer apagamento
em terceiros.** A Política de Privacidade e os Termos já dizem isso.

## 8. Chaves: proteção e rotação

A chave de assinatura (`kid: social-1`) é única e nunca rotacionada hoje. Proposta:

1. O JWKS pode publicar **duas** chaves ao mesmo tempo.
2. Rotação: gerar `social-2`, publicar as duas, passar a assinar com a nova, aposentar a antiga depois de uma janela.
3. `scripts/generate-atproto-jwk.mjs` já gera a chave; falta o procedimento de troca documentado e testado.
4. Nunca registrar a chave em log. O `readPrivateJwk` falha com mensagem genérica — correto, manter.

## 9. Moderação e labels

O ecossistema AT tem **labels** (rótulos de moderação) aplicados por serviços independentes. Posição: **consumir**
label de terceiro como sinal para a nossa triagem, nunca como ação automática; e **não** emitir label para o
ecossistema nesta fase. Conteúdo que violaria as nossas Diretrizes não é publicado para fora — o filtro é na saída.

## 10. Feature flags

| Flag | Hoje | Proposta |
|---|---|---|
| `blueskyConfigured()` | Existe: liga se `ATPROTO_PRIVATE_JWK` estiver definida | Manter |
| `ATPROTO_PUBLISH_ENABLED` | — | Separar "conectar" de "publicar", para poder desligar a publicação sem derrubar a conexão |
| `ATPROTO_HANDLE_VERIFICATION` | — | Handle no nosso domínio, atrás de flag |

## 11. ADRs

**ADR-AT-1 — A rede é cliente do AT Protocol, não provedor de identidade.** *Aceita.* O Firebase Auth continua
sendo a identidade. Benefício: nenhuma dependência do Bluesky para a rede funcionar.

**ADR-AT-2 — Não virar PDS nesta fase.** *Aceita.* Hospedar repositório significa assumir identidade, migração e
disponibilidade de terceiros — projeto inteiro, não recurso. Reavaliar quando a rede crescer.

**ADR-AT-3 — Conectar ≠ autorizar publicação.** *Aceita.* Hoje estão fundidos. Custo: um passo a mais. Benefício: a
pessoa conecta para ter o vínculo sem publicar nada.

**ADR-AT-4 — Sem importação de volta.** *Aceita.* Fluxo de uma direção. Benefício: sem loop nem conflito.

**ADR-AT-5 — Desconectar revoga no provedor.** *Aceita* (D4). Apagar só o registro local deixa consentimento
pendurado na conta da pessoa.

**ADR-AT-6 — Token de terceiro sai do Firestore.** *Proposta,* aguardando decisão entre Secret Manager por usuário,
cifragem em repouso ou risco documentado (D3).

## 12. Roteiro, em ordem de valor

| # | Item | Por quê agora |
|---|---|---|
| 1 | **Limpar `social_*` na exclusão de conta** (D1) | Credencial viva de conta excluída. Corrige retenção e segurança de uma vez |
| 2 | **TTL em `social_oauth_links` e `social_atproto_states`** (D2) | Acúmulo indefinido, e o padrão já é conhecido |
| 3 | **Revogação no provedor ao desconectar** (D4) | Consentimento pendurado |
| 4 | Inventariar as coleções na matriz (D5) | A matriz é a fonte das bases legais |
| 5 | Separar conectar de publicar (ADR-AT-3) | Consentimento granular |
| 6 | Decidir o destino dos tokens (D3) | Depende de escolha de arquitetura |
| 7 | Procedimento de rotação de chave | Antes de a chave ter idade |
| 8 | Handle no nosso domínio | Valor de produto, risco baixo |

Os itens 1 a 3 são **correções**, não recursos, e eu os faria antes de qualquer coisa nova no ActivityPub ou no P2P.
