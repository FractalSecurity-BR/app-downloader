#!/usr/bin/env bash
# Cria (ou confere) a infraestrutura de um ambiente do Portal de Aplicativos — IMONITOR-1619.
# Padrão: HML. Com ENV_NAME=prod cria os recursos portal-apps-*-prod e NÃO cria front: em
# produção o front é o Amplify app-downloader (imonitor-download.fractal-security.com), já existente.
#
# Mesmo desenho dos backends do i-monitor (i-monitor-back / i-monitor-dta-back):
#   ECR  →  Lambda em container (x86_64, 512 MB)  →  API Gateway HTTP, payload 1.0, stage "hml"
# e o front num app Amplify próprio (deploy manual, link *.amplifyapp.com).
#
# Seguro para rodar de novo: só cria o que não existe e só atualiza recursos com o prefixo
# portal-apps-*-<ambiente>. Não toca em nenhum recurso de outra aplicação.
#
# Uso: AWS_PROFILE=i-monitor ./deploy/hml/infra.sh
#      AWS_PROFILE=i-monitor ENV_NAME=prod ./deploy/hml/infra.sh
set -euo pipefail

export AWS_REGION="${AWS_REGION:-sa-east-1}"
export AWS_PAGER=""
ENV_NAME="${ENV_NAME:-hml}"
case "${ENV_NAME}" in
  hml)  SYSTEMS_CONFIG_PATH=config/systems.hml.json; HML_WEB_URL=https://imonitor-download-hml.fractal-security.com ;;
  prod) SYSTEMS_CONFIG_PATH=config/systems.json; PROD_WEB_URL=https://imonitor-download.fractal-security.com ;;
  *) echo "ENV_NAME inválido: ${ENV_NAME} (use hml ou prod)" >&2; exit 1 ;;
esac
NAME="portal-apps-api-${ENV_NAME}"          # repositório ECR e função Lambda
ROLE_NAME="${NAME}-role"
API_NAME="${NAME}-api"
FRONT_APP_NAME="portal-apps-front-${ENV_NAME}"
FRONT_BRANCH=develop
BUCKET="fractal-portal-apps-${ENV_NAME}"   # APKs + manifestos (privado)
TAGS_KV="Project=portal-apps,Environment=${ENV_NAME},Task=IMONITOR-1619,ManagedBy=deploy/hml/infra.sh"
TAGS_JSON='{"Project":"portal-apps","Environment":"'"${ENV_NAME}"'","Task":"IMONITOR-1619","ManagedBy":"deploy/hml/infra.sh"}'

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
IMAGE_URI="${REGISTRY}/${NAME}:latest"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${HERE}/../.." && pwd)"

log() { printf '\n==> %s\n' "$*"; }

# ---------------------------------------------------------------- ECR
log "ECR: ${NAME}"
if ! aws ecr describe-repositories --repository-names "${NAME}" >/dev/null 2>&1; then
  aws ecr create-repository --repository-name "${NAME}" --image-scanning-configuration scanOnPush=true \
    --tags "Key=Project,Value=portal-apps" "Key=Environment,Value=${ENV_NAME}" "Key=Task,Value=IMONITOR-1619" >/dev/null
  echo "criado"
else
  echo "já existe"
fi

# Custo: cada deploy deixa a imagem anterior sem tag; remove depois de 1 dia.
aws ecr put-lifecycle-policy --repository-name "${NAME}" --lifecycle-policy-text \
  '{"rules":[{"rulePriority":1,"description":"remove imagens sem tag (deploys antigos) apos 1 dia","selection":{"tagStatus":"untagged","countType":"sinceImagePushed","countUnit":"days","countNumber":1},"action":{"type":"expire"}}]}' >/dev/null

# ---------------------------------------------------------------- Imagem
if ! aws ecr describe-images --repository-name "${NAME}" --image-ids imageTag=latest >/dev/null 2>&1; then
  log "Primeira imagem (a Lambda em container precisa de uma imagem para ser criada)"
  ENV_NAME="${ENV_NAME}" "${HERE}/deploy-api.sh" --push-only
