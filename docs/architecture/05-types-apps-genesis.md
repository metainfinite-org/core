# 05 — Types, Apps and Genesis

## 1. Everything is a node

Types, views, actions, manifests, grants, comments, likes — all are events, all nodes in one graph. Three layers:

1. **meta-type** — the type of types
2. **types** — instances of the meta-type: `view`, `action`, `manifest`, `grant`, `comment`, `like`, primitives…
3. **instances** — events of those types; a particular view definition is an instance of `view`

## 2. The meta-type

- The first off-chain event of genesis. Its `type_ref` points at **itself**, which ends the regress.
- Defines what a type event carries: `name`, `schema`, `display_template`, `extends`, `supersedes`, optional `deletion_hint`, a namespaced `extensions` slot.
- **Extending it:** the meta-type is itself a type, so a new meta-type version supersedes the old one and adds fields. Types created under the old one stay valid. Interpreters **preserve and ignore unknown fields** (forward compatibility). Because changing the meta-type changes how everything is read, it goes through **rule versioning** — the canonical meta-type is the one the active rule set names (`03` §9), never "whatever the creator last published".

## 3. Types

### Versioning by supersession

- A new type event references the previous version via `supersedes`. **No version integer inside types** — the version is the position in the chain.
- Events point at a **specific** type address, so old events stay valid and unambiguous under the type they were created with.
- "Update type in place" is impossible by design (it would retroactively re-interpret old events).
- **Forks are fine** — two types superseding the same one form a graph; each app picks a branch. Compatibility/migration between versions lives in projections or in optional metadata on the type.

### Inheritance (polymorphism)

- **`extends` = is-a; `supersedes` = replaces.** Kept separate.
- A derived type's schema = base fields + additions, so every derived instance is a valid base instance.
- **Rendering fallback** walks up the chain: exact type → nearest base the app knows → the type's (inherited) **display template** (e.g. `{title} by {author}` — a default stringification) → a raw JSON dump.
- Queries "events of type T" include descendants → a **type-lineage closure table** in the projection; "same family?" resolves through both `extends` and `supersedes`.
- **[P]** Single inheritance first; interfaces/multiple inheritance later.

### Convergence of duplicate types

- Anyone can create types, so there will be many duplicates and minor variations (dozens of `comment` types). That is accepted, not prevented.
- **Apps choose which types they work with.** Typically an app uses one "canonical" comment type and doesn't show the others by default. Only once another type becomes widely used do apps start to accommodate it.
- That is the **forcing function**: a new type isn't picked up by anyone else automatically, so there's little reason to invent one when an existing type will do. The ecosystem converges by **usage**.
- **Mappings between types** are also possible: an event that says how to read type B as type A, so apps can accept variants without code. **[P]** Type pickers rank types by usage (instances, apps using them).

### Primitives

Genesis type events with native kernel validators: integer, string, bytes, boolean, timestamp, address, list, record, decimal, float64 (`02` §5). Schemas reference them by address; new scalars extend them.

### Schema language

**[O]** Not chosen. **[P]** A restricted, deterministic JSON-Schema-like language whose type references are event addresses.

## 4. Apps are configuration

> **Least settled part of the design.** Types, apps, views and user scripting are expected to be reworked once the engine is being built and the model can be seen working. Treat §4–§6 as a starting point, not a contract. It is also the product's differentiator (`00` §1).

An app = **an identity + config events describing it**. The log doesn't restrict what an app can emit; config only decides what the UI offers and how data is read. The building blocks:

- **View** — how to show a set of events:
  - *query*: which types, which reference relation ("events whose ref is the selected node", "events of type T by user U")
  - *sort*: by time, by count of upvotes referencing it, or a formula from a fixed menu (reddit-style hot/top)
  - *layout*: list, tree, graph, …
- **Action** — what a user can do: "create an event of type T, ref = the selected node, payload from this small form". A like is `{type: like, ref: target}`; a comment is `{type: comment, ref: target, payload.text: <input>}`.
- **Manifest** — names the app and ties views and actions together.

Target capabilities for the first apps: commenting, liking, upvoting, reddit-style sorting, browsing a graph of nodes.

### The query and sort expression language **[O]**

Needs real design work. Requirements:

- **deterministic**: same log prefix, same result (`04` §7), with no floats in shared scores
- **always terminates**, with bounded cost
- **safe to run on a server**, i.e. sandboxed
- **evaluates identically on client and server**

