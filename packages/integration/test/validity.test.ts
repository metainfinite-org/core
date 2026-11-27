import { describe, expect, it } from "vitest";
import { addr, formatAddress } from "@ev/core";
import { boot } from "./kit";

async function withPost() {
  const kit = await boot();
  const app = await kit.newApp();
  const alice = await kit.newUser();
  const g = await kit.grant(app, alice);
  const post = await kit.emit(app, { user: alice, type: "post", auth: g.address, payload: { title: "Hello" } });
  return { kit, app, alice, g, post };
}

describe("auth (03 §5)", () => {
  it("accepts an app speaking for itself without auth", async () => {
    const kit = await boot();
    const app = await kit.newApp();
    const e = await kit.emit(app, { user: app, type: "post", payload: { title: "from the app" } });
    expect(await kit.verdict(e)).toBe("valid");
  });

  it("requires a grant for posting on behalf of a user", async () => {
    const kit = await boot();
    const app = await kit.newApp();
    const alice = await kit.newUser();
    const e = await kit.emit(app, { user: alice, type: "post", payload: { title: "x" } });
    expect(await kit.verdict(e)).toBe("no_auth");
  });

  it("accepts a valid grant and rejects grants for another app or user", async () => {
    const { kit, app, alice, g, post } = await withPost();
    expect(await kit.verdict(post)).toBe("valid");
    const other = await kit.newApp();
    const e1 = await kit.emit(other, { user: alice, type: "post", auth: g.address, payload: { title: "x" } });
    expect(await kit.verdict(e1)).toBe("grant_for_other_app");
    const bob = await kit.newUser();
    const e2 = await kit.emit(app, { user: bob, type: "post", auth: g.address, payload: { title: "x" } });
    expect(await kit.verdict(e2)).toBe("grant_for_other_user");
  });

  it("judges revocation as of position: earlier events stay valid", async () => {
    const { kit, app, alice, g, post } = await withPost();
    await kit.revoke(g);
    const after = await kit.emit(app, { user: alice, type: "post", auth: g.address, payload: { title: "late" } });
    expect(await kit.verdict(post)).toBe("valid");
    expect(await kit.verdict(after)).toBe("grant_revoked");
  });

  it("only the user's owner may issue grants", async () => {
    const kit = await boot();
    const app = await kit.newApp();
    const alice = await kit.newUser();
    const grantFor = (u: bigint) => ({ app: app.toString(), user: u.toString() });
    // The app tries to grant itself access to alice, as itself or as her.
    const fake = await kit.emit(app, { user: app, type: "grant", payload: grantFor(alice) });
    expect(await kit.verdict(fake)).toBe("grant_not_by_user");
    const forged = await kit.emit(app, { user: alice, type: "grant", payload: grantFor(alice) });
    expect(await kit.verdict(forged)).toBe("grant_not_by_owner");
    const e = await kit.emit(app, { user: alice, type: "post", auth: fake.address, payload: { title: "x" } });
    expect(await kit.verdict(e)).toBe("auth_not_a_valid_grant");
  });

  it("grants are authored by the user and published by its owner or itself", async () => {
    const kit = await boot();
    const app = await kit.newApp();
    const alice = await kit.newUser();
    const g = await kit.grant(app, alice);
    expect(g.address.app).toBe(kit.id("idm"));
    expect(g.address.user).toBe(alice);
    expect(await kit.verdict(g)).toBe("valid");
    // A grant can't be published under another grant (an app granting a second app).
    const other = await kit.newApp();
    const relayed = await kit.emit(app, {
      user: alice, type: "grant", auth: g.address, payload: { app: other.toString(), user: alice.toString() },
    });
    expect(await kit.verdict(relayed)).toBe("grant_not_by_owner");
    // Revocation: the same author and publisher rules.
    const r = await kit.revoke(g);
    expect(r.address.user).toBe(alice);
    expect(await kit.verdict(r)).toBe("valid");
    const g2 = await kit.grant(app, alice);
    const badRevoke = await kit.emit(app, { user: app, type: "revoke", ref: g2.address, payload: {} });
    expect(await kit.verdict(badRevoke)).toBe("revoke_not_by_user");
  });

  it("follows ownership transfers: the new owner issues grants", async () => {
    const kit = await boot();
    const app = await kit.newApp();
    const alice = await kit.newUser();
    const idm2 = await kit.newApp();
    await kit.writer.transferOwnership(kit.id("idm"), alice, idm2);
    const oldGrant = await kit.grant(app, alice); // the old IDM no longer owns alice
    expect(await kit.verdict(oldGrant)).toBe("grant_not_by_owner");
    const g = await kit.emit(idm2, { user: alice, type: "grant", payload: { app: app.toString(), user: alice.toString() } });
    expect(await kit.verdict(g)).toBe("valid");
  });

  it("ignores transfers not initiated by the owner", async () => {
    const kit = await boot();
    const alice = await kit.newUser();
    const thief = await kit.newApp();
    await kit.writer.transferOwnership(thief, alice, thief);
    await kit.sync();
    expect(kit.proj.identities.get(alice)!.owner).toBe(kit.id("idm"));
    expect(kit.proj.invalidTxs.at(-1)!.reason).toBe("not_owner");
  });
});

