# App Android (Exe. Lula): build, assinatura, publicação e login com Google

Atualizado em 2026-10-24 (versão 1.2.1). O app é uma **casca do Capacitor** que abre `https://exercitodolula.app` (`server.url` em
`capacitor.config.ts`). Tudo que é tela ou texto do site muda no app **assim que o site é publicado**, sem novo APK. Só precisa
de APK novo quando muda algo **nativo**: nome ou ícone do app, splash, plugins, permissões, versão do Android alvo.

- Nome visível: **Exe. Lula** (`strings.xml`). O identificador `com.soberan.app` **não muda** (é o que permite atualizar por cima).
- O APK fica em `public/downloads/` e é oferecido em `/download` (flag `NEXT_PUBLIC_APK_DOWNLOAD_ENABLED=true` no `apphosting.yaml`).

## Gerar e publicar uma versão nova (automático)

1. Suba `versionCode` (e `versionName`) em `android/app/build.gradle`. Precisa ser maior que o publicado.
2. `npm run apk:lancar -- -PublicarSite "nota 1" "nota 2"`: copia a config do Capacitor, compila o release (Gradle 8.11.1),
   alinha, **assina com a keystore do projeto**, confere e publica no `/download` (o passo 4 abaixo) e faz o deploy do site.
   `-SemPublicar` só gera e assina (`android/app/build/outputs/apk/release/app-release.apk`), para testar antes.
3. Depois, commit de `public/downloads/` (o APK e o `latest.json`).

APK já assinado no Android Studio (caminho manual abaixo): `npm run apk:lancar -- -ApkPronto
android\app\release\app-release.apk -PublicarSite "nota"` faz só a conferência, a publicação no `/download` e o deploy.

**Configuração, uma vez por computador:** `scripts\apk-configurar-assinatura.cmd` (dois cliques ou no terminal). Pede o
alias (Enter aceita `soberan_key`) e as senhas da keystore `E:\Soberan\keystores\soberan-keystore.jks` (os mesmos da tela do Android Studio), confere contra
a keystore e grava em `E:\Soberan\keystores\assinatura.dpapi.xml`, **criptografado pelo Windows (DPAPI)**: só este usuário
neste computador consegue usar. A senha não passa por linha de comando, tela, log ou Git (o `apksigner` a lê de uma variável de
ambiente só durante a assinatura). Para trocar a senha, rode de novo; para desligar a automação, apague o `.xml`. O risco é o
mesmo do Android Studio "lembrar a senha": quem usar esta conta do Windows consegue assinar. Guarde uma cópia da keystore e da
senha fora deste computador: sem elas não há como atualizar o app já instalado nos celulares.

### Pelo Android Studio (manual)

1. `npx cap sync android`, se mudou o `capacitor.config.ts`.
2. File > Sync Project with Gradle Files.
3. **Build > Generate Signed App Bundle / APK > APK > release**, com a mesma keystore. O resultado sai em
   `android/app/release/app-release.apk`.
4. `npm run apk:publicar -- android/app/release/app-release.apk "nota 1" "nota 2"`. O comando **recusa** o arquivo se o pacote
   não for `com.soberan.app`, se a assinatura não bater com a chave do projeto (SHA-256 do certificado
   `87d26afdfca967382d74c13dc1de13b342a427435576567593efb6fd68119c7a`) ou se o `versionCode` não subiu. Ele copia o APK para
   `public/downloads/`, apaga o anterior e grava `latest.json` com o SHA-256 real.
5. Publique o site: `firebase deploy --only apphosting:studio --project echo-b5aw9` (o `.gitignore` tem a exceção
   `!public/downloads/*.apk`, senão o APK não iria no envio).

Conferir antes de assinar, sem a senha: `aapt2 dump badging` (pacote, versão, nome) e `apksigner verify --print-certs`.

