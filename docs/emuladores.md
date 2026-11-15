# Emuladores Firebase (desenvolvimento local)

Permite rodar o SOBERAN inteiro (Auth, Firestore, Cloud Functions, Realtime Database e Storage) **sem tocar em nenhum
projeto Firebase real**. É opt-in: sem as variáveis abaixo o app se comporta exatamente como antes.

## Pré-requisitos

- Node 22 (o `engines` do projeto) e JDK 21 ou mais novo no `PATH` (os emuladores de Firestore/Database são Java).
- Portas livres: 4000, 4400, 4500, 5001, 8080, 9000, 9099, 9199 (emuladores) e 9002 (app).

## Como rodar

```powershell
# terminal 1 – emuladores (compila as Functions, isola credenciais e confere Java/portas)
npm run emulators

# terminal 2 – app (lê .env.development.local; -H localhost evita problemas de IPv6 no Windows)
npm run dev -- -H localhost
```

App: <http://localhost:9002> · UI dos emuladores: <http://127.0.0.1:4000>.
Com tudo certo aparece o selo verde **"Emuladores Firebase ativos"** no canto inferior esquerdo.

## Arquivos de ambiente (não versionados; o Git ignora `.env*.local`)

`.env.development.local` (lido só pelo `next dev`, nunca pelo `next build`):

```ini
NEXT_PUBLIC_USE_EMULATORS=true
NEXT_PUBLIC_FIREBASE_API_KEY=demo-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=localhost
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-soberan
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=demo-soberan.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=000000000000
NEXT_PUBLIC_FIREBASE_APP_ID=1:000000000000:web:0000000000000000
NEXT_PUBLIC_FIRESTORE_DATABASE_ID=echo-db-124325
NEXT_PUBLIC_FUNCTIONS_REGION=southamerica-east1
NEXT_PUBLIC_BASE_URL=http://localhost:9002
REVALIDATE_SECRET=local-only-secret
```

`functions/.env.local` (lido só pelo emulador de Functions):

```ini
FIRESTORE_DATABASE_ID=echo-db-124325
FUNCTIONS_REGION=southamerica-east1
```

## Garantias de segurança

1. **Projeto `demo-*`**: não existe na nuvem. O cliente recusa subir (`throw`) se `NEXT_PUBLIC_USE_EMULATORS=true` for
   combinado com um `projectId` que não comece com `demo-` (ver `src/lib/firebase-emulators.ts`).
2. **Sem fallback silencioso**: nenhuma falha de conexão é engolida. Se os emuladores não estiverem rodando, aparece uma
   faixa vermelha na tela e um `console.error` explicando; o app não passa a usar o projeto real.
3. **Credenciais isoladas, com prova**: `npm run emulators` redireciona `APPDATA`/`HOME`, `XDG_CONFIG_HOME` e
   `CLOUDSDK_CONFIG` e **testa** se a ADC do Google ainda é alcançável (aborta se for). Isso foi necessário porque a
   biblioteca de autenticação do Google ignora `CLOUDSDK_CONFIG` e lê `%APPDATA%\gcloud` no Windows.
4. **Sem tráfego para serviços reais do navegador**: em modo emulador AdSense, Google Tag Manager e Google Analytics
   ficam desligados. O teste E2E (`e2e/emulators-smoke.mjs`) falha se o navegador contatar qualquer host real do
   Google/Firebase.

## Firestore nomeado (`echo-db-124325`): resultado da validação

Validado contra firebase-tools 15.34.0 / Firestore Emulator 1.22.0:

- Os emuladores aceitam o banco nomeado em tempo de execução, com **dados isolados** do `(default)`.
- As **regras de segurança valem** no banco nomeado com lógica real (post público legível sem login; coleção não
  prevista negada).
- Gatilhos declarados com `database: DATABASE_ID` disparam **somente** para o banco nomeado (criar post no nomeado:
  +1 execução de `onPostCreated`; no `(default)`: +0).
- **Atenção:** o `firebase.json` com `firestore` em formato de lista (uma entrada por banco) **faz o emulador descartar
  as regras** ("does not support multiple databases yet" e "allowing all reads and writes"). Use o formato de objeto,
  como em `firebase.emulators.json`: um único arquivo de regras vale para todos os bancos.

