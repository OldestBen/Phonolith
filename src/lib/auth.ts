import crypto from "crypto";
import { sql } from "@/lib/db";
import type { User } from "@/lib/types";

// The `users` table has a password_hash column that is intentionally not
// part of the shared `User` type (callers outside this module should never
// see it). Queries that need to read it locally use this extended type.
type UserWithHash = User & { password_hash: string };

const SESSION_COOKIE = "phonolith_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Derive a stable 32-byte HMAC signing key from the CREDENTIAL_KEY env var,
 * mirroring the convention in src/lib/crypto.ts: if CREDENTIAL_KEY is a
 * 64-char hex string, use it directly as key bytes; otherwise fall back to
 * a SHA-256 hash of DATABASE_URL (or a fixed dev string) so the app doesn't
 * hard-crash when CREDENTIAL_KEY is unset.
 */
function getSigningKey(): Buffer {
  const keyHex = process.env.CREDENTIAL_KEY ?? "";
  if (keyHex.length === 64) return Buffer.from(keyHex, "hex");
  const seed = process.env.DATABASE_URL ?? "phonolith-dev-key-not-for-production";
  return crypto.createHash("sha256").update(seed).digest();
}

function sign(value: string): string {
  const hmac = crypto.createHmac("sha256", getSigningKey());
  hmac.update(value);
  return hmac.digest("hex");
}

/** Combine a raw session id with its HMAC signature for the cookie value. */
function packCookieValue(sessionId: string): string {
  return `${sessionId}.${sign(sessionId)}`;
}

/** Verify and unpack a cookie value, returning the session id if valid. */
function unpackCookieValue(cookieValue: string): string | null {
  const dotIndex = cookieValue.lastIndexOf(".");
  if (dotIndex === -1) return null;
  const sessionId = cookieValue.slice(0, dotIndex);
  const signature = cookieValue.slice(dotIndex + 1);
  const expected = sign(sessionId);

  const sigBuf = Buffer.from(signature, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  return sessionId;
}

// ---------------------------------------------------------------------
// Password hashing (scrypt, format: "salt:hash" hex-encoded)
// ---------------------------------------------------------------------

const SCRYPT_KEYLEN = 64;

export function hashPassword(plain: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(plain, salt, SCRYPT_KEYLEN, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt.toString("hex")}:${derivedKey.toString("hex")}`);
    });
  });
}

export function verifyPassword(plain: string, stored: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [saltHex, hashHex] = stored.split(":");
    if (!saltHex || !hashHex) return resolve(false);

    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");

    crypto.scrypt(plain, salt, expected.length, (err, derivedKey) => {
      if (err) return reject(err);
      if (derivedKey.length !== expected.length) return resolve(false);
      resolve(crypto.timingSafeEqual(derivedKey, expected));
    });
  });
}

// ---------------------------------------------------------------------
// Session management (server-side sessions, revocable)
// ---------------------------------------------------------------------

export interface SessionCookieOptions {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  expires: Date;
}

/**
 * Create a new server-side session for the given user and return the
 * signed cookie value to set on the response.
 */
export async function createSession(userId: number): Promise<{
  cookieValue: string;
  cookieOptions: SessionCookieOptions;
}> {
  const sessionId = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await sql`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (${sessionId}, ${userId}, ${expiresAt})
  `;

  return {
    cookieValue: packCookieValue(sessionId),
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === "true",
      path: "/",
      expires: expiresAt,
    },
  };
}

/** Look up the current user from a raw session cookie value, if valid. */
export async function getUserFromSessionCookie(
  cookieValue: string | undefined
): Promise<User | null> {
  if (!cookieValue) return null;

  const sessionId = unpackCookieValue(cookieValue);
  if (!sessionId) return null;

  const rows = await sql<UserWithHash[]>`
    SELECT u.id, u.username, u.password_hash, u.role, u.created_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ${sessionId} AND s.expires_at > now()
  `;

  const row = rows[0];
  if (!row) return null;
  const { password_hash, ...user } = row;
  return user;
}

/** Delete a session row given a raw (signed) session cookie value. */
export async function destroySessionCookie(
  cookieValue: string | undefined
): Promise<void> {
  if (!cookieValue) return;
  const sessionId = unpackCookieValue(cookieValue);
  if (!sessionId) return;

  await sql`DELETE FROM sessions WHERE id = ${sessionId}`;
}

/** Returns true if at least one user row exists. */
export async function hasAnyUsers(): Promise<boolean> {
  const rows = await sql<{ count: string }[]>`SELECT COUNT(*)::int AS count FROM users`;
  return Number(rows[0]?.count ?? 0) > 0;
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;

// ---------------------------------------------------------------------
// Internal service-to-service auth (analyst sidecar -> app ingest route)
// ---------------------------------------------------------------------

/**
 * Token shared between the Next.js app and the analyst sidecar to
 * authenticate internal calls (e.g. POST /api/library/ingest) that have
 * no browser session to check. Read from INTERNAL_SERVICE_TOKEN if set;
 * otherwise falls back to a fixed dev value, mirroring getSigningKey()'s
 * fallback so a zero-config `docker compose up` still works, with a clear
 * name making it obvious this isn't secure for an internet-exposed deploy.
 */
function getInternalServiceToken(): string {
  return process.env.INTERNAL_SERVICE_TOKEN || "phonolith-dev-internal-token-not-for-production";
}

/** Timing-safe check of an `X-Internal-Token` header against the expected value. */
export function verifyInternalServiceToken(headerValue: string | null): boolean {
  if (!headerValue) return false;
  const expected = Buffer.from(getInternalServiceToken());
  const actual = Buffer.from(headerValue);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}
