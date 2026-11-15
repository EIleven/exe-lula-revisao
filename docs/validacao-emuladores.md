# Validação local com os emuladores Firebase

Registro dos testes executados em 2026-10-15 na branch `feat/lula-producao`. Nenhum teste tocou o projeto Firebase real: tudo
rodou em um projeto `demo-soberan`, com credenciais do Google isoladas. Dados descartáveis; `E2E_RESET=1` zera os emuladores.

## Como reproduzir

```powershell
. E:\Soberan\tools\activate-env.ps1          # Node 22 + JDK 21 (somente nesta sessão)
npm run emulators                             # terminal 1
npm run dev -- -H localhost                   # terminal 2

# terminal 3 (playwright-core fora do projeto; Chrome ou Edge instalado)
$env:E2E_NODE_MODULES = 'E:\Soberan\tools\e2e\node_modules'
$env:E2E_BROWSER = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$env:E2E_RESET = '1'
node e2e\emulators-smoke.mjs                  # fluxo completo
# pare os emuladores e então:
node e2e\emulators-failure.mjs                # teste negativo
```

## Resultados

| Teste | Resultado |
|---|---|
| `e2e/emulators-smoke.mjs`: cadastro (validação por Cloud Function), conta no Auth emulado e perfil no Firestore **nomeado**, login em contexto limpo, criar post, post no feed após recarregar, comentar, responder ao comentário | **Passou** (12 etapas) |
| Mesmo E2E: o navegador só contatou `127.0.0.1` e `localhost` (nada do Google/Firebase real) | **Passou** |
| Servidor Next durante o E2E: 0 linhas de tráfego para o Firebase real | **Passou** |
| Cloud Functions nos emuladores durante o E2E: `checkAvailability` ×4, `createUserProfile` ×2, `onPostCreated` ×1, `onCommentCreated` ×2, `onUserUpdated` ×1; 0 erros e 0 avisos; revalidação do Next local com `{"revalidated":true}` | **Passou** |
| `e2e/emulators-failure.mjs`: emuladores parados, o app mostra a faixa vermelha, registra `console.error` claro e o login falha sem alcançar a nuvem real | **Passou** |
| Trava de projeto: `NEXT_PUBLIC_USE_EMULATORS=true` com `projectId` diferente de `demo-*` recusa subir (`Error: [emuladores] ... exige ... "demo-"`) | **Passou** (verificação manual no log do servidor) |
| Isolamento de credenciais: sem isolamento a ADC é detectada (exit 10); com `APPDATA` redirecionado não (exit 0); o iniciador aborta se a ADC for alcançável; o aviso de ADC do `firebase-tools` não aparece | **Passou** |

### Firestore nomeado (`echo-db-124325`) nos emuladores

- Dados isolados do `(default)`: documentos criados em cada banco aparecem só nele.
- **As regras valem nos dois bancos**: post público é lido sem login (200); coleção não prevista é negada (403).
- Gatilho `onPostCreated` (declarado com `database: DATABASE_ID`): +1 execução ao criar post no banco nomeado e +0 ao criar
  no `(default)`.
- `firebase.json` com `firestore` em lista (um item por banco) faz o emulador **descartar as regras** ("allowing all reads
  and writes"); por isso `firebase.emulators.json` usa o formato de objeto.

### Domínio, Android e interface

| Teste | Resultado |
|---|---|
| Redirecionamento `www`: 308 para o domínio principal preservando caminho e consulta | Passou |
| `X-Forwarded-Host` e `Forwarded` forjados, hosts parecidos e tentativas de open redirect não redirecionam para fora | Passou |
| `robots.txt` dinâmico (29 `Disallow`, sem `Host:`, `Sitemap` do domínio oficial) | Passou |
| Metadados do build de produção sem `NEXT_PUBLIC_BASE_URL` (og:url, og:image, JSON-LD, sitemap) usam o domínio oficial | Passou |
| `npx cap config`: padrão `https://exercitodolula.app` com `allowNavigation` do host exato; 3 valores de desenvolvimento aceitos; 4 recusados (domínio antigo, host parecido, subdomínio falso, `ftp:`) | Passou |
| Contatos por e-mail, no DOM renderizado: desligado sem nenhum `mailto:` e com texto "em breve" (pt-BR e en); ligado com os endereços do novo domínio | Passou |
| `/download`: Android mostra "em breve" sem buscar o `latest.json` nem links `.apk`; banner de instalação some no Android e continua no iPhone; `/downloads/latest.json` responde 404 | Passou |
| `npm run check:domain`: árvore limpa, reaparecimento do domínio antigo, id `com.soberan.app` e divergência nas Functions | Passou (4 cenários) |
| Comportamento dos componentes de hooks corrigidos (comentar e responder, com `EmbeddedPostCard` dentro do diálogo) | Passou |

### Verificações estáticas

Functions: `lint` e `build` sem erros. `npm run typecheck`: 227 erros (baseline em `docs/divida-tecnica.md`, sem erro novo em
nenhum commit). Lint: 733 → 726 erros (6 de `rules-of-hooks`, mais 1). `next build`: passa (51 rotas), regenera os arquivos
do PWA e deixa a árvore do Git limpa.

## Achados durante os testes

1. **Isolamento de credenciais:** o primeiro `firebase emulators:start` avisou que a ADC do usuário estava acessível
   (`CLOUDSDK_CONFIG` não é respeitado pela biblioteca de autenticação do Google). Corrigido antes de qualquer tráfego de teste
   (`APPDATA`/`HOME` redirecionados e prova automática).
2. **Sonda de conectividade do SDK:** com o Firestore inalcançável, o SDK pede `https://www.google.com/images/cleardot.gif`
   (GIF de 1 pixel, sem dados do projeto). É a única requisição "real" tolerada, e só no teste negativo.
3. **Ping de sitemap:** nos emuladores, `onPostCreated` fazia requisições reais ao Google e ao Bing (404 e 410). Removido.
4. **Erro de página `PERMISSION_DENIED` (regra `update` na linha 149):** presença em `users/{uid}` negada pelas regras. Pré-existente;
   em `docs/divida-tecnica.md`.
5. **404 de assets:** `/favicon-16x16.png`, `/favicon-32x32.png`, `/profile.png`. Pré-existente; etapa da logo.
6. **PWA:** o service worker não instalava nem era registrado, o manifest ia para o `<body>` e o cache padrão guardava dados
   do Firestore/Storage. Corrigido e validado em build de produção: veja `docs/pwa.md`.
