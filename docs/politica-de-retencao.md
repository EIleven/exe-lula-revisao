# Política de retenção e descarte

**Natureza:** política **interna**. Os prazos abaixo foram decididos pelo responsável pela plataforma em 2026-11-11 e
precisam constar também na Política de Privacidade, no inventário de tratamentos e nas rotinas automáticas de
descarte.

**Estado da implementação:** os prazos estão **decididos e documentados**; o descarte automático **ainda não existe**
na maior parte dos casos (ver [Controles técnicos](#controles-técnicos-o-que-existe-e-o-que-falta)). Documentar sem
implementar não cumpre a LGPD — esta seção é a lista de serviço, não um atestado.

> A LGPD não fixa um prazo geral único. Cada prazo abaixo se apoia em necessidade e minimização (art. 6º, III),
> em obrigação legal específica, ou em legítimo interesse sujeito a teste de balanceamento.

## Prazos

### Registros de acesso e eventos de API — 180 dias

Guardam apenas: data/hora, IP, identificador da conta, endpoint, status, identificador da requisição e informações
mínimas de segurança.

**Nunca registrar:** senhas, tokens, cookies de sessão, conteúdo de mensagens, corpos completos de requisições ou
respostas.

- Base legal proposta: cumprimento de obrigação legal, quando aplicável, **e** legítimo interesse para segurança e
  prevenção de fraude — este último exige teste de balanceamento documentado (pendente).
- Referência indicada: art. 15 do Marco Civil da Internet (seis meses para registros de acesso a aplicações, nas
  hipóteses aplicáveis).

### Logs operacionais, auditoria e segurança

| Tipo | Prazo |
|---|---|
| Logs operacionais comuns | 180 dias |
| Registros de **incidentes de segurança confirmados** | mínimo de 5 anos a partir do registro |

Incidentes exigem acesso restrito, integridade protegida e trilha de auditoria.

- Referência indicada: Resolução CD/ANPD nº 15/2024. **A confirmar no texto oficial** — a resolução trata da
  comunicação de incidente; o prazo de 5 anos foi fixado como decisão do responsável e deve ser conferido contra o
  texto antes de publicar a política.

### Telemetria

| Tipo | Prazo |
|---|---|
| Telemetria bruta ou vinculável a pessoa, conta ou dispositivo | 90 dias |
| Depois de 90 dias | eliminar **ou** anonimizar de forma efetiva |
| Estatísticas agregadas e efetivamente anônimas | até 12 meses |

Telemetria opcional permanece **desligada até consentimento válido** e deve poder ser revogada — já implementado, ver
`docs/consentimento-e-cookies.md`.

Operadores (Google Analytics, Firebase e demais) devem ser configurados para o **menor prazo tecnicamente possível**
compatível com esta política. Divergência de fornecedor precisa ser documentada **antes** de publicar a política
(ver [Divergências](#divergências-de-fornecedor-a-verificar)).

### Exclusão de conta

| Etapa | Prazo |
|---|---|
| Bloqueio de acesso e retirada pública do perfil | imediatamente após a confirmação |
| Exclusão dos sistemas ativos | até 30 dias |
| Dados mínimos para comprovar a solicitação, cumprir obrigação legal, prevenir fraude ou exercer direitos em processo | até 5 anos, acesso restrito, finalidade específica |

**Não** conservar perfil, publicações ou dados comuns da conta por anos "por precaução".

Havendo ordem judicial ou *legal hold* válido, conservar **somente** os dados abrangidos e pelo período necessário.
Expirado o prazo ou a obrigação, eliminar ou anonimizar.

### Backups — ciclo máximo de 90 dias

- Dados excluídos podem permanecer **residualmente** em backups inacessíveis ao uso normal até a sobrescrita
  automática. Isso precisa estar dito na Política de Privacidade, com honestidade.
- **Não restaurar** dados excluídos para uso normal.
- Se um backup for recuperado, **reaplicar as solicitações de exclusão e os tombstones antes de reabrir o sistema**.
  Esse procedimento precisa estar escrito e testado.

## Exceções

Prazo maior só com: obrigação legal ou regulatória; ordem judicial; solicitação válida de preservação; investigação
de incidente; ou necessidade concreta e documentada de exercício de direitos.

Toda exceção registra: **justificativa, escopo mínimo, acesso restrito, responsável e data de encerramento.** Sem os
cinco, não é exceção — é retenção indevida.

## Controles técnicos: o que existe e o que falta

| Dado | Onde | Descarte hoje | O que falta |
|---|---|---|---|
| Eventos de acesso | `access_events` (Firestore) | **Nenhum.** Acumulam indefinidamente | Política de TTL em 180 dias. Hoje não há campo de expiração no documento (`src/app/api/log-access/route.ts` grava `serverTimestamp` apenas) |
| Marcadores de visualização e clique | `posts/{id}/views/{uid}`, `posts/{id}/profileClicks/{uid}` | **90 dias**, por `expireAt` mais política de TTL declarada em 2026-11-11. A regra impõe a janela do prazo (`isExpiringMarker`), então nem o cliente escolhe quanto tempo o próprio rastro dura | Publicar as políticas de TTL em produção — **pede aprovação** |
| Marcadores de idempotência | `_functionEvents`, campo `expireAt` de 7 dias | Política de TTL **declarada** em 2026-11-11. Antes não existia nenhuma: `functions/src/index.ts` gravava `expireAt` "para uma política de TTL" que nunca foi criada, e os marcadores acumulavam indefinidamente | Publicar em produção e conferir se já havia política criada à mão no console |
| Conta excluída | `onUserDeletedCleanup` | Existe, mas **falha em produção** por falta de índices de campo único de grupo de coleções em `userId` (`comments`, `likes`, `reposts`) | Publicar os índices — já declarados em `firestore.indexes.json`, pendentes de aprovação. **Sem isso o prazo de 30 dias não é cumprível** |
| Telemetria/Analytics | Google Analytics | Prazo do fornecedor, não configurado por nós | Definir o menor prazo na interface do GA e registrar o valor aqui |
| Backups | Firestore / infraestrutura | Não verificado | Levantar o que existe de backup, com que frequência e por quanto tempo |
| Logs de servidor | Cloud Run / App Hosting | Prazo padrão do Google Cloud Logging | Conferir o prazo do `_Default` bucket e ajustar para 180 dias |

A linha mais grave é a da exclusão de conta: **ela não se completa hoje em produção.** O prazo de 30 dias é uma
promessa que depende de um índice que ainda não foi publicado.

As políticas de TTL declaradas em 2026-11-11 (`views`, `profileClicks`, `_functionEvents`) **só passam a apagar
quando forem publicadas**. Enquanto o deploy não acontecer, o campo `expireAt` é gravado e nada o lê — o documento
continua lá.

## Divergências de fornecedor a verificar

Antes de publicar a Política de Privacidade com estes prazos, confirmar e registrar aqui:

1. **Google Analytics 4** — qual o menor prazo de retenção de dados de usuário que a interface permite, e se ele é
   compatível com os 90 dias desta política. Se o mínimo for maior, a divergência precisa estar na política.
2. **Google Cloud Logging** — prazo de retenção dos buckets de log e se é ajustável para 180 dias.
3. **Firebase/Firestore** — existência e periodicidade de backups e janela de retenção (PITR, se habilitado).
4. **Firebase Authentication** — o que resta após `deleteUser` e por quanto tempo.

## Pendências de advogado ou DPO

- Validação das **bases legais** de cada tratamento, em especial onde se invoca legítimo interesse.
- **Teste de balanceamento** do legítimo interesse para registros de acesso e segurança (documento próprio).
- Confirmação do prazo de **5 anos** para registros de incidente contra o texto da Resolução CD/ANPD nº 15/2024.
- Confirmação de que **180 dias** para registros de acesso atende o art. 15 do Marco Civil no caso desta plataforma
  (a obrigação de guarda alcança provedores de aplicação em hipóteses específicas).
- Procedimento final de resposta a requisições de autoridade.
