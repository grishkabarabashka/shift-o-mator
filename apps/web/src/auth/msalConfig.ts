/**
 * NOTE: MSAL configuration shape — a placeholder for the future, not wired up
 * to anything yet.
 *
 * Real Entra ID integration (`@azure/msal-browser`/`@azure/msal-react`) is not
 * Phase 4; this is only the typed shape that code will expect, so that flipping
 * `Auth:Mode` on the server from `Stub` to `EntraId` isn't a surprise on the
 * client when its turn comes.
 */

export interface MsalConfig {
  readonly auth: {
    readonly clientId: string;
    /** e.g. `https://login.microsoftonline.com/<tenant-id>` */
    readonly authority: string;
    readonly redirectUri: string;
  };
  readonly cache?: {
    readonly cacheLocation: 'localStorage' | 'sessionStorage';
  };
}

// Placeholder values only — not read by anything yet, and not a secret (MSAL client
// IDs/authorities are public by design; there is no client secret in a SPA flow).
export const msalConfig: MsalConfig = {
  auth: {
    clientId: '00000000-0000-0000-0000-000000000000',
    authority: 'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000',
    redirectUri: '/',
  },
  cache: {
    cacheLocation: 'sessionStorage',
  },
};
