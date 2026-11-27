// The HTTP API (07 §6). Stateless: sessions are signed cookies, all state is
// in the log (and the IDM's records). Every route is under /api, so a CDN or
// the Vite dev proxy can tell API calls from shell routes (07 §10).
//
// Cache policy (07 §3): exact versions are immutable (CDN: a year; browser:
// a minute); status, feeds and config are short-lived.

import { existsSync } from "node:fs";
import { Readable } from "node:stream";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import { eventToJson, formatAddress, isAddressString, parseAddress, type Address, type Id, type JsonValue } from "@ev/core";
import { LIMITS, isSortKey, type GrantJson, type PostEventBody, type SessionJson, type SortKey } from "@ev/engine";
import { Idm, IdmError } from "@ev/idm";
import { WriteError, exportLog } from "@ev/log";
import { RejectedError, type EvNode } from "@ev/node";
import { AuthError, authorize } from "./authorize";
import { ReadModel } from "./reads";
import { DEV_NAME_RE, SESSION_COOKIE, Sessions, readCookie } from "./session";

export interface ServerOptions {
  readonly node: EvNode;
  readonly idm: Idm;
  readonly sessionSecret: string;
  /** Built web client to serve (packages/web/dist), if any. */
  readonly staticDir?: string;
  readonly logger?: boolean;
  /** Set the Secure flag on cookies (behind HTTPS). */
  readonly secureCookies?: boolean;
}

const IMMUTABLE = "public, max-age=60, s-maxage=31536000, immutable";
const SHORT = "public, max-age=2, s-maxage=2, stale-while-revalidate=10";
const PRIVATE = "private, no-store";

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly reason?: string) {
    super(message);
  }
}

type AddrParams = { a: string; b: string; u: string; s: string };

function addrParam(p: AddrParams): string {
  const s = `${p.a}/${p.b}/${p.u}/${p.s}`;
  if (!isAddressString(s)) throw new HttpError(400, "bad address");
  return formatAddress(parseAddress(s));
}

function idParam(v: unknown, what: string): Id {
  if (typeof v !== "string" || !/^[1-9][0-9]{0,19}$/.test(v)) throw new HttpError(400, `bad ${what}`);
  return BigInt(v);
}

function optAddress(v: unknown, what: string): string | undefined {
  if (v === undefined || v === "") return undefined;
  if (typeof v !== "string" || !isAddressString(v)) throw new HttpError(400, `bad ${what}`);
  return v;
}

function list(v: unknown): string[] {
  if (v === undefined) return [];
  const raw = Array.isArray(v) ? v : [v];
  return raw.flatMap((x) => String(x).split(",")).filter((x) => x.length > 0);
}

function intParam(v: unknown, def: number, min: number, max: number): number {
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new HttpError(400, `expected an integer in ${min}..${max}`);
  return n;
}

