#!/usr/bin/env bash
# Carga inicial do catálogo do HML (IMONITOR-1619): registra nos manifestos do bucket
# fractal-portal-apps-hml os APKs que já existem no bucket artefatos-mobile, só por link (--url).
# Nenhum APK é copiado. Versões lidas do AndroidManifest.xml de cada APK em 22/09/2026.
#
# Regras de acesso conforme o levantamento "levantamento_login_portal_apks.docx".
# Builds de homologação/staging só aparecem para Master (regra do portal).
#
# Uso: AWS_PROFILE=i-monitor ./deploy/hml/catalogo-inicial.sh
set -euo pipefail

export AWS_REGION="${AWS_REGION:-sa-east-1}"
export STORAGE_DRIVER=s3
export S3_BUCKET=fractal-portal-apps-hml
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLI="node ${ROOT}/tools/manifest-cli/index.mjs"
ORIGEM="https://artefatos-mobile.s3.sa-east-1.amazonaws.com"

npm --prefix "${ROOT}/tools/manifest-cli" ci --omit=dev --no-audit --no-fund >/dev/null

# publica <sistema> <app-id> "<nome>" "<descrição>" <versão> <build> <ambiente> <arquivo no artefatos-mobile>
publica() {
  ${CLI} publish --system "$1" --app-id "$2" --app-name "$3" --description "$4" \
    --version "$5" --build "$6" --environment "$7" --url "${ORIGEM}/$8" \
    --created-by "carga-inicial:IMONITOR-1619" \
    --release-notes "Carga inicial: APK existente em artefatos-mobile/$8"
}

# ---- Containers Exportação
publica containers-exportacao imonitor "I-monitor" "Estufagem, lacração e leituras do anel" 1.13.26 119 prod imonitor.apk
publica containers-exportacao imonitor "I-monitor" "Estufagem, lacração e leituras do anel" 1.13.29-hml 119 hml app-homolog-release.apk
publica containers-exportacao imonitor "I-monitor" "Estufagem, lacração e leituras do anel" 1.13.26-staging 119 staging app-imonitor-staging-release.apk

publica containers-exportacao imonitor-costado "I-monitor Costado" "Leitura de costado" 1.13.10 120 prod app-costado-release.apk
publica containers-exportacao imonitor-costado "I-monitor Costado" "Leitura de costado" 1.13.10-costadoHml 120 hml app-costadohml-release.apk
publica containers-exportacao imonitor-costado "I-monitor Costado" "Leitura de costado" 1.13.9-costadoStaging 121 staging app-costadostaging-release.apk

publica containers-exportacao carga-solta "Carga Solta" "Conferência de carga solta" 1.13.5 119 prod carga-solta.apk
publica containers-exportacao carga-solta "Carga Solta" "Conferência de carga solta" 1.13.21-csHml 119 hml app-cshml-release.apk

# ---- Containers Importação (backend e banco próprios; ainda sem APK de produção)
publica containers-importacao imonitor-importacao "I-monitor Importação" "Anel de importação" 1.13.18-hml 119 hml imonitor-importacao-homolog.apk
publica containers-importacao imonitor-importacao "I-monitor Importação" "Anel de importação" 1.13.18-staging 119 staging imonitor-importacao-staging.apk

# ---- DTA (ainda sem APK de produção no artefatos-mobile)
publica dta imonitor-dta "I-monitor DTA" "Lacração e liberação de DTA" 1.13.27-hml 119 hml app-homologation-release.apk
publica dta imonitor-dta "I-monitor DTA" "Lacração e liberação de DTA" 1.13.27-stg 119 staging app-staging-release.apk

# ---- Regras de acesso (Master sempre vê tudo)
${CLI} set-access --system containers-exportacao --app-id imonitor --roles Operator --operator-types redex,carrier,stuffer
${CLI} set-access --system containers-exportacao --app-id carga-solta --roles Operator --operator-types redex,carrier,stuffer,security
# Levantamento pede operator/costado, mas esse operator_type não existe nos backends: por ora só Master vê.
${CLI} set-access --system containers-exportacao --app-id imonitor-costado --roles Operator --operator-types costado
${CLI} set-access --system dta --app-id imonitor-dta --roles Operator --operator-types conferente,segurancaDestino

for sistema in containers-exportacao containers-importacao dta; do ${CLI} show --system "${sistema}" >/dev/null; done
echo "Catálogo inicial publicado em s3://${S3_BUCKET}"
