import { NextRequest, NextResponse } from "next/server";

// Cookie name must match SESSION_COOKIE_NAME in src/lib/auth.ts. Duplicated
// here (rather than imported) because middleware runs on the Edge runtime
// in Next.js 14 and cannot import src/lib/auth.ts, which depends on
// postgres.js / Node's `crypto` module (not Edge-compatible in this Next
// version). Node.js middleware runtimes are only available starting in
// later Next.js releases, so this middleware intentionally does the
// lightest possible check: is there a session cookie at all?
//
// The actual work — verifying the HMAC signature, looking up the session
// in Postgres, and checking whether any users exist yet (first-boot setup)
// — happens in the root layout server component (src/app/layout.tsx),
// which runs on the Node.js runtime and can safely use the database and
// Node crypto APIs.
const SESSION_COOKIE_NAME = "phonolith_session";

const PUBLIC_PATH_PREFIXES = [
  "/_next",
  "/favicon.ico",
  "/api/auth/setup",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
];

const PUBLIC_PAGES = ["/setup", "/login"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return true;
  }
  if (PUBLIC_PAGES.includes(pathname)) {
    return true;
  }
  return false;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Propagate the requested pathname to the root layout (a Node.js runtime
  // server component) via a request header, since the layout has no other
  // reliable way to know the current path in Next.js 14's App Router. The
  // layout uses this to decide whether to redirect to /setup or /login
  // after performing the DB-backed checks middleware can't do on Edge.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-phonolith-pathname", pathname);

  if (isPublicPath(pathname)) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const hasSessionCookie = Boolean(req.cookies.get(SESSION_COOKIE_NAME)?.value);

  if (!hasSessionCookie) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  // Cookie is present but may be expired/invalid/signed with a stale key,
  // or zero users may exist (first boot). Those checks require Postgres
  // and Node crypto, so they're enforced in the root layout instead.
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    /*
     * Match all paths except static assets. We still run for API routes
     * (other than the auth ones excluded above) so that any future
     * non-auth API route also gets a baseline cookie-presence check.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
