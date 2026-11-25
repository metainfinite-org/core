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
- Reads return the latest version by default; history on request
- Export of the log in canonical form (for the later import test)

**Out** (see `06`): real chain, keys and signatures, merkle trees in the live path, delayed batching, IDM storage/notifications/state trees, stable addresses, endpoints/DNS, scripting and node editor, precompiles, fees.

The UI still keeps the **"unpublished" marker** component even though instant batching never shows it.

## 3. Two deployments, one codebase

| | Company knowledge base | Public demo |
|---|---|---|
| Audience | 10–20 people | Up to a few hundred thousand users, ideally 1M |
| Topology | One node, docker compose: app server + Postgres | Stateless API servers behind a load balancer; managed Postgres + read replicas; projection workers as separate processes; CDN |
| Sign-in | SSO via OIDC into the single IDM | OAuth into the single IDM |
| Genesis | Its own | Its own |
| Ops | Nightly backups | Managed backups, monitoring |
| Key feature | Wiki workflow via proposals + merge bot | Cache-friendly reads |

**Rules that keep both on one codebase:** stateless servers; all state in the database; write path separate from projections; no global autoincrement ids (addresses already partition by app); timestamps from the DB primary, not app servers — block order is the real authority anyway.

**Caching:** an event at a version address is immutable ⇒ perfectly cacheable forever (CDN, browser). Only "latest version" lookups and projections need freshness.

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
| `GET /events/:app/:batch/:user/:seq` | **latest version** by default; `?exact=1` this version; `?history=1` the whole chain |
| `GET /latest?addr=…` | head lookup (same shape as the future IDM query) |
| `GET /events?ref=…&type=…&sort=…` | engine queries (descendant types included) |
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
- **Declarative:** a board/feed (posts, comments, likes, upvotes, hot/new/top sorting); for the company deployment a wiki-style knowledge base (pages, proposals, merges).
- **Seeded types:** meta-type, primitives, view, action, manifest, grant, revoke, edit (supersede), delete, comment, like, upvote, proposal, merge.
