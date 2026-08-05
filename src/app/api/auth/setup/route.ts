import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { createSession, hasAnyUsers, hashPassword, SESSION_COOKIE_NAME } from "@/lib/auth";

export async function GET() {
  const usersExist = await hasAnyUsers();
  return NextResponse.json({ needsSetup: !usersExist });
}

export async function POST(req: NextRequest) {
  const usersExist = await hasAnyUsers();
  if (usersExist) {
    return NextResponse.json({ error: "Setup has already been completed." }, { status: 409 });
  }

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const username = (body.username ?? "").trim();
  const password = body.password ?? "";

  if (!username) {
    return NextResponse.json({ error: "Username is required." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }

  // Re-check under a transaction-like guard to minimize (not fully eliminate)
  // a race between two concurrent setup requests.
  const passwordHash = await hashPassword(password);

  let userId: number;
  try {
    const rows = await sql<{ id: number }[]>`
      INSERT INTO users (username, password_hash, role)
      VALUES (${username}, ${passwordHash}, 'admin')
      RETURNING id
    `;
    userId = rows[0].id;
  } catch {
    return NextResponse.json({ error: "Could not create the admin user." }, { status: 409 });
  }

  const { cookieValue, cookieOptions } = await createSession(userId);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, cookieValue, cookieOptions);
  return res;
}
