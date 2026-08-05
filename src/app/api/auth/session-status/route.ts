export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getUserFromSessionCookie, hasAnyUsers, SESSION_COOKIE_NAME } from "@/lib/auth";

// Called by middleware.ts (Edge runtime, no Postgres/Node crypto access) to
// make the actual gating decision: first-boot setup vs. login vs. authenticated.
// Internal use only — not meant to be a public API surface.
export async function GET(req: NextRequest) {
  const usersExist = await hasAnyUsers();
  if (!usersExist) {
    return NextResponse.json({ needsSetup: true, authenticated: false });
  }

  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const user = await getUserFromSessionCookie(cookieValue);

  return NextResponse.json({ needsSetup: false, authenticated: Boolean(user) });
}
