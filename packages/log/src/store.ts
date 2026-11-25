// The log store interface: blocks, txs, events (01 §4, §7). This is the seam
// where the in-memory store (tests, quick local runs) and the Postgres store
// plug in. The log accepts anything well-formed; validity is decided by the
// projection, never here.

import type { Address, Block, EventRecord, Id, Tx } from "@ev/core";

/** A tx before it is placed: block and idx are assigned by the store. */
export type NewTx = Tx extends infer T ? (T extends Tx ? Omit<T, "block" | "idx"> : never) : never;

export interface LogReader {
  /** All blocks in ascending order, including the currently open one. */
  blocks(): AsyncIterable<Block>;
  /** Txs of one block in ascending idx order. */
  txsOfBlock(block: bigint): Promise<readonly Tx[]>;
  /** Events of one batch, in any order (the projector sorts them). */
  batchEvents(app: Id, batch: Id): Promise<readonly EventRecord[]>;
  getEvent(address: Address): Promise<EventRecord | undefined>;
}

export interface LogTransaction {
  /** The currently open block, or null before the first block exists. */
  openBlock(): Promise<Block | null>;
  /** Opens block `last + 1`. The previous one is implicitly sealed. */
  startBlock(createdAt: string): Promise<Block>;
  /** Appends a tx to the open block, assigning the next idx. */
  appendTx(tx: NewTx): Promise<Tx>;
  /** Atomically increments and returns the app's batch counter (first batch = 1). */
  allocateBatch(app: Id): Promise<bigint>;
  /** Inserts an event. Fails if the address is already taken. */
  insertEvent(event: EventRecord): Promise<void>;
  identityExists(id: Id): Promise<boolean>;
  /** Highest identity created so far, 0n if none. */
  maxIdentity(): Promise<Id>;
  /** Records an identity's existence (write-side index for allocation). */
  addIdentity(id: Id): Promise<void>;
}

export interface LogStore extends LogReader {
  /** Runs `fn` atomically: all of it is applied, or none of it. Transactions are serialized. */
  transaction<T>(fn: (t: LogTransaction) => Promise<T>): Promise<T>;
}
