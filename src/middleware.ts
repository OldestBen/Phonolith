import { NextRequest, NextResponse } from "next/server";

// Cookie name must match SESSION_COOKIE_NAME in src/lib/auth.ts. Duplicated
// here (rather than imported) because middleware runs on the Edge runtime
// in Next.js 14 and cannot import src/lib/auth.ts, which depends on
// postgres.js / Node's `crypto` module (not Edge-compatible in this Next
// version).
const SESSION_COOKIE_NAME = "phonolith_session";

// Shared token for service-to-service calls (analyst, lucid -> app). Mirrors the
// fallback in src/lib/auth.ts's getInternalServiceToken(). A plain compare is
// fine here — this is only a coarse "let it reach the handler" gate; the route
// itself still verifies the token with a timing-safe check.
const INTERNAL_SERVICE_TOKEN =
  process.env.INTERNAL_SERVICE_TOKEN || "phonolith-dev-internal-token-not-for-production";

const PUBLIC_PATH_PREFIXES = [
  "/_next",
  "/favicon.ico",
  "/api/auth/setup",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/auth/session-status",
];

// Internal service-to-service routes called by the sidecars (analyst → app)
// with an X-Internal-Token header rather than a browser session cookie. They
// enforce that token in their own handlers (verifyInternalServiceToken), so
// they must bypass the session gate here — otherwise middleware redirects them
// to /login and, since they carry no session, all scanning/ingest silently
// breaks. Kept as an exact-match list (not a prefix) to keep the exemption
// tight to exactly these routes.
const INTERNAL_SERVICE_PATHS = [
  "/api/library/ingest",
  "/api/library/known-files",
  "/api/library/pending-analysis",
];

const PUBLIC_PAGES = ["/setup", "/login"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return true;
  }
  if (INTERNAL_SERVICE_PATHS.includes(pathname)) {
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

  // Service-to-service calls (analyst, lucid) authenticate with a shared token
  // header rather than a browser session. Let any request carrying the correct
  // token through the session gate — otherwise middleware redirects them to
  // /login and internal features (ingest, streaming) break. The destination
  // route re-verifies the token itself.
  const internalToken = req.headers.get("x-internal-token");
  if (internalToken && internalToken === INTERNAL_SERVICE_TOKEN) {
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
