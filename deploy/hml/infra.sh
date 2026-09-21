#!/usr/bin/env bash
# Cria (ou confere) a infraestrutura do ambiente HML do Portal de Aplicativos — IMONITOR-1619.
#
# Mesmo desenho dos backends do i-monitor (i-monitor-back / i-monitor-dta-back):
#   ECR  →  Lambda em container (x86_64, 512 MB)  →  API Gateway HTTP, payload 1.0, stage "hml"
# e o front num app Amplify próprio (deploy manual, link *.amplifyapp.com).
#
# Seguro para rodar de novo: só cria o que não existe e só atualiza recursos com o prefixo
# portal-apps-*-hml. Não toca em nenhum recurso de outra aplicação.
#
# Uso: AWS_PROFILE=i-monitor ./deploy/hml/infra.sh
set -euo pipefail

export AWS_REGION="${AWS_REGION:-sa-east-1}"
export AWS_PAGER=""
ENV_NAME=hml
NAME="portal-apps-api-${ENV_NAME}"          # repositório ECR e função Lambda
ROLE_NAME="${NAME}-role"
API_NAME="${NAME}-api"
FRONT_APP_NAME="portal-apps-front-${ENV_NAME}"
FRONT_BRANCH=develop
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

# ---------------------------------------------------------------- Imagem
if ! aws ecr describe-images --repository-name "${NAME}" --image-ids imageTag=latest >/dev/null 2>&1; then
  log "Primeira imagem (a Lambda em container precisa de uma imagem para ser criada)"
  "${HERE}/deploy-api.sh" --push-only
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
ROLE_ARN=$(aws iam get-role --role-name "${ROLE_NAME}" --query Role.Arn --output text)

# ---------------------------------------------------------------- Logs
log "CloudWatch Logs (retenção 14 dias, igual aos backends)"
for group in "/aws/lambda/${NAME}" "/aws/apigateway/${API_NAME}"; do
  aws logs create-log-group --log-group-name "${group}" --tags "${TAGS_JSON}" 2>/dev/null && echo "criado ${group}" || echo "já existe ${group}"
  aws logs put-retention-policy --log-group-name "${group}" --retention-in-days 14
done

# ---------------------------------------------------------------- Amplify (front)
log "Amplify: ${FRONT_APP_NAME} (deploy manual, sem ligação com o GitHub)"
FRONT_APP_ID=$(aws amplify list-apps --query "apps[?name=='${FRONT_APP_NAME}'].appId | [0]" --output text)
if [ "${FRONT_APP_ID}" = "None" ] || [ -z "${FRONT_APP_ID}" ]; then
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
WEB_URL="https://${FRONT_BRANCH}.${FRONT_APP_ID}.amplifyapp.com"

# ---------------------------------------------------------------- API Gateway (id necessário para PUBLIC_URL)
log "API Gateway HTTP: ${API_NAME}"
API_ID=$(aws apigatewayv2 get-apis --query "Items[?Name=='${API_NAME}'].ApiId | [0]" --output text)
if [ "${API_ID}" = "None" ] || [ -z "${API_ID}" ]; then
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
  aws lambda create-function --function-name "${NAME}" --package-type Image --code "ImageUri=${IMAGE_URI}" \
    --role "${ROLE_ARN}" --architectures x86_64 --memory-size 512 --timeout 30 \
    --environment "Variables={NODE_ENV=production,PORTAL_JWT_SECRET=${JWT_SECRET},STORAGE_DRIVER=local,SYSTEMS_CONFIG_PATH=config/systems.hml.json,PUBLIC_URL=${API_URL},WEB_URL=${WEB_URL},CORS_ORIGINS=${WEB_URL}}" \
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
  aws apigatewayv2 create-stage --api-id "${API_ID}" --stage-name "${ENV_NAME}" --auto-deploy \
    --access-log-settings "DestinationArn=${LOG_ARN},Format={\"requestId\":\"\$context.requestId\",\"ip\":\"\$context.identity.sourceIp\",\"requestTime\":\"\$context.requestTime\",\"httpMethod\":\"\$context.httpMethod\",\"path\":\"\$context.path\",\"status\":\"\$context.status\",\"responseLength\":\"\$context.responseLength\"}" \
    --tags "${TAGS_KV}" >/dev/null
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
  ./deploy/hml/deploy-api.sh      # nova imagem da API
  ./deploy/hml/deploy-front.sh    # build do front com VITE_API_URL=${API_URL}
EOF
