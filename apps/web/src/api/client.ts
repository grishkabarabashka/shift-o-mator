/**
 * NOTE: A thin fetch client on top of the generated `schema.d.ts`.
 *
 * WHY: Response bodies aren't typed via `schema.d.ts` — the backend's minimal
 * APIs return anonymous objects without `.Produces<T>()`, so the OpenAPI
 * document carries no response schemas (see `scripts/generate-api-schema.mjs`).
 * Paths, query parameters, and request bodies are typed via `paths` from the
 * schema; response bodies are typed by hand in `src/api/mapping.ts`, which
 * already has rich domain types (`domain/types.ts`) that the backend DTOs
 * mirror anyway.
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
 * NOTE: no `Authorization` header yet — stub auth issues an identity without reading a
 * token. This is where `Bearer` belongs once `Auth:Mode` switches to `EntraId`.
 */
export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      Accept: 'application/json',
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
