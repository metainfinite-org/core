import { describe, expect, it } from "vitest";
import {
  autoLayout,
  buildAppBundle,
  checkBundle,
  compareItems,
  formFields,
  hotRank,
  log2Fixed,
  parseWidget,
  parseView,
  payloadFromForm,
  renderTemplate,
  resolveRendering,
  resolveValue,
  type ItemJson,
  type TypeJson,
} from "../src/index";

const item = (over: Partial<ItemJson> = {}): ItemJson => ({
  address: "7/1/5/1",
  head: { version: 1, address: "7/1/5/1", type: "1/2/1/1", ref: null, supersedes: false, auth: null, signature: null, visibility: "public", createdAt: "2026-01-02T00:00:00.000Z", payload: { title: "Hello", n: 3 } },
  author: "5", app: "7", block: "10", time: "2026-01-02T03:04:05.000Z", edited: false, score: 0, votes: 0, children: 0,
  ...over,
});

describe("widgets", () => {
  it("accepts a valid tree and rejects unknown widgets, keys and values", () => {
    expect(parseWidget({ widget: "stack", children: [{ widget: "text", text: "hi" }] }).errors).toEqual([]);
    expect(parseWidget({ widget: "graph" }).errors[0]).toContain("Graph Visualizer");
    expect(parseWidget({ widget: "text", text: "x", colour: "red" }).errors[0]).toContain("colour");
    expect(parseWidget({ widget: "list", query: { types: ["nope"] } }).errors[0]).toContain("type addresses");
    expect(parseWidget({ widget: "event", of: "$whatever" }).errors.length).toBe(1);
    expect(parseWidget({ widget: "button", action: "@action:up" }).errors.length).toBe(1);
    expect(parseWidget({ widget: "button", action: "@action:up" }, { symbolic: true }).errors).toEqual([]);
  });

  it("bounds size and depth", () => {
    let deep: object = { widget: "text", text: "x" };
    for (let i = 0; i < 40; i++) deep = { widget: "stack", children: [deep] };
    expect(parseWidget(deep).errors.some((e) => e.includes("deeper"))).toBe(true);
    const wide = { widget: "stack", children: Array.from({ length: 500 }, () => ({ widget: "text", text: "x" })) };
    expect(parseWidget(wide).errors.some((e) => e.includes("more than"))).toBe(true);
  });

  it("parses views with props", () => {
    const v = parseView({ name: "Item", props: { node: { type: "address" } }, root: { widget: "event", of: "$props.node" } });
    expect(v.errors).toEqual([]);
    expect(v.value!.props.node!.type).toBe("address");
    expect(parseView({ name: "x", props: { node: { type: "float" } }, root: { widget: "text", text: "" } }).errors.length).toBe(1);
  });
});

describe("scope and templates", () => {
  it("resolves value refs", () => {
    const scope = { app: "7", props: { node: "1/2/3/4" }, item: item(), session: "5" };
    expect(resolveValue("$item", scope)).toBe("7/1/5/1");
    expect(resolveValue("$props.node", scope)).toBe("1/2/3/4");
    expect(resolveValue("$session.user", scope)).toBe("5");
    expect(resolveValue("hot", scope)).toBe("hot");
  });

  it("renders payload fields and item metadata; unknown names are empty", () => {
    const scope = { app: "7", props: { sort: "top" }, item: item({ score: 4 }) };
    expect(renderTemplate("{title} ({n}) by {$author} · {$score} · {$props.sort} · {missing}.", scope, { nameOf: () => "alice" }))
      .toBe("Hello (3) by alice · 4 · top · .");
    expect(renderTemplate("{$time}", scope)).toBe("2026-01-02 03:04 UTC");
  });
});

describe("generated forms and layouts", () => {
  const schema = {
    type: "object", required: ["title", "value"],
    properties: { title: { type: "string", maxLength: 100 }, body: { type: "string" }, value: { type: "integer", enum: [1, -1] }, done: { type: "boolean" } },
  };

  it("derives fields from the schema", () => {
    expect(formFields(schema).map((f) => [f.name, f.kind, f.required])).toEqual([
      ["title", "string", true], ["body", "text", false], ["value", "enum", true], ["done", "boolean", false],
    ]);
  });

  it("builds payloads, with fixed values and errors", () => {
    const fields = formFields(schema);
    expect(payloadFromForm(fields, { title: "hi", value: "-1" })).toEqual({ payload: { title: "hi", value: -1 }, errors: [] });
    expect(payloadFromForm(fields, { title: "" }).errors.length).toBe(2);
    expect(payloadFromForm(fields, { title: "x" }, { value: 1 }).payload).toEqual({ title: "x", value: 1 });
  });

  it("lays out an event from its schema and display template", () => {
    const b = autoLayout(schema, "{title}");
    expect(parseWidget(b).errors).toEqual([]);
    expect(JSON.stringify(b)).toContain('"style":"title"');
  });
});

