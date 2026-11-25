# 02 — Event Envelope and Encoding

The envelope is the **waist of the hourglass**. Storage, chain, merkle trees and transport sit below it; types, apps, views and scripting sit above it. Types evolve *inside* the system; the envelope can't, so it is evolved by the ecosystem as a whole (a standards process), and it should be right from the start.

## 1. Fields

| Field | Presence | Notes |
|---|---|---|
| `version` | always | First field of the serialization; decides the layout of everything after it |
| `flags` | always | **[P]** A varint (LEB128), one bit per optional or modal feature. Assigned so far: `ref`, `auth`, `signature`, payload encrypted. See §1.1 |
| `app, batch, user, seq` | always | The address — fixed by position in the batch |
| `type_ref` | always | Address of the type event |
| `ref` | optional | Single reference |
| `auth` | optional | Address of a grant |
| `signature` | optional | User's signature |
| `created_at` | always | Claimed time |
| `payload` | always | Opaque to the core; interpreted by type |

### 1.1 The flags field **[P]**

- **A varint, not a fixed 32 or 64 bits.** Each byte carries 7 flag bits, and its high bit says "another byte follows". One byte covers the first 7 flags, and the field grows by itself when more are needed. This is the "last bit means more flags follow" idea, built into a standard encoding, with no cap at 64 or 128 and no second field in the payload.
- **Four bits are assigned:** `ref`, `auth`, `signature`, payload encrypted. The other three bits of the first byte stay free.
- **How the flags are written depends on the canonical encoding** (§4), which covers the whole event, envelope and payload, not only the payload. With a custom layout they are a LEB128 varint. In CBOR they are an ordinary unsigned integer (CBOR integers are already 1–9 bytes), with a byte-string bitmap if more than 64 are ever needed.
- **In the demo the flags don't exist physically:** they are implied by nullable columns and by `visibility`. They become real bytes in the canonical encoding (§4, decided in P8).

**Why `auth`, `signature`, `ref` and `type_ref` live in the envelope, not in type schemas:** validity is a core rule that must apply to every event regardless of type. If auth lived in each type's schema, a type author could leave it out and every event of that type would be forgeable; and the projection would have to understand every type just to decide whether an event counts. Same reasoning for references: the core must index "everything referencing X" (deletes, replies, likes) without understanding payloads.

## 2. Versioning

- A version integer from day one. Envelope changes alter how bytes parse, so a block-height rule alone can't express them; apps that are slow to upgrade would otherwise produce ambiguous bytes.
- The rule set states which envelope versions are accepted in which block ranges — that handles the transition window.
- An unknown version is **stored but not interpreted**.
- Demo: a `version` column, default 1. (It could be added retroactively before anything is hashed, but it is cheaper and cleaner now.)

## 3. Auth vs signature

| `auth` | `signature` | Meaning |
|---|---|---|
| set | null | Posted by an app on the strength of a grant (normal web2-like path) |
| null | set | User explicitly signed the event with their bound key (sovereign users, any app, no grant needed) |
| set | set | **[P]** Grant to a *key* (scoped keys modelled as grants to a keypair): signature must verify against the granted key |
| null | null | Valid only when `user == app` (the app speaking for itself — see `03`) |

- The flags field means an absent field costs one bit. **[Later]** a tighter layout can share one slot between the two with a 1-bit discriminator — not maniacal, it is standard practice, but not a demo concern.
- **Signatures cover the event's own address** plus content. Addresses are predictable, so this is possible, and it prevents an app from replaying a signed event in another app or batch.
- **In the auth path the address need not be inside the signed bytes**: the address is fixed by the event's position in the app's (signed, merkle-rooted) batch; swapping it would break the batch.
- **Multiple keys per user** (keys for different scopes): a new envelope version can add a key id, or — no format change — model scoped keys as grants to a keypair (row 3 above).

### Inline auth vs reference

- **Canonical stored form: a reference** to the grant's address.
- The attraction of inlining (a self-contained blob) doesn't fully hold: the grant lives in the IDM's batch and the event in the app's batch — two different merkle trees, so two proofs are needed anyway; and every event would carry a copy of the grant. More importantly, a bundle proves the grant *existed*, not that it was *unrevoked at the event's position* — that needs the log.
- **Wire/export format may inline**: a portable **proof bundle** = event + its proof + grant(s) + their proofs, assembled by whoever serves the data. If grant delegation chains arrive later, bundles simply get longer; the envelope stays the same.

## 4. Canonical serialization

Signatures and hashes are over bytes, so the encoding must be deterministic.

