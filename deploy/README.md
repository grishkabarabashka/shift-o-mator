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
| **Where roles come from** | DB grants; app roles if signed in with Entra | both | Entra app roles, fed by whatever provisions the corporate directory, **plus** per-unit grants in the DB |
| **Database auth** | Windows auth (LocalDB) | managed identity | managed identity, *or* a service account + password if the database is standalone |
| **Key Vault** | none — user secrets | for the Anthropic key | for the Anthropic key, and for the SQL password if there is one |

Two consequences worth stating plainly:

- **Roles never come from Entra alone.** App roles can only be global — the directory has
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
  what makes `api://<app-id>/access_as_user` a real scope. Optionally **App roles** →
  add `Planner`/`Approver`/`Admin` and assign yourself under **Enterprise applications →
  Users and groups** (see section 6.3).

Then, client side — copy `apps/web/.env.example` to `apps/web/.env.development.local`
(git-ignored) and set:

```bash
VITE_AUTH_MODE=entra
VITE_ENTRA_CLIENT_ID=<app id>
VITE_ENTRA_TENANT_ID=<tenant id>
VITE_ENTRA_API_SCOPE=api://<app id>/access_as_user
```

And server side — `apps/api/src/ShiftOMator.Api/appsettings.Development.json`, or user
secrets (`dotnet user-secrets set …` from `apps/api/src/ShiftOMator.Api`):

```json
{
  "Auth": {
    "Mode": "EntraId",
    "Jwt": {
      "Authority": "https://login.microsoftonline.com/<tenant id>/v2.0",
      "Audience": "api://<app id>"
    }
  }
}
```

Finally, **run the setup wizard**: your work email must be in `Person.Email` for some
row, or every request comes back `403 PRINCIPAL_NOT_MAPPED` (section 6.2). On a fresh
database nobody is linked yet — open the app with Entra ID mode already switched on and
it shows the wizard, which creates you (Bare) or links you to the fixture's admin (Demo)
using the email in your token (ADR-0059). There is nothing to configure for this.

## 3. Configuration reference

Standard ASP.NET Core layering: `appsettings.json` → `appsettings.{Environment}.json` →
environment variables (`Section__Key`) → command line.

### Backend (`apps/api/src/ShiftOMator.Api/appsettings*.json`)

| Key | Local | Sandbox/Production | Notes |
|---|---|---|---|
| `ConnectionStrings:Schedule` | LocalDB, hardcoded | from Key Vault | SQL Server connection string |
| `Auth:Mode` | `Stub` | `EntraId` | switches `StubAuthenticationHandler` vs `AddJwtBearer` in `Program.cs` |
| `Auth:StubPersonId` / `Auth:StubRole` | empty (real grants) | unused in EntraId mode | **must stay empty** in Stub mode — see CLAUDE.md, this was a live bug once |
| `Auth:Jwt:Authority` | — | from Key Vault | `https://login.microsoftonline.com/<tenant-id>/v2.0` |
| `Auth:Jwt:Audience` | — | from Key Vault | the Entra ID app registration's Application ID URI |
| `Cors:AllowedOrigins` | `["http://localhost:5173"]` | the deployed web origin(s) | array — set via `Cors__AllowedOrigins__0`, `__1`, ... |
| `Ai:Provider` / `Ai:Model` | `anthropic` / `claude-opus-5` | same | non-secret |
| `ANTHROPIC_API_KEY` | user secrets or unset (AI returns 503) | from Key Vault | environment variable, not an `Ai:` key — see `ChatModel.FromConfiguration` |

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

**No SQL password anywhere**: the pod reaches SQL as its own managed identity. Key Vault
is still created, for the one thing that genuinely is a secret — the Anthropic API key.
See "What Key Vault is for" at the end of this section.

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

# --- Key Vault, read by the same identity. Only the Anthropic key lives here; skip the
#     whole block (and set azureKeyVault.enabled: false) if AI is not wanted.
az keyvault create --name $KV --resource-group $RG --location $LOCATION
az keyvault secret set --vault-name $KV -n shift-o-mator-anthropic-api-key --value "<anthropic api key>"

