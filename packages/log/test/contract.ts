// The LogStore contract: every store implementation must pass these.
// Run for the memory store here, and for Postgres in @ev/log-pg.

import { describe, expect, it } from "vitest";
import { addr, formatAddress, type Tx } from "@ev/core";
import { LogWriter, WriteError, type LogStore } from "@ev/log";

export function logStoreContract(name: string, makeStore: () => Promise<LogStore>): void {
  async function setup(firstIdentity = 1n) {
    const store = await makeStore();
    let t = 0;
    const clock = () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)).toISOString();
    const writer = new LogWriter(store, { firstIdentity, clock });
    return { store, writer };
  }

  async function allTxs(store: LogStore): Promise<Tx[]> {
    const out: Tx[] = [];
    for await (const b of store.blocks()) out.push(...(await store.txsOfBlock(b.number)));
    return out;
  }

  const T = addr(1, 1, 1, 1);

  describe(`LogStore contract: ${name}`, () => {
    it("allocates next-free identity ids starting at firstIdentity", async () => {
      const { writer } = await setup(1000n);
      expect(await writer.createIdentity({ initiator: 0n })).toBe(1000n);
      expect(await writer.createIdentity({ initiator: 1000n })).toBe(1001n);
      expect(await writer.createIdentity({ initiator: 1000n, id: 5n })).toBe(5n);
      expect(await writer.createIdentity({ initiator: 1000n })).toBe(1002n);
    });

    it("rejects duplicate identities and unknown initiators", async () => {
      const { writer } = await setup();
      await writer.createIdentity({ initiator: 0n });
      await expect(writer.createIdentity({ initiator: 0n, id: 1n })).rejects.toThrow(WriteError);
      await expect(writer.createIdentity({ initiator: 99n })).rejects.toThrow(WriteError);
    });

    it("gives each event its own batch, seq 1, published in the open block", async () => {
      const { store, writer } = await setup();
      const app = await writer.createIdentity({ initiator: 0n });
      const e1 = await writer.emitEvent(app, { user: app, typeRef: T, payload: { n: 1 } });
      const e2 = await writer.emitEvent(app, { user: app, typeRef: T, ref: e1.address, supersedes: true, payload: { n: 2, s: "ü" } });
      expect(formatAddress(e1.address)).toBe("1/1/1/1");
      expect(formatAddress(e2.address)).toBe("1/2/1/1");
      const txs = await allTxs(store);
      expect(txs.map((t) => t.type)).toEqual(["create_identity", "publish_batch", "publish_batch"]);
      expect(await store.getEvent(e2.address)).toEqual(e2);
      expect(await store.getEvent(addr(1, 3, 1, 1))).toBeUndefined();
    });

    it("keeps per-user seq within a multi-event batch", async () => {
      const { store, writer } = await setup();
      const app = await writer.createIdentity({ initiator: 0n });
      const u = await writer.createIdentity({ initiator: app });
      const es = await writer.emitBatch(app, [
        { user: u, typeRef: T, payload: 1 },
        { user: app, typeRef: T, payload: 2 },
        { user: u, typeRef: T, payload: 3 },
      ]);
      expect(es.map((e) => formatAddress(e.address))).toEqual(["1/1/2/1", "1/1/1/1", "1/1/2/2"]);
      expect((await store.batchEvents(app, 1n)).length).toBe(3);
    });

    it("is atomic: a failing event leaves no trace and burns no batch", async () => {
      const { store, writer } = await setup();
      const app = await writer.createIdentity({ initiator: 0n });
      await expect(
        writer.emitBatch(app, [
          { user: app, typeRef: T, payload: 1 },
          { user: app, typeRef: T, payload: 1.5 },
        ]),
      ).rejects.toThrow(/JSON rules/);
      expect(await store.batchEvents(app, 1n)).toEqual([]);
      const e = await writer.emitEvent(app, { user: app, typeRef: T, payload: 1 });
      expect(e.address.batch).toBe(1n);
      expect((await allTxs(store)).length).toBe(2);
    });

    it("serializes concurrent writes without collisions", async () => {
      const { store, writer } = await setup();
      const app = await writer.createIdentity({ initiator: 0n });
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, i) => writer.emitEvent(app, { user: app, typeRef: T, payload: i })),
      );
      expect(new Set(results.map((e) => e.address.batch)).size).toBe(30);
      const txs = await allTxs(store);
      expect(txs.length).toBe(31);
      expect(txs.map((t) => t.idx)).toEqual(txs.map((_, i) => i));
    });

    it("places txs into the open block and seals on demand", async () => {
      const { store, writer } = await setup();
      const app = await writer.createIdentity({ initiator: 0n });
      expect(await writer.sealBlock()).toBe(2n);
      await writer.emitEvent(app, { user: app, typeRef: T, payload: null });
      expect((await store.txsOfBlock(1n)).length).toBe(1);
      expect((await store.txsOfBlock(2n)).map((t) => t.idx)).toEqual([0]);
    });
  });
}
