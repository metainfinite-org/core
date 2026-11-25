# 09 — Decisions, Withdrawn Ideas, Open Questions

## 1. Decision log

D = decided/agreed · P = proposed, not confirmed · O = open · L = deferred to the final system

| # | Topic | Decision | Status | See |
|---|---|---|---|---|
| 1 | Identities | Integers; no kind; any identity can be user and app | D | 01 §1 |
| 2 | Addresses | `app/batch/user/seq`; batch = app nonce; seq = per-user-per-batch | D | 01 §2 |
| 3 | Addresses | Predictable at creation; never change; "published" is a UI status | D | 01 §2 |
| 4 | Keys | Composite 4-integer key; no hash, no stored string key | D | 01 §2 |
| 5 | Zeros | All fields start at 1; 0 reserved everywhere | D | 01 §2 |
| 6 | Zeros | `A/B/0/0` = batch, `0/0/0/0` = null | P | 01 §2 |
| 7 | Id space | Low ids reserved for sale; genesis creator above the range | D | 01 §1 |
| 8 | Id space | Fixed range size; explicit-id grants vs next-free | P / size O | 01 §1 |
| 9 | Counter | Batch counter on identities; 0 at creation; first batch 1; atomic increment | D | 01 §1, §7 |
| 10 | Demo batching | Instant: one event per batch; full scheme kept for import | D | 01 §3 |
| 11 | Log | Three tables: blocks, txs (block + initiator), events | D | 01 §4 |
| 12 | Log | Identity creation is a tx; identity created_at = block time | D | 01 §4 |
| 13 | Log | Events have no block column; derived via batches projection | D | 01 §4 |
| 14 | Events | Immutable; no deleted flag | D | 01 §5 |
| 15 | Events | Keep `created_at` (claimed); block time authoritative | D | 01 §5 |
| 16 | Order | Block → tx → (created_at, user, seq) within batch; revocation wins ties | D | 01 §6 |
| 17 | Refs | One `ref` field; multi-refs in payload; no event_refs table | D | 01 §5 |
| 18 | Envelope | auth + signature as optional envelope fields; null auth ⇒ signed | D | 02 §3 |
| 19 | Envelope | Version integer from the start; flags field (varint, P) | D | 02 §1–2 |
| 20 | Envelope | Signature covers the address; auth path doesn't need it | D | 02 §3 |
| 21 | Envelope | Stored auth is a reference; bundles inline grants for export | D | 02 §3 |
| 22 | Encoding | Deterministic canonical form; not protobuf | D | 02 §4 |
| 23 | Encoding | CBOR-deterministic vs custom layout: decided in P8, lean CBOR | O (P8) | 02 §4 |
| 24 | Types | Primitives are genesis type events; NFC strings; minimal varints | D | 02 §5 |
| 25 | Types | float64 storable with canonical encoding; exact ops only in consensus paths | D | 02 §5 |
| 26 | Types | Versioning by supersession (now the generic edit mechanism, decision 172); no version field; forks allowed | D | 05 §3 |
| 27 | Types | `extends` separate from `supersedes`; rendering fallback; display template (now an annotation, decision 160) | D | 05 §3 |
| 28 | Types | Single inheritance first | P | 05 §3 |
| 29 | Meta-type | Self-referential; extended by superseding; unknown fields preserved | D | 05 §2 |
| 30 | Validation | Server, projection, clients eventually; demo = server-side | D | 04 §8 |
| 31 | Ownership | On-chain; creator owns created identity; does not chain | D | 03 §2 |
| 32 | Ownership | Only sovereign identities can be IDMs | D | 03 §2 |
| 33 | Migration | Via current IDM normally; directly by sovereign user if IDM is down/rogue | D | 03 §2 |
| 34 | Keys | Key is a backup; rotation via own tx or IDM tx with old-key signature | D | 03 §3 |
| 35 | Keys | All txs signed; demo has no keys, keeps `initiator` | D | 03 §3 |
| 36 | Grants | Off-chain events by the IDM; revocable by the IDM; lazy issuance | D | 03 §4 |
| 37 | Grants | Event's auth points at one specific grant (compartmentalization) | D | 03 §4 |
| 38 | Grants | Scopes, expiry, delegation chains later via type evolution | L / chains P | 03 §4 |
| 39 | Validity | Judged as of position; `user == app` needs no auth | D | 03 §5 |
| 40 | Rules | Versioned by block number (hard-fork-style consensus) | D | 03 §6 |
| 41 | Transport | Demo: no API keys; one `authorize(session, app, user)` seam | D | 03 §7 |
| 42 | Apps | Apps are identities owned on-chain; human control = IDM custody policy | D | 03 §2 |
| 43 | Apps | Demo config authored by the app identity via App Maker (revisit once code exists) | D | 03 §8 |
| 44 | Governance | Creator sunsets; canonical meta-type named by the rule set; envelope by ecosystem | D | 03 §9 |
| 45 | State | State = replay; authorization in the projection | D | 04 §1 |
| 46 | Edits | Single-author version chains; anyone can fork | D | 04 §3 |
| 47 | Edits | Shared editing via proposals auto-merged by the owner, with provenance | D | 04 §4 |
| 48 | Edits | Merge policy, patch format | P / O | 04 §4 |
| 49 | Delete | Delete events; meaning is emergent and decided by interpreters | D | 04 §5 |
| 50 | Delete | Optional deletion hint, as a type annotation | P | 04 §5 |
| 51 | Refs | Soft vs hard references | D | 04 §6 |
| 52 | Refs | Show but don't reference other apps' unpublished events | D | 04 §6 |
| 53 | Refs | Creation-time enforcement with queued requests | D | 04 §6 |
| 54 | Refs | Same-batch dependencies allowed | P | 04 §6 |
| 55 | Refs | Edge activation at the later endpoint's block | P | 04 §6 |
| 56 | Compute | Pure functions of block prefixes, fixed order, deterministic arithmetic | D | 04 §7 |
| 57 | Apps | Declarative config: views, actions, manifests; aim 100% in-system | D | 05 §4 |
| 58 | Apps | Component tree; reuse existing declarative UI models | P | 05 §4 |
| 59 | Genesis | Deterministic script seed, partly on-chain, partly off-chain | D | 05 §6 |
| 60 | Makers | Hand-coded first, re-expressed as config later | D | 05 §6 |
| 61 | Reads | Latest by default, history on request | D | 04 §3 |
| 62 | DB | PostgreSQL; Kafka later | D | 07 §4 |
| 63 | Deploy | Company KB (single node) + scalable public demo, one codebase | D | 07 §3 |
| 64 | Demo IDM | Single default IDM owning all accounts, distinct from the creator | D | 03 §1 |
| 65 | Future | IDMs store/serve users' events, get notified, monitor headers | L | 06 §3 |
| 66 | Future | Latest-version queries answered by the user's IDM (attested) | L | 06 §4 |
| 67 | Future | Stable addresses `0/0/user/seq`, IDM-issued | L | 06 §5 |
| 68 | Future | On-chain endpoints (DNS-like), name ownership | L | 06 §1 |
| 69 | Future | Pipelines, scripting nodes, node editor, precompiles | L | 06 §6 |
| 70 | Project | One developer, small budget | D | 00 §1 |
| 71 | Project | Company KB = real use and possible revenue; public demo = later launch | D | 00 §1 |
| 72 | Product | Differentiator vs Notion/Confluence: custom types & apps, any functionality in-system | D | 00 §1 |
| 73 | Stack | TypeScript end to end (Node + React); `BigInt` for 64-bit ids; plain SQL | D | 07 §9 |
| 74 | Privacy | Via grants, keys, encryption; batches may be intranet-only | D | 06 §7 |
| 75 | Chain | Merkle root mandatory on-chain; IPFS header hash optional | D | 06 §2 |
| 76 | Privacy | Encryption flag; `type_ref`/`ref`/`auth` stay plaintext | P | 02 §8 |
| 77 | Privacy (demo) | No crypto; `can_read` seam; CDN caches public events only | P | 07 §3 |
| 78 | Erasure | Leaves and signatures commit to envelope + `hash(payload)` | D | 02 §7 |
| 79 | Erasure | Leaf format decided with real merkelization (P8), not P0 | D | 02 §7 |
| 80 | Availability | No economic incentive; bad services lose customers | D | 06 §3 |
| 81 | Spam | Left to social incentives; infra services flag identities | D | 06 §8 |
| 82 | Accounts | Price or throttle for on-chain account creation at launch | L | 06 §8 |
| 83 | Types | Duplicates accepted; apps pick canonical types; convergence by usage | D | 05 §3 |
| 84 | Types | Mappings between types; usage-ranked type pickers | P | 05 §3 |
| 85 | Infra | Apps self-host (on-chain endpoint) or use infra companies that charge apps per usage | D | 06 §9 |
| 86 | Chain | Users rarely touch the chain; IDMs batch users' ops; publish rate by app size | D | 06 §10 |
| 87 | Chain | Identity txs with many items per tx | P | 06 §10 |
| 88 | Media | Batch = tree of IPFS blobs with headers; large files by hash + locator | P | 01 §3 |
| 89 | Replay | Checkpoints by infra companies; deterministic, hash-verifiable | D | 04 §9 |
| 90 | Keys | Key recovery (social, guardians, time-locked IDM path) | L | 03 §3 |
| 91 | Apps | Type/app/view/scripting model expected to be reworked once built | D | 05 §4 |
| 92 | Company KB | No private events or restricted spaces at the start; everyone in the deployment reads everything | D | 07 §3 |
| 93 | Company use | The team builds its own types and apps (self-organization, reputation, priorities, voting, voting on voting rules); no pages/rich text, full-text search or importers for now | D | 07 §3, 10 |
| 94 | Caching | Exact-version URL cached forever on the CDN, briefly in browsers; "latest" is a separate small lookup | P | 07 §3 |
| 95 | Caching | Takedowns via CDN purge APIs; 410 for deleted, 451 for hidden | P | 07 §3 |
| 96 | Caching | Redis/memcached only for the public demo, behind a `cache` interface | P | 07 §3 |
| 97 | Moderation | In-system: code of conduct, flags, decisions, strikes, bans, tiers, disputes, overturns, penalties, reputation | D | 10 §2 |
| 98 | Moderation | A host follows a chosen moderation authority; operator override for illegal content | P | 10 §2 |
| 99 | Governance | Voting, rules as events, rules about rules, all in-system | D | 10 §3 |
| 100 | Notifications | Default inbox for references to your events; system-wide custom criteria; multiple inboxes | D | 10 §4 |
| 101 | Feeds | Fully customizable feeds as user-owned view configs | D | 10 §5 |
| 102 | Kernel | Expression language with aggregates + user-defined derived values, needed in P5 | P | 10 §6 |
| 103 | URLs | The shell owns the browser URL; apps, views and events are linkable | D | 07 §10 |
| 104 | URLs | Scheme `/a/<app>`, `/e/<addr>`, view props in the query string | P | 07 §10 |
| 105 | Deploy | Local first (Node + Postgres), then one server, then cloud | D | 07 §11 |
| 106 | Deploy | First id configurable per deployment; recorded in genesis; `deployment.yml` | D / file format P | 07 §11 |
| 107 | Encoding | Plain JSON in the demos, with lossless-conversion rules | P | 02 §4 |
| 108 | Stack | Rust later for performance-critical parts, with sharding and Kafka/Redpanda | L | 07 §9 |
| 109 | Code | Modular; every piece replaceable behind a narrow interface | D | 08 |
| 110 | Plan | No deadline; first code centers on the Type Maker and App Maker | D | 08 |
| 111 | Demo | First demo = reddit-style comments built with the makers, nothing more | D | 08 P5 |
| 112 | Derived values | Definitions are events; the kernel executes them (interpreted, incremental, precompiled) | P | 04 §10 |
| 113 | Derived values | Generic tables keyed by definition; no new table per business rule | P | 04 §10 |
| 114 | Derived values | Live vs epoch computations; epochs defined by block height | P | 04 §10 |
| 115 | Derived values | Cycles only through the previous epoch (stratification) | P | 04 §10 |
| 116 | Display | Type, type view and app view are separate; type views are separate events, many per type | P | 05 §4 |
| 117 | Display | Auto-renderer and auto-form from the schema; Type Maker creates a default type view | P | 05 §4 |
| 118 | Display | `/e/a/b/c/d` opens in app `a` by default | D | 07 §10 |
| 119 | Genesis | Symbolic genesis file; iterations ("restart the Matrix"); bundles | P | 05 §6 |
| 120 | Deploy | Deployments never merge data; types/apps move as bundles | D | 07 §11 |
| 121 | Moderation | Operator appoints the first tier; elections or reputation later | D | 10 §2 |
| 122 | Notifications | Inboxes are derived lists; read state is per-item `seen` events (plus a bulk form) | D | 10 §4 |
| 123 | Notifications | `seen` events are ordinary events; stored by the IDM; browsed in the inbound app | D | 10 §4 |
| 124 | Display | App views reuse or override type views; fixed precedence | P | 05 §4 |
| 125 | Hosting | Abandoned apps can be re-hosted by anyone (read + compute); writing needs ownership transfer or a fork | P | 06 §9 |
| 126 | Hosting | Hosting announcements as events (claims, not authority) | P | 06 §9 |
| 127 | Genesis | Genesis file read automatically on first boot; the creator emits it | D | 05 §6 |
| 128 | Privacy | Visibility is per event: public, private, later shared-with-set | D | 06 §7 |
| 129 | Privacy | Defaults: per-event → user default per type (settings events) → type suggestion → public; stamped at creation | D | 06 §7 |
| 130 | Privacy | Private → public by key reveal; public → private only best effort | P | 06 §7 |
| 131 | Privacy | Demo hack: `visibility` column enforced by `can_read` | P | 06 §7 |
| 132 | Privacy | `viewed` events make browsing history publishable | P | 06 §7 |
| 133 | Apps | Inbound app: sink for all incoming events; replaces email and DMs; companion to the IDM | D / companion P | 10 §4 |
| 134 | Chain | Merkle overhead is modest (1M events ≈ depth 20, ≈ 64 MB of nodes) | D | 06 §2 |
| 135 | Privacy | Public aggregates count only public events; apps ask the IDM for the user's own private events | D | 06 §7 |
| 136 | Privacy | Per-event keys derived from a master key; reveal = publish one event key | P | 06 §7 |
| 137 | Privacy | Sharing by wrapping the content key to each recipient | P | 06 §7 |
| 138 | Privacy | Reserve the "payload encrypted" flag bit now; the import encrypts demo private events | P | 02 §8 |
| 139 | DMs | In-system DMs, Signal as a transport, MLS as the natural fit for groups; external channels too | P | 06 §7 |
| 140 | Proofs | Optional for clients; spot-checking; store the tree (upper levels + leaf hashes as the middle ground) | P | 06 §2 |
| 141 | Apps | Bookmarks, private notes, lists/playlists as `collection` + membership events | P | 10 §8 |
| 142 | Envelope | Flags field is a varint; 4 bits assigned (ref, auth, signature, encrypted) | P | 02 §1.1 |
| 143 | Privacy | A private event is one event; reveal is a separate event; ciphertext bytes never change | P | 02 §8, 06 §7 |
| 144 | Privacy | Re-privatize = delete the reveal event (best effort) | D | 06 §7 |
| 145 | Merkle | Two-level leaf `H(H(envelope) ‖ H(payload))`: full, erased, or ghost | P | 02 §7 |
| 146 | Crypto | Algorithm identifiers on all hashes, keys, signatures; standard crypto first, PQ-hardened before launch with expert review | P | 02 §9 |
| 147 | Port | Consent at sign-up, opt-out before launch, opted-out identities become ghosts | P | 07 §12 |
| 148 | Port | No user keys in the public demo; IDM issues master keys at launch | P | 07 §12 |
| 149 | Port | Shadow merkle trees optional before launch | P | 07 §12 |
| 150 | Apps | Collections: one canonical membership, any number of orderings (views, arrangements with fractional-index positions, snapshots) | P | 10 §8 |
| 151 | Reads | Immutable bytes and bundles (cached forever) vs one mutable status lookup (head, deleted/hidden, reveal) | P | 07 §3 |
| 152 | Reads | Validity and grants are immutable, so they can be bundled; by default the client trusts the host's verdict | P | 07 §3 |
| 153 | Encoding | DAG-CBOR for the whole event; SSZ considered and not chosen; RLP rejected | P | 02 §4 |
| 154 | Crypto | Multihash for hashes, multicodec for keys and signatures | D | 02 §9 |
| 155 | Crypto | Hybrid classical + PQ during the transition; prefer hash-based signatures | P | 02 §9 |
| 156 | Scripting | Expressions: Datalog/CEL-like; script nodes: deterministic, metered WebAssembly | P | 06 §6 |
| 157 | Collections | Sort keys over pinned-collation primitives; types may suggest default keys; heterogeneous collections allowed | P | 10 §8 |
| 158 | Demo | First demo includes sign-in, grants, revocation, edit, delete; Graph Visualizer later | D | 08 P5 |
| 159 | Types | Lean meta-type: name, schema, extends, constraints, extensions | D | 05 §2 |
| 160 | Types | Hints (display template, sort keys, deletion, visibility) in a `hints` namespace of `extensions`, overridable by type-annotation events | D | 05 §2 |
| 161 | Types | Uniqueness constraints in types (`unique_per`, latest wins) | D | 05 §2 |
| 162 | Types | `reaction` base type; `like` and `vote` (+1/−1) extend it | D | 05 §6 |
| 163 | Types | JSON Schema (deterministic subset) as the schema language | D | 05 §3 |
| 164 | Genesis | Meta-type schema uses JSON Schema native keywords, so there is no regress | D | 05 §2 |
| 165 | Genesis | Genesis message in the meta-type's extensions; block 1 message to be chosen later | D / O | 05 §2 |
| 166 | Auth | Dev login locally; OIDC/OAuth on servers | D | 07 §2 |
| 167 | App Maker | v1: types, fixed layouts, fixed sorts, generated-form actions, name; no view composition | D | 08 P5 |
| 168 | Deploy | Block interval 1 s by default, in `deployment.yml` | D | 07 §11 |
| 169 | Tooling | pnpm monorepo, Fastify, Kysely, Vite + React, Vitest | D | 07 §13 |
| 170 | Privacy | Types carry no visibility default; apps set defaults | D | 06 §7 |
| 171 | Types | Constraints: fixed v1 vocabulary (`unique`, `ref_type`, `author_is`); scope exact type or family; subtypes only tighten | P | 05 §2 |
| 172 | Types | No `supersedes` field; type versions are edits; superseding is a claim, adoption is social consensus | D | 05 §3 |
| 173 | Envelope | Supersede flag: `ref` = previous version; lineage relations come from the root | P | 04 §3 |
| 174 | Deploy | Local prerequisites: Node LTS, pnpm, PostgreSQL 16+, Git; Docker optional | D | 07 §11 |

