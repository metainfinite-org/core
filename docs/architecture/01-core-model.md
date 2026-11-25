# 01 — Core Model

## 1. Identities

- An identity is a 64-bit integer. **No kind field**: any identity can act as user, app, IDM, or all of these. "Being an app" is simply having published batches.
- Every identity has a **batch counter** = number of batches it has published as an app. It starts at **0**; the first batch is **1** (so 0 stays reserved).
- **Creation is an on-chain transaction** initiated by the creating identity, which becomes the new identity's **owner** (its IDM). The identity's creation time is the timestamp of the block containing that transaction — there is no separate `created_at` to trust.
- The `identities` table is a **projection** of the log. The batch counter is derivable (`MAX(batch)` over the identity's events) but is kept as a live column so the next batch number can be allocated with one atomic increment. Treat it as a cache.

### Identity space and positional scarcity

- Low numbers are valuable and will be **sold** (positional scarcity). The first 1k / 10k / 1M ids are reserved. **[O]** exact size for the real system.
- **Each deployment chooses its first id.** Local and company deployments start at 1; the public demo starts higher, e.g. 1,000,001. It is a genesis parameter from the deployment config, recorded in genesis (`07` §11).
- The **genesis creator gets a number above the reserved range**, not 0 and not 1.
- **[P]** Fix the reserved range once and forever before genesis — it can never shrink after data exists.
- **[P]** Two creation modes: *explicit id* (only for reserved ids, granted by the creator/governance — this also leaves an auditable on-chain record of every grant/sale) and *next free id* above the reserved range for ordinary signups. Low ids therefore cannot come from a sequential counter.

## 2. Event addresses

`app / batch / user / seq`, e.g. `7/42/5/1`.

| Part | Meaning |
|---|---|
| `app` | Identity of the application the event was emitted through |
| `batch` | That app's batch number (`7/1`, `7/2`, …) — the app's nonce |
| `user` | Identity that authored the event |
| `seq` | Per-user counter **within that batch**: almost always 1; 2, 3… only if the same user emits several events in the same batch |

Properties:

- **Predictable at creation.** An app knows how many batches it has published, so it knows the next batch number. An event has its final address immediately — no provisional ids, even before its batch is published.
- **Never changes.** Whether the batch is published yet is a UI-level status (shown as a small "unpublished" icon), not part of the identity.
- **Canonical form is the 4-integer composite key.** Prefix queries come free: an app's events, one batch, one user within an app's batch.
- **No hash of the address, no second string key.** The address is a location, not a content commitment (the merkle tree provides the commitment later). The string form `"7/42/5/1"` exists only at the edges — URLs, display, references inside text — in one canonical format.
- **`user == app` is legal**: `X/b/X/s` is an app emitting an event as itself inside its own batch.

### Reserved zeros

All four fields start at 1; 0 is reserved in every position. Assigned meanings so far:

| Pattern | Meaning |
|---|---|
| `0` as identity | The system / null identity (e.g. initiator of the creator's own creation in genesis) |
| `A/B/0/0` | **[P]** The batch itself — where its merkle root, header hash and chain tx attach, so a whole batch is referenceable |
| `0/0/0/0` | **[P]** Null reference (storage still uses SQL `NULL`) |
| `0/0/U/S` | **[Later]** Stable address resolved by U's IDM (see `06`) |

## 3. Batches

- An app accumulates events in **one open batch** at a time. Every X seconds/minutes the batch is **sealed**: merkle root computed and published on-chain (mandatory), optionally together with an IPFS hash of a batch header; the counter advances; the next batch opens. Apps choose their own interval: only the biggest apps (facebook/twitter scale) publish every block or every few blocks, smaller ones once a minute or less often.
- **[P] Batch structure:** a batch is a **tree of IPFS blobs** in a hierarchy, with headers, so parts can be fetched selectively. Ordinary payloads sit inside the batch. Very large files (video, big images) are referenced from the payload by a hash commitment plus a way to fetch them, e.g. an IPFS hash (`02` §7).
- Events that arrive while sealing go into the next batch — still predictable.
- The **merkle tree is built incrementally** by hashing events as they are added. **[P]** Leaves ordered by `(user, seq)` give deterministic trees, cheap inclusion proofs, and **proofs of absence** ("U has nothing in this batch").
- **Pending visibility:** apps may expose their open batch read-only (e.g. twitter asks facebook what is in facebook's next batch), and UIs show those events with an "unpublished" marker. **Other apps may not reference them until published** (decided convention — `04` §5).
- **Discarding pending events:** a pending event can be cancelled by another event in the same batch (e.g. a delete), or deleted while still occupying its slot in the sequence in case anyone already referenced it. **[O]** whether an open batch is guaranteed to seal. Under the reference convention the blast radius is limited to the app's own references.
- **Demo:** batching is instant — each event is its own batch, published at creation. `seq` is always 1. No sealing timer, no pending state. The address scheme is kept regardless so the data imports into the real system.

## 4. Emulated chain: blocks and transactions

The log has exactly three tables: **`blocks`, `txs`, `events`**.

- `blocks(number, created_at)` — the authoritative clock. Later: previous hash, tx root.
- `txs(block, idx, initiator, type, payload)` — each tx points at its block and records who initiated it.

| Tx type | Payload | Notes |
|---|---|---|
| `create_identity` | new id (explicit or next-free), owner = initiator | the identity's birth |
| `publish_batch` | app, batch, merkle root, header hash | demo: one per event, no root |
| `bind_key` | identity, public key, rotation proof | **[Later]**; old key signs new key, or user signs directly |
| `transfer_ownership` | identity, new owner | IDM migration, app/account sales |
| `publish_endpoint` | identity, network address | **[Later]** DNS-like layer |

- **Events need no block column.** An event's block = the block of its `(app, batch)` `publish_batch` tx, available from the derived `batches` projection.
- Identity creation is a transaction, not an event.

## 5. Events

Envelope details are in `02`. Fields:

- address `(app, batch, user, seq)` and envelope `version`
- `type_ref` — **mandatory**, address of the type event
- `ref` — optional **single** reference to another event
- `auth` — optional address of a grant event; `signature` — optional
- `payload` — interpreted according to the type
- `created_at` — the creator's/server's claimed fine-grained time. Kept because once batches span seconds or minutes it is the only fine-grained time; the block time is authoritative.

Rules:

- **Immutable.** No `deleted` flag, no updates — deletion and editing are new events (`04`).
- **One reference by default.** Multi-reference events ("multicast likes") are rare: extra edges live in the payload and a projection builds whatever edge table it needs. No `event_refs` table.
- **Types evolve by supersession** — a new type event pointing at the previous one; no version integer inside types (`05`).

## 6. Replay order

A total, deterministic order defined by the chain:

1. block number
2. transaction index within the block
3. inside one batch: `created_at`, then `(user, seq)` as tiebreak

`created_at` alone is never the order between batches — it is a claim and could be backdated (e.g. to sneak in before a revocation). Within one block, a revocation wins ties. In the demo, where every event is its own batch and own tx, the order is simply block → tx index.

## 7. Core SQL (demo)

```sql
-- LOG ----------------------------------------------------------------
CREATE TABLE blocks (
  number     BIGINT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE txs (
  block     BIGINT   NOT NULL REFERENCES blocks(number),
  idx       INT      NOT NULL,
  initiator BIGINT   NOT NULL,
  type      TEXT     NOT NULL,
  payload   JSONB    NOT NULL,
  PRIMARY KEY (block, idx)
);

CREATE TABLE events (
  app BIGINT NOT NULL, batch BIGINT NOT NULL, usr BIGINT NOT NULL, seq BIGINT NOT NULL,
  version    SMALLINT NOT NULL DEFAULT 1,
  type_app BIGINT NOT NULL, type_batch BIGINT NOT NULL, type_usr BIGINT NOT NULL, type_seq BIGINT NOT NULL,
  ref_app  BIGINT, ref_batch  BIGINT, ref_usr  BIGINT, ref_seq  BIGINT,
  auth_app BIGINT, auth_batch BIGINT, auth_usr BIGINT, auth_seq BIGINT,
  signature  BYTEA,
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  visibility SMALLINT NOT NULL DEFAULT 0,  -- [P] 0 public, 1 private; shared-with-set later (06 §7)
  supersedes BOOLEAN NOT NULL DEFAULT FALSE,  -- [P] the supersede flag: ref = previous version (04 §3)
  PRIMARY KEY (app, batch, usr, seq),
  CHECK (app > 0 AND batch > 0 AND usr > 0 AND seq > 0)
);
CREATE INDEX events_by_ref  ON events (ref_app, ref_batch, ref_usr, ref_seq);
CREATE INDEX events_by_type ON events (type_app, type_batch, type_usr, type_seq);
CREATE INDEX events_by_auth ON events (auth_app, auth_batch, auth_usr, auth_seq);
```

`usr` avoids the SQL keyword. Projection tables are in `07`.

**Atomic allocation (demo write path):** in one DB transaction — increment the app's counter (`UPDATE identities SET batch_count = batch_count + 1 WHERE id = $app RETURNING batch_count`), insert the event with that batch and `seq = 1`, insert its `publish_batch` tx into the currently open block. Concurrent events from the same app can then never collide.
