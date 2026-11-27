// The widget whitelist (05 §4 "Composition"). A view is a tree of
// these widgets, nothing else: what they can't express can't be built. Config
// arrives as untrusted JSON from the log, so parseWidget checks every node.
//
// Values inside widgets are ValueRefs: "$item" (the item in scope), "$props.x"
// (a view prop, from the URL), "$session.user", or a literal string.

export type ValueRef = string;
export type SortKey = "new" | "old" | "top" | "hot";
export const SORT_KEYS: readonly SortKey[] = ["hot", "new", "top", "old"];
export type TextStyle = "heading" | "title" | "body" | "muted";

export interface QuerySpec {
  /** Type addresses; descendants are included (05 §3). */
  readonly types: readonly string[];
  /** "none": top-level events only; otherwise events whose ref is this value. Omitted: any. */
  readonly ref?: ValueRef;
  readonly author?: ValueRef;
}

export type Widget =
  | { readonly widget: "stack"; readonly gap?: number; readonly children: readonly Widget[] }
  | { readonly widget: "row"; readonly gap?: number; readonly align?: "start" | "center" | "end"; readonly wrap?: boolean; readonly children: readonly Widget[] }
  | { readonly widget: "grid"; readonly columns: number; readonly gap?: number; readonly children: readonly Widget[] }
  | { readonly widget: "text"; readonly text: string; readonly style?: TextStyle }
  | { readonly widget: "list"; readonly query: QuerySpec; readonly sort?: ValueRef; readonly score?: string; readonly limit?: number; readonly item?: Widget; readonly empty?: string }
  | { readonly widget: "tree"; readonly root: ValueRef; readonly types: readonly string[]; readonly sort?: ValueRef; readonly score?: string; readonly depth?: number; readonly item?: Widget; readonly empty?: string }
  | { readonly widget: "item"; readonly of: ValueRef; readonly score?: string; readonly children: readonly Widget[] }
  | { readonly widget: "event"; readonly of?: ValueRef; readonly typeView?: string; readonly controls?: boolean }
  | { readonly widget: "button"; readonly action: string; readonly label?: string }
  | { readonly widget: "form"; readonly action: string; readonly label?: string; readonly collapsed?: boolean }
  /**
   * Navigation. Targets, first match wins: `event` (open one event), `view`
   * (another view of this app), `home` (the app's home view), or only `props`
   * (this view with other props, e.g. a different sort). Everything lands in the URL.
   */
  | { readonly widget: "link"; readonly text: string; readonly view?: string; readonly home?: boolean; readonly props?: { readonly [k: string]: ValueRef }; readonly event?: ValueRef }
  | { readonly widget: "view"; readonly view: string; readonly props?: { readonly [k: string]: ValueRef } };

export type WidgetKind = Widget["widget"];

/** Widgets the renderer knows. "graph" is reserved for the Graph Visualizer (after the first demo). */
export const WIDGET_KINDS: readonly WidgetKind[] = ["stack", "row", "grid", "text", "list", "tree", "item", "event", "button", "form", "link", "view"];

export const LIMITS = { depth: 24, nodes: 400, listLimit: 200, treeDepth: 12, gap: 64, columns: 12, viewNesting: 8 } as const;

const ADDRESS_RE = /^(0|[1-9][0-9]*)\/(0|[1-9][0-9]*)\/(0|[1-9][0-9]*)\/(0|[1-9][0-9]*)$/;
const SYMBOLIC_RE = /^@(view|action|type):[a-z0-9][a-z0-9._-]*$/;
const VALUE_RE = /^(\$item|\$session\.user|\$props\.[a-z][a-zA-Z0-9_]*)$/;
const PROP_NAME_RE = /^[a-z][a-zA-Z0-9_]*$/;

function isObj(v: unknown): v is { [k: string]: unknown } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** An address, or (in a bundle before it is emitted) a placeholder like "@view:home". */
export function isAddressLike(v: unknown, symbolic: boolean): v is string {
  return typeof v === "string" && (ADDRESS_RE.test(v) || (symbolic && SYMBOLIC_RE.test(v)));
}

export function isValueRef(v: unknown): v is ValueRef {
  if (typeof v !== "string" || v.length === 0 || v.length > 500) return false;
  if (v.startsWith("$")) return VALUE_RE.test(v);
  return true; // a literal: an address, a sort key, ...
}

export interface ParseResult<T> {
  readonly value?: T;
  readonly errors: readonly string[];
}

export interface ParseOptions {
  /** Accept "@view:x" / "@action:x" placeholders (bundles before they are emitted). */
  readonly symbolic?: boolean;
}

