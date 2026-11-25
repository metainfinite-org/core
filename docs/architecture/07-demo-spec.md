# 07 — Demo Specification

## 1. Goal

Prove the model end-to-end on one trusted server, with every identifier and structure compatible with the real system:

- integer identities, 4-integer addresses, immutable typed events, types defined by events
- state = replay of the log
- apps defined as configuration and rendered by a generic engine
- sign-in through an IDM with lazy grants, revocation
- data exportable to the real system (batches and merkle trees built retroactively)

## 2. Scope

**In**

- Log: `blocks`, `txs`, `events`; block producer on a timer; every event/identity creation lands in the open block
- Instant batching: each event its own batch, published on creation, `seq = 1`
- Genesis seed script (creator, IDM, tool apps, meta-type, primitives, base types, first configs)
- Projection engine with the validity rules: grants & revocation, `user == app`, supersede (single-author), delete, proposals & merge bot, soft/hard references, type lineage, app config heads
- Single default IDM owning all accounts; OAuth sign-in; lazy auto-approved grants; revocation UI
- Shell ("browser in the browser"), engine with the block whitelist
- Hand-coded Type Maker, App Maker, event-graph visualizer
- At least one fully declarative app: a board/feed with comments, likes, upvotes, reddit-style sorting
- Server-side schema validation at insert
- Reads: an exact-version endpoint (immutable, cacheable) plus a separate small "latest" lookup. The UI shows the latest version by default and history on request. Every read goes through `can_read`, which also hides deleted and moderated events (§3)
- Shell owns the browser URL: apps, views and events are linkable (§10)
- Export of the log as JSON lines (the later import into the real system canonicalizes, `02` §4)

**Out** (see `06`): real chain, keys and signatures, merkle trees in the live path, delayed batching, IDM storage/notifications/state trees, stable addresses, endpoints/DNS, scripting and node editor, precompiles, fees.

The UI still keeps the **"unpublished" marker** component even though instant batching never shows it.

## 3. Two deployments, one codebase

| | Company knowledge base | Public demo |
|---|---|---|
| Audience | 10–20 people | Up to a few hundred thousand users, ideally 1M |
| Topology | One machine: Node + Postgres. Runs the same on a developer's laptop or a single server (docker compose optional) | Stateless API servers behind a load balancer; managed Postgres + read replicas; projection workers as separate processes; CDN; optionally an in-memory cache |
| Sign-in | SSO via OIDC into the single IDM | OAuth into the single IDM |
| Genesis | Its own; ids start at 1 (§11) | Its own; ids start higher, e.g. 1,000,001 (§11) |
| Ops | Nightly backups | Managed backups, monitoring |
| Key feature | **The team builds its own types and apps** with the Type Maker and App Maker: self-organization, new kinds of reputation, priorities, voting on anything, even voting on the voting rules (`10`) | Cache-friendly reads |
| Read access | The whole deployment is private (intranet, behind SSO); every member reads everything. No private events or restricted spaces at the start | Everything public |

**Rules that keep both on one codebase:** stateless servers; all state in the database; write path separate from projections; no global autoincrement ids (addresses already partition by app); timestamps from the DB primary, not app servers — block order is the real authority anyway.

### Caching **[P]**

A CDN is a cache in front of the API. It never asks Postgres anything: on a miss it forwards the request to the API server and keeps the response. So "is there a newer version?" must be a **separate request** from "give me this version":

| Request | Returns | Changes? | Caching |
|---|---|---|---|
| `GET /api/e/7/42/5/1` | exactly this version | never, except a takedown | CDN: forever (`s-maxage` one year). Browser: short (`max-age` ≈ 60 s), because browser caches can't be purged |
| `GET /api/latest/7/42/5/1` | only the head's address, a few bytes | when the event is edited | seconds, or ETag revalidation |
| `GET /api/events?…` (feeds, queries) | lists of addresses plus counts | constantly | not on the CDN, or seconds |

The client asks the tiny "latest" question, then fetches the exact version, which is usually a CDN hit. Web apps already work this way: content-hashed assets (`app.3f9a1c.js`) are cached forever behind a short-lived `index.html`.

**Takedowns.** Every major CDN has a purge API (Cloudflare purge by URL or cache tag, CloudFront invalidations, Fastly surrogate keys). When a delete or a moderation hide becomes valid in the projection, a worker purges that event's URL. From then on the API answers **410 Gone** (deleted by its author) or **451 Unavailable** (hidden by moderation, with the address of the deciding event). Feeds drop it on their next refresh, since they are barely cached. The event stays in the log; the host may also drop the payload (`02` §7).

**In-memory cache (Redis or memcached).** Not needed locally or for the company: Postgres's own buffer cache is enough. For the public demo, put it between the API servers and Postgres for the hottest small reads: latest-head lookups, counts (likes per event), assembled feed pages, sessions. Redis is the better fit because its pub/sub can also push live notifications to connected clients (`10` §4); memcached is a pure cache. Keep it behind one `cache` interface so it stays optional and swappable. Invalidation is easy, because the projection worker knows exactly which heads and counts each event changed.

