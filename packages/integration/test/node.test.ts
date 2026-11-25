import { describe, expect, it } from "vitest";
import { parseDeploymentConfig } from "@ev/config";
import { MemoryLogStore } from "@ev/log";
import { identityOf, startNode } from "@ev/node";

const config = parseDeploymentConfig("name: test\nfirst_identity: 1000001\n");

describe("node", () => {
  it("seeds genesis on an empty log and replays an existing one", async () => {
    const store = new MemoryLogStore();
    const first = await startNode({ config, store });
    expect(first.seeded).toBe(true);
    expect(identityOf(first, "creator")).toBe(1_000_001n);
    const app = await first.writer.createIdentity({ initiator: identityOf(first, "creator") });
    await first.writer.emitEvent(app, { user: app, typeRef: first.plan.protocol.meta, payload: { name: "thing", schema: { type: "object" } } });
    await first.sync();

    const second = await startNode({ config, store });
    expect(second.seeded).toBe(false);
    expect(second.projector.hash()).toBe(first.projector.hash());
  });

  it("rejects invalid events at insert time without burning a batch", async () => {
    const node = await startNode({ config });
    const idm = identityOf(node, "idm");
    const app = await node.writer.createIdentity({ initiator: identityOf(node, "creator") });
    const alice = await node.writer.createIdentity({ initiator: idm });
    const post = node.projector.types.get(node.plan.symbols.get("@type:post")!)!.address;
    await expect(node.writer.emitEvent(app, { user: alice, typeRef: post, payload: { title: "no grant" } })).rejects.toThrow(/no_auth/);
    const ok = await node.writer.emitEvent(app, { user: app, typeRef: post, payload: { title: "as the app" } });
    expect(ok.address.batch).toBe(1n);
  });
});
