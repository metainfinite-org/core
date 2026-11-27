# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

A platform that implements two talks (see [README.md](README.md)): *Internet 2.0: The Global Brain* (code::dive 2023) and *Headjack: Decentralized identity & content addressing at web-scale* (code::dive 2022). Phases 1–4 of the plan (core log, projection engine, identity and auth, shell and engine with the Type Maker and App Maker) are implemented; see the status in [08 §1.1](docs/architecture/08-development-plan.md). TypeScript end to end, PostgreSQL for persistence.

## Commands

Run from the repo root (pnpm workspaces):

- `pnpm install`
- `pnpm test`: all tests (Vitest). One file: `pnpm vitest run packages/integration/test/validity.test.ts`. One test: add `-t "<name substring>"`.
- `pnpm typecheck`: `tsc --noEmit` over all packages (TypeScript 7).
- `pnpm dev`: the API server (port 8787) plus the Vite dev server for the shell; open http://localhost:5173. `pnpm build` builds the shell into `packages/web/dist`, and `pnpm serve` runs only the API server, which also serves that build. Env: `PORT`, `HOST`, `EV_SESSION_SECRET` (random per boot if unset), `EV_LOG=1`. Parked code (config-defined apps, the App Maker) is switched off with `features.config_apps: false` in `deployment.yml`; it stays in the tree and its tests still run.
- `pnpm start`: boots a node from `deployment.yml` and prints genesis info and the projection hash. `pnpm start demo` writes a small reddit-style scenario; `pnpm start symbols` prints the genesis symbol table.
- **Postgres:** the app uses `DATABASE_URL` when `deployment.yml` has `storage: postgres`. The Postgres tests use a separate `EV_TEST_DATABASE_URL` and run only when it is set; they **truncate** the log and IDM tables, so it must point at a disposable database, never the one in `DATABASE_URL`.

Packages export their TypeScript sources directly (`"exports": "./src/index.ts"`); there is no build step except for the web client (Vite). Scripts run through `tsx`. Code that the browser loads imports `@ev/core/browser` and `@ev/rules/schema`, which have no `node:` imports.

## Code layout

One package per replaceable piece, under [packages/](packages/):

| Package | Role |
|---|---|
| `core` | Addresses (BigInt), the event envelope, blocks/txs, JSON payload rules, `stableStringify`, wire JSON (`eventToJson`) |
| `log` | `LogStore` interface, `MemoryLogStore`, `LogWriter` (the write path, atomic batch allocation), `BlockProducer`, `exportLog` (JSON lines) |
| `log-pg` | `PgLogStore` (Kysely + pg), schema in `sql/001_log.sql` |
| `rules` | JSON Schema subset validator; rule set 1 (validity: auth, types, supersede, delete, grants, constraints) over a read-only `RuleContext` |
| `projector` | Deterministic replay (block → tx → within-batch order), derived tables, live aggregates, projection `hash()` |
| `genesis` | `genesis.v1.json` (symbolic names like `@type:post`) compiled to addresses, and `seedGenesis` |
| `config` | `deployment.yml` parsing |
| `node` | `startNode` (store + writer with insert-time check + projector + genesis on first boot) and the CLI |
| `idm` | The default IDM: `IdmStore` (accounts, names, custody; memory and Postgres), lazy grants, revocation, app creation |
| `engine` | Shared by client and server: API shapes, the widget whitelist and config parsing, scopes and templates, schema-generated forms and layouts, sorts, type-view fallback, app bundles and the App Maker generator |
| `server` | Fastify API under `/api`, signed-cookie sessions, `authorize`, the read model (`ReadModel`, `can_read`), `createStack` |
| `web` | Vite + React: the shell (URL routing, launcher, accounts), the widget renderer, the Type Maker and App Maker |
| `integration` | Cross-package tests and the test kit (`test/kit.ts`) |

How the pieces fit: the writer appends to the log through a `LogStore` and never decides validity. The projector replays the log and asks the rule set for each event, passing it a `RuleContext` that reads the projection as of that position. The node runs the same rules before inserting, only to fail early. Protocol types (meta, grant, revoke, delete, manifest) come from the genesis plan, not from hard-coded addresses. Every derived table must be included in `Projector.hash()`, and the determinism tests compare a full rebuild with incremental catch-up. On top of that, the server wraps a node and the IDM. Every write goes through `authorize` and then the writer. The read model turns projector state into the JSON shapes from `@ev/engine`. The web client renders app config (views made of whitelisted widgets) with the same engine code.

