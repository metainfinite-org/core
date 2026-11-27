# 05 — Types, Apps and Genesis

## 1. Everything is a node

Types, views, actions, manifests, grants, comments, likes — all are events, all nodes in one graph. Three layers:

1. **meta-type** — the type of types
2. **types** — instances of the meta-type: `view`, `action`, `manifest`, `grant`, `comment`, `like`, primitives…
3. **instances** — events of those types; a particular view definition is an instance of `view`

## 2. The meta-type

- The first off-chain event of genesis. Its `type_ref` points at **itself**, which ends the regress.
- **A lean meta-type (decided).** A type event carries only what must be fixed together with the type:
  - `name`
  - `schema` (JSON Schema subset, §3)
  - `extends`
  - `constraints`: rules the projection enforces (below)
  - `extensions` (below)

  There is no `supersedes` field: a new version of a type is an ordinary edit, using the same generic mechanism as every other event (§3, `04` §3).
- **Constraints [P].** A small, fixed vocabulary interpreted by the kernel in v1, later expressible in the expression language (`05` §4). Examples:

  ```json
  "constraints": [
    { "kind": "unique", "per": ["author", "ref"], "resolve": "latest" },
    { "kind": "ref_type", "types": ["@type:post", "@type:comment"] },
    { "kind": "author_is", "path": "ref.author" }
  ]
  ```

  - **`unique`**: at most one event per (author, target). With `resolve: latest` a newer one replaces the older, so changing a vote is just a new vote; `resolve: first` ignores later ones. This is what makes "one like per user per post" hold. A replaced event isn't invalid, it just no longer counts.
  - **`ref_type`**: what the event may reference, e.g. a comment only on a post or a comment.
  - **`author_is`**: who may emit it, e.g. an "accepted answer" only by the question's author.
  - **Scope:** by default a constraint applies to the event's exact type, so a like and a vote on the same post coexist. `"scope": "family"` extends it to all descendants, e.g. "one emoji reaction per post, whichever emoji".
  - **Inheritance:** constraints are inherited through `extends`, and a subtype may only **tighten** them, never loosen them, because every derived instance must remain a valid base instance.
  - **[O] Repeatable reactions** (a Medium-style clap, up to 50 per user per post) can't be a subtype of a type that carries "once", since that would loosen it. Options: (a) keep `unique` off `reaction` and put it on the leaf types (`like`, `vote`) or on an intermediate `single_reaction`, so a repeatable kind extends plain `reaction`; (b) named constraints that a base may mark overridable, which a subtype replaces by id (e.g. `{ "id": "once", "kind": "max_per", "max": 50 }`). Lean: (a), because tighten-only means a constraint placed high in the hierarchy can never be taken back, so the flexible default is to put constraints as low as possible. A `max_per` kind (at most N per author and target) would serve claps either way. Not needed for the first demo.
- **`extensions`:** a namespaced map for anything else that should travel inside the type event, e.g. `{"genesis": {"message": "…"}}` or `{"org.example.units": {"length": "m"}}`. Interpreters preserve unknown namespaces and ignore them. It is the escape valve that avoids superseding the meta-type for every new idea.
- **Hints: in the type, but not in the meta-type (decided).** The middle path between "fields in the meta-type" and "separate events only":
  - **The type author's suggestions travel with the type**, under a well-known `hints` namespace in `extensions`: `display_template`, `sort_keys`, `deletion` (advice to apps on whether deleting instances makes sense; e.g. a prediction tracker keeps "deleted" predictions visible, `04` §5), `visibility`. One fetch gets them, and they are as immutable as the type.
  - **The meta-type's schema doesn't change:** these are conventional keys, not required fields. Interpreters that don't know a hint ignore it.
  - **Anyone can publish a type annotation later:** an event of type `type annotation` (or one of its subtypes) that references a type event and supplies or overrides hints. The type author can use it too, to change a hint without a new type version.
  - **Precedence:** the app's own choice → annotations the app trusts (the author's by default) → hints inside the type → kernel defaults.