describe("sorting", () => {
  it("log2Fixed is exact on powers of two and monotonic", () => {
    expect(log2Fixed(1n)).toBe(0n);
    expect(log2Fixed(8n)).toBe(3n << 16n);
    let prev = -1n;
    for (let n = 1n; n < 300n; n++) {
      const v = log2Fixed(n);
      expect(v > prev).toBe(true);
      prev = v;
    }
  });

  it("hot: score matters, and recency matters more over time", () => {
    const t = Date.parse("2026-01-02T00:00:00Z");
    expect(hotRank(10, t) > hotRank(1, t)).toBe(true);
    expect(hotRank(-5, t) < hotRank(0, t)).toBe(true);
    expect(hotRank(1, t + 48 * 3600_000) > hotRank(100, t)).toBe(true);
  });

  it("top falls back to newest on ties", () => {
    const a = item({ address: "7/1/5/1", block: "10", score: 1 });
    const b = item({ address: "7/2/5/1", block: "11", score: 1 });
    expect([a, b].sort((x, y) => compareItems("top", x, y)).map((i) => i.address)).toEqual(["7/2/5/1", "7/1/5/1"]);
  });
});

describe("type view fallback", () => {
  const ty = (over: Partial<TypeJson>): TypeJson => ({
    address: "1/1/1/1", name: "t", author: "1", extends: null, versionRoot: "1/1/1/1", head: "1/1/1/1", isHead: true,
    schema: { type: "object" }, own: {}, hints: {}, defaultTypeView: null, usage: 0, ...over,
  });
  const base = ty({ address: "1/2/1/1", versionRoot: "1/2/1/1", defaultTypeView: "1/9/1/1" });
  const derived = ty({ address: "1/3/1/1", versionRoot: "1/3/1/1", extends: "1/2/1/1", hints: { display_template: "{x}" } });
  const types = new Map([base, derived].map((t) => [t.address, t]));

  it("app override, then the type's own, then the nearest base's", () => {
    expect(resolveRendering("1/3/1/1", { types, appTypeViews: { "1/3/1/1": "7/1/7/1" } })).toMatchObject({ kind: "typeView", address: "7/1/7/1" });
    expect(resolveRendering("1/3/1/1", { types })).toMatchObject({ kind: "typeView", address: "1/9/1/1", via: "1/2/1/1" });
  });

  it("then the display template, then the auto-renderer, then raw", () => {
    const lone = new Map([[derived.address, { ...derived, extends: null }]]);
    expect(resolveRendering("1/3/1/1", { types: lone })).toMatchObject({ kind: "template", template: "{x}" });
    expect(resolveRendering("1/2/1/1", { types: new Map([[base.address, { ...base, defaultTypeView: null }]]) })).toMatchObject({ kind: "auto" });
    expect(resolveRendering("9/9/9/9", { types })).toEqual({ kind: "raw" });
  });
});

describe("App Maker bundles", () => {
  const vote: TypeJson = {
    address: "1/27/1/1", name: "vote", author: "1", extends: "1/25/1/1", versionRoot: "1/27/1/1", head: "1/27/1/1", isHead: true,
    schema: { type: "object", properties: { value: { type: "integer", enum: [1, -1] } } }, own: {}, hints: {}, defaultTypeView: null, usage: 0,
  };
  const types = new Map([[vote.address, vote], ["1/23/1/1", { ...vote, address: "1/23/1/1", name: "post", schema: { type: "object" } }]]);

  it("generates a bundle that checks, with up/down votes for a ±1 vote type", () => {
    const b = buildAppBundle({ name: "Board", postTypes: ["1/23/1/1"], replyTypes: ["1/23/1/1"], scoreType: vote.address, sort: "hot", replySort: "top", replyLayout: "tree" }, types);
    expect(checkBundle(b)).toEqual([]);
    expect(b.actions.map((a) => a.key)).toEqual(["new-post-0", "reply-post-0", "up", "down"]);
    expect(b.views.map((v) => v.key)).toEqual(["item", "home"]);
  });

  it("checkBundle catches forward references and bad widgets", () => {
    const errs = checkBundle({ actions: [], views: [{ key: "home", payload: { name: "h", root: { widget: "link", text: "x", view: "@view:later" } } }], manifest: { name: "x" } });
    expect(errs.some((e) => e.includes("used before it is defined"))).toBe(true);
  });
});
