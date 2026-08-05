import { NextRequest, NextResponse } from "next/server";
import { destroySessionCookie, SESSION_COOKIE_NAME } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  await destroySessionCookie(cookieValue);

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE_NAME);
  return res;
}