## 2. Withdrawn or superseded (don't re-propose without a new reason)

| Idea | Replaced by |
|---|---|
| Provisional ids until a batch seals | Predictable addresses |
| `kind` column; separate `apps` table | Counter on identities; roles emerge |
| `deleted` column on events | Delete events |
| `batches` table in the log | Batches derived from `publish_batch` txs |
| Global autoincrement column for ordering | Block order |
| Ordering by `created_at` alone | Block → tx → within-batch |
| `event_refs` table | Single `ref`, multi-refs in payload |
| Hash of the address / second string key | Composite integer key |
| Pre-granting all users when an app is created | Lazy grants |
| API keys or keypairs for transport auth in the demo | Server is the authority; `authorize` seam |
| Referencing other apps' unpublished events | Show-but-don't-reference convention |
| Holding a batch until dependencies publish | Creation-time enforcement, queued requests |
| Grace window of K blocks look-ahead | Rejected |
| Enforced per-type delete policy | Emergent rules + optional hint |
| Only the creator can supersede the meta-type | Rule-set governance + creator sunset |
| `operator` field in manifests | On-chain ownership + IDM custody |
| Edit grants to other users; multi-author version chains | Single-author chains + proposals |
| Shared identity with many owners + `actor` field | Proposals auto-merged by the owner |
| Inline grant as the canonical stored form | Reference; inline only in bundles |
| Stable addresses as a requirement | Optional, deferred |
| Pinning, replication mandates or economic incentives for data availability | Market: bad services lose customers |
| Protocol-level spam prevention for off-chain data | Social consensus, infra flagging |
| Merkle leaf / payload-hash format as a Phase-0 decision | Decided with real merkelization (P8) |
| Leaf committing to the payload bytes directly | Leaf commits to `hash(payload)` |
| "Personal" types readable only by their author | Per-event visibility with defaults |
| SSZ for the envelope | One encoding (DAG-CBOR); per-field proofs cost more than the ~100-byte envelope |
| `display_template`, `deletion_hint`, `suggested_visibility` as meta-type fields | Hints in `extensions` + annotation events |
| `supersedes` field in the meta-type | Generic edit mechanism with the supersede flag |
| Wiki workflow as the company deployment's main feature | The team builds its own types and apps |
| An event URL that returns the latest version by default | Exact-version URL plus a separate status lookup |
| Canonical binary encoding as a Phase-0 decision | JSON in the demos; decided in P8 |

