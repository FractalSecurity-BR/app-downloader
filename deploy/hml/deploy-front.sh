#!/usr/bin/env bash
# Build do front e deploy manual (zip) no app Amplify portal-apps-front-hml, branch develop.
# O app não está ligado ao GitHub (ligar exige admin do repositório); quando for ligado,
# o build spec equivalente está em deploy/hml/amplify-buildspec.yml.
#
# Uso: AWS_PROFILE=i-monitor ./deploy/hml/deploy-front.sh
set -euo pipefail

export AWS_REGION="${AWS_REGION:-sa-east-1}"
export AWS_PAGER=""
FRONT_APP_NAME=portal-apps-front-hml
FRONT_BRANCH=develop
API_NAME=portal-apps-api-hml-api
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

APP_ID=$(aws amplify list-apps --query "apps[?name=='${FRONT_APP_NAME}'].appId | [0]" --output text)
API_ID=$(aws apigatewayv2 get-apis --query "Items[?Name=='${API_NAME}'].ApiId | [0]" --output text)
if [ "${APP_ID}" = "None" ] || [ "${API_ID}" = "None" ]; then
  echo "Infra não encontrada. Rode antes: ./deploy/hml/infra.sh" >&2
  exit 1
fi
export VITE_API_URL="https://${API_ID}.execute-api.${AWS_REGION}.amazonaws.com/hml"

echo "Build do front com VITE_API_URL=${VITE_API_URL}"
npm --prefix "${ROOT}/web" ci --no-audit --no-fund
npm --prefix "${ROOT}/web" run build

ZIP="$(mktemp -d)/front.zip"
(cd "${ROOT}/web/dist" && zip -qr "${ZIP}" .)

read -r JOB_ID UPLOAD_URL < <(aws amplify create-deployment --app-id "${APP_ID}" --branch-name "${FRONT_BRANCH}" \
  --query '[jobId, zipUploadUrl]' --output text)
curl -sf -X PUT -H 'Content-Type: application/zip' --upload-file "${ZIP}" "${UPLOAD_URL}"
aws amplify start-deployment --app-id "${APP_ID}" --branch-name "${FRONT_BRANCH}" --job-id "${JOB_ID}" >/dev/null

for _ in $(seq 1 60); do
  STATUS=$(aws amplify get-job --app-id "${APP_ID}" --branch-name "${FRONT_BRANCH}" --job-id "${JOB_ID}" --query job.summary.status --output text)
  case "${STATUS}" in
    SUCCEED) echo "Front publicado: https://${FRONT_BRANCH}.${APP_ID}.amplifyapp.com"; exit 0 ;;
    FAILED|CANCELLED) echo "Deploy do front terminou com ${STATUS}" >&2; exit 1 ;;
  esac
  sleep 5
done
echo "Deploy ainda em andamento (job ${JOB_ID})." >&2
exit 1
