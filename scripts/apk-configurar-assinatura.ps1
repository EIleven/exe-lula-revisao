# scripts/apk-configurar-assinatura.ps1
# Guarda, UMA vez, os dados de assinatura do app Android para o scripts/apk-lancar.ps1 assinar sem o Android Studio.
# A senha e digitada aqui, sem aparecer na tela, conferida contra a keystore e gravada criptografada pelo proprio Windows
# (DPAPI): so este usuario, neste computador, consegue usa-la. Nada vai para o Git, para logs nem para conversas.
# O resultado de cada tentativa (sem senha) fica em assinatura.dpapi.log, ao lado do arquivo guardado.
#
# Uso (no seu terminal, porque pede a senha):  scripts\apk-configurar-assinatura.cmd
#   ou:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\apk-configurar-assinatura.ps1
# Para trocar a senha guardada, rode de novo. Para desfazer, apague o arquivo indicado no fim.
param(
  [string]$Keystore = 'E:\Soberan\keystores\soberan-keystore.jks',
  [string]$Segredo = 'E:\Soberan\keystores\assinatura.dpapi.xml',
  [string]$AliasPadrao = 'soberan_key' # o "Key alias" da tela do Android Studio (nao e segredo)
)
$ErrorActionPreference = 'Stop'
$log = [IO.Path]::ChangeExtension($Segredo, '.log')
function Registrar([string]$Texto) {
  Add-Content -Path $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Texto" -Encoding UTF8 -ErrorAction SilentlyContinue
}

try {
  Registrar 'inicio'
  if (-not (Test-Path $Keystore)) { throw "Keystore nao encontrada: $Keystore" }
  . (Join-Path $PSScriptRoot 'apk-ferramentas.ps1')

  Write-Host ''
  Write-Host 'Assinatura do app Exe. Lula (com.soberan.app)' -ForegroundColor Cyan
  Write-Host "Keystore: $Keystore"
  Write-Host 'Os dados sao os mesmos da tela "Generate Signed App Bundle or APK" do Android Studio.'
  Write-Host ''
  $alias = (Read-Host "Key alias (Enter = $AliasPadrao)").Trim()
  if (-not $alias) { $alias = $AliasPadrao }
  $senhaKeystore = Read-Host 'Key store password' -AsSecureString
  $senhaChave = Read-Host 'Key password (Enter = a mesma da keystore)' -AsSecureString
  if ($senhaChave.Length -eq 0) { $senhaChave = $senhaKeystore }

  $conferencia = Test-SenhaKeystore $Keystore $alias $senhaKeystore
  if ($conferencia.Codigo -ne 0) {
    $motivo = $conferencia.Saida | Where-Object { $_ -match 'error|erro|incorrect|does not exist' } | Select-Object -First 1
    throw "A keystore recusou a senha ou o alias '$alias' nao existe nela. $motivo"
  }

  [pscustomobject]@{ Alias = $alias; SenhaKeystore = $senhaKeystore; SenhaChave = $senhaChave } | Export-Clixml -Path $Segredo
  Registrar "ok: senha conferida e guardada em $Segredo"
  Write-Host ''
  Write-Host "Pronto. Senha conferida e guardada criptografada para o seu usuario do Windows em $Segredo" -ForegroundColor Green
  Write-Host 'A partir de agora: npm run apk:lancar -- -PublicarSite "o que mudou"'
} catch {
  Registrar "falhou: $($_.Exception.Message)"
  Write-Host ''
  Write-Host "Nao deu certo: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
