# ADR-0068. Web config is read at container start, not baked in at build

**Status:** accepted.

## Context

Vite inlines every `import.meta.env.VITE_*` reference into the JS bundle at
`vite build` — a static replacement, not a runtime read. `apps/web/Dockerfile` therefore
took six `VITE_*` values as `--build-arg`s: the API origin, the auth mode, and the four
Entra ID settings (client id, tenant id, API scope, redirect URI). Once built, an image
carried whichever environment it was built for, permanently.

Two consequences of that were no longer acceptable:

- **An image cannot be promoted between environments.** Sandbox and production have
  different Entra app registrations (different client id and tenant id) and, before this
  ADR, `VITE_API_URL` was the environment's own public host. Moving a tested image from
  sandbox to production meant rebuilding it against production's values — the image
  under test and the image that ships were never the same bytes.
- **Every config change is a rebuild-and-push**, not a Helm value change. `deploy/
  README.md` section 7 already restructured the sandbox deploy once (ADR-era, pre-dating
  this decision) to build the web image only after the ingress controller had an address,
  specifically to avoid a *second* rebuild — but a rebuild for the *first* one remained
  unavoidable, and any later correction (a typo in a client id, a scope renamed on the app
  registration) still needed one.

The fix does not need Vite's build-time substitution touched at all: only two files ever
read a `VITE_*` value (`apps/web/src/api/client.ts`, `apps/web/src/auth/entraConfig.ts`),
and `apiFetch` already builds requests as `` `${API_BASE_URL}${path}` `` against paths like
`/api/...` — an empty `API_BASE_URL` was already the correct same-origin request behind an
ingress, nothing had to change there either.

## Decision

**The six settings are read from `window.__APP_CONFIG__` first, falling back to
`import.meta.env.VITE_*`.** `apps/web/src/runtimeConfig.ts` is the one place that decides,
and it is a leaf module — it imports nothing, so it adds no edge to the
`features → store → api → engine → domain` layering and is reachable from both `api/`
(below `auth/`) and `auth/` (above it).

```ts
export function setting(name: string): string | undefined {
  const raw = name in runtime ? runtime[name] : build[`VITE_${name}`];
  return raw === undefined ? undefined : raw.trim();
}
```

`name in runtime` rather than a truthiness check, because an empty string is a value the
container writes on purpose: `APP_API_URL=""` behind an ingress means "same origin, no
prefix", and that must not fall through to whatever the image happened to be built with.
`undefined` still falls through — that is the local-dev case, where no container writes
`window.__APP_CONFIG__` at all.

**A classic (non-module) `<script src="/config.js">` in `<head>`, loaded before the
deferred module bundle.** `auth/entraConfig.ts` builds the MSAL configuration
synchronously, and the access token is needed on the very first request — an async fetch
of a `/config.json` would have meant a loading phase in front of sign-in. A plain script
tag has no such ordering problem: it runs to completion before the module script below it
is even requested.

**The container writes that file at start.** `apps/web/docker-entrypoint.d/40-config.sh`
runs as part of nginx's own entrypoint machinery (`/docker-entrypoint.d/*.sh`, already
invoked by the base image before `exec nginx`) and renders `config.js` from `APP_*`
environment variables. `apps/web/public/config.js` is the checked-in placeholder —
`window.__APP_CONFIG__ = {}` — so a build outside a container (local dev, `npm run build`
without the entrypoint) leaves every key absent and every setting falls through to
`VITE_*` exactly as before.

**Fail loudly moved from the build to the start.** The old `apps/web/Dockerfile` refused a
blank `VITE_API_URL` at `docker build` time. That check is gone — a blank `APP_API_URL` is
now a legal, common value. In its place, the entrypoint script refuses to start if
`APP_AUTH_MODE=entra` and any of the three required Entra settings is blank, so a
misconfiguration still surfaces immediately (`CrashLoopBackOff` with a named missing
variable) rather than as a stub-mode client silently talking to a server that expects
tokens.

**Helm supplies the six settings via a ConfigMap and `envFrom`**, the same shape the API
deployment already used for its own config (`api-configmap.yaml`). `web-deployment.yaml`
carries a `checksum/config` annotation over `web-configmap.yaml`, matching the API
deployment's own — without it, a `helm upgrade` that only changes the ConfigMap does not
change the pod spec and the rollout never happens.

## Consequences

- **One web image serves every environment.** `image.web.tag` is now the only thing that
  differs between a sandbox and a production release of the frontend; promoting a tested
  image is a tag reference, not a rebuild.
- **`deploy/README.md` section 4 builds both images together**, before a cluster or an
  ingress exists — the web image no longer depends on knowing the environment's public
  host. Section 7's deploy step no longer builds anything; it only fills
  `values-sandbox.yaml`'s `web.config` block (from the app registration created in section
  6.1) and runs `helm upgrade`.
- **A config fix is `helm upgrade --set web.config.<key>=...`**, not a rebuild. The
  troubleshooting table in `deploy/README.md` now points at `kubectl exec <pod> -- cat
  /usr/share/nginx/html/config.js` to see what a running pod actually has.
- **`web.config.entraRedirectUri` stays empty in both deployed environments.**
  `entraConfig.ts`'s existing fallback (`window.location.origin`) already resolves the
  right value in the browser at runtime, so the ingress host does not need to be known at
  deploy time — section 7 no longer computes it before building anything, only when
  registering the SPA redirect URI in Entra itself.
- `apps/web/.env.example` and `deploy/parameters.md` section E now describe `web.config.*`
  Helm values, not build-args; `apps/web/.env.development.local` is unaffected — local
  development never runs the entrypoint script and keeps reading `VITE_*` exactly as
  before.

## Alternatives

- **Fetch a `/config.json` before rendering.** Rejected: it adds an async phase in front
  of `msalConfiguration()`, which today runs synchronously as part of module
  initialization. A classic script tag gets the same result — config available before any
  app code runs — with no loading state to add.
- **ConfigMap mounted as `config.js` directly** (a `volumeMount`, no entrypoint script).
  Considered and rejected only because it has no equivalent for `compose.yaml` / a bare
  `podman run` — the entrypoint script is one mechanism for both Kubernetes (`envFrom` a
  ConfigMap) and Compose (`environment:`), whereas a volume mount would need a separate,
  Compose-only way to get the same file in place for local container testing.
- **Keep `VITE_API_URL` as a build-arg and runtime-configure only the Entra settings.**
  Rejected for consistency: half the settings would still force a rebuild, and the
  `runtimeConfig.setting` contract (empty vs. absent) would need to exist for some keys
  and not others, which is a harder rule to keep than "all six, always".