fi

# ---------------------------------------------------------------- IAM role
log "IAM role: ${ROLE_NAME}"
if ! aws iam get-role --role-name "${ROLE_NAME}" >/dev/null 2>&1; then
  aws iam create-role --role-name "${ROLE_NAME}" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
    --tags "Key=Project,Value=portal-apps" "Key=Environment,Value=${ENV_NAME}" "Key=Task,Value=IMONITOR-1619" >/dev/null
  # Só logs no CloudWatch. Sem S3 nesta etapa (STORAGE_DRIVER=local).
  aws iam attach-role-policy --role-name "${ROLE_NAME}" --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo "criada; aguardando propagação do IAM"
  sleep 12
else
  echo "já existe"
fi
# Leitura só neste bucket. ListBucket faz manifesto inexistente voltar 404 (e não 403).
aws iam put-role-policy --role-name "${ROLE_NAME}" --policy-name "${NAME}-s3-read" --policy-document '{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow", "Action": "s3:GetObject", "Resource": "arn:aws:s3:::'"${BUCKET}"'/*"},
    {"Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::'"${BUCKET}"'"}
  ]}'
ROLE_ARN=$(aws iam get-role --role-name "${ROLE_NAME}" --query Role.Arn --output text)

# ---------------------------------------------------------------- Bucket S3 (APKs e manifestos)
# Custo baixo de propósito: S3 Standard, criptografia SSE-S3 (grátis; KMS cobra por requisição),
# sem CloudFront, replicação, logs de acesso ou Object Lock. Versionamento para proteger o
# manifest.json (APKs nunca são sobrescritos); versões antigas são mantidas (sem expiração).
log "S3: ${BUCKET}"
if ! aws s3api head-bucket --bucket "${BUCKET}" >/dev/null 2>&1; then
  aws s3api create-bucket --bucket "${BUCKET}" --create-bucket-configuration "LocationConstraint=${AWS_REGION}" \
    --object-ownership BucketOwnerEnforced >/dev/null
  echo "criado"
else
  echo "já existe"
fi
aws s3api put-public-access-block --bucket "${BUCKET}" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "${BUCKET}" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
aws s3api put-bucket-versioning --bucket "${BUCKET}" --versioning-configuration Status=Enabled
aws s3api put-bucket-lifecycle-configuration --bucket "${BUCKET}" --lifecycle-configuration '{
  "Rules": [
    {"ID": "limpa-uploads-incompletos-1d", "Status": "Enabled", "Filter": {},
     "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 1}}
  ]}'
aws s3api put-bucket-policy --bucket "${BUCKET}" --policy '{
  "Version": "2012-10-17",
  "Statement": [{"Sid": "SomenteHTTPS", "Effect": "Deny", "Principal": "*", "Action": "s3:*",
    "Resource": ["arn:aws:s3:::'"${BUCKET}"'", "arn:aws:s3:::'"${BUCKET}"'/*"],
    "Condition": {"Bool": {"aws:SecureTransport": "false"}}}]}'
aws s3api put-bucket-tagging --bucket "${BUCKET}" \
  --tagging "TagSet=[{Key=Project,Value=portal-apps},{Key=Environment,Value=${ENV_NAME}},{Key=Task,Value=IMONITOR-1619}]"
echo "privado, SSE-S3, versionado, só HTTPS"

# ---------------------------------------------------------------- Logs
log "CloudWatch Logs (retenção 14 dias, igual aos backends)"
for group in "/aws/lambda/${NAME}" "/aws/apigateway/${API_NAME}"; do
  aws logs create-log-group --log-group-name "${group}" --tags "${TAGS_JSON}" 2>/dev/null && echo "criado ${group}" || echo "já existe ${group}"
  aws logs put-retention-policy --log-group-name "${group}" --retention-in-days 14
done