### Gradle: não use o `./gradlew` do projeto
O wrapper foi atualizado fora do Git para o Gradle 9.7.1, que **não combina** com o plugin do Android 8.7.2. Para compilar sem
assinatura (conferência), use o Gradle 8.11.1 do cache, apontando a saída para fora do projeto (o Android Studio aberto trava
arquivos de `app/build`):
`gradle-8.11.1\bin\gradle.bat --no-daemon --init-script E:\Soberan\tools\gradle-init-build-isolado.gradle assembleRelease`
(saída em `E:\Soberan\tools\apk-build\_app\outputs\apk\release\`). No Studio, use Settings > Build Tools > Gradle > Specified
location apontando para o mesmo 8.11.1.

## Notificações (push) e vibração no app (versão 1.3.0)

Plugins nativos novos, então **precisa de APK novo** (o site sozinho não basta): `@capacitor/push-notifications` (avisos),
`@capacitor/haptics` (vibração) e `@capacitor/app` (reservado para o botão voltar). O que o APK ganha, e onde está:

- **Permissão** `POST_NOTIFICATIONS` no `AndroidManifest.xml` (Android 13+ só pergunta se ela estiver declarada).
- **Ícone e cor do aviso:** `res/drawable-*/ic_stat_notify.png` (silhueta branca da lula, gerada por
  `MARCA_SO=notificacao npm run marca:gerar`, que **não** reescreve os outros ativos) e `res/values/notificacao.xml`
  (`#D61F26`); o manifesto aponta para eles em `com.google.firebase.messaging.default_notification_icon/color`.
- **Canal** `exelula_default` (criado pelo app em `pushNotificationService.ts`; o servidor manda o mesmo id) e canal padrão no
  manifesto, para o aviso nunca cair no canal genérico do FCM.
- O toque num aviso abre o destino certo (`PushBridge`): post, comentário (`#comment-id`), perfil ou conversa.
- **APK antigo (até a 1.2.1):** a tela de notificações funciona; ligar o push mostra um erro claro (o plugin não existe) e a
  vibração cai na Vibration API do WebView. Nada quebra.

Depois do `cap sync` o Android enxerga os 5 plugins (`npx cap sync android`; **não** use `npm run android:sync`: o `mkdir -p`
do cmd cria uma pasta chamada `-p` na raiz). Texto e destino dos avisos: `docs/notificacoes-e-vibracao.md`.

## Login com Google no app

O popup do Firebase (`signInWithPopup`) **não funciona dentro do WebView**: o Google bloqueia OAuth em WebView e o `window.open`
é cancelado (`auth/cancelled-popup-request`). No app o login usa o seletor de contas **nativo**:

- `src/lib/services/googleSignIn.ts`: no app (`isNativeApp()`, de `src/lib/nativeApp.ts`) chama
  `@capacitor-firebase/authentication` (config `skipNativeAuth: true` em `capacitor.config.ts`), pega o `idToken` e entra com
  `signInWithCredential`. No navegador continua o popup.
- `android/variables.gradle` precisa de `rgcfaIncludeGoogle = true` (senão o Google Sign-In nativo fica fora do APK).
- O app Android está registrado no Firebase: `1:710006061811:android:7da908bfd14f59fe379586` (`com.soberan.app`), com o SHA-1
  `26fc864aaa1d00a8afc1dd1e6a91b5a525567070` e o SHA-256 acima. Isso cria o cliente OAuth do Android.
- `android/app/google-services.json` **não vai para o Git**. Para refazer: console do Firebase > Configurações do projeto >
  app Android, ou REST `GET firebase.googleapis.com/v1beta1/projects/echo-b5aw9/androidApps/<appId>/config` (base64).
- Erro `DEVELOPER_ERROR` (código 10) = o APK foi assinado com uma chave cujo SHA-1 não está cadastrado. APK de depuração
  (chave debug) também cai aqui; só o APK assinado com a keystore do projeto faz o login.

## Marca (logo, ícones, splash, imagem de compartilhamento)

`npm run marca:gerar` refaz tudo a partir de **um** desenho (`scripts/gerar-marca.mjs`): `public/brand/*.svg`, favicon,
`apple-touch-icon`, ícones do PWA (`/icons`), `exe-lula-og.png` e os recursos do Android. Precisa do Chrome e do
`playwright-core` (`E2E_NODE_MODULES`, `E2E_BROWSER`). Depois: `npx cap sync android` e um APK novo.

- **Ícone adaptativo (Android 8+)**: três camadas de 108dp em `mipmap-*` (`ic_launcher_background` com o brilho vermelho,
  `ic_launcher_foreground` com a lula e `ic_launcher_monochrome` para os ícones temáticos do Android 13+). Cada launcher recorta
  num formato (círculo, squircle da Samsung, gota...) e só os 66dp do centro aparecem em todos: a lula fica num raio de ~26dp.
- O gerador **mede** a lula em cada ícone e se recusa a gravar o que passar da zona segura (adaptativo, maskable do PWA, ícones
  antigos e o da abertura). Até a 1.1.0 o app saiu com o ícone **padrão do Capacitor** (o "X" azul); a 1.2.0 tinha a lula
  encostando na borda do círculo.
- **Abertura**: `windowSplashScreenBackground` + `windowSplashScreenAnimatedIcon` (`drawable-*/splash_icone.png`, 288dp, dentro
  do círculo de 192dp que o Android 12+ mostra). Não há mais imagem de tela inteira (ela era esticada e deformava).

## Barras do sistema, abertura e teclado (`MainActivity.java`)

Com `targetSdk 35`, o Android 15 desenha o app por baixo da barra de status e da barra de gestos, e o Capacitor 6 não compensa:
o relógio cobria o cabeçalho do site e a barra de gestos a navegação de baixo. A `MainActivity`:

- dá ao conteúdo o espaço das barras, do recorte da câmera e do teclado como margem (`windowSoftInputMode="adjustResize"` no
  manifesto), com as barras na cor da marca e ícones claros, igual em todas as versões do Android;
- chama `installSplashScreen()` (sem isso, no Android 11 e anteriores a abertura era só a cor de fundo) e mantém a abertura até o
  site carregar, no máximo 4 s;
- o WebView usa `backgroundColor` do `capacitor.config.ts` (a cor da marca) enquanto carrega.

Ao atualizar o Capacitor para a 7 ou superior, confira se ele passou a tratar as barras (opção `adjustMarginsForEdgeToEdge`)
para não reservar o espaço duas vezes.

## Testar no emulador (sem celular)

AVD `Medium_Phone_API_35` (Android 15, Google Play). Feche os emuladores do Firebase e o `next start` antes: o emulador precisa de
~2 GB de memória "commit" livre. Para o teste local assine com a chave de depuração (`~/.android/debug.keystore`, senha
`android`), `adb install -r`, `adb shell am start -n com.soberan.app/.MainActivity`, `adb shell screencap -p` + `adb pull`
(não redirecione binário pelo PowerShell). O login com Google **não** completa no emulador com chave de depuração.
