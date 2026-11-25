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
- **[P] How an edit is marked:** the envelope's **supersede flag** (`02` §1.1). With it set, `ref` means "previous version of", not "reply to". Without it, a comment that references a comment is ambiguous: a reply, or a new version? The core needs to know which, because heads are core state. The new version has the same type as the original, or a newer version of that type.
- **What an edit keeps:** relations that belong to the lineage, such as which post a comment replies to, are taken from the lineage's root event. An edit therefore can't move a comment to another post; extra references go in the payload (`01` §5).
- **Version chains are single-author:** a supersede is valid only if authored by the **same identity** as the original (through any app, with that identity's valid auth or signature). Consequence: every valid update is authored by one identity, so that identity's IDM is the only party that has to track versions (`06`). No cross-IDM watching, no edit-grant chains.
- **Head** = latest valid version in replay order. If two valid edits supersede the same version, the later one is the head; the other remains a branch in the history.
- **Anyone can fork:** a fork is a new event by someone else referencing the original. It never affects the original's head.
- **Reads return the latest version by default**; history only on explicit request. Demo: a derived `head` per lineage. The API splits it into an immutable exact-version read and a small status lookup, so versions stay cacheable (`07` §3).

## 4. Shared editing via pull requests

- To change someone else's event, a user publishes a **proposal** event referencing it.
- The owner's identity **merges automatically on its own behalf**: a merge bot (an app holding a grant to act as the owner) emits the superseding version as the owner. The merge event **references the proposals** it applied, giving provenance — who actually changed what — without multi-owner identities (rejected: "20 owners of one identity" is weird).
- **[P]** design points for later:
  - owner-configured **merge policy** (declarative, as config events): open, allowlist, N approvals…
  - **patches, not full replacements**, so concurrent proposals against the same base can merge (field- or operation-level; CRDTs a possible later step)
  - merging is asynchronous; pending proposals are visible until merged
  - the merge event records the outcome, so replay never re-evaluates the policy
- This gives a wiki-style workflow for shared content.

## 5. Deletion

- A delete is a **delete event referencing the target**. The target is unchanged and keeps its slot in the sequence, so nothing that references it dangles.
- **What a delete means is decided by interpreters, not by low-level type rules.** Deletability becomes an **emergent social rule**: a feed hides deleted posts; a prediction tracker may keep showing a politician's deleted prediction, marked as deleted. Rules about this can themselves be expressed as events/config and evolve.
- **[P]** A **deletion hint** can be published as a type annotation (`05` §2): guidance for apps, never enforcement.
- Technical minimum: the meta-type, primitives and grants can't be meaningfully deleted, because interpretation depends on them. "Deleting" a type with live instances only hides it from type pickers; its instances remain interpretable.
- A delete event is always accepted into the log.
- **Erasure mechanism:** hosts drop the payload and keep its hash. Proofs and signatures still verify because leaves commit to `hash(payload)` (`02` §7). **[O]** The legal and moderation *position* (who must erase what, on whose request) still needs an answer before public launch.

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

## 9. Replay cost and checkpoints

- Replaying from genesis gets slower forever. **Checkpoints** (projection snapshots as of block N) are produced by infrastructure / cloud companies (`06` §9), and anyone can start from a checkpoint instead of from genesis.
- Building state is deterministic, so a checkpoint is identified by *(block N, active rule set, projection definition)* plus a **hash of its contents**. Anyone can verify it by replaying, or trust several independent publishers whose hashes agree. **[P]** Snapshots therefore need a canonical serialization too, so that their hashes are reproducible.
- **Demo:** a full rebuild is enough. The projection hash from `POST /admin/rebuild` (`07` §6) is the prototype of a checkpoint hash.

## 10. Derived values defined in-system **[P]**

Aggregates, reputation, vote outcomes and strike counts are **state**: pure functions of the log and of the rules that evolve inside it. Their *definitions* should live in-system too, so the community can change how they are computed. This section covers how a definition written as an event becomes a computation in the database.

### Definitions are events; the kernel executes them

- A **derived-value definition** is an event of a genesis type such as `metric`. It names its inputs (types, reference relations, other definitions) and a formula in the expression language (`05` §4). For example: *likes(x) = count of events of type ⊑ like whose ref = x*.
- Definitions evolve by supersession like everything else, and the version in force is applied **as of its position** in the log. Changing how reputation is computed never rewrites the past.
- **The kernel executes definitions; it never contains them.** A definition can run in three ways, and all three must give the same answer:
  1. **Interpreted:** the expression is compiled to SQL on the fly at query time. Simple, fine for small data, and the reference semantics.
  2. **Incrementally maintained:** the projection worker updates the stored value as each relevant event arrives. Counts and sums over direct references cost O(1) per event.
  3. **Precompiled:** a hand-written native implementation for a popular, heavy definition, matched by the definition's address (`06` §6). The in-system definition stays the specification, and a test runs both and compares results.

### No new table per definition

- Results go into **generic tables keyed by the definition's address**, e.g. `derived(def, subject, value, as_of_block)`. Adding business logic in-system adds rows, not schema.
- Specialized tables and indexes may still appear, but only as a **kernel optimization** for hot definitions (a precompile with its own index), never as a requirement of the business logic. Like a database index: invisible to meaning, visible to speed.

### Two classes: live and epoch

| Class | Examples | When computed |
|---|---|---|
| **Live** | counts, sums, "has the author deleted it", latest version | on every event, incrementally |
| **Epoch** | PageRank-style reputation, anything iterative or global | once per epoch, as of block height H (e.g. every N blocks or every hour) |

- Epoch computations run like a scheduled job, but their result is defined by **block height H, not by wall-clock time**: "reputation v3 as of block 120,000". Anyone replaying the log reproduces it exactly: fixed iteration count or an exact stopping rule, fixed-point or decimal arithmetic, fixed order (§7).
- Results are published as **snapshots**, cacheable and checkpointable (§9).

### Feedback loops: stratify by epoch

Reputation affects sorting, sorting affects what people see, what they see affects what they like, and likes affect reputation. That is not a bug: it is the point of a living system, and PageRank-like systems work this way too. It only gets messy if a *computation* depends on itself. The rule that keeps it well-defined:

- **Within one epoch, the dependency graph of definitions must be acyclic.** The kernel rejects (or ignores) cyclic definitions.
- **A cycle is allowed only through the previous epoch:** reputation at epoch *k* may read `prev(reputation)` from epoch *k−1*, plus the raw events up to H. The system is then a deterministic state machine, `state[k+1] = f(state[k], events up to H[k+1])`, the same shape as a blockchain.
- **Feedback through people is free.** UI sorting influences humans, humans emit new events, new events enter the next epoch. Nothing about this needs special handling.
- Convergence is not guaranteed in general, but **determinism is**, and determinism is what matters for a shared state.

### Prior art worth studying

This is the problem space of **stratified Datalog** (recursive, terminating queries with a stratification rule for negation and aggregates), **incremental view maintenance** and **differential dataflow** (Materialize, Feldera/DBSP), and of course the PageRank power iteration. A Datalog-like core with aggregates is a strong candidate for the derived-value language.

### Scope

**Not in the first demo.** The first demo needs only built-in live counts (upvotes per comment) for reddit-style sorting, hard-coded in the kernel. This section is the direction for later (`08`), and it is why the expression language is the key open design problem (`09` §3).
