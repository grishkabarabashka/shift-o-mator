/**
 * NOTE: A thin fetch client. Paths and bodies are typed by the callers in
 * `src/api/*`, against `domain/types.ts`.
 *
 * WHY no generated types: there used to be a committed `schema.d.ts`
 * (5 400 lines) produced from the backend's OpenAPI document, plus a script
 * that installed an isolated `openapi-typescript` because it could not run
 * against this project's TypeScript. Nothing ever imported it — the minimal
 * APIs return anonymous objects without `.Produces<T>()`, so the document
 * carries no response schemas, and every response was hand-typed anyway. A
 * generated file nobody reads is not type safety, it is a file to keep in
 * sync. If we want types from the server, the fix is `.Produces<T>()` on the
 * endpoints first — a generator on top of a document with no response shapes
 * cannot produce anything worth importing.
 */

import { setting } from '../runtimeConfig';

/**
 * Empty is a legal — and behind an ingress the correct — value: the app and the API share
 * one origin there, so the prefix is nothing and `/api/...` goes to the same host. The
 * localhost default applies only when the setting is absent entirely, which is `npm run dev`
 * without an `.env.development.local`. `??` is what keeps those two cases apart (ADR-0068).
 */
export const API_BASE_URL: string = setting('API_URL') ?? 'http://localhost:5106';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * The dev identity override. Only meaningful when the server runs `Auth:Mode=Stub`,
 * which is the only mode that reads these headers — see `StubAuthenticationHandler`.
 */
let debugIdentity: { personId?: string; role?: string } | undefined;

export function setDebugIdentity(next: { personId?: string; role?: string } | undefined): void {
  debugIdentity = next;
}

/**
 * The impersonation lens: an administrator viewing the product as somebody else
 * (ADR-0069). Unlike the `X-Debug-*` pair above this is honoured in every auth mode and
 * checked server-side against the caller's own Admin grant.
 *
 * WHY it is persisted in `sessionStorage` and read at module load: the Entra sign-in is a
 * **redirect** flow, so a token renewal reloads the page. Holding the subject only in React
 * state meant the lens silently closed mid-session and the screen quietly became the
 * administrator's own — the one failure that looks like nothing happening. Per tab, not per
 * browser: two tabs looking at two people is a reasonable thing to want, and a lens that
 * outlived the window would be a trap.
 */
const IMPERSONATION_KEY = 'sfm.impersonate';

function readStoredImpersonation(): string | undefined {
  try {
    return window.sessionStorage.getItem(IMPERSONATION_KEY) ?? undefined;
  } catch {
    // Private windows and blocked site data throw on access rather than returning null.
    return undefined;
  }
}

let impersonatedPersonId: string | undefined = readStoredImpersonation();

export function setImpersonation(personId: string | undefined): void {
  impersonatedPersonId = personId;
  try {
    if (personId) window.sessionStorage.setItem(IMPERSONATION_KEY, personId);
    else window.sessionStorage.removeItem(IMPERSONATION_KEY);
  } catch {
    // Not fatal: the lens then lasts until the next reload, which is the old behaviour.
  }
}

export function getImpersonation(): string | undefined {
  return impersonatedPersonId;
}

/**
 * How a request gets its bearer token, when there is one to get.
 *
 * WHY injected rather than imported: layering runs `features → store → api → …`, and MSAL
 * lives above this file in `auth/`. Importing it here would invert that, and would also
 * pull the whole library into a stub-mode build that never signs anybody in.
 *
 * Returning `undefined` means "no token" — the correct answer in stub mode, where the
 * server issues an identity without reading one.
 */
type AccessTokenProvider = () => Promise<string | undefined>;

let accessTokenProvider: AccessTokenProvider | undefined;

export function setAccessTokenProvider(next: AccessTokenProvider | undefined): void {
  accessTokenProvider = next;
}

/**
 * NOTE: The token provider itself failed — no request was made.
 *
 * WHY it is its own type: this used to propagate as whatever MSAL threw, from *before*
 * `fetch`, so there was no request in the network panel and no status anywhere. Every
 * caller that distinguishes failures does it with `instanceof ApiError`, so the symptom
 * was "no response" and a blank screen, with the real reason — a scope the app
 * registration does not expose, a consent that was never given — visible nowhere.
 */
export class AuthTokenError extends Error {
  constructor(override readonly cause: unknown) {
    super(
      `Could not get an access token: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'AuthTokenError';
  }
}

export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  // Awaited per request, not cached here: MSAL keeps its own cache and renews the token
  // when it is close to expiring, so asking every time is cheap and asking once is wrong.
  let token: string | undefined;
  try {
    token = await accessTokenProvider?.();
  } catch (error) {
    throw new AuthTokenError(error);
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(debugIdentity?.personId ? { 'X-Debug-PersonId': debugIdentity.personId } : {}),
      ...(debugIdentity?.role ? { 'X-Debug-Role': debugIdentity.role } : {}),
      ...(impersonatedPersonId ? { 'X-Impersonate-PersonId': impersonatedPersonId } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await parseBody(res);
    const message =
      (typeof body === 'object' && body && 'message' in body
        ? String((body as { message?: unknown }).message)
        : undefined) ?? `${res.status} ${res.statusText} for ${path}`;
    throw new ApiError(res.status, body, message);
  }

  if (res.status === 204) return undefined as T;
  return (await parseBody(res)) as T;
}

export function apiGet<T = unknown>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'GET' });
}

export function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

export function apiPut<T = unknown>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'PUT', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

export function apiDelete<T = unknown>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'DELETE' });
}

/** Query string builder that drops `undefined`/empty values. */
export function qs(params: Record<string, string | undefined>): string {
  const parts = Object.entries(params)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}
