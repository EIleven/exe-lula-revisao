# PWA: service worker, offline, instalação e cache

Validado em 2026-10-15 na branch `feat/lula-producao`, em build de **produção** (`next build` + `next start`) com Chrome 155
real e os emuladores do Firebase. Em desenvolvimento (`next dev`) o `next-pwa` fica desligado e não há service worker.

## O que o service worker faz

| Item | Comportamento |
|---|---|
| Registro | `PwaUpdateNotifier` registra `/sw.js` (escopo `/`) fora de desenvolvimento. O `next-pwa` só injeta `window.workbox` no Pages Router, então o registro é manual. |
| Pré-cache | 141 URLs: os arquivos do build (`/_next/static/**`), tudo de `public/` e `/offline`. Todas precisam responder 200, senão a instalação inteira falha (`buildExcludes` tira `app-build-manifest.json`, que dá 404). |
| Navegação | Única regra de runtime: `NetworkOnly` para navegações da mesma origem. Sem rede, o fallback `/offline` (pré-cacheado) assume. |
| Todo o resto | **Nunca é guardado**: APIs, RSC, Firestore, Auth, Storage, respostas de outra origem. Vai direto à rede. |
| Atualização | `skipWaiting` + `clientsClaim`: o service worker novo assume na hora; a página **recarrega sozinha** (só quando já havia um controlador, nunca na primeira instalação). Os pré-caches antigos são limpos (`cleanupOutdatedCaches`). |
| `start_url` | O cache de start-url do `next-pwa` está desligado: `/` redireciona para o idioma e ele guarda uma resposta vazia (medido: entrada de 0 bytes, e o app aberto sem rede mostrava página em branco). |

Mudar a política: `next.config.ts` (`runtimeCaching`). As funções de `urlPattern` são serializadas dentro do `sw.js`, então
precisam ser autossuficientes. Toda regra precisa de `options` (o `next-pwa` anexa o tratamento de erro do fallback a cada uma).

### Por que o cache padrão foi restringido

Medido com fluxos autenticados (cadastro, login, post, páginas privadas e sondas), o padrão do `next-pwa` deixava 18 entradas
indevidas no cache `cross-origin` (canais `Listen`/`Write` do Firestore, um GET do Firestore com `Authorization` que devolvia
o documento do usuário com e-mail, downloads do Storage com token na URL, sondas opacas do SDK) e 58 de HTML/RSC de rotas
privadas por 24 h. O cache guarda por URL, sem considerar quem estava logado. Com a política atual: **0 entradas de runtime**.

## Instalação

Para o Chrome tratar o app como instalável é preciso o `<link rel="manifest">` dentro de `<head>`. O Next 15.2+ envia os
metadados em streaming dentro do `<body>` (só robôs de busca recebem `<head>`), e o Chrome ignora o manifest assim
(`no-manifest`). `htmlLimitedBots: /.*/` em `next.config.ts` mantém os metadados no `<head>` para todos.

**Pendência (etapa da logo):** `/icons/icon-192.png`, `/icons/icon-512.png` e `/icons/maskable-512.png`, citados em
`public/manifest.webmanifest`, respondem 404. Hoje o único erro de instalação é `no-acceptable-icon`. Com ícones válidos
(placeholders temporários, já removidos) o Chrome não apontou erro e disparou `beforeinstallprompt`. Os ícones novos entram no
pré-cache automaticamente por estarem em `public/`.

## Como validar

```powershell
. E:\Soberan\tools\activate-env.ps1
npm run emulators                                        # terminal 1
# terminal 2: build com valores demo-* e modo emulador (veja docs/emuladores.md), depois:
node node_modules\next\dist\bin\next start -H localhost -p 9012

# terminal 3
$env:E2E_NODE_MODULES = 'E:\Soberan\tools\e2e\node_modules'
$env:E2E_BROWSER = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$env:E2E_BASE_URL = 'http://localhost:9012'
$env:E2E_OUT = 'E:\Soberan\tools\logs\e2e\pwa'
node e2e\pwa-check.mjs                                   # fase install (perfil novo)
# edite algo visível em src/app/offline/page.tsx (ex.: "(v2)"), pare o servidor, rebuild, suba de novo e:
$env:E2E_PHASE = 'update'; $env:E2E_EXPECT_MARKER = '(v2)'
node e2e\pwa-check.mjs                                   # mesmo perfil, build novo
```

Mudanças em `public/` só aparecem depois de reiniciar o `next start`. `E2E_PHASE=update` exige o mesmo `E2E_OUT` da fase
install (o perfil e o estado ficam lá).

## Resultados (2026-10-15)

| Verificação | Resultado |
|---|---|
| Service worker registra e ativa no escopo `/`; a página fica controlada depois de recarregar | Passou |
| 141 URLs do pré-cache, todas 200 (cerca de 1,9 MiB); sem erro de service worker, Workbox ou pré-cache no console | Passou |
| Rota nunca visitada, sem rede: "Você está offline" | Passou |
| Abrir o `start_url` `/` (como o app instalado faz): online termina em `/pt-BR`; sem rede mostra o fallback. Com o cache de start-url padrão do `next-pwa` o resultado medido foi HTTP 200 com corpo vazio (página em branco) | Passou (padrão reprovado) |
| Instalabilidade (CDP `Page.getInstallabilityErrors`): só `no-acceptable-icon`; com ícones válidos, nenhum erro e `beforeinstallprompt` | Passou (ícones definitivos pendentes) |
| Cadastro, login, post e navegação por páginas privadas com o service worker ativo (nenhuma regressão) | Passou |
| Auditoria dos caches com a política atual: 141 entradas (todas de pré-cache), 0 de runtime, 0 indevidas | Passou (com o padrão do `next-pwa`: 18 + 58 indevidas) |
| Atualização: `sw.js` novo, página recarrega sozinha, build id trocado, 3 entradas antigas removidas e 3 novas, todas 200, fallback offline da versão nova | Passou |
| `next build` sem regressões: 52 rotas (51 de antes + `/offline`), First Load JS das páginas idêntico | Passou |

## Limites e decisões em aberto

- **Recarga automática na atualização.** Com `skipWaiting`, quem estiver digitando um post perde o rascunho não salvo quando
  sai versão nova. É o comportamento que o `PwaUpdateNotifier` original já pretendia (`controlling` → `reload`). Alternativa,
  se incomodar: `skipWaiting: false` e um aviso "Atualização disponível" com botão (mensagem `SKIP_WAITING`).
- **Hospedagem:** o `/sw.js` precisa ser servido sem cache longo (`Cache-Control: no-cache` ou `max-age=0`), senão a atualização
  demora. O Next faz isso por padrão com arquivos de `public/`; confira no provedor e em qualquer CDN.
- **`htmlLimitedBots`:** a primeira resposta HTML de post e perfil espera o `generateMetadata` (que consulta o Firestore).
- **Offline não é "app utilizável sem rede":** o service worker só garante a página de fallback. Dados dependem do Firestore.
- **Push web** segue incompleto (`firebase-messaging-sw.js` nunca existiu): veja `docs/divida-tecnica.md`.
