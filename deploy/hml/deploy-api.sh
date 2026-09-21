#!/usr/bin/env bash
# Build da imagem da API, push no ECR e atualização da Lambda portal-apps-api-hml.
# Mesmo fluxo do deploy_hml.yml dos backends do i-monitor (e do .github/workflows/deploy_hml.yml deste repo).
#
# Uso: AWS_PROFILE=i-monitor ./deploy/hml/deploy-api.sh [--push-only]
set -euo pipefail

export AWS_REGION="${AWS_REGION:-sa-east-1}"
export AWS_PAGER=""
NAME=portal-apps-api-hml
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
IMAGE_URI="${REGISTRY}/${NAME}:latest"

aws ecr get-login-password | docker login --username AWS --password-stdin "${REGISTRY}"
# --provenance=false: a Lambda não aceita o manifest list que o buildx gera por padrão.
docker build --platform linux/amd64 --provenance=false -f "${ROOT}/Dockerfile.lambda" -t "${IMAGE_URI}" "${ROOT}"
docker push "${IMAGE_URI}"

if [ "${1:-}" = "--push-only" ]; then exit 0; fi

aws lambda update-function-code --function-name "${NAME}" --image-uri "${IMAGE_URI}" >/dev/null
aws lambda wait function-updated-v2 --function-name "${NAME}"
echo "Lambda ${NAME} atualizada."
