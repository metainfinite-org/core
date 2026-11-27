// PostgreSQL IdmStore. Same contract as MemoryIdmStore.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import type { Id } from "@ev/core";
import type { CustodyRole, IdmStore } from "./store";

interface DB {
  idm_accounts: { subject: string; identity: string; name: string };
  idm_custody: { identity: string; human: string; role: string };
}

export class PgIdmStore implements IdmStore {
  readonly db: Kysely<DB>;

  constructor(options: { readonly connectionString: string }) {
    this.db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: options.connectionString }) }) });
  }

  async migrate(): Promise<void> {
    const path = fileURLToPath(new URL("../sql/001_idm.sql", import.meta.url));
    await sql.raw(readFileSync(path, "utf8")).execute(this.db);
  }

  /** Drops all IDM records. For tests only. */
  async truncateForTests(): Promise<void> {
    await sql`TRUNCATE idm_accounts, idm_custody`.execute(this.db);
  }

  async close(): Promise<void> {
    await this.db.destroy();
  }

  async findAccount(subject: string): Promise<Id | undefined> {
    const row = await this.db.selectFrom("idm_accounts").select("identity").where("subject", "=", subject).executeTakeFirst();
    return row ? BigInt(row.identity) : undefined;
  }

  async linkAccount(subject: string, id: Id, name: string): Promise<void> {
    await this.db.insertInto("idm_accounts").values({ subject, identity: id.toString(), name }).execute();
  }

  async names(ids: readonly Id[]): Promise<Map<Id, string>> {
    const out = new Map<Id, string>();
    if (ids.length === 0) return out;
    const rows = await this.db.selectFrom("idm_accounts").select(["identity", "name"]).where("identity", "in", ids.map(String)).execute();
    for (const r of rows) out.set(BigInt(r.identity), r.name);
    return out;
  }

  async addCustody(identity: Id, human: Id, role: CustodyRole): Promise<void> {
    await this.db.insertInto("idm_custody").values({ identity: identity.toString(), human: human.toString(), role })
      .onConflict((oc) => oc.columns(["identity", "human"]).doNothing()).execute();
  }

  async custodians(identity: Id): Promise<Id[]> {
    const rows = await this.db.selectFrom("idm_custody").select("human").where("identity", "=", identity.toString()).execute();
    return rows.map((r) => BigInt(r.human));
  }

  async custodyOf(human: Id): Promise<Id[]> {
    const rows = await this.db.selectFrom("idm_custody").select("identity").where("human", "=", human.toString()).orderBy("identity").execute();
    return rows.map((r) => BigInt(r.identity));
  }
}
