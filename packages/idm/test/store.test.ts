// IdmStore contract: the memory store always; Postgres only when EV_TEST_DATABASE_URL
// points at a disposable database (the test TRUNCATEs the IDM tables).

import { afterAll, describe, expect, it } from "vitest";
import { MemoryIdmStore, PgIdmStore, type IdmStore } from "../src/index";

function contract(name: string, make: () => Promise<IdmStore>): void {
  describe(`IdmStore contract: ${name}`, () => {
    it("links subjects to accounts, once", async () => {
      const s = await make();
      expect(await s.findAccount("dev:alice")).toBeUndefined();
      await s.linkAccount("dev:alice", 5n, "alice");
      expect(await s.findAccount("dev:alice")).toBe(5n);
      await expect(s.linkAccount("dev:alice", 6n, "alice")).rejects.toThrow();
      expect(await s.names([5n, 7n])).toEqual(new Map([[5n, "alice"]]));
    });

    it("records custody both ways, idempotently", async () => {
      const s = await make();
      await s.addCustody(10n, 5n, "owner");
      await s.addCustody(10n, 5n, "owner");
      await s.addCustody(11n, 5n, "owner");
      expect(await s.custodians(10n)).toEqual([5n]);
      expect(await s.custodyOf(5n)).toEqual([10n, 11n]);
      expect(await s.custodyOf(6n)).toEqual([]);
    });
  });
}

contract("memory", async () => new MemoryIdmStore());

const url = process.env.EV_TEST_DATABASE_URL;
if (url && url === process.env.DATABASE_URL) {
  throw new Error("EV_TEST_DATABASE_URL equals DATABASE_URL: the tests truncate tables, so use a separate database");
}
if (url) {
  const store = new PgIdmStore({ connectionString: url });
  let migrated = false;
  afterAll(() => store.close());
  contract("postgres", async () => {
    if (!migrated) {
      await store.migrate();
      migrated = true;
    }
    await store.truncateForTests();
    return store;
  });
}
