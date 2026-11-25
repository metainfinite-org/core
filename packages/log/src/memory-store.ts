// In-memory LogStore. Same contract as the Postgres store: serialized,
// all-or-nothing transactions. Used by tests and quick local runs.

import { addressKey, type Address, type Block, type EventRecord, type Id, type Tx } from "@ev/core";
import type { LogStore, LogTransaction, NewTx } from "./store";

interface State {
  blocks: Block[];
  txs: Map<bigint, Tx[]>;
  events: Map<string, EventRecord>;
  batchIndex: Map<string, string[]>; // "app/batch" -> event keys
  batchCounters: Map<Id, bigint>;
  identities: Set<Id>;
  maxIdentity: Id;
}

function emptyState(): State {
  return {
    blocks: [],
    txs: new Map(),
    events: new Map(),
    batchIndex: new Map(),
    batchCounters: new Map(),
    identities: new Set(),
    maxIdentity: 0n,
  };
}

function cloneState(s: State): State {
  return {
    blocks: [...s.blocks],
    txs: new Map([...s.txs].map(([k, v]) => [k, [...v]])),
    events: new Map(s.events),
    batchIndex: new Map([...s.batchIndex].map(([k, v]) => [k, [...v]])),
    batchCounters: new Map(s.batchCounters),
    identities: new Set(s.identities),
    maxIdentity: s.maxIdentity,
  };
}

export class MemoryLogStore implements LogStore {
  private state: State = emptyState();
  private queue: Promise<unknown> = Promise.resolve();

  async transaction<T>(fn: (t: LogTransaction) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const working = cloneState(this.state);
      const result = await fn(new MemoryTransaction(working));
      this.state = working; // commit
      return result;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  async *blocks(): AsyncIterable<Block> {
    for (const b of this.state.blocks) yield b;
  }

  async txsOfBlock(block: bigint): Promise<readonly Tx[]> {
    return this.state.txs.get(block) ?? [];
  }

  async batchEvents(app: Id, batch: Id): Promise<readonly EventRecord[]> {
    const keys = this.state.batchIndex.get(`${app}/${batch}`) ?? [];
    return keys.map((k) => this.state.events.get(k)!);
  }

  async getEvent(address: Address): Promise<EventRecord | undefined> {
    return this.state.events.get(addressKey(address));
  }
}

class MemoryTransaction implements LogTransaction {
  constructor(private readonly s: State) {}

  async openBlock(): Promise<Block | null> {
    return this.s.blocks.at(-1) ?? null;
  }

  async startBlock(createdAt: string): Promise<Block> {
    const last = this.s.blocks.at(-1);
    const block: Block = { number: last ? last.number + 1n : 1n, createdAt };
    this.s.blocks.push(block);
    this.s.txs.set(block.number, []);
    return block;
  }

  async appendTx(tx: NewTx): Promise<Tx> {
    const block = this.s.blocks.at(-1);
    if (!block) throw new Error("no open block");
    const list = this.s.txs.get(block.number)!;
    const placed = { ...tx, block: block.number, idx: list.length } as Tx;
    list.push(placed);
    return placed;
  }

  async allocateBatch(app: Id): Promise<bigint> {
    const next = (this.s.batchCounters.get(app) ?? 0n) + 1n;
    this.s.batchCounters.set(app, next);
    return next;
  }

  async insertEvent(event: EventRecord): Promise<void> {
    const key = addressKey(event.address);
    if (this.s.events.has(key)) throw new Error(`address already taken: ${key}`);
    this.s.events.set(key, event);
    const bk = `${event.address.app}/${event.address.batch}`;
    const list = this.s.batchIndex.get(bk);
    if (list) list.push(key);
    else this.s.batchIndex.set(bk, [key]);
  }

  async identityExists(id: Id): Promise<boolean> {
    return this.s.identities.has(id);
  }

  async maxIdentity(): Promise<Id> {
    return this.s.maxIdentity;
  }

  async addIdentity(id: Id): Promise<void> {
    this.s.identities.add(id);
    if (id > this.s.maxIdentity) this.s.maxIdentity = id;
  }
}
