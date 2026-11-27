import { describe, expect, it } from "vitest";
import { formatAddress } from "@ev/core";
import { compileGenesis, loadDefaultGenesis } from "@ev/genesis";
import { boot } from "./kit";

describe("genesis", () => {
  it("is deterministic: same file and first id give the same plan", () => {
    const a = compileGenesis(loadDefaultGenesis(), 1n);
    const b = compileGenesis(loadDefaultGenesis(), 1n);
    expect([...a.symbols]).toEqual([...b.symbols]);
  });

  it("puts the creator at first_identity and the meta-type at C/1/C/1, referencing itself", () => {
    const plan = compileGenesis(loadDefaultGenesis(), 1_000_001n);
    expect(plan.symbols.get("@id:creator")).toBe("1000001");
    expect(plan.symbols.get("@id:idm")).toBe("1000002");
    expect(plan.symbols.get("@type:type")).toBe("1000001/1/1000001/1");
    const meta = plan.events[0]!;
    expect(formatAddress(meta.typeRef)).toBe(formatAddress(meta.address));
    expect((meta.payload as { extensions: { genesis: { message: string } } }).extensions.genesis.message).toBe("Let there be types.");
  });

  it("resolves symbols inside payloads", () => {
    const plan = compileGenesis(loadDefaultGenesis(), 1n);
    const vote = plan.events.find((e) => e.name === "type:vote")!;
    expect((vote.payload as { extends: string }).extends).toBe(plan.symbols.get("@type:reaction"));
  });

  it("seeds a log in which every genesis event is valid", async () => {
    const kit = await boot();
    const invalid = [...kit.proj.events.values()].filter((r) => !r.valid).map((r) => `${formatAddress(r.event.address)} ${r.reason}`);
    expect(invalid).toEqual([]);
    expect(kit.proj.invalidTxs).toEqual([]);
    expect(kit.proj.events.size).toBe(kit.plan.events.length);
    const typeEvents = kit.plan.events.filter((e) => e.name?.startsWith("type:"));
    expect(kit.proj.types.size).toBe(typeEvents.length);
    // The tool apps carry their own manifests (app config, 03 §8).
    for (const tool of ["idm", "type-maker", "app-maker"]) {
      expect(kit.proj.manifestOf(kit.id(tool))).toBeDefined();
    }
    expect(kit.proj.identities.get(kit.id("idm"))!.owner).toBe(kit.id("creator"));
  });

  it("produces the same projection hash every time", async () => {
    const [a, b] = await Promise.all([boot(), boot()]);
    expect(a.proj.hash()).toBe(b.proj.hash());
  });

  it("refuses to seed a non-empty log", async () => {
    const kit = await boot();
    const { seedGenesis } = await import("@ev/genesis");
    await expect(seedGenesis(kit.store, kit.writer, kit.plan)).rejects.toThrow(/not empty/);
  });
});
