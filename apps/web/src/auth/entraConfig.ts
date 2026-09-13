/**
 * Where the client learns whether it must sign anybody in, and against what.
 *
 * WHY this is a *client* setting and not read from the server: the token has to be on the
 * very first request, including the one to `/api/auth/me` that would have told us the
 * mode. Asking the server first would mean an unauthenticated call to find out that calls
 * must be authenticated.
 *
 * Settings come through `runtimeConfig.setting`, which prefers `window.__APP_CONFIG__`
 * (written by the container at start from `APP_*` env vars) over the `VITE_*` build-time
 * value — so one web image serves every environment (ADR-0068). Local development sets
 * `VITE_*` in `.env.development.local`, which is git-ignored, because a client id is
 * tenant-specific and not ours to commit.
 */

import type { Configuration, PopupRequest } from '@azure/msal-browser';
import { setting } from '../runtimeConfig';

/**
 * `entra` turns sign-in on. Anything else (including unset) leaves the app talking to a
 * server in `Auth:Mode=Stub`, which issues an identity without reading a token.
 *
 * WHY a mode flag rather than "entra if a client id is present": a half-configured
 * environment — a client id set, a scope forgotten — would silently behave as stub and
 * every request would be attributed to whoever the stub picked. An explicit mode makes
 * that a startup error instead (see `readRequired`).
 */
export const AUTH_MODE: 'stub' | 'entra' = setting('AUTH_MODE') === 'entra' ? 'entra' : 'stub';

export const isEntraMode = AUTH_MODE === 'entra';

function readRequired(name: string): string {
  const value = setting(name);
  if (!value) {
    throw new Error(
      `${name} is required when AUTH_MODE=entra (container: APP_${name}, local dev: VITE_${name}). ` +
        'See deploy/README.md — "Entra ID for local development".',
    );
  }
  return value;
}

/**
 * Built lazily, so a stub-mode build never evaluates it and never throws for missing
 * Entra settings it has no use for.
 */
export function msalConfiguration(): Configuration {
  const clientId = readRequired('ENTRA_CLIENT_ID');
  const tenantId = readRequired('ENTRA_TENANT_ID');

  return {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      // Defaults to the current origin, which is what both local dev (5173) and the
      // deployed SPA want. Registering that exact origin as a redirect URI is the
      // manual step the README spells out.
      redirectUri: setting('ENTRA_REDIRECT_URI') || window.location.origin,
      postLogoutRedirectUri: window.location.origin,
    },
    cache: {
      // sessionStorage, not localStorage: this is a planning tool used on shared and
      // hot-desked machines, and a token that outlives the browser session there is a
      // token the next person at that desk inherits. The cost is signing in again per
      // session, which is a silent redirect when the Entra session is still alive.
      cacheLocation: 'sessionStorage',
    },
  };
}

/**
 * The scope for *our* API — not Graph. Entra issues an access token whose audience is the
 * app registration exposing this scope, which is exactly what `Auth:Jwt:Audience`
 * validates against on the server (ADR-0058).
 *
 * WHY this must not be `User.Read` or any Graph scope: a Graph token has Graph's audience,
 * the API would reject it, and the failure reads as "signed in but everything is 401".
 */
export function apiTokenRequest(): Pick<PopupRequest, 'scopes'> {
  return { scopes: [readRequired('ENTRA_API_SCOPE')] };
}
