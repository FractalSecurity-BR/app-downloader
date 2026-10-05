# Portal de Aplicativos — Fractal

Portal único para baixar os aplicativos Android dos sistemas da Fractal (Concursos, Containers Exportação,
Containers Importação e DTA). Substitui a página estática antiga (`index.html` + APKs em `public/`).

Fluxo do usuário: **escolhe o sistema → entra com o usuário e senha do próprio sistema → vê só os apps liberados
para ele → baixa**. No celular aparece só o botão "Baixar"; no computador, só o QR Code (para ninguém baixar no PC
um APK que não consegue passar para o celular).

> Tarefa: IMONITOR-1619 (épico IMONITOR-1620).

## Como funciona

```
Repositório do app ──(GitHub Actions: publish-app)──► S3 privado
                                                      ├─ <sistema>/manifest.json
                                                      └─ <sistema>/<app>/<versão>/<app>-<versão>.apk
                                                                   ▲
Navegador ──► Portal (api/ + web/) ── lê manifesto e gera link ────┘
                   │
                   └── login repassado para POST /auth/login do sistema escolhido
```

- **Login:** sempre no backend de **produção** do sistema; não existe escolha de ambiente. O portal não acessa os
  bancos: repassa usuário e senha para o `/auth/login` do sistema (contrato do i-monitor), lê perfil e empresa do
  token devolvido e descarta esse token. A sessão do portal é um JWT próprio de 30 min, guardado apenas na aba
  (`sessionStorage`).
- **Lista de apps:** vem do `manifest.json` do sistema no S3, filtrada pelo status da versão e pelas regras de
  `access` do app (perfil, tipo de operador, empresa).
- **Produção x builds de teste:** todo usuário vê só as versões de produção. Os **Master do i-monitor**
  (`alias_level = Master`) veem também os builds de homologação/staging, num bloco separado marcado como
  "build de teste · uso interno". Uma versão que já está em produção não se repete no bloco de teste.
- **Download:** o APK nunca é público. O portal gera um link `/d/<token>` válido por 10 min (usado pelo botão e
  pelo QR Code) que, ao ser aberto, redireciona para uma URL assinada do S3 válida por 5 min. Se a versão for
  bloqueada nesse meio-tempo, o link para de funcionar.
- **Automação:** ninguém edita o manifesto à mão. A action `publish-app` sobe o APK e registra a versão; o
  workflow `Gerenciar app no portal` promove, bloqueia, desbloqueia e ajusta acesso.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `api/` | API NestJS: login, lista de apps, links de download; em produção também serve o `web/dist` |
| `web/` | Front React + Vite, mobile-first |
| `manifest/manifest.schema.json` | Schema do manifesto — fonte única, validado pela API e pelo CLI |
| `tools/manifest-cli/` | CLI que publica/promove/bloqueia versões (usado pelo GitHub Actions) |
| `.github/actions/publish-app/` | Action reutilizável chamada pelos repositórios dos apps |
| `.github/workflows/gerenciar-app.yml` | Operações manuais (promote, block, unblock, set-access, show) |
| `config/systems.json` | Sistemas e URL do backend de login (produção) de cada um |
| `dev/` | Backend de login falso e script que popula APKs de exemplo |

## Rodando localmente

Pré-requisito: Node 20+.

```bash
npm run install:all
npm run dev:seed    # cria dev-storage/ com APKs falsos, usando o mesmo CLI do Actions
npm run dev:auth    # terminal 1 — login falso em :3999 (senha 123456)
npm run dev:api     # terminal 2 — API em :3000
npm run dev:web     # terminal 3 — front em http://localhost:5173
```

Usuários do login falso (senha `123456`): `master` (vê tudo, inclusive builds de homologação), `operador` (stuffer), `inspetor` (vê também o
Costado), `bloqueado` (simula bloqueio por tentativas), `trocasenha` (simula troca de senha obrigatória).

Para testar com **usuários reais de homologação** (Exportação e DTA HML), troque o terminal 1 e 2 por
`npm run dev:api:hml`. O login vai para os backends de HML (`config/systems.hml.json`); os APKs continuam sendo os
de exemplo do `dev-storage/`. A primeira tentativa pode demorar alguns segundos pela partida a frio do Lambda.

