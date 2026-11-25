// PostgreSQL LogStore (07 §4). Same contract as MemoryLogStore: all-or-nothing,
// serialized write transactions. Serialization uses one transaction-scoped
// advisory lock, which is simple and correct for the demo; the per-app batch
// counter is the known hot spot (07 §4) and moves to time-based batching later.

import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Address, Block, EventRecord, Id, JsonValue, Tx } from "@ev/core";
import { txPayloadJson } from "@ev/core";
import type { LogStore, LogTransaction, NewTx } from "@ev/log";

interface BlocksTable { number: string; created_at: Date | string }
interface TxsTable { block: string; idx: number; initiator: string; type: string; payload: JsonValue }
interface EventsTable {
  app: string; batch: string; usr: string; seq: string;
  version: number;
  type_app: string; type_batch: string; type_usr: string; type_seq: string;
  ref_app: string | null; ref_batch: string | null; ref_usr: string | null; ref_seq: string | null;
  supersedes: boolean;
  auth_app: string | null; auth_batch: string | null; auth_usr: string | null; auth_seq: string | null;
  signature: Uint8Array | null;
  visibility: number;
  payload: JsonValue;
  created_at: Date | string;
}
interface IdentityCountersTable { id: string; batch_count: string }
interface DB {
  blocks: BlocksTable;
  txs: TxsTable;
  events: EventsTable;
  identity_counters: IdentityCountersTable;
}

const WRITE_LOCK = 7_366_001; // arbitrary advisory lock key for the log writer
const PAGE = 1000;

export interface PgLogStoreOptions {
  readonly connectionString: string;
}

export class PgLogStore implements LogStore {
  readonly db: Kysely<DB>;

