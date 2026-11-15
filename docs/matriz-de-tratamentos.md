# Matriz de tratamentos de dados pessoais

**Natureza:** inventário interno (LGPD, art. 37 — registro das operações de tratamento). É a **fonte** das bases
legais que a Política de Privacidade afirma: nada vai para a política sem estar aqui.

**Como foi montado:** a partir do código e das regras do Firestore, não de memória. As coleções vêm de
`firestore.rules`; os campos do perfil, de `src/lib/types.ts`; os prazos, de `docs/politica-de-retencao.md`.

**Estado:** as bases legais são **propostas** e aguardam validação de advogado ou DPO. Onde se invoca legítimo
interesse, falta o teste de balanceamento — sem ele, a base não está completa.

**Controlador:** Breno César, pessoa física, que também exerce a função de encarregado
(`CONTROLLER` em `src/config/site.ts`).

## Legenda das bases legais (LGPD, art. 7º)

| Sigla | Base |
|---|---|
| **I** | Consentimento do titular |
| **II** | Cumprimento de obrigação legal ou regulatória |
| **V** | Execução de contrato ou de procedimentos preliminares, a pedido do titular |
| **IX** | Legítimo interesse do controlador *(exige teste de balanceamento)* |

Operador comum a quase tudo: **Google (Firebase)** — Auth, Firestore, Storage, Functions, App Check. O banco fica em
`southamerica-east1` (São Paulo), mas o Google é empresa estrangeira: **há transferência internacional** em todas as
linhas marcadas com ⚠.

## 1. Conta e identidade

| # | Tratamento | Dados | Finalidade | Base | Retenção | Compartilha | Controles | Risco |
|---|---|---|---|---|---|---|---|---|
| T1 | Cadastro e autenticação | e-mail, senha (hash no Firebase Auth), nome, nome de usuário | Criar e manter a conta | V | Enquanto a conta existir; 30 dias nos sistemas ativos após exclusão | Google ⚠ | App Check, reCAPTCHA Enterprise, reautenticação para mudanças sensíveis | Médio |
| T2 | Dados pessoais da conta | e-mail, data de nascimento (opcional), preferências, palavras silenciadas | Operar a conta sem expor dado pessoal no perfil público | V | Igual a T1 | Google ⚠ | Ficam em `users/{uid}/private/account`, **só o dono lê** (corrigido em `2b08d67`); teste e2e prova que terceiro e anônimo não leem | Médio |
| T3 | Perfil público | nome, nome de usuário, bio, local, site, avatar, capa, post fixado | Identificar a pessoa na rede | V | Igual a T1 | Público na internet | `profileVisibility: private` restringe a seguidores | Baixo (o titular escolhe o que publica) |
| T4 | Reserva de nome de usuário | nome de usuário | Garantir unicidade | V | Liberado na exclusão da conta | Público | `usernames/{username}` | Baixo |
| T5 | Controle das 500 primeiras vagas | uid | Limitar a capacidade de entrada | IX | Enquanto o limite valer | — | `_signup/control/slots/{uid}` | Baixo |

## 2. Conteúdo e comunicação

| # | Tratamento | Dados | Finalidade | Base | Retenção | Compartilha | Controles | Risco |
|---|---|---|---|---|---|---|---|---|
| T6 | Conteúdo publicado | posts, artigos, comentários, enquetes, mídia — **podem conter dado pessoal de terceiros** | Prestar o serviço de rede social | V | Enquanto a conta existir, ou até o titular apagar | Público ou seguidores, conforme a visibilidade | Visibilidade por publicação; HTML higienizado (`sanitizeHtml`, hotfix de XSS `ec85041`); regra de `list` com filtro de visibilidade (`e596970`) | **Alto** — é o que a federação replicaria para fora do nosso controle |
| T7 | Mensagens diretas | texto, anexos, participantes | Comunicação privada entre pessoas | V | Enquanto a conversa existir | Google ⚠ | Regra por participante; `dmPreference` (todos / quem eu sigo / ninguém); Storage fechado por caminho (`4653263`) | **Alto** — e **não há criptografia ponta a ponta**: o controlador tem acesso técnico ao conteúdo |
| T8 | Arquivos do usuário | arquivos enviados e metadados | Guardar material da pessoa | V | Enquanto a conta existir | Google ⚠ | `userFiles` + regra de dono | Médio |
| T9 | Rascunhos e feeds personalizados | textos não publicados, composição de feeds | Conveniência de uso | V | Enquanto a conta existir | — | `customFeeds` com regra de dono | Baixo |

