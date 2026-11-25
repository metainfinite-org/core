# 02 — Event Envelope and Encoding

The envelope is the **waist of the hourglass**. Storage, chain, merkle trees and transport sit below it; types, apps, views and scripting sit above it. Types evolve *inside* the system; the envelope can't, so it is evolved by the ecosystem as a whole (a standards process), and it should be right from the start.

## 1. Fields

| Field | Presence | Notes |
|---|---|---|
| `version` | always | First field of the serialization; decides the layout of everything after it |
| `flags` | always | One byte; one bit per optional field (auth, signature, ref, …) |
| `app, batch, user, seq` | always | The address — fixed by position in the batch |
| `type_ref` | always | Address of the type event |
| `ref` | optional | Single reference |
| `auth` | optional | Address of a grant |
| `signature` | optional | User's signature |
| `created_at` | always | Claimed time |
| `payload` | always | Opaque to the core; interpreted by type |

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

- The flags byte means an absent field costs one bit. **[Later]** a tighter layout can share one slot between the two with a 1-bit discriminator — not maniacal, it is standard practice, but not a demo concern.
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
- **Candidates:** CBOR in deterministic mode (RFC 8949) or a custom fixed layout (version, flags, varints, length-prefixed payload). **[O]** Which one is decided in P8, when hashing and signing start (`08`), not in P0. **[P]** Lean towards deterministic CBOR: a standard with existing libraries. For JSON payloads, RFC 8785 (JCS) canonicalization.
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

- **Leaves and signatures commit to the envelope plus `hash(payload)`**, not to the payload bytes directly. A host can then drop a payload (illegal content, personal data, a legal erasure request) and keep only its hash. The merkle inclusion proof and any signature still verify, and the event reads as "content erased" instead of becoming unprovable.
- **Large media works the same way:** the payload carries a hash commitment to the blob plus a way to fetch it (e.g. an IPFS hash). The blob itself sits outside the event (`01` §3).
- **When to decide the exact leaf format:** together with the canonical serialization, before the first event is hashed or signed. That is when real merkelization starts (`08` P8), not P0. The demo hashes and signs nothing, and its import builds trees retroactively, so the import can use this format. The only constraint on the demo today: keep the payload a separable value (it already is its own column), never mixed into envelope fields.

## 8. Encrypted payloads **[P]**

- Private events may carry an **encrypted payload** (`06` §7). It is marked by a flag bit, added with an envelope version bump when needed. Nothing has to be reserved now, since `version` and `flags` already exist.
- `type_ref`, `ref` and `auth` stay plaintext, because validity and the core indexes depend on them. **[O]** This leaks metadata (which type, who references what). Apps that can't accept that keep whole batches off the public internet instead (`06` §7).
- Only key holders can schema-check or interpret an encrypted payload. To everyone else it is opaque bytes, which the core already tolerates (§1: the payload is opaque to the core).
