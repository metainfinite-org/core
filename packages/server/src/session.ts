// Sessions (03 §7). The cookie carries the account id and an expiry, signed
// with HMAC-SHA256, so servers stay stateless (07 §3): any server with the
// secret can verify it, and nothing is stored. The sign-in provider behind it
// is pluggable: a dev login locally, OIDC/OAuth on a server.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Id } from "@ev/core";

export const SESSION_COOKIE = "ev_session";
const MAX_AGE_S = 30 * 24 * 3600;

export class Sessions {
  constructor(private readonly secret: string) {}

  static randomSecret(): string {
    return randomBytes(32).toString("hex");
  }

  private sign(body: string): string {
    return createHmac("sha256", this.secret).update(body).digest("base64url");
  }

  issue(user: Id, nowMs: number = Date.now()): string {
    const body = `${user}.${Math.floor(nowMs / 1000) + MAX_AGE_S}`;
    return `${body}.${this.sign(body)}`;
  }

  verify(token: string | undefined, nowMs: number = Date.now()): Id | null {
    if (!token) return null;
    const m = /^([1-9][0-9]*)\.([0-9]+)\.([A-Za-z0-9_-]+)$/.exec(token);
    if (!m) return null;
    const body = `${m[1]}.${m[2]}`;
    const expected = Buffer.from(this.sign(body));
    const given = Buffer.from(m[3]!);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    if (Number(m[2]) * 1000 < nowMs) return null;
    return BigInt(m[1]!);
  }

  cookie(token: string, secure: boolean): string {
    return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure ? "; Secure" : ""}`;
  }

  clearCookie(): string {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

/** Dev login names: what you type is your account ("dev:<name>"). Local only. */
export const DEV_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/;