# ---------------------------------------------------------------- Amplify (front)
if [ "${ENV_NAME}" = prod ]; then
  log "Amplify: produção usa o app app-downloader existente (não é criado aqui)"
  FRONT_APP_ID=d1o4nquc9ym1gk
  WEB_URL="${PROD_WEB_URL}"
  CORS_ORIGINS="${WEB_URL}"
else
log "Amplify: ${FRONT_APP_NAME} (deploy manual, sem ligação com o GitHub)"
FRONT_APP_ID=$(aws amplify list-apps --query "apps[?name=='${FRONT_APP_NAME}'].appId" --output text | awk 'NF && !f {print $1; f=1}')
if [ -z "${FRONT_APP_ID}" ]; then
  FRONT_APP_ID=$(aws amplify create-app --name "${FRONT_APP_NAME}" --platform WEB \
    --description "Portal de Aplicativos - front HML (IMONITOR-1619)" \
    --custom-rules '[{"source":"</^[^.]+$|\\.(?!(css|gif|ico|jpg|jpeg|js|png|txt|svg|woff|woff2|ttf|map|json|webmanifest)$)([^.]+$)/>","target":"/index.html","status":"200"}]' \
    --tags "${TAGS_JSON}" --query app.appId --output text)
  echo "criado ${FRONT_APP_ID}"
else
  echo "já existe ${FRONT_APP_ID}"
fi
if ! aws amplify get-branch --app-id "${FRONT_APP_ID}" --branch-name "${FRONT_BRANCH}" >/dev/null 2>&1; then
  aws amplify create-branch --app-id "${FRONT_APP_ID}" --branch-name "${FRONT_BRANCH}" --stage DEVELOPMENT --no-enable-auto-build >/dev/null
  echo "branch ${FRONT_BRANCH} criada"
fi
# Domínio imonitor-download-hml associado ao app (Amplify → Domain management); o link
# *.amplifyapp.com continua liberado no CORS.
WEB_URL="${HML_WEB_URL}"
CORS_ORIGINS="${WEB_URL},https://${FRONT_BRANCH}.${FRONT_APP_ID}.amplifyapp.com"
fi

# ---------------------------------------------------------------- API Gateway (id necessário para PUBLIC_URL)
log "API Gateway HTTP: ${API_NAME}"
API_ID=$(aws apigatewayv2 get-apis --query "Items[?Name=='${API_NAME}'].ApiId" --output text | awk 'NF && !f {print $1; f=1}')
if [ -z "${API_ID}" ]; then
  API_ID=$(aws apigatewayv2 create-api --name "${API_NAME}" --protocol-type HTTP \
    --cors-configuration 'AllowOrigins=*,AllowMethods=*,AllowHeaders=*,ExposeHeaders=*,MaxAge=3600' \
    --tags "${TAGS_KV}" --query ApiId --output text)
  echo "criada ${API_ID}"
else
  echo "já existe ${API_ID}"
fi
API_URL="https://${API_ID}.execute-api.${AWS_REGION}.amazonaws.com/${ENV_NAME}"

# ---------------------------------------------------------------- Lambda
log "Lambda: ${NAME}"
if ! aws lambda get-function --function-name "${NAME}" >/dev/null 2>&1; then
  # Segredo gerado aqui e guardado só na configuração da Lambda (nunca no repositório).
  JWT_SECRET=$(openssl rand -hex 32)
  # JSON (e não a sintaxe curta Variables={...}): CORS_ORIGINS tem vírgula.
  LAMBDA_ENV=$(python3 -c 'import json,sys; k=["NODE_ENV","PORTAL_JWT_SECRET","STORAGE_DRIVER","S3_BUCKET","SYSTEMS_CONFIG_PATH","PUBLIC_URL","WEB_URL","CORS_ORIGINS","DOWNLOAD_LINK_TTL_SECONDS"]; print(json.dumps({"Variables": dict(zip(k, sys.argv[1:]))}))' \
    production "${JWT_SECRET}" s3 "${BUCKET}" "${SYSTEMS_CONFIG_PATH}" "${API_URL}" "${WEB_URL}" "${CORS_ORIGINS}" 86400)
  aws lambda create-function --function-name "${NAME}" --package-type Image --code "ImageUri=${IMAGE_URI}" \
    --role "${ROLE_ARN}" --architectures x86_64 --memory-size 512 --timeout 30 \
    --environment "${LAMBDA_ENV}" \
    --tags "${TAGS_KV}" >/dev/null
  aws lambda wait function-active-v2 --function-name "${NAME}"
  echo "criada"
