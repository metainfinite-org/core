// What the validity rules may read. The projector implements this over its
// state "as of" the position being validated (replay is sequential, so the
// current state is the as-of state). Keeping it an interface lets the rules
// run against other projection stores later.

import type { Address, EventRecord, Id, Position } from "@ev/core";
import type { Schema } from "./schema";

/** Protocol-level types: their meaning lives in the kernel, named by the rule set (03 §9). */
export interface ProtocolTypes {
  readonly meta: Address;
  readonly grant: Address;
  readonly revoke: Address;
  readonly delete: Address;
}

export type Constraint =
  | {
      readonly kind: "unique";
      readonly per: readonly ("author" | "ref")[];
      readonly resolve: "latest" | "first";
      readonly scope: "exact" | "family";
      /** Version root of the type that declared it; set by the projector, used for family scope. */
      readonly declaredBy?: Address;
    }
  | { readonly kind: "ref_type"; readonly types: readonly Address[] }
  | { readonly kind: "author_is"; readonly path: "ref.author" };

export interface TypeInfo {
  readonly address: Address;
  readonly name: string;
  /** Effective schema: base schemas merged in along `extends`. */
  readonly schema: Schema;
  /** Direct base type, if any. */
  readonly extends: Address | null;
  /** Lineage root of this type's versions (itself when it is the first version). */
  readonly versionRoot: Address;
  /** Own constraints plus inherited ones. */
  readonly constraints: readonly Constraint[];
}

export interface EventInfo {
  readonly event: EventRecord;
  readonly valid: boolean;
  readonly position: Position;
  /** First version of this event's edit lineage. */
  readonly lineageRoot: Address;
  readonly deleted: boolean;
}

export interface GrantInfo {
  readonly address: Address;
  readonly app: Id;
  readonly user: Id;
  readonly revoked: boolean;
}

export interface RuleContext {
  readonly protocol: ProtocolTypes;
  identityExists(id: Id): boolean;
  ownerOf(id: Id): Id | undefined;
  eventInfo(address: Address): EventInfo | undefined;
  /** Only valid type events have TypeInfo. */
  typeInfo(address: Address): TypeInfo | undefined;
  /** True if `type` is `ancestor`, a version of it, or extends it (transitively). */
  isA(type: Address, ancestor: Address): boolean;
  grantInfo(address: Address): GrantInfo | undefined;
}

export type Verdict = { readonly valid: true } | { readonly valid: false; readonly reason: string };

export const VALID: Verdict = { valid: true };
export function invalid(reason: string): Verdict {
  return { valid: false, reason };
}
