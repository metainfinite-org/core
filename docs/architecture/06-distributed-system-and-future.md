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
- **Merkle cost is modest.** A batch of 1M events gives a binary tree of depth 20 (2^20 ≈ 1.05M) with about 2M nodes. At 32-byte hashes that is about 64 MB (≈ 61 MiB) if every node is kept. The hashing parallelizes well, and SHA-256 with hardware support does millions of small hashes per second per core. Inclusion proofs are 20 hashes, about 640 bytes. **[P]** Hosts may keep only the leaf hashes (32 MB) or the upper levels and recompute the rest. Only the root goes on-chain, so even very high-volume event types (direct messages, `viewed`, `seen`) are fine off-chain.
- **[P] Proofs are optional for clients.** By default a device fetches events without proofs to save bandwidth. A setting makes it require proofs for everything it views, or **spot-check** a random sample, which catches a dishonest server with high probability at a fraction of the cost. Serving proofs on demand favours keeping the whole tree stored: for typical events the tree is small next to the data. For tiny events such as likes it can be about the same size as the data, and keeping only the upper levels plus the leaf hashes is the middle ground.

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
- **[P] Two tiers of in-system logic:**
  - **Expressions and derived values:** a small non-Turing-complete language (Datalog- or CEL-like, `04` §10). It always terminates and is cheap to analyse.
  - **Script nodes, for anything more:** **WebAssembly** in a deterministic profile: no threads, canonical NaNs, no relaxed SIMD, and metered execution ("fuel" or gas) so every run is bounded. Wasm is portable, sandboxed and can be compiled from many languages, and a script node's code is stored as an event (bytes plus a multihash). Serialization formats such as SSZ or CBOR describe *data*; Wasm is the *code*.
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

### Visibility model (decided)

**Visibility is a property of every event**, not of a type or a kind of data. Any event anyone generates can be public or private, and later shared with a given set of identities.

- **Levels:** **public**, **private** (the author only), and **[Later] shared with a set of identities**, which is more complicated and deferred. Direct messages will be its first real use.
- **Defaults, from most to least specific:** the visibility chosen for this event → the user's own default for this type → the app's default for that type (e.g. an app recording `viewed` events defaults to private) → public. Types themselves carry no visibility default (`05` §2). The user's defaults are **settings events**, and those can themselves be public or private.
- **Resolved at creation and stamped on the event.** Changing a default later never changes old events. That matches the final system, where encryption happens when the event is created.
- **Changing it afterwards:** private → public is always possible. Public → private is only best effort, like a delete: copies may exist (`04` §5). The hope is that infrastructure companies eventually follow strict laws in friendly jurisdictions.
- **No "personal" category.** Nothing is inherently private: read marks, viewing history or browsing history can be public if their author wants. **[P]** Apps or the shell may emit `viewed` events for what the user looked at, private by default, so a user can publish their history the way nobody can publish their YouTube or Chrome history today.
- **Derived values over private events (decided):** public aggregates count only public events, so a public like count never leaks private likes. An app still shows *you* your own private like by asking your IDM whether you have one for that event. **[Later]** zero-knowledge events.
### Encryption keys for private events **[P]**

One master key per user, and a **separate derived key per event**: `event_key = KDF(master_key, event_address)`, e.g. HKDF. The master key is either bound to the account or issued by the IDM.

- **Nothing extra to store:** each event key is recomputed from the master key and the address.
- **Making one event public = publishing its event key.** The key derivation is one-way, so that key unlocks only that event. The event keeps its address, references to it keep working, and anyone can check that the decrypted content matches the committed `hash(payload)` (`02` §7).
- **The event's bytes stay the ciphertext forever.** A reveal is a separate event carrying the key and referencing the private event. A CDN that cached the ciphertext needs no purge: clients fetch the reveal and decrypt locally. Hosts may also serve a decrypted convenience copy, which anyone can check against the ciphertext and the key.
- **Making it private again** = deleting the reveal event. Hosts drop their copies of the reveal and serve the event as private again. It is best effort, like any public → private change: whoever saved the key keeps it.
- **Re-publishing the plaintext** as an update-like event is also acceptable. It is just weaker: nobody can verify that it matches the original unless the original also committed to a salted hash of the plaintext.
- **Sharing with a set of identities:** encrypt the event's content key to each recipient's key (standard envelope encryption, as in PGP or age). The wrapped keys travel in the payload or in separate key events, so the envelope doesn't change. Groups use a group key, rotated when membership changes.
- **Master key rotation:** new events use the new key, and old events keep theirs.

