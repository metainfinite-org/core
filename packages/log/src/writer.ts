// The write path (01 §3, §7; 07 §6). Demo batching is instant: every call to
// emitEvent publishes its own batch. emitBatch keeps the full scheme (several
// events, per-user seq) so the data model matches the real system.

import {
  ENVELOPE_VERSION,
  NULL_IDENTITY,
  checkJsonRules,
  formatAddress,
  type Address,
  type EventRecord,
  type Id,
  type JsonValue,
  type Visibility,
} from "@ev/core";
import type { LogStore, LogTransaction } from "./store";

export interface EmitInput {
  /** Identity that authors the event. */
  readonly user: Id;
  readonly typeRef: Address;
  readonly ref?: Address | null;
  readonly supersedes?: boolean;
  readonly auth?: Address | null;
  readonly visibility?: Visibility;
  /** Claimed time; defaults to the writer's clock. */
  readonly createdAt?: string;
  readonly payload: JsonValue;
}

export interface CreateIdentityInput {
  readonly initiator: Id;
  /** Explicit id; otherwise the next free id at or above `firstIdentity`. */
  readonly id?: Id;
  readonly message?: string;
}

/** Called inside the write transaction before an event is inserted; throw to reject. */
export type InsertCheck = (event: EventRecord) => void | Promise<void>;

export interface WriterOptions {
  readonly firstIdentity: Id;
  readonly clock: () => string;
  readonly insertCheck?: InsertCheck;
}

export class WriteError extends Error {}

export class LogWriter {
  constructor(
    private readonly store: LogStore,
    private readonly options: WriterOptions,
  ) {}

  /** Seals the open block and opens the next one. Returns the new block number. */
  async sealBlock(createdAt?: string): Promise<bigint> {
    return this.store.transaction(async (t) => {
      const b = await t.startBlock(createdAt ?? this.options.clock());
      return b.number;
    });
  }

  async createIdentity(input: CreateIdentityInput): Promise<Id> {
    return this.store.transaction(async (t) => {
      await this.ensureBlock(t);
      if (input.initiator !== NULL_IDENTITY && !(await t.identityExists(input.initiator))) {
        throw new WriteError(`initiator ${input.initiator} does not exist`);
      }
      let id: Id;
      if (input.id !== undefined) {
        if (input.id <= 0n) throw new WriteError("identity ids start at 1");
        if (await t.identityExists(input.id)) throw new WriteError(`identity ${input.id} already exists`);
        id = input.id;
      } else {
        const max = await t.maxIdentity();
        id = max + 1n > this.options.firstIdentity ? max + 1n : this.options.firstIdentity;
      }
      await t.addIdentity(id);
      await t.appendTx({
        type: "create_identity",
        initiator: input.initiator,
        payload: input.message === undefined ? { id } : { id, message: input.message },
      });
      return id;
    });
  }

  async transferOwnership(initiator: Id, id: Id, newOwner: Id): Promise<void> {
    await this.store.transaction(async (t) => {
      await this.ensureBlock(t);
      if (!(await t.identityExists(id))) throw new WriteError(`identity ${id} does not exist`);
      if (!(await t.identityExists(newOwner))) throw new WriteError(`identity ${newOwner} does not exist`);
      await t.appendTx({ type: "transfer_ownership", initiator, payload: { id, newOwner } });
    });
  }

  /** Instant batching: one event, its own batch, published at once. */
  async emitEvent(app: Id, input: EmitInput): Promise<EventRecord> {
    const [e] = await this.emitBatch(app, [input]);
    return e!;
  }

  /**
   * Allocates the app's next batch, inserts all events with per-user seq, and
   * publishes the batch in the open block, atomically.
   */
  async emitBatch(app: Id, inputs: readonly EmitInput[]): Promise<EventRecord[]> {
    if (inputs.length === 0) throw new WriteError("empty batch");
    return this.store.transaction(async (t) => {
      await this.ensureBlock(t);
      if (!(await t.identityExists(app))) throw new WriteError(`app ${app} does not exist`);
      const batch = await t.allocateBatch(app);
      const seqs = new Map<Id, bigint>();
      const out: EventRecord[] = [];
      for (const input of inputs) {
        if (!(await t.identityExists(input.user))) throw new WriteError(`user ${input.user} does not exist`);
        const seq = (seqs.get(input.user) ?? 0n) + 1n;
        seqs.set(input.user, seq);
        const violations = checkJsonRules(input.payload);
        if (violations.length > 0) {
          throw new WriteError(`payload breaks JSON rules: ${violations.map((v) => `${v.path}: ${v.message}`).join("; ")}`);
        }
        const event: EventRecord = {
          version: ENVELOPE_VERSION,
          address: { app, batch, user: input.user, seq },
          typeRef: input.typeRef,
          ref: input.ref ?? null,
          supersedes: input.supersedes ?? false,
          auth: input.auth ?? null,
          signature: null,
          visibility: input.visibility ?? "public",
          createdAt: input.createdAt ?? this.options.clock(),
          payload: input.payload,
        };
        if (event.supersedes && !event.ref) throw new WriteError("a superseding event needs a ref");
        if (this.options.insertCheck) await this.options.insertCheck(event);
        await t.insertEvent(event);
        out.push(event);
      }
      await t.appendTx({ type: "publish_batch", initiator: app, payload: { app, batch } });
      return out;
    });
  }

  private async ensureBlock(t: LogTransaction): Promise<void> {
    if (!(await t.openBlock())) await t.startBlock(this.options.clock());
  }
}

export function describeEvent(e: EventRecord): string {
  return `${formatAddress(e.address)} type=${formatAddress(e.typeRef)}`;
}
