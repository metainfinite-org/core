// The projection engine (04 §1–§2): replays the log in block → tx →
// within-batch order, asks the active rule set whether each event is valid,
// and applies the effects of valid events to derived tables. Every table here
// is rebuildable from the log, and `hash()` must be identical for the same log.

import {
  addressEquals,
  addressKey,
  comparePosition,
  parseAddress,
  sha256Hex,
  stableStringify,
  type Address,
  type EventRecord,
  type Id,
  type JsonValue,
  type Position,
  type Tx,
} from "@ev/core";
import type { LogReader } from "@ev/log";
import {
  createRulesV1,
  effectiveRef,
  extendSchema,
  isTypeDefinition,
  parseConstraints,
  ruleSetFor,
  type Constraint,
  type EventInfo,
  type GrantInfo,
  type ProtocolTypes,
  type RuleContext,
  type RuleSet,
  type Schema,
  type TypeInfo,
  type Verdict,
} from "@ev/rules";

export interface IdentityRow {
  readonly id: Id;
  owner: Id;
  readonly createdBlock: bigint;
}

export interface EventRow {
  readonly event: EventRecord;
  readonly valid: boolean;
  readonly reason: string | null;
  readonly position: Position;
  readonly lineageRoot: string;
  /** False when a `unique` constraint replaced it (it no longer counts). */
  effective: boolean;
}

export interface GrantRow {
  readonly address: Address;
  readonly app: Id;
  readonly user: Id;
  readonly issuer: Id;
  readonly issuedBlock: bigint;
  revokedBlock: bigint | null;
}

export interface EdgeRow {
  readonly src: string;
  readonly dst: string;
  /** Block at which the edge counts: the later of its endpoints' blocks (04 §6). Null while the target is unknown. */
  activeBlock: bigint | null;
}

export interface Aggregate {
  count: number;
  sum: number;
}

interface Contribution {
  readonly dst: string;
  readonly types: readonly string[];
  readonly value: number;
}

export interface InvalidTx {
  readonly block: bigint;
  readonly idx: number;
  readonly reason: string;
}

export interface ProjectorOptions {
  readonly protocol: ProtocolTypes;
  /** Sorted by fromBlock. Defaults to rule set 1 from block 1. */
  readonly ruleSets?: readonly RuleSet[];
}

export interface EventStatus {
  readonly address: Address;
  readonly valid: boolean;
  readonly reason: string | null;
  readonly head: Address;
  readonly deleted: boolean;
}

export class Projector {
  readonly protocol: ProtocolTypes;
  private readonly ruleSets: readonly RuleSet[];

  // Derived tables -------------------------------------------------------
  readonly identities = new Map<Id, IdentityRow>();
  readonly ownershipHistory: { id: Id; owner: Id; block: bigint; tx: number }[] = [];
  readonly batches = new Map<string, { block: bigint; tx: number }>();
  readonly events = new Map<string, EventRow>();
  /** Lineage root -> head (latest valid version). */
  readonly heads = new Map<string, string>();
  /** Lineage root -> address of the delete event. */
  readonly deleted = new Map<string, string>();
  readonly types = new Map<string, TypeInfo>();
  readonly grants = new Map<string, GrantRow>();
  readonly edges = new Map<string, EdgeRow>();
  /** "dst|typeVersionRoot" -> live count and sum of payload.value (built-in live aggregates, 04 §10). */
  readonly aggregates = new Map<string, Aggregate>();
  readonly invalidTxs: InvalidTx[] = [];
  /** Block number -> block time (authoritative clock, 01 §5). */
  readonly blockTimes = new Map<bigint, string>();
  /** Reverse edges: target -> sources, in replay order (replies, reactions). */
  readonly children = new Map<string, string[]>();
  /** Type version root -> lineage roots of valid events of that type or a descendant, in replay order. */
  readonly byType = new Map<string, string[]>();
  /** Lineage root -> every valid version after the root, in replay order (history, 07 §6 status). */
  readonly versions = new Map<string, string[]>();
  /** App -> lineage root of its current manifest (app_config, 07 §5). */
  readonly appConfig = new Map<Id, string>();

