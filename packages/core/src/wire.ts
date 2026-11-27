// JSON forms of log entries for APIs and the JSON-lines export (07 §2).
// Ids and addresses become canonical strings, so no 64-bit value is ever a JS
// number on the wire. This is not the canonical encoding (02 §4, decided in P8).

import { formatAddress, parseAddress } from "./address";
import type { EventRecord, Visibility } from "./event";
import type { JsonValue } from "./json";
import { txPayloadJson, type Block, type Tx } from "./log";

export interface EventJson {
  readonly version: number;
  readonly address: string;
  readonly type: string;
  readonly ref: string | null;
  readonly supersedes: boolean;
  readonly auth: string | null;
  readonly signature: string | null;
  readonly visibility: Visibility;
  readonly createdAt: string;
  readonly payload: JsonValue;
}

export function eventToJson(e: EventRecord): EventJson {
  return {
    version: e.version,
    address: formatAddress(e.address),
    type: formatAddress(e.typeRef),
    ref: e.ref ? formatAddress(e.ref) : null,
    supersedes: e.supersedes,
    auth: e.auth ? formatAddress(e.auth) : null,
    signature: e.signature ? [...e.signature].map((b) => b.toString(16).padStart(2, "0")).join("") : null,
    visibility: e.visibility,
    createdAt: e.createdAt,
    payload: e.payload,
  };
}

export function eventFromJson(j: EventJson): EventRecord {
  return {
    version: j.version,
    address: parseAddress(j.address),
    typeRef: parseAddress(j.type),
    ref: j.ref ? parseAddress(j.ref) : null,
    supersedes: j.supersedes,
    auth: j.auth ? parseAddress(j.auth) : null,
    signature: j.signature ? Uint8Array.from(j.signature.match(/../g) ?? [], (h) => parseInt(h, 16)) : null,
    visibility: j.visibility,
    createdAt: j.createdAt,
    payload: j.payload,
  };
}

export type LogLine =
  | { readonly kind: "block"; readonly number: string; readonly createdAt: string }
  | { readonly kind: "tx"; readonly block: string; readonly idx: number; readonly type: Tx["type"]; readonly initiator: string; readonly payload: JsonValue }
  | ({ readonly kind: "event" } & EventJson);

export function blockToLine(b: Block): LogLine {
  return { kind: "block", number: b.number.toString(), createdAt: b.createdAt };
}

export function txToLine(tx: Tx): LogLine {
  return { kind: "tx", block: tx.block.toString(), idx: tx.idx, type: tx.type, initiator: tx.initiator.toString(), payload: txPayloadJson(tx) };
}
