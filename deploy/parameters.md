# Deployment parameters

One sheet per environment, filled in **before** deploying and kept after: every value below
is either produced by a command in `README.md` or chosen once, and most of them are needed
again by a step that comes much later — the web runtime config is set three sections after
the app registration created the values it needs, and the SPA redirect URI cannot be set
until the ingress has an address.

Copy the tables, fill the **Value** column, keep the filled copy wherever the team keeps
operational notes. **Nothing here is a secret** except the two rows marked so; those two
never go in a file that is committed.

> Why a sheet rather than the values files themselves: about half of these are *inputs* to
> the values files and to `podman build`, not settings — a tenant id, an object id, an
> issuer URL. They exist only in the shell that produced them, and the second person to
> deploy has no way to re-derive some of them without recreating resources.

---

## A. Azure — infrastructure

| # | Parameter | Value | Where it comes from | Where it is used |
|---|---|---|---|---|
| A1 | Subscription id | | `az account show --query id -o tsv` | every `az` command's context |
| A2 | Tenant id | | `az account show --query tenantId -o tsv` | `api.config.jwtAuthority`, `web.config.entraTenantId`, `azureKeyVault.tenantId` |
| A3 | Resource group | | chosen | all `az` commands |
| A4 | Location | | chosen | resource creation |
| A5 | AKS cluster name | | chosen | `az aks *`, `get-credentials` |
| A6 | Kubernetes namespace | | chosen (`shift-o-mator`) | `helm --namespace`, the federated credential's subject |
| A7 | Helm release name | | chosen (`shift-o-mator`) | **prefixes every resource name** — `<release>-api`, `<release>-web`, `<release>-api-config` |
| A8 | OIDC issuer URL | | `az aks show -g $RG -n $AKS --query oidcIssuerProfile.issuerUrl -o tsv` | `az identity federated-credential create --issuer` |
| A9 | Managed identity **name** | | `az identity create -n <name>` | `CREATE USER [<name>] FROM EXTERNAL PROVIDER` — the name, never the client id |
| A10 | Identity client id | | `az identity show --query clientId -o tsv` | `workloadIdentity.clientId` → service account annotation, SecretProviderClass |
| A11 | Identity principal (object) id | | `az identity show --query principalId -o tsv` | `az role assignment create --assignee-object-id`, Key Vault policy |
| A12 | Federated credential subject | | `system:serviceaccount:<A6>:<serviceAccount.name>` | must match character for character, or the token exchange fails with `AADSTS` |
| A13 | SQL server name → FQDN | | `az sql server create` → `<name>.database.windows.net` | `api.config.connectionString` |
| A14 | SQL database name | | chosen (`ShiftOMator`) | `Initial Catalog=` in the same string |
| A15 | SQL Entra admin UPN / object id | | `az ad signed-in-user show` | `az sql server create --external-admin-*`; this is who may run the `CREATE USER` |
| A16 | Firewall: your public IP | | `curl -s ifconfig.me` (record it — CGNAT hands out different ones) | `az sql server firewall-rule create` |
| A17 | Azure OpenAI resource name | | `az cognitiveservices account create` | endpoint below |
| A18 | AI endpoint | | `https://<A17>.openai.azure.com/` | `api.config.aiEndpoint` |
| A19 | AI **deployment** name | | `--deployment-name` (not the model family) | `api.config.aiModel` |
| A20 | Ingress controller IP | | `kubectl -n app-routing-system get svc nginx -o jsonpath='{.status.loadBalancer.ingress[0].ip}'` | the host below |
| A21 | Public host | | `<A20>.nip.io` (sandbox) or a real DNS name | `ingress.host`, the SPA redirect URI (`web.config.apiUrl` stays empty — see section E) |
| A22 | TLS secret name | | `kubectl create secret tls` | `ingress.tls.secretName` |
| A23 | Key Vault name — *only if `azureKeyVault.enabled`* | | `az keyvault create` | `azureKeyVault.keyvaultName` |

## B. Container registry

| # | Parameter | Value | Notes |
|---|---|---|---|
| B1 | GHCR owner (lowercase) | | `image.registry: ghcr.io/<owner>`; ghcr.io rejects uppercase in a path |
| B2 | **PAT with `write:packages`** — secret | | classic token; a fine-grained one cannot manage packages. Used to push and to create the pull secret |
| B3 | Pull secret name | | `ghcr-pull-secret` → `image.pullSecrets[].name`; **per cluster**, recreate it for every environment |
| B4 | Email for the pull secret | | `kubectl create secret docker-registry --docker-email` |
| B5 | Image tag | | git sha or release tag, **never `latest`**; passed as `--set image.api.tag=` *and* `--set image.web.tag=` |
| B6 | Package visibility | | private by default — that is why B3 exists at all |

## C. Entra ID app registration

| # | Parameter | Value | Where it comes from | Where it is used |
|---|---|---|---|---|
| C1 | Application (client) id | | `az ad app create --query appId` | `web.config.entraClientId` |
| C2 | Application ID URI | | `api://<C1>` | `api.config.jwtAudience` (the bare id is accepted too) |
| C3 | Authority | | `https://login.microsoftonline.com/<A2>/v2.0` | `api.config.jwtAuthority` |
| C4 | Scope name | | `access_as_user`, added under Expose an API | `web.config.entraApiScope = api://<C1>/access_as_user` |
| C5 | SPA redirect URIs (**a list**) | | portal → Authentication → **SPA** platform | `http://localhost:5173` for local, `https://<A21>` per environment. Must be the SPA platform, and must be HTTPS outside localhost |
| C6 | App role ids (3 × uuid) | | only if directory roles get switched on | the manifest's `appRoles`; assignment lives under Enterprise applications |
| C7 | `requestedAccessTokenVersion` | | app manifest | decides whether `aud` is `api://<id>` or the bare id — the API accepts both, so record it only to explain a token you are reading |
| C8 | Who is assigned | | Enterprise applications → Users and groups | nothing in the product shows this |

