# Identity–Event Platform — Architecture & Plan

This folder is the complete write-up of a long design conversation. It is meant to be the handoff into implementation: everything that was decided, everything that was proposed and not withdrawn, and everything that was explicitly deferred to the future system is here. Ideas that were raised and then rejected are listed in `09` so they are not re-proposed by accident.

**Status markers used throughout**

| Marker | Meaning |
|---|---|
| *(none)* | Decided or explicitly agreed |
| **[P]** | Proposed during the conversation, never explicitly confirmed — treat as the default until someone objects |
| **[O]** | Open question |
| **[Later]** | Belongs to the final distributed system, not the demo |

---

## 1. The idea in one page

A new kind of social / knowledge platform whose foundation is deliberately tiny:

- **Identities are integers.** Users, apps, identity managers and the genesis creator are the same kind of thing. Roles emerge from what an identity does; there is no "kind" field.
- **Events are the only primitive.** Every event is immutable, typed and addressed. Types are themselves events (a "new type" event); anyone can create types; any event can reference any published event.
- **An event's address is four integers: `app/batch/user/seq`.** It names a *position* in an app's published history, not a host. In the final system, data can be served from anywhere as long as a merkle proof comes with it.
- **The log is history; state is derived.** Blocks, transactions and events are the log. Everything an app shows is a projection built by replaying the log from genesis.
- **Apps are configuration inside the system.** An app is an identity plus config events (types, views, actions, manifests) interpreted by a generic engine. The aim is apps that are 100% expressed in-system.
- **Private data is supported** through grants, keys and encrypted payloads, and by batches whose contents are never served on the public internet. Only the merkle root has to go on-chain (`06` §7).
- **Final system:** identities live on a blockchain; events live off-chain in batches whose merkle roots are published on-chain. Identity managers (IDMs) create and custody accounts, sign users into apps with off-chain grant events, and store/serve their users' events. Users may bind public keys to become self-sovereign — as a backup, not as the daily UX.
- **First deliverable:** a 100% centralized demo that keeps the real address scheme, envelope and projection model, so that its data can later be imported into the real system and merkle-rooted retroactively.

### Project context

- **Team:** a single developer on a small budget, proficient in C++. Implementation stack: TypeScript end to end (`07` §9), with Rust later for performance-critical parts.
- **Why two demos:** the **company knowledge base** (10–20 people) is for a real team to start using and getting value from, and possibly paying for. The **public demo** comes later, when the system launches online for a larger audience.
- **What the company team will do:** build new types and apps that don't exist anywhere else: self-organize, define new kinds of reputation, sort priorities, vote on anything, even on the voting rules (`10`). Not pages or rich-text documents: most events should be of new, strongly typed kinds. No deadline.
- **What it must do better than Notion or Confluence:** custom types and apps, and the ability to express **any functionality inside the system**. The type / app / view / scripting machinery is therefore the core of the product, not a side feature.
- **Least settled area:** that same machinery. Expect to rework parts of `05` §4–§6 once building starts and the model can be seen working.

## 2. Design principles

1. **Immutability.** An event is never modified; every change (edit, delete, revoke) is a new event referencing the old one.
2. **Log over state.** The log is the only source of truth; every table an app reads is a rebuildable projection.
3. **Everything is an identity, everything is an event, everything is typed** — down to integers and strings.
4. **Position-addressed, proof-verified data.** Not host-addressed.
5. **Evolve by supersession and versioned rules, never by mutation.** No single key (not even the creator's) may be required forever.
6. **Emergent social rules over hard enforcement**, except where interpretation itself depends on a rule.
7. **A thin, stable waist** (envelope + address scheme + type meta-model), like IP in the internet hourglass: what is above and below can change independently.
8. **Determinism wherever the log is interpreted.** Same log prefix ⇒ same result on every machine.
9. **The demo mimics the real scheme even where it could be simpler**, so nothing produced in it has to be thrown away.
10. **Modular code, logic in-system.** Every piece of code sits behind a narrow interface and can be rewritten. Business logic lives in types and apps, so the code stays small.

## 3. Glossary

| Term | Meaning |
|---|---|
| Identity | An integer. May act as user, app, IDM, creator — any combination. |
| Creator | The single genesis identity. Creates the first apps (incl. the first IDM) and the first types. Its special authority is scaffolding that sunsets. |
| App | An identity that publishes batches of events. Its UI/behaviour is defined by config events. |
| IDM | Identity manager: an app that creates and owns accounts, issues/revokes grants, and (later) stores and serves its users' events. Must be sovereign in the final system. |
| Owner | The identity that owns another identity on-chain (its IDM). Ownership does not chain. |
| Sovereign | An identity with a bound public key. |
| Batch | A group of events published together by one app. Batch number = the app's nonce. |
| Version address | `app/batch/user/seq` — one specific immutable event. |
| Stable address | **[Later]** `0/0/user/seq` — an IDM-issued permanent name for a lineage of versions. |
| Block, tx | Emulated chain structures. Transactions: create identity, publish batch, bind key, transfer ownership. |
| Grant | Off-chain auth event: "app X may post on behalf of user Y". Revocable; will gain scopes and expiry. |
| Projection | A derived table/index built by replay (identities, batches, grants, heads, type lineage, edges…). |
| Head | The latest valid version in an edit chain. |
| Soft / hard reference | Soft: plain edge (reply, like). Hard: a reference validity depends on (type, auth grant, authorship check of an edit/delete target). |
| Meta-type | The self-referential "type of types"; its instances are types. |
| View / action / manifest | Config event types that together define an app. |
| Engine | Interpreter that renders views and executes actions from config. |
| Shell | The chrome around the engine: launcher, session, grant prompts, navigation ("a browser in the browser"). |
| Kernel | The small native core the engine needs (draw primitives, input, event fetch, expression evaluation). |
| Genesis | The deterministic seed: on-chain identities + off-chain events (meta-type, primitives, base types, first app configs). |

## 4. Document map

| File | Contents |
|---|---|
| `01-core-model.md` | Identity space, addresses, reserved values, batches, blocks & transactions, events, ordering, core SQL |
| `02-envelope-and-encoding.md` | Envelope fields, version & flags, auth vs signature, canonical serialization, primitives, floats, compactness, payload commitment & erasure, encrypted payloads |
| `03-identity-auth-ownership.md` | Creator, IDMs, ownership, migration, sovereignty, keys, grants, validity rule, rule versioning, app ownership |
| `04-state-projection-references.md` | Replay algorithm, edits, forks, deletion, pull-request merging, soft/hard references, reproducible computation, schema validation, replay checkpoints |
| `05-types-apps-genesis.md` | Meta-type, supersession, inheritance, primitives, apps as config, composition, shell/engine/kernel, makers, genesis listing, type convergence, view expression language |
| `06-distributed-system-and-future.md` | IDM duties, data availability, latest-version queries, stable addresses, DNS-like layer, privacy, spam, indexing & infra companies, chain choice, pipelines, related systems |
| `07-demo-spec.md` | Demo scope, the two deployments, Postgres, projection schema, API, user flows, read access, implementation stack |
| `08-development-plan.md` | Phases, dependencies & critical path, risk register, test strategy, definition of done, first week |
| `09-decisions-and-open-questions.md` | Decision log, withdrawn ideas, open questions, parking lot |
| `10-in-system-social-mechanics.md` | Moderation, governance and voting, notifications and inboxes, feeds; what the kernel must provide for them |

## 5. How to use this with a coding assistant

This folder lives at `docs/architecture/`. Start each session by having the assistant read `00-README.md` and the file relevant to the task. Before re-opening any design question, check `09`.
