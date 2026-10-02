@echo off
chcp 65001 >nul
title Entrelinhas - servidor local (feche esta janela para parar)
cd /d "%~dp0"

echo.
echo  Entrelinhas - servidor local
echo  ------------------------------------------
echo  Preparando o banco local (so o seu computador, nao mexe no site real)...
echo y | call npx --yes wrangler@latest d1 migrations apply entrelinhas-db --local
echo.
echo  Abrindo o navegador em http://localhost:8799 em alguns segundos.
echo  Paginas: /  /autores.html  /conta.html  /chat.html
echo  Para parar: feche esta janela ou aperte Ctrl+C.
echo.
start "" cmd /c "timeout /t 15 /nobreak >nul & start http://localhost:8799/"
call npx --yes wrangler@latest dev --local --port 8799
echo.
echo  Servidor encerrado.
pause
