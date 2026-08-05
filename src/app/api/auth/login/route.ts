import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { createSession, verifyPassword, SESSION_COOKIE_NAME } from "@/lib/auth";
import type { User } from "@/lib/types";

// password_hash is deliberately not part of the shared User type.
type UserWithHash = User & { password_hash: string };

const GENERIC_ERROR = "Invalid username or password.";

export async function POST(req: NextRequest) {
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const username = (body.username ?? "").trim();
  const password = body.password ?? "";

  if (!username || !password) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  const rows = await sql<UserWithHash[]>`
    SELECT id, username, password_hash, role, created_at
    FROM users
    WHERE username = ${username}
  `;
  const user = rows[0];

  // Always run verifyPassword (even with a dummy hash) so response timing
  // doesn't reveal whether the username exists.
  const hashToCheck = user?.password_hash ?? (await DUMMY_HASH());
  const valid = await verifyPassword(password, hashToCheck);

  if (!user || !valid) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  const { cookieValue, cookieOptions } = await createSession(user.id);

  const res = NextResponse.json({
    user: { id: user.id, username: user.username, role: user.role },
  });
  res.cookies.set(SESSION_COOKIE_NAME, cookieValue, cookieOptions);
  return res;
}

// A fixed, precomputed-shape placeholder so timing is consistent when the
// username doesn't exist. scrypt cost dominates either way; this just keeps
// the code path identical.
let cachedDummyHash: string | null = null;
async function DUMMY_HASH(): Promise<string> {
  if (cachedDummyHash) return cachedDummyHash;
  const { hashPassword } = await import("@/lib/auth");
  cachedDummyHash = await hashPassword("dummy-password-not-used");
  return cachedDummyHash;
}