IDENTITY_PRINCIPAL_ID=$(az identity show -g $RG -n $IDENTITY --query principalId -o tsv)
az keyvault set-policy --name $KV --object-id $IDENTITY_PRINCIPAL_ID --secret-permissions get list

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
| `ANTHROPIC_API_KEY` | **Yes** | Key Vault |
| Connection string, **with a password** | **Yes** | Key Vault — see below |
| Connection string, managed identity | No — no credential in it | ConfigMap |
| `Auth:Jwt:Authority` | No — a public Microsoft URL | ConfigMap |
| `Auth:Jwt:Audience` | No — a public Application ID URI | ConfigMap |
| `VITE_ENTRA_CLIENT_ID` / scope | No — public by design in a SPA | Baked into the web image |

So the vault is not decoration, but it is also not on the critical path for SQL. Two
cases keep it:

1. **AI explanations** — the Anthropic key, which is what the sandbox provisions it for.
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
       - objectName: shift-o-mator-anthropic-api-key
         envVarName: ANTHROPIC_API_KEY
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
- **Expose an API → Add a scope** named `access_as_user`. Optionally **App roles** →
  `Planner`/`Approver`/`Admin`, assigned under **Enterprise applications → Users and
  groups** (section 6.3).

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

### 6.3 Roles: Entra ID app roles plus database grants

Both, and they add up:

- **Entra ID app roles** (the `roles` claim) are read and granted **globally**
  (`unitId: null`) — the directory has no idea what `unit-emea` is, so it can only say
  "this person administers the whole thing". Values must match `AppRole`
  (`Viewer`/`Planner`/`Approver`/`Admin`); anything else in the claim is ignored, since
  the same account may hold roles for other apps.
- **Per-unit grants** stay in the database, edited on Settings → Roles, and take effect on
  the next request rather than the next token refresh.
- **Someone in no list at all is a Viewer** — signs in fine, reads the rota, writes
  nothing. That's the existing behaviour for anyone with no grants, not a special case.

To define app roles on the registration, add them in the Azure portal under **App
registrations → your app → App roles** (value = `Planner`, `Approver`, or `Admin`), then
assign users under **Enterprise applications → your app → Users and groups**. Assigning
nobody is a valid state: everyone signs in as Viewer and per-unit grants come from
Settings → Roles.

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
```

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

az acr create -g $RG -n $ACR --sku Basic

az aks update -g $RG -n $AKS --enable-oidc-issuer --enable-workload-identity
az aks enable-addons -g $RG -n $AKS --addons azure-keyvault-secrets-provider
az aks update -g $RG -n $AKS --attach-acr $ACR

OIDC_ISSUER=$(az aks show -g $RG -n $AKS --query "oidcIssuerProfile.issuerUrl" -o tsv)

# Only the Anthropic key is secret; connection string and JWT settings are ConfigMap
# values (see "Do we need Key Vault?" in section 5). Skip the vault entirely if AI
# explanations are not wanted, and set azureKeyVault.enabled: false.
az keyvault create -g $RG -n $KV --location $LOCATION
az keyvault secret set --vault-name $KV -n shift-o-mator-anthropic-api-key --value "<anthropic api key>"

az identity create -g $RG -n $IDENTITY
IDENTITY_CLIENT_ID=$(az identity show -g $RG -n $IDENTITY --query clientId -o tsv)
IDENTITY_PRINCIPAL_ID=$(az identity show -g $RG -n $IDENTITY --query principalId -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)

az keyvault set-policy -n $KV --secret-permissions get list --object-id $IDENTITY_PRINCIPAL_ID

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
- **Linking every other person is manual**, one email at a time on Settings → People.
  The setup wizard solves only the first one. For ~80 people that is tedious but
  tractable; a directory sync is the eventual answer and is deliberately not built
  (ADR-0058).
- **No token refresh across a closed tab.** `sessionStorage` is deliberate (shared
  machines), so each new browser session signs in again — silently, if the Entra session
  is alive.
