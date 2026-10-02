import { cookies } from 'next/headers';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  roles: string[];
  homePath: string;
  csrfToken: string;
}

const API = process.env.API_URL ?? 'http://localhost:4000';

/** Server-side lookup of the signed-in user (null when anonymous). Forwards the browser's cookies to the API. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const cookie = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  if (!cookie) return null;
  try {
    const r = await fetch(`${API}/api/v1/auth/me`, { headers: { cookie }, cache: 'no-store' });
    return r.ok ? ((await r.json()) as SessionUser) : null;
  } catch {
    return null;
  }
}