Demo: a fixed menu of filters and sorts (time, reference counts, hot/top). User-defined formulas need the sandboxed language. **[P]** Study non-Turing-complete expression languages such as CEL (Common Expression Language), spreadsheet-style formulas and JSONLogic. This ties into the later scripting layer (`06` §6).

- Config **evolves like types**: a new manifest supersedes the old; the current config = the head of the chain of *valid* manifests (valid = authored under the app's owner's authority, `03` §8).
- **Forking an app** = superseding someone's manifest from your own new app identity. A non-owner's superseding manifest is accepted by the log but doesn't count for the original app — it's a fork anyone can adopt.

### Composition — a layout engine, reused not invented

Views compose from views, so this is a layout engine. Model it as a **component tree**: each view has *props* (e.g. the selected node), *children* (other views by address), data from *bound queries*, layout via flexbox/grid semantics (stack, row, grid). Study/reuse existing declarative UI models — Adaptive Cards, Retool/Appsmith JSON configs, Notion's block model — and render with React from a **whitelist of blocks**: list, tree, graph, form, button, text, stack, row.

**Expressiveness limit:** what the blocks can't express can't be built. **[Later]** an escape hatch (config pointing at hosted code) — deliberately postponed to see how far pure config goes.

**First things to build with the makers:** moderation, voting and self-governance, notification inboxes and custom feeds (`10`). They are meant to be types and apps, not core features, and they need an expression language with aggregates (`10` §6).

## 5. Shell, engine, kernel

- **Engine** — the interpreter for view/action config.
- **Shell** — chrome around it: app launcher, session, grant prompts, navigation. In the demo the shell is "a browser inside the browser" listing available apps.
- **Kernel** — the irreducible native part: draw primitives, input, event fetch, expression evaluation.
- **[Later]** The engine itself can be expressed in-system (like a Lisp/Smalltalk image, or the DOM in a browser), with kernel primitives as **precompiles** for fast rendering. That's the long-term end state; the kernel always remains.

## 6. Makers, self-hosting and genesis

- **Type Maker** = essentially a form that emits a "new type" event. **App Maker** = a form that emits identity creation + manifest/view/action events. Both fit the declarative blocks (form + action + list view).
- So the **self-hosting ladder** is:
  1. Genesis seeds the minimum viable set and hand-coded tool apps.
  2. Once the blocks suffice, Type Maker and App Maker are **re-expressed as config** (the strongest expressiveness test) and the hand-coded versions retire.
  3. The graph visualizer may remain hand-coded (or a kernel block).
- **Only the shell + engine + kernel are irreducibly code.**

### Genesis — "Satoshi's genesis", half on-chain, half off-chain

Seeded through a **programming interface (a script), not a GUI**; a fixed, versioned file in the repo; replay always starts from it. Because genesis fixes addresses, any change to it is deliberate.

Illustrative listing (`C` = creator id above the reserved range, `I` = IDM id; demo instant batching ⇒ one batch per event):

| Where | Item | Address / tx |
|---|---|---|
| chain | create creator `C` | block 1, initiator 0 |
| off-chain | meta-type (type_ref = itself) | `C/1/C/1` |
| off-chain | primitives: integer, string, bytes, boolean, timestamp, address, list, record, decimal, float64 | `C/2/C/1` … |
| off-chain | base types: view, action, manifest, grant, revoke, supersede/edit, delete, comment, like, upvote, proposal, merge | next batches of `C` |
| chain | create IDM `I`, Type Maker, App Maker, Graph Visualizer (owned by `C`) | next blocks |
| off-chain | manifests/views/actions of the first apps | in each app's own batches |
| chain / off-chain | **[P]** a demo board/feed app | optional seed |

Any other app or user can create types and apps afterwards.

## 7. Creating an app (flow)

1. **Type Maker:** define types → each save emits a "new type" event (extending a base type where sensible).
2. **App Maker:** pick types, compose views and actions, save → a new identity is created (owned by the IDM), the IDM records the creator as the human allowed to control it (custody policy) and issues the App Maker a grant to act as the app, and the manifest/view/action events are emitted as the app (`03` §8).
3. Open it from the shell. The first time each user opens it, their IDM lazily issues a grant.
4. **Edit later:** a superseding manifest, emitted the same way. Transfer/sale: on-chain ownership transfer.

## 8. Relation to Palantir Foundry and later layers

The system is partly inspired by **Palantir Foundry**: start with an **ontology** (object types ≈ types, objects ≈ events/projected state, link types ≈ references, Foundry actions ≈ actions), and configure pipelines. Pipelines, scripting nodes, the node editor and precompiles are in `06`.
