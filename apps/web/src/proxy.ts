import { NextResponse, type NextRequest } from 'next/server';
import { rolesForPath } from '@if/shared';

/**
 * Route guard (Next.js "proxy", formerly middleware). Runs before any guarded page renders:
 *   anonymous            -> redirect to /login?next=<path>
 *   signed in, wrong role -> 403 "forbidden" page, and the attempt is reported to the API so it is audited
 * The rules come from @if/shared (ROUTE_RULES) - the same table the API tests assert against.
 * This is a UX guard; the API independently enforces every permission (never trust the browser).
 */
const API = process.env.API_URL ?? 'http://localhost:4000';

interface Me {
  roles: string[];
  csrfToken: string;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const allowed = rolesForPath(pathname);
  if (!allowed) return NextResponse.next();

  let me: Me | null = null;
  try {
    const r = await fetch(`${API}/api/v1/auth/me`, {
      headers: { cookie: req.headers.get('cookie') ?? '' },
      cache: 'no-store',
    });
    if (r.ok) me = (await r.json()) as Me;
  } catch {
    me = null; // API unreachable: fail closed (treated as signed out)
  }

  if (!me) {
    const url = new URL('/login', req.url);
    url.searchParams.set('next', pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (!me.roles.some((r) => (allowed as readonly string[]).includes(r))) {
    await fetch(`${API}/api/v1/auth/access-denied`, {
      method: 'POST',
      headers: {
        cookie: req.headers.get('cookie') ?? '',
        'content-type': 'application/json',
        'x-csrf-token': me.csrfToken,
      },
      body: JSON.stringify({ path: pathname.slice(0, 200) }),
      cache: 'no-store',
    }).catch(() => undefined);
    return NextResponse.rewrite(new URL('/forbidden', req.url), { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  // Skip Next internals, API rewrites and files with an extension (assets).
  matcher: ['/((?!api|_next/static|_next/image|.*\\..*).*)'],
};