### Read and visibility seam **[P]**

Every read goes through one function, `can_read(session, event)`, the read-side twin of `authorize`. It returns false for:

- events deleted by their author (`04` §5)
- events hidden by the moderation authority this host follows (`10` §2), read from a projection

Moderators reviewing a dispute can still see hidden content. There are no private events or restricted spaces at the start. If they are needed later, they plug in here as projection-backed ACLs defined by events, which later map onto read grants and keys (`06` §7). No encryption in the demo.

## 4. Database: PostgreSQL

Why: composite primary keys, joins over references, transactions for atomic batch allocation, JSONB payloads, recursive CTEs for lineage/closures, projections as tables or materialized views. One engine is realistic up to ~1M users for this workload — read replicas first, then partitioning `events` by hash of `app` if needed.

- **MongoDB** — no advantage here; loses relational strengths.
- **Cassandra** — scales writes but has no joins/transactions; fits neither the counter nor the projections.
- **Kafka** — not now. Add Kafka/Redpanda/NATS when several independent projectors need to replay at scale. Until then: an **outbox table + `LISTEN/NOTIFY`** to wake projection workers.

**Hot row warning:** with instant batching the per-app batch counter is a hot row. Fine to several hundred events/s per app. If a popular app outgrows it, switch that app to **time-based batching** — which is exactly what batching exists for and is already in the design.

## 5. Projection schema (derived, rebuildable)

```sql
CREATE TABLE identities (
  id            BIGINT PRIMARY KEY,
  owner         BIGINT,              -- IDM / owning identity
  batch_count   BIGINT NOT NULL DEFAULT 0,
  created_block BIGINT NOT NULL,
  pubkey        BYTEA                -- unused in the demo
);

CREATE TABLE ownership_history (id BIGINT, owner BIGINT, from_block BIGINT, from_tx INT);

CREATE TABLE batches (               -- from publish_batch txs
  app BIGINT, batch BIGINT, block BIGINT, tx_idx INT, root BYTEA,
  PRIMARY KEY (app, batch)
);

CREATE TABLE event_state (
  app BIGINT, batch BIGINT, usr BIGINT, seq BIGINT,
  valid BOOLEAN NOT NULL, invalid_reason TEXT,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,   -- "a valid delete event exists"; the event row is untouched
  root_app BIGINT, root_batch BIGINT, root_usr BIGINT, root_seq BIGINT,  -- lineage root
  PRIMARY KEY (app, batch, usr, seq)
);

CREATE TABLE heads (                 -- latest valid version per lineage
  root_app BIGINT, root_batch BIGINT, root_usr BIGINT, root_seq BIGINT,
  head_app BIGINT, head_batch BIGINT, head_usr BIGINT, head_seq BIGINT,
  PRIMARY KEY (root_app, root_batch, root_usr, root_seq)
);

CREATE TABLE grants (
  grant_addr TEXT PRIMARY KEY, app BIGINT, usr BIGINT,
  issued_block BIGINT, revoked_block BIGINT, scope JSONB
);

CREATE TABLE type_lineage (descendant TEXT, ancestor TEXT, depth INT, relation TEXT); -- extends / supersedes
CREATE TABLE edges (src TEXT, dst TEXT, kind TEXT, active_block BIGINT);            -- soft refs incl. payload multi-refs
CREATE TABLE app_config (app BIGINT PRIMARY KEY, manifest_addr TEXT);                -- head of valid manifests
CREATE TABLE custody (identity BIGINT, human_account BIGINT, role TEXT);              -- IDM custody policy (demo)
```

(Addresses in projections may use the canonical string form for convenience; the log keeps integers.)

## 6. API sketch

| Endpoint | Purpose |
|---|---|
| `POST /apps/:app/events` `{user, type, ref?, payload}` | `authorize(session, app, user)` → schema check → hard-dependency check → atomic batch allocation → insert event + `publish_batch` tx → returns address |
| `GET /api/e/:app/:batch/:user/:seq` | **exactly this version**, immutable, CDN-cacheable (§3); 410/451 if deleted or hidden |
| `GET /api/latest/:app/:batch/:user/:seq` | head address only (same shape as the future IDM query); `?history=1` the whole chain |
| `GET /api/events?ref=…&type=…&sort=…` | engine queries (descendant types included) |
| `GET /apps/:app/batches/open` | read-only pending view (trivially empty in the demo) |
| `POST /idm/grants` / `DELETE /idm/grants/:addr` | lazy issue (auto-approve) / revoke |
| `GET /types/:addr`, `GET /apps`, `GET /apps/:app/config` | type and app discovery |
| `POST /admin/rebuild` | rebuild all projections from the log, return projection hash |

## 7. Flows