## Suítes de teste E2E

Todas usam `playwright-core` de fora do projeto (`E2E_NODE_MODULES`) e o Chrome instalado (`E2E_BROWSER`); nenhuma dependência
foi adicionada. Variáveis comuns: `E2E_BASE_URL`, `E2E_OUT` (capturas, `matrix.json` e `matrix.md`), `E2E_RESET=1` (zera os
dados dos emuladores).

| Comando | O que cobre |
|---|---|
| `node e2e/emulators-smoke.mjs` | Cadastro, login, post, comentário e resposta pela interface real |
| `npm run e2e:fluxos` | Seguir, curtir, repostar, comentar, notificações, mensagens privadas, artigos, mídia no Storage, perfil, busca, configurações e ~70 testes negativos de autorização pela REST. `E2E_ONLY=social,mensagens,artigos,midia,perfil,autorizacao` roda só algumas seções |
| `npm run e2e:recommendations` | Ranking puro de sugestões: reciprocidade, conexões em comum, afinidade, atividade, desempate estável e limite; não precisa de app nem emuladores |
| `npm run e2e:recommendations:integration` | Quatro contas descartáveis nos emuladores: motivos explicáveis, exclusão de conta já seguida e bloqueio inverso, além da sincronização entre Explorar e coluna direita |
| `npm run e2e:pwa` | Service worker, offline, instalação, atualização e auditoria dos caches (veja `docs/pwa.md`) |
| `npm run e2e:safe-fetch` | Proteção contra SSRF da rota de extração de artigos; não precisa de emuladores |
| `node e2e/presence-rtdb-diagnostico.mjs` | Diagnóstico da presença no RTDB (veja `docs/presenca.md`) |

O resultado de `e2e:fluxos` e a leitura dele estão em `docs/matriz-funcionalidades.md`.

Para a suíte de fluxos o app deve rodar em modo emulador (build de produção com `NEXT_PUBLIC_USE_EMULATORS=true` e valores
`demo-*`, ou `npm run dev -- -H localhost`) na porta 9002 e com duas variáveis **só de teste**:
`REVALIDATE_SECRET=local-only-secret` (a Function de post chama `/api/revalidate`) e `EXTRACT_ARTICLE_ALLOW_LOOPBACK=true`
(a fixture de artigos fica em 127.0.0.1; libera só loopback na rota de extração, nunca em produção).

## Armadilhas já vistas

- **Mudar `firestore.rules` com os emuladores no ar só recarrega o banco `(default)`.** O banco nomeado (`echo-db-124325`)
  continua com as regras do início: reinicie `npm run emulators` antes de testar.
- As Functions só ficam utilizáveis alguns segundos depois de o hub listar o emulador: espere uma callable (por exemplo
  `checkAvailability`) responder antes de cadastrar usuários.
- Apagar, com o administrador do emulador, um documento recém-criado antes de o gatilho dele terminar faz a Function ler um
  documento que não existe mais (`TypeError` e worker reiniciando); nos testes, espere a Function acabar antes de apagar.
- Diálogos nativos (`window.confirm`, usados para bloquear usuário e apagar post) são recusados por padrão pelo Playwright:
  registre `page.once('dialog', d => d.accept())` antes do clique.

## Limitações conhecidas

- O emulador **não valida índices compostos** (`firestore.indexes.json`): consultas que dependem de índice passam aqui
  e podem falhar em produção até o índice ser publicado.
- Funções agendadas (`aggregateAccessEvents`, `fetchTrendingNews`) **não rodam** (sem Pub/Sub
  emulado). É intencional: a de notícias busca fontes externas por RSS.
- FCM (push) não é emulado.
- As Functions emuladas **têm acesso à internet pública**. Chamadas HTTP externas escritas no código (por exemplo, o ping
  de sitemap ao Google/Bing, hoje descontinuado) saem de verdade.

## Solução de problemas

- `Portas em uso`: encerre processos antigos de `java`/`node` dos emuladores.
- `Java ... antigo demais`: aponte `JAVA_HOME` para um JDK 21+ (o JBR do Android Studio serve).
- Faixa vermelha no app: os emuladores não estão no ar; rode `npm run emulators` e recarregue.
