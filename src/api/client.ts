/**
 * Тонкий fetch-клиент поверх сгенерированного `schema.d.ts`.
 *
 * Не типизирует тела ответов через `schema.d.ts` — минимальные API бэкенда
 * возвращают анонимные объекты без `.Produces<T>()`, поэтому OpenAPI-документ
 * не несёт response-схем (см. `scripts/generate-api-schema.mjs`). Пути,
 * параметры запроса и тела запросов типизированы через `paths` из схемы; тела
 * ответов типизируются вручную в `src/api/mapping.ts` — там уже есть богатые
 * доменные типы (`domain/types.ts`), которые бэкендовые DTO и так зеркалят.
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
 * Стаб-аутентификация (Phase 4) не требует заголовка — `StubAuthenticationHandler`
 * выдаёт фиксированную identity на каждый запрос без чтения токена. Место для
 * `Authorization: Bearer` — здесь, когда `Auth:Mode` на сервере переключится на
 * `EntraId` (см. `src/auth/AuthProvider.tsx`).
 */
export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      Accept: 'application/json',
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