- **Sign-in:** OAuth/SSO into the shell → IDM finds or creates the account (`create_identity`, owner = IDM).
- **Opening an app:** if no grant for `(app, user)`, the IDM emits a grant event (auto-approved) → the shell lets the app post for the user with `auth` = that grant.
- **Posting:** an action in the app → `POST /apps/:app/events`.
- **Creating a type:** Type Maker → "new type" event (`extends` a base where sensible).
- **Creating an app:** App Maker → new identity owned by the IDM, custody row for the creator, grant to the App Maker, manifest/view/action events authored by the app (`03` §8).
- **Editing:** author emits a superseding event. **Proposing:** another user emits a proposal; the merge bot emits the merged version as the owner, referencing the proposal.
- **Deleting:** author emits a delete; apps hide (or mark) by default.
- **Revoking:** user revokes an app in the IDM → later events by that app for the user are invalid; earlier ones stay valid.
- **Graph browsing:** the visualizer walks `edges`, `type_lineage` and versions.

## 8. Apps in the demo

- **Hand-coded tools:** Type Maker, App Maker, Graph Visualizer (+ the shell and the IDM's account/grants screens).
- **Declarative:** a board/feed (posts, comments, likes, upvotes, hot/new/top sorting). For the company deployment, whatever the team builds itself (`10`). No pages or rich-text documents, no full-text search and no importers for now: the goal is new, strongly typed kinds of events, not traditional documents.
- **Seeded types:** meta-type, primitives, view, action, manifest, grant, revoke, edit (supersede), delete, comment, like, upvote, proposal, merge.

## 9. Implementation stack

Constraint: one developer, small budget, C++ background. **TypeScript is confirmed.** **[Later]** Performance-critical parts probably move to Rust, together with the redesign for larger scale (horizontal scaling, sharding, Kafka/Redpanda).

- **TypeScript end to end:** a Node server and a React client (React is already the renderer, `05` §4). With one language, the schema validators, the view query/sort evaluator and the projection rules can be **shared by client and server**, so a view evaluates the same everywhere. The engine is the largest item in the plan (`08`), and it lives mostly in the client.
- **Postgres through plain SQL plus a thin query builder**, not a heavy ORM. Composite 4-integer keys and recursive CTEs fit ORMs poorly.
- **Pitfall: JS numbers are float64.** Identities and address parts are 64-bit, so use `BigInt` (or canonical strings) end to end, and configure the Postgres driver to return `BIGINT` as `BigInt` or string, never as `number`. No float arithmetic in any consensus path (`02` §5).
- **Alternatives considered:**
  - Go for the server: simple and fast, but two languages alongside a TS frontend.
  - Rust: strong for the later kernel, precompiles and chain work, but slower to iterate with as a solo developer.
  - C++ remains a fit for later native parts (kernel, precompiles), not for the demo's web stack.

## 10. URLs in the shell

The shell is a "browser inside the browser", and it **owns the real browser URL** (a single-page app using the History API). Opening an app changes the URL, viewing an event puts the event in the URL, and back/forward, reload and sharing all work.

**[P]** Scheme:

| URL | Shows |
|---|---|
| `/` | shell home, app launcher |
| `/a/7` | app 7, its default view |
| `/a/7/v/<view-addr>?node=7/42/5/1` | a specific view of app 7, with its props in the query string |
| `/e/7/42/5/1` | an event, latest version, with a note if a newer version exists |
| `/e/7/42/5/1?exact` | exactly that version |
| `/a/9/e/7/42/5/1` | the event opened inside app 9 |

- **Which app opens `/e/…`:** the event's own app (the first integer) if it has a view for the event's type. Otherwise the generic event viewer, which uses the type's rendering fallback (`05` §3).
- **Everything that defines the screen goes into the URL.** View props live in the query string, serialized generically by the engine from the view's config, so any screen can be shared.
- Page URLs (`/e/…`) are shell routes. API URLs (`/api/e/…`) are what the CDN caches (§3).
- **[Later]** Names instead of numbers, once naming exists (`06` §1).

## 11. Deployment and configuration

- **Priority order:** run locally on any machine with Node and Postgres (install, one command to create the database, seed genesis and start), then the same on one server, then a cloud (AWS or similar) for the public demo.
- **[P] A `deployment.yml` file** holds the deployment's parameters: name, `first_identity` (1 for local and company deployments, e.g. 1,000,001 for the public demo), block interval, sign-in provider. Secrets (database URL, OAuth client secret) come from environment variables, not from the file.
- **Genesis parameters are read once**, when genesis runs on an empty database, and are recorded in genesis itself, e.g. in the creator's `create_identity` tx. The database is then self-describing, and editing the file later doesn't change an existing deployment.
- **[O]** If data from one deployment ever has to merge into another (company into public, or into the real system), their id ranges must not overlap. Otherwise the import has to renumber identities, which breaks addresses that are quoted inside text.
