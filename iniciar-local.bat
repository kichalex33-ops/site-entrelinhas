@echo off
chcp 65001 >nul
title Entrelinhas - servidor local (feche esta janela para parar)
cd /d "%~dp0"

echo.
echo  Entrelinhas - servidor local
echo  ------------------------------------------
echo  Roda so neste computador. Nao mexe no site real.

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O Node.js nao esta instalado. Tentando instalar com o winget...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  if errorlevel 1 goto semnode
  set "PATH=%PATH%;%ProgramFiles%\nodejs"
  where node >nul 2>nul
  if errorlevel 1 goto semnode
)

node scripts\iniciar-local.mjs
echo.
echo  Servidor encerrado.
pause
exit /b

:semnode
echo.
echo  Nao foi possivel instalar o Node.js automaticamente.
echo  Baixe e instale a versao LTS em https://nodejs.org e abra este arquivo de novo.
start "" https://nodejs.org/
pause
