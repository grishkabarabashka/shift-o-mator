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

export const API_BASE_URL: string =
  ((import.meta.env as Record<string, string | undefined>).VITE_API_URL) ?? 'http://localhost:5106';

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

export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  // Awaited per request, not cached here: MSAL keeps its own cache and renews the token
  // when it is close to expiring, so asking every time is cheap and asking once is wrong.
  const token = await accessTokenProvider?.();

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(debugIdentity?.personId ? { 'X-Debug-PersonId': debugIdentity.personId } : {}),
      ...(debugIdentity?.role ? { 'X-Debug-Role': debugIdentity.role } : {}),
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
