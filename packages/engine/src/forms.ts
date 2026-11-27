// The auto-renderer (05 §4 "Displaying one event"): from a type's schema the
// kernel derives a creation form and a display layout, so every type can be
// instantiated and shown the moment it exists.

import type { JsonValue } from "@ev/core/browser";
import type { Widget } from "./widgets";

type Schema = { readonly [k: string]: JsonValue };

export type FieldKind = "string" | "text" | "integer" | "boolean" | "enum" | "address" | "id" | "json";

export interface FormField {
  readonly name: string;
  readonly label: string;
  readonly kind: FieldKind;
  readonly required: boolean;
  readonly options?: readonly JsonValue[];
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly description?: string;
}

function isObj(v: unknown): v is { [k: string]: JsonValue } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function labelOf(name: string): string {
  const s = name.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Strings longer than this get a text area. */
const SHORT_TEXT = 300;

export function fieldKind(s: Schema): FieldKind {
  if (Array.isArray(s.enum)) return "enum";
  switch (s.type) {
    case "string":
      if (s.format === "address") return "address";
      if (s.format === "id") return "id";
      return typeof s.maxLength === "number" && s.maxLength <= SHORT_TEXT ? "string" : "text";
    case "integer": return "integer";
    case "boolean": return "boolean";
    default: return "json";
  }
}

/** Form fields for an object schema, in property order. `only` limits and orders them. */
export function formFields(schema: Schema, only?: readonly string[] | null): FormField[] {
  const props = isObj(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const names = only ?? Object.keys(props);
  const out: FormField[] = [];
  for (const name of names) {
    const s = props[name];
    if (!isObj(s)) continue;
    const f: { -readonly [K in keyof FormField]: FormField[K] } = {
      name,
      label: typeof s.title === "string" ? s.title : labelOf(name),
      kind: fieldKind(s),
      required: required.has(name),
    };
    if (Array.isArray(s.enum)) f.options = s.enum;
    if (typeof s.maxLength === "number") f.maxLength = s.maxLength;
    if (typeof s.minimum === "number") f.minimum = s.minimum;
    if (typeof s.maximum === "number") f.maximum = s.maximum;
    if (typeof s.description === "string") f.description = s.description;
    out.push(f);
  }
  return out;
}

export type FormValues = { readonly [name: string]: string | boolean | undefined };

/**
 * Builds a payload from form inputs. Empty optional fields are left out;
 * `fixed` values are set without asking (e.g. a vote's value). Schema
 * validation is the caller's next step (the same validator as the server).
 */
export function payloadFromForm(fields: readonly FormField[], values: FormValues, fixed: { readonly [k: string]: unknown } = {}): { payload: { [k: string]: JsonValue }; errors: string[] } {
  const payload: { [k: string]: JsonValue } = {};
  const errors: string[] = [];
  for (const f of fields) {
    if (f.name in fixed) continue;
    const raw = values[f.name];
    if (f.kind === "boolean") {
      if (raw !== undefined) payload[f.name] = raw === true || raw === "true";
      else if (f.required) payload[f.name] = false;
      continue;
    }
    const text = typeof raw === "string" ? raw : "";
    if (text.trim() === "") {
      if (f.required) errors.push(`${f.label} is required`);
      continue;
    }
    switch (f.kind) {
      case "integer": {
        if (!/^-?(0|[1-9][0-9]*)$/.test(text.trim())) { errors.push(`${f.label} must be a whole number`); break; }
        const n = Number(text.trim());
        if (!Number.isSafeInteger(n)) errors.push(`${f.label} is too large`);
        else payload[f.name] = n;
        break;
      }
      case "enum": {
        const opt = f.options?.find((o) => String(o) === text);
        if (opt === undefined) errors.push(`${f.label}: pick one of the options`);
        else payload[f.name] = opt;
        break;
      }
      case "json":
        try { payload[f.name] = JSON.parse(text) as JsonValue; } catch { errors.push(`${f.label} must be JSON`); }
        break;
      default:
        payload[f.name] = text.normalize("NFC");
    }
  }
  for (const [k, v] of Object.entries(fixed)) payload[k] = v as JsonValue;
  return { payload, errors };
}

/** Form values from an existing payload (for edits). */
export function formFromPayload(fields: readonly FormField[], payload: JsonValue): { [name: string]: string | boolean } {
  const out: { [name: string]: string | boolean } = {};
  if (!isObj(payload)) return out;
  for (const f of fields) {
    const v = payload[f.name];
    if (v === undefined) continue;
    if (f.kind === "boolean") out[f.name] = v === true;
    else if (f.kind === "json") out[f.name] = JSON.stringify(v);
    else out[f.name] = String(v);
  }
  return out;
}

/** Field names used by a display template, e.g. "{title}" -> ["title"]. */
export function templateFields(template: string): string[] {
  return [...template.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map((m) => m[1]!);
}

/**
 * The auto-renderer's layout for one event of a type: the display template
 * as a title (if the type has one), then every other field as "Label: value".
 * The Type Maker stores this as the type's first default type view.
 */
export function autoLayout(schema: Schema, displayTemplate?: string | null): Widget {
  const fields = formFields(schema);
  const shown = new Set(displayTemplate ? templateFields(displayTemplate) : []);
  const children: Widget[] = [];
  if (displayTemplate) children.push({ widget: "text", text: displayTemplate, style: "title" });
  for (const f of fields) {
    if (shown.has(f.name)) continue;
    const long = f.kind === "text";
    children.push(long ? { widget: "text", text: `{${f.name}}`, style: "body" } : { widget: "text", text: `${f.label}: {${f.name}}`, style: "muted" });
  }
  if (children.length === 0) children.push({ widget: "text", text: "{$address}", style: "muted" });
  return { widget: "stack", gap: 4, children };
}
