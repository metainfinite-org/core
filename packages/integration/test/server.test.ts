// P3 and P4 through the HTTP API (Fastify inject, in-memory stores):
// sign-in, lazy grants, authorize(), revocation, the Type Maker and App Maker
// flows, queries and sorting, can_read, export and rebuild.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseDeploymentConfig } from "@ev/config";
import { autoLayout, buildAppBundle, emitBundle, type AppConfigJson, type ItemJson, type SessionJson, type TypeJson } from "@ev/engine";
import { createStack, type Stack } from "@ev/server";

let stack: Stack;
let server: Stack["server"];
let session: SessionJson;

beforeEach(async () => {
  let tick = 0;
  stack = await createStack({
    config: parseDeploymentConfig("name: test\nstorage: memory\n"),
    sessionSecret: "test-secret",
    clock: () => new Date(Date.UTC(2026, 0, 2, 0, 0, 0, tick++)).toISOString(),
  });
  server = stack.server;
  session = (await server.inject({ url: "/api/session" })).json();
});

afterEach(async () => {
  stack.node.stop();
  await server.close();
});

async function login(name: string): Promise<{ cookie: string; id: string }> {
  const r = await server.inject({ method: "POST", url: "/api/auth/dev", payload: { name } });
  expect(r.statusCode).toBe(200);
  const cookie = String(r.headers["set-cookie"]).split(";")[0]!;
  return { cookie, id: (r.json() as SessionJson).me!.id };
}

async function post(cookie: string, app: string, body: object): Promise<{ status: number; json: { address?: string; auth?: string | null; reason?: string; error?: string } }> {
  const r = await server.inject({ method: "POST", url: `/api/apps/${app}/events`, headers: { cookie }, payload: body });
  return { status: r.statusCode, json: r.json() };
}

async function get<T>(url: string, cookie?: string): Promise<T> {
  const r = await server.inject({ url, ...(cookie ? { headers: { cookie } } : {}) });
  expect(r.statusCode, `${url}: ${r.body}`).toBe(200);
  return r.json() as T;
}

const T = (name: string) => session.genesisTypes[name]!;

describe("P3: identity and auth", () => {
  it("dev login finds or creates an account owned by the IDM", async () => {
    const a = await login("alice");
    const again = await login("Alice");
    expect(again.id).toBe(a.id);
    const ident = await get<{ owner: string; name: string }>(`/api/identities/${a.id}`);
    expect(ident.owner).toBe(stack.idm.id.toString());
    expect(ident.name).toBe("alice");
    const me = await get<SessionJson>("/api/session", a.cookie);
    expect(me.me?.name).toBe("alice");
  });

  it("rejects writes without a session and forged cookies", async () => {
    const app = session.tools["type-maker"]!;
    expect((await post("", app, { type: T("post"), payload: { title: "x" } })).status).toBe(401);
    const a = await login("alice");
    const forged = a.cookie.replace(/\.[^.]+$/, ".AAAA");
    expect((await post(forged, app, { type: T("post"), payload: { title: "x" } })).status).toBe(401);
  });

  it("issues a grant lazily on the first post and reuses it", async () => {
    const a = await login("alice");
    const app = session.tools["type-maker"]!;
    const first = await post(a.cookie, app, { type: T("post"), payload: { title: "one" } });
    expect(first.status).toBe(201);
    expect(first.json.auth).toBeTruthy();
    const second = await post(a.cookie, app, { type: T("post"), payload: { title: "two" } });
    expect(second.json.auth).toBe(first.json.auth);
    const grants = await get<{ grants: { address: string; app: string }[] }>("/api/idm/grants", a.cookie);
    expect(grants.grants).toHaveLength(1);
    expect(grants.grants[0]!.app).toBe(app);
  });

  it("revoking stops later events but not earlier ones", async () => {
    const a = await login("alice");
    const app = session.tools["type-maker"]!;
    const before = await post(a.cookie, app, { type: T("post"), payload: { title: "before" } });
    const r = await server.inject({ method: "DELETE", url: `/api/idm/grants/${before.json.auth}`, headers: { cookie: a.cookie } });
    expect(r.statusCode).toBe(200);
    // The earlier event stays valid.
    const s = await get<{ valid: boolean }>(`/api/status/${before.json.address}`);
    expect(s.valid).toBe(true);
    // A later post gets a fresh grant: revocation is per grant (03 §4), the user consents again by using the app.
    const after = await post(a.cookie, app, { type: T("post"), payload: { title: "after" } });
    expect(after.status).toBe(201);
    expect(after.json.auth).not.toBe(before.json.auth);
    // But nothing can be posted under the revoked grant any more.
    const e = await stack.node.writer.emitEvent(BigInt(app), {
      user: BigInt(a.id), typeRef: (await import("@ev/core")).parseAddress(T("post")),
      auth: (await import("@ev/core")).parseAddress(before.json.auth!), payload: { title: "sneaky" },
    }).catch((err: Error) => err);
    expect(e).toBeInstanceOf(Error);
    expect(String(e)).toContain("grant_revoked");
  });

  it("only lets a user revoke their own grants", async () => {
    const a = await login("alice");
    const b = await login("bob");
    const app = session.tools["type-maker"]!;
    const p = await post(a.cookie, app, { type: T("post"), payload: { title: "mine" } });
    const r = await server.inject({ method: "DELETE", url: `/api/idm/grants/${p.json.auth}`, headers: { cookie: b.cookie } });
    expect(r.statusCode).toBe(403);
  });

  it("authorize: you can't act as another identity", async () => {
    const a = await login("alice");
    const b = await login("bob");
    const app = session.tools["type-maker"]!;
    const r = await post(a.cookie, app, { user: b.id, type: T("post"), payload: { title: "as bob" } });
    expect(r.status).toBe(403);
  });

  it("returns the validity rules' reason when the insert check rejects", async () => {
    const a = await login("alice");
    const b = await login("bob");
    const app = session.tools["type-maker"]!;
    const p = await post(a.cookie, app, { type: T("post"), payload: { title: "alice's" } });
    const edit = await post(b.cookie, app, { type: T("post"), ref: p.json.address, supersedes: true, payload: { title: "bob's" } });
    expect(edit.status).toBe(422);
    expect(edit.json.reason).toBe("supersede_by_non_author");
    const bad = await post(a.cookie, app, { type: T("post"), payload: { nope: 1 } });
    expect(bad.status).toBe(422);
    expect(bad.json.reason).toMatch(/^schema:/);
  });
});

