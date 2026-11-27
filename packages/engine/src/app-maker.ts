// App Maker v1 (08 P5): pick types, a layout and sorts from a fixed menu, a
// name, and get a complete app bundle: actions from the types' generated
// forms, a home view and an item view composed from whitelisted widgets, and a
// manifest. No code; the generated bundle can be edited as JSON before saving.

import type { JsonValue } from "@ev/core/browser";
import type { TypeJson } from "./api";
import type { Widget, SortKey } from "./widgets";
import type { AppBundle, BundleEntry } from "./bundle";

export interface AppSpec {
  readonly name: string;
  readonly description?: string;
  /** Types people post at the top level (e.g. post). */
  readonly postTypes: readonly string[];
  /** Types that reply to an item or to another reply (e.g. comment). Empty: no discussion. */
  readonly replyTypes: readonly string[];
  /** Reaction type whose live sum is the score (e.g. vote). Null: no voting. */
  readonly scoreType: string | null;
  readonly sort: SortKey;
  readonly replySort: SortKey;
  /** How replies are laid out on an item's page. */
  readonly replyLayout: "tree" | "list";
}

function slug(s: string, i: number): string {
  const base = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
  return `${base || "type"}-${i}`;
}

/** True if the type's `value` field is an integer enum containing 1 and -1 (an up/down vote). */
export function isUpDown(t: TypeJson | undefined): boolean {
  const props = t?.schema.properties;
  if (!props || typeof props !== "object" || Array.isArray(props)) return false;
  const v = (props as { [k: string]: JsonValue }).value;
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const e = (v as { enum?: JsonValue }).enum;
  return Array.isArray(e) && e.includes(1) && e.includes(-1);
}

const SORT_LABELS: Record<SortKey, string> = { hot: "hot", new: "new", top: "top", old: "old" };

