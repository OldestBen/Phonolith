import { NextRequest, NextResponse } from "next/server";
import { getUserFromSessionCookie, SESSION_COOKIE_NAME } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const user = await getUserFromSessionCookie(cookieValue);

  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  return NextResponse.json({
    user: { id: user.id, username: user.username, role: user.role },
  });
}
