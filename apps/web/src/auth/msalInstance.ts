/**
 * The one `PublicClientApplication`, and the token function the fetch client calls.
 *
 * WHY a module-level singleton rather than React state: MSAL caches tokens and account
 * state on the instance, and `api/client.ts` needs a token from outside the component
 * tree. Two instances would mean two caches and a sign-in that only one of them knows
 * about.
 *
 * WHY `@azure/msal-browser` is imported dynamically: it is ~200 kB that a stub-mode build
 * never executes. A static import would put it in the main bundle for every environment,
 * including local development, where nothing signs anybody in. Every entry point here is
 * already async, so this costs nothing but the first-call load.
 */

import { apiTokenRequest, msalConfiguration } from './entraConfig.ts';
import type { AuthenticationResult, PublicClientApplication } from '@azure/msal-browser';

let instance: PublicClientApplication | undefined;
let initialization: Promise<PublicClientApplication> | undefined;

/**
 * Creates and initializes the instance, once.
 *
 * `initialize()` is not optional in msal-browser v3+: calling `acquireTokenSilent` or
 * `handleRedirectPromise` before it resolves throws. The promise is memoized rather than
 * the instance, so two concurrent callers during startup await the same initialization
 * instead of racing to build a second one.
 */
export function getMsalInstance(): Promise<PublicClientApplication> {
  initialization ??= (async () => {
    const msal = await import('@azure/msal-browser');
    const pca = new msal.PublicClientApplication(msalConfiguration());
    await pca.initialize();
    // Resolves the redirect we may have just come back from, and is a no-op otherwise.
    // Must happen before anything reads accounts, or the account that just signed in is
    // not there yet.
    const result = await pca.handleRedirectPromise();
    adoptAccount(pca, result);
    instance = pca;
    return pca;
  })();

  return initialization;
}

/**
 * Makes the signed-in account the active one.
 *
 * WHY it matters: `acquireTokenSilent` needs an account, and with none marked active MSAL
 * refuses rather than guessing — which surfaces as being signed in and still getting 401s.
 */
function adoptAccount(pca: PublicClientApplication, result: AuthenticationResult | null): void {
  if (result?.account) {
    pca.setActiveAccount(result.account);
    return;
  }
  if (!pca.getActiveAccount()) {
    const [first] = pca.getAllAccounts();
    if (first) pca.setActiveAccount(first);
  }
}

/**
 * Ends the session.
 *
 * `logoutRedirect` and not just clearing the cache: this app caches into `sessionStorage`
 * precisely because it runs on shared machines, and dropping our copy of the token while
 * leaving the Entra session alive would let the next person press "Sign in" and be
 * straight back in as the previous one.
 */
export async function signOut(): Promise<void> {
  const pca = instance ?? (await getMsalInstance());
  await pca.logoutRedirect();
}

/**
 * A token for our API, or `undefined` when nobody is signed in yet.
 *
 * Deliberately does **not** trigger interactive sign-in: this runs inside every
 * `apiFetch`, and a popup or redirect fired from an arbitrary background query is a
 * hijacked click. Interaction is the gate's job (`EntraGate`), which knows it is starting
 * from a user action. A silent failure here therefore returns nothing and lets the request
 * come back 401 — which the gate then resolves.
 */
export async function acquireApiToken(): Promise<string | undefined> {
  const pca = instance ?? (await getMsalInstance());
  const account = pca.getActiveAccount();
  if (!account) return undefined;

  try {
    const result = await pca.acquireTokenSilent({ ...apiTokenRequest(), account });
    return result.accessToken;
  } catch (error) {
    const { InteractionRequiredAuthError } = await import('@azure/msal-browser');
    if (error instanceof InteractionRequiredAuthError) return undefined;
    throw error;
  }
}
