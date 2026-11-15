# Arquivo: metadados do APK antigo (v1.0.0)

`apk-1.0.0-latest.json` descrevia o APK `Soberan-v1.0.0.apk`, que carrega a URL do domínio antigo num WebView.
Esse domínio não é mais controlado pelo projeto, então **o APK antigo não deve ser distribuído nem apresentado como seguro**.

O arquivo foi retirado de `public/downloads/` (que é servido pelo site) e mantido aqui apenas como registro histórico.
Um novo `public/downloads/latest.json` só deve existir quando houver um APK novo, assinado com a keystore do projeto e
validado no domínio definitivo; nesse momento, ligue `NEXT_PUBLIC_APK_DOWNLOAD_ENABLED=true`.