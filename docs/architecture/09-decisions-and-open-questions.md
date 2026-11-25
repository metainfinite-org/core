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
| 19 | Envelope | Version integer from the start; flags byte | D | 02 §1–2 |
| 20 | Envelope | Signature covers the address; auth path doesn't need it | D | 02 §3 |
| 21 | Envelope | Stored auth is a reference; bundles inline grants for export | D | 02 §3 |
| 22 | Encoding | Deterministic canonical form; not protobuf | D | 02 §4 |
| 23 | Encoding | CBOR-deterministic vs custom layout | O | 02 §4 |
| 24 | Types | Primitives are genesis type events; NFC strings; minimal varints | D | 02 §5 |
| 25 | Types | float64 storable with canonical encoding; exact ops only in consensus paths | D | 02 §5 |
| 26 | Types | Versioning by supersession; no version field; forks allowed | D | 05 §3 |
| 27 | Types | `extends` separate from `supersedes`; rendering fallback; display template | D | 05 §3 |
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
| 43 | Apps | Demo config authored by the app identity via App Maker | P | 03 §8 |
| 44 | Governance | Creator sunsets; canonical meta-type named by the rule set; envelope by ecosystem | D | 03 §9 |
| 45 | State | State = replay; authorization in the projection | D | 04 §1 |
| 46 | Edits | Single-author version chains; anyone can fork | D | 04 §3 |
| 47 | Edits | Shared editing via proposals auto-merged by the owner, with provenance | D | 04 §4 |
| 48 | Edits | Merge policy, patch format | P / O | 04 §4 |
| 49 | Delete | Delete events; meaning is emergent and decided by interpreters | D | 04 §5 |
| 50 | Delete | Optional deletion hint | P | 04 §5 |
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

## 3. Open questions

Phase-0 blockers first.

1. **Reserved id range** size; genesis creator and IDM ids.
2. **Canonical encoding**: CBOR-deterministic or custom layout.
3. **Schema language** for type payloads.
4. **Meta-type field list** for genesis.
5. **Config authorship** in the demo (app identity vs creating user).
6. **Same-batch hard dependencies** — adopt?
7. **Edge activation rule** as the safety net — confirm.
8. **Grants after migration** — valid until revoked by the new owner?
9. **Open-batch guarantee** — must an open batch always seal; what if an app discards pending events?
10. **Merge policy and patch format** for proposals.
11. **Legal erasure and moderation** position before public launch.
12. **Escape hatch** for apps needing code — if and when.
13. **Stable-address assignment** — on request, automatic, or pre-allocated by the IDM before batching.
14. **Economics** — fees, balances, sales mechanics.

## 4. Parking lot (explicitly not now)

Name ownership / DNS replacement · account and name sales · scoped and expiring grants, delegation chains · multiple scoped keys per user · bit-level envelope compaction · batch header bloom filters and proofs of absence · IDM state trees and attestations · pipelines, scripting, node editor, precompiles, indexes · engine expressed in-system · Kafka or another log backbone · interfaces / multiple inheritance.
