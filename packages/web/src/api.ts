// Thin client for the HTTP API (07 §6). Shapes come from @ev/engine, the
// contract shared with the server.

import type { EventJson, JsonValue } from "@ev/core/browser";
import type { AppConfigJson, AppJson, GrantJson, ItemJson, PostEventBody, PostEventResult, SessionJson, StatusJson, TypeJson } from "@ev/engine";

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly reason?: string) {
    super(reason ? `${message}: ${reason}` : message);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin" };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  const r = await fetch(url, init);
  const text = await r.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!r.ok) {
    const e = (json ?? {}) as { error?: string; reason?: string };
    throw new ApiError(r.status, e.error ?? r.statusText, e.reason);
  }
  return json as T;
}

const qs = (params: Record<string, string | number | undefined | null>): string => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
};

export interface ExactEvent {
  readonly event: EventJson;
  readonly valid: boolean;
  readonly reason: string | null;
  readonly block: string;
  readonly time: string;
}

export const api = {
  session: () => call<SessionJson>("GET", "/api/session"),
  devLogin: (name: string) => call<SessionJson>("POST", "/api/auth/dev", { name }),
  logout: () => call<{ ok: true }>("POST", "/api/auth/logout"),

  event: (addr: string) => call<ExactEvent>("GET", `/api/e/${addr}`),
  status: (addr: string, history = false) => call<StatusJson>("GET", `/api/status/${addr}${history ? "?history=1" : ""}`),
  item: (addr: string, score?: string) => call<ItemJson>("GET", `/api/items/${addr}${qs({ score })}`),
  events: (q: { types: readonly string[]; ref?: string; author?: string; sort?: string; score?: string; limit?: number }) =>
    call<{ items: ItemJson[] }>("GET", `/api/events${qs({ type: q.types.join(","), ref: q.ref, author: q.author, sort: q.sort, score: q.score, limit: q.limit })}`),
  tree: (q: { root: string; types: readonly string[]; sort?: string; score?: string; depth?: number }) =>
    call<{ items: ItemJson[] }>("GET", `/api/tree${qs({ root: q.root, type: q.types.join(","), sort: q.sort, score: q.score, depth: q.depth })}`),

  types: () => call<{ types: TypeJson[] }>("GET", "/api/types"),
  apps: () => call<{ apps: AppJson[] }>("GET", "/api/apps"),
  config: (app: string) => call<AppConfigJson>("GET", `/api/apps/${app}/config`),
  post: (app: string, body: PostEventBody) => call<PostEventResult>("POST", `/api/apps/${app}/events`, body),

  grants: () => call<{ grants: GrantJson[] }>("GET", "/api/idm/grants"),
  ensureGrant: (app: string) => call<{ address: string | null }>("POST", "/api/idm/grants", { app }),
  revoke: (grant: string) => call<{ revoke: string }>("DELETE", `/api/idm/grants/${grant}`),
  myApps: () => call<{ apps: { id: string; name: string | null; manifest: string | null }[] }>("GET", "/api/idm/apps"),
  createApp: () => call<{ id: string }>("POST", "/api/idm/apps"),

  names: (ids: readonly string[]) => call<{ names: Record<string, string> }>("GET", `/api/names${qs({ ids: ids.join(",") })}`),
  rebuild: () => call<{ hash: string; live: string; match: boolean }>("POST", "/api/admin/rebuild"),
};

export type { JsonValue };