### Direct messages, Signal and MLS

There can be several ways, side by side:

- **In-system DMs:** events shared with the recipients, using the keys above. History syncs through IDMs like any other event, and messages can be referenced or revealed later. No forward secrecy: whoever steals your master key can read your old messages.
- **The Signal protocol** works as a *transport*, with each ratchet message carried as an opaque event payload, but its guarantees pull the other way: per-message keys are deleted (forward secrecy), so history can't be re-fetched from the IDM, nothing can be revealed later, and the message content is invisible to references, aggregates and re-hosting. Fine for "maximum privacy" chats, as one option.
- **MLS (Messaging Layer Security, RFC 9420)** is worth studying: group key agreement with forward secrecy, organized in **epochs**, where every membership change is a "commit" message that must be delivered in one agreed order. **The log is exactly the ordered delivery service MLS assumes**, which makes it the most natural fit for private groups.
- **External channels** (Signal itself, email) stay possible alongside.

- **The demos:** no cryptography. **[P]** A `visibility` column on events, enforced by the server through `can_read` (`07` §3); later it maps onto the encryption flag (`02` §8). Not in the first demo target; it comes with the growing-expressiveness stage (`08`).
- **Changing visibility in the demos also needs no extra events at creation:** `visibility` is set when the event is created. Later changes are events, as in the final system: a **reveal** (private → public) and a **hide** (public → private, like a delete).

## 8. Spam and Sybil resistance

- **Off-chain spam** (junk types, junk events, fake accounts' events) is **left to social incentives** on top of the system, not to the protocol. Infrastructure services may **flag identities** (apps or users) as spammers and stop indexing and storing their content. Nobody is forced to store anyone's junk: social consensus decides.
- **[P]** This also bounds header monitoring (§3): IDMs and indexers can skip batches of apps flagged as spam.
- **[Later] On-chain account creation:** when the final system launches, new accounts cost a price, or creation is throttled. Not worth designing now, but needed before launch (§13).

## 9. Indexing, hosting and infrastructure companies

- Most events are **typed**, so most queries are structured (by type, reference, author) and full-text search matters less. Full-text search is still an indexer service.
- **Who runs the infrastructure:** apps either run their own, reachable through a network address posted on-chain with `publish_endpoint` (§1), or use **infrastructure / cloud companies that host many apps**, so app developers don't have to run servers. Infra companies **charge apps** by query volume or by their users' usage.
- **Global queries** such as "everything referencing X across all apps" are answered by these indexers. Returned data is proof-verified (§1). **[O]** Completeness ("nothing is missing") can't be proven, which is the same limit as "latest" (§4), so apps choose indexers by reputation or cross-check several.
- Infra companies also publish **replay checkpoints** (`04` §9).

### Apps outlive their operators

An app is declarative: its config is events in the log. Its server-side state (projections, derived values, indexes) is a deterministic function of the log plus that config. So **any host can run an abandoned app again**: fetch the config and the events (from IDMs, archives, any host), replay or start from a checkpoint (`04` §9), and serve the same views and computed state. Even if nobody answers at app A's on-chain endpoint any more.

- **Reading and computing: anyone, without permission.** A re-host serves A's events and computes A's state exactly as A did.
- **Writing as A: only with A's authority.** New events in A's batches need A's owner (or keys). If A's owner still exists, it can hand A over with `transfer_ownership`, an official revival. If not, the re-host runs A's config under a **new app identity**: a fork that supersedes A's manifest (`05` §4). Old content keeps A's addresses, new content gets the fork's.
- **[P] Hosting announcements:** anyone can publish an event referencing A's manifest that says "app A is mirrored, or forked as B, at endpoint E". It is a claim, not authority: A's own on-chain endpoint stays authoritative, and clients choose which announcements to trust (reputation, `10`).
- **What is lost:** only what was never in the log, i.e. A's private operational data, secrets and keys. Apps that used the code escape hatch (`05` §4) are not portable this way, which is one more reason to keep apps declarative.

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
