// Determinism (08 §4): a full rebuild from the log reproduces the projection
// hash, and catching up incrementally gives the same result as one replay.

import { describe, expect, it } from "vitest";
import { Projector } from "@ev/projector";
import { boot } from "./kit";

async function busyLog() {
  const kit = await boot();
  const app = await kit.newApp();
  const users = [await kit.newUser(), await kit.newUser(), await kit.newUser()];
  const grants = await Promise.all(users.map((u) => kit.grant(app, u)));
  const post = await kit.emit(app, { user: users[0]!, type: "post", auth: grants[0]!.address, payload: { title: "Topic" } });
  await kit.sync(); // incremental catch-up in the middle of the log
  for (const [i, u] of users.entries()) {
    const g = grants[i]!.address;
    const c = await kit.emit(app, { user: u, type: "comment", ref: post.address, auth: g, payload: { body: `comment ${i}` } });
    await kit.emit(app, { user: u, type: "vote", ref: post.address, auth: g, payload: { value: i % 2 === 0 ? 1 : -1 } });
    await kit.emit(app, { user: u, type: "comment", ref: c.address, supersedes: true, auth: g, payload: { body: `comment ${i}, edited` } });
    if (i === 1) await kit.writer.sealBlock();
  }
  await kit.revoke(grants[2]!);
  await kit.emit(app, { user: users[2]!, type: "comment", ref: post.address, auth: grants[2]!.address, payload: { body: "after revoke" } });
  await kit.sync();
  return kit;
}

describe("determinism", () => {
  it("a full rebuild reproduces the incremental projection hash", async () => {
    const kit = await busyLog();
    const fresh = new Projector({ protocol: kit.plan.protocol });
    await fresh.catchUp(kit.store);
    expect(fresh.hash()).toBe(kit.proj.hash());
  });

  it("two independent runs of the same script give the same hash", async () => {
    const [a, b] = await Promise.all([busyLog(), busyLog()]);
    expect(a.proj.hash()).toBe(b.proj.hash());
  });

  it("catching up twice is a no-op", async () => {
    const kit = await busyLog();
    const before = kit.proj.hash();
    await kit.sync();
    expect(kit.proj.hash()).toBe(before);
  });

  it("the hash changes when the log changes", async () => {
    const kit = await busyLog();
    const before = kit.proj.hash();
    const app = await kit.newApp();
    await kit.emit(app, { user: app, type: "post", payload: { title: "one more" } });
    await kit.sync();
    expect(kit.proj.hash()).not.toBe(before);
  });
});