describe("types and schemas", () => {
  it("rejects events of unknown types and payloads that break the schema", async () => {
    const { kit, app, alice, g } = await withPost();
    const e1 = await kit.emit(app, { user: alice, type: addr(9, 9, 9, 9), auth: g.address, payload: {} });
    expect(await kit.verdict(e1)).toBe("unknown_type");
    const e2 = await kit.emit(app, { user: alice, type: "post", auth: g.address, payload: { body: "no title" } });
    expect(await kit.verdict(e2)).toMatch(/^schema: .*missing "title"/);
  });

  it("lets anyone create a type; derived types inherit base fields and constraints", async () => {
    const kit = await boot();
    const app = await kit.newApp();
    const t = await kit.emit(app, {
      user: app, type: "type",
      payload: { name: "star rating", extends: formatAddress(kit.type("reaction")), schema: { type: "object", required: ["stars"], properties: { stars: { type: "integer", minimum: 1, maximum: 5 } } } },
    });
    expect(await kit.verdict(t)).toBe("valid");
    const info = kit.proj.types.get(formatAddress(t.address))!;
    expect(info.constraints.map((c) => c.kind)).toEqual(["unique"]);
    expect(kit.proj.typeLineageKeys(t.address)).toEqual([formatAddress(t.address), formatAddress(kit.type("reaction"))]);
  });

  it("rejects type definitions with unsupported schema keywords or bad extends", async () => {
    const kit = await boot();
    const app = await kit.newApp();
    const bad = await kit.emit(app, { user: app, type: "type", payload: { name: "x", schema: { type: "object", $ref: "http://evil" } } });
    expect(await kit.verdict(bad)).toMatch(/^bad_schema/);
    const redefine = await kit.emit(app, {
      user: app, type: "type",
      payload: { name: "y", extends: formatAddress(kit.type("vote")), schema: { type: "object", properties: { value: { type: "string" } } } },
    });
    expect(await kit.verdict(redefine)).toMatch(/^bad_extends/);
  });

  it("versions a type by editing it (supersede), only by its author", async () => {
    const kit = await boot();
    const app = await kit.newApp();
    const v1 = await kit.emit(app, { user: app, type: "type", payload: { name: "note", schema: { type: "object" } } });
    const v2 = await kit.emit(app, { user: app, type: "type", ref: v1.address, supersedes: true, payload: { name: "note", schema: { type: "object", required: ["text"] } } });
    expect(await kit.verdict(v2)).toBe("valid");
    expect(formatAddress(kit.proj.types.get(formatAddress(v2.address))!.versionRoot)).toBe(formatAddress(v1.address));
    const other = await kit.newApp();
    const hijack = await kit.emit(other, { user: other, type: "type", ref: v1.address, supersedes: true, payload: { name: "note", schema: { type: "object" } } });
    expect(await kit.verdict(hijack)).toBe("supersede_by_non_author");
  });
});