  private catchingUp: Promise<void> = Promise.resolve();
  // Private index over `grants` (hashed there): "app|user" -> grant keys.
  private readonly grantIndex = new Map<string, string[]>();
  private readonly uniqueHolders = new Map<string, string>();
  private readonly contributions = new Map<string, Contribution>();
  private readonly pendingEdges = new Map<string, string[]>();
  private cursor: { block: bigint; nextIdx: number } = { block: 1n, nextIdx: 0 };
  private readonly ctx: RuleContext;

  constructor(options: ProjectorOptions) {
    this.protocol = options.protocol;
    this.ruleSets = options.ruleSets ?? [createRulesV1()];
    this.ctx = this.makeContext();
  }

  // --- replay ------------------------------------------------------------

  /**
   * Applies every tx not yet applied, in replay order. Safe to call repeatedly
   * and concurrently: calls are serialized, so no tx is applied twice.
   */
  catchUp(log: LogReader): Promise<void> {
    const run = this.catchingUp.then(() => this.catchUpNow(log));
    this.catchingUp = run.catch(() => undefined);
    return run;
  }

  private async catchUpNow(log: LogReader): Promise<void> {
    for await (const block of log.blocks()) {
      if (block.number < this.cursor.block) continue;
      this.blockTimes.set(block.number, block.createdAt);
      if (block.number > this.cursor.block) this.cursor = { block: block.number, nextIdx: 0 };
      const txs = await log.txsOfBlock(block.number);
      for (const tx of txs) {
        if (tx.idx < this.cursor.nextIdx) continue;
        await this.applyTx(tx, log);
        this.cursor = { block: block.number, nextIdx: tx.idx + 1 };
      }
    }
  }

  private async applyTx(tx: Tx, log: LogReader): Promise<void> {
    const fail = (reason: string): void => {
      this.invalidTxs.push({ block: tx.block, idx: tx.idx, reason });
    };
    switch (tx.type) {
      case "create_identity": {
        const { id } = tx.payload;
        if (this.identities.has(id)) return fail("identity_exists");
        if (tx.initiator === 0n ? this.identities.size > 0 : !this.identities.has(tx.initiator)) {
          return fail("bad_initiator");
        }
        this.identities.set(id, { id, owner: tx.initiator, createdBlock: tx.block });
        this.ownershipHistory.push({ id, owner: tx.initiator, block: tx.block, tx: tx.idx });
        return;
      }
      case "transfer_ownership": {
        const row = this.identities.get(tx.payload.id);
        if (!row) return fail("unknown_identity");
        if (row.owner !== tx.initiator) return fail("not_owner");
        if (!this.identities.has(tx.payload.newOwner)) return fail("unknown_new_owner");
        row.owner = tx.payload.newOwner;
        this.ownershipHistory.push({ id: row.id, owner: row.owner, block: tx.block, tx: tx.idx });
        return;
      }
      case "publish_batch": {
        const { app, batch } = tx.payload;
        const key = `${app}/${batch}`;
        if (tx.initiator !== app) return fail("publisher_is_not_app");
        if (this.batches.has(key)) return fail("batch_already_published");
        this.batches.set(key, { block: tx.block, tx: tx.idx });
        const events = [...(await log.batchEvents(app, batch))].sort(withinBatchOrder);
        const rules = ruleSetFor(this.ruleSets, tx.block);
        events.forEach((e, sub) => this.applyEvent(e, { block: tx.block, tx: tx.idx, sub }, rules));
        return;
      }
    }
  }

  private applyEvent(e: EventRecord, position: Position, rules: RuleSet): void {
    const key = addressKey(e.address);
    if (this.events.has(key)) return; // defensive: an address is applied once
    const verdict = rules.validate(e, this.ctx);
    const lineageRoot = verdict.valid && e.supersedes ? this.events.get(addressKey(e.ref!))!.lineageRoot : key;
    const row: EventRow = {
      event: e,
      valid: verdict.valid,
      reason: verdict.valid ? null : verdict.reason,
      position,
      lineageRoot,
      effective: verdict.valid,
    };
    this.events.set(key, row);
    if (verdict.valid) this.applyEffects(e, row);
    this.activatePendingEdges(key, position.block);
  }

