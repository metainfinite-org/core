// JSON payload rules for the demos (02 §4): plain JSON, but written so that a
// later canonical (DAG-CBOR) conversion is lossless.
//  - integers must be safe JS integers; 64-bit integers and addresses go in strings
//  - no floats (decimals go in strings)
//  - strings must be NFC

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface JsonRuleViolation {
  path: string;
  message: string;
}

export function checkJsonRules(value: unknown, path = "$"): JsonRuleViolation[] {
  const out: JsonRuleViolation[] = [];
  walk(value, path, out);
  return out;
}

function walk(v: unknown, path: string, out: JsonRuleViolation[]): void {
  if (v === null || typeof v === "boolean") return;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) out.push({ path, message: "non-finite number" });
    else if (!Number.isInteger(v)) out.push({ path, message: "floats are not allowed; use a decimal string" });
    else if (!Number.isSafeInteger(v)) out.push({ path, message: "integer beyond 2^53; use a string" });
    else if (Object.is(v, -0)) out.push({ path, message: "negative zero" });
    return;
  }
  if (typeof v === "string") {
    if (v.normalize("NFC") !== v) out.push({ path, message: "string is not NFC-normalized" });
    return;
  }
  if (Array.isArray(v)) {
    v.forEach((item, i) => walk(item, `${path}[${i}]`, out));
    return;
  }
  if (typeof v === "object") {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) {
      out.push({ path, message: "only plain objects are allowed" });
      return;
    }
    for (const [k, item] of Object.entries(v as Record<string, unknown>)) {
      if (k.normalize("NFC") !== k) out.push({ path: `${path}.${k}`, message: "key is not NFC-normalized" });
      walk(item, `${path}.${k}`, out);
    }
    return;
  }
  out.push({ path, message: `unsupported value of type ${typeof v}` });
}

/**
 * Deterministic serialization used for hashing projections and comparing state.
 * Object keys sorted by code point, bigint rendered as a decimal string with an
 * "n" suffix (so it can't collide with a plain string), Maps and Sets sorted.
 * This is NOT the canonical event encoding (that is DAG-CBOR, decided in P8).
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(v: unknown): unknown {
  if (typeof v === "bigint") return `${v}n`;
  if (v === undefined) return null;
  if (v === null || typeof v !== "object") return v;
  if (v instanceof Uint8Array) return { $bytes: Buffer.from(v).toString("hex") };
  if (v instanceof Map) {
    const entries = [...v.entries()].map(([k, val]) => [normalize(k), normalize(val)] as const);
    entries.sort((a, b) => cmp(JSON.stringify(a[0]), JSON.stringify(b[0])));
    return { $map: entries };
  }
  if (v instanceof Set) {
    const items = [...v].map(normalize);
    items.sort((a, b) => cmp(JSON.stringify(a), JSON.stringify(b)));
    return { $set: items };
  }
  if (Array.isArray(v)) return v.map(normalize);
  const obj = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort(cmp)) out[k] = normalize(obj[k]);
  return out;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
