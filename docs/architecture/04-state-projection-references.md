# 04 — State, Projection and References

## 1. Log vs state

- **The log** (blocks, txs, events — or in the final system, the chain + off-chain batches) is **history**, the only source of truth.
- **The state** is constructed by starting at genesis and applying events in replay order. Apps read projection tables built this way and put higher-level business logic on top.
- Every projection is **rebuildable**; a rebuild must produce byte-identical output (test by hashing projections).
- **Authorization lives in the projection, not the log.** The log accepts anything (a decentralized log can't reject); the projection decides what counts. Invalid events stay in history, flagged and ignored.

## 2. Replay algorithm (sketch)

```text
for block in blocks ascending:
  rules = rule_set_for(block.number)
  for tx in block.txs ascending by idx:
    case tx.type:
      create_identity:    identities.add(id, owner = tx.initiator, created_block = block)
      transfer_ownership: identities.set_owner(id, new_owner, from = (block, tx.idx))
      bind_key:           keys.add(id, key, from = (block, tx.idx))
      publish_batch:
        batches.add(app, batch, block, tx.idx)
        for e in events_of(app, batch) ordered by (created_at, user, seq):
          pos = (block, tx.idx, e)
          status = rules.validate(e, pos)        # envelope version, type, auth (03 §5), hard deps (§5)
          event_state.put(e, status)
          if status.valid: apply_effects(e, pos) # grants, revokes, supersede → heads, deletes,
                                                 # edges, type lineage, app config, merges…
```

Demo: one event per batch per tx, so the inner loop has one iteration.

## 3. Edits, versions and forks

- An edit is a **new event that supersedes** the previous one by referencing it. The original never changes.
- **Version chains are single-author:** a supersede is valid only if authored by the **same identity** as the original (through any app, with that identity's valid auth or signature). Consequence: every valid update is authored by one identity, so that identity's IDM is the only party that has to track versions (`06`). No cross-IDM watching, no edit-grant chains.
- **Head** = latest valid version in replay order. If two valid edits supersede the same version, the later one is the head; the other remains a branch in the history.
- **Anyone can fork:** a fork is a new event by someone else referencing the original. It never affects the original's head.
- **Reads return the latest version by default**; history only on explicit request. Demo: a derived `head` per lineage and `GET /latest`.

## 4. Shared editing via pull requests

- To change someone else's event, a user publishes a **proposal** event referencing it.
- The owner's identity **merges automatically on its own behalf**: a merge bot (an app holding a grant to act as the owner) emits the superseding version as the owner. The merge event **references the proposals** it applied, giving provenance — who actually changed what — without multi-owner identities (rejected: "20 owners of one identity" is weird).
- **[P]** design points for later:
  - owner-configured **merge policy** (declarative, as config events): open, allowlist, N approvals…
  - **patches, not full replacements**, so concurrent proposals against the same base can merge (field- or operation-level; CRDTs a possible later step)
  - merging is asynchronous; pending proposals are visible until merged
  - the merge event records the outcome, so replay never re-evaluates the policy
- This gives the company knowledge-base deployment a wiki workflow.

## 5. Deletion

- A delete is a **delete event referencing the target**. The target is unchanged and keeps its slot in the sequence, so nothing that references it dangles.
- **What a delete means is decided by interpreters, not by low-level type rules.** Deletability becomes an **emergent social rule**: a feed hides deleted posts; a prediction tracker may keep showing a politician's deleted prediction, marked as deleted. Rules about this can themselves be expressed as events/config and evolve.
- **[P]** A type may carry an optional **deletion hint** — guidance for apps, never enforcement.
- Technical minimum: the meta-type, primitives and grants can't be meaningfully deleted, because interpretation depends on them. "Deleting" a type with live instances only hides it from type pickers; its instances remain interpretable.
- A delete event is always accepted into the log.
- **[O]** Legal erasure: hosts can drop payloads, proofs remain. Needs its own answer before public launch.

## 6. References

### Two kinds

- **Soft references** — plain graph edges: reply, like, mention, upvote. The projection only records the edge.
- **Hard dependencies** — references validity is evaluated against: `type_ref`, `auth` (the grant), and the authorship check for supersede/delete targets.

### The convention (decided)

> An app may **show** events from another app's unpublished batch (read-only, marked "unpublished"), but **nothing may reference them until their batch is published**. Actions relating to them stay pending until then.

Why: block order then becomes a **topological order of the reference graph** — replay never meets a forward reference, there's no "pending target" state in projections, and an event can't dangle forever because its target never published. It closes the inversion where app B's batch (referencing A's pending event) is published before A's batch: `created_at` would say A came first, block order would say the opposite.

Details:

- **Same-batch references are allowed** (a batch is atomic and lands in one block). **[P]** a hard dependency inside the same batch must precede the dependent event in within-batch order; cycles inside a batch are invalid.
- **Enforced at creation time, not by stalling batches.** An app never *creates* an event whose dependency is unpublished. It queues the user's **request** (not the event), shows it locally as pending, and creates/submits it once the dependency's batch is published. No address is burned, and no batch stalls because some IDM elsewhere is down for a few minutes. (Holding whole batches was rejected.)
- **Cost:** a reply to a pending post waits up to one batch interval; a chain of replies advances one hop per interval. Chat-like apps pick short intervals.
- **Violations** (it's only a convention, a misbehaving app can break it):
  - hard-dependency violation → the event is **invalid** (kept, ignored)
  - soft-reference violation → not fatal: **[P]** the edge activates at `max(block(source), block(target))`
- Hard dependencies are evaluated **as of the event's block** (and tx position). A "grace window" of K blocks of look-ahead was **rejected**.
- Within one app's open batch, references are fine before publication (it's the same batch).
- **Demo:** instant batching means none of this triggers, but the convention costs nothing to build in.

## 7. Reproducible computation over the log

Rankings, page-rank-style scores and other aggregates are reproducible if they are **pure functions of a log prefix**:

1. **Define "as of block N" precisely.** Edge activation = the later of its endpoints' blocks, so each block's graph is consistent and never changes afterwards.
2. **Fix the processing order:** block → tx → within-batch order. Never arrival time, never wall-clock.
3. **Deterministic arithmetic:** fixed-point or decimals, a defined summation order, a fixed iteration count or an exactly specified stopping rule (`02` §5).

Not everything needs this: a feed ranking inside one app only has to be good. Shared or auditable scores (public reputation used by many apps) need exact reproducibility.

## 8. Schema validation

Type events carry a schema for their payloads — a declaration for interpreters. Three validators, all eventually used:

1. **Server/app at insert time** — rejects malformed events early. **Used in the demo.**
2. **Projection at replay time** — event stays in the log, ignored if invalid. The strongest, and the only one a decentralized log can rely on.
3. **Clients/UIs** — hide or flag what they can't interpret.

Don't let the demo rely on (1) in a way the real system can't honor: the log itself rejects nothing.