  /** Effects of a valid event on the derived tables (04 §2 apply_effects). */
  private applyEffects(e: EventRecord, row: EventRow): void {
    const key = addressKey(e.address);
    const P = this.protocol;

    if (e.supersedes) {
      this.heads.set(row.lineageRoot, key);
      const list = this.versions.get(row.lineageRoot) ?? [];
      list.push(key);
      this.versions.set(row.lineageRoot, list);
    }

    if (isTypeDefinition(e, this.ctx)) this.registerType(e, row);

    if (!e.supersedes) {
      for (const t of this.typeLineageKeys(e.typeRef)) {
        const list = this.byType.get(t) ?? [];
        list.push(key);
        this.byType.set(t, list);
      }
      // App config: a manifest the app emits as itself in its own batch (03 §8). The newest lineage wins.
      if (e.address.user === e.address.app && this.ctx.isA(e.typeRef, P.manifest)) {
        this.appConfig.set(e.address.app, key);
      }
    }

    if (!e.supersedes) {
      if (this.ctx.isA(e.typeRef, P.grant)) {
        const p = e.payload as { app: string; user: string };
        this.grants.set(key, {
          address: e.address,
          app: BigInt(p.app),
          user: BigInt(p.user),
          issuer: e.address.app, // the publisher: the user itself or its owner at the time
          issuedBlock: row.position.block,
          revokedBlock: null,
        });
        const pair = `${p.app}|${p.user}`;
        this.grantIndex.set(pair, [...(this.grantIndex.get(pair) ?? []), key]);
      } else if (this.ctx.isA(e.typeRef, P.revoke)) {
        const g = this.grants.get(addressKey(e.ref!));
        if (g && g.revokedBlock === null) g.revokedBlock = row.position.block;
      } else if (this.ctx.isA(e.typeRef, P.delete)) {
        const target = this.events.get(addressKey(e.ref!))!;
        if (!this.deleted.has(target.lineageRoot)) {
          this.deleted.set(target.lineageRoot, key);
          this.releaseUnique(target.lineageRoot);
          this.recomputeContribution(target.lineageRoot);
        }
      }
    }

    // Soft reference edge (replies, likes...). Edits don't create edges.
    const ref = effectiveRef(e, this.ctx);
    if (!e.supersedes && ref) this.addEdge(key, addressKey(ref), row.position.block);

    if (!e.supersedes) this.applyUnique(e, row);
    this.recomputeContribution(row.lineageRoot);
  }

  private registerType(e: EventRecord, row: EventRow): void {
    const key = addressKey(e.address);
    const p = e.payload as { name: string; schema: Schema; extends?: string; constraints?: JsonValue };
    const isMeta = addressEquals(e.address, this.protocol.meta);
    const versionRoot = parseAddress(row.lineageRoot);
    let schema: Schema = p.schema;
    let inherited: Constraint[] = [];
    let base: Address | null = null;
    if (!isMeta && p.extends) {
      base = parseAddress(p.extends);
      const bt = this.types.get(addressKey(base))!;
      // The rules already rejected type definitions whose schema can't extend the base.
      schema = extendSchema(bt.schema, p.schema).schema!;
      inherited = [...bt.constraints];
    }
    const own = parseConstraints(p.constraints);
    const ownConstraints = typeof own === "string" ? [] : own.map((c) => (c.kind === "unique" ? { ...c, declaredBy: versionRoot } : c));
    this.types.set(key, {
      address: e.address,
      name: p.name,
      schema,
      extends: base,
      versionRoot,
      constraints: [...inherited, ...ownConstraints],
    });
  }

  // --- unique constraints and live aggregates ----------------------------

  private uniqueKeys(e: EventRecord): { key: string; resolve: "latest" | "first" }[] {
    const t = this.types.get(addressKey(e.typeRef));
    if (!t) return [];
    const ref = effectiveRef(e, this.ctx);
    const out: { key: string; resolve: "latest" | "first" }[] = [];
    for (const c of t.constraints) {
      if (c.kind !== "unique") continue;
      const scope = c.scope === "family" && c.declaredBy ? addressKey(c.declaredBy) : addressKey(t.versionRoot);
      const author = c.per.includes("author") ? e.address.user.toString() : "*";
      const target = c.per.includes("ref") ? (ref ? addressKey(ref) : "-") : "*";
      out.push({ key: `${scope}|${author}|${target}`, resolve: c.resolve });
    }
    return out;
  }

  private applyUnique(e: EventRecord, row: EventRow): void {
    const key = addressKey(e.address);
    for (const u of this.uniqueKeys(e)) {
      const holder = this.uniqueHolders.get(u.key);
      if (holder === undefined) {
        this.uniqueHolders.set(u.key, key);
      } else if (u.resolve === "latest") {
        const old = this.events.get(holder)!;
        old.effective = false;
        this.uniqueHolders.set(u.key, key);
        this.recomputeContribution(old.lineageRoot);
      } else {
        row.effective = false;
      }
    }
  }