- **Why not protobuf:** the same logical message can serialize to different bytes — field order isn't mandated, varints can be non-minimal, defaults may or may not be written, map order is undefined, unknown fields are kept by some libraries and dropped by others. Two parties re-serializing the same message can get different hashes.
- **[P] One encoding for the whole event: DAG-CBOR**, the deterministic CBOR subset used by IPFS (IPLD): sorted map keys, no indefinite lengths, restricted floats, one tag for links. One determinism rule for envelope and payload, mature TypeScript libraries, and it fits multihash and IPFS (§9, `06` §2). CBOR is compact for small integers, which most address parts are.
- **Considered, not chosen:**
  - **SSZ** (Ethereum's consensus layer). Its per-field merkleization shines for huge structures, but our envelope is about 100 bytes and ~10 fields: proving one field (~4 hashes, ~128 bytes) costs more than revealing the whole envelope. The useful split (envelope vs payload, for erasure and ghosts) is already given by the two-level leaf (§7). It also needs a fixed schema, so payloads would need a second encoding, i.e. two determinism specs for every implementer. Fixed-width integers make it larger, and merkleizing 32-byte chunks takes roughly 5–10× more hash calls per envelope than hashing the bytes once. Revisit only if per-field proofs (e.g. selective disclosure of envelope fields) find a real use.
  - **A custom fixed layout** (version, flags, varints, length-prefixed payload): possible, but a standard is less work.
  - **RLP** (Ethereum's execution layer): **rejected.** It is deterministic, but untyped (only byte strings and lists) and has no merkleization of fields, and Ethereum itself has been planning to move away from it towards SSZ.
- **[O] Which one** is decided in P8, when hashing and signing start (`08`), not in P0. **[P]** Lean: DAG-CBOR for everything. For JSON payloads, RFC 8785 (JCS) canonicalization.
- Hash and verify the **exact bytes received**; never re-serialize to check.
- **The demos use plain JSON** (JSONB in Postgres, JSON over the wire) and no CBOR. Nothing in them is hashed or signed, so there is nothing to canonicalize yet. The import into the real system serializes canonically.
- **[P] JSON rules that keep that later conversion lossless:**
  - 64-bit integers and addresses as strings (`"7/42/5/1"`), never as JSON numbers, which lose precision above 2^53 in JS
  - decimals as strings
  - strings in NFC
  - no floats in fields that rules depend on
  - JSONB already normalizes key order and drops duplicate keys

## 5. Primitive types and strict encoding

Primitives are **genesis type events** of a primitive kind, with native validators in the kernel, so that everything down to the building blocks is typed and schemas refer to primitives by address:

`integer`, `string`, `bytes`, `boolean`, `timestamp`, `address` (4-integer reference), `list`, `record`, `decimal`, `float64`.

New scalars extend primitives (`email` extends `string`).

Encoding rules:

- integers: minimal varints
- strings: UTF-8, one normalization form (**NFC**)
- decimals: for money and anything exact
- **float64 is allowed as a stored type**: raw 8 bytes, one canonical NaN, negative zero normalized (or rejected), infinities rejected (or explicitly allowed by rule). Storage is then deterministic.
- **Computing with floats** is the problem, not storing them: `+ − × ÷ √` are correctly rounded in IEEE 754 and reproducible, but transcendental functions (sin, exp, log) and fused multiply-add vary by platform, and float sums depend on summation order. Anything consensus-relevant, auditable, or a precompile uses exact ops, integers, fixed-point or decimals, with a defined evaluation order.

## 6. Example (demo JSON form)

```json
{
  "version": 1,
  "address": "7/42/5/1",
  "type_ref": "1000001/12/1000001/1",
  "ref": "7/40/9/1",
  "auth": "1000002/57/1000002/1",
  "signature": null,
  "created_at": "2026-11-25T11:47:00.123Z",
  "payload": { "text": "Agreed — ship it." }
}
```

(Identity numbers are placeholders: `1000001` = creator, `1000002` = IDM, assuming a 1M reserved range.)

## 7. Payload commitment, erasure and large media

- **Leaves and signatures commit to the envelope plus `hash(payload)`**, not to the payload bytes directly. **[P]** Use two levels: `leaf = H( H(envelope) ‖ H(payload) )`. An event can then be published in full; with the envelope only (**erased**: the payload is dropped, `H(payload)` kept); or with nothing but its leaf hash (a **ghost**: the address exists, nothing else about the event is known, `07` §12). A host can then drop a payload (illegal content, personal data, a legal erasure request) and keep only its hash. The merkle inclusion proof and any signature still verify, and the event reads as "content erased" instead of becoming unprovable.
- **Large media works the same way:** the payload carries a hash commitment to the blob plus a way to fetch it (e.g. an IPFS hash). The blob itself sits outside the event (`01` §3).
- **When to decide the exact leaf format:** together with the canonical serialization, before the first event is hashed or signed. That is when real merkelization starts (`08` P8), not P0. The demo hashes and signs nothing, and its import builds trees retroactively, so the import can use this format. The only constraint on the demo today: keep the payload a separable value (it already is its own column), never mixed into envelope fields.

## 8. Encrypted payloads **[P]**

- Private events may carry an **encrypted payload** (`06` §7). It is marked by the "payload encrypted" flag (§1.1).
- **A private event is one event, not two.** Its key is derived from the author's master key and the event's address (`06` §7), so nothing extra is published at creation. When it is shared, the content key wrapped for each recipient travels inside the same event's payload. Only a later **reveal** is a second event.
- Which events are encrypted follows the per-event visibility model (`06` §7). In the demos the same information is a plain `visibility` column enforced by the server.
- **The demo hack doesn't change the envelope later.** **[P]** Reserve the flag bit for "payload encrypted" in the spec now, so it exists from day one. Demo events keep plaintext payloads plus the `visibility` column. The import into the real system already builds batches and merkle trees retroactively, so it encrypts private events first (with the users' keys), sets the flag, and then hashes the ciphertext. Recipients for sharing travel inside the payload or in key events, not in the envelope.
- `type_ref`, `ref` and `auth` stay plaintext, because validity and the core indexes depend on them. **[O]** This leaks metadata (which type, who references what). Apps that can't accept that keep whole batches off the public internet instead (`06` §7).
- Only key holders can schema-check or interpret an encrypted payload. To everyone else it is opaque bytes, which the core already tolerates (§1: the payload is opaque to the core).

## 9. Choosing the cryptography: agility now, hardening before launch **[P]**

The plan: build with standard, well-vetted crypto, and **swap in hardened, post-quantum algorithms before the public system launches**, after review by expert cryptographers. That is sound, provided the formats make the swap cheap:

- **Self-describing hashes, keys and signatures (decided).** Use IPFS's **multihash** for hashes, and the **multicodec** prefixes for keys and signatures. Some post-quantum algorithms may not have codes in the multicodec table yet and may need registering. A multihash is `varint(algorithm code) ‖ varint(digest length) ‖ digest`. For example, SHA-256 has code `0x12` and a 32-byte digest, so the multihash is `12 20 <32 bytes>`, two bytes of overhead. A future algorithm simply has another code. The batch headers already live on IPFS, whose content ids (CIDs) are built from multihashes, so this keeps the system IPFS-compatible for free. The active rule set (`03` §6) states which codes are accepted from which block, so an algorithm change never changes a format.
- **Nothing in the demos is hashed or signed** (`02` §4), so the choice isn't needed before P8. The export/import test can use provisional choices: SHA-256 for hashes, Ed25519 for signatures.

**What is actually at risk from quantum computers** (verify against current literature with an expert):

- **Hash functions are not the main problem.** Grover's algorithm only halves the effective security, so a 256-bit hash (SHA-256, SHA3-256, BLAKE3) keeps about 128-bit security, which is still considered safe. Longer outputs buy extra margin.
- **Signatures and key exchange based on elliptic curves or RSA are broken by Shor's algorithm:** ECDSA, Ed25519, X25519. This is Ethereum's worry, and the reason for its research into hash-based signatures, whose security rests only on the hash function.
- **NIST's post-quantum standards (2024):** ML-KEM (FIPS 203) for key exchange; ML-DSA (FIPS 204, lattice-based) and SLH-DSA (FIPS 205, hash-based, SPHINCS+) for signatures. Hash-based schemes have the most conservative assumptions but large signatures (kilobytes).

**Why this design is unusually PQ-friendly:** most events carry no signature at all. They are authorized by grants and committed by merkle trees, so a signature is needed about **once per batch** (the `publish_batch` tx) and on rare sovereign events, not once per event. Kilobyte-sized post-quantum signatures are affordable at that rate.

**Unknown future breaks, AI included.** Nobody can rule out new mathematics, AI-assisted or not, that weakens some primitives. Elliptic curves (ECDSA, Ed25519) are already doomed by quantum computers anyway. Defences:

- **Agility:** the algorithm codes above.
- **[P] Hybrid signatures and key exchange during the transition:** a classical and a post-quantum algorithm together, both required to verify. This is the pattern used by Signal's PQXDH and by browsers' X25519 + ML-KEM.
- **A preference for hash-based signatures** where their size is affordable, because they assume the least.
- **Well-vetted libraries only;** implementation bugs are still the most likely failure.

All of it is cheap here, because signatures are rare.

**Why Ethereum doesn't self-describe its values:** its consensus spec types every field ("a 96-byte BLS signature"); it changes algorithms at the container level, through hard forks and typed transactions (EIP-2718); on-chain bytes cost gas; and SSZ's fixed-size fields leave no room for prefixes. Here events live off-chain forever, are served by anyone out of context and read by independent implementations, and old algorithms must stay verifiable for decades. So 2 bytes of self-description per value pay for themselves.
