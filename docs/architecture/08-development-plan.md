# 08 — Development Plan: Phases, Dependencies, Risks

Sizes are relative (S < M < L < XL). **Team: one developer on a small budget** (`00` §1). Every phase has an exit criterion that can be demonstrated. No deadline. The company deployment (P6) is the first real use. Its point is that the team builds its own types and apps, so **the Type Maker and App Maker are the center of the first code** (P4), and P5 then tests them on real in-system mechanics (`10`).

**Code principle:** keep every piece modular and replaceable (log store, projector, validity rules, auth, engine, shell, makers, cache, CDN adapter), each behind a narrow interface. Most business logic is meant to live in-system as types and apps, so rethinking the meta-type, types or manifests later should not be catastrophic.

## 1. Phases

### Phase 0 — Freeze the waist (S)
Decide what can't change once data exists:
- address scheme, reserved zeros, **reserved id range size and genesis ids**
- envelope fields, `version`, flags; JSON payload rules (`02` §4)
- schema language; meta-type fields; the genesis event list
- deployment config: `deployment.yml`, `first_identity` (`07` §11)
- URL scheme of the shell (`07` §10)
- Already settled: TypeScript (`07` §9); config authored by the app identity (`03` §8).
- **Not P0:** canonical binary encoding (CBOR vs custom, `02` §4) and the merkle leaf format / payload commitment (`02` §7). It is decided with real merkelization in P8; the demo only keeps the payload separable.
- **Spike:** replay 10k synthetic events through a throwaway projector to validate the order key and rebuild determinism.

**Exit:** Phase-1-blocking items in `09` §3 closed; genesis listing written.

### Phase 1 — Core log (M)
- Postgres log tables; atomic batch allocation; block producer
- `create_identity`, `publish_batch` txs
- Genesis seed script (deterministic, idempotent on an empty DB)
- Server-side schema validation; JSON-lines export of the log
- Runs locally with one command on any machine with Node and Postgres (`07` §11)

**Exit:** events can be written and read by address; an empty DB + genesis yields identical addresses every time.

### Phase 2 — Projection engine (L)
- Replay in block → tx → within-batch order; rebuild command; projection hash
- Validity: types, grants & revocation as-of-position, `user == app`, signature path stubbed, single-author supersede, delete, hard/soft references, edge activation
- Projections: identities, ownership history, batches, event_state, heads, grants, type_lineage, edges, app_config
- Rule-set hook keyed by block number

**Exit:** rebuild from scratch reproduces the projection hash; property tests on validity pass.

### Phase 3 — Identity & auth (M)
- Single default IDM; OAuth sign-in; account creation via `create_identity`
- Lazy grants, revocation UI; `authorize(session, app, user)`; custody table

**Exit:** an app can post for a user only with a valid grant; revoking stops later events but not earlier ones.

### Phase 4 — Shell & engine (XL)
- Shell: launcher, session, grant prompts, navigation, browser-URL routing (`07` §10)
- Engine: component tree, props/children, bound queries, flex/grid layout, block whitelist (list, tree, graph, form, button, text, stack, row), rendering fallback via type lineage and display templates, unpublished marker
- **Hand-coded Type Maker and App Maker: the main deliverable**, plus the Graph Visualizer

**Exit:** a user creates a type and an app from the UI and uses it.

### Phase 5 — First demo target: reddit-style comments (L)
- **A reddit-style comment system expressed through the Type Maker and App Maker, and nothing more:** posts, nested comments, upvotes, hot/new/top sorting
- Sorting uses built-in live counts hard-coded in the kernel; no expression language yet
- Genesis written as a symbolic data file, ready for later iterations (`05` §6)
- **Stretch:** Type Maker and App Maker re-expressed as config

**Exit:** the comment system is built from the UI with zero code; gaps in the block set documented.

