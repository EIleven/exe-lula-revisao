# Checklist LGPD e roteiro por prioridade

**Natureza:** controle interno, versionado. Serve para saber o que falta — **não** é atestado de conformidade, e
nenhum item marcado como feito significa que a plataforma está integralmente adequada à LGPD.

**Responsável por todos os itens:** Breno César (controlador e encarregado). Onde está escrito "advogado/DPO", é
decisão que ele não pode tomar sozinho.

**Legenda:** ✅ feito · 🟡 parcial · ⬜ pendente · ⚖️ depende de advogado/DPO

| # | Item | Estado | Evidência / o que falta |
|---|---|---|---|
| 1 | **Inventário das operações de tratamento** (art. 37) | ✅ | `docs/matriz-de-tratamentos.md` — 24 tratamentos extraídos do código e das regras, com dados, finalidade, base, retenção, compartilhamento, controles e risco |
| 2 | **Governança e responsáveis** | 🟡 | Controlador e encarregado identificados em `src/config/site.ts` e publicados na política. Falta: suplente para ausência do responsável, e política interna de acesso escrita |
| 3 | **RIPD** (relatório de impacto) | ⬜⚖️ | Não feito. Há dois tratamentos que o justificam: métricas por publicação (T14) e mensagens diretas sem ponta a ponta (T7). Advogado define se é exigível aqui |
| 4 | **Legítimo interesse + teste de balanceamento** | ⬜⚖️ | Cinco tratamentos invocam legítimo interesse (T5, T13, T14, T15, T16, T19, T20). O teste de balanceamento **não existe** e sem ele a base está incompleta. A política já diz que a análise não está concluída |
| 5 | **Contratos com operadores e subprocessadores** | 🟡⚖️ | Google/Firebase é operador sob os termos padrão aceitos na contratação. Falta conferir se os termos de tratamento de dados do Google atendem o art. 39 e registrar os subprocessadores dele |
| 6 | **Transferências internacionais** | 🟡⚖️ | **Declarada** na política (Google é empresa estrangeira). Falta o fundamento formal do art. 33 — cláusulas-padrão, adequação ou outra hipótese — e isso é parecer jurídico |
| 7 | **Controle de acesso e menor privilégio** | ✅ | Regras do Firestore por dono; dados pessoais em `users/{uid}/private/account` que só o titular lê; contadores só por Functions; `reports` e `dataRequests` restritos a titular e administrador; suíte `e2e/flows/autorizacao.mjs` exercita |
| 8 | **Logs e auditoria** | 🟡 | Logs de servidor existem (Cloud Logging). Falta: prazo ajustado para 180 dias e trilha de auditoria das ações administrativas (quem respondeu qual pedido, quem moderou o quê) |
| 9 | **Criptografia e gestão de segredos** | ✅ | Em trânsito por HTTPS e em repouso pelo provedor; segredos no Secret Manager (`ATPROTO_PRIVATE_JWK`, `REVALIDATE_TOKEN`) com `availability: RUNTIME`, fora do repositório e do cliente; senha de assinatura do APK via DPAPI |
| 10 | **Backups e descarte** | ⬜ | **Não levantado.** Não se sabe se há backup do Firestore, com que frequência nem por quanto tempo. A política já declara o ciclo de 90 dias como regra, e isso precisa ser verdade — ver `docs/politica-de-retencao.md` |
| 11 | **Gestão de vulnerabilidades** | 🟡 | Houve correção de XSS armazenado (`ec85041`) com guarda automatizada (`e2e:sanitize`, `e2e:xss`), e os defeitos R1–R9 foram fechados em outubro. Falta: processo recorrente (revisão de dependências, canal para receber relato de falha) |
| 12 | **Resposta a incidentes** | ⬜ | Plano **não escrito**. É o maior buraco restante do bloco de governança: sem ele, o prazo de comunicação à ANPD depende de improviso |
| 13 | **Canal do titular** | ✅ | Dois caminhos: e-mail público (`admlabra@gmail.com`, art. 41) e canal interno com protocolo, prazo de 15 dias e acompanhamento (`settings/data-rights`), com 37 verificações em `e2e:direitos` |
| 14 | **Exclusão e portabilidade** | 🟡 | Exportação em JSON e exclusão de conta funcionam na interface. **Mas a exclusão não se completa em produção**: faltam os índices de `userId` e `onUserDeletedCleanup` falha. Preparado, não publicado |
| 15 | **Descarte automático** | 🟡 | TTL declarado para `views`, `profileClicks` e `_functionEvents`; migração dos marcadores antigos preparada e verificada nos emuladores. **Nada publicado.** `access_events` ainda **não** tem descarte |
| 16 | **Consentimento válido** | ✅ | Negado por padrão, aceitar e recusar com o mesmo peso, revogável em caminho permanente, versionado e com data; 33 verificações em `e2e:consent`, incluindo varredura contra tag solta no código |
| 17 | **Documentos ao titular** | ✅ | Política de Privacidade, Termos, Política de Cookies com inventário e Diretrizes da Comunidade, todos reescritos em 2026-11-11, com histórico de versões |
| 18 | **Treinamento interno** | ⬜ | Equipe de uma pessoa. Ainda assim, convém registro mínimo do que fazer diante de incidente, denúncia de crime contra menor e pedido de autoridade |
| 19 | **Revisão periódica** | ⬜ | Sem data definida. Sugestão: revisar matriz, retenção e checklist a cada 6 meses, e sempre que entrar tratamento novo |
| 20 | **Evidências** | 🟡 | As suítes automatizadas servem de evidência técnica (`e2e:consent`, `e2e:marcadores`, `e2e:direitos`, `e2e:fluxos`, `check:domain`). Falta registro das decisões administrativas e das comunicações a autoridade |