Alternativa em container: `./dev/seed.sh && docker compose up --build` → http://localhost:3000.

Testes: `npm test` (API: unitários + e2e com backend falso; CLI: regras do manifesto).

## Configuração (produção)

Variáveis em `.env.example`. As obrigatórias são `PORTAL_JWT_SECRET`, `PUBLIC_URL`, `S3_BUCKET`.

Permissões IAM:

- **API do portal:** `s3:GetObject` no bucket (lê manifestos e assina URLs de download).
- **Role usada pelo GitHub Actions:** `s3:GetObject` e `s3:PutObject` no bucket (lê/grava manifesto e sobe APK).
  Não precisa de `DeleteObject`: o CLI nunca sobrescreve nem apaga APK.
- Bucket com **Block Public Access** ligado. Nenhuma policy pública.

`config/systems.json` define os sistemas. Sistema com `enabled: false` aparece como "em breve". Para ligar um
sistema, preencha `authBaseUrl` com a URL base do backend **de produção** (sem barra final) e remova o
`enabled: false`. Se o login do sistema não estiver em `/auth/login`, informe `loginPath`. O DTA usa o backend
de produção da Exportação, porque os dois compartilham a mesma base de usuários.

## Ambiente HML (Lambda + Amplify)

Mesmo desenho dos backends do i-monitor: **ECR → Lambda em container (x86_64) → API Gateway HTTP (payload 1.0,
stage `hml`)**, com o front num app Amplify próprio. Tudo com prefixo `portal-apps-*-hml` e tags
`Project=portal-apps`, `Task=IMONITOR-1619`; nada é compartilhado com outras aplicações.

| Recurso | Nome |
|---|---|
| ECR / Lambda | `portal-apps-api-hml` |
| IAM role (só logs) | `portal-apps-api-hml-role` |
| API Gateway HTTP | `portal-apps-api-hml-api` (stage `hml`) |
| Amplify (front) | `portal-apps-front-hml`, branch `develop` |
| S3 (APKs e manifestos) | `fractal-portal-apps-hml` — privado, SSE-S3, só HTTPS, versionado (versões antigas mantidas) |

O bucket foi montado para custo baixo: S3 Standard, criptografia SSE-S3 (sem KMS), sem CloudFront, replicação ou
logs de acesso; uploads incompletos são limpos em 1 dia. Estimativa em HML: menos de US$ 0,50/mês (downloads cabem
nos 100 GB/mês de saída gratuitos da AWS).

Hoje o bucket guarda **só os manifestos**: por decisão do time, os APKs continuam no bucket `artefatos-mobile` e os
manifestos apontam para eles por link (`--url`). A carga inicial está em `deploy/hml/catalogo-inicial.sh` (versões
lidas de dentro de cada APK). Atenção: os arquivos do `artefatos-mobile` são sobrescritos a cada build com o mesmo
nome, então o link de uma versão registrada passa a entregar o build mais novo daquele arquivo. O login vai para os backends de HML
(`config/systems.hml.json`).

```bash
export AWS_PROFILE=i-monitor
./deploy/hml/infra.sh          # cria/confere ECR, role, logs, Lambda, API Gateway e app Amplify
./deploy/hml/deploy-api.sh     # build da imagem, push no ECR e update da Lambda
./deploy/hml/deploy-front.sh   # build do front com VITE_API_URL e deploy (zip) no Amplify
```

Automação: `.github/workflows/deploy_hml.yml` faz o deploy da API a cada push na `develop` (igual aos backends),
mas só depois que um admin cadastrar os secrets `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` e
`AWS_DEFAULT_REGION` no repositório; até lá o workflow só avisa e não faz nada. O app Amplify ainda não está
ligado ao GitHub (exige admin do repositório); o build spec para quando for ligado está em
`deploy/hml/amplify-buildspec.yml`. Ele fica fora da raiz de propósito: um `amplify.yml` na raiz passaria a valer
também para o app antigo (`imonitor-download.fractal-security.com`, branch `main`).

## Publicando um app (repositório do app)

No workflow de build do app, depois de gerar o APK:

