import { NextResponse, type NextRequest } from 'next/server';
import { allowTenantPaths, rootDomain } from '@/platform/env';
import { decideRoute } from '@/tenancy/route';

// Sends each request to the right part of the product based on its host. No database access here:
// the tenant itself is looked up (and checked) by the tenant layout.
export function proxy(request: NextRequest) {
  const decision = decideRoute(request.headers.get('host'), request.nextUrl.pathname, {
    rootDomain: rootDomain(),
    allowTenantPaths: allowTenantPaths(),
  });
  if (decision.action === 'next') return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = decision.action === 'rewrite' ? decision.path : '/_not-found';
  return NextResponse.rewrite(url, decision.action === 'not-found' ? { status: 404 } : undefined);
}

export const config = {
  matcher: ['/((?!_next/|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|gif|woff2)$).*)'],
};
