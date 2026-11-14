import { NextResponse, type NextRequest } from 'next/server';

const PORTAL_PUBLIC = ['/portal/login', '/portal/register'];

/** Coarse route guard: staff console pages need the `sid` cookie; portal pages (except login/register) need `csid`. The API stays the authority (401 -> client redirect). */
export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (path === '/portal' || path.startsWith('/portal/')) {
    if (PORTAL_PUBLIC.some((p) => path === p || path.startsWith(`${p}/`)) || req.cookies.has('csid')) return NextResponse.next();
    const url = req.nextUrl.clone();
    const next = path + req.nextUrl.search;
    url.pathname = '/portal/login';
    url.search = next && next !== '/portal' ? `?next=${encodeURIComponent(next)}` : '';
    return NextResponse.redirect(url);
  }
  if (req.cookies.has('sid')) return NextResponse.next();
  const url = req.nextUrl.clone();
  const next = req.nextUrl.pathname + req.nextUrl.search;
  url.pathname = '/login';
  url.search = next && next !== '/' ? `?next=${encodeURIComponent(next)}` : '';
  return NextResponse.redirect(url);
}

export const config = {
  // staff: everything except login, the customer portal, API proxy, Next internals and static files; portal: /portal/*
  matcher: ['/((?!login|portal|api|_next|favicon.png|favicon.ico|.*\\..*).*)', '/portal/:path*'],
};
