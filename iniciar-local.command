#!/bin/sh
# Entrelinhas - servidor local (Mac/Linux). Roda so neste computador; nao mexe no site real.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "O Node.js nao esta instalado. Instale a versao LTS em https://nodejs.org e rode de novo."
  exit 1
fi
exec node scripts/iniciar-local.mjs