## Layout of the docs

- [docs/architecture/](docs/architecture/): the architecture set, files `00-README.md` to `10-in-system-social-mechanics.md`. It was written from a long design conversation.
- [docs/conversation/log.md](docs/conversation/log.md): the append-only log of the conversation with Claude Code, written by a Stop hook ([scripts/conversation-log.mjs](scripts/conversation-log.mjs), [.claude/settings.json](.claude/settings.json)). **Don't read it unless the user explicitly asks**, and never edit it by hand. The script redacts emails, secrets and home paths automatically; private terms go in the git-ignored `.claude/conversation-redact.txt`. To backfill from transcripts: `node scripts/conversation-log.mjs --all <dir with session .jsonl files>`.
- [my_notes.txt](my_notes.txt): the user's raw notes and requirements. Some are in Bulgarian (transliterated). Ideas here that are not invalidated elsewhere are meant to end up in the architecture docs.

## How to work with the docs

- Start with `00-README.md` (principles, glossary, document map), then read the file for the task. Check `09-decisions-and-open-questions.md` before re-opening a settled question or proposing an idea. Withdrawn ideas are listed there on purpose.
- When writing up architecture, the user expects **every idea from the conversation or notes that has not been invalidated** to be included, not only what goes into the demo.
- Status markers: no marker means decided, **[P]** means proposed but unconfirmed (treat it as the default), **[O]** means open, and **[Later]** means final distributed system, not the demo.

## Core model (big picture across the docs)

- **Identities are integers.** User, app, IDM (identity manager) and genesis creator are all the same kind of thing, with no "kind" field. Roles emerge from what an identity does.
- **The event is the only primitive.** Events are immutable, typed and addressed. Types are events too (a self-referential meta-type), and anyone can create types. Edits, deletes and revocations are new events that reference the old one.
- **Address = `app/batch/user/seq`** (four integers). It names a position, not a host, and is verified by merkle proof in the final system. The batch number is a per-app nonce, with one open batch per app. `0/0/user/seq` is an optional stable address for an edit lineage.
- **The log is the source of truth.** Blocks, txs and events are the log. All state (identities, grants, latest versions, type lineage, edges) comes from projections that are rebuilt by deterministic replay. Same log prefix, same result: no wall-clock and no floats in consensus paths. Validity rules are versioned by block number.
- **Apps are config inside the system** (manifest, view and action events) that a generic engine interprets. Views form a component tree with props, children by address, bound queries, and flex/grid layout over a whitelist of blocks.
- **Demo vs. final system:** the demo is 100% centralized, but it keeps the real address scheme, envelope and projection model, so its data can be imported later with merkle trees built retroactively. In the final system only the chain is centralized: IDMs store and serve user events, and users can bind keys for self-sovereignty. Demo shortcuts (single IDM, no keys, auto-approved grants) sit behind single functions such as `authorize(session, app, user)`.
- The thin waist (envelope, address scheme, type meta-model) must stay stable. Freeze it carefully: it cannot change once genesis data exists.

## When writing code

- **Keep every piece modular and replaceable** (log store, projector, validity rules, auth, engine, shell, makers, cache), each behind a narrow interface. The user expects parts to be rewritten later, e.g. in Rust for scale.
- **Business logic belongs in-system** as types and apps, not in the kernel. Moderation, voting, notifications and feeds are meant to be built *with* the Type Maker and App Maker ([10](docs/architecture/10-in-system-social-mechanics.md)), so keep the core small and generic.
- **The first code centers on the Type Maker and App Maker.** The first demo target is only a reddit-style comment system built with them (see [08](docs/architecture/08-development-plan.md) P5). Don't build voting, moderation, notifications or the expression language yet.
- **It must run locally** on any machine with Node and Postgres before anything else; then on a single server; cloud comes last. Prerequisites: Node LTS, pnpm, PostgreSQL 16+ ([07 §11](docs/architecture/07-demo-spec.md)); TypeScript and other tools are repo dev dependencies.
- **Tooling:** pnpm workspaces (one package per replaceable piece), Fastify, Kysely, Vite + React, Vitest ([07 §13](docs/architecture/07-demo-spec.md)). Dev login locally; block interval and `first_identity` come from `deployment.yml`.
- **64-bit ids and addresses:** use `BigInt` or strings, never JS `number`. Payload JSON follows the rules in [02 §4](docs/architecture/02-envelope-and-encoding.md).
