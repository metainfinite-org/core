# 03 — Identity, Authentication and Ownership

## 1. Roles

All roles are played by identities; none is a type of account.

- **Creator** — the single identity in genesis. Creates the first apps (one of them the first IDM) and the first types (meta-type, primitives, grant, comment, like, view, action, manifest…). Its authority is bootstrap scaffolding (§9).
- **IDM (identity manager)** — an app that creates accounts and therefore **owns** them; acts as their cloud / identity provider: signs them into other apps via grants, revokes grants, migrates them, and **[Later]** stores and serves their events (`06`). IDMs are just apps.
- **App** — any identity that publishes batches and posts events on behalf of users who granted it.
- **User** — an identity, initially owned by an IDM, with no key.

In the demo the creator and the single default IDM are **two distinct identities** (one extra row, matches the real design). The creator creates the IDM; the IDM owns every user account.

## 2. Ownership (on-chain)

- Created by the `create_identity` tx: the initiator owns the new identity and acts as its IDM.
- **Ownership does not chain.** If a user owned by IDM-1 becomes sovereign and acts as an IDM for others, those accounts are owned by the user, not by IDM-1.
- **Only sovereign identities (with a bound key) can be IDMs** for others.
- The owner / "delegated to" relation must be on-chain and queryable, so anyone can find a user's IDM — including an IDM that is merely *delegated* for a sovereign user it doesn't own.

### Migration

- **Through the current IDM (normal path):** the user asks their IDM to transfer them to another IDM (or to themselves). The IDM submits `transfer_ownership`. Works whether or not the user has a key — except that becoming *your own* IDM requires a key.
- **Escape hatch:** if the IDM is down, rogue, deplatforming, or stops emitting events, a sovereign user submits the transfer themselves (needs a signature; later also a crypto balance for fees — ignored for now) and moves to another IDM or runs IDM software locally.
- **[O] Grants after migration.** Do grants issued by the old IDM stay valid after the user moves? **[P]** They stay valid until revoked, and the new owner (now entitled to revoke) may revoke them; apps should re-request grants on the user's next visit.

### Sales

Accounts — especially low numbers — are sellable via `transfer_ownership`. Name ownership comes later (the system is meant to eventually replace DNS). Not now.

### Apps are owned the same way

An app is an identity, so the same mechanism applies: the app's on-chain owner is its IDM (a sovereign user can be their own). **Selling or transferring an app = on-chain ownership transfer.** *Which humans* may control an owned identity (edit an app's config, run it) is the **IDM's custody policy**, not an on-chain concept — in the demo, a table in the IDM. No `operator` field in manifests (withdrawn, see `09`).

## 3. Sovereignty and keys

- **Default UX stays web2-like:** only apps and IDMs talk to the chain; they publish user events on users' behalf. The chain is the coordination backbone of apps and IDMs.
- A user may **bind a public key** (on-chain, normally via the IDM). The account becomes fully self-sovereign. The key is a **backup** against an IDM that goes rogue, deplatforms, stops emitting events, or goes down — the user keeps using IDMs day to day without signing anything.
- **Rotation:** either the user submits a tx directly, or the IDM submits a tx carrying a message in which the **old key signs the new key**. The key history is a projection of `bind_key` txs; a signature is verified against the key **active at the event's position** in replay order.
- **All on-chain transactions require signatures**, so every tx initiator is sovereign: in the final system apps and IDMs hold keys from the start, and the genesis creator holds one from block 0.
- **Explicit per-event signing:** a sovereign user may sign every off-chain event themselves, through any app, without granting it anything (e.g. using "facebook" either via log-in + grant, or by signing each event). Expected to be very rare (≈0.001%).
- **Demo:** no keys, no signatures. The server is trusted. `initiator` is still recorded on every tx and a nullable `pubkey` exists in the projection, so the data model keeps the invariant.

## 4. Grants (auth events)

