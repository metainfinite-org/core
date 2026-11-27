// Rendering fallback for one event (05 §3 "Inheritance", §4 "Displaying one
// event"): the app's override for the type → the type's default type view →
// the same for the nearest base type → the (inherited) display template →
// the auto-renderer from the schema. Raw JSON is the renderer's last resort.

import type { JsonValue } from "@ev/core/browser";
import type { TypeJson } from "./api";

export type Rendering =
  | { readonly kind: "typeView"; readonly address: string; readonly via: string }
  | { readonly kind: "template"; readonly template: string; readonly schema: { readonly [k: string]: JsonValue } }
  | { readonly kind: "auto"; readonly schema: { readonly [k: string]: JsonValue } }
  | { readonly kind: "raw" };

export interface RenderingContext {
  readonly types: ReadonlyMap<string, TypeJson>;
  /** The app's manifest.typeViews: type address -> type view address. */
  readonly appTypeViews?: { readonly [type: string]: string };
}

export function resolveRendering(type: string, ctx: RenderingContext): Rendering {
  const start = ctx.types.get(type);
  if (!start) return { kind: "raw" };
  const seen = new Set<string>();
  let t: TypeJson | undefined = start;
  while (t && !seen.has(t.address)) {
    seen.add(t.address);
    const override = ctx.appTypeViews?.[t.address] ?? ctx.appTypeViews?.[t.versionRoot];
    if (override) return { kind: "typeView", address: override, via: t.address };
    if (t.defaultTypeView) return { kind: "typeView", address: t.defaultTypeView, via: t.address };
    t = t.extends ? ctx.types.get(t.extends) : undefined;
  }
  const template = start.hints.display_template;
  if (typeof template === "string" && template.length > 0) return { kind: "template", template, schema: start.schema };
  return { kind: "auto", schema: start.schema };
}
