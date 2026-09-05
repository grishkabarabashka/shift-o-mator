# shift-o-mator: setup and deployment guide

Three environments, in the order you'd actually use them:

1. **Local** — run and test on your machine, no containers required.
2. **Sandbox** — a real but disposable AKS environment for testing, Entra ID included.
3. **Production** — not built yet. Documented here as explicit commands only, no
   automation, because there is nothing to run against and no value in scripting a
   process nobody has executed once by hand yet.

Every command below is meant to be typed and read, not piped into a script — that's
deliberate: at this stage you want to see what each step actually does to the Azure
subscription, not trust a black box.

## How the pieces vary by environment

Two things are configurable independently, and both matter: **who the user is** and **how
the app reaches the database**. Neither is decided by the environment — they are settings,
and any combination below runs.

| | Local | Sandbox (AKS) | Production |
|---|---|---|---|
| **Sign-in** | `stub` by default; `entra` works too (section 2a) | `entra` — that is what it exists to test | corporate Entra |
| **Where roles come from** | database grants (Settings → Roles) | the same | the same, **plus** Entra app roles if the system has directory roles switched on — off by default, and a toggle in the product rather than a setting (ADR-0063); see 6.3 |
| **Database auth** | Windows auth (LocalDB) | managed identity | managed identity, *or* a service account + password if the database is standalone |
| **Key Vault** | none — user secrets | not needed | not needed; only for a SQL password, if the database cannot do Entra auth |
| **AI model** | off by default; Foundry Local or a cloud deployment (section 2b) | an Azure OpenAI deployment, by managed identity | the same, inside the corporate tenant |

Two consequences worth stating plainly:

- **Roles do not come from Entra at all by default** (ADR-0062), and never from Entra
  alone. App roles can only be global — the directory has
  no idea what `unit-emea` is. Per-unit access is always a database grant edited on
  Settings → Roles. Wiring the corporate joiner/mover/leaver process into Entra app roles
  is a separate piece of work, and it can only ever deliver the global half.
- **Managed identity is preferred, not required.** A database inside the perimeter with no
  Entra integration falls back to a service account whose password lives in Key Vault.
  The chart supports both without the application knowing which it got.

## 0. Prerequisites

| Tool | Needed for |
|---|---|
| .NET 10 SDK | running/testing the API locally |
| Node 22+ | running/testing the web app locally |
| Azure CLI (`az`), logged in with rights on the subscription | sandbox/production setup |
| `kubectl`, `helm` 3.x | deploying to AKS |
| Podman (or Docker) | **only** needed once you build container images for AKS — not for local dev or `dotnet test`/`npm test` |

## 1. Running tests locally (no containers)

```bash
# backend — from apps/api/
dotnet test

# frontend — from the repo root (npm workspace)
npm run test:run
npm run typecheck
```

Neither needs Podman/Docker, a running API, or a database reachable — backend tests use
`WebApplicationFactory` against an isolated database per the existing test setup;
frontend tests use `msw` to mock the API. If `npm run test:run` fails with a missing
`typescript`/`vite` binary, `node_modules` is stale or absent — run `npm install` from
the repo root first (npm workspace, one install for both `apps/web` and the root).

Full local verification, matching what CI would run once one exists:

```bash
npm run typecheck && npm run test:run && npm run build && npm run api:schema:check
cd apps/api && dotnet build && dotnet test
```

## 2. Running the app locally (no containers)

```bash
# backend, from apps/api/
dotnet run --project src/ShiftOMator.Api

# frontend, from the repo root
npm run dev
```

