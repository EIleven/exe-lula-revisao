# Auditoria: mensagens (P2P, E2EE, Pix, push), contadores em tempo real e federação da conta oficial

Data: 2026-11-14. Base auditada: o que estava no ar (builds 035 a 038 do App Hosting). Branch do trabalho: `audit/p2p-contadores-oficial`
(worktree `E:\Soberan\echo-core`). Leitura de produção só com GET e consultas; a única escrita em produção foi o deploy (abaixo).

## 1. O que subiu e o que ficou retido

**No ar (build `039` + Function `apPostFederation`, 22:08Z, conferido em produção):** tudo o que é de SERVIDOR e foi provado por suíte:

- hashtags da federação (bug que atingia todos os posts), foto e descoberta do ator oficial, validação da API oficial, observabilidade
  da entrega (logs, classes de falha, rastro de pulos e de mídia omitida, saúde das entregas no painel);
- contadores de posts remotos: regra de quando confiar na origem, gravação em transação, correção do bug que inflava o post com a
  contagem de curtidas de um comentário, e a rota `/api/ap/sync-counts` (que o outro agente subiu às 21:09Z) endurecida;
- Function: corrigir a manchete de uma notícia agora gera `Update`.
- Está integrado na árvore de `echo-fed` (idêntico ao que foi ao ar, 18 arquivos + testes), para o próximo deploy dela não derrubar nada.

**Retido na branch (decisão consciente, ver §5):** cliente de mensagens (motor P2P novo, E2EE com chaveiro, portabilidade cifrada, telas),
regras do RTDB da sinalização, ouvinte único de contadores no `PostCard`. Motivo: o outro agente está mexendo AGORA nos mesmos arquivos de
P2P/DM (builds 037/038: `p2pDeviceSync`, `sync_request`/`sync_batch`, `p2pStatus`) e nada disso foi exercitado num navegador.

**Pendência de dado (1 clique):** o documento `users/official_exercitodolula` ainda guarda `avatarUrl: "/lula-icon.png"` (404) e
`dmPreference: "nobody"`. A rota nova conserta isso sozinha quando um admin abre o painel da Conta Oficial. O conserto direto foi negado
pelo classificador do modo automático e não foi contornado.

## 2. Achados (arquivo:linha na versão que estava no ar antes)

### Federação e conta oficial
| # | Sev. | Achado | Onde | Estado |
|---|------|--------|------|--------|
| F1 | P0 | `posts.hashtags` é gravado COM `#` e a nota saía `"name":"##Lula"`, href `/tag/%23Lula` (nota real de @breno). O Mastodon só indexa hashtag por `tag`: nenhuma hashtag nossa era indexada lá. | `src/lib/activitypub/render.ts:151` | corrigido, no ar |
| F2 | P0 | Avatar `/lula-icon.png` não existe (404 em produção): ator sem `icon`. | `official-account/route.ts:39,130`; card `:58` | corrigido; dado aguarda o painel |
| F3 | P1 | `dmPreference: 'nobody'` não existe (`'everyone'|'followed'|'none'`): lido como "todos". | `route.ts:45,186` | corrigido; dado aguarda o painel |
| F4 | P1 | Manchete de notícia editada nunca virava `Update` (afeta qualquer conta, não só a oficial). | `functions/src/federation.ts:46` | corrigido, Function no ar |
| F5 | P1 | API oficial sem validação: mídia de fora sai SEM a imagem, 9º anexo descartado, `youtubeVideoId` livre, alcance inválido virava "público"; corpo limitado a 4 KB. | `route.ts:111-112,140-149`; `server/federation.ts` (`readJsonObject`) | corrigido, no ar |
| F6 | P1 | Falha invisível: portão que barra, mídia omitida e entrega que morre só deixavam contador. | `worker.ts:203,238,244,634,662,666` | corrigido, no ar |
| F7 | P1 | `/api/ap/sync-counts` do build 036: aberta, até 15 buscas paralelas a servidores alheios por chamada, sem limite, escrita direta sem transação e só-sobe. | `api/ap/sync-counts/route.ts`, `remotePostInteractions.ts` | corrigido, no ar |
| F8 | P2 | Menção a pessoa de outro servidor sai como texto: sem tag `Mention` e sem o ator no `cc`. | `render.ts` (`noteFor`) | aberto |
| F9 | P2 | Editar o perfil não manda `Update{Person}`: as outras instâncias guardam nome/foto velhos por dias. | `route.ts` (`PATCH`) | aberto |
| F10 | P2 | Compositor mostra enquete e citação ao postar como oficial e descarta os dois em silêncio. | `CreatePostDialogContent.tsx` (ramo oficial) | aberto |

