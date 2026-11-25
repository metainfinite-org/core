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
- Single default IDM owning all accounts; sign-in via a **dev login** locally (pick or type a username, no password) and OIDC/OAuth on a server; lazy auto-approved grants; revocation UI
- Shell ("browser in the browser"), engine with the block whitelist
- Hand-coded Type Maker, App Maker, event-graph visualizer
- At least one fully declarative app: reddit-style posts and nested comments with votes (up/down) and new/top/hot sorting, built with the makers
- Server-side schema validation at insert
- Reads: an exact-version endpoint (immutable, cacheable) plus a separate small status lookup (latest version, deleted/hidden, revealed). The UI shows the latest version by default and history on request. Every read goes through `can_read`, which also hides deleted and moderated events (§3)
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
| `GET /api/bundle/7/42/5/1` | **[P]** verify mode: the event + its merkle proof + the grant it used + the grant's proof (`02` §3) | never | CDN: forever |
| `GET /api/status/7/42/5/1` | **[P]** everything mutable about the event, in a few bytes: head address, deleted or hidden, reveal-event address | when any of those change | seconds, or ETag revalidation |
| `GET /api/events?…` (feeds, queries) | lists of addresses plus counts | constantly | not on the CDN, or seconds |

**The split: immutable bytes vs mutable status.** The client never probes for changes one by one. It asks one small **status** question per event it shows: is there a newer version, has it been deleted or hidden, has it been revealed or made private again. That one answer replaces separate "latest" and "reveal" lookups. The answer is short-lived; the event bytes are cached forever, and the two requests run in parallel.

**[P] Bundling immutable parts.** Everything that never changes can be bundled and cached forever:
- An event's **validity** is judged as of its position (`03` §5), so it never changes after the batch is published. The host can include its verdict in the immutable response.
- The **grant** an event used, and the proofs, never change either. So the verify-mode bundle is also immutable.
- The **wrapped keys** of a private event are inside the event itself (`02` §8).

Only the status is mutable, so it stays a separate request. By default the client trusts the host's validity verdict and fetches no grants or proofs. Verify mode (always, or spot-checks, `06` §2) fetches the bundle. In the final system app `a`, or any host, answers the same three requests. Web apps already work this way: content-hashed assets (`app.3f9a1c.js`) are cached forever behind a short-lived `index.html`.

**How CDN entries change.** Two mechanisms, used together:

1. **Expiry (timers):** each response says how long it may be cached (`Cache-Control: s-maxage=…`). After that the CDN does **not** poll on its own. Only when the next request for that URL arrives does it ask the server again, usually with a cheap conditional request (`If-None-Match` with the ETag). The server answers `304 Not Modified` (keep the copy) or sends the new content. `stale-while-revalidate` lets the CDN keep serving the old copy while it refreshes in the background.
2. **Purge (pushed by the server):** the server tells the CDN through its API to drop a URL now.

Here: exact versions and bundles use a very long expiry, plus purge for takedowns; status lookups and feeds use a short expiry plus revalidation.

**Takedowns.** Every major CDN has a purge API (Cloudflare purge by URL or cache tag, CloudFront invalidations, Fastly surrogate keys). When a delete or a moderation hide becomes valid in the projection, a worker purges that event's URL. From then on the API answers **410 Gone** (deleted by its author) or **451 Unavailable** (hidden by moderation, with the address of the deciding event). Feeds drop it on their next refresh, since they are barely cached. The event stays in the log; the host may also drop the payload (`02` §7).

**In-memory cache (Redis or memcached).** Not needed locally or for the company: Postgres's own buffer cache is enough. For the public demo, put it between the API servers and Postgres for the hottest small reads: status lookups, counts (likes per event), assembled feed pages, sessions. Redis is the better fit because its pub/sub can also push live notifications to connected clients (`10` §4); memcached is a pure cache. Keep it behind one `cache` interface so it stays optional and swappable. Invalidation is easy, because the projection worker knows exactly which heads and counts each event changed.

### Read and visibility seam **[P]**

Every read goes through one function, `can_read(session, event)`, the read-side twin of `authorize`. It returns false for:

- events deleted by their author (`04` §5)
- events hidden by the moderation authority this host follows (`10` §2), read from a projection
- **[P]** private events when the reader is not their author (visibility model, `06` §7)

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
| `GET /api/status/:app/:batch/:user/:seq` | head address, deleted/hidden, reveal (same role as the future IDM query); `?history=1` the whole chain |
| `GET /api/bundle/:app/:batch/:user/:seq` | **[P]** event + proofs + grant(s), immutable (verify mode) |
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