describe("P4: Type Maker and App Maker", () => {
  async function makeType(cookie: string, payload: object): Promise<string> {
    const r = await post(cookie, session.tools["type-maker"]!, { type: T("type"), payload });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    return r.json.address!;
  }

  it("creates a type with its default type view, then an instance", async () => {
    const a = await login("alice");
    const schema = { type: "object", required: ["text"], properties: { text: { type: "string", minLength: 1, maxLength: 280 } } };
    const type = await makeType(a.cookie, { name: "status", schema, extensions: { hints: { display_template: "{text}" } } });
    const tv = await post(a.cookie, session.tools["type-maker"]!, { type: T("type-view"), payload: { type, name: "default", layout: autoLayout(schema, "{text}") as never } });
    expect(tv.status).toBe(201);
    const info = await get<TypeJson>(`/api/types/${type}`);
    expect(info.name).toBe("status");
    expect(info.defaultTypeView).toBe(tv.json.address);
    expect(info.hints.display_template).toBe("{text}");
    const inst = await post(a.cookie, session.tools["type-maker"]!, { type, payload: { text: "hello" } });
    expect(inst.status).toBe(201);
    expect((await get<TypeJson>(`/api/types/${type}`)).usage).toBe(1);
  });

  it("a new type version is an edit; only its author may make one", async () => {
    const a = await login("alice");
    const b = await login("bob");
    const v1 = await makeType(a.cookie, { name: "note", schema: { type: "object", properties: { text: { type: "string" } } } });
    const v2 = await post(a.cookie, session.tools["type-maker"]!, { type: T("type"), ref: v1, supersedes: true, payload: { name: "note", schema: { type: "object", properties: { text: { type: "string" }, tag: { type: "string" } } } } });
    expect(v2.status).toBe(201);
    const t1 = await get<TypeJson>(`/api/types/${v1}`);
    expect(t1.isHead).toBe(false);
    expect(t1.head).toBe(v2.json.address);
    const forked = await post(b.cookie, session.tools["type-maker"]!, { type: T("type"), ref: v1, supersedes: true, payload: { name: "note", schema: { type: "object" } } });
    expect(forked.status).toBe(422);
  });

  async function makeBoard(cookie: string): Promise<{ app: string; config: AppConfigJson }> {
    const types = new Map((await get<{ types: TypeJson[] }>("/api/types")).types.map((t) => [t.address, t]));
    const bundle = buildAppBundle({
      name: "Board", description: "posts and comments", postTypes: [T("post")], replyTypes: [T("comment")],
      scoreType: T("vote"), sort: "hot", replySort: "top", replyLayout: "tree",
    }, types);
    const created = await server.inject({ method: "POST", url: "/api/idm/apps", headers: { cookie } });
    expect(created.statusCode).toBe(201);
    const app = (created.json() as { id: string }).id;
    const typeOf = { action: T("action"), view: T("view"), manifest: T("manifest") };
    await emitBundle(bundle, async (kind, payload, supersedes) => {
      const r = await post(cookie, app, { user: app, type: typeOf[kind], payload, ...(supersedes ? { ref: supersedes, supersedes: true } : {}) });
      expect(r.status, `${kind}: ${JSON.stringify(r.json)}`).toBe(201);
      expect(r.json.auth).toBeNull(); // config is authored by the app itself, in its own batch (03 §8)
      return r.json.address!;
    });
    const config = await get<AppConfigJson>(`/api/apps/${app}/config`);
    return { app, config };
  }

  it("builds a reddit-style app from config and uses it", async () => {
    const a = await login("alice");
    const b = await login("bob");
    const { app, config } = await makeBoard(a.cookie);
    expect(config.name).toBe("Board");
    expect(Object.keys(config.views)).toHaveLength(2);
    expect(Object.keys(config.actions).length).toBeGreaterThanOrEqual(4);

    const apps = await get<{ apps: { id: string; mine: boolean; native: string | null }[] }>("/api/apps", a.cookie);
    const listed = apps.apps.find((x) => x.id === app)!;
    expect(listed.mine).toBe(true);
    expect(listed.native).toBeNull();

    // Only the custodian may change the app's config.
    const hijack = await post(b.cookie, app, { user: app, type: T("manifest"), payload: { name: "Mine now" } });
    expect(hijack.status).toBe(403);

    // Use it: two posts, a comment, a nested reply, votes.
    const p1 = (await post(a.cookie, app, { type: T("post"), payload: { title: "first" } })).json.address!;
    const p2 = (await post(b.cookie, app, { type: T("post"), payload: { title: "second" } })).json.address!;
    const c1 = (await post(b.cookie, app, { type: T("comment"), ref: p1, payload: { body: "nice" } })).json.address!;
    const c2 = (await post(a.cookie, app, { type: T("comment"), ref: c1, payload: { body: "thanks" } })).json.address!;
    await post(a.cookie, app, { type: T("vote"), ref: p2, payload: { value: 1 } });
    await post(b.cookie, app, { type: T("vote"), ref: p2, payload: { value: 1 } });
    await post(b.cookie, app, { type: T("vote"), ref: p1, payload: { value: -1 } });
    // Changing a vote is a new vote (unique per author and target, latest wins).
    await post(b.cookie, app, { type: T("vote"), ref: p1, payload: { value: 1 } });

    const q = (sort: string) => `/api/events?type=${T("post")}&ref=none&sort=${sort}&score=${T("vote")}`;
    const top = (await get<{ items: ItemJson[] }>(q("top"))).items;
    expect(top.map((i) => i.address)).toEqual([p2, p1]);
    expect(top.map((i) => i.score)).toEqual([2, 1]);
    const newest = (await get<{ items: ItemJson[] }>(q("new"))).items;
    expect(newest.map((i) => i.address)).toEqual([p2, p1]);
    expect(newest.find((i) => i.address === p1)!.children).toBe(2); // one comment + one vote reference it

    const tree = (await get<{ items: ItemJson[] }>(`/api/tree?root=${p1}&type=${T("comment")}&sort=top`)).items;
    expect(tree).toHaveLength(1);
    expect(tree[0]!.address).toBe(c1);
    expect(tree[0]!.replies!.map((r) => r.address)).toEqual([c2]);

    // Edit: the item shows the head version under the root's address.
    const edit = await post(a.cookie, app, { type: T("post"), ref: p1, supersedes: true, payload: { title: "first (edited)" } });
    expect(edit.status).toBe(201);
    const item = await get<ItemJson>(`/api/items/${p1}?score=${T("vote")}`);
    expect(item.address).toBe(p1);
    expect(item.edited).toBe(true);
    expect(item.head.payload).toEqual({ title: "first (edited)" });
    const st = await get<{ head: string; history: string[] }>(`/api/status/${p1}?history=1`);
    expect(st.head).toBe(edit.json.address);
    expect(st.history).toEqual([p1, edit.json.address]);

    // Delete: hidden from feeds, 410 on the exact version (can_read).
    const del = await post(a.cookie, app, { type: T("delete"), ref: p1, payload: {} });
    expect(del.status).toBe(201);
    expect((await get<{ items: ItemJson[] }>(q("new"))).items.map((i) => i.address)).toEqual([p2]);
    expect((await server.inject({ url: `/api/e/${p1}` })).statusCode).toBe(410);
    const exact = await server.inject({ url: `/api/e/${p2}` });
    expect(exact.headers["cache-control"]).toContain("immutable");
  });

  it("App Maker edits supersede the manifest", async () => {
    const a = await login("alice");
    const { app, config } = await makeBoard(a.cookie);
    const old = config.manifest.address;
    const r = await post(a.cookie, app, { user: app, type: T("manifest"), ref: old, supersedes: true, payload: { ...(config.manifest.payload as object), name: "Board 2" } });
    expect(r.status).toBe(201);
    const after = await get<AppConfigJson>(`/api/apps/${app}/config`);
    expect(after.name).toBe("Board 2");
    expect(after.manifest.address).toBe(r.json.address);
  });

  it("the genesis tools are listed with their native UIs; a user's copy of a native name is not honored", async () => {
    const a = await login("alice");
    const apps = await get<{ apps: { id: string; native: string | null }[] }>("/api/apps");
    expect(apps.apps.filter((x) => x.native).map((x) => x.native).sort()).toEqual(["app-maker", "idm", "type-maker"]);
    const created = (await server.inject({ method: "POST", url: "/api/idm/apps", headers: { cookie: a.cookie } })).json() as { id: string };
    await post(a.cookie, created.id, { user: created.id, type: T("manifest"), payload: { name: "Fake maker", native: "type-maker" } });
    const cfg = await get<AppConfigJson>(`/api/apps/${created.id}/config`);
    expect(cfg.native).toBeNull();
  });

  it("features.config_apps: false shows only native apps and hides the App Maker", async () => {
    const parked = await createStack({ config: parseDeploymentConfig("name: test\nfeatures:\n  config_apps: false\n"), sessionSecret: "s" });
    try {
      const s = parked.server;
      const sess = (await s.inject({ url: "/api/session" })).json() as SessionJson;
      expect(sess.features.configApps).toBe(false);
      expect(Object.keys(sess.tools).sort()).toEqual(["idm", "type-maker"]);
      const cookie = String((await s.inject({ method: "POST", url: "/api/auth/dev", payload: { name: "alice" } })).headers["set-cookie"]).split(";")[0]!;
      const created = (await s.inject({ method: "POST", url: "/api/idm/apps", headers: { cookie } })).json() as { id: string };
      const typ = sess.genesisTypes["manifest"]!;
      expect((await s.inject({ method: "POST", url: `/api/apps/${created.id}/events`, headers: { cookie }, payload: { user: created.id, type: typ, payload: { name: "Config app" } } })).statusCode).toBe(201);
      const apps = (await s.inject({ url: "/api/apps" })).json() as { apps: { native: string | null }[] };
      expect(apps.apps.map((a) => a.native).sort()).toEqual(["idm", "type-maker"]);
      expect((await s.inject({ url: `/api/apps/${created.id}/config` })).statusCode).toBe(404);
      expect((await s.inject({ url: `/api/apps/${sess.tools["type-maker"]}/config` })).statusCode).toBe(200);
    } finally {
      parked.node.stop();
      await parked.server.close();
    }
  });
});

describe("operations", () => {
  it("exports the log as JSON lines and rebuilds to the same hash", async () => {
    const a = await login("alice");
    await post(a.cookie, session.tools["type-maker"]!, { type: T("post"), payload: { title: "x" } });
    const exp = await server.inject({ url: "/api/export" });
    const lines = exp.body.trim().split("\n").map((l) => JSON.parse(l) as { kind: string });
    expect(lines[0]!.kind).toBe("block");
    expect(lines.filter((l) => l.kind === "event").length).toBe(stack.node.projector.events.size);
    const r = await server.inject({ method: "POST", url: "/api/admin/rebuild", headers: { cookie: a.cookie } });
    expect(r.json()).toMatchObject({ match: true });
  });
});