## 3. Relações e interações

| # | Tratamento | Dados | Finalidade | Base | Retenção | Compartilha | Controles | Risco |
|---|---|---|---|---|---|---|---|---|
| T10 | Grafo social | seguidores, seguindo, inscritos | Montar o feed e as relações | V | Enquanto a conta existir | Público (ou seguidores) | Contadores só gravados por Functions (`f64dd34`) | Médio — revela vínculos e afinidade política |
| T11 | Interações públicas | curtidas, reposts, citações, votos em enquete | Operar as funções da rede | V | Enquanto existirem | Público | Perfil privado restringe a visualização | Médio — **curtida revela posição política** |
| T12 | Moderação pessoal | bloqueios, silenciados, palavras silenciadas | Dar controle sobre o que a pessoa vê | V | Enquanto a conta existir | — | Subcoleções de dono | Baixo |
| T13 | Recomendações de perfis | **dado inferido** do grafo e das interações | Sugerir quem seguir | IX | Calculado na hora, não persistido | — | `src/lib/recommendations/` | Médio — é perfilamento, ainda que leve |

## 4. Métricas, registros técnicos e segurança

| # | Tratamento | Dados | Finalidade | Base | Retenção | Compartilha | Controles | Risco |
|---|---|---|---|---|---|---|---|---|
| T14 | Métricas por publicação | **quem** visualizou e **quem** clicou no perfil (`views/{uid}`, `profileClicks/{uid}`) | Dar ao autor números sobre o alcance | IX | **90 dias** para o marcador individual; o agregado em `analytics/summary` fica enquanto o post existir | Google ⚠ | `expireAt` + política de TTL, com a janela imposta pela regra (`isExpiringMarker`); o autor vê só o agregado; só Functions somam; `npm run e2e:marcadores` amarra cliente, regra e TTL | Médio *(era Alto)* — o rastro individual deixou de ser permanente, por decisão de 2026-11-11 |
| T15 | Eventos de acesso | caminho, logado/visitante, região aproximada, hora. **IP descartado** | Contagens do painel de administração | IX | 180 dias *(decidido, **não implementado**)* | Google ⚠ | Gravação só por Admin SDK; sem IP, navegador, sessão ou vínculo com conta (`6a35a72`) | Baixo — minimização exemplar |
| T16 | Presença | online, visto por último | Mostrar quem está disponível | IX | Transitória (RTDB) | Outros usuários | Encerrada ao sair (`bf31fd9`) | Médio — expõe rotina |
| T17 | Notificações e push | notificações, tokens FCM | Avisar sobre interações | V + I (permissão do navegador) | Token até revogar ou expirar | Google ⚠ (FCM) | Preferências por tipo; `fcmTokens` de dono | Médio |
| T18 | Denúncias | quem denuncia, quem é denunciado, conteúdo apontado | Moderar e cumprir obrigação legal | IX + II | 5 anos para incidente confirmado | Autoridades, **quando houver requisição válida ou dever legal** | `reports` com regra restrita | **Alto** — sigilo do denunciante é essencial |
| T19 | Antiabuso | sinais do App Check e reCAPTCHA Enterprise | Impedir automação e fraude | IX | Prazo do fornecedor | Google ⚠ | Chave pública no cliente, verificação no servidor | Médio |
| T20 | Registros do servidor | dados de conexão, inclusive IP | Operar e conter abuso | IX | Prazo padrão do Cloud Logging *(a ajustar para 180 dias)* | Google ⚠ | Acesso restrito | Médio |

