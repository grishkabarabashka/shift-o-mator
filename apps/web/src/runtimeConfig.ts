/**
 * Where a client setting comes from, and in what order.
 *
 * WHY this exists at all: Vite inlines `import.meta.env.VITE_*` at build time, so a value
 * read that way is frozen into the bundle and a deployed image carries the environment it
 * was built for. That made the web image un-promotable — sandbox and prod differ in API
 * origin and in Entra client/tenant id — and forced a two-pass deploy. `window.__APP_CONFIG__`
 * is written by the container at start (`apps/web/docker-entrypoint.d/40-config.sh`) from
 * `APP_*` environment variables, so one image serves every environment (ADR-0068).
 *
 * WHY a classic script and not a fetch: `auth/entraConfig.ts` reads these synchronously
 * while building the MSAL configuration, and the token has to be on the very first request.
 * `<script src="/config.js">` in `<head>` runs before the deferred module bundle, so the
 * values are already here by the time any of this evaluates. Fetching them would mean an
 * async boot phase in front of sign-in.
 *
 * WHY this file imports nothing: it sits below `api/` and `auth/` both, which are on
 * different levels of `features → store → api → engine → domain`. A leaf with no imports
 * adds no edge to that graph and can be read from anywhere.
 */

declare global {
  interface Window {
    __APP_CONFIG__?: Record<string, string | undefined>;
  }
}

const runtime: Record<string, string | undefined> =
  typeof window === 'undefined' ? {} : (window.__APP_CONFIG__ ?? {});

const build = import.meta.env as Record<string, string | undefined>;

/**
 * `name` is the bare setting — `API_URL`, `ENTRA_CLIENT_ID`. The container supplies it as
 * `APP_<name>` and `config.js` writes it under the bare key; local development supplies it
 * as `VITE_<name>` in `.env.development.local`.
 *
 * WHY `name in runtime` rather than a truthiness check: the container writes all six keys,
 * some of them deliberately empty. An empty `API_URL` is the *correct* value behind the
 * ingress — the app and the API share one origin, so `${''}/api/...` is the right request.
 * Falling through to the build-time value on empty would send a production bundle to
 * whatever the image happened to be built with, or to the localhost default below it.
 *
 * WHY `''` survives but `undefined` does not: callers distinguish them with `??`. An absent
 * key means "nobody configured this" and lets a caller apply its own default; an empty one
 * means "configured, and the answer is empty".
 */
export function setting(name: string): string | undefined {
  const raw = name in runtime ? runtime[name] : build[`VITE_${name}`];
  return raw === undefined ? undefined : raw.trim();
}
