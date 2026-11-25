# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

This repo has **no code yet**. There are no build, lint or test commands. It holds architecture design docs and the source material they came from, for a platform that implements two talks (see [README.md](README.md)):

- *Internet 2.0: The Global Brain* (code::dive 2023)
- *Headjack: Decentralized identity & content addressing at web-scale* (code::dive 2022)

Once implementation starts, the stack is TypeScript end to end (Node + React, `BigInt` for 64-bit ids; see [07-demo-spec.md §9](docs/architecture/07-demo-spec.md)) with PostgreSQL for both deployments, a single-node docker compose for the demo, and an outbox table with Postgres notifications instead of Kafka (see [07-demo-spec.md](docs/architecture/07-demo-spec.md)). Update this file with real commands when code lands.

## Layout

- [docs/architecture/](docs/architecture/): the architecture set, files `00-README.md` to `10-in-system-social-mechanics.md`. It was written from a long design conversation.
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
- **It must run locally** on any machine with Node and Postgres before anything else; then on a single server; cloud comes last.
- **64-bit ids and addresses:** use `BigInt` or strings, never JS `number`. Payload JSON follows the rules in [02 §4](docs/architecture/02-envelope-and-encoding.md).
