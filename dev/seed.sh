#!/usr/bin/env bash
# Popula dev-storage/ com APKs falsos e manifestos, usando o mesmo CLI do GitHub Actions.
set -euo pipefail
cd "$(dirname "$0")/.."
export STORAGE_DRIVER=local LOCAL_STORAGE_DIR=./dev-storage
CLI="node tools/manifest-cli/index.mjs"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
rm -rf dev-storage

pub() { # sistema app-id "Nome" versão build ambiente "notas" [descrição]
  # SEED_APK_BYTES fixa o tamanho (a imagem da Lambda usa APKs pequenos: resposta limitada a 6 MB)
  head -c "${SEED_APK_BYTES:-$((RANDOM * 400 + 2000000))}" /dev/urandom > "$TMP/$2-$4.apk"
  $CLI publish --system "$1" --app-id "$2" --app-name "$3" --version "$4" --build "$5" \
    --environment "$6" --file "$TMP/$2-$4.apk" --release-notes "$7" --description "${8:-}" --created-by dev-seed >/dev/null
}

pub containers-exportacao imonitor "I-monitor" 2.7.0 270 hml "Versão estável anterior" "Estufagem, lacração e leituras do anel"
$CLI promote --system containers-exportacao --app-id imonitor --version 2.7.0 --environment prod >/dev/null
pub containers-exportacao imonitor "I-monitor" 2.8.1 281 hml "Correção na leitura de lacres RFID
Melhoria no envio de fotos em conexões lentas"
$CLI promote --system containers-exportacao --app-id imonitor --version 2.8.1 --environment prod >/dev/null
pub containers-exportacao imonitor "I-monitor" 2.9.0 290 hml "Nova tela de pulmão (em teste)"
pub containers-exportacao imonitor-costado "I-monitor Costado" 1.4.0 140 hml "Leitura de costado com confirmação por foto" "Leitura de costado no terminal"
$CLI promote --system containers-exportacao --app-id imonitor-costado --version 1.4.0 --environment prod >/dev/null
$CLI set-access --system containers-exportacao --app-id imonitor-costado --operator-types inspector >/dev/null
pub containers-exportacao carga-solta "Carga Solta" 1.1.2 112 hml "Ajuste no cadastro de volumes" "Conferência de carga solta"
$CLI promote --system containers-exportacao --app-id carga-solta --version 1.1.2 --environment prod >/dev/null
pub dta imonitor-dta "I-monitor DTA" 1.2.0 120 hml "Integração com a lacração do DTA" "Lacração e liberação de DTA"
$CLI promote --system dta --app-id imonitor-dta --version 1.2.0 --environment prod >/dev/null

echo "dev-storage populado:"; find dev-storage -name manifest.json