- **No regress at the bottom.** The meta-type's own schema is written with JSON Schema's **native keywords** (`"type": "string"`, `"integer"`, `"boolean"`), which the kernel understands directly. So the very first event needs no `string` type to exist yet. The primitive type events published right after it (`C/2/C/1` …) give those natives addresses that schemas can reference and new scalars can extend (`email` extends `string`).
- **A genesis message (decided).** Like Satoshi's "Chancellor on brink of second bailout for banks" in Bitcoin's first block (and "Let there be light" in `my_notes.txt`), the meta-type carries a message in its `extensions`, e.g. `{"genesis": {"message": "Let there be types!"}}`. No type is needed for it.
- **[O] A separate on-chain message** in the payload of block 1's first tx (the creator's `create_identity`). Txs aren't typed events, so any bytes work. The text is still to be chosen.
- **Extending it:** the meta-type is itself a type, so a new meta-type version is an edit of the old one that adds fields. Types created under the old one stay valid. Interpreters **preserve and ignore unknown fields** (forward compatibility). Because changing the meta-type changes how everything is read, it goes through **rule versioning** — the canonical meta-type is the one the active rule set names (`03` §9), never "whatever the creator last published".

## 3. Types

### Versioning by supersession

- **A new version of a type is an edit of the type event:** the generic supersede mechanism (`04` §3), single-author like every edit. **No version integer inside types**: the version is the position in the chain.
- **Superseding is a claim, not an obsolescence.** It says "this is my newer version"; it forces nobody. Apps keep emitting and accepting the old version if they want, and adoption is social consensus. Still needed: it links versions into one lineage (for "same family?" queries and "newer version available" in type pickers), and the same mechanism gives content edits and app config heads (manifests).
- **Someone else's improved version** of your type is not a supersede (that would be another author's edit, which is invalid). It is a new type that `extends` yours, or one that declares it was derived from yours in its hints.
- Events point at a **specific** type address, so old events stay valid and unambiguous under the type they were created with.
- "Update type in place" is impossible by design (it would retroactively re-interpret old events).
- **Forks are fine**: two edits of the same version by its author, or derived types by others, form a graph; each app picks a branch. Compatibility/migration between versions lives in projections or in optional metadata on the type.

### Inheritance (polymorphism)

- **`extends` = is-a; an edit (supersede) = a newer version.** Kept separate.
- A derived type's schema = base fields + additions, so every derived instance is a valid base instance.
- **[P] `additionalProperties: false` closes only the type it is written on.** An instance is always validated against its own (concrete) type, which it names, merged with its ancestors; "no extra fields" then means "no fields beyond those the chain declares". So a subtype may add fields to a closed base, as in programming languages, and a reader that knows only the base ignores the extra fields. The flag still catches typos and stray fields in instances of the type itself. Forbidding subtypes altogether ("final") would be a separate, explicit constraint if ever needed, not a side effect of `additionalProperties`. Versions are unaffected: each version of a type is its own closed schema, and a new version may add fields because old events keep pointing at the old version.
- **Protocol types and subtypes [P].** The rules give meaning to a few types (meta-type, grant, revoke, delete, manifest), because validity and core state depend on them and must come out the same on every node. The rules recognize them by **exact type**: the versions the active rule set names. Anyone may still extend them, but a subtype (say `expiring_grant` with an `expires` field) is an ordinary, inert type until a later rule version recognizes it and says what `expires` does. Nothing is silently half-honored, so an expiring grant can never look like a grant that doesn't expire, and future grant kinds (scoped, expiring, relayable) stay possible without breaking the past: old blocks keep the old rules (`03` §9). In the demo, the rules still accept subtypes of these types; switching to exact-type recognition is pending confirmation.
- **[P] Type adapters.** Two independently made types for the same thing can be linked by an **adapter** event: "type A ≈ type B", with field mappings (`A.text ↔ B.body`). An adapter is an ordinary event that anyone can publish, so a projection must not change just because someone published one. Adapters enter shared state the way everything else does: a projection definition is itself an event (`04` §10) and can name the adapters it adopts, socially, through votes or curation (`10`), producing its own tables, e.g. counts per (target, adapted family) beside the plain per-type counts. Until then, readers apply the adapters they trust at query time (a union over the mapped types). Only the type's author can make it "official", by publishing a new version that `extends` the other type.
- **Rendering fallback** walks up the chain: the app's own view for the type → the type's default **type view** (§4, "Displaying one event") → nearest base type the app knows → the type's (inherited) **display template** hint (e.g. `{title} by {author}`, a default stringification) → the **auto-renderer** generated from the schema → raw JSON as the last resort.
- Queries "events of type T" include descendants → a **type-lineage closure table** in the projection; "same family?" resolves through both `extends` and version lineage.
- **[P]** Single inheritance first; interfaces/multiple inheritance later.

### Convergence of duplicate types

