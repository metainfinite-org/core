// What a block sees while rendering: the view's props (from the URL), the item
// in scope (inside list/tree/item blocks), and the session. ValueRefs and
// templates read from here; nothing else is reachable from config.

import type { JsonValue } from "@ev/core/browser";
import type { ItemJson } from "./api";
import type { ValueRef } from "./blocks";

export interface Scope {
  readonly app: string;
  readonly props: { readonly [k: string]: string };
  readonly item?: ItemJson;
  readonly session?: string;
}

/** Resolves "$item", "$props.x", "$session.user" or returns the literal. Undefined if not available. */
export function resolveValue(ref: ValueRef | undefined, scope: Scope): string | undefined {
  if (ref === undefined) return undefined;
  if (ref === "$item") return scope.item?.address;
  if (ref === "$session.user") return scope.session;
  if (ref.startsWith("$props.")) return scope.props[ref.slice("$props.".length)];
  return ref;
}

export interface TemplateContext {
  /** Identity id -> display name. */
  readonly nameOf?: (id: string) => string;
}

function fieldText(v: JsonValue | undefined): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

/** Short, deterministic rendering of an ISO time (UTC), for templates. */
export function formatTime(iso: string): string {
  return iso.length >= 16 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : iso;
}

/**
 * Display templates (05 §2 hints): "{title} by {$author}". Plain names read
 * the item's head payload; "$" names read item metadata or props. Unknown
 * names render as empty, so a template never fails.
 */
export function renderTemplate(template: string, scope: Scope, ctx: TemplateContext = {}): string {
  return template.replace(/\{(\$?[a-zA-Z_][a-zA-Z0-9_.]*)\}/g, (_, name: string) => {
    const item = scope.item;
    if (!name.startsWith("$")) {
      const p = item?.head.payload;
      if (p === null || typeof p !== "object" || Array.isArray(p)) return "";
      return fieldText(p[name]);
    }
    if (name.startsWith("$props.")) return scope.props[name.slice(7)] ?? "";
    if (!item) return "";
    switch (name) {
      case "$author": return ctx.nameOf ? ctx.nameOf(item.author) : item.author;
      case "$time": return formatTime(item.time);
      case "$score": return String(item.score);
      case "$votes": return String(item.votes);
      case "$children": return String(item.children);
      case "$address": return item.address;
      case "$edited": return item.edited ? "edited" : "";
      default: return "";
    }
  });
}
