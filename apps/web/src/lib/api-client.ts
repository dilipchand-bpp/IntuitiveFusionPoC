/** Browser-side JSON calls to the API through the same-origin rewrite. Adds the CSRF header on every mutation. */
export interface ApiProblem {
  status: number;
  code: string;
  title: string;
  errors?: Array<{ field: string; message: string }>;
}

export class ApiError extends Error {
  constructor(public readonly problem: ApiProblem) {
    super(problem.title);
    this.name = 'ApiError';
  }
}

export async function api<T>(
  path: string,
  opts: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    csrf?: string;
    idempotencyKey?: string;
  } = {},
): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && opts.csrf) headers['x-csrf-token'] = opts.csrf;
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError({
      status: 0,
      code: 'NETWORK',
      title: 'Could not reach the server. Please check your connection and try again.',
    });
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiProblem>) | null;
  if (!res.ok) {
    throw new ApiError({
      status: res.status,
      code: data?.code ?? 'ERROR',
      title: data?.title ?? 'Something went wrong. Please try again.',
      ...(data?.errors ? { errors: data.errors } : {}),
    });
  }
  return data as T;
}