- Anyone can create types, so there will be many duplicates and minor variations (dozens of `comment` types). That is accepted, not prevented.
- **Apps choose which types they work with.** Typically an app uses one "canonical" comment type and doesn't show the others by default. Only once another type becomes widely used do apps start to accommodate it.
- That is the **forcing function**: a new type isn't picked up by anyone else automatically, so there's little reason to invent one when an existing type will do. The ecosystem converges by **usage**.
- **Mappings between types** are also possible: an event that says how to read type B as type A, so apps can accept variants without code. **[P]** Type pickers rank types by usage (instances, apps using them).

### Primitives

Genesis type events with native kernel validators: integer, string, bytes, boolean, timestamp, address, list, record, decimal, float64 (`02` §5). Schemas reference them by address; new scalars extend them.

### Schema language

**JSON Schema** (decided), restricted to a deterministic subset, with references to other types written as event addresses.

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

**Expressiveness limit:** what the widgets can't express can't be built. **[Later]** an escape hatch (config pointing at hosted code) — deliberately postponed to see how far pure config goes.

**First things to build with the makers:** moderation, voting and self-governance, notification inboxes and custom feeds (`10`). They are meant to be types and apps, not core features, and they need an expression language with aggregates (`10` §6).

### Displaying one event: type, type view, app view **[P]**

Three different things, often confused:

| Concept | Answers | Owned by | Changes how |
|---|---|---|---|
| **Type** | what the data *is*: schema, `extends`, constraints | type author | supersession creates a **new type**; old events keep the old one |
| **Type view** | how to show **one event** of a type: a card, a detail page, a compact row | anyone; the type author's is the default | freely; many per type |
| **App view** | how to show **a set** of events in an app: query + sort + layout, composed of type views | the app | with the app's manifest |

- **The view is not inside the type.** Types are immutable, and every change creates a new type version that old events don't follow. Presentation changes much more often than data shape. If the layout lived in the type, every visual tweak would fork the data type and split the ecosystem. So a type view is a **separate event that references the type**.
- **Several layouts per type are normal:** compact, card, full page, and different ones per app. Apps pick which type views they use, and type views are ranked by usage like types (§3).
- **App views reuse or override type views.** An app view composes type views by address. It can reuse the type's default, pick another existing one, or override the rendering of a type inside that app with its own. Precedence when rendering an event: the app's override for the type → the type view the app chose → the type's default type view → the auto-renderer. **[P]** A user preference can sit on top ("always show type T with this type view").
- **The Type Maker creates the type and its default type view together**, so every new type is displayable from day one.
- **Every event is always displayable**, even with no type view at all: the kernel's **auto-renderer** derives a layout from the schema (field labels, values, references as links). It also generates a **creation form** from the schema: the input UI for making a *new* event of that type, with a text field per string, a number input per integer, an address picker per reference, and validation from the schema. So any type can be instantiated the moment it exists ("create one" in the Type Maker), and app actions can start from the generated form instead of a hand-designed one.
- **Opening `/e/a/b/c/d`:** app `a` shows it by default (`07` §10). If app `a` has no view for the type, the type's default type view is used; failing that, the auto-renderer. **[P]** Users can set a preference such as "open events of type T with app X".
- **If app `a` is gone:** its UI isn't. An app is declarative, and its config is events in the log. As long as the events and the config can be fetched (from IDMs, archives, any host, `06` §1), the shell can still render the event the way app `a` did. Only the app's servers disappear, not its interface.

## 5. Shell, engine, kernel

- **Engine** — the interpreter for view/action config.
- **Shell** — chrome around it: app launcher, session, grant prompts, navigation. In the demo the shell is "a browser inside the browser" listing available apps.
- **Kernel** — the irreducible native part: draw primitives, input, event fetch, expression evaluation.
- **[Later]** The engine itself can be expressed in-system (like a Lisp/Smalltalk image, or the DOM in a browser), with kernel primitives as **precompiles** for fast rendering. That's the long-term end state; the kernel always remains.
- **Names (decided).** The whitelisted UI building blocks are **widgets** (`{"widget": "stack", …}`), so "block" means only a chain block and "component" stays free for the replaceable system pieces. An app whose UI is hand-written in the shell is a **native app**: its manifest's `native` field names that UI (`"native": "type-maker"`), honored only for apps the genesis creator owns. "Kernel" keeps its meaning: the generic core that runs rules, projections, primitives and the auto-renderer.
- **Native apps first (decided).** The first apps are hand-written in the shell. Each still has a minimal manifest event (`name`, `description`, `native`), so "which apps exist" lives in the log, not in shell code. Config-defined apps (views, actions, type views in the manifest) and the App Maker are **parked behind `features.config_apps: false`** in `deployment.yml` (`07` §11): the code stays in the tree with its tests, and the switch only hides it. "Anyone can make an app from types" is parked with them. The Type Maker stays a native genesis app.

