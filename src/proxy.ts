import { NextResponse, type NextRequest } from 'next/server';
import { refreshSession } from '@/auth/gotrue';
import { ACCESS_MAX_AGE, cookieOptions, REFRESH_MAX_AGE } from '@/auth/cookies';
import { ACCESS_COOKIE, needsRefresh, REFRESH_COOKIE } from '@/auth/tokens';
import { allowTenantPaths, rootDomain } from '@/platform/env';
import { BASE_PATH_HEADER, decideRoute } from '@/tenancy/route';

// Sends each request to the right part of the product based on its host, and keeps the session
// fresh on tenant pages. The tenant itself is looked up (and checked) by the tenant layout.
export async function proxy(request: NextRequest) {
  const decision = decideRoute(request.headers.get('host'), request.nextUrl.pathname, {
    rootDomain: rootDomain(),
    allowTenantPaths: allowTenantPaths(),
  });

  if (decision.action === 'not-found') {
    const url = request.nextUrl.clone();
    url.pathname = '/_not-found';
    return NextResponse.rewrite(url, { status: 404 });
  }

  const isTenantPage = decision.action === 'rewrite' || decision.basePath !== undefined;
  const headers = new Headers(request.headers);
  headers.delete(BASE_PATH_HEADER); // never trust a value sent by the visitor
  if (!isTenantPage) return NextResponse.next({ request: { headers } });
  headers.set(BASE_PATH_HEADER, decision.action === 'next' ? (decision.basePath ?? '') : '');

  // Renew the session shortly before it expires, and hand the new tokens to this same request.
  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  let renewed: { accessToken: string; refreshToken: string } | 'expired' | null = null;
  if (needsRefresh(access, refresh, Math.floor(Date.now() / 1000))) {
    const result = await refreshSession(refresh!);
    if (result.ok) renewed = result.value;
    else if (result.reason === 'invalid') renewed = 'expired';
    const others = request.cookies.getAll().filter((c) => c.name !== ACCESS_COOKIE && c.name !== REFRESH_COOKIE);
    const next = renewed && renewed !== 'expired'
      ? [...others, { name: ACCESS_COOKIE, value: renewed.accessToken }, { name: REFRESH_COOKIE, value: renewed.refreshToken }]
      : renewed === 'expired' ? others : request.cookies.getAll();
    headers.set('cookie', next.map((c) => `${c.name}=${c.value}`).join('; '));
  }

  let response: NextResponse;
  if (decision.action === 'rewrite') {
    const url = request.nextUrl.clone();
    url.pathname = decision.path;
    response = NextResponse.rewrite(url, { request: { headers } });
  } else {
    response = NextResponse.next({ request: { headers } });
  }
  if (renewed === 'expired') {
    response.cookies.delete(ACCESS_COOKIE);
    response.cookies.delete(REFRESH_COOKIE);
  } else if (renewed) {
    response.cookies.set(ACCESS_COOKIE, renewed.accessToken, cookieOptions(ACCESS_MAX_AGE));
    response.cookies.set(REFRESH_COOKIE, renewed.refreshToken, cookieOptions(REFRESH_MAX_AGE));
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|gif|woff2)$).*)'],
};