else
  echo "já existe (configuração mantida)"
fi
LAMBDA_ARN=$(aws lambda get-function --function-name "${NAME}" --query Configuration.FunctionArn --output text)

# ---------------------------------------------------------------- Integração, rotas, stage
INTEGRATION_ID=$(aws apigatewayv2 get-integrations --api-id "${API_ID}" --query 'Items[0].IntegrationId' --output text)
if [ "${INTEGRATION_ID}" = "None" ] || [ -z "${INTEGRATION_ID}" ]; then
  # payload 1.0: igual aos backends do i-monitor (o serverless-express usa pathParameters.proxy, sem o stage).
  INTEGRATION_ID=$(aws apigatewayv2 create-integration --api-id "${API_ID}" --integration-type AWS_PROXY \
    --integration-uri "${LAMBDA_ARN}" --integration-method POST --payload-format-version 1.0 --timeout-in-millis 30000 \
    --query IntegrationId --output text)
  echo "integração criada"
fi
EXISTING_ROUTES=$(aws apigatewayv2 get-routes --api-id "${API_ID}" --query 'Items[].RouteKey' --output text)
for route in 'ANY /{proxy+}' 'OPTIONS /{proxy+}'; do
  if ! grep -qF "${route}" <<<"${EXISTING_ROUTES}"; then
    aws apigatewayv2 create-route --api-id "${API_ID}" --route-key "${route}" --target "integrations/${INTEGRATION_ID}" >/dev/null
    echo "rota criada: ${route}"
  fi
done
if ! aws apigatewayv2 get-stage --api-id "${API_ID}" --stage-name "${ENV_NAME}" >/dev/null 2>&1; then
  LOG_ARN="arn:aws:logs:${AWS_REGION}:${ACCOUNT_ID}:log-group:/aws/apigateway/${API_NAME}"
  LOG_FORMAT='{"requestId":"$context.requestId","ip":"$context.identity.sourceIp","requestTime":"$context.requestTime","httpMethod":"$context.httpMethod","path":"$context.path","status":"$context.status","responseLength":"$context.responseLength"}'
  LOG_SETTINGS=$(python3 -c 'import json,sys; print(json.dumps({"DestinationArn": sys.argv[1], "Format": sys.argv[2]}))' "${LOG_ARN}" "${LOG_FORMAT}")
  aws apigatewayv2 create-stage --api-id "${API_ID}" --stage-name "${ENV_NAME}" --auto-deploy \
    --access-log-settings "${LOG_SETTINGS}" --tags "${TAGS_KV}" >/dev/null
  echo "stage ${ENV_NAME} criado"
fi

# Permissão só para ESTA API invocar ESTA Lambda.
aws lambda add-permission --function-name "${NAME}" --statement-id AllowAPIGatewayInvoke --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com --source-arn "arn:aws:execute-api:${AWS_REGION}:${ACCOUNT_ID}:${API_ID}/*/*" >/dev/null 2>&1 \
  && echo "permissão de invoke criada" || echo "permissão de invoke já existe"

log "Pronto"
cat <<EOF
  API (Lambda):  ${API_URL}
  Front:         ${WEB_URL}
  Front app id:  ${FRONT_APP_ID}

Próximos passos:
  ENV_NAME=${ENV_NAME} ./deploy/hml/deploy-api.sh   # nova imagem da API
  # front: HML → ./deploy/hml/deploy-front.sh; prod → build do Amplify app-downloader com VITE_API_URL=${API_URL}
EOF
