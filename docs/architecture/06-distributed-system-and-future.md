# 06 — The Distributed System and Future Layers

Nothing here is built in the demo. It records where the system is going, so demo decisions don't close those doors.

## 1. Breaking the host-centric model

- In the launched system **only the blockchain is centralized**. Off-chain data is addressed by four integers, not by IP address or host name, and can be served from **anywhere** — the app, the user's IDM, archives (Internet-Archive-like), search engines, indexers — **as long as a merkle proof comes with it**.
- For any `app/batch/user/seq` there are at least two natural sources: the **app** and the **user's IDM** (found on-chain via the owns / delegated-to relation — including an IDM delegated for a sovereign user it doesn't own).
- **DNS-like layer:** apps and IDMs publish a **network address on-chain** (`publish_endpoint` tx) through which they can be contacted. Later, **name ownership** on top — the system is meant to eventually replace DNS.

## 2. Real batching on-chain

- `publish_batch` carries the **merkle root (mandatory)** plus, **optionally**, an **IPFS hash of a batch header** from which the full blob, or parts of it, can be fetched. Leaving the header out is how a batch stays private (§7).
- **[P]** The batch is a hierarchy of IPFS blobs with headers, fetchable selectively. Very large files are referenced by hash plus a locator (`01` §3, `02` §7).
- Apps pick their own intervals. Only the largest apps publish every block or every few blocks; most publish once a minute or less often. Merkle trees are built incrementally as events arrive; inclusion proofs are available for any address.
- **[P]** The header contains a sorted list or bloom filter of **authors** in the batch and of **authors of referenced events**; with leaves sorted by `(user, seq)` the tree supports **proofs of absence**, making a header's "nothing for user U here" verifiable.
- Demo data imports by building batches and trees retroactively.

## 3. IDM responsibilities (best effort)

- **Store and serve.** Whenever an app publishes an event of one of its users, the IDM fetches it **plus its merkle proof** and stores it, so it can serve it too. If "facebook" disappears forever, its users' events survive at their IDMs (and elsewhere). Users can also cache their own events locally.
- **Notifications.** Apps notify IDMs when events for their users are generated.
- **Monitoring.** IDMs also watch the chain: they scan **batch headers of all apps** (not small work, but far less than every event), open the ones that mention their users, and drill down only when needed. This also catches **signature-only events** through apps with no grant, which IDMs couldn't otherwise anticipate.
- **Routing rule for edits:** whoever must be told about an edit is derivable from the event — an edit superseding `x/y/z/a` concerns user `z`, so the emitting app notifies `z`'s IDM. The IDM also knows which apps hold its users' grants and can pull from them as a backstop. Clients can submit signed events directly to the IDM.
- **Data availability is a market property (decided).** Nothing forces anyone to hold data, and no pinning, replication mandate or economic layer is planned. A service that doesn't hold data it should is a bad service and loses customers. The web works this way today, mostly. Redundancy comes from many parties holding the same data: the app, the IDM, archives and users' local caches.

## 4. Latest-version queries

- Anyone can ask a user's IDM: *"is `x/y/z/a` still the latest version, or is there a newer one?"* — and get either the latest version or the whole history.
- **Why the IDM, not the originating app:** an edit may come from a different app; forcing an app to watch trillions of events from millions of apps for edits to its own events doesn't scale, and push notifications to the app can be missed while it's down. With single-author chains (`04` §3), every valid version is by the same identity, so its IDM is the natural aggregator.
- **State tree.** The IDM maintains a cryptographic tree of all its users' events and their version histories, and publishes updates as IDM events (with proofs) / regular root commitments.
- **"Latest" is attested, not proven.** A merkle proof shows an event exists, not that nothing newer exists. The IDM answers with a signed, timestamped statement; regular root publication bounds staleness. An IDM could still withhold an edit, so the slow path (scan the log) remains, and archives/indexers can answer the same query — the IDM is the default source, not the only one.
- **Request volume.** Comparable to loading a web page today. Mitigations, following HTTP revalidation: most content is never edited; most edits happen in the same app (which already knows); cache with TTLs; **batch lookups per IDM**; IDMs publish per-block **digests of updated events** so clients can skip queries; apps subscribe to pushes.

## 5. Stable addresses — `0/0/user/seq`

- An optional second address form: **app = 0** means "this is a permanent name; ask the user's IDM". Resolution: read the 3rd integer (user) → look up the user's IDM on-chain → contact it at its on-chain endpoint → get the latest version (or history).
- `seq` here is a **per-user counter kept by the IDM** for that user's off-chain state tree, unrelated to app batches.
- **Only the IDM can issue them**, since it maintains the user's state and counter; it **emits the mapping as events** so it's verifiable. It keeps at least the addresses of all older versions, so *any* version address resolves to the latest too.
- **Why it's worth having:** short, readable, stable names (even e.g. "a unique address for every word"), and one canonical key per lineage — otherwise references fragment between original and latest URIs, both in `ref` fields and inside text such as comments.
- **Naming:** *stable address* vs *version address*.
- **Variant [Later]:** apps ask the IDM for the next stable address *before* adding the event to their batch.
- **Alternative needing nothing new:** treat the root event's version address as the stable name and let the IDM resolve "latest of the chain containing this address".
- **Not needed soon.** The reserved `app = 0` keeps the door open.

## 6. Later layers