  constructor(options: PgLogStoreOptions) {
    this.db = new Kysely<DB>({
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: options.connectionString }) }),
    });
  }

  /** Creates the log tables if they don't exist. */
  async migrate(): Promise<void> {
    const path = fileURLToPath(new URL("../sql/001_log.sql", import.meta.url));
    await sql.raw(readFileSync(path, "utf8")).execute(this.db);
  }

  /** Drops all log data. For tests only. */
  async truncateForTests(): Promise<void> {
    await sql`TRUNCATE events, txs, blocks, identity_counters`.execute(this.db);
  }

  async close(): Promise<void> {
    await this.db.destroy();
  }

  async transaction<T>(fn: (t: LogTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(${WRITE_LOCK})`.execute(trx);
      return fn(new PgTransaction(trx));
    });
  }

  async *blocks(): AsyncIterable<Block> {
    let after = 0n;
    for (;;) {
      const rows = await this.db
        .selectFrom("blocks").selectAll()
        .where("number", ">", after.toString())
        .orderBy("number").limit(PAGE).execute();
      for (const r of rows) yield { number: BigInt(r.number), createdAt: iso(r.created_at) };
      if (rows.length < PAGE) return;
      after = BigInt(rows.at(-1)!.number);
    }
  }

  async txsOfBlock(block: bigint): Promise<readonly Tx[]> {
    const rows = await this.db.selectFrom("txs").selectAll().where("block", "=", block.toString()).orderBy("idx").execute();
    return rows.map(rowToTx);
  }

  async batchEvents(app: Id, batch: Id): Promise<readonly EventRecord[]> {
    const rows = await this.db.selectFrom("events").selectAll()
      .where("app", "=", app.toString()).where("batch", "=", batch.toString()).execute();
    return rows.map(rowToEvent);
  }

  async getEvent(a: Address): Promise<EventRecord | undefined> {
    const row = await this.db.selectFrom("events").selectAll()
      .where("app", "=", a.app.toString()).where("batch", "=", a.batch.toString())
      .where("usr", "=", a.user.toString()).where("seq", "=", a.seq.toString())
      .executeTakeFirst();
    return row ? rowToEvent(row) : undefined;
  }
}

class PgTransaction implements LogTransaction {
  constructor(private readonly trx: Transaction<DB>) {}

  async openBlock(): Promise<Block | null> {
    const r = await this.trx.selectFrom("blocks").selectAll().orderBy("number", "desc").limit(1).executeTakeFirst();
    return r ? { number: BigInt(r.number), createdAt: iso(r.created_at) } : null;
  }

  async startBlock(createdAt: string): Promise<Block> {
    const last = await this.openBlock();
    const number = last ? last.number + 1n : 1n;
    await this.trx.insertInto("blocks").values({ number: number.toString(), created_at: createdAt }).execute();
    return { number, createdAt };
  }

  async appendTx(tx: NewTx): Promise<Tx> {
    const block = await this.openBlock();
    if (!block) throw new Error("no open block");
    const r = await this.trx.selectFrom("txs").select((eb) => eb.fn.countAll<string>().as("n"))
      .where("block", "=", block.number.toString()).executeTakeFirstOrThrow();
    const placed = { ...tx, block: block.number, idx: Number(r.n) } as Tx;
    await this.trx.insertInto("txs").values({
      block: placed.block.toString(),
      idx: placed.idx,
      initiator: placed.initiator.toString(),
      type: placed.type,
      payload: JSON.stringify(txPayloadJson(placed)) as unknown as JsonValue,
    }).execute();
    return placed;
  }

  async allocateBatch(app: Id): Promise<bigint> {
    const r = await this.trx.updateTable("identity_counters")
      .set((eb) => ({ batch_count: eb("batch_count", "+", "1") }))
      .where("id", "=", app.toString()).returning("batch_count").executeTakeFirst();
    if (!r) throw new Error(`app ${app} does not exist`);
    return BigInt(r.batch_count);
  }

  async insertEvent(e: EventRecord): Promise<void> {
    await this.trx.insertInto("events").values({
      app: e.address.app.toString(), batch: e.address.batch.toString(), usr: e.address.user.toString(), seq: e.address.seq.toString(),
      version: e.version,
      type_app: e.typeRef.app.toString(), type_batch: e.typeRef.batch.toString(), type_usr: e.typeRef.user.toString(), type_seq: e.typeRef.seq.toString(),
      ref_app: e.ref?.app.toString() ?? null, ref_batch: e.ref?.batch.toString() ?? null, ref_usr: e.ref?.user.toString() ?? null, ref_seq: e.ref?.seq.toString() ?? null,
      supersedes: e.supersedes,
      auth_app: e.auth?.app.toString() ?? null, auth_batch: e.auth?.batch.toString() ?? null, auth_usr: e.auth?.user.toString() ?? null, auth_seq: e.auth?.seq.toString() ?? null,
      signature: e.signature,
      visibility: e.visibility === "private" ? 1 : 0,
      payload: JSON.stringify(e.payload) as unknown as JsonValue,
      created_at: e.createdAt,
    }).execute();
  }

  async identityExists(id: Id): Promise<boolean> {
    const r = await this.trx.selectFrom("identity_counters").select("id").where("id", "=", id.toString()).executeTakeFirst();
    return r !== undefined;
  }

  async maxIdentity(): Promise<Id> {
    const r = await this.trx.selectFrom("identity_counters").select((eb) => eb.fn.max("id").as("m")).executeTakeFirst();
    return r?.m ? BigInt(r.m) : 0n;
  }

  async addIdentity(id: Id): Promise<void> {
    await this.trx.insertInto("identity_counters").values({ id: id.toString(), batch_count: "0" }).execute();
  }
}

function iso(v: Date | string): string {
  return (v instanceof Date ? v : new Date(v)).toISOString();
}

function addrOrNull(app: string | null, batch: string | null, user: string | null, seq: string | null): Address | null {
  if (app === null || batch === null || user === null || seq === null) return null;
  return { app: BigInt(app), batch: BigInt(batch), user: BigInt(user), seq: BigInt(seq) };
}

function rowToEvent(r: EventsTable): EventRecord {
  return {
    version: r.version,
    address: { app: BigInt(r.app), batch: BigInt(r.batch), user: BigInt(r.usr), seq: BigInt(r.seq) },
    typeRef: { app: BigInt(r.type_app), batch: BigInt(r.type_batch), user: BigInt(r.type_usr), seq: BigInt(r.type_seq) },
    ref: addrOrNull(r.ref_app, r.ref_batch, r.ref_usr, r.ref_seq),
    supersedes: r.supersedes,
    auth: addrOrNull(r.auth_app, r.auth_batch, r.auth_usr, r.auth_seq),
    signature: r.signature ? new Uint8Array(r.signature) : null,
    visibility: r.visibility === 1 ? "private" : "public",
    createdAt: iso(r.created_at),
    payload: r.payload,
  };
}

function rowToTx(r: TxsTable): Tx {
  const p = r.payload as Record<string, string>;
  const base = { block: BigInt(r.block), idx: r.idx, initiator: BigInt(r.initiator) };
  switch (r.type) {
    case "create_identity":
      return { ...base, type: "create_identity", payload: p.message === undefined ? { id: BigInt(p.id!) } : { id: BigInt(p.id!), message: p.message } };
    case "publish_batch":
      return { ...base, type: "publish_batch", payload: { app: BigInt(p.app!), batch: BigInt(p.batch!) } };
    case "transfer_ownership":
      return { ...base, type: "transfer_ownership", payload: { id: BigInt(p.id!), newOwner: BigInt(p.newOwner!) } };
    default:
      throw new Error(`unknown tx type ${r.type}`);
  }
}