export async function buildServer(o: ServerOptions): Promise<FastifyInstance> {
  const { node, idm } = o;
  const p = node.projector;
  const reads = new ReadModel(p, node.plan);
  const sessions = new Sessions(o.sessionSecret);
  const app = Fastify({ logger: o.logger ?? false });

  const sessionOf = (req: FastifyRequest): Id | null => {
    const id = sessions.verify(readCookie(req.headers.cookie, SESSION_COOKIE));
    return id !== null && p.identities.has(id) ? id : null;
  };
  const requireSession = (req: FastifyRequest): Id => {
    const s = sessionOf(req);
    if (s === null) throw new HttpError(401, "sign in first");
    return s;
  };

  // features.config_apps off (09): only native apps are shown, and the App Maker is hidden.
  // The config path stays in the code and its tests; it is parked, not removed.
  const configApps = node.config.features.configApps;
  const shown = (native: string | null) => (configApps ? true : native !== null && native !== "app-maker");
  const tools: Record<string, string> = {};
  for (const ident of node.plan.identities) {
    const k = reads.nativeOf(ident.id);
    if (k && shown(k)) tools[k] = ident.id.toString();
  }
  const genesisTypes: Record<string, string> = {};
  for (const [sym, v] of node.plan.symbols) if (sym.startsWith("@type:")) genesisTypes[sym.slice(6)] = v;

  const nameOf = async (ids: readonly Id[]): Promise<Record<string, string>> => {
    const out: Record<string, string> = {};
    for (const [id, n] of reads.logNames(ids)) out[id.toString()] = n;
    for (const [id, n] of await idm.names(ids.filter((i) => !(i.toString() in out)))) out[id.toString()] = n;
    return out;
  };

  const sessionJson = async (me: Id | null): Promise<SessionJson> => ({
    me: me === null ? null : { id: me.toString(), name: (await nameOf([me]))[me.toString()] ?? `#${me}` },
    signIn: node.config.signIn,
    deployment: node.config.name,
    tools,
    features: { configApps },
    genesisTypes,
  });

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, ...(err.reason ? { reason: err.reason } : {}) });
    if (err instanceof AuthError || err instanceof IdmError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof RejectedError) return reply.code(422).send({ error: "rejected by the validity rules", reason: err.reason });
    if (err instanceof WriteError) return reply.code(400).send({ error: err.message });
    const e = err as { statusCode?: number; message?: string };
    if (typeof e.statusCode === "number" && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message ?? "bad request" });
    app.log.error(err);
    return reply.code(500).send({ error: "internal error" });
  });

  // --- session and sign-in ---------------------------------------------------

  app.get("/api/session", async (req, reply) => {
    reply.header("cache-control", PRIVATE);
    return sessionJson(sessionOf(req));
  });

  app.post<{ Body: { name?: unknown } }>("/api/auth/dev", async (req, reply) => {
    if (node.config.signIn !== "dev") throw new HttpError(404, "dev login is disabled on this deployment");
    const name = req.body?.name;
    if (typeof name !== "string" || !DEV_NAME_RE.test(name)) throw new HttpError(400, "pick a name: letters, digits, - or _, up to 32");
    const id = await idm.signIn(`dev:${name.toLowerCase()}`, name);
    reply.header("set-cookie", sessions.cookie(sessions.issue(id), o.secureCookies ?? false)).header("cache-control", PRIVATE);
    return sessionJson(id);
  });

  app.post("/api/auth/oidc", async () => {
    // The seam for OIDC/OAuth on a server (07 §2): verify the provider's ID token, then idm.signIn(`${iss}|${sub}`, name).
    throw new HttpError(501, "OIDC sign-in is not implemented yet; use sign_in: dev locally");
  });

  app.post("/api/auth/logout", async (_req, reply) => {
    reply.header("set-cookie", sessions.clearCookie()).header("cache-control", PRIVATE);
    return { ok: true };
  });

  // --- events: exact version, status, item -------------------------------------

  app.get<{ Params: AddrParams }>("/api/e/:a/:b/:u/:s", async (req, reply) => {
    const key = addrParam(req.params);
    const v = reads.canRead(sessionOf(req), key);
    const row = reads.row(key);
    if (v === "missing" || !row) throw new HttpError(404, "no such event");
    if (v === "deleted") {
      reply.header("cache-control", SHORT);
      throw new HttpError(410, "deleted by its author");
    }
    // Validity is judged as of the event's position, so the verdict is as immutable as the bytes (07 §3).
    reply.header("cache-control", IMMUTABLE);
    return { event: eventToJson(row.event), valid: row.valid, reason: row.reason, block: row.position.block.toString(), time: reads.blockTime(row.position.block) };
  });

  app.get<{ Params: AddrParams; Querystring: { history?: string } }>("/api/status/:a/:b/:u/:s", async (req, reply) => {
    const key = addrParam(req.params);
    const s = reads.status(key, req.query.history === "1");
    if (!s) throw new HttpError(404, "no such event");
    reply.header("cache-control", SHORT);
    return s;
  });

  app.get<{ Params: AddrParams; Querystring: { score?: string } }>("/api/items/:a/:b/:u/:s", async (req, reply) => {
    const key = addrParam(req.params);
    const v = reads.canRead(sessionOf(req), key);
    if (v === "missing" || v === "invalid") throw new HttpError(404, "no such event");
    if (v === "deleted") throw new HttpError(410, "deleted by its author");
    reply.header("cache-control", SHORT);
    return reads.item(key, optAddress(req.query.score, "score"));
  });

  // --- queries (feeds) -----------------------------------------------------------

  const sortOf = (v: unknown): SortKey => {
    if (v === undefined || v === "") return "new";
    if (!isSortKey(v)) throw new HttpError(400, "sort: hot, new, top or old");
    return v;
  };

  app.get<{ Querystring: Record<string, string | string[] | undefined> }>("/api/events", async (req, reply) => {
    const q = req.query;
    const types = list(q.type);
    if (types.length === 0 || !types.every(isAddressString)) throw new HttpError(400, "type: one or more type addresses");
    const ref = q.ref === "none" ? "none" : optAddress(q.ref, "ref");
    const author = q.author === undefined || q.author === "" ? undefined : idParam(q.author, "author");
    const score = optAddress(q.score, "score");
    reply.header("cache-control", SHORT);
    return {
      items: reads.query({
        types, sort: sortOf(q.sort), limit: intParam(q.limit, 50, 1, LIMITS.listLimit),
        ...(ref !== undefined ? { ref } : {}), ...(author !== undefined ? { author } : {}), ...(score ? { score } : {}),
      }),
    };
  });

  app.get<{ Querystring: Record<string, string | string[] | undefined> }>("/api/tree", async (req, reply) => {
    const q = req.query;
    const root = optAddress(q.root, "root");
    if (!root) throw new HttpError(400, "root: an address");
    const types = list(q.type);
    if (types.length === 0 || !types.every(isAddressString)) throw new HttpError(400, "type: one or more type addresses");
    if (reads.canRead(sessionOf(req), root) !== "ok") throw new HttpError(404, "no such event");
    reply.header("cache-control", SHORT);
    const depth = intParam(q.depth, 6, 1, LIMITS.treeDepth);
    return { items: reads.tree(root, types, sortOf(q.sort), optAddress(q.score, "score"), depth, intParam(q.limit, 100, 1, LIMITS.listLimit)) };
  });

  // --- types and apps -------------------------------------------------------------

  app.get("/api/types", async (_req, reply) => {
    reply.header("cache-control", SHORT);
    return { types: reads.types() };
  });

  app.get<{ Params: AddrParams }>("/api/types/:a/:b/:u/:s", async (req, reply) => {
    const t = reads.typeJson(addrParam(req.params));
    if (!t) throw new HttpError(404, "no such type");
    reply.header("cache-control", SHORT);
    return t;
  });

  app.get("/api/apps", async (req, reply) => {
    const me = sessionOf(req);
    const mine = new Set(me === null ? [] : await idm.controlled(me));
    reply.header("cache-control", me === null ? SHORT : PRIVATE);
    return { apps: reads.apps(mine).filter((a) => shown(a.native)) };
  });

  app.get<{ Params: { app: string } }>("/api/apps/:app/config", async (req, reply) => {
    const cfg = reads.appConfig(idParam(req.params.app, "app"));
    if (!cfg) throw new HttpError(404, "this app has no config");
    if (!shown(cfg.native)) throw new HttpError(404, "apps defined by config are parked on this deployment (features.config_apps: false)");
    reply.header("cache-control", SHORT);
    return cfg;
  });

  app.get<{ Params: { app: string } }>("/api/apps/:app/batches/open", async (req) => {
    idParam(req.params.app, "app");
    return { events: [] }; // instant batching: nothing is ever pending (07 §2)
  });

  // The write path (07 §6): authorize → schema and validity check at insert → atomic batch allocation → publish.
  app.post<{ Params: { app: string }; Body: PostEventBody }>("/api/apps/:app/events", async (req, reply) => {
    const session = requireSession(req);
    const appId = idParam(req.params.app, "app");
    if (!p.identities.has(appId)) throw new HttpError(404, "no such app");
    const b = req.body;
    if (typeof b !== "object" || b === null) throw new HttpError(400, "body: { type, ref?, supersedes?, payload, user? }");
    const user = b.user === undefined ? session : idParam(b.user, "user");
    const type = optAddress(b.type, "type");
    if (!type) throw new HttpError(400, "type: a type address");
    const ref = b.ref === undefined || b.ref === null ? null : optAddress(b.ref, "ref")!;
    if (b.supersedes !== undefined && typeof b.supersedes !== "boolean") throw new HttpError(400, "supersedes: true or false");
    if (b.payload === undefined) throw new HttpError(400, "payload: required");
    const auth: Address | null = await authorize(idm, session, appId, user);
    const e = await node.writer.emitEvent(appId, {
      user,
      typeRef: parseAddress(type),
      ref: ref ? parseAddress(ref) : null,
      supersedes: b.supersedes ?? false,
      auth,
      payload: b.payload as JsonValue,
    });
    await node.sync();
    reply.code(201).header("cache-control", PRIVATE);
    return { address: formatAddress(e.address), auth: auth ? formatAddress(auth) : null };
  });

  // --- IDM ----------------------------------------------------------------------

  const grantJson = (g: { address: Address; app: Id; user: Id; issuedBlock: bigint; revokedBlock: bigint | null }): GrantJson => ({
    address: formatAddress(g.address),
    app: g.app.toString(),
    user: g.user.toString(),
    issuedBlock: g.issuedBlock.toString(),
    revokedBlock: g.revokedBlock === null ? null : g.revokedBlock.toString(),
  });

  app.get("/api/idm/grants", async (req, reply) => {
    const me = requireSession(req);
    reply.header("cache-control", PRIVATE);
    return { grants: idm.grantsOf(me).map(grantJson) };
  });

  // Lazy issuance (03 §4): the shell calls this when a user opens an app; auto-approved in the demo.
  app.post<{ Body: { app?: unknown } }>("/api/idm/grants", async (req, reply) => {
    const me = requireSession(req);
    const appId = idParam(req.body?.app, "app");
    reply.header("cache-control", PRIVATE);
    if (appId === me) return { address: null };
    return { address: formatAddress(await idm.ensureGrant(appId, me)) };
  });

  app.delete<{ Params: AddrParams }>("/api/idm/grants/:a/:b/:u/:s", async (req, reply) => {
    const me = requireSession(req);
    const revoke = await idm.revoke(parseAddress(addrParam(req.params)), me);
    reply.header("cache-control", PRIVATE);
    return { revoke: formatAddress(revoke) };
  });

  app.get("/api/idm/apps", async (req, reply) => {
    const me = requireSession(req);
    const ids = await idm.controlled(me);
    reply.header("cache-control", PRIVATE);
    return {
      apps: ids.map((id) => {
        const m = p.manifestOf(id);
        return { id: id.toString(), name: reads.appName(id) ?? null, manifest: m ? formatAddress(m.event.address) : null };
      }),
    };
  });

  // App creation (07 §7): a new identity owned by the IDM, with custody for the creator.
  app.post("/api/idm/apps", async (req, reply) => {
    const me = requireSession(req);
    const id = await idm.createApp(me);
    reply.code(201).header("cache-control", PRIVATE);
    return { id: id.toString() };
  });

  // --- identities ------------------------------------------------------------------

  app.get<{ Querystring: { ids?: string } }>("/api/names", async (req, reply) => {
    const ids = list(req.query.ids).slice(0, 500).map((s) => idParam(s, "id"));
    reply.header("cache-control", SHORT);
    return { names: await nameOf(ids) };
  });

  app.get<{ Params: { id: string } }>("/api/identities/:id", async (req, reply) => {
    const id = idParam(req.params.id, "id");
    const row = p.identities.get(id);
    if (!row) throw new HttpError(404, "no such identity");
    reply.header("cache-control", SHORT);
    return { id: id.toString(), owner: row.owner.toString(), createdBlock: row.createdBlock.toString(), name: (await nameOf([id]))[id.toString()] ?? null };
  });

  // --- operations -------------------------------------------------------------------

  app.get("/api/export", async (_req, reply: FastifyReply) => {
    async function* lines(): AsyncIterable<string> {
      for await (const line of exportLog(node.store)) yield `${JSON.stringify(line)}\n`;
    }
    reply.header("content-type", "application/x-ndjson").header("cache-control", PRIVATE);
    return reply.send(Readable.from(lines()));
  });

  app.post("/api/admin/rebuild", async (req, reply) => {
    requireSession(req); // demo: any signed-in user; operators only on a real deployment
    reply.header("cache-control", PRIVATE);
    return node.rebuild();
  });

  // --- the shell ---------------------------------------------------------------------

  if (o.staticDir && existsSync(o.staticDir)) {
    await app.register(fastifyStatic, { root: o.staticDir, wildcard: false });
    // Shell routes (/a/…, /e/…) are client-side: serve the single page (07 §10).
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/")) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "not found" });
    });
  }

  return app;
}