export function buildAppBundle(spec: AppSpec, types: ReadonlyMap<string, TypeJson>): AppBundle {
  if (spec.postTypes.length === 0) throw new Error("pick at least one type to post");
  const nameOf = (a: string) => types.get(a)?.name ?? a;
  const actions: BundleEntry[] = [];

  const postActions = spec.postTypes.map((t, i) => {
    const key = `new-${slug(nameOf(t), i)}`;
    actions.push({ key, payload: { name: `New ${nameOf(t)}`, label: `New ${nameOf(t)}`, creates: t, ref: "none" } });
    return key;
  });
  const replyActions = spec.replyTypes.map((t, i) => {
    const key = `reply-${slug(nameOf(t), i)}`;
    actions.push({ key, payload: { name: `Reply with a ${nameOf(t)}`, label: spec.replyTypes.length > 1 ? `Reply (${nameOf(t)})` : "Reply", creates: t, ref: "$item" } });
    return key;
  });

  // Voting controls for the item in scope.
  let votes: Widget | null = null;
  if (spec.scoreType) {
    const score = types.get(spec.scoreType);
    if (isUpDown(score)) {
      actions.push({ key: "up", payload: { name: "Upvote", label: "▲", creates: spec.scoreType, ref: "$item", fixed: { value: 1 } } });
      actions.push({ key: "down", payload: { name: "Downvote", label: "▼", creates: spec.scoreType, ref: "$item", fixed: { value: -1 } } });
      votes = { widget: "stack", gap: 0, children: [
        { widget: "button", action: "@action:up" },
        { widget: "text", text: "{$score}", style: "title" },
        { widget: "button", action: "@action:down" },
      ] };
    } else {
      actions.push({ key: "react", payload: { name: nameOf(spec.scoreType), label: `+ ${nameOf(spec.scoreType)}`, creates: spec.scoreType, ref: "$item" } });
      votes = { widget: "stack", gap: 0, children: [
        { widget: "button", action: "@action:react" },
        { widget: "text", text: "{$votes}", style: "muted" },
      ] };
    }
  }
  const score = spec.scoreType ? { score: spec.scoreType } : {};
  const withVotes = (main: Widget): Widget => (votes ? { widget: "row", gap: 12, align: "start", children: [votes, main] } : main);
  const sortLinks = (props: { [k: string]: string }): Widget => ({
    widget: "row", gap: 8,
    children: (["hot", "new", "top"] as SortKey[]).map((s) => ({ widget: "link", text: SORT_LABELS[s], props: { ...props, sort: s } }) as Widget),
  });

  // --- the item page: one item, its votes, a reply form, and the discussion ---
  const replyItem: Widget = withVotes({ widget: "stack", gap: 4, children: [
    { widget: "event", controls: true },
    { widget: "row", gap: 8, wrap: true, children: [
      { widget: "text", text: "{$author} · {$time}", style: "muted" },
      ...replyActions.map((a): Widget => ({ widget: "form", action: `@action:${a}`, collapsed: true, label: "reply" })),
    ] },
  ] });
  const discussion: Widget[] = spec.replyTypes.length === 0 ? [] : [
    sortLinks({ node: "$props.node" }),
    spec.replyLayout === "tree"
      ? { widget: "tree", root: "$props.node", types: spec.replyTypes, sort: "$props.sort", ...score, item: replyItem, empty: "No replies yet." }
      : { widget: "list", query: { types: spec.replyTypes, ref: "$props.node" }, sort: "$props.sort", ...score, item: replyItem, empty: "No replies yet." },
  ];
  const itemView: BundleEntry = {
    key: "item",
    payload: {
      name: "Item",
      props: { node: { type: "address" }, sort: { type: "string", default: spec.replySort } },
      root: { widget: "stack", gap: 16, children: [
        { widget: "link", text: `← ${spec.name}`, home: true },
        { widget: "item", of: "$props.node", ...score, children: [
          withVotes({ widget: "stack", gap: 6, children: [
            { widget: "event", controls: true },
            { widget: "text", text: "{$author} · {$time}", style: "muted" },
          ] }),
          ...replyActions.map((a): Widget => ({ widget: "form", action: `@action:${a}` })),
        ] },
        ...discussion,
      ] } as unknown as JsonValue,
    } as { [k: string]: JsonValue },
  };

  // --- the home page: post forms, sort links, the ranked list ---
  const listItem: Widget = withVotes({ widget: "stack", gap: 4, children: [
    { widget: "event" },
    { widget: "row", gap: 8, children: [
      { widget: "text", text: "{$author} · {$time}", style: "muted" },
      ...(spec.replyTypes.length > 0 ? [{ widget: "link", text: "{$children} replies", view: "@view:item", props: { node: "$item" } } as Widget] : []),
      { widget: "link", text: "open", view: "@view:item", props: { node: "$item" } },
    ] },
  ] });
  const homeView: BundleEntry = {
    key: "home",
    payload: {
      name: "Home",
      props: { sort: { type: "string", default: spec.sort } },
      root: { widget: "stack", gap: 16, children: [
        { widget: "text", text: spec.name, style: "heading" },
        ...(spec.description ? [{ widget: "text", text: spec.description, style: "muted" } as Widget] : []),
        ...postActions.map((a): Widget => ({ widget: "form", action: `@action:${a}`, collapsed: true })),
        sortLinks({}),
        { widget: "list", query: { types: spec.postTypes, ref: "none" }, sort: "$props.sort", ...score, item: listItem, empty: "Nothing here yet. Be the first to post." },
      ] } as unknown as JsonValue,
    } as { [k: string]: JsonValue },
  };

  const open: { [k: string]: string } = {};
  for (const t of [...spec.postTypes, ...spec.replyTypes]) open[t] = "@view:item";
  const manifest: { [k: string]: JsonValue } = {
    name: spec.name,
    home: "@view:home",
    views: ["@view:item", "@view:home"],
    actions: actions.map((a) => `@action:${a.key}`),
    types: [...new Set([...spec.postTypes, ...spec.replyTypes, ...(spec.scoreType ? [spec.scoreType] : [])])],
    open,
    extensions: { "app-maker": { spec: spec as unknown as JsonValue } },
  };
  if (spec.description) manifest.description = spec.description;
  return { actions, views: [itemView, homeView], manifest };
}
