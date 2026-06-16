import { NextRequest, NextResponse } from "next/server";

// Cookie name must match SESSION_COOKIE_NAME in src/lib/auth.ts. Duplicated
// here (rather than imported) because middleware runs on the Edge runtime
// in Next.js 14 and cannot import src/lib/auth.ts, which depends on
// postgres.js / Node's `crypto` module (not Edge-compatible in this Next
// version).
const SESSION_COOKIE_NAME = "phonolith_session";

const PUBLIC_PATH_PREFIXES = [
  "/_next",
  "/favicon.ico",
  "/api/auth/setup",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/auth/session-status",
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

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // The actual setup/auth check needs Postgres and Node crypto, which this
  // Edge middleware can't use directly — so it asks the Node.js runtime
  // session-status route instead. This keeps the gating decision (and the
  // pathname it's based on) in one place, rather than forwarding pathname
  // to the root layout via a request header for it to redo the check —
  // a previous approach that could silently fall back to treating any
  // pathname as "/" and create a redirect loop back to /setup.
  const statusRes = await fetch(new URL("/api/auth/session-status", req.url), {
    headers: { cookie: req.headers.get("cookie") ?? "" },
  });
  const status = await statusRes.json().catch(() => ({ needsSetup: false, authenticated: false }));

  if (status.needsSetup) {
    return NextResponse.redirect(new URL("/setup", req.url));
  }
  if (!status.authenticated) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except static assets. We still run for API routes
     * (other than the auth ones excluded above) so that any future
     * non-auth API route also gets a baseline auth check.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