const ALLOWED: Record<WidgetKind, readonly string[]> = {
  stack: ["gap", "children"],
  row: ["gap", "align", "wrap", "children"],
  grid: ["columns", "gap", "children"],
  text: ["text", "style"],
  list: ["query", "sort", "score", "limit", "item", "empty"],
  tree: ["root", "types", "sort", "score", "depth", "item", "empty"],
  item: ["of", "score", "children"],
  event: ["of", "typeView", "controls"],
  button: ["action", "label"],
  form: ["action", "label", "collapsed"],
  link: ["text", "view", "home", "props", "event"],
  view: ["view", "props"],
};

/** Validates an untrusted widget tree. Unknown keys are errors, so typos surface in the makers. */
export function parseWidget(json: unknown, options: ParseOptions = {}): ParseResult<Widget> {
  const errors: string[] = [];
  const sym = options.symbolic ?? false;
  let nodes = 0;

  const walk = (b: unknown, path: string, depth: number): void => {
    nodes++;
    if (nodes > LIMITS.nodes) {
      if (nodes === LIMITS.nodes + 1) errors.push(`${path}: more than ${LIMITS.nodes} widgets`);
      return;
    }
    if (depth > LIMITS.depth) return void errors.push(`${path}: nested deeper than ${LIMITS.depth}`);
    if (!isObj(b)) return void errors.push(`${path}: a widget must be an object`);
    const kind = b.widget;
    if (typeof kind !== "string" || !(WIDGET_KINDS as readonly string[]).includes(kind)) {
      const note = kind === "graph" ? " (the graph widget comes with the Graph Visualizer)" : "";
      return void errors.push(`${path}: unknown widget ${JSON.stringify(kind)}${note}`);
    }
    const k0 = kind as WidgetKind;
    for (const k of Object.keys(b)) if (k !== "widget" && !ALLOWED[k0].includes(k)) errors.push(`${path}.${k}: not a property of ${kind}`);

    const str = (k: string, required: boolean, max = 2000): void => {
      const v = b[k];
      if (v === undefined) return void (required && errors.push(`${path}.${k}: required`));
      if (typeof v !== "string" || v.length > max) errors.push(`${path}.${k}: must be a string of at most ${max} characters`);
    };
    const int = (k: string, min: number, max: number): void => {
      const v = b[k];
      if (v !== undefined && (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max)) {
        errors.push(`${path}.${k}: must be an integer in ${min}..${max}`);
      }
    };
    const bool = (k: string): void => {
      if (b[k] !== undefined && typeof b[k] !== "boolean") errors.push(`${path}.${k}: must be true or false`);
    };
    const address = (k: string, required: boolean): void => {
      const v = b[k];
      if (v === undefined) return void (required && errors.push(`${path}.${k}: required`));
      if (!isAddressLike(v, sym)) errors.push(`${path}.${k}: must be an address`);
    };
    const value = (k: string, required: boolean): void => {
      const v = b[k];
      if (v === undefined) return void (required && errors.push(`${path}.${k}: required`));
      if (!isValueRef(v)) errors.push(`${path}.${k}: must be $item, $props.<name>, $session.user or a literal`);
    };
    const children = (k: string): void => {
      const v = b[k];
      if (!Array.isArray(v)) return void errors.push(`${path}.${k}: must be a list of widgets`);
      v.forEach((c, i) => walk(c, `${path}.${k}[${i}]`, depth + 1));
    };
    const props = (k: string): void => {
      const v = b[k];
      if (v === undefined) return;
      if (!isObj(v)) return void errors.push(`${path}.${k}: must be an object`);
      for (const [pk, pv] of Object.entries(v)) {
        if (!PROP_NAME_RE.test(pk)) errors.push(`${path}.${k}.${pk}: bad prop name`);
        if (!isValueRef(pv)) errors.push(`${path}.${k}.${pk}: bad value`);
      }
    };
    const types = (v: unknown, p: string): void => {
      if (!Array.isArray(v) || v.length === 0 || v.length > 20 || !v.every((t) => isAddressLike(t, sym))) {
        errors.push(`${p}: must be a non-empty list of type addresses`);
      }
    };

    switch (k0) {
      case "stack":
      case "row":
        int("gap", 0, LIMITS.gap);
        children("children");
        if (k0 === "row") {
          bool("wrap");
          if (b.align !== undefined && !["start", "center", "end"].includes(b.align as string)) errors.push(`${path}.align: start, center or end`);
        }
        break;
      case "grid":
        if (b.columns === undefined) errors.push(`${path}.columns: required`);
        int("columns", 1, LIMITS.columns);
        int("gap", 0, LIMITS.gap);
        children("children");
        break;
      case "text":
        str("text", true);
        if (b.style !== undefined && !["heading", "title", "body", "muted"].includes(b.style as string)) {
          errors.push(`${path}.style: heading, title, body or muted`);
        }
        break;
      case "list": {
        const q = b.query;
        if (!isObj(q)) errors.push(`${path}.query: required object`);
        else {
          for (const k of Object.keys(q)) if (!["types", "ref", "author"].includes(k)) errors.push(`${path}.query.${k}: not a query field`);
          types(q.types, `${path}.query.types`);
          if (q.ref !== undefined && !isValueRef(q.ref)) errors.push(`${path}.query.ref: bad value`);
          if (q.author !== undefined && !isValueRef(q.author)) errors.push(`${path}.query.author: bad value`);
        }
        value("sort", false);
        address("score", false);
        int("limit", 1, LIMITS.listLimit);
        str("empty", false, 500);
        if (b.item !== undefined) walk(b.item, `${path}.item`, depth + 1);
        break;
      }
      case "tree":
        value("root", true);
        types(b.types, `${path}.types`);
        value("sort", false);
        address("score", false);
        int("depth", 1, LIMITS.treeDepth);
        str("empty", false, 500);
        if (b.item !== undefined) walk(b.item, `${path}.item`, depth + 1);
        break;
      case "item":
        value("of", true);
        address("score", false);
        children("children");
        break;
      case "event":
        value("of", false);
        address("typeView", false);
        bool("controls");
        break;
      case "button":
        address("action", true);
        str("label", false, 200);
        break;
      case "form":
        address("action", true);
        str("label", false, 200);
        bool("collapsed");
        break;
      case "link":
        str("text", true, 500);
        address("view", false);
        props("props");
        value("event", false);
        bool("home");
        if (b.view === undefined && b.event === undefined && b.home !== true && b.props === undefined) {
          errors.push(`${path}: a link needs an event, a view, home or props`);
        }
        break;
      case "view":
        address("view", true);
        props("props");
        break;
    }
  };

  walk(json, "$", 0);
  return errors.length === 0 ? { value: json as Widget, errors } : { errors };
}