## 5. Opcionais — só com consentimento

| # | Tratamento | Dados | Finalidade | Base | Retenção | Compartilha | Controles | Risco |
|---|---|---|---|---|---|---|---|---|
| T21 | Medição de uso | identificadores e eventos do Google Analytics | Entender uso e falhas | **I** | Prazo do GA *(a definir no menor possível)* | Google ⚠ | **Desligado por padrão**; o script nem é baixado sem aceite; Consent Mode v2 nega na partida | Médio — mitigado pelo gate |
| T22 | Registro do consentimento | versão do aviso, data, categorias aceitas | Demonstrar o consentimento (art. 8º, § 1º) | II | Enquanto a decisão valer | — | `localStorage`, chave `soberan_consent` | Baixo — mas **só no navegador**, logo não é auditável pelo controlador |
| T23 | Publicação no Bluesky / AT Protocol | conteúdo publicado, identidade da conta conectada | Publicar fora da plataforma a pedido da pessoa | **I** | Fora do nosso controle após o envio | Bluesky / rede AT ⚠ | A pessoa conecta a conta; chave em Secret Manager, nunca no cliente | **Alto** — **irreversível**: apagar aqui não apaga lá |
| T24 | Publicidade | cookies do AdSense | Exibir anúncios | **I** | Prazo do fornecedor | Google ⚠ | **Desligada por produto** (`adsEnabled=false`) **e** exige consentimento | Médio — hoje inativo |

## Dados inferidos

A LGPD alcança o dado inferido tanto quanto o informado. Nesta rede eles são: **T13** (recomendações de perfis, do
grafo e das interações), **T15** (região aproximada, deduzida do IP e depois descartado) e os agregados de **T14**.
Nenhum deles é usado para publicidade, e nenhum alimenta treinamento de IA — a rede **não usa IA**.

## Os quatro riscos que eu destacaria para o advogado

1. ~~**T14** — guardar *quem* viu cada post sem prazo de descarte.~~ **Resolvido em 2026-11-11:** fica a contagem
   agregada e o marcador individual expira em 90 dias; a política de privacidade passou a informar isso ao titular.
   Falta publicar as políticas de TTL em produção (pede aprovação).
2. **T7** — mensagens diretas sem criptografia ponta a ponta. É legítimo, mas precisa estar dito na política: o
   controlador tem acesso técnico.
3. **T23** — publicação federada é irreversível, e a política precisa dizer isso sem rodeio.
4. **T11** — numa rede de natureza política, curtida e quem se segue podem revelar convicção. Convém avaliar se isso
   atrai o regime de **dado sensível** (art. 5º, II), o que mudaria a base legal exigida.

## Não verificado (não afirmar na política antes de conferir)

- Conteúdo exato de `users/{uid}/private/{docId}` além de e-mail, nascimento, preferências e palavras silenciadas.
- Existência, periodicidade e janela de **backups** do Firestore.
- Prazo real de retenção do Cloud Logging e do Google Analytics.
- O que resta no Firebase Authentication após `deleteUser`, e por quanto tempo.
- Se há política de TTL criada à mão no console, além das três agora declaradas em `firestore.indexes.json`
  (`views`, `profileClicks` e `_functionEvents`, todas em `expireAt`).

## Observação sobre a documentação existente

`docs/divida-tecnica.md` descreve os achados S1–S5 como abertos, mas `docs/matriz-funcionalidades.md` registra
**R1–R9 corrigidos em 2026-10-23/24** — inclusive o vazamento de posts restritos, os anexos de mensagem legíveis por
caminho e os contadores forjáveis. A dívida técnica está desatualizada; vale alinhar os dois antes de usar qualquer um
deles como evidência de conformidade.
