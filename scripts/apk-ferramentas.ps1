# scripts/apk-ferramentas.ps1
# Funcoes comuns de apk-configurar-assinatura.ps1 e apk-lancar.ps1: onde estao o JDK, as ferramentas do Android SDK e o
# Gradle que combina com o projeto, e a leitura da senha guardada (so na memoria, so na hora de usar).

function Find-Jdk {
  $candidatos = @(
    $env:JAVA_HOME,
    'E:\Arquivos de Programas\Android\Android Studio\jbr',
    (Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Android Studio\jbr')
  ) | Where-Object { $_ -and (Test-Path (Join-Path $_ 'bin\java.exe')) }
  if (-not $candidatos) { throw 'JDK nao encontrado: defina JAVA_HOME (o "jbr" do Android Studio serve).' }
  return @($candidatos)[0]
}

function Find-BuildTools([string]$Root) {
  $props = Get-Content (Join-Path $Root 'android\local.properties') -Raw
  $sdk = ([regex]::Match($props, '(?m)^sdk\.dir=(.*)$').Groups[1].Value -replace '\\\\', '\' -replace '\\:', ':').Trim()
  if (-not $sdk) { throw 'sdk.dir nao encontrado em android\local.properties' }
  $dir = Get-ChildItem (Join-Path $sdk 'build-tools') -Directory |
    Sort-Object { [version]($_.Name -replace '-.*$', '') } | Select-Object -Last 1
  if (-not $dir) { throw "Nenhum build-tools em $sdk" }
  return $dir.FullName
}

# O wrapper do projeto foi trocado (fora do Git) para o Gradle 9.7.1, que nao combina com o plugin do Android 8.7.2.
function Find-Gradle {
  $g = Get-ChildItem (Join-Path $env:USERPROFILE '.gradle\wrapper\dists\gradle-8.11.1-*\*\gradle-8.11.1\bin\gradle.bat') -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $g) { throw 'Gradle 8.11.1 nao encontrado em ~\.gradle\wrapper\dists (abra o projeto uma vez no Android Studio).' }
  return $g.FullName
}

# Roda um programa e devolve o codigo de saida e a saida (stdout e stderr juntos). No Windows PowerShell 5.1, com
# $ErrorActionPreference = 'Stop', qualquer linha no stderr de um programa redirecionado (2>&1) aborta o script, e o keytool
# escreve no stderr um aviso sobre keystores no formato JKS mesmo com a senha certa: aqui quem decide e o codigo de saida.
function Invoke-Nativo([string]$Exe, [string[]]$Argumentos) {
  $anterior = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $saida = & $Exe @Argumentos 2>&1 | ForEach-Object { "$_" }
    $codigo = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $anterior
  }
  return [pscustomobject]@{ Codigo = $codigo; Saida = @($saida) }
}

# Confere se a senha abre a keystore e se o alias existe nela (o keytool le a senha de uma variavel de ambiente, nunca da
# linha de comando). Devolve o resultado do keytool: Codigo 0 = conferido.
function Test-SenhaKeystore([string]$Keystore, [string]$Alias, [Security.SecureString]$Senha) {
  $keytool = Join-Path (Find-Jdk) 'bin\keytool.exe'
  try {
    $env:EXELULA_KS_PASS = ConvertFrom-Segredo $Senha
    return Invoke-Nativo $keytool @('-list', '-keystore', $Keystore, '-alias', $Alias, '-storepass:env', 'EXELULA_KS_PASS')
  } finally {
    Remove-Item Env:EXELULA_KS_PASS -ErrorAction SilentlyContinue
  }
}

function ConvertFrom-Segredo([Security.SecureString]$Valor) {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Valor)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