- **Hand-coded tools:** Type Maker, App Maker; Graph Visualizer after the first demo (+ the shell and the IDM's account/grants screens).
- **Declarative:** reddit-style posts and comments with votes and hot/new/top sorting. For the company deployment, whatever the team builds itself (`10`). No pages or rich-text documents, no full-text search and no importers for now: the goal is new, strongly typed kinds of events, not traditional documents.
- **Seeded types:** meta-type, primitives, view, action, manifest, type view, type annotation, grant, revoke, edit (supersede), delete, post, comment, reaction, like, vote, proposal, merge.

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

- **Which app opens `/e/…`:** the event's own app (the first integer) by default. If it has no view for the type: the type's default type view, then the auto-renderer generated from the schema. That works even if the app's servers are gone, because its config is in the log (`05` §4, "Displaying one event").
- **Everything that defines the screen goes into the URL.** View props live in the query string, serialized generically by the engine from the view's config, so any screen can be shared.
- Page URLs (`/e/…`) are shell routes. API URLs (`/api/e/…`) are what the CDN caches (§3).
- **[Later]** Names instead of numbers, once naming exists (`06` §1).

## 11. Deployment and configuration

- **Priority order:** run locally on any machine with Node and Postgres (install, one command to create the database, seed genesis and start), then the same on one server, then a cloud (AWS or similar) for the public demo.
- **Local prerequisites (Windows 11, macOS or Linux):**
  - **Node.js**, the current LTS. It includes npm.
  - **pnpm**: `npm install -g pnpm`. Newer Node versions no longer bundle Corepack, so don't rely on it.
  - **PostgreSQL** 16 or newer. Either install it natively (on Windows: the EDB installer or `winget`, which also brings `psql`), or run it in Docker.
  - **Git.**
  - **Not needed globally:** TypeScript and the other tools are dev dependencies of the repo, installed by `pnpm install` and run through its scripts. Docker is optional, for Postgres or for packaging.
- **[P] A `deployment.yml` file** holds the deployment's parameters: name, `first_identity` (1 for local and company deployments, e.g. 1,000,001 for the public demo), block interval (default 1 s), sign-in provider (dev login or OIDC/OAuth). Secrets (database URL, OAuth client secret) come from environment variables, not from the file.
- **Genesis parameters are read once**, when genesis runs on an empty database, and are recorded in genesis itself, e.g. in the creator's `create_identity` tx. The database is then self-describing, and editing the file later doesn't change an existing deployment.
- **Deployments never merge their data** (decided), so their id ranges may overlap: local and company start at 1. Interesting **types and apps move between deployments as bundles** with symbolic references, imported as new events (`05` §6).

## 12. Porting the public demo to the final system

The goal: the public demo moves onto the blockchain plus off-chain batches with minimal changes. The company deployment always stays on-prem, so none of this applies to it.

- **Consent.** **[P]** Sign-up says plainly that public events may be carried into the launched system. Before launch, every identity can **opt out**.
- **Opted-out identities become ghosts, not holes.** Their events keep their addresses, but the import publishes only their leaf hashes (`02` §7): nothing about the event is revealed, not even its type or what it referenced. Other people's events that reference a ghost stay valid, and their comments remain browsable. The UI shows the target as a **ghost** ("not carried over"), distinct from deleted and from private. The identity itself still exists on-chain, owned by the IDM, with no data.
- **No user keys in the public demo.** **[P]** Server-held user keys would add breach risk without adding trust, because the server holds them anyway, so there is no sovereignty gained. Users don't need keys for the import either: their events are authorized by grants (`03` §4), and only batch roots and chain txs need signatures, made by the apps and the IDM at launch. At launch, the IDM issues each user a master key and encrypts their private events with it before the trees are built (`02` §8). Binding personal keys stays optional, as in the final design (`03` §3).
- **Merkle trees before launch: optional.** **[P]** Building trees in a background "shadow" job (never on the write path) would exercise the pipeline early. It needs only provisional algorithms (`02` §9). It is not required: the import builds trees retroactively anyway.

## 13. Tooling (decided)

- **pnpm workspaces** as a monorepo, one package per replaceable piece: log, projector, rules, server, engine, shell, makers.
- **Fastify** for the server, **Kysely** as the thin SQL layer, **Vite + React** for the frontend.
- **Vitest** for tests.