  private releaseUnique(lineageRoot: string): void {
    for (const [k, holder] of this.uniqueHolders) if (holder === lineageRoot) this.uniqueHolders.delete(k);
  }

  /** Re-derives what a lineage contributes to live aggregates, from its head. */
  private recomputeContribution(lineageRoot: string): void {
    const old = this.contributions.get(lineageRoot);
    if (old) {
      for (const t of old.types) {
        const a = this.aggregates.get(`${old.dst}|${t}`)!;
        a.count -= 1;
        a.sum -= old.value;
        if (a.count === 0 && a.sum === 0) this.aggregates.delete(`${old.dst}|${t}`);
      }
      this.contributions.delete(lineageRoot);
    }
    const root = this.events.get(lineageRoot);
    if (!root || !root.valid || !root.effective || this.deleted.has(lineageRoot)) return;
    const head = this.events.get(this.heads.get(lineageRoot) ?? lineageRoot)!.event;
    const dst = root.event.ref && !root.event.supersedes ? addressKey(root.event.ref) : null;
    if (!dst) return;
    const types = this.typeLineageKeys(head.typeRef);
    if (types.length === 0) return;
    const p = head.payload;
    const value = typeof p === "object" && p !== null && !Array.isArray(p) && Number.isSafeInteger(p.value) ? (p.value as number) : 0;
    for (const t of types) {
      const k = `${dst}|${t}`;
      const a = this.aggregates.get(k) ?? { count: 0, sum: 0 };
      a.count += 1;
      a.sum += value;
      this.aggregates.set(k, a);
    }
    this.contributions.set(lineageRoot, { dst, types, value });
  }

  /** Version roots of a type and all its bases, nearest first. */
  typeLineageKeys(type: Address): string[] {
    const out: string[] = [];
    let t = this.types.get(addressKey(type));
    while (t) {
      out.push(addressKey(t.versionRoot));
      t = t.extends ? this.types.get(addressKey(t.extends)) : undefined;
    }
    return out;
  }

  // --- edges ---------------------------------------------------------------

  private addEdge(src: string, dst: string, block: bigint): void {
    const kids = this.children.get(dst) ?? [];
    kids.push(src);
    this.children.set(dst, kids);
    const target = this.events.get(dst);
    if (target) {
      const tb = target.position.block;
      this.edges.set(src, { src, dst, activeBlock: tb > block ? tb : block });
    } else {
      this.edges.set(src, { src, dst, activeBlock: null });
      const list = this.pendingEdges.get(dst) ?? [];
      list.push(src);
      this.pendingEdges.set(dst, list);
    }
  }

  private activatePendingEdges(dst: string, block: bigint): void {
    const srcs = this.pendingEdges.get(dst);
    if (!srcs) return;
    for (const s of srcs) {
      const edge = this.edges.get(s)!;
      const sb = this.events.get(s)!.position.block;
      edge.activeBlock = sb > block ? sb : block;
    }
    this.pendingEdges.delete(dst);
  }

  // --- reads ---------------------------------------------------------------

  /** Validates a not-yet-inserted event against the current state (insert-time check, 04 §8). */
  validateCandidate(e: EventRecord, block?: bigint): Verdict {
    return ruleSetFor(this.ruleSets, block ?? this.cursor.block).validate(e, this.ctx);
  }

  /** The block the projector has reached. */
  get currentBlock(): bigint {
    return this.cursor.block;
  }

  /** The mutable status of an event (07 §3): head, deleted, validity. */
  status(address: Address): EventStatus | undefined {
    const row = this.events.get(addressKey(address));
    if (!row) return undefined;
    const head = this.heads.get(row.lineageRoot) ?? row.lineageRoot;
    return {
      address,
      valid: row.valid,
      reason: row.reason,
      head: parseAddress(head),
      deleted: this.deleted.has(row.lineageRoot),
    };
  }

  aggregate(target: Address, type: Address): Aggregate {
    const t = this.types.get(addressKey(type));
    if (!t) return { count: 0, sum: 0 };
    return this.aggregates.get(`${addressKey(target)}|${addressKey(t.versionRoot)}`) ?? { count: 0, sum: 0 };
  }

