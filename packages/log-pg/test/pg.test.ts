// Runs only when EV_TEST_DATABASE_URL points at a disposable Postgres database:
//   EV_TEST_DATABASE_URL=postgres://user:pass@localhost:5432/ev_test pnpm test
// WARNING: the tests TRUNCATE the log tables.

import { afterAll, describe, expect, it } from "vitest";
import { compileGenesis, loadDefaultGenesis, seedGenesis } from "@ev/genesis";
import { LogWriter, MemoryLogStore } from "@ev/log";
import { PgLogStore } from "@ev/log-pg";
import { Projector } from "@ev/projector";
import { logStoreContract } from "../../log/test/contract";

const url = process.env.EV_TEST_DATABASE_URL;
if (url && url === process.env.DATABASE_URL) {
  throw new Error("EV_TEST_DATABASE_URL equals DATABASE_URL: the tests truncate tables, so use a separate database");
}

if (url) {
  const store = new PgLogStore({ connectionString: url });
  let migrated = false;
  afterAll(() => store.close());

  logStoreContract("postgres", async () => {
    if (!migrated) {
      await store.migrate();
      migrated = true;
    }
    await store.truncateForTests();
    return store;
  });

  describe("postgres replay", () => {
    it("gives the same projection hash as the memory store for genesis", async () => {
      await store.truncateForTests();
      const plan = compileGenesis(loadDefaultGenesis(), 1n);
      const clock = () => plan.time;
      const mem = new MemoryLogStore();
      await seedGenesis(mem, new LogWriter(mem, { firstIdentity: 1n, clock }), plan);
      await seedGenesis(store, new LogWriter(store, { firstIdentity: 1n, clock }), plan);
      const a = new Projector({ protocol: plan.protocol });
      const b = new Projector({ protocol: plan.protocol });
      await a.catchUp(mem);
      await b.catchUp(store);
      expect(b.hash()).toBe(a.hash());
    });
  });
} else {
  describe.skip("postgres (set EV_TEST_DATABASE_URL to run)", () => {
    it("skipped", () => undefined);
  });
}
