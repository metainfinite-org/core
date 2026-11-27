// Rule set 1: the validity rules of 03 §5 and 04 §3–§6, plus type checks.
// Pure function of (event, context). Effects are applied by the projector.

import {
  ENVELOPE_VERSION,
  addressEquals,
  formatAddress,
  isEventAddress,
  parseAddress,
  type Address,
  type EventRecord,
  type JsonValue,
} from "@ev/core";
import { invalid, VALID, type Constraint, type RuleContext, type Verdict } from "./context";
import { checkSchema, extendSchema, validate, type Schema } from "./schema";

export interface RuleSet {
  readonly id: number;
  /** First block this rule set applies to. */
  readonly fromBlock: bigint;
  validate(event: EventRecord, ctx: RuleContext): Verdict;
}

function isObj(v: unknown): v is { [k: string]: JsonValue } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The reference that carries the lineage's relation: an edit inherits its root's ref (04 §3). */
export function effectiveRef(e: EventRecord, ctx: RuleContext): Address | null {
  if (!e.supersedes) return e.ref;
  const target = e.ref ? ctx.eventInfo(e.ref) : undefined;
  if (!target) return null;
  const root = ctx.eventInfo(target.lineageRoot);
  return root ? root.event.ref : null;
}

/** Is this event a type definition (an instance of the meta-type, or of a version of it)? */
export function isTypeDefinition(e: EventRecord, ctx: RuleContext): boolean {
  if (addressEquals(e.address, ctx.protocol.meta)) return true;
  const t = ctx.typeInfo(e.typeRef);
  return t !== undefined && addressEquals(t.versionRoot, ctx.protocol.meta);
}

function checkAuth(e: EventRecord, ctx: RuleContext): Verdict {
  const { app, user } = e.address;
  if (user === app) return VALID; // an app speaking for itself in its own batch
  // The user's owner (its IDM) publishing for it in the owner's batch (03 §5): the
  // owner could issue itself a grant anyway, so this adds no power.
  if (ctx.ownerOf(user) === app) return VALID;
  if (e.signature && !e.auth) return invalid("signatures_unsupported"); // no keys in the demo
  if (!e.auth) return invalid("no_auth");
  const g = ctx.grantInfo(e.auth);
  if (!g) return invalid("auth_not_a_valid_grant");
  if (g.app !== app) return invalid("grant_for_other_app");
  if (g.user !== user) return invalid("grant_for_other_user");
  if (g.revoked) return invalid("grant_revoked");
  return VALID;
}

/** Semantic checks of a type definition's payload beyond the meta-type schema. */
export function checkTypeDefinition(payload: JsonValue, ctx: RuleContext, self: Address): Verdict {
  if (!isObj(payload)) return invalid("type_payload_not_object");
  const schemaErrs = checkSchema(payload.schema);
  if (schemaErrs.length > 0) return invalid(`bad_schema: ${schemaErrs[0]}`);
  if (payload.extends !== undefined) {
    if (typeof payload.extends !== "string") return invalid("bad_extends");
    let baseAddr: Address;
    try { baseAddr = parseAddress(payload.extends); } catch { return invalid("bad_extends"); }
    const base = ctx.typeInfo(baseAddr);
    if (!base) return invalid("extends_unknown_type");
    const merged = extendSchema(base.schema, payload.schema as Schema);
    if (merged.error) return invalid(`bad_extends: ${merged.error}`);
  }
  if (payload.constraints !== undefined) {
    const parsed = parseConstraints(payload.constraints);
    if (typeof parsed === "string") return invalid(`bad_constraint: ${parsed}`);
    for (const c of parsed) {
      // A type may name itself (addresses are predictable), e.g. "a comment may reference a comment".
      if (c.kind === "ref_type") {
        for (const t of c.types) if (!addressEquals(t, self) && !ctx.typeInfo(t)) return invalid("constraint_unknown_type");
      }
    }
  }
  return VALID;
}

/** Parses the fixed v1 constraint vocabulary (05 §2). Returns an error string on failure. */
export function parseConstraints(v: JsonValue | undefined): Constraint[] | string {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return "constraints must be a list";
  const out: Constraint[] = [];
  for (const c of v) {
    if (!isObj(c)) return "constraint must be an object";
    switch (c.kind) {
      case "unique": {
        const per = c.per;
        if (!Array.isArray(per) || per.length === 0 || !per.every((p) => p === "author" || p === "ref")) return "unique.per";
        const resolve = c.resolve ?? "latest";
        if (resolve !== "latest" && resolve !== "first") return "unique.resolve";
        const scope = c.scope ?? "exact";
        if (scope !== "exact" && scope !== "family") return "unique.scope";
        out.push({ kind: "unique", per: per as ("author" | "ref")[], resolve, scope });
        break;
      }
      case "ref_type": {
        if (!Array.isArray(c.types) || c.types.length === 0) return "ref_type.types";
        const types: Address[] = [];
        for (const t of c.types) {
          if (typeof t !== "string") return "ref_type.types";
          try { types.push(parseAddress(t)); } catch { return "ref_type.types"; }
        }
        out.push({ kind: "ref_type", types });
        break;
      }
      case "author_is":
        if (c.path !== "ref.author") return "author_is.path";
        out.push({ kind: "author_is", path: "ref.author" });
        break;
      default:
        return `unknown kind ${JSON.stringify(c.kind)}`;
    }
  }
  return out;
}