- A grant is an **off-chain event emitted by the user's IDM** (author = the IDM, in the IDM's own batch): "app X can post on behalf of user Y from now on". **[Later]** a sovereign user's key can issue grants too.
- **Revocation** is a revoke event by the owner referencing the grant.
- **Lazy issuance:** when a user opens an app they haven't authorized, their IDM issues the grant. Demo: auto-approved and published immediately in its own batch. (Pre-granting every user for every new app was rejected: N events per app, and later users would still have none.)
- **An event's `auth` points at one specific grant**, not "any grant for (A, U)". So one app can hold several grants with different scopes and revoke each separately → **compartmentalization**: different services/servers of the same app get different scopes; if one is compromised, revoke just its grant. Tiers of events by sensitivity fit here too.
- **Grant type evolution** (by supersession): scopes / permissions, expiry (auto-expire), time-boxed grants, **[P]** delegation chains (a grant derived from a parent grant with a smaller scope, revocable all at once by revoking the root). None changes the envelope.
- **A grant's address is not secret.** Security comes from the check that the emitting app equals the grant's app.
- Events posted by an app for a user before the user signed in (no grant) are **invalid**: they stay in the log and are ignored.

### Apps posting through other apps

An app emitting as itself inside its **own** batch (`X/b/X/s`) needs no auth. An app emitting as itself **through another app's** batch (`Y/b/X/s`) is like any user: it needs a grant to Y, or an explicit signature. An app's batch may therefore contain both its users' events and its own.

## 5. The validity rule

Evaluated by the projection for event `e` emitted through app `A` by user `U`, **as of e's position** in replay order:

```text
valid_auth(e, pos):
  if e.user == e.app:                        # app speaks for itself in its own batch
      return true                            # (in the final system: vouched by the app's signed batch tx)
  if e.signature is not null and e.auth is null:
      return verify(key_of(U, pos), canonical_bytes(e))   # covers the address
  if e.auth is not null:
      g = event(e.auth)
      return g is published at or before pos
         and is_grant_type(g.type)             # grant type or a descendant
         and g.payload.app == e.app
         and g.payload.user == U
         and g.author == owner_of(U, at g.pos)  # or U's own key (later)
         and not revoked(g, before pos)        # revocation wins ties in a block
         and scope_allows(g, e)                # later: scopes, expiry
         and (g grants a key ⇒ verify(that key, e))
  return false
```

Plus the type check (`e.type_ref` must be a published, valid type) and the hard-dependency rules in `04`.

- **Judged as of position.** A later revocation never retroactively invalidates earlier events. Block order decides, not `created_at`.
- **`user == app` without auth is kept**, not a hole: the per-event auth exists only to show that *U consented*, and an app needs no one's consent to speak for itself. Whether a future rule set should tighten it is a rule-versioning question.

## 6. Rule versioning

Validity is a function of the whole log, so changing rules could retroactively change what history means. Rules are therefore **versioned by block number** ("rule set 2 active from block N"), exactly like a blockchain hard fork — a social-consensus decision. In the demo it's the operator's call.

**What to do now:** keep the validity function in one isolated place and pass it the block number. Nothing else.

## 7. Transport-level identity (demo)

All apps run on the same server, users reach them through a shell in their browser ("a browser in the browser"), and the server is the authority — there is no external caller to authenticate, so no API keys and no request signing. What remains is one server-side check:

`authorize(session, app, user)` → the OAuth session belongs to `user`, and a valid grant for `(app, user)` exists (lazily issued if missing). This function is the single seam where real signature checks will later plug in.

## 8. Config authorship (who may change an app)

- **Final system:** apps are sovereign; they emit their own config events (`user == app`).
- **Demo [P]:** config events (manifest, views, actions) are authored by **the app identity** (`A/b/A/s`), emitted by the App Maker on behalf of a human whom the IDM's custody policy allows to control the app (by default: the human who created it). This matches the real system.
- **[O]** Alternative: authored by the creating user with a reference to the app. The decision is isolated behind the App Maker and expected to be refactorable.
- **Watch later:** users grant an app based on what it does *today*. If its owner silently changes behaviour, existing grants carry over. Once grants have scopes, constrain it there.

## 9. Creator sunset and governance

The creator must not be needed forever, yet the system must stay fully evolvable.

- The **canonical meta-type** (and other protocol-level types) is whatever the **active rule set** names — not whatever the creator's key last published. Anyone can publish a superseding meta-type; it is a fork until adopted.
- At some point the creator's on-chain ownership is **transferred to a governance identity** (multisig or broader) or its special authority is **renounced**.
- The **envelope** is evolved by an ecosystem-wide process, not by in-system events.