### After P5 — Growing expressiveness (open-ended, unsized)
Iterate: restart with a richer genesis each time (`05` §6), design the expression language and derived values (`04` §10), then build the in-system mechanics with the makers: voting (including on voting rules), reputation, notification inboxes, custom feeds, moderation (`10`). The company deployment can start as soon as P5 is done and grow with these iterations.

### Phase 6 — Company deployment (M)
- Install on one server (same as local), OIDC SSO, backups, ops docs
- `can_read` with the visibility seam; no restricted spaces (`07` §3)
- Proposals + merge bot + simple declarative merge policy (lower priority than before)

**Exit:** a 10–20 person team builds and uses its own types and apps for two weeks.

### Phase 7 — Public deployment & scale (L)
- Stateless servers, LB, managed Postgres + replicas, separate projection workers, CDN with purge-on-takedown, optional Redis behind the `cache` interface (`07` §3)
- Load tests; time-based batching switch for hot apps; outbox + notify

**Exit:** documented load profile with headroom for the target user count.

### Phase 8 — Toward the real system (XL, post-demo)
Merkle trees and real batching (headers, IPFS, tree-of-blobs batches, large media by hash), the erasure-safe leaf format (`02` §7), chain choice (L1 vs rollup) and integration, privacy (encrypted payloads, read grants / group keys, intranet-only batches), replay checkpoints, keys/signatures/rotation, ownership transfer UX, IDM storage + notifications + header monitoring, latest-version attestation and state trees, stable addresses, endpoints/DNS layer, demo-data import with retroactive trees, pipelines/scripting/node editor, precompiles; canonical binary encoding; performance-critical parts in Rust with horizontal scaling, sharding and Kafka/Redpanda.

## 2. Dependencies

```
P0 ─► P1 ─► P2 ─► P3 ─► P4 ─► P5 ─► P6
             │           │           │
             └───────────┴─────► P7 ◄┘
                                 │
                                 ▼
                                 P8
```

**Critical path:** P0 → P1 → P2 → P4 → P5. The engine (P4) is the largest single item and the main schedule risk.

| Dependency | Reason |
|---|---|
| Waist decisions → everything | Addresses, reserved values, envelope and genesis can't change once data exists |
| Genesis types → engine | The engine renders types/configs that genesis defines |
| Projection → auth | Grant validity is evaluated in the projection |
| Auth → shell | The shell drives lazy grant issuance |
| Blocks → declarative apps → self-hosted makers | The test of the config model |
| Instant-batching write path → scale work | The hot counter motivates the batching switch |
| Canonical serialization → signatures, merkle, import | Must be fixed before anything is hashed |
| External: OAuth/OIDC provider, hosting, domain | P3, P6, P7 |
| People: one developer covers engine (P4) and DB/ops (P7) | Everything is on the critical path of one person |