## O que exige advogado ou DPO

1. **Teste de balanceamento do legítimo interesse** (item 4) — sem ele, sete tratamentos ficam com base incompleta.
2. **Fundamento da transferência internacional** (item 6) — art. 33.
3. **RIPD** (item 3) — se é exigível para métricas por publicação e mensagens diretas.
4. **Dado sensível:** numa rede política, curtida e lista de quem se segue podem revelar convicção (matriz, T11). Se
   atrair o art. 5º, II, a base legal exigida muda.
5. **Aferição de idade proporcional** — sem obrigar todos a entregar documento, o que criaria risco maior do que
   resolve.
6. **Citações legais das Diretrizes** — os artigos dos crimes não foram conferidos na fonte oficial; número errado em
   documento público é pior que ausência.
7. **ECA Digital** — a norma aplicável, sua regulamentação e o procedimento formal de comunicação ao CNCA e à Polícia
   Federal.
8. **Prazo de 5 anos para registro de incidente** — conferir contra a Resolução CD/ANPD nº 15/2024.
9. **Eleição de foro e solução de conflito** nos Termos — deixada em branco de propósito, por envolver relação de
   consumo.
10. **Retenção de prova** em caso envolvendo criança ou adolescente, e sua relação com o prazo de 5 anos.

## Roteiro por prioridade

### P0 — rastreamento, canal e declarações incorretas ✅ concluído
Gate de consentimento (nada opcional antes do aceite), canal do titular real no lugar de "está sendo configurado", e
remoção das declarações incorretas das páginas legais. Commits `48c475a` e `8d462bb`.

### P1 — documentos, direitos e inventário ✅ concluído em preparação
Política de Privacidade e Termos reescritos da matriz; Política de Cookies com inventário; Diretrizes da Comunidade
criadas e linkadas; canal interno do titular implementado; matriz de 24 tratamentos; identificação do controlador com
caminho da ANPD. **Nada publicado.**

### P2 — governança, retenção e controles 🟡 em curso
| Pendência | Prioridade |
|---|---|
| **Publicar** regras, índices e TTL, na ordem de `docs/implantacao-privacidade.md` | Alta — destrava a exclusão de conta |
| **Rodar** a migração dos marcadores (`docs/migracao-marcadores.md`) | Alta — sem ela o passado nunca expira |
| **Plano de resposta a incidentes** (item 12) | Alta |
| **TTL de `access_events`** em 180 dias (item 15) | Alta — hoje acumulam sem limite |
| Levantar backups (item 10) e prazo do Cloud Logging | Média |
| Trilha de auditoria das ações administrativas (item 8) | Média |
| Registro do consentimento no servidor, hoje só no navegador | Média |
| Teste de balanceamento e RIPD | Depende de advogado |

### P3 — federação atrás de feature flag 🟨 ActivityPub implementado e publicado DESLIGADO; AT Protocol e P2P não
**ActivityPub:** implementado, testado e **publicado desligado em 2026-11-12** (ver `docs/arquitetura-activitypub.md` e
`docs/implantacao-federacao.md`). Três níveis de consentimento (plataforma, conta, publicação), todos desligados por
padrão; o que sai é escolhido post a post; mensagens privadas, arquivos pessoais e dados de conta nunca saem; posts
anteriores à ativação nunca saem; a decisão é reavaliada no momento do envio. Falta, para ligar: textos legais
atualizados, teste de interoperabilidade com servidor real e parecer sobre a transferência internacional (ver P5).
**AT Protocol:** ainda não federa nada; há conexão opcional de publicação já existente, com defeitos de limpeza e
revogação a corrigir antes de qualquer ampliação. **P2P:** não iniciado.

### P4 — camada P2P opcional ⬜ não iniciado
Estritamente opcional, sem penalizar quem não participa, com avaliação explícita de quando **não** usar.

### P5 — ativação gradual ⬜ bloqueado
Somente após revisão jurídica e de segurança. **Nada de federação ou P2P LIGADO em produção antes disso.** O código do
ActivityPub está em produção, mas desligado (sem o documento `config/federation` a plataforma vale desligada): ninguém
consegue ativá-lo, nada é enviado e nada é recebido. Para ligar: (1) textos legais atualizados só com o que está
implementado, (2) teste de interoperabilidade com um servidor real de terceiros, (3) parecer sobre a transferência
internacional por federação, (4) segredo e agendador configurados, (5) abertura gradual em `allowlist`.

## Lacunas, classificadas

**Obrigatórias** (impedem afirmar adequação): teste de balanceamento; fundamento da transferência internacional; plano
de resposta a incidentes; exclusão de conta funcionando de fato em produção; descarte automático efetivo, inclusive de
`access_events`.

**Recomendadas:** RIPD; trilha de auditoria administrativa; registro do consentimento no servidor; levantamento de
backups; processo recorrente de vulnerabilidades; data de revisão periódica; tradução das páginas legais para inglês.

**Opcionais:** caixas de e-mail no domínio próprio em lugar do endereço pessoal; relatório público de transparência;
mecanismo de aferição de idade, se o parecer jurídico concluir que é proporcional.