- **Ontology first** (Palantir Foundry inspiration): define types and links, then build pipelines and apps on them.
- **Pipelines / scripting nodes** with **typed inputs and outputs**, and an app that is a **node-based editor**.
- **Precompiles:** algorithms that become popular and heavy migrate from the in-system scripting language to fast native implementations inside the system, with the option to build **indexes**. Typed node interfaces make swapping a script for a precompile transparent; deterministic arithmetic (`02` §5) matters here.
- **The engine in-system** with a native kernel and rendering precompiles (`05` §5).
- **Escape hatch for apps** that need real code (hosted code referenced by config).

## 7. Privacy and read access

Everything else in these docs assumes public events. Private data is supported in three combinable ways:

1. **Not served on the public internet at all.** On-chain an app posts only the **merkle root** (mandatory). The IPFS header hash is optional, so the batch contents can be fetchable only inside a company intranet, or only for authorized requesters. The chain still orders the batch and commits to it.
2. **Encrypted payloads** in off-chain events (`02` §8), with keys distributed through **grants and keys**. **[P]** Use read grants, or a group-key event type (a content key encrypted to each member) that is rotated when membership changes.
3. **Access control by the serving party:** the app or IDM decides whom it serves. This is the demo's form (`07` §3).

- **[O]** Projections over private payloads can be rebuilt only by key holders. Shared, auditable scores (`04` §7) should be computed over public data or plaintext envelope fields.
- **What the demo must do now:** nothing cryptographic. The core already treats payloads as opaque. Route reads through one seam, `can_read`, and keep non-public events off the CDN (`07` §3). Everything else can wait.

## 8. Spam and Sybil resistance

- **Off-chain spam** (junk types, junk events, fake accounts' events) is **left to social incentives** on top of the system, not to the protocol. Infrastructure services may **flag identities** (apps or users) as spammers and stop indexing and storing their content. Nobody is forced to store anyone's junk: social consensus decides.
- **[P]** This also bounds header monitoring (§3): IDMs and indexers can skip batches of apps flagged as spam.
- **[Later] On-chain account creation:** when the final system launches, new accounts cost a price, or creation is throttled. Not worth designing now, but needed before launch (§13).

## 9. Indexing, hosting and infrastructure companies

- Most events are **typed**, so most queries are structured (by type, reference, author) and full-text search matters less. Full-text search is still an indexer service.
- **Who runs the infrastructure:** apps either run their own, reachable through a network address posted on-chain with `publish_endpoint` (§1), or use **infrastructure / cloud companies that host many apps**, so app developers don't have to run servers. Infra companies **charge apps** by query volume or by their users' usage.
- **Global queries** such as "everything referencing X across all apps" are answered by these indexers. Returned data is proof-verified (§1). **[O]** Completeness ("nothing is missing") can't be proven, which is the same limit as "latest" (§4), so apps choose indexers by reputation or cross-check several.
- Infra companies also publish **replay checkpoints** (`04` §9).

## 10. Chain choice and capacity

- **[O]** A dedicated L1 or a rollup: not settled yet.
- **Load is small by design.** End users practically never touch the chain. When they do (binding a key, migrating to another IDM), the IDM usually acts on their behalf, and **IDMs batch their users' operations** into compact transactions. Only the largest apps publish a batch every block. 100 KB blocks every 10 seconds fit a surprising amount of activity, and blocks can be made faster and bigger.
- **[P]** Identity txs (`create_identity`, `bind_key`, `transfer_ownership`) should therefore accept many items per tx.

## 11. Hourglass architecture

Like IP in the internet: the narrow waist is **the event envelope + the address scheme + the type meta-model**. Below: storage, chain, merkle trees, IPFS, transport. Above: types, apps, views, pipelines, scripting. Neither side needs to know about the other — which is the strongest argument for getting the envelope right early (version field, canonical serialization, minimal fields).

## 12. Governance

Rule versioning by block number (hard-fork-style social consensus), creator sunset, forkable meta-type, envelope evolved by an ecosystem standards body (`03` §6, §9).

## 13. Economics **[Later]**

Fees for on-chain transactions; the balance a user needs to escape a rogue IDM by transacting directly; account and name sales; a price or throttle for creating accounts (§8); infra companies charging apps for usage (§9). No economic incentive for data availability (§3). Ignored for now.

## 14. Related systems (from memory — verify against current specs)

| System | What's similar | What's different |
|---|---|---|
| **AT Protocol (Bluesky)** | Closest on identity & hosting: accounts on a host (PDS ≈ IDM), key rotation, account migration, schema-typed records (Lexicon) | No position addresses, no in-system type creation |
| **Nostr** | Events as the only primitive, kinds and tags (≈ refs), signatures | No in-system types, no such addressing, weak delegation |
| **Urbit** | Numeric identities with scarcity, sold, anchored on Ethereum, sponsorship hierarchy | Different computing model |
| **Ethereum Attestation Service, ENS** | On-chain schemas, attestations referencing each other; naming | Mostly on-chain data |
| **ActivityPub, RDF/OWL, Solid** | Typed, extensible objects, inheritance, personal data stores | Host-addressed |
| **Event sourcing / CQRS** | Log + projections | Usually single-organization |
| **Palantir Foundry, Airtable, Retool** | Ontology, config-driven apps and pipelines | Centralized products |

**Is this reimplementing the web?** Partly. HTTP + HTML give *location-addressed documents with presentation baked in*. This is *identity- and position-addressed, signed, typed events*, with state derived from them and UIs as config — closer to a semantic web with ownership and verifiability than to a rebuild of HTTP/HTML.
