// A small, deterministic JSON Schema subset (05 §3). No remote refs, no
// floating-point keywords, unknown keywords rejected, so every validator gives
// the same verdict for the same schema and payload.
//
// Supported keywords: type, properties, required, additionalProperties (bool),
// items, enum, const, minLength, maxLength (code points), minimum, maximum,
// minItems, maxItems, pattern, format ("address" | "id"), title, description.

import { isAddressString, stableStringify, type JsonValue } from "@ev/core";

export type Schema = { readonly [key: string]: JsonValue };

const KNOWN = new Set([
  "type", "properties", "required", "additionalProperties", "items", "enum", "const",
  "minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems", "pattern",
  "format", "title", "description",
]);
const TYPES = new Set(["object", "array", "string", "integer", "boolean", "null"]);
const FORMATS = new Set(["address", "id"]);
const ID_RE = /^[1-9][0-9]*$/;

function isObj(v: unknown): v is { [k: string]: JsonValue } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Checks that a schema only uses the supported subset. Returns error messages. */
export function checkSchema(schema: unknown, path = "$"): string[] {
  const errs: string[] = [];
  if (!isObj(schema)) return [`${path}: schema must be an object`];
  for (const [k, v] of Object.entries(schema)) {
    if (!KNOWN.has(k)) {
      errs.push(`${path}: unsupported keyword "${k}"`);
      continue;
    }
    switch (k) {
      case "type": {
        const list = Array.isArray(v) ? v : [v];
        if (list.length === 0 || !list.every((t) => typeof t === "string" && TYPES.has(t))) errs.push(`${path}.type: invalid`);
        break;
      }
      case "properties":
        if (!isObj(v)) errs.push(`${path}.properties: must be an object`);
        else for (const [pk, ps] of Object.entries(v)) errs.push(...checkSchema(ps, `${path}.properties.${pk}`));
        break;
      case "required":
        if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) errs.push(`${path}.required: must be a list of strings`);
        break;
      case "additionalProperties":
        if (typeof v !== "boolean") errs.push(`${path}.additionalProperties: only true/false supported`);
        break;
      case "items":
        errs.push(...checkSchema(v, `${path}.items`));
        break;
      case "enum":
        if (!Array.isArray(v) || v.length === 0) errs.push(`${path}.enum: must be a non-empty list`);
        break;
      case "minLength": case "maxLength": case "minimum": case "maximum": case "minItems": case "maxItems":
        if (typeof v !== "number" || !Number.isSafeInteger(v)) errs.push(`${path}.${k}: must be an integer`);
        break;
      case "pattern":
        if (typeof v !== "string") errs.push(`${path}.pattern: must be a string`);
        else {
          try { new RegExp(v, "u"); } catch { errs.push(`${path}.pattern: invalid regular expression`); }
        }
        break;
      case "format":
        if (typeof v !== "string" || !FORMATS.has(v)) errs.push(`${path}.format: unsupported`);
        break;
      case "title": case "description":
        if (typeof v !== "string") errs.push(`${path}.${k}: must be a string`);
        break;
      case "const":
        break;
    }
  }
  return errs;
}

function typeOf(v: JsonValue): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

/** Validates a value against a (checked) schema. Returns error messages; empty = valid. */
export function validate(schema: Schema, value: JsonValue, path = "$"): string[] {
  const errs: string[] = [];
  const t = schema.type;
  if (t !== undefined) {
    const list = (Array.isArray(t) ? t : [t]) as string[];
    if (!list.includes(typeOf(value))) {
      return [`${path}: expected ${list.join(" | ")}, got ${typeOf(value)}`];
    }
  }
  if (schema.const !== undefined && stableStringify(schema.const) !== stableStringify(value)) {
    errs.push(`${path}: must equal the constant`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((x) => stableStringify(x) === stableStringify(value))) {
    errs.push(`${path}: not one of the allowed values`);
  }
  if (typeof value === "string") {
    const len = [...value].length;
    if (typeof schema.minLength === "number" && len < schema.minLength) errs.push(`${path}: shorter than ${schema.minLength}`);
    if (typeof schema.maxLength === "number" && len > schema.maxLength) errs.push(`${path}: longer than ${schema.maxLength}`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) errs.push(`${path}: does not match pattern`);
    if (schema.format === "address" && !isAddressString(value)) errs.push(`${path}: not an address`);
    if (schema.format === "id" && !ID_RE.test(value)) errs.push(`${path}: not an identity id`);
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) errs.push(`${path}: below ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) errs.push(`${path}: above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) errs.push(`${path}: fewer than ${schema.minItems} items`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) errs.push(`${path}: more than ${schema.maxItems} items`);
    if (isObj(schema.items)) value.forEach((item, i) => errs.push(...validate(schema.items as Schema, item, `${path}[${i}]`)));
  }
  if (isObj(value)) {
    const props = isObj(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required)) {
      for (const r of schema.required) if (typeof r === "string" && !(r in value)) errs.push(`${path}: missing "${r}"`);
    }
    for (const [k, v] of Object.entries(value)) {
      const ps = props[k];
      if (isObj(ps)) errs.push(...validate(ps, v, `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}: unexpected property "${k}"`);
    }
  }
  return errs;
}

/**
 * Combines a base type's effective schema with a derived type's own schema
 * (`extends`, 05 §3). Every derived instance must stay a valid base instance,
 * so base properties can't be redefined and a sealed base can't gain properties.
 */
export function extendSchema(base: Schema, own: Schema): { schema?: Schema; error?: string } {
  const baseProps = isObj(base.properties) ? base.properties : {};
  const ownProps = isObj(own.properties) ? own.properties : {};
  for (const k of Object.keys(ownProps)) {
    if (k in baseProps) return { error: `property "${k}" is already defined by the base type` };
  }
  if (base.additionalProperties === false && Object.keys(ownProps).length > 0) {
    return { error: "the base type is sealed (additionalProperties: false)" };
  }
  if (own.type !== undefined && base.type !== undefined && stableStringify(own.type) !== stableStringify(base.type)) {
    return { error: "a derived type can't change the base type's JSON type" };
  }
  const required = [
    ...new Set([
      ...(Array.isArray(base.required) ? base.required : []),
      ...(Array.isArray(own.required) ? own.required : []),
    ]),
  ];
  const schema: { [k: string]: JsonValue } = { ...base, ...own, properties: { ...baseProps, ...ownProps } };
  if (required.length > 0) schema.required = required;
  if (own.additionalProperties === undefined && base.additionalProperties !== undefined) {
    schema.additionalProperties = base.additionalProperties;
  }
  return { schema };
}
