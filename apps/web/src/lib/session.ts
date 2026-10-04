import { cookies } from 'next/headers';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  roles: string[];
  homePath: string;
  external?: boolean;
  csrfToken: string;
}

const API = process.env.API_URL ?? 'http://localhost:4000';

async function cookieHeader(): Promise<string> {
  const jar = await cookies();
  return jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

/** Server-side GET against the API, forwarding the browser's cookies. Returns null on any non-2xx or network error. */
export async function apiGet<T>(path: string): Promise<T | null> {
  const cookie = await cookieHeader();
  if (!cookie) return null;
  try {
    const r = await fetch(`${API}/api/v1${path}`, { headers: { cookie }, cache: 'no-store' });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Server-side lookup of the signed-in user (null when anonymous). */
export const getSessionUser = () => apiGet<SessionUser>('/auth/me');

/** Like apiGet, but keeps the status and problem code so a page can explain *why* something is unavailable. */
export async function apiGetResult<T>(
  path: string,
): Promise<{ status: number; data: T | null; code?: string }> {
  const cookie = await cookieHeader();
  if (!cookie) return { status: 401, data: null };
  try {
    const r = await fetch(`${API}/api/v1${path}`, { headers: { cookie }, cache: 'no-store' });
    const body = (await r.json().catch(() => null)) as (T & { code?: string }) | null;
    return r.ok
      ? { status: r.status, data: body as T }
      : { status: r.status, data: null, ...(body?.code ? { code: body.code } : {}) };
  } catch {
    return { status: 0, data: null };
  }
}