  /** Head (latest valid version) of the lineage `key` belongs to. */
  headOf(key: string): string {
    const row = this.events.get(key);
    if (!row) return key;
    return this.heads.get(row.lineageRoot) ?? row.lineageRoot;
  }

  /** True if the lineage `key` belongs to has a valid delete. */
  isDeleted(key: string): boolean {
    const row = this.events.get(key);
    return row !== undefined && this.deleted.has(row.lineageRoot);
  }

  /** The app's current manifest (head version), unless it was deleted. */
  manifestOf(app: Id): EventRow | undefined {
    const root = this.appConfig.get(app);
    if (root === undefined || this.deleted.has(root)) return undefined;
    return this.events.get(this.headOf(root));
  }

  /** Valid, not deleted lineage roots of `type` or a descendant, in replay order. */
  instancesOf(type: Address): string[] {
    const t = this.types.get(addressKey(type));
    if (!t) return [];
    return (this.byType.get(addressKey(t.versionRoot)) ?? []).filter((k) => !this.deleted.has(k));
  }

  /** Every version of a lineage, oldest first. */
  history(key: string): string[] {
    const row = this.events.get(key);
    if (!row) return [];
    return [row.lineageRoot, ...(this.versions.get(row.lineageRoot) ?? [])];
  }

  /** Is the grant valid now (issued, not revoked)? Grants are judged per event as of its position. */
  grantsFor(app: Id, user: Id): GrantRow[] {
    return (this.grantIndex.get(`${app}|${user}`) ?? []).map((k) => this.grants.get(k)!).filter((g) => g.revokedBlock === null);
  }

  /** Hash of every derived table. Same log ⇒ same hash, on any machine. */
  hash(): string {
    const events = new Map(
      [...this.events].map(([k, r]) => [k, { valid: r.valid, reason: r.reason, position: r.position, root: r.lineageRoot, effective: r.effective }]),
    );
    const types = new Map(
      [...this.types].map(([k, t]) => [
        k,
        { name: t.name, schema: t.schema, extends: t.extends ? addressKey(t.extends) : null, versionRoot: addressKey(t.versionRoot), constraints: t.constraints.map((c) => stableStringify(c)) },
      ]),
    );
    return sha256Hex(
      stableStringify({
        identities: this.identities,
        ownershipHistory: this.ownershipHistory,
        batches: this.batches,
        events,
        heads: this.heads,
        deleted: this.deleted,
        types,
        grants: new Map([...this.grants].map(([k, g]) => [k, { ...g, address: addressKey(g.address) }])),
        edges: this.edges,
        aggregates: this.aggregates,
        invalidTxs: this.invalidTxs,
        blockTimes: this.blockTimes,
        children: this.children,
        byType: this.byType,
        versions: this.versions,
        appConfig: this.appConfig,
      }),
    );
  }

  // --- rule context ------------------------------------------------------

  private makeContext(): RuleContext {
    const self = this;
    return {
      protocol: this.protocol,
      identityExists: (id) => self.identities.has(id),
      ownerOf: (id) => self.identities.get(id)?.owner,
      eventInfo(address): EventInfo | undefined {
        const row = self.events.get(addressKey(address));
        if (!row) return undefined;
        return {
          event: row.event,
          valid: row.valid,
          position: row.position,
          lineageRoot: parseAddress(row.lineageRoot),
          deleted: self.deleted.has(row.lineageRoot),
        };
      },
      typeInfo: (address) => self.types.get(addressKey(address)),
      isA(type, ancestor) {
        const anc = self.types.get(addressKey(ancestor));
        if (!anc) return false;
        const root = addressKey(anc.versionRoot);
        return self.typeLineageKeys(type).includes(root);
      },
      grantInfo(address): GrantInfo | undefined {
        const g = self.grants.get(addressKey(address));
        if (!g) return undefined;
        return { address: g.address, app: g.app, user: g.user, revoked: g.revokedBlock !== null };
      },
    };
  }
}

/** Within one batch: claimed time, then (user, seq) as tiebreak (01 §6). */
export function withinBatchOrder(a: EventRecord, b: EventRecord): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.address.user !== b.address.user) return a.address.user < b.address.user ? -1 : 1;
  if (a.address.seq !== b.address.seq) return a.address.seq < b.address.seq ? -1 : 1;
  return 0;
}

export { comparePosition };