## 3. Open questions

Phase-0 blockers first.

1. **Reserved id range** size; genesis creator and IDM ids.
2. ~~**Canonical encoding**~~ — deferred to P8; the demos use JSON (decision 107). Lean: DAG-CBOR for everything (decision 153).
3. ~~**Schema language**~~ — resolved: JSON Schema subset (decision 163).
4. ~~**Meta-type field list**~~ — resolved: lean meta-type (decision 159).
5. ~~**Config authorship**~~ — resolved: the app identity, revisit once code exists (decision 43).
6. **Same-batch hard dependencies** — adopt?
7. **Edge activation rule** as the safety net — confirm.
8. **Grants after migration** — valid until revoked by the new owner?
9. **Open-batch guarantee** — must an open batch always seal; what if an app discards pending events?
10. **Merge policy and patch format** for proposals.
11. **Legal erasure and moderation** position before public launch. The mechanism is decided (`02` §7).
12. **Escape hatch** for apps needing code — if and when.
13. **Stable-address assignment** — on request, automatic, or pre-allocated by the IDM before batching.
14. **Economics** — fees, balances, sales mechanics, account price or throttle.
15. ~~**Implementation stack**~~ — resolved: TypeScript (decision 73).
16. ~~**Company read access**~~ — resolved: no private events or restricted spaces at the start (decision 92).
17. **Query and sort expression language** for views — deterministic, terminating, sandboxed (`05` §4).
18. **Grant scope vs app changes** — does a manifest change need new consent (`03` §8)?
19. **Chain** — dedicated L1 or rollup (`06` §10).
20. **Metadata leakage of encrypted events** (`02` §8).
21. **Indexer completeness** — how an app trusts that an indexer missed nothing (`06` §9).
22. ~~**First moderators**~~ — resolved (decision 121).
23. ~~**Inbox read state**~~ — resolved: `seen` events (decisions 122–123).
24. ~~**Merging deployments**~~ — resolved: never; types and apps move as bundles (decision 120).
25. **The expression / derived-value language** — Datalog-like core with aggregates? Scope for the first version after P5 (`04` §10).
26. ~~**Derived values over private events**~~ — resolved: public aggregates over public events only (decision 135).
27. **Post-quantum algorithm set** for launch — choose with a cryptographer; follow Ethereum's direction (`02` §9).
28. **Collection contribution policy** — who may add to a collection (`10` §8).

## 4. Parking lot (explicitly not now)

Name ownership / DNS replacement · account and name sales · scoped and expiring grants, delegation chains · multiple scoped keys per user · bit-level envelope compaction · batch header bloom filters and proofs of absence · IDM state trees and attestations · pipelines, scripting, node editor, precompiles, indexes · engine expressed in-system · Kafka or another log backbone · interfaces / multiple inheritance · key recovery · zero-knowledge events · Signal/MLS integration · account price or throttle · encrypted payloads and group keys · replay checkpoints · type mappings · infra-company billing.
