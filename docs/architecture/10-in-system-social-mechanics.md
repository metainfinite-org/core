# 10 — In-System Social Mechanics: Moderation, Governance, Notifications, Feeds

None of this is a core feature. These are **types and apps to be built inside the system** with the Type Maker and App Maker. This file records what they should do, so the core provides what they need: the few generic kernel capabilities are listed in §6. None of it is in the first code (§7).

## 1. Principle

- **Business logic lives in-system**, as types, apps and rules expressed as events. The kernel and the host provide only generic mechanisms.
- **Rules are events too:** they evolve by supersession, are adopted by votes, and are applied as of their position in the log. Outcomes are therefore deterministic projections (`04` §7): same log prefix, same verdict, same reputation, everywhere.

## 2. Moderation

Goal: no profanity or illegal content on the platform's hosts, with moderation done by **self-organized users** under the system's code of conduct.

- **Code of conduct:** an event of a rules type. It evolves by supersession, and amendments are adopted through governance (§3).
- **Flag:** any user can flag any event (a `flag` event with `ref` = the target, and in the payload which rule it breaks, plus a note).
- **Review and decisions:** moderators review flags and emit decision events: hide, dismiss, strike, ban. Each references what it decides on.
- **Strikes and bans:** e.g. "3 strikes ⇒ ban". The rule is a config event, and its parameters (how many strikes, ban length, whether strikes expire) are chosen by the community (§3).
- **Hierarchy and disputes:** moderators sit in tiers. Any decision can be **disputed** (a dispute event referencing it), which escalates it to the next tier. That tier **upholds or overturns** it with its own event. The effective outcome is a projection: the decision of the highest tier that has ruled.
- **Penalties and reputation:**
  - Reporters whose flags are dismissed, and moderators whose decisions are overturned, lose reputation and may be penalized.
  - Accurate reporters and moderators gain reputation.
  - Reputation can gate who may moderate at which tier, and how much a flag weighs. These scores are shared and auditable, so they must be exactly reproducible (`04` §7).
- **[O] Bootstrap:** who appoints the first moderators. **[P]** The creator or host operator appoints the first tier; later tiers come from elections or reputation (§3).
- **Effect on serving:** moderation decisions are events and never modify the log. **[P]** A host chooses which **moderation authority** it follows (a config event naming the moderation app or the root of the hierarchy). Its `can_read` hides content according to that authority's effective decisions and purges the CDN (`07` §3). In the distributed system other hosts may follow other authorities: moderation is a choice made by whoever serves the data, not a global truth.
- **[P] Operator override:** illegal content must come down at once, whatever the process (a legal duty). The host operator's identity sits at the top of the hierarchy and can hide immediately. Its decision is still an event, so it is visible and can be disputed.
- **Ban effect:** the host's apps stop accepting events from the banned identity (`authorize` refuses), and its existing content is hidden according to the policy. Events it posted through other hosts may still exist in the log.

## 3. Self-governance: voting, and rules about rules

What the company team wants to do: define new kinds of reputation, sort the company's priorities, vote on anything, and **vote on the voting rules**.

- **Proposal → votes → outcome**, all as events. The outcome is a projection computed by the voting rule in force at the proposal's position.
- **Voting rules are config events:** quorum, majority, who may vote, weights (e.g. by reputation). They are versioned by supersession.
- **Rules about rules:** changing a voting rule is itself a proposal, decided under the current rule, so a rule governs its own amendment. **[P]** A "constitution" event created with each community fixes its initial rules.
- Deterministic like everything else: fixed order, no floats in outcomes (`02` §5).

## 4. Notifications and inboxes

- **Default inbox:** every event that references one of your events (reply, like, vote, flag on your post, …). It can be filtered later.
- **Custom criteria, system-wide**, not only about your own events. Examples: "anything that gets more than 10 likes", "any new type extending X", "any decision by a tier-2 moderator".
- **Multiple inboxes**, each with its own filter.
- **In-system form:** an `inbox` type = owner + filter expression. The kernel evaluates inbox filters as new events are projected (§6). Threshold criteria ("more than 10 likes") fire once, when the aggregate crosses the threshold.
- **[O] Read state** ("seen up to here"): an event per user, or per-user state kept outside the log?
- **[Later]** Maps onto IDM notifications in the distributed system (`06` §3).

## 5. Feeds

- Users define any number of feeds, each fully customizable: which types, which criteria, how to sort.
- A feed is a **view config** (`05` §4) owned by the user. Publishing it lets others use or fork it.
- It uses the same expression language as views and notifications.

## 6. What the kernel must provide

1. **The expression language** (`05` §4): filters, sorts, and **aggregates over references** (count of likes referencing X, a sum of votes weighted by reputation). It must be deterministic and sandboxed.
   **Consequence:** voting, strikes, reputation and threshold notifications all depend on aggregates, so the fixed menu of sorts planned for the demo won't cover what the company deployment is for. The expression language is needed earlier than the plan first assumed (`08` P5).
2. **[P] User-defined derived values:** named computations ("reputation v2", "vote outcome", "strike count") defined as events, evaluated by the projection workers, and stored as projections. This is the first step of the later scripting and pipeline layer (`06` §6).
3. **Subscription matching:** evaluate inbox filters on every newly projected event.
4. **The visibility seam:** `can_read` honoring the followed moderation authority (`07` §3).

Everything else (moderation flows, strikes, governance, feeds, inboxes) is types and apps.

## 7. Order of work

Not in the first code. The first code is the core plus the **Type Maker and App Maker** (`08`). These mechanisms are then the first things to build *with* them, and the gaps found that way drive the design of the expression language and of derived values.