## D. Helm values to fill per environment

`image.registry` · `image.pullSecrets[].name` · `replicaCount.{api,web}` · `api.env` ·
`api.resources` · `api.service.type` · `api.config.{authMode, corsAllowedOrigins,
connectionString, jwtAuthority, jwtAudience, aiProvider, aiEndpoint, aiModel}` ·
`web.service.type` · `web.config.{apiUrl, authMode, entraClientId, entraTenantId,
entraApiScope, entraRedirectUri}` ·
`ingress.{enabled, className, host, tls.enabled, tls.secretName}` ·
`azureKeyVault.{enabled, authMethod, keyvaultName, tenantId, secrets[]}` ·
`workloadIdentity.{enabled, clientId}` · `serviceAccount.{create, name}` — plus
`image.api.tag` / `image.web.tag`, which are `--set` only.

Three of these refuse to render rather than default: `image.registry`, both image tags, and
`ingress.host` when the ingress is enabled. That is deliberate — each one, left blank, used
to produce a deployment that failed minutes later somewhere unrelated.

## E. Web runtime config (`web.config.*`, ADR-0068)

Written into `config.js` by the container at start, from `APP_*` env vars the ConfigMap
supplies — **not** baked into the image at build time. One image works across every
environment; changing any of these is a Helm value change and a rollout, never a rebuild.

| # | Value | Value | Notes |
|---|---|---|---|
| E1 | `web.config.apiUrl` | | leave empty behind an ingress — the app's *own* origin is `/api` on the same host, nothing to name. Set an absolute URL only for a setup with no shared ingress |
| E2 | `web.config.authMode` | | `entra` in any deployed environment; must agree with `api.config.authMode`, and nothing checks that for you |
| E3 | `web.config.entraClientId` | | C1 |
| E4 | `web.config.entraTenantId` | | A2 |
| E5 | `web.config.entraApiScope` | | `api://<C1>/access_as_user` |
| E6 | `web.config.entraRedirectUri` | | leave empty unless the app is served from a different origin than it redirects to |

## F. API environment variables (what the ConfigMap emits)

| Env var | Source | Note |
|---|---|---|
| `ASPNETCORE_ENVIRONMENT` | `api.env` | `Production` everywhere deployed — `Development` would publish OpenAPI/Scalar |
| `ASPNETCORE_FORWARDEDHEADERS_ENABLED` | set by the chart when `ingress.enabled` | also clears the trusted-proxy list; see the ConfigMap's comment |
| `ConnectionStrings__ShiftOMator` | `api.config.connectionString` | renamed from `ConnectionStrings__Schedule`; an old ConfigMap crash-loops the pod |
| `Auth__Mode` | `api.config.authMode` | |
| `Auth__Jwt__Authority` / `__Audience` | `api.config.jwt*` | |
| `Auth__Jwt__RequireHttpsMetadata` | `appsettings.Production.json`, `true` | not templated; only lower it against a non-HTTPS test issuer |
| `Cors__AllowedOrigins__0..N` | `api.config.corsAllowedOrigins` | array indices, not a comma-separated string |
| `Ai__Provider` / `__Model` / `__Endpoint` | `api.config.ai*` | a misspelled provider throws at startup, on purpose |
| `Ai__ApiKey` — **secret** | Key Vault only | unset under `azure-openai`: the pod authenticates as itself |
| `Auth__StubPersonId` / `Auth__StubRole` | never set in a deployment | `StubRole` must stay empty even locally |
| `Auth__DirectoryRoles` | **must not exist** | moved to a database row (ADR-0063); present in configuration it throws at startup |

## G. Values that live in the product, not in configuration

Nothing here is deployed — these are decisions made in the running app, and there is no
file that records them. Write them down anyway: they decide who can do anything at all.

| # | Value | Where |
|---|---|---|
| G1 | Setup preset — Bare or Demo | first-run wizard, once per database |
| G2 | Founding administrator's work email | wizard; matched against the token's email claim |
| G3 | Which roles that founder got | wizard (`Admin` is forced; `Planner`/`Approver` optional) |
| G4 | Directory roles on/off | Settings → Roles; off by default, needs a **global** Admin to change |
| G5 | Per-unit role grants | Settings → Roles |
| G6 | `Person.Email` for everyone else | Settings → People, one at a time — nobody signs in without it |
| G7 | Holiday import allowlist host | Settings → Maintenance |
| G8 | Notification matrix | Settings → Notifications (nothing is delivered externally yet) |

## H. Operational record

| # | Value | Notes |
|---|---|---|
| H1 | Deployed image tags (api / web) | `helm -n <ns> get values <release>` does not show `--set` history beyond the current revision |
| H2 | Helm revision | `helm -n <ns> history <release>`; rollback does **not** roll back the database |
| H3 | Whether `db_ddladmin` is still granted | needed while migrations run at startup; drop it when they stop |
| H4 | `az aks stop` state | the cluster can be stopped overnight; the load balancer still bills |