## 6. Makers, self-hosting and genesis

- **Type Maker** = essentially a form that emits a "new type" event. **App Maker** = a form that emits identity creation + manifest/view/action events. Both fit the declarative widgets (form + action + list view).
- So the **self-hosting ladder** is:
  1. Genesis seeds the minimum viable set and hand-coded tool apps.
  2. Once the widgets suffice, Type Maker and App Maker are **re-expressed as config** (the strongest expressiveness test) and the hand-coded versions retire.
  3. The graph visualizer may remain hand-coded (or a native widget).
- **Only the shell + engine + kernel are irreducibly code.**

### Genesis — "Satoshi's genesis", half on-chain, half off-chain

Seeded through a **programming interface, not a GUI**: on first boot with an empty database, the system reads the genesis data file automatically, and the creator account emits its types and apps, which receive their addresses then. It is a fixed, versioned file in the repo; replay always starts from it. Because genesis fixes addresses, any change to it is deliberate.

Illustrative listing (`C` = creator id above the reserved range, `I` = IDM id; demo instant batching ⇒ one batch per event):

| Where | Item | Address / tx |
|---|---|---|
| chain | create creator `C` | block 1, initiator 0 |
| off-chain | meta-type (type_ref = itself) | `C/1/C/1` |
| off-chain | primitives: integer, string, bytes, boolean, timestamp, address, list, record, decimal, float64 | `C/2/C/1` … |
| off-chain | base types: view, action, manifest, type view, type annotation, grant, revoke, supersede/edit, delete, post, comment, **reaction** (with the uniqueness constraint), **like** and **vote** (+1 / −1) extending reaction, proposal, merge | next batches of `C` |
| chain | create IDM `I`, Type Maker, App Maker, Graph Visualizer (owned by `C`) | next blocks |
| off-chain | manifests/views/actions of the first apps | in each app's own batches |
| chain / off-chain | **[P]** a demo board/feed app | optional seed |

Any other app or user can create types and apps afterwards.

### Genesis iterations: "restarting the Matrix" **[P]**

While the demo is young, the system is restarted many times, each time with a **richer genesis**: more base types, better makers, cleaner configs. The best of each iteration is kept as the starting set of the next.

- **Genesis is a data file written with symbolic names**, not addresses: `@type:comment`, `@app:type-maker`. The seed script assigns addresses deterministically when it runs, the way a compiler assigns memory locations. The file is versioned in git (genesis v1, v2, …).
- **Exporting for the next iteration:** pick events in the running system (types, type views, app configs, maybe some content). An exporter turns them into a **bundle**: the same symbolic format, with addresses inside the kept events rewritten to symbolic names, and references to things not kept dropped or flagged. Merge the bundle into the next genesis file, reset the database, and replay.
- **The same bundles move types and apps between deployments**, e.g. an interesting app built by the company team recreated on the public system. There they are imported as ordinary new events, not as genesis. Automate later.
- **What to do now:** write the genesis file in the symbolic format from day one; it costs nothing. Build the exporter only when the first restart worth keeping comes up. Demo data is disposable until then anyway (`08` R3).

## 7. Creating an app (flow)

1. **Type Maker:** define types → each save emits a "new type" event (extending a base type where sensible).
2. **App Maker:** pick types, compose views and actions, save → a new identity is created (owned by the IDM), the IDM records the creator as the human allowed to control it (custody policy) and issues the App Maker a grant to act as the app, and the manifest/view/action events are emitted as the app (`03` §8).
3. Open it from the shell. The first time each user opens it, their IDM lazily issues a grant.
4. **Edit later:** a superseding manifest, emitted the same way. Transfer/sale: on-chain ownership transfer.

## 8. Relation to Palantir Foundry and later layers

The system is partly inspired by **Palantir Foundry**: start with an **ontology** (object types ≈ types, objects ≈ events/projected state, link types ≈ references, Foundry actions ≈ actions), and configure pipelines. Pipelines, scripting nodes, the node editor and precompiles are in `06`.