function checkConstraints(e: EventRecord, constraints: readonly Constraint[], ctx: RuleContext): Verdict {
  const ref = effectiveRef(e, ctx);
  for (const c of constraints) {
    if (c.kind === "ref_type") {
      const target = ref ? ctx.eventInfo(ref) : undefined;
      if (!target || !target.valid) return invalid("ref_type_target_missing");
      if (!c.types.some((t) => ctx.isA(target.event.typeRef, t))) return invalid("ref_type_mismatch");
    } else if (c.kind === "author_is") {
      const target = ref ? ctx.eventInfo(ref) : undefined;
      if (!target) return invalid("author_is_target_missing");
      if (target.event.address.user !== e.address.user) return invalid("author_is_mismatch");
    }
    // "unique" doesn't affect validity: it decides which events count (projector).
  }
  return VALID;
}

function idField(payload: JsonValue, key: string): bigint | undefined {
  if (!isObj(payload)) return undefined;
  const v = payload[key];
  return typeof v === "string" && /^[1-9][0-9]*$/.test(v) ? BigInt(v) : undefined;
}

export function createRulesV1(fromBlock = 1n): RuleSet {
  return {
    id: 1,
    fromBlock,
    validate(e, ctx) {
      if (e.version !== ENVELOPE_VERSION) return invalid("unknown_envelope_version");
      if (!isEventAddress(e.address)) return invalid("bad_address");
      const { app, user } = e.address;
      if (!ctx.identityExists(app)) return invalid("unknown_app");
      if (!ctx.identityExists(user)) return invalid("unknown_user");

      // --- type -----------------------------------------------------------
      const isMetaItself = addressEquals(e.address, ctx.protocol.meta);
      let schema: Schema;
      let constraints: readonly Constraint[] = [];
      if (isMetaItself) {
        if (!addressEquals(e.typeRef, e.address)) return invalid("meta_type_must_reference_itself");
        if (!isObj(e.payload) || !isObj(e.payload.schema)) return invalid("meta_type_needs_schema");
        schema = e.payload.schema as Schema;
        const errs = checkSchema(schema);
        if (errs.length > 0) return invalid(`bad_schema: ${errs[0]}`);
      } else {
        const t = ctx.typeInfo(e.typeRef);
        if (!t) return invalid("unknown_type");
        schema = t.schema;
        constraints = t.constraints;
      }

      // --- consent: grants and revocations (03 §4, §5) --------------------
      // Authored by the user whose consent it is; published in the user's own
      // batch or in its current owner's batch, never under another grant.
      const P = ctx.protocol;
      if (!isMetaItself && !e.supersedes) {
        if (ctx.isA(e.typeRef, P.grant)) {
          const gApp = idField(e.payload, "app");
          const gUser = idField(e.payload, "user");
          if (gApp === undefined || gUser === undefined) return invalid("grant_payload");
          if (!ctx.identityExists(gApp) || !ctx.identityExists(gUser)) return invalid("grant_unknown_identity");
          if (user !== gUser) return invalid("grant_not_by_user");
          if (app !== user && ctx.ownerOf(user) !== app) return invalid("grant_not_by_owner");
        } else if (ctx.isA(e.typeRef, P.revoke)) {
          const g = e.ref ? ctx.grantInfo(e.ref) : undefined;
          if (!g) return invalid("revoke_target_not_a_grant");
          if (user !== g.user) return invalid("revoke_not_by_user");
          if (app !== user && ctx.ownerOf(user) !== app) return invalid("revoke_not_by_owner");
        }
      }

      // --- auth -----------------------------------------------------------
      const auth = checkAuth(e, ctx);
      if (!auth.valid) return auth;

      // --- payload schema -------------------------------------------------
      const errs = validate(schema, e.payload);
      if (errs.length > 0) return invalid(`schema: ${errs[0]}`);

      // --- supersede (edits) ---------------------------------------------
      if (e.supersedes) {
        if (!e.ref) return invalid("supersede_without_ref");
        const target = ctx.eventInfo(e.ref);
        if (!target || !target.valid) return invalid("supersede_target_missing");
        if (target.event.address.user !== user) return invalid("supersede_by_non_author");
        const root = ctx.eventInfo(target.lineageRoot)!;
        const sameFamily =
          addressEquals(root.event.typeRef, e.typeRef) ||
          (ctx.typeInfo(e.typeRef) !== undefined &&
            ctx.typeInfo(root.event.typeRef) !== undefined &&
            addressEquals(ctx.typeInfo(e.typeRef)!.versionRoot, ctx.typeInfo(root.event.typeRef)!.versionRoot));
        if (!sameFamily) return invalid("supersede_changes_type");
      }

      // --- type definitions ----------------------------------------------
      if (!isMetaItself && isTypeDefinition(e, ctx)) {
        const v = checkTypeDefinition(e.payload, ctx, e.address);
        if (!v.valid) return v;
      }

      // --- protocol types -------------------------------------------------
      if (!isMetaItself && !e.supersedes) {
        if (ctx.isA(e.typeRef, P.delete)) {
          const target = e.ref ? ctx.eventInfo(e.ref) : undefined;
          if (!target) return invalid("delete_target_missing");
          if (target.event.address.user !== user) return invalid("delete_by_non_author");
        }
      }

      // --- constraints ----------------------------------------------------
      return checkConstraints(e, constraints, ctx);
    },
  };
}

/** Picks the rule set active at a block (03 §6). Rule sets must be sorted by fromBlock. */
export function ruleSetFor(ruleSets: readonly RuleSet[], block: bigint): RuleSet {
  let active: RuleSet | undefined;
  for (const r of ruleSets) if (r.fromBlock <= block) active = r;
  if (!active) throw new Error(`no rule set for block ${block}`);
  return active;
}

export function describeVerdict(e: EventRecord, v: Verdict): string {
  return `${formatAddress(e.address)}: ${v.valid ? "valid" : v.reason}`;
}