Produção hoje: conta criada 15:36Z, **0 posts, 0 seguidores remotos, 0 entregas**. Nada federou por ela ainda; o primeiro post é o primeiro
teste real. WebFinger (qualquer caixa), ator, outbox e followers respondem 200.

### Contadores em tempo real
| # | Sev. | Achado | Onde | Estado |
|---|------|--------|------|--------|
| C1 | P0 | `Math.max(guardado, origem)` nunca descia (quem descurtia no Fediverso continuava contado) e perpetuava inflação. | `remoteMaterialize.ts:449-451,514-516` | corrigido, no ar (`counterPolicy.ts`) |
| C2 | P0 | A lista de quem reagiu a um COMENTÁRIO era gravada em `posts/{postId}.likes/.reposts`, inflando o post pai. | `remotePostInteractions.ts:441-445,494-498` | corrigido, no ar |
| C3 | P1 | Leitura-cálculo-escrita sem transação desfazia uma curtida somada pela Function no meio. | idem | corrigido, no ar (`remoteCounts.ts`) |
| C4 | P1 | Um `onSnapshot` por cartão (dezenas por feed, mesmo post = dois ouvintes) e curtida "piscando" (snapshot velho desfaz a mudança). | `PostCard.tsx:132` | corrigido na branch; **retido** |

### Mensagens (retido, exceto onde dito)
| # | Sev. | Achado | Onde | Estado |
|---|------|--------|------|--------|
| M1 | P0 | Aparelho sem a chave privada gerava par novo e SOBRESCREVIA a chave pública publicada: perda de acesso às mensagens. | `crypto/e2ee.ts:50-63` | corrigido na branch |
| M2 | P0 | Sinalização WebRTC sem validar remetente, formato, tamanho nem carimbo (spoofing, lixo órfão). | `database.rules.json:35-48` | corrigido na branch (emulador: 27/27; regras antigas falham 14) |
| M3 | P1 | Só STUN, sem TURN; ofertas e candidatos sem ordem; mensagem da rede sem validação nem limite de taxa; sem motivo de falha. | `p2p/p2pChannel.ts:39-40,243,303` | corrigido na branch (`p2pSession.ts`, 76 verificações) |
| M4 | P1 | `pathname` nas dependências re-assina `onMessage` a cada navegação; `ensureUserE2eeKeyPair` a cada carga. | `PushBridge.tsx:35,43,94` | **aberto** |
| M5 | P1 | Pix: campo 26 do BR Code estoura 99 caracteres com chave longa + descrição (QR inválido); chave de CPF/telefone sem normalizar; lembrete mensal sem remetente. | `pix/brCode.ts:72`; `PixSupportBadge.tsx:57` | **aberto** |
| M6 | P2 | `users/{uid}.pixKey` é legível por qualquer pessoa (regra). Esconder na tela não protege. | `firestore.rules` | decisão sua |
| M7 | P2 | Portabilidade só exportava parte do estado e em texto puro. | `p2p/p2pPreferences.ts` | corrigido na branch (pacote v2: PBKDF2 600k + AES-GCM, importação hostil recusada) |

## 3. Plano priorizado

1. **Agora (feito):** F1-F7, C1-C3. **Você:** abrir o painel da Conta Oficial uma vez (F2/F3).
2. **Próximo:** integrar o que ficou retido (§5); M4 e M5; configurar TURN (§6).
3. **Depois:** F8 (menções: resolver o WebFinger do alvo e entregar ao inbox dele), F9 (`Update{Person}`), F10, M6.
4. **Operação:** alerta por log (§4); Function agendada que limpa sinais órfãos do RTDB (as regras não contam filhos, então o teto por
   canal não pode ser imposto lá).