export interface PropDef {
  readonly type: "address" | "string" | "id";
  readonly default?: string;
}

export interface ViewConfig {
  readonly name: string;
  readonly props: { readonly [name: string]: PropDef };
  readonly root: Widget;
}

/** Validates a view event's payload (05 §4). */
export function parseView(payload: unknown, options: ParseOptions = {}): ParseResult<ViewConfig> {
  if (!isObj(payload)) return { errors: ["a view must be an object"] };
  const errors: string[] = [];
  if (typeof payload.name !== "string" || payload.name.length === 0) errors.push("name: required");
  const props: Record<string, PropDef> = {};
  if (payload.props !== undefined) {
    if (!isObj(payload.props)) errors.push("props: must be an object");
    else {
      for (const [k, d] of Object.entries(payload.props)) {
        if (!PROP_NAME_RE.test(k)) {
          errors.push(`props.${k}: bad name`);
          continue;
        }
        if (!isObj(d) || !["address", "string", "id"].includes(d.type as string) || (d.default !== undefined && typeof d.default !== "string")) {
          errors.push(`props.${k}: { type: address | string | id, default?: string }`);
          continue;
        }
        props[k] = d as unknown as PropDef;
      }
    }
  }
  const root = parseWidget(payload.root, options);
  errors.push(...root.errors.map((e) => `root${e.slice(1)}`));
  if (errors.length > 0) return { errors };
  return { value: { name: payload.name as string, props, root: root.value! }, errors };
}

export interface ActionConfig {
  readonly name: string;
  readonly label: string;
  readonly creates: string;
  /** "none", "$item", "$props.x" or a literal address. */
  readonly ref: ValueRef;
  readonly fields: readonly string[] | null;
  readonly fixed: { readonly [k: string]: unknown };
}

/** Validates an action event's payload (05 §4). */
export function parseAction(payload: unknown, options: ParseOptions = {}): ParseResult<ActionConfig> {
  if (!isObj(payload)) return { errors: ["an action must be an object"] };
  const errors: string[] = [];
  if (typeof payload.name !== "string" || payload.name.length === 0) errors.push("name: required");
  if (!isAddressLike(payload.creates, options.symbolic ?? false)) errors.push("creates: must be a type address");
  const ref = payload.ref ?? "none";
  if (!isValueRef(ref)) errors.push("ref: none, $item, $props.<name> or an address");
  if (payload.fields !== undefined && (!Array.isArray(payload.fields) || !payload.fields.every((f) => typeof f === "string"))) {
    errors.push("fields: list of field names");
  }
  if (payload.fixed !== undefined && !isObj(payload.fixed)) errors.push("fixed: must be an object");
  if (errors.length > 0) return { errors };
  const name = payload.name as string;
  return {
    value: {
      name,
      label: typeof payload.label === "string" && payload.label.length > 0 ? payload.label : name,
      creates: payload.creates as string,
      ref: ref as string,
      fields: (payload.fields as string[] | undefined) ?? null,
      fixed: (payload.fixed as Record<string, unknown> | undefined) ?? {},
    },
    errors,
  };
}