describe("edits and deletes (04 §3, §5)", () => {
  it("tracks the head of a lineage; only the author can edit or delete", async () => {
    const { kit, app, alice, g, post } = await withPost();
    const edit = await kit.emit(app, { user: alice, type: "post", ref: post.address, supersedes: true, auth: g.address, payload: { title: "Hello, edited" } });
    expect(await kit.verdict(edit)).toBe("valid");
    expect(formatAddress(kit.proj.status(post.address)!.head)).toBe(formatAddress(edit.address));

    const bob = await kit.newUser();
    const gb = await kit.grant(app, bob);
    const fakeEdit = await kit.emit(app, { user: bob, type: "post", ref: post.address, supersedes: true, auth: gb.address, payload: { title: "pwned" } });
    expect(await kit.verdict(fakeEdit)).toBe("supersede_by_non_author");
    const fakeDelete = await kit.emit(app, { user: bob, type: "delete", ref: post.address, auth: gb.address, payload: {} });
    expect(await kit.verdict(fakeDelete)).toBe("delete_by_non_author");

    const del = await kit.emit(app, { user: alice, type: "delete", ref: edit.address, auth: g.address, payload: {} });
    expect(await kit.verdict(del)).toBe("valid");
    expect(kit.proj.status(post.address)!.deleted).toBe(true);
    // The deleted event is untouched in the log.
    expect(await kit.store.getEvent(post.address)).toEqual(post);
  });

  it("can't change an event's type by editing it", async () => {
    const { kit, app, alice, g, post } = await withPost();
    const e = await kit.emit(app, { user: alice, type: "comment", ref: post.address, supersedes: true, auth: g.address, payload: { body: "x" } });
    expect(await kit.verdict(e)).toBe("supersede_changes_type");
  });
});

describe("constraints", () => {
  it("ref_type: a comment may only reference a post or a comment", async () => {
    const { kit, app, alice, g, post } = await withPost();
    const c1 = await kit.emit(app, { user: alice, type: "comment", ref: post.address, auth: g.address, payload: { body: "first!" } });
    const c2 = await kit.emit(app, { user: alice, type: "comment", ref: c1.address, auth: g.address, payload: { body: "nested" } });
    expect(await kit.verdict(c1)).toBe("valid");
    expect(await kit.verdict(c2)).toBe("valid");
    const like = await kit.emit(app, { user: alice, type: "like", ref: post.address, auth: g.address, payload: {} });
    const c3 = await kit.emit(app, { user: alice, type: "comment", ref: like.address, auth: g.address, payload: { body: "on a like" } });
    expect(await kit.verdict(c3)).toBe("ref_type_mismatch");
  });

  it("ref_type follows an edit to its root's reference", async () => {
    const { kit, app, alice, g, post } = await withPost();
    const c1 = await kit.emit(app, { user: alice, type: "comment", ref: post.address, auth: g.address, payload: { body: "typo" } });
    const c1b = await kit.emit(app, { user: alice, type: "comment", ref: c1.address, supersedes: true, auth: g.address, payload: { body: "fixed" } });
    expect(await kit.verdict(c1b)).toBe("valid");
    expect(kit.proj.edges.get(formatAddress(c1b.address))).toBeUndefined(); // edits add no edges
    expect(kit.proj.edges.get(formatAddress(c1.address))!.dst).toBe(formatAddress(post.address));
  });
});

describe("reactions: unique per author and target, latest wins", () => {
  it("counts one vote per user; changing a vote replaces it; deleting removes it", async () => {
    const { kit, app, alice, g, post } = await withPost();
    const bob = await kit.newUser();
    const gb = await kit.grant(app, bob);
    const vote = kit.type("vote");

    await kit.emit(app, { user: alice, type: "vote", ref: post.address, auth: g.address, payload: { value: 1 } });
    const bobUp = await kit.emit(app, { user: bob, type: "vote", ref: post.address, auth: gb.address, payload: { value: 1 } });
    await kit.sync();
    expect(kit.proj.aggregate(post.address, vote)).toEqual({ count: 2, sum: 2 });

    const bobDown = await kit.emit(app, { user: bob, type: "vote", ref: post.address, auth: gb.address, payload: { value: -1 } });
    await kit.sync();
    expect(kit.proj.aggregate(post.address, vote)).toEqual({ count: 2, sum: 0 });
    expect(kit.proj.events.get(formatAddress(bobUp.address))!.effective).toBe(false);

    await kit.emit(app, { user: bob, type: "delete", ref: bobDown.address, auth: gb.address, payload: {} });
    await kit.sync();
    expect(kit.proj.aggregate(post.address, vote)).toEqual({ count: 1, sum: 1 });

    // Votes also count towards the base type (reaction), likes and votes coexist.
    await kit.emit(app, { user: alice, type: "like", ref: post.address, auth: g.address, payload: {} });
    await kit.sync();
    expect(kit.proj.aggregate(post.address, kit.type("reaction")).count).toBe(2);
    expect(kit.proj.aggregate(post.address, kit.type("like")).count).toBe(1);
  });

  it("rejects votes outside +1/-1", async () => {
    const { kit, app, alice, g, post } = await withPost();
    const v = await kit.emit(app, { user: alice, type: "vote", ref: post.address, auth: g.address, payload: { value: 5 } });
    expect(await kit.verdict(v)).toMatch(/^schema/);
  });
});