```yaml
permissions:
  id-token: write   # OIDC com a AWS
  contents: read

# ...
      - name: Publicar no Portal de Aplicativos
        uses: FractalSecurity-BR/app-downloader/.github/actions/publish-app@main
        with:
          system: containers-exportacao
          app-id: imonitor-costado
          app-name: I-monitor Costado
          description: Leitura de costado no terminal
          version: ${{ steps.version.outputs.name }}   # versionName
          build: ${{ steps.version.outputs.code }}     # versionCode
          environment: hml                             # hml na branch de homologação, prod na main
          file: build/app/outputs/flutter-apk/app-release.apk
          release-notes: ${{ github.event.head_commit.message }}
          bucket: ${{ vars.PORTAL_APPS_BUCKET }}
          aws-role-arn: ${{ secrets.PORTAL_APPS_ROLE_ARN }}
```

Regras aplicadas pelo CLI:

- A mesma versão não pode ser publicada duas vezes (gere um `versionName` novo).
- A versão publicada vira a atual no ambiente informado.
- O manifesto é validado contra o schema antes de gravar e gravado com escrita condicional (dois builds ao mesmo
  tempo não se sobrescrevem).
- Se o APK subiu e a gravação do manifesto falhou, basta rodar de novo: o CLI reconhece o mesmo binário (sha256) e
  só registra a versão.

Como este repositório é privado, em *Settings → Actions → General → Access* ele precisa estar liberado para os
repositórios da organização.

### Origem do APK

Cada versão no manifesto aponta para o APK de um destes jeitos (exatamente um):

| Origem | Como publicar | Download | Quando usar |
|---|---|---|---|
| **Bucket do portal** (padrão) | `publish --file ./app.apk` | Link assinado (5 min) | Builds novos, pelo GitHub Actions |
| **Outro bucket** (reaproveitamento) | `publish --source-bucket <bucket> --source-key <caminho>.apk` | Link assinado (5 min), sem copiar o arquivo | APKs que já existem hoje em outro bucket |
| **Link externo** | `publish --url https://.../app.apk` | Redireciona para a URL | Decisão de publicar fora da AWS |

- **Outro bucket:** o bucket precisa estar em `ALLOWED_SOURCE_BUCKETS` e a role da API precisa de `s3:GetObject` nele;
  caso contrário o download é recusado. O CLI confere se o APK existe antes de registrar.
- **Link externo:** o portal ainda exige login e aplica as regras de acesso para mostrar e liberar o download, mas o
  destino fica visível para quem baixa e pode ser repassado; o portal também não garante que o arquivo não mude na
  origem. Só `https` é aceito.

## Operações manuais

GitHub → Actions → **Gerenciar app no portal** → *Run workflow*:

| Operação | Uso |
|---|---|
| `promote` | Leva uma versão para outro ambiente e a torna atual lá (hml → prod). Também serve para rollback. |
| `block` | Retira uma versão com problema. Onde ela era a atual, volta para a publicada anterior. O arquivo é mantido. |
| `unblock` | Libera de novo uma versão bloqueada (não muda qual é a atual). |
| `set-access` | Restringe quem vê o app. Campo vazio = não altera; `none` = libera para todos. |
| `show` | Mostra o manifesto do sistema no log. |

O workflow usa o environment `portal-apps` do GitHub (dá para exigir aprovação) com o secret
`PORTAL_APPS_ROLE_ARN` e as variables `PORTAL_APPS_BUCKET` e `PORTAL_APPS_AWS_REGION`.

O mesmo CLI roda localmente para inspeção: `STORAGE_DRIVER=s3 S3_BUCKET=... node tools/manifest-cli/index.mjs show --system dta`.

## Migração da página antiga

A página antiga (`index.html`, `public/`, `favicon/`) continua no repositório até a virada, para não derrubar o
que está no ar. Na virada:

1. Publicar as versões atuais de cada app com o CLI (ou pelo primeiro build com a action).
2. Subir o portal e apontar o domínio.
3. Remover `index.html`, `public/*.apk`, `favicon/` e a pasta `public/` antiga, e tirar os APKs do local público
   onde estão hoje.
