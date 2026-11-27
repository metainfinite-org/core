// App bundles (05 §6): an app's config written with symbolic names
// ("@action:up", "@view:item") instead of addresses, like the genesis file.
// Emitting a bundle publishes actions, then views, then the manifest, each
// replacing the placeholders of the ones before it with real addresses. The
// App Maker shows and edits bundles; the same format can later move apps
// between deployments.

import type { JsonValue } from "@ev/core/browser";
import { parseAction, parseView } from "./blocks";

export interface BundleEntry {
  readonly key: string;
  readonly payload: { readonly [k: string]: JsonValue };
}

export interface AppBundle {
  /** Emitted in order. */
  readonly actions: readonly BundleEntry[];
  /** Emitted in order; a view may reference actions and earlier views. */
  readonly views: readonly BundleEntry[];
  readonly manifest: { readonly [k: string]: JsonValue };
}

export type ConfigKind = "action" | "view" | "manifest";

/** Emits one config event as the app; returns its address. `supersedes` = previous manifest. */
export type EmitConfig = (kind: ConfigKind, payload: JsonValue, supersedes?: string) => Promise<string>;

const PLACEHOLDER_RE = /^@(action|view):([a-z0-9][a-z0-9._-]*)$/;
const KEY_RE = /^[a-z0-9][a-z0-9._-]*$/;

export function substitute(v: JsonValue, symbols: ReadonlyMap<string, string>): JsonValue {
  if (typeof v === "string") {
    if (!PLACEHOLDER_RE.test(v)) return v;
    const a = symbols.get(v);
    if (a === undefined) throw new Error(`${v} is not defined before it is used`);
    return a;
  }
  if (Array.isArray(v)) return v.map((x) => substitute(x, symbols));
  if (v !== null && typeof v === "object") {
    const out: { [k: string]: JsonValue } = {};
    for (const [k, x] of Object.entries(v)) out[substitute(k, symbols) as string] = substitute(x, symbols);
    return out;
  }
  return v;
}

/** Checks a bundle before anything is emitted: shapes, keys, and that placeholders resolve in order. */
export function checkBundle(bundle: unknown): string[] {
  const errors: string[] = [];
  if (typeof bundle !== "object" || bundle === null || Array.isArray(bundle)) return ["a bundle must be an object"];
  const b = bundle as { actions?: unknown; views?: unknown; manifest?: unknown };
  const defined = new Map<string, string>();
  const refs = (v: unknown, where: string): void => {
    if (typeof v === "string" && PLACEHOLDER_RE.test(v) && !defined.has(v)) errors.push(`${where}: ${v} is used before it is defined`);
    else if (Array.isArray(v)) v.forEach((x) => refs(x, where));
    else if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v)) { refs(k, where); refs(x, where); }
  };
  for (const [list, kind] of [[b.actions, "action"], [b.views, "view"]] as const) {
    if (!Array.isArray(list)) { errors.push(`${kind}s: must be a list`); continue; }
    for (const [i, entry] of list.entries()) {
      const where = `${kind}s[${i}]`;
      if (typeof entry !== "object" || entry === null || typeof entry.key !== "string" || !KEY_RE.test(entry.key)) {
        errors.push(`${where}: needs a key like "home"`);
        continue;
      }
      refs(entry.payload, `${where} (${entry.key})`);
      const parsed = kind === "action" ? parseAction(entry.payload, { symbolic: true }) : parseView(entry.payload, { symbolic: true });
      errors.push(...parsed.errors.map((e) => `${where} (${entry.key}): ${e}`));
      const sym = `@${kind}:${entry.key}`;
      if (defined.has(sym)) errors.push(`${where}: duplicate key ${entry.key}`);
      defined.set(sym, "");
    }
  }
  if (typeof b.manifest !== "object" || b.manifest === null || Array.isArray(b.manifest)) errors.push("manifest: must be an object");
  else {
    refs(b.manifest, "manifest");
    if (typeof (b.manifest as { name?: unknown }).name !== "string") errors.push("manifest.name: required");
  }
  return errors;
}

export interface EmittedBundle {
  readonly manifest: string;
  readonly symbols: ReadonlyMap<string, string>;
}

export async function emitBundle(bundle: AppBundle, emit: EmitConfig, previousManifest?: string): Promise<EmittedBundle> {
  const errors = checkBundle(bundle);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  const symbols = new Map<string, string>();
  for (const a of bundle.actions) symbols.set(`@action:${a.key}`, await emit("action", substitute(a.payload, symbols)));
  for (const v of bundle.views) symbols.set(`@view:${v.key}`, await emit("view", substitute(v.payload, symbols)));
  const manifest = await emit("manifest", substitute(bundle.manifest, symbols), previousManifest);
  return { manifest, symbols };
}
