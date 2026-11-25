// The event envelope (02 §1). The demo stores it as columns + JSON; the flags
// field is implied by the nullable fields, `visibility` and `supersedes`.

import type { Address, Id } from "./address";
import type { JsonValue } from "./json";

export const ENVELOPE_VERSION = 1;

export type Visibility = "public" | "private";

export interface EventRecord {
  /** Envelope version; unknown versions are stored but not interpreted. */
  readonly version: number;
  readonly address: Address;
  readonly typeRef: Address;
  /** Single reference. With `supersedes` it means "previous version of". */
  readonly ref: Address | null;
  /** The supersede flag (04 §3): this event is a new version of `ref`. */
  readonly supersedes: boolean;
  /** Address of the grant this event relies on, if any. */
  readonly auth: Address | null;
  /** Unused in the demo (no keys). */
  readonly signature: Uint8Array | null;
  readonly visibility: Visibility;
  /** Claimed time (ISO 8601). Block time is authoritative. */
  readonly createdAt: string;
  readonly payload: JsonValue;
}

export function authorOf(e: EventRecord): Id {
  return e.address.user;
}

export function appOf(e: EventRecord): Id {
  return e.address.app;
}
