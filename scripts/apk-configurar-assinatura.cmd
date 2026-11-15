@echo off
rem Guarda a senha de assinatura do app, uma vez (pode dar dois cliques neste arquivo). Detalhes no .ps1 de mesmo nome.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apk-configurar-assinatura.ps1" %*
echo.
pause