## 4. Observabilidade (no ar)

Uma linha JSON por evento no Cloud Logging (`severity`, `message`, `event`, `domain`, `op`, `status`, `failureClass`, `attempts`,
`retryInSeconds`, `reason`). Sem corpo, URL de inbox nem chave.

- Entrega que morreu: `jsonPayload.event="ap.delivery.dead"`. Assinatura recusada: `jsonPayload.failureClass="assinatura"` (HTTP 401, ERROR já na
  primeira; vários domínios ao mesmo tempo apontam para chave, relógio ou ator fora do ar). Bloqueio: `failureClass="bloqueio"` (403).
- Portão que barrou: `event="ap.job.skipped"` (com `reason`); mídia que ficou de fora: `event="ap.media.omitted"`.
- Contadores do dia (`ap_stats`): `entrega.falha.<classe>`, `entrega.morta-classe.<classe>`, `worker.midia-omitida`, `worker.pulada.<motivo>`.
- Painel da Conta Oficial: entregas enviadas/na fila/mortas, recusas de assinatura e as últimas mortas; `retryDeliveryForUser` reagenda.
- Sugestão: métrica baseada em log de `ap.delivery.dead` e alerta em `failureClass="assinatura"` com 2+ domínios em 10 min.

## 5. Como integrar o que ficou retido

Commits na branch: `8a4703d9` (E2EE), `4299f3ba` (motor P2P), `940256e9` (regras do RTDB), `dc19db5c` (telas), `9598e758` (ouvinte de contadores).
O que foi ao ar são ARQUIVOS desses commits (o subconjunto de servidor), não a branch inteira.

O outro agente mudou, depois do 036, exatamente onde a branch reescreve: `p2p/p2pChannel.ts` (mensagens `sync_request`/`sync_batch`,
`syncP2pHistoryToOwnDevices` sobre `p2pDeviceSync` cifrado, `p2pStatus: 'queued'|'sent'`), `database.rules.json` (`p2pDeviceSync`),
`messages/user/[otherUserId]/page.tsx`, `MessageBubble.tsx`, `types.ts`. Subir a branch por cima apagaria isso. Ordem sugerida:

1. Portar para o motor novo (`p2pSession.ts` + `p2pChannel.ts`): fila `queued`/`sent` (o motor já tem `sendWire` com estado), `sync_request`/`sync_batch`
   (passam por `parseWireData`, que valida tamanho e forma), e `p2pDeviceSync` (mantém a regra no arquivo de regras).
2. Rodar: `e2e:p2p-core`, `e2e:e2ee`, `e2e:p2p-regras` (emuladores auth+database), e os fluxos `mensagens`, `social`, `interacoes`, `rolagem` de
   `e2e/flows-emulators.mjs` (precisa dos emuladores e do app em modo emulador).
3. Subir o site; **só depois** as regras do RTDB (cliente antigo escreve sinais no formato velho, que as regras novas recusam).

## 6. TURN (relay do WebRTC) e riscos residuais

- Sem TURN, NAT simétrico dos dois lados não conecta e a tela diz isso (motivo `nat`). Para ligar: um coturn com `use-auth-secret`; no
  `apphosting.yaml`, `P2P_TURN_URLS` (`turn:host:3478?transport=udp,turns:host:5349?transport=tcp`), `P2P_TURN_SECRET` (Secret Manager, o
  mesmo `static-auth-secret`) e opcional `P2P_STUN_URLS`. A rota `GET /api/p2p/ice` exige login e devolve credencial de 1 h.
- A chave privada do E2EE fica em `localStorage` (XSS ainda expõe); grupos não são E2EE; não há exportação self-service do que está no servidor.
- Contadores já inflados: a política corrige quedas na próxima revalidação de cada post visto; posts nunca vistos ficam como estão.
- Mutantes: 34 (contagem) + 33 (conta oficial) plantados, todos mortos; suítes puras: ap-core 466, ap-services 190, ap-oficial 171, count-sync 164.