## 3. Risk register

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| R1 | **Scope creep** — chain, IDMs, DNS, scripting pull effort away from the demo | H | H | `07` scope is the contract; everything in `06` is out unless a phase says otherwise; review at every exit |
| R2 | **Config model too weak or wrong.** Declarative apps can't express enough, and the type/app/view model is expected to need rework once it can be seen working | H | H | Start with a board app; list gaps in P5; keep demo data disposable until P5; engine isolated from the log/projection core; escape hatch designed but deferred |
| R3 | **Waist decisions wrong after data exists** (addresses, genesis, envelope) | M | H | P0 freeze; version genesis; export/import test from P1; demo data disposable until P5 |
| R4 | **Projection non-determinism** (order, floats, wall clock, arrival order) | M | H | Rebuild-and-hash in CI; fixed order key; no floats or clock in validity paths |
| R5 | **Validity bugs** (revocation as-of, ties, same-batch deps, supersede authorship) | M | H | Property tests; rules isolated and versioned; explicit rule list in `03` §5 |
| R6 | **Engine / layout complexity** | H | M | Block whitelist; reuse existing declarative UI ideas; no custom layout language |
| R7 | **Hot batch counter** at scale | M | M | Time-based batching per app; early load tests |
| R8 | **Reference-convention latency** (real batching) feels slow | M | M | Short intervals; same-batch refs; queued requests with local pending UI |
| R9 | **IDM as trusted bottleneck** for "latest" | M | M | Attested answers + committed roots; archives/indexers; slow-path verification |
| R10 | **Demo shortcuts diverge** from the real system (one IDM, no keys, auto-grants) | M | H | Keep invariants in the data (`initiator`, grant events, nullable key); shortcuts behind single seams (`authorize`, custody) |
| R11 | **Config authorship choice churns** | M | L | Isolated in App Maker; refactorable |
| R12 | **Erasure / moderation** requirements at public launch | M | H | Mechanism settled (leaf commits to `hash(payload)`, `02` §7); decide the legal position before P7 |
| R13 | **Single developer:** illness, burnout, or a skill gap (engine, ops) stops everything | H | H | Strict scope (R1); docs in this folder; decisions logged in `09`; managed services over self-run ops; one language end to end (`07` §9) |
| R14 | **Schema language** choice blocks tooling | M | M | Decide in P0; start with a minimal deterministic subset |
| R15 | **Convention violations** by apps leave odd graphs | L | L | Hard violations invalid; soft edges activate late |
| R16 | **Grant semantics after migration** unclear | L | M | Default in `03` §2; revisit before P8 |
| R17 | **Reserved-range / genesis ids** chosen badly (scarcity economics) | L | H | Decide deliberately in P0; can't shrink later |
| R18 | **Company later needs private spaces**, but the demo assumes everything is readable | L | M | Not needed at the start; `can_read` seam from the start, so ACLs as events can be added without touching the core |
| R19 | **64-bit ids lose precision** in JS `number` | M | H | `BigInt` end to end; driver config; a test with ids above 2^53 |
| R20 | **Spam at public launch** | M | M | Social and infra flagging (`06` §8); account price or throttle before the final system launches |
| R21 | **Expression language is hard.** Voting, strikes, reputation and threshold notifications all need aggregates and feedback-safe derived values | H | M | Kept out of the first demo; design after P5 with stratified epochs (`04` §10); start with a small non-Turing-complete language (`05` §4); grow it from the gaps found (`10` §7) |
| R22 | **Moderation abuse or capture** (unfair moderators, false-report brigading) | M | M | Disputes, escalation tiers, penalties and reputation (`10` §2); operator override |

## 4. Test strategy

- **Determinism:** full rebuild ⇒ same projection hash; random permutation of insertion where order is irrelevant ⇒ same hash.
- **Property tests** on validity: revocation at/after/before, ties within a block, same-batch dependencies and cycles, supersede branches, non-author edits, deletes, forks, `user == app`, grants for the wrong app.
- **Genesis:** empty DB + seed ⇒ identical addresses and projection hash.
- **Export/import:** export the demo log canonically; a script builds batches and merkle trees retroactively and verifies inclusion proofs for every event.
- **Load:** counter contention, projection lag, cache hit rates.
- **UI:** rendering fallback for unknown types (base type → template → JSON).

## 5. Definition of done (demo)

1. Deterministic genesis; rebuild matches.
2. Sign in, open an app (lazy grant), post valid events; revoke works as-of.
3. Create a type and an app from the UI.
4. A declarative board with comments, likes, upvotes, sorting.
5. Edit, delete, propose and auto-merge with provenance.
6. Company deployment running on one node; public deployment with a documented load profile.
7. Export → retroactive merkle proofs verify.

## 6. First week

1. Commit these docs; close the remaining P0 questions (`09` §3, items 1, 3 and 4).
2. Write the genesis listing as data (a YAML/JSON file) before any code.
3. Create the log schema and the atomic write path; write the determinism test first.
4. Build the throwaway replay spike against 10k synthetic events.