Defaults to `Auth:Mode=Stub` and LocalDB (`apps/api/src/ShiftOMator.Api/appsettings.json`)
— nothing to configure. The frontend reads `VITE_API_URL` from `apps/web/.env.development`
(`http://localhost:5106`, the API's default port). The in-app identity switcher only
appears when the server reports `stubMode: true` from `GET /api/auth/me`.

The database comes up empty apart from reference data (leave types, presence types,
request types). Open the app and it shows the setup wizard: pick Bare or Demo (ADR-0059).

## 2a. Entra ID for local development (optional)

Stub mode is the normal local loop and needs none of this. Turn real sign-in on locally
when you're changing anything about authentication, or to reproduce a sandbox problem
without deploying — **both halves must switch together**, or the server ignores the token
and you're silently back on stub.

You need an app registration. Reuse the sandbox one (section 6.1) by adding
`http://localhost:5173` to its redirect URIs, or create a separate one for local work:

```bash
APP_ID=$(az ad app create --display-name "shift-o-mator-local" \
  --sign-in-audience AzureADMyOrg --query appId -o tsv)
az ad app update --id $APP_ID --identifier-uris "api://$APP_ID"
az ad sp create --id $APP_ID
TENANT_ID=$(az account show --query tenantId -o tsv)
echo "client id: $APP_ID / tenant: $TENANT_ID"
```

Two things the CLI does not do well and are easier in the portal (**App registrations →
your app**):

- **Authentication → Add a platform → Single-page application**, redirect URI
  `http://localhost:5173`. It must be the **SPA** platform: a "Web" platform expects a
  client secret and rejects the PKCE flow the browser uses, with a CORS error that does
  not mention the real cause.
- **Expose an API → Add a scope**, named `access_as_user`, admin+user consent. This is
  what makes `api://<app-id>/access_as_user` a real scope.
- **App roles** (optional) → add `Planner`/`Approver`/`Admin`, *then* assign yourself under
  **Enterprise applications → Users and groups**. That order is not a suggestion: the
  assignment screen can only offer roles that already exist. Section 6.3 explains the split.

Then, client side — copy `apps/web/.env.example` to `apps/web/.env.development.local`
(git-ignored) and set:

```bash
VITE_AUTH_MODE=entra
VITE_ENTRA_CLIENT_ID=<app id>
VITE_ENTRA_TENANT_ID=<tenant id>
VITE_ENTRA_API_SCOPE=api://<app id>/access_as_user
```

And server side — **user secrets**, from `apps/api/src/ShiftOMator.Api`:

```bash
dotnet user-secrets set "Auth:Mode" "EntraId"
dotnet user-secrets set "Auth:Jwt:Authority" "https://login.microsoftonline.com/<tenant id>/v2.0"
dotnet user-secrets set "Auth:Jwt:Audience" "api://<app id>"   # or the bare app id — both are accepted
dotnet user-secrets list          # where they went, if you lose them
```

**Not `appsettings.json`, and not `appsettings.Development.json`.** Both are committed and
shared: the first is what makes `Auth:Mode=Stub` the default local loop for everybody, and
the second already carries shared logging settings. Your tenant and app registration are
yours — the next person has different ones — so putting them in either file means a
permanent uncommitted diff that eventually gets committed by accident. User secrets live
outside the repository, under `%APPDATA%\Microsoft\UserSecrets\<UserSecretsId>\secrets.json`,
and cannot be committed at all. It is also where `Ai:ApiKey` belongs (section 2b), which
genuinely is a secret.

Switching `appsettings.json` to `EntraId` instead has one more consequence worth knowing:
the API test suite reads that file too. `ApiTestFactory` now pins `Auth:Mode` to `Stub` so
it cannot happen again, but the symptom was every test failing on 401 with nothing in the
diff to explain it.

Finally, **run the setup wizard**: your work email must be in `Person.Email` for some
row, or every request comes back `403 PRINCIPAL_NOT_MAPPED` (section 6.2). On a fresh
database nobody is linked yet — open the app with Entra ID mode already switched on and
it shows the wizard, which creates you (Bare) or links you to the fixture's admin (Demo)
using the email in your token (ADR-0059). There is nothing to configure for this.

## 2b. AI explanations for local development (optional)

AI is **off by default** (`"Ai": { "Provider": "none" }`), and that is a fully supported
state, not a broken one: `/api/insights/gap-summary` answers `503 AI_NOT_CONFIGURED` and
its panel simply does not appear, while `/api/insights/candidate-explanation` still returns
its computed deciding factor. Nothing in planning depends on a model being reachable, so
skip this section entirely unless you are working on an insight surface.

Two ways to get one locally. They differ in where the tokens are processed and what you
have to own — not in application code, which never names a provider (ADR-0060).

|  | Foundry Local | Azure OpenAI in the cloud |
|---|---|---|
| Cost | free | pay per token — around **$1/month** at this app's usage |
| Needs an Azure subscription | no | yes |
| Prompts leave the machine | no | yes |
| Matches what sandbox/production run | no | **yes** |
| Setup cost | a download and a few GB of disk | one resource, one role assignment |

Pick Foundry Local if you want zero cost and zero egress; pick the cloud one if you are
debugging behaviour that has to match a deployed environment. Neither is a commitment —
the two are three lines of configuration apart.

### Option A — Foundry Local (on-device, free)

[Foundry Local](https://learn.microsoft.com/en-us/azure/foundry-local/what-is-foundry-local)
runs the model on your own hardware and exposes an OpenAI-compatible REST API, so it needs
no Azure subscription and no API key. Note it is in **public preview** and Microsoft
documents its REST surface as subject to breaking changes — fine for a local convenience,
which is the only place this guide uses it.

```bash
# Install (Windows), then start a model — the alias picks the right build for your CPU/GPU/NPU.
winget install Microsoft.FoundryLocal
foundry model run phi-4-mini

# The port is assigned dynamically; never hardcode it. Read it back:
foundry service status
# or: curl http://localhost:5272/openai/status   # -> {"Endpoints":["http://localhost:5272"], ...}

# The exact id to configure as Ai:Model — an alias is not the loaded model's name:
curl http://localhost:5272/openai/models
# -> ["Phi-4-mini-instruct-generic-cpu"]
```

Then, from `apps/api/src/ShiftOMator.Api`:

```bash
dotnet user-secrets set Ai:Provider "openai"
dotnet user-secrets set Ai:Endpoint "http://localhost:5272/v1"   # note the /v1 suffix
dotnet user-secrets set Ai:Model "Phi-4-mini-instruct-generic-cpu"
```

**No `Ai:ApiKey`, deliberately.** A model server on localhost authenticates nobody, so an
endpoint on its own counts as a complete configuration — see `ChatModel.FromConfiguration`.
It is only when *neither* a key nor an endpoint is set that the feature reports itself
unconfigured.

Two things that will bite otherwise:

- **The port changes between restarts of the service.** If insights start failing after a
  reboot, re-read `foundry service status` and update `Ai:Endpoint`. There is no discovery
  in the app on purpose: the endpoint is configuration, and the API does not depend on a
  local runtime being installed.
- **`Ai:Model` is the loaded model id, not the alias.** `phi-4-mini` starts it;
  `Phi-4-mini-instruct-generic-cpu` is what the API answers to.

### Option B — Azure OpenAI (the shape sandbox and production use)

Provision a small deployment and grant *yourself* the data-plane role — the same role the
pod identity gets in sections 5 and 8, so this rehearses the deployed configuration:

```bash
RG=rg-shiftomator-dev
AOAI=shift-o-mator-dev-aoai
az group create -n $RG -l eastus
az cognitiveservices account create -g $RG -n $AOAI --kind OpenAI --sku S0 -l eastus
az cognitiveservices account deployment create -g $RG -n $AOAI \
  --deployment-name gpt-4o-mini --model-name gpt-4o-mini --model-version "2024-07-18" \
  --model-format OpenAI --sku-name Standard --sku-capacity 10

AOAI_ID=$(az cognitiveservices account show -g $RG -n $AOAI --query id -o tsv)
ME_OID=$(az ad signed-in-user show --query id -o tsv)
az role assignment create --assignee-object-id $ME_OID --assignee-principal-type User \
  --role "Cognitive Services OpenAI User" --scope $AOAI_ID
```

```bash
dotnet user-secrets set Ai:Provider "azure-openai"
dotnet user-secrets set Ai:Endpoint "https://$AOAI.openai.azure.com/"
dotnet user-secrets set Ai:Model "gpt-4o-mini"          # the *deployment* name
```

**No key here either**, and for a better reason: with `Ai:ApiKey` empty the app uses
`DefaultAzureCredential`, which resolves to your `az login` locally and to workload
identity in the cluster. That is the same credential chain the SQL connection string uses,
which is why one configuration works in both places. Keys are supported
(`dotnet user-secrets set Ai:ApiKey …`) but there is no reason to prefer one.

If you get `401`/`403` on the first call, the role assignment has not propagated yet — it
takes a minute or two — or `az login` is pointed at a different tenant than the resource.

### Turning it back off

```bash
dotnet user-secrets set Ai:Provider "none"
```

A typo in the provider name fails at **startup**, deliberately: a config that was asked for
and misspelled must surface rather than silently disable the feature.

## 3. Configuration reference

Standard ASP.NET Core layering: `appsettings.json` → `appsettings.{Environment}.json` →
environment variables (`Section__Key`) → command line.

### Backend (`apps/api/src/ShiftOMator.Api/appsettings*.json`)

Every "Sandbox/Production" value below is supplied as an environment variable by the Helm
**ConfigMap** (`api.config.*` in the values files) — *not* from Key Vault. There is no
vault by default, and nothing in the list is a secret while SQL and the model both
authenticate as the pod's managed identity: a connection string with no password, a public
issuer URL and a public Application ID URI. Key Vault enters only for a SQL password or a
key-authenticated model endpoint; see "What Key Vault is for" in section 5.

| Key | Local | Sandbox/Production | Notes |
|---|---|---|---|
| `ConnectionStrings:Schedule` | LocalDB, hardcoded | `api.config.connectionString` | `Authentication=Active Directory Default`, so no password and no vault |
| `Auth:Mode` | `Stub` | `EntraId` | switches `StubAuthenticationHandler` vs `AddJwtBearer` in `Program.cs` |
| `Auth:StubPersonId` / `Auth:StubRole` | empty (real grants) | unused in EntraId mode | **must stay empty** in Stub mode — see CLAUDE.md, this was a live bug once |
| `Auth:Jwt:Authority` | user secrets (section 2a) | `api.config.jwtAuthority` | `https://login.microsoftonline.com/<tenant-id>/v2.0` — a public URL |
| `Auth:Jwt:Audience` | user secrets (section 2a) | `api.config.jwtAudience` | the app registration's Application ID URI — public; either shape is accepted |
| `Cors:AllowedOrigins` | `["http://localhost:5173"]` | `api.config.corsAllowedOrigins` | array — the ConfigMap emits `Cors__AllowedOrigins__0`, `__1`, … |
| `Ai:Provider` | `none` — see section 2b | `azure-openai` | `azure-openai`, `openai`, `none` — non-secret |
| `Ai:Model` | — | the **deployment** name | under `azure-openai` this names the deployment, not the model family |
| `Ai:Endpoint` | — | the resource URL | required by `azure-openai`. For `openai` it is optional, but on its own it is enough: a keyless endpoint is a complete configuration |
| `Ai:ApiKey` | user secrets, if the endpoint needs one | **unset** | `azure-openai` authenticates as the pod instead — see `ChatModel.FromConfiguration` |

### Frontend (`apps/web/.env.*`)

All `VITE_*` values are inlined into the bundle at **build time**; for a container image
they are `--build-arg`s, not runtime settings. Full list with comments in
`apps/web/.env.example`. None are secrets — a SPA client id and a scope are public by
design.

| Key | Local | Sandbox/Production |
|---|---|---|
| `VITE_API_URL` | `http://localhost:5106` | the deployed API's URL |
| `VITE_AUTH_MODE` | `stub` (or `entra`, section 2a) | `entra` |
| `VITE_ENTRA_CLIENT_ID` / `_TENANT_ID` / `_API_SCOPE` | only when `entra` | required |
| `VITE_ENTRA_REDIRECT_URI` | unset (defaults to the current origin) | unset unless the app is served from a different origin than it redirects to |

**`VITE_AUTH_MODE` and the server's `Auth:Mode` must agree.** They are set in different
places and nothing checks them against each other: a client in `entra` against a `Stub`
server signs you in and then has its token ignored, and the reverse sends no token to a
server that requires one.

## 4. Building container images

Only needed once you're targeting AKS. Build context is the **repository root** for both
(they need the npm workspace root / other `ShiftOMator.*` projects).

```bash
podman build -t <acr>.azurecr.io/shift-o-mator/api:<tag> -f apps/api/Dockerfile .
podman build -t <acr>.azurecr.io/shift-o-mator/web:<tag> \
  --build-arg VITE_API_URL=<api url, known only after the API is deployed once — see step 7> \
  --build-arg VITE_AUTH_MODE=entra \
  --build-arg VITE_ENTRA_CLIENT_ID=<app id> \
  --build-arg VITE_ENTRA_TENANT_ID=<tenant id> \
  --build-arg VITE_ENTRA_API_SCOPE=api://<app id>/access_as_user \
  -f apps/web/Dockerfile .

az acr login --name <acr>
podman push <acr>.azurecr.io/shift-o-mator/api:<tag>
podman push <acr>.azurecr.io/shift-o-mator/web:<tag>
```

`VITE_API_URL` is inlined into the JS bundle at build time (Vite), not read at container
start — there is no way to repoint a built web image at a different API URL without
rebuilding it. This is why the sandbox and production sections below deploy the API
first, read its address, then build the web image.

**The web build fails outright if `VITE_API_URL` is empty**, rather than producing a
bundle that asks the nginx pod for `/api/*` and breaks only in a browser after the push.
Behind an ingress the right value is the app's own public origin (`https://<host>`), not
an empty string. For the same reason `.dockerignore` excludes `.env*`: Vite reads
`.env.production` *inside* the image build, so a git-ignored local file on the machine
doing the build would otherwise decide what a released image points at.

`--set image.api.tag` / `image.web.tag` are **required** — there is no fallback to the
chart's `appVersion`, which used to resolve to `:0.1.0`, an image nothing publishes, and
surfaced minutes later as `ImagePullBackOff` rather than immediately as a bad command.

To run both images locally against a SQL Server you already have reachable, without any
AKS involved: `compose.yaml` in the repo root (`podman compose up --build`, needs
`CONNECTION_STRING` set — see the file for why there's no throwaway SQL container in it).

## 5. Sandbox: Azure environment setup

A real AKS environment, sized to cost close to nothing, for testing end-to-end
(including real Entra ID login — Stub mode is local-only). Every command is explicit on
purpose; run them one at a time and look at what each creates before moving to the next.

Trade-offs versus production (section 8): a single Spot node (can be evicted any time —
acceptable for throwaway testing, not for anything real), no Application Gateway/TLS (the
web Service is exposed directly via a Kubernetes LoadBalancer), Azure SQL Serverless on
the free-tier quota (auto-pauses after idle, so the first request after a pause is slow).

**No secrets anywhere**: the pod reaches SQL as its own managed identity, and the model
the same way. So no Key Vault is created below and `azureKeyVault.enabled` stays `false` —
the sandbox rehearses production's auth path, not just its deployment. See "What Key Vault
is for" at the end of this section for what would bring a vault back.

```bash
RG=rg-shiftomator-sandbox
LOCATION=eastus
AKS=aks-shiftomator-sandbox
ACR=shiftomatorsandbox        # must be globally unique — append your initials if taken
KV=kv-shiftomator-sandbox
SQL_SERVER=sql-shiftomator-sandbox
SQL_DB=ShiftOMator
IDENTITY=id-shiftomator-sandbox
NAMESPACE=shift-o-mator

az group create --name $RG --location $LOCATION

# --- Container registry, attached to the cluster we're about to create ---
az acr create --resource-group $RG --name $ACR --sku Basic

# --- AKS: 1 Spot node, workload identity, attached to the ACR above ---
az aks create \
  --resource-group $RG --name $AKS \
  --node-count 1 --node-vm-size Standard_B2s \
  --priority Spot --eviction-policy Delete --spot-max-price -1 \
  --enable-oidc-issuer --enable-workload-identity \
  --attach-acr $ACR \
  --generate-ssh-keys

az aks get-credentials --resource-group $RG --name $AKS --overwrite-existing
OIDC_ISSUER=$(az aks show -g $RG -n $AKS --query "oidcIssuerProfile.issuerUrl" -o tsv)

# --- The identity the pod presents to Azure, federated with this cluster's service
#     account. This is what authenticates to SQL — there is no password anywhere.
az identity create -g $RG -n $IDENTITY
IDENTITY_CLIENT_ID=$(az identity show -g $RG -n $IDENTITY --query clientId -o tsv)

az identity federated-credential create \
  --name shift-o-mator-federation --identity-name $IDENTITY -g $RG \
  --issuer $OIDC_ISSUER \
  --subject system:serviceaccount:$NAMESPACE:shift-o-mator \
  --audience api://AzureADTokenExchange

IDENTITY_PRINCIPAL_ID=$(az identity show -g $RG -n $IDENTITY --query principalId -o tsv)

# --- AI explanations (optional): an Azure OpenAI (Azure AI Foundry) deployment the *same*
#     identity may call. No key, so no Key Vault — which is why this environment has none.
#     Skip the block and leave aiProvider: none if you do not want AI in the sandbox.
AOAI=shift-o-mator-sandbox-aoai
az cognitiveservices account create -g $RG -n $AOAI --kind OpenAI --sku S0 --location $LOCATION
az cognitiveservices account deployment create -g $RG -n $AOAI \
  --deployment-name gpt-4o-mini --model-name gpt-4o-mini --model-version "2024-07-18" \
  --model-format OpenAI --sku-name Standard --sku-capacity 10

AOAI_ID=$(az cognitiveservices account show -g $RG -n $AOAI --query id -o tsv)
az role assignment create --assignee-object-id $IDENTITY_PRINCIPAL_ID \
  --assignee-principal-type ServicePrincipal \
  --role "Cognitive Services OpenAI User" --scope $AOAI_ID

# Then in values-sandbox.yaml: aiProvider: azure-openai, aiEndpoint
# https://<aoai-name>.openai.azure.com/, aiModel gpt-4o-mini (the *deployment* name).

# --- Azure SQL: server + serverless database on the free-tier quota ---
# The Entra admin is *you*, so you can create the database user below. No SQL login,
# no password — `--enable-ad-only-auth` refuses password authentication outright.
ME_UPN=$(az ad signed-in-user show --query userPrincipalName -o tsv)
ME_OID=$(az ad signed-in-user show --query id -o tsv)

az sql server create \
  --name $SQL_SERVER --resource-group $RG --location $LOCATION \
  --enable-ad-only-auth --external-admin-principal-type User \
  --external-admin-name "$ME_UPN" --external-admin-sid "$ME_OID"

# 0.0.0.0-0.0.0.0 is Azure's documented magic range meaning "allow Azure services and
# resources to reach this server" — it does not open the server to the public internet.
# Add your own IP too, or the sqlcmd step below cannot connect.
az sql server firewall-rule create \
  --resource-group $RG --server $SQL_SERVER \
  --name AllowAzureServices --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0
az sql server firewall-rule create \
  --resource-group $RG --server $SQL_SERVER \
  --name MyIP --start-ip-address $(curl -s ifconfig.me) --end-ip-address $(curl -s ifconfig.me)

az sql db create \
  --resource-group $RG --server $SQL_SERVER --name $SQL_DB \
  --edition GeneralPurpose --family Gen5 --capacity 0.5 --compute-model Serverless \
  --auto-pause-delay 60 --use-free-limit true --free-limit-exhaustion-behavior AutoPause

az account show --query tenantId -o tsv   # TENANT_ID — needed in section 6
echo "workload identity client id: $IDENTITY_CLIENT_ID"
```

**Give the managed identity a database user.** This is the one step with no `az`
equivalent — SQL permissions live in the database, not in Azure Resource Manager. Connect
to the database as yourself (you are the Entra admin) and run:

```sql
CREATE USER [id-shiftomator-sandbox] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [id-shiftomator-sandbox];
ALTER ROLE db_datawriter ADD MEMBER [id-shiftomator-sandbox];
ALTER ROLE db_ddladmin ADD MEMBER [id-shiftomator-sandbox];
```

The name in brackets is the **managed identity's name**, not its client id. `db_ddladmin`
is needed because the app runs EF migrations at startup; drop it once the schema stops
being regenerated (see CLAUDE.md).

```bash
sqlcmd -S ${SQL_SERVER}.database.windows.net -d $SQL_DB -G -i grant.sql
```

`-G` is Entra authentication; it picks up your `az login`. Then fill in
`deploy/helm/shift-o-mator/values-sandbox.yaml`: `image.registry`,
`workloadIdentity.clientId`, `azureKeyVault.keyvaultName`/`tenantId`, and the
`<sql-server>` / `<tenant-id>` / `<app-id>` placeholders in `api.config`.

### What Key Vault is for

Sorting every value the API needs by whether it is actually a secret:

| Value | Secret? | Where it lives |
|---|---|---|
| `Ai:ApiKey`, under `openai` against a hosted endpoint | **Yes** | Key Vault, as `Ai__ApiKey` |
| `Ai:Endpoint` / `Ai:Model`, under `azure-openai` | No — a resource URL and a deployment name | ConfigMap; there is no key at all |
| Connection string, **with a password** | **Yes** | Key Vault — see below |
| Connection string, managed identity | No — no credential in it | ConfigMap |
| `Auth:Jwt:Authority` | No — a public Microsoft URL | ConfigMap |
| `Auth:Jwt:Audience` | No — a public Application ID URI | ConfigMap |
| `VITE_ENTRA_CLIENT_ID` / scope | No — public by design in a SPA | Baked into the web image |

So the vault is not decoration, but it is also not on the critical path for SQL. Two
cases keep it:

1. **A model reached by key** — `openai` pointed at a hosted gateway. Neither environment
   here does that: both use an `azure-openai` deployment, which the pod calls as itself
   with a `Cognitive Services OpenAI User` grant on the resource, exactly as it reaches
   SQL. This case exists for a deployment that has no such resource available.
2. **A database that cannot do Entra authentication.** A standalone SQL Server on a VM
   inside the perimeter has no managed identity to grant, so it needs a service account
   and a password, and that password needs somewhere to live. Leave
   `api.config.connectionString` empty and add the secret to `azureKeyVault.secrets`:

   ```yaml
   api:
     config:
       connectionString: ""     # the Secret supplies it instead
   azureKeyVault:
     secrets:
       - objectName: shift-o-mator-connection-string
         envVarName: ConnectionStrings__Schedule
       - objectName: shift-o-mator-ai-api-key
         envVarName: Ai__ApiKey
   ```

   The Secret is applied to the pod *after* the ConfigMap, so on a key present in both the
   Secret wins. Both paths are first-class; nothing in the app knows which one it got.

## 6. Sandbox: Entra ID app registration and linking users

Stub auth is local-only — the sandbox runs `Auth:Mode=EntraId` for real, so it needs an
actual app registration and a real answer to "which Entra ID user is which `Person`".

### 6.1 Register the app

```bash
APP_NAME="shift-o-mator-sandbox"
APP_ID=$(az ad app create --display-name "$APP_NAME" \
  --sign-in-audience AzureADMyOrg \
  --query appId -o tsv)

# Expose an API scope (the Application ID URI becomes the JWT audience)
az ad app update --id $APP_ID --identifier-uris "api://$APP_ID"

az ad sp create --id $APP_ID
TENANT_ID=$(az account show --query tenantId -o tsv)
echo "authority: https://login.microsoftonline.com/$TENANT_ID/v2.0"
echo "audience:  api://$APP_ID"
```

Two things the CLI does poorly; do them in the portal (**App registrations → your app**):

- **Authentication → Add a platform → Single-page application**, redirect URI
  `http://<api LoadBalancer IP>` — or whatever origin the web app is served from. It must
  be the **SPA** platform: a "Web" platform expects a client secret, rejects the browser's
  PKCE flow, and reports it as a CORS error that says nothing about the real cause.
- **Expose an API → Add a scope** named `access_as_user`.
- **App roles** → `Planner`/`Approver`/`Admin`, if you want any. Optional for the app —
  everyone signs in as Viewer without them and per-unit rights come from Settings → Roles
  — but **not optional in the order you do things**: until a role exists here, the
  assignment screen under Enterprise applications has nothing to offer and appears broken.
  Section 6.3 covers both halves and why they are two different blades.

Put the authority and audience into `values-sandbox.yaml` (`api.config.jwtAuthority` /
`jwtAudience`) — neither is a secret, so neither needs a vault.

### 6.2 Linking Entra ID users to people

**Manually, by an admin, matching on work email.** There is no directory sync. This is
built — see [ADR-0058](../Docs/adr/0058-entra-id-identity-is-linked-by-email.md) for the
reasoning; the mechanics:

- `Person.Email` (nullable, unique when set — the same filtered-index shape as
  `EmployeeId`) holds the person's work email. An admin fills it in on **Settings →
  People**, in the "Email (sign-in)" column beside Employee ID.
- Outside Stub mode `ActorResolver` resolves the acting person **only** by matching that
  field against the token's email claim (`preferred_username`, `email`, or `upn` — which
  one Entra sends depends on tenant configuration, so all three are read). Stored and
  compared lowercased.
- Blank email = that person cannot sign in. They get `403 PRINCIPAL_NOT_MAPPED`, and the
  message names the address that matched nobody — so they can send it to whoever
  administers their unit rather than an admin having to go look it up in the portal first.

**The first administrator** is the circular case: nobody is linked, so nobody can reach
Settings → People to link anyone. A database with no `SystemSetup` row serves the setup
wizard instead of the app, to anybody who reaches it — the Bare preset creates you from
your token's own email and name, the Demo preset links you to whichever seeded manager
holds the global Admin grant ([ADR-0059](../Docs/adr/0059-setup-is-a-screen-not-a-flag.md)).
It runs once: a second `POST /api/setup` answers `409 SETUP_COMPLETE`, and the only way
back to the wizard is Settings → Maintenance → Reset, which an existing global admin has
to do on purpose.

### 6.2a Which token goes where

```text
browser ──login redirect──> Entra ID
        <──id_token + access_token──
        │
        │  id_token   → stays in the browser (sessionStorage). MSAL uses it to know
        │               who is signed in. Never sent to our API, never parsed by us.
        │
        └─ access_token (audience api://<app-id>) ──Authorization: Bearer──> API
                                                     │
                                                     ├─ validates signature/audience
                                                     ├─ email claim  → Person.Email
                                                     └─ roles claim  → global grants
                                                          + per-unit grants from the DB
                                                                   │
browser <────────── GET /api/auth/me ──────────────────────────────┘
                    { personId, displayName, roles[], stubMode }
```

The client sends **only** the access token, and gets identity and permissions **only**
from `/api/auth/me`. It never decodes a token to decide what to show — that would be a
second answer to "what may I do", and it would be wrong, because per-unit grants live in
the database and no token carries them (ADR-0051).

Order matters: sign-in completes *before* the first `/api/auth/me`. `EntraGate` wraps
`AuthProvider` for exactly this reason — otherwise the identity call goes out
unauthenticated, comes back 401, and the app resolves to nobody.

### 6.3 Roles: database grants, and optionally Entra ID app roles

**By default, roles come from the database only** (ADR-0062). Everything in this section
about app roles applies only when the system has directory roles switched **on**. That is a
toggle in the product — not a setting (ADR-0063) — offered once in the setup wizard and
afterward at the top of **Settings → Roles**, where it sits because it changes what that
screen means. Nothing to configure here, nothing to redeploy to change it. Skip to "What
unassigned actually means" if it is off, which is how every system starts.

Changing it takes a **global** Admin, unlike every other admin write: a directory grant is
global by construction, so an administrator of one unit must not be able to widen every
unit at once.

The reason for the default is worth knowing before you turn it on: **Settings → Roles reads
the database only.** A person granted Admin through the directory shows no ticked box on
the screen whose job is to answer "who can do what here", an administrator can untick
everything for them and change nothing, and ticking a box mints a *second*, independent
grant that has to be revoked somewhere else. Listing other people's app roles would need
Microsoft Graph, an application permission and admin consent, so the honest default is one
source.

With the switch on, a person's rights are the **union** of what the token says and what the
database stores. Neither overrides the other.

| | Entra ID app roles | Database grants |
|---|---|---|
| Scope it can express | **global only** (`unitId: null`) | global **or** one planning unit |
| Where it is edited | Azure portal / `az` | Settings → Roles, in the app |
| When a change takes effect | next **token**, so after a fresh sign-in | next **request** |
| Who it suits | the handful of people who act across every unit; joiner/mover/leaver automation | almost everybody, because almost everybody works in one unit |

The split is not a preference, it is a limitation with a reason: the directory has no idea
what `unit-emea` is, so it can only ever say "this person administers the whole thing".
Per-unit scope is ours, so it lives in our database (ADR-0051).

**Nothing is implied by ordering.** An Admin cannot assign shifts and a Planner cannot
approve leave; holding two roles grants both, and `Viewer` is what everyone signing in
already has. Granting somebody `Admin` and expecting them to plan is the single most
common mistake here — give them `Planner` as well.

**Someone in no list at all is a Viewer**: signs in fine, reads the rota, writes nothing.
That is the ordinary behaviour for anyone with no grants, not a special case. And the
*first* Admin comes from neither mechanism — the setup wizard makes whoever runs it a
global Admin (ADR-0059), which is what breaks the circle of "nobody can reach the screen
that grants roles".

#### The two objects, and why the portal makes this confusing

Your app exists in Entra ID as **two separate objects** with the same `appId`, in two
different blades. Roles are **defined** on one and **handed out** on the other, which is the
single thing that makes this step feel broken:

```text
Microsoft Entra ID tenant
│
├── App registrations → "shift-o-mator-sandbox"      the DEFINITION
│     │                                              created by `az ad app create`
│     ├── Authentication   → SPA redirect URI
│     ├── Expose an API    → api://<app-id>/access_as_user   (the JWT audience)
│     └── App roles        → Planner | Approver | Admin
│                            ▲
│                            └── roles are CREATED here, and nowhere else
│
└── Enterprise applications → "shift-o-mator-sandbox"  the INSTANCE (a service principal)
      │                                                created by `az ad sp create`
      ├── Properties        → "Assignment required?"  (No by default)
      └── Users and groups  → alice ── Planner
                              carol ── Admin
                              bob   ── not listed
                              ▲
                              └── roles are HANDED OUT here, and nowhere else
```

**"I can only add a user, and there is no role to pick."** That is this exact split, and it
has one cause: **no app role is defined yet on the App registration**, so the assignment
dialog has nothing to offer and shows only *Default Access*. Section 6.1 lists App roles as
optional, which is true of the app and untrue of this screen — do that step first, then come
back. Two rarer causes of the same symptom:

- the role was created with **Allowed member types = Applications** instead of
  **Users/Groups** — a role for daemons cannot be assigned to a person;
- the role exists but is **disabled** (`isEnabled: false`).

A newly created role shows up in the assignment dialog straight away; if it does not,
reload the portal tab rather than recreating it.

#### Defining the app roles

Portal: **App registrations → your app → App roles → Create app role**.

| Field | Value |
|---|---|
| Display name | anything readable, e.g. `Planner` |
| Allowed member types | **Users/Groups** — not Applications |
| Value | `Planner`, `Approver`, or `Admin` — **this** is what lands in the token |
| Description | anything |

Only **Value** matters to the app. It is matched case-insensitively against `AppRole`, and
anything that is not one of ours is **ignored, not rejected** — the same account may hold
app roles for other applications, and that is none of this app's business. Repeat for each
role you want to hand out; there is no need to define all three.

The CLI equivalent, if you would rather not click. Each role needs its own fresh GUID, and
`az` replaces the whole array, so define them in one call:

```bash
APP_ID=<the app registration's appId>
cat > /tmp/app-roles.json <<'JSON'
[
  { "allowedMemberTypes": ["User"], "description": "Plans the rota",       "displayName": "Planner",  "isEnabled": true, "value": "Planner",  "id": "PLANNER_GUID" },
  { "allowedMemberTypes": ["User"], "description": "Approves requests",    "displayName": "Approver", "isEnabled": true, "value": "Approver", "id": "APPROVER_GUID" },
  { "allowedMemberTypes": ["User"], "description": "Administers settings", "displayName": "Admin",    "isEnabled": true, "value": "Admin",    "id": "ADMIN_GUID" }
]
JSON
# Substitute a distinct uuid for each placeholder before applying.
az ad app update --id $APP_ID --app-roles @/tmp/app-roles.json
```

`allowedMemberTypes: ["User"]` is what makes them assignable to people — it covers groups
too, despite the name.

#### Handing them out

**Enterprise applications → your app → Users and groups → Add user/group.** Pick the
person, then pick the role. If the app is missing from that blade entirely, `az ad sp
create --id $APP_ID` never ran and there is no instance to assign anything on.

**"Only one role can be selected."** That limit is per *assignment*, not per person. To
give somebody two roles, add them again and pick the second one — they then appear twice
in the list, once per role, and the token carries both. Each row is an independent
assignment and can be removed on its own.

This matters more here than in most apps, because **nothing is implied by ordering**
(ADR-0051): a global Admin who also has to plan needs a second assignment as Planner, not
a "higher" role. There is no role that contains another.

Scripted, one call per role — repeat with a different `appRoleId`:

```bash
SP_ID=$(az ad sp show --id $APP_ID --query id -o tsv)
USER_ID=$(az ad user show --id alice@example.com --query id -o tsv)
ROLE_ID=$(az ad app show --id $APP_ID --query "appRoles[?value=='Planner'].id | [0]" -o tsv)

az rest --method POST \
  --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$SP_ID/appRoleAssignedTo" \
  --headers "Content-Type=application/json" \
  --body "{\"principalId\":\"$USER_ID\",\"resourceId\":\"$SP_ID\",\"appRoleId\":\"$ROLE_ID\"}"
```

**Before stacking app roles, ask whether you want a database grant instead.** App roles
are global — `Planner` here means planner of *every* unit, which is the cross-unit role a
couple of people hold, not the normal case. Somebody who plans `unit-emea` and approves in
it wants two rows on **Settings → Roles**, scoped to that unit, which also take effect on
their next request instead of their next sign-in. Reach for app roles when the answer is
genuinely "across the whole thing", and for database grants otherwise.

#### What "unassigned" actually means

This is the part worth reading slowly, because "assignment" sounds like permission to use
the app and is not:

| | Can sign in? | Gets a `roles` claim? | Rights in the app |
|---|---|---|---|
| Not listed under Users and groups | **yes** | no | Viewer — reads the rota, writes nothing |
| Listed, with a role | yes | yes | that role, **globally** |

By default **Properties → "Assignment required?" is No**, so anyone in your tenant can sign
in whether or not you have ever heard of them. Assignment does not gate the door; it only
decides whether the token carries a `roles` claim at all. An unassigned user therefore
signs in perfectly, sees the rota, and can change nothing — which looks like a broken
account and is the intended default.

So the failure mode to recognise is: *"they signed in fine, so the app must be broken"* —
no, they are a Viewer, and the fix is an assignment here or a grant on Settings → Roles.

Assigning nobody is a valid, and initially the normal, state: everyone signs in as Viewer
and every real right comes from Settings → Roles. If you would rather the app refuse
unknown people outright, set **Assignment required? → Yes**; then only the listed accounts
can sign in at all.

#### Two traps

- **Group membership is not read.** The app looks at the `roles` claim and nothing else, so
  assigning a *group* to an app role works (the members get the role), but emitting a
  `groups` claim and expecting it to mean something does not.
- **A role change needs a new token, not a reload.** Refreshing the page reuses the cached
  one. Sign out, or clear `sessionStorage` for the site, then sign in again. Database
  grants have no such delay — they are read per request, which is one more reason to prefer
  them for anything that changes.

#### Checking what actually arrived

```bash
# In the app: Settings → Roles lists the database grants.
# From the API, as the signed-in user — this is the union, after transformation:
curl -H "Authorization: Bearer <token>" https://<api-host>/api/auth/me
# -> { "personId": "...", "displayName": "...", "roles": [...], "stubMode": false }
```

If `roles` holds only `Viewer` when you expected more: the app-role assignment is missing
or the token predates it, and the database grant — if there was meant to be one — is on a
different unit than the screen you are looking at.

## 7. Deploy (sandbox)

```bash
kubectl create namespace shift-o-mator --dry-run=client -o yaml | kubectl apply -f -

# pass 1: API only, to learn its LoadBalancer IP (see "Building container images" above)
helm upgrade --install shift-o-mator ./deploy/helm/shift-o-mator \
  -f ./deploy/helm/shift-o-mator/values.yaml \
  -f ./deploy/helm/shift-o-mator/values-sandbox.yaml \
  --set image.api.tag=<tag> --set image.web.tag=<tag> \
  --namespace shift-o-mator

kubectl -n shift-o-mator get svc shift-o-mator-api -w   # wait for EXTERNAL-IP

# pass 2: now build+push the web image with that address, then redeploy
API_IP=$(kubectl -n shift-o-mator get svc shift-o-mator-api -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
# (build+push web:<tag> with --build-arg VITE_API_URL=http://$API_IP, see section 4)

helm upgrade shift-o-mator ./deploy/helm/shift-o-mator \
  -f ./deploy/helm/shift-o-mator/values.yaml \
  -f ./deploy/helm/shift-o-mator/values-sandbox.yaml \
  --set image.api.tag=<tag> --set image.web.tag=<tag> \
  --namespace shift-o-mator
```

Verify:

```bash
kubectl -n shift-o-mator get pods
curl http://$API_IP/health/live
curl http://$API_IP/health/ready     # 200 once the database is reachable
curl http://$API_IP/api/setup/state  # {"required":true,...} until the wizard has run
```

The API pod can legitimately sit in `Running` but not `Ready` for a minute or two on the
first deploy: migrations and seeding run before the server listens, and Azure SQL
Serverless may be resuming from auto-pause. That is what the `startupProbe` is for — it
gives that up to five minutes before liveness starts, so what used to look like
`CrashLoopBackOff` is now just a slow first start. `kubectl -n shift-o-mator logs -l
app.kubernetes.io/component=api` shows where it is.

Then open the web address in a browser: the app shows the **setup wizard** (ADR-0059), not
the planning grid, until somebody picks Bare or Demo. Section 6.2 covers linking your Entra
identity to a person if it does not recognise you.

**Cost control:**

```bash
az aks stop --name $AKS --resource-group $RG     # stop paying for the node overnight
az aks start --name $AKS --resource-group $RG    # resume

az group delete --name $RG --yes --no-wait       # delete everything, guaranteed $0 going forward
```

The Standard Load Balancer and the Basic ACR are the two pieces that aren't strictly free
even with the cluster stopped — delete the resource group, not just stop the cluster, when
done for good.

## 8. Production — not built yet

No production environment exists and none is planned imminently. Recorded here only so
the shape is understood in advance, deliberately as commands rather than a script or a
Bicep template — writing infra-as-code for a process that's never been run once tends to
encode wrong assumptions. Revisit this section (and consider a Bicep/ARM template at that
point, once the real requirements — region, HA, backup policy — are known) when
production is actually being planned.

The difference from the sandbox (section 5) is entirely in how Key Vault access is
granted: Azure AD Workload Identity (a user-assigned identity federated with the
cluster's OIDC issuer for one specific service account), instead of the AKS add-on's own
identity. This is what `azureKeyVault.authMethod: workloadIdentity` in `values.yaml`
(the default) selects, and what `values-prod.yaml` is written against.

```bash
RG=shift-o-mator-prod-rg
LOCATION=westeurope
AKS=shift-o-mator-prod-aks
ACR=shiftomatorprod
KV=shift-o-mator-prod-kv
IDENTITY=shift-o-mator-prod-identity
NAMESPACE=shift-o-mator

# The resource group, cluster and database are NOT repeated here — they are section 5's
# commands with production sizing (more than one node, no Spot, a database that is not on
# the free-tier quota). Run those first; this block is only what differs.
az group create --name $RG --location $LOCATION
# ... az aks create / az sql server create / az sql db create, per section 5 ...

az acr create -g $RG -n $ACR --sku Basic

az aks update -g $RG -n $AKS --enable-oidc-issuer --enable-workload-identity
az aks enable-addons -g $RG -n $AKS --addons azure-keyvault-secrets-provider
az aks update -g $RG -n $AKS --attach-acr $ACR

OIDC_ISSUER=$(az aks show -g $RG -n $AKS --query "oidcIssuerProfile.issuerUrl" -o tsv)

# No vault by default: SQL and the model are both reached by managed identity, and the
# connection string and JWT settings are ConfigMap values (see "What Key Vault is for" in
# section 5). Create one only for a SQL password or a key-authenticated model endpoint,
# and set azureKeyVault.enabled: true with the matching entry under azureKeyVault.secrets.
# az keyvault create -g $RG -n $KV --location $LOCATION

az identity create -g $RG -n $IDENTITY
IDENTITY_CLIENT_ID=$(az identity show -g $RG -n $IDENTITY --query clientId -o tsv)
IDENTITY_PRINCIPAL_ID=$(az identity show -g $RG -n $IDENTITY --query principalId -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)

# --- AI explanations: an Azure OpenAI (Azure AI Foundry) deployment the *same* identity
#     may call. This is why production has no AI secret: one role assignment replaces a
#     key, a vault, a CSI mount and a rotation policy. Use the resource your tenant
#     already provides if there is one, and skip straight to the role assignment.
AOAI=shift-o-mator-prod-aoai
az cognitiveservices account create -g $RG -n $AOAI --kind OpenAI --sku S0 --location $LOCATION
az cognitiveservices account deployment create -g $RG -n $AOAI \
  --deployment-name gpt-4o-mini --model-name gpt-4o-mini --model-version "2024-07-18" \
  --model-format OpenAI --sku-name Standard --sku-capacity 10

AOAI_ID=$(az cognitiveservices account show -g $RG -n $AOAI --query id -o tsv)
az role assignment create --assignee-object-id $IDENTITY_PRINCIPAL_ID \
  --assignee-principal-type ServicePrincipal \
  --role "Cognitive Services OpenAI User" --scope $AOAI_ID

# Then in values-prod.yaml: aiProvider: azure-openai, aiEndpoint the resource URL
# (https://<aoai-name>.openai.azure.com/), aiModel the *deployment* name.

# Only needed if you created a vault above:
# az keyvault set-policy -n $KV --secret-permissions get list --object-id $IDENTITY_PRINCIPAL_ID

az identity federated-credential create \
  --name shift-o-mator-federation --identity-name $IDENTITY -g $RG \
  --issuer $OIDC_ISSUER \
  --subject system:serviceaccount:$NAMESPACE:shift-o-mator \
  --audience api://AzureADTokenExchange
```

Then give the identity a database user, exactly as in section 5 (`CREATE USER … FROM
EXTERNAL PROVIDER`) — but without `db_ddladmin` if migrations are being applied
out-of-band by then.

Put `$IDENTITY_CLIENT_ID` into `values-prod.yaml`'s `workloadIdentity.clientId` and
`$TENANT_ID` into `azureKeyVault.tenantId`. Deploy the same way as section 7, swapping
`values-sandbox.yaml` for `values-prod.yaml`, with an Application Gateway ingress
(`ingress.enabled: true`) instead of a bare LoadBalancer.

### Rollback

```bash
helm -n shift-o-mator history shift-o-mator
helm -n shift-o-mator rollback shift-o-mator <revision>
```

A failed deployment doesn't touch data — migrations/seeding run once at container startup
against whatever `ConnectionStrings:Schedule` points at; rolling back the Helm release
does not roll back the database.

## 9. Troubleshooting

| Symptom | Likely cause |
|---|---|
| API pod `CrashLoopBackOff`, log says `Missing ConnectionStrings:Schedule` | `api.config.connectionString` is empty in the values file for that environment |
| API pod starts, then SQL login fails for the managed identity | the `CREATE USER … FROM EXTERNAL PROVIDER` step (section 5) was skipped, or names the client id instead of the identity's **name** |
| SQL errors mentioning `CREATE TABLE` permission | the identity lacks `db_ddladmin`, which EF migrations need at startup |
| `Active Directory Default` picks the wrong identity, or none | the pod is missing `azure.workload.identity/use: "true"` — check `workloadIdentity.enabled` is true and the cluster has `--enable-workload-identity` |
| `403` on every write, `Settings` never appears for anyone | `Auth:StubRole` got set to something non-empty — it must stay empty; see CLAUDE.md, this exact bug happened once |
| `403 PRINCIPAL_NOT_MAPPED` for a real Entra ID user | nobody in the roster has that email in `Person.Email` — an admin links it on Settings → People (the error message names the address); if `GET /api/setup/state` still says `required: true` the setup wizard has not run yet (section 6.2). Also check the token carries an email claim for your tenant |
| Browser console: CORS error calling the API | the web origin isn't in `api.config.corsAllowedOrigins` for that environment's values file — or the app registration uses a "Web" platform instead of **SPA** (section 6.1), which surfaces the same way |
| Web app calls the wrong API host, or sends no token | the web image was built with the wrong (or no) `VITE_API_URL` / `VITE_AUTH_MODE` build-arg — rebuild, Helm values can't fix this after the fact |
| `SecretProviderClass` pod events show `AADSTS` errors | the federated credential's `--subject` doesn't match `system:serviceaccount:<namespace>:<serviceAccount.name>` exactly, or the identity lacks `get` on the Key Vault |

## What's still open

- No CI/CD pipeline — every build/push/deploy step above is manual, on purpose, until a
  registry and a real target exist to automate against.
- **`readOnlyRootFilesystem` is not on.** The pods run as uid 1000, non-root, with all
  capabilities dropped and `allowPrivilegeEscalation: false`, but the root filesystem is
  still writable: nginx writes its pid and temp paths and ASP.NET Core writes DataProtection
  keys under `$HOME`, so switching it on needs an `emptyDir` for each. Worth doing as the
  first task after the sandbox comes up green, when there is somewhere to prove it.
- **No `NetworkPolicy`, and no Content-Security-Policy.** Every pod can reach every other
  pod, and the web image ships the four cheap security headers but no CSP — `connect-src`
  would have to name the API origin, which is a build arg unknown to `nginx.conf`. Both
  want one real origin to be written against.
- **The frontend is one chunk.** ~730 KB of JS, no route-level code splitting; gzip in
  nginx takes it to roughly a quarter over the wire, which is why splitting has not been
  urgent.
- **Linking every other person is manual**, one email at a time on Settings → People.
  The setup wizard solves only the first one. For ~80 people that is tedious but
  tractable; a directory sync is the eventual answer and is deliberately not built
  (ADR-0058).
- **No token refresh across a closed tab.** `sessionStorage` is deliberate (shared
  machines), so each new browser session signs in again — silently, if the Entra session
  is alive.
